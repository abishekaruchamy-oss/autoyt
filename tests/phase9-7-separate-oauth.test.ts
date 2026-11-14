/**
 * AUTOSHORTS PHASE 9.7 - GOOGLE OAUTH SEPARATION TEST SUITE
 *
 * Verifies:
 * 1. Drive vs YouTube OAuth Authorization Scopes & URL Generation (zero cross-service leakage, no include_granted_scopes)
 * 2. Durable OAuth State Isolation & Replay Protection (google_drive vs google_youtube provider tagging)
 * 3. OAuth Callback Handler Provider Separation & YouTube Channel Enforcement
 * 4. Credential Storage & AES-256-GCM Encryption Separation (db/migrations/0003 schema)
 * 5. Independent Token Getters & Fail-Closed Behavior (getValidDriveAccessToken vs getValidYouTubeAccessToken)
 * 6. Disconnect Isolation (clearing Drive does not touch YouTube and vice versa)
 * 7. 4-State Execution Readiness Matrix (neither, Drive only, YouTube only, both)
 * 8. Health API & Settings API Service Isolation Reporting
 */

import assert from 'node:assert';
import { NextRequest } from 'next/server';

import {
  CSRF_COOKIE_NAME,
  OAUTH_STATE_COOKIE_NAME,
  SESSION_COOKIE_NAME,
  createSessionToken,
  signOAuthStateCookieValue,
} from '../src/lib/auth';
import { decryptToken } from '../src/lib/crypto';
import { Repository } from '../src/server/db/repository';
import {
  getGoogleDriveAuthUrl,
  getYouTubeAuthUrl,
  saveGoogleServiceCredentials,
  getValidDriveAccessToken,
  getValidYouTubeAccessToken,
  isDriveConnected,
  isYouTubeConnected,
} from '../src/server/services/googleAuthService';

import * as driveAuthorizeRoute from '../src/app/api/auth/google/drive/authorize/route';
import * as ytAuthorizeRoute from '../src/app/api/auth/google/youtube/authorize/route';
import * as legacyAuthorizeRoute from '../src/app/api/auth/google/authorize/route';
import * as googleCallbackRoute from '../src/app/api/auth/google/callback/route';
import * as driveDisconnectRoute from '../src/app/api/auth/google/drive/disconnect/route';
import * as ytDisconnectRoute from '../src/app/api/auth/google/youtube/disconnect/route';
import * as healthRoute from '../src/app/api/health/route';

const TEST_ORIGIN = 'https://autoshorts.example';
const TEST_ADMIN_KEY = 'test-admin-access-key-phase97-32chars!!';
const TEST_SESSION_SECRET = 'test-session-secret-phase97-lengthy-at-least-32-chars';
const TEST_ENCRYPTION_KEY = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';

function makeRequest(
  path: string,
  options: {
    method?: string;
    headers?: Record<string, string>;
    body?: unknown;
  } = {}
): NextRequest {
  const method = options.method || 'GET';
  const headers = new Headers(options.headers || {});
  let serializedBody: string | undefined;
  if (options.body !== undefined) {
    serializedBody = typeof options.body === 'string' ? options.body : JSON.stringify(options.body);
    if (!headers.has('content-type')) {
      headers.set('content-type', 'application/json');
    }
  }
  return new NextRequest(`${TEST_ORIGIN}${path}`, {
    method,
    headers,
    body: serializedBody,
  });
}

function makeAuthenticatedAdminSession() {
  const session = createSessionToken();
  return {
    headers: {
      cookie: `${SESSION_COOKIE_NAME}=${session.token}; ${CSRF_COOKIE_NAME}=${session.payload.csrf}`,
      'x-csrf-token': session.payload.csrf,
      origin: TEST_ORIGIN,
    },
    jti: session.payload.jti,
    csrf: session.payload.csrf,
    token: session.token,
  };
}

async function runPhase97SeparateOAuthTests() {
  console.log('================================================================');
  console.log('AUTOSHORTS PHASE 9.7 - GOOGLE OAUTH SEPARATION VERIFICATION');
  console.log('================================================================\n');

  const envBackup = { ...process.env };
  const originalFetch = globalThis.fetch;

  process.env.ADMIN_ACCESS_KEY = TEST_ADMIN_KEY;
  process.env.ADMIN_SESSION_SECRET = TEST_SESSION_SECRET;
  process.env.TOKEN_ENCRYPTION_KEY = TEST_ENCRYPTION_KEY;
  process.env.GOOGLE_CLIENT_ID = 'test-google-client-id.apps.googleusercontent.com';
  process.env.GOOGLE_CLIENT_SECRET = 'test-google-client-secret-12345';
  process.env.GOOGLE_REDIRECT_URI = `${TEST_ORIGIN}/api/auth/google/callback`;

  let passedTests = 0;
  let totalTests = 0;

  const test = async (name: string, fn: () => Promise<void>) => {
    totalTests++;
    try {
      await fn();
      console.log(`  ✓ ${name}`);
      passedTests++;
    } catch (err) {
      console.error(`  ✗ ${name}`);
      console.error(err);
      throw err;
    }
  };

  try {
    // -------------------------------------------------------------------------
    console.log('--- Suite 1: Google Drive vs YouTube Authorization Scopes ---');
    // -------------------------------------------------------------------------

    await test('Drive Auth URL contains strictly Drive scopes and NO YouTube scopes', async () => {
      const redirectUri = `${TEST_ORIGIN}/api/auth/google/callback`;
      const { url, state } = getGoogleDriveAuthUrl(redirectUri);

      assert.ok(url.startsWith('https://accounts.google.com/o/oauth2/v2/auth'), 'Must use Google v2 auth endpoint');
      assert.ok(state.length >= 32, 'Must generate cryptographically secure state');

      const parsedUrl = new URL(url);
      const scope = parsedUrl.searchParams.get('scope') || '';
      const scopes = scope.split(' ');

      // Required Drive scopes
      assert.ok(scopes.includes('https://www.googleapis.com/auth/drive.file'), 'Must include drive.file');
      assert.ok(scopes.includes('https://www.googleapis.com/auth/userinfo.email'), 'Must include userinfo.email');
      assert.ok(scopes.includes('https://www.googleapis.com/auth/userinfo.profile'), 'Must include userinfo.profile');

      // STRICTLY FORBIDDEN YouTube scopes in Drive URL
      assert.ok(!scopes.includes('https://www.googleapis.com/auth/youtube.upload'), 'Must NOT include youtube.upload');
      assert.ok(!scopes.includes('https://www.googleapis.com/auth/youtube.readonly'), 'Must NOT include youtube.readonly');
      assert.ok(!scopes.includes('https://www.googleapis.com/auth/youtube'), 'Must NOT include youtube generic scope');

      // STRICTLY FORBIDDEN include_granted_scopes
      assert.strictEqual(parsedUrl.searchParams.get('include_granted_scopes'), null, 'Must NOT contain include_granted_scopes');

      // Required parameters
      assert.strictEqual(parsedUrl.searchParams.get('access_type'), 'offline');
      assert.strictEqual(parsedUrl.searchParams.get('prompt'), 'consent');
      assert.strictEqual(parsedUrl.searchParams.get('response_type'), 'code');
      assert.strictEqual(parsedUrl.searchParams.get('redirect_uri'), redirectUri);
    });

    await test('YouTube Auth URL contains strictly YouTube scopes and NO Drive scopes', async () => {
      const redirectUri = `${TEST_ORIGIN}/api/auth/google/callback`;
      const { url, state } = getYouTubeAuthUrl(redirectUri);

      assert.ok(url.startsWith('https://accounts.google.com/o/oauth2/v2/auth'), 'Must use Google v2 auth endpoint');
      assert.ok(state.length >= 32, 'Must generate cryptographically secure state');

      const parsedUrl = new URL(url);
      const scope = parsedUrl.searchParams.get('scope') || '';
      const scopes = scope.split(' ');

      // Required YouTube scopes
      assert.ok(scopes.includes('https://www.googleapis.com/auth/youtube.upload'), 'Must include youtube.upload');
      assert.ok(scopes.includes('https://www.googleapis.com/auth/youtube.readonly'), 'Must include youtube.readonly');
      assert.ok(scopes.includes('https://www.googleapis.com/auth/userinfo.email'), 'Must include userinfo.email');
      assert.ok(scopes.includes('https://www.googleapis.com/auth/userinfo.profile'), 'Must include userinfo.profile');

      // STRICTLY FORBIDDEN Drive scopes in YouTube URL
      assert.ok(!scopes.includes('https://www.googleapis.com/auth/drive.file'), 'Must NOT include drive.file');
      assert.ok(!scopes.includes('https://www.googleapis.com/auth/drive'), 'Must NOT include generic drive scope');

      // STRICTLY FORBIDDEN include_granted_scopes
      assert.strictEqual(parsedUrl.searchParams.get('include_granted_scopes'), null, 'Must NOT contain include_granted_scopes');

      // Required parameters
      assert.strictEqual(parsedUrl.searchParams.get('access_type'), 'offline');
      assert.strictEqual(parsedUrl.searchParams.get('prompt'), 'consent');
      assert.strictEqual(parsedUrl.searchParams.get('response_type'), 'code');
      assert.strictEqual(parsedUrl.searchParams.get('redirect_uri'), redirectUri);
    });

    await test('Dedicated Authorize routes tag state with correct provider in Repository', async () => {
      // 1. Drive authorize route
      const adminDrive = makeAuthenticatedAdminSession();
      const driveReq = makeRequest('/api/auth/google/drive/authorize', {
        headers: adminDrive.headers,
      });
      const driveRes = await driveAuthorizeRoute.GET(driveReq);
      assert.strictEqual(driveRes.status, 307, 'Should redirect');
      const driveLocation = driveRes.headers.get('location') || '';
      const driveUrl = new URL(driveLocation);
      const driveState = driveUrl.searchParams.get('state');
      assert.ok(driveState, 'Drive auth URL must contain state param');

      // Verify that consumed state record has provider 'google_drive'
      const driveStateRecord = await Repository.consumeOAuthStateRecord(driveState);
      assert.strictEqual(driveStateRecord.valid, true);
      assert.strictEqual(driveStateRecord.provider, 'google_drive');

      // 2. YouTube authorize route
      const adminYt = makeAuthenticatedAdminSession();
      const ytReq = makeRequest('/api/auth/google/youtube/authorize', {
        headers: adminYt.headers,
      });
      const ytRes = await ytAuthorizeRoute.GET(ytReq);
      assert.strictEqual(ytRes.status, 307, 'Should redirect');
      const ytLocation = ytRes.headers.get('location') || '';
      const ytUrl = new URL(ytLocation);
      const ytState = ytUrl.searchParams.get('state');
      assert.ok(ytState, 'YouTube auth URL must contain state param');

      // Verify that consumed state record has provider 'google_youtube'
      const ytStateRecord = await Repository.consumeOAuthStateRecord(ytState);
      assert.strictEqual(ytStateRecord.valid, true);
      assert.strictEqual(ytStateRecord.provider, 'google_youtube');

      // 3. Legacy authorize route with query ?service=youtube
      const adminLegacyYt = makeAuthenticatedAdminSession();
      const legacyYtReq = makeRequest('/api/auth/google/authorize?service=youtube', {
        headers: adminLegacyYt.headers,
      });
      const legacyYtRes = await legacyAuthorizeRoute.GET(legacyYtReq);
      const legacyYtUrl = new URL(legacyYtRes.headers.get('location') || '');
      const legacyYtRecord = await Repository.consumeOAuthStateRecord(legacyYtUrl.searchParams.get('state')!);
      assert.strictEqual(legacyYtRecord.provider, 'google_youtube');

      // 4. Legacy authorize route without query defaults to drive
      const adminLegacyDrive = makeAuthenticatedAdminSession();
      const legacyDriveReq = makeRequest('/api/auth/google/authorize', {
        headers: adminLegacyDrive.headers,
      });
      const legacyDriveRes = await legacyAuthorizeRoute.GET(legacyDriveReq);
      const legacyDriveUrl = new URL(legacyDriveRes.headers.get('location') || '');
      const legacyDriveRecord = await Repository.consumeOAuthStateRecord(legacyDriveUrl.searchParams.get('state')!);
      assert.strictEqual(legacyDriveRecord.provider, 'google_drive');
    });

    // -------------------------------------------------------------------------
    console.log('\n--- Suite 2: State Isolation & Replay Protection ---');
    // -------------------------------------------------------------------------

    await test('Single-use state consumption prevents replay attacks', async () => {
      const state = 'test-state-replay-1234567890abcdef1234567890';
      await Repository.saveOAuthState(state, `${TEST_ORIGIN}/api/auth/google/callback`, 60000, 'google_drive');

      // First consumption succeeds
      const record1 = await Repository.consumeOAuthStateRecord(state);
      assert.ok(record1);
      assert.strictEqual(record1.valid, true);
      assert.strictEqual(record1.provider, 'google_drive');

      // Second consumption fails (already consumed)
      const record2 = await Repository.consumeOAuthStateRecord(state);
      assert.strictEqual(record2, null);

      // validateAndConsumeOAuthState boolean helper also fails
      const valid3 = await Repository.validateAndConsumeOAuthState(state);
      assert.strictEqual(valid3, false);
    });

    // -------------------------------------------------------------------------
    console.log('\n--- Suite 3: OAuth Callback Handler & YouTube Channel Requirement ---');
    // -------------------------------------------------------------------------

    await test('Drive OAuth callback fetches userinfo only and saves Drive service credentials', async () => {
      const state = 'valid-drive-state-9876543210abcdef';
      await Repository.saveOAuthState(state, `${TEST_ORIGIN}/api/auth/google/callback`, 60000, 'google_drive');

      const admin = makeAuthenticatedAdminSession();
      const signedCookie = signOAuthStateCookieValue(state, admin.jti);
      const adminHeaders = {
        ...admin.headers,
        cookie: `${admin.headers.cookie}; ${OAUTH_STATE_COOKIE_NAME}=${signedCookie}`,
      };

      let calledYouTubeApi = false;
      let calledUserinfoApi = false;

      globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
        const urlStr = url.toString();
        // Token exchange
        if (urlStr.includes('oauth2.googleapis.com/token')) {
          return new Response(
            JSON.stringify({
              access_token: 'mock-drive-access-token-123',
              refresh_token: 'mock-drive-refresh-token-123',
              expires_in: 3600,
              token_type: 'Bearer',
              scope: 'https://www.googleapis.com/auth/drive.file https://www.googleapis.com/auth/userinfo.email openid',
            }),
            { status: 200, headers: { 'Content-Type': 'application/json' } }
          );
        }
        // Userinfo
        if (urlStr.includes('googleapis.com/oauth2/v2/userinfo')) {
          calledUserinfoApi = true;
          return new Response(
            JSON.stringify({
              id: 'google-user-id-drive',
              email: 'operator-drive@example.com',
              name: 'Drive Operator',
            }),
            { status: 200, headers: { 'Content-Type': 'application/json' } }
          );
        }
        // YouTube API call check (must NOT happen)
        if (urlStr.includes('youtube/v3')) {
          calledYouTubeApi = true;
          return new Response('{}', { status: 403 });
        }
        return originalFetch(url, init);
      }) as typeof fetch;

      const callbackReq = makeRequest(`/api/auth/google/callback?code=mock-code-123&state=${state}`, {
        headers: adminHeaders,
      });

      const callbackRes = await googleCallbackRoute.GET(callbackReq);
      assert.strictEqual(callbackRes.status, 307);
      const loc = callbackRes.headers.get('location') || '';
      assert.ok(loc.includes('success=google_drive_connected'), `Redirect must indicate drive connected: ${loc}`);
      assert.ok(calledUserinfoApi, 'Must fetch userinfo');
      assert.strictEqual(calledYouTubeApi, false, 'Must NOT make any calls to YouTube API during Drive auth');

      // Verify Drive service credentials saved in repository
      const driveCreds = await Repository.getGoogleServiceCredentials('drive');
      assert.ok(driveCreds, 'Drive credentials must be saved');
      assert.strictEqual(driveCreds.email, 'operator-drive@example.com');
      assert.strictEqual(decryptToken(driveCreds.encryptedAccessToken), 'mock-drive-access-token-123');
    });

    await test('Drive OAuth callback without drive.file fails closed with drive_scope_not_granted and is NOT marked connected', async () => {
      // Clear drive credentials first to test clean state
      await Repository.clearGoogleServiceCredentials('drive');

      const state = 'valid-drive-missing-scope-state-123456';
      await Repository.saveOAuthState(state, `${TEST_ORIGIN}/api/auth/google/callback`, 60000, 'google_drive');

      const admin = makeAuthenticatedAdminSession();
      const signedCookie = signOAuthStateCookieValue(state, admin.jti);
      const adminHeaders = {
        ...admin.headers,
        cookie: `${admin.headers.cookie}; ${OAUTH_STATE_COOKIE_NAME}=${signedCookie}`,
      };

      globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
        const urlStr = url.toString();
        if (urlStr.includes('oauth2.googleapis.com/token')) {
          return new Response(
            JSON.stringify({
              access_token: 'mock-drive-no-scope-token',
              refresh_token: 'mock-drive-no-scope-refresh',
              expires_in: 3600,
              token_type: 'Bearer',
              scope: 'https://www.googleapis.com/auth/userinfo.profile https://www.googleapis.com/auth/userinfo.email openid',
            }),
            { status: 200, headers: { 'Content-Type': 'application/json' } }
          );
        }
        if (urlStr.includes('googleapis.com/oauth2/v2/userinfo')) {
          return new Response(
            JSON.stringify({
              id: 'google-user-id-drive-no-scope',
              email: 'operator-no-scope@example.com',
              name: 'No Scope Operator',
            }),
            { status: 200, headers: { 'Content-Type': 'application/json' } }
          );
        }
        return originalFetch(url, init);
      }) as typeof fetch;

      const callbackReq = makeRequest(`/api/auth/google/callback?code=mock-code-no-scope&state=${state}`, {
        headers: adminHeaders,
      });

      const callbackRes = await googleCallbackRoute.GET(callbackReq);
      assert.strictEqual(callbackRes.status, 307);
      const loc = callbackRes.headers.get('location') || '';
      assert.ok(loc.includes('error=drive_scope_not_granted'), `Redirect must indicate drive scope not granted: ${loc}`);
      assert.ok(
        loc.includes('account=operator-no-scope%40example.com') || loc.includes('account=operator-no-scope@example.com'),
        `Redirect must contain account: ${loc}`
      );

      // Verify Drive is NOT connected in integrations
      const integrations = await Repository.getIntegrations();
      assert.strictEqual(integrations.google_drive.connected, false, 'Drive must NOT be marked connected');
      assert.strictEqual(integrations.google_drive.scope_missing, true, 'scope_missing must be true');
      assert.strictEqual(integrations.google_drive.status, 'scope_missing', 'status must be scope_missing');
      assert.strictEqual(await isDriveConnected(), false, 'isDriveConnected must return false');
    });

    await test('Existing valid Drive credential is preserved when fresh callback lacks drive.file', async () => {
      // Seed an existing valid Drive credential
      await saveGoogleServiceCredentials(
        'drive',
        {
          access_token: 'existing-valid-drive-token',
          refresh_token: 'existing-valid-drive-refresh',
          expires_in: 3600,
          token_type: 'Bearer',
          scope: 'https://www.googleapis.com/auth/drive.file https://www.googleapis.com/auth/userinfo.email openid',
        },
        { email: 'existing-valid@example.com' }
      );
      assert.strictEqual(await isDriveConnected(), true);

      const state = 'fresh-drive-lacking-scope-state-789012';
      await Repository.saveOAuthState(state, `${TEST_ORIGIN}/api/auth/google/callback`, 60000, 'google_drive');

      const admin = makeAuthenticatedAdminSession();
      const signedCookie = signOAuthStateCookieValue(state, admin.jti);
      const adminHeaders = {
        ...admin.headers,
        cookie: `${admin.headers.cookie}; ${OAUTH_STATE_COOKIE_NAME}=${signedCookie}`,
      };

      globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
        const urlStr = url.toString();
        if (urlStr.includes('oauth2.googleapis.com/token')) {
          return new Response(
            JSON.stringify({
              access_token: 'untrusted-drive-token-without-file-scope',
              refresh_token: 'untrusted-refresh-token',
              expires_in: 3600,
              token_type: 'Bearer',
              scope: 'https://www.googleapis.com/auth/userinfo.profile https://www.googleapis.com/auth/userinfo.email openid',
            }),
            { status: 200, headers: { 'Content-Type': 'application/json' } }
          );
        }
        if (urlStr.includes('googleapis.com/oauth2/v2/userinfo')) {
          return new Response(
            JSON.stringify({
              id: 'google-user-id-drive-fresh',
              email: 'new-account-no-scope@example.com',
            }),
            { status: 200, headers: { 'Content-Type': 'application/json' } }
          );
        }
        return originalFetch(url, init);
      }) as typeof fetch;

      const callbackReq = makeRequest(`/api/auth/google/callback?code=mock-code-incomplete&state=${state}`, {
        headers: adminHeaders,
      });

      const callbackRes = await googleCallbackRoute.GET(callbackReq);
      assert.strictEqual(callbackRes.status, 307);
      const loc = callbackRes.headers.get('location') || '';
      assert.ok(loc.includes('error=drive_scope_not_granted'), `Redirect must warn about missing drive scope: ${loc}`);

      // Verify EXISTING valid Drive credentials remain intact in repository
      const driveCreds = await Repository.getGoogleServiceCredentials('drive');
      assert.ok(driveCreds, 'Existing valid Drive credential must be preserved');
      assert.strictEqual(driveCreds.email, 'existing-valid@example.com');
      assert.strictEqual(decryptToken(driveCreds.encryptedAccessToken), 'existing-valid-drive-token');
      assert.strictEqual(await isDriveConnected(), true, 'Drive must remain connected via preserved credentials');
    });

    await test('YouTube credentials and connection remain untouched during Drive callback rejection', async () => {
      // Seed a valid YouTube credential
      await saveGoogleServiceCredentials(
        'youtube',
        {
          access_token: 'isolated-youtube-token-test',
          refresh_token: 'isolated-youtube-refresh-test',
          expires_in: 3600,
          token_type: 'Bearer',
          scope: 'https://www.googleapis.com/auth/youtube.upload https://www.googleapis.com/auth/youtube.readonly',
        },
        {
          email: 'creator-isolated@example.com',
          channelId: 'UC_ISOLATED_CHANNEL',
          channelTitle: 'Isolated Creator Channel',
        }
      );
      assert.strictEqual(await isYouTubeConnected(), true);

      // Execute a failing Drive callback (missing drive.file scope)
      const state = 'drive-callback-isolated-yt-test';
      await Repository.saveOAuthState(state, `${TEST_ORIGIN}/api/auth/google/callback`, 60000, 'google_drive');

      const admin = makeAuthenticatedAdminSession();
      const signedCookie = signOAuthStateCookieValue(state, admin.jti);
      const adminHeaders = {
        ...admin.headers,
        cookie: `${admin.headers.cookie}; ${OAUTH_STATE_COOKIE_NAME}=${signedCookie}`,
      };

      globalThis.fetch = (async (url: string | URL | Request) => {
        const urlStr = url.toString();
        if (urlStr.includes('oauth2.googleapis.com/token')) {
          return new Response(
            JSON.stringify({
              access_token: 'failing-drive-token',
              expires_in: 3600,
              token_type: 'Bearer',
              scope: 'openid email profile',
            }),
            { status: 200, headers: { 'Content-Type': 'application/json' } }
          );
        }
        if (urlStr.includes('googleapis.com/oauth2/v2/userinfo')) {
          return new Response(
            JSON.stringify({
              id: 'google-user-drive-fail',
              email: 'failing-drive@example.com',
            }),
            { status: 200, headers: { 'Content-Type': 'application/json' } }
          );
        }
        return new Response('Not found', { status: 404 });
      }) as typeof fetch;

      const callbackReq = makeRequest(`/api/auth/google/callback?code=mock-code-fail-drive&state=${state}`, {
        headers: adminHeaders,
      });

      const callbackRes = await googleCallbackRoute.GET(callbackReq);
      assert.strictEqual(callbackRes.status, 307);

      // Verify YouTube credentials are completely intact and untouched
      const ytCreds = await Repository.getGoogleServiceCredentials('youtube');
      assert.ok(ytCreds, 'YouTube credentials must still exist');
      assert.strictEqual(ytCreds.channelId, 'UC_ISOLATED_CHANNEL');
      assert.strictEqual(ytCreds.channelTitle, 'Isolated Creator Channel');
      assert.strictEqual(ytCreds.email, 'creator-isolated@example.com');
      assert.strictEqual(decryptToken(ytCreds.encryptedAccessToken), 'isolated-youtube-token-test');
      assert.strictEqual(await isYouTubeConnected(), true, 'YouTube must remain connected');
    });

    await test('YouTube OAuth callback without channel fails closed with warning', async () => {
      const state = 'valid-yt-nochan-state-1234567890abcdef';
      await Repository.saveOAuthState(state, `${TEST_ORIGIN}/api/auth/google/callback`, 60000, 'google_youtube');

      const admin = makeAuthenticatedAdminSession();
      const signedCookie = signOAuthStateCookieValue(state, admin.jti);
      const adminHeaders = {
        ...admin.headers,
        cookie: `${admin.headers.cookie}; ${OAUTH_STATE_COOKIE_NAME}=${signedCookie}`,
      };

      globalThis.fetch = (async (url: string | URL | Request) => {
        const urlStr = url.toString();
        if (urlStr.includes('oauth2.googleapis.com/token')) {
          return new Response(
            JSON.stringify({
              access_token: 'mock-yt-access-token-nochan',
              refresh_token: 'mock-yt-refresh-token-nochan',
              expires_in: 3600,
              token_type: 'Bearer',
            }),
            { status: 200, headers: { 'Content-Type': 'application/json' } }
          );
        }
        if (urlStr.includes('googleapis.com/oauth2/v2/userinfo')) {
          return new Response(
            JSON.stringify({
              id: 'google-user-id-yt-nochan',
              email: 'operator-nochannel@example.com',
            }),
            { status: 200, headers: { 'Content-Type': 'application/json' } }
          );
        }
        // YouTube channels list returns empty items (no YouTube channel on this Google account)
        if (urlStr.includes('youtube/v3/channels')) {
          return new Response(
            JSON.stringify({
              kind: 'youtube#channelListResponse',
              items: [],
            }),
            { status: 200, headers: { 'Content-Type': 'application/json' } }
          );
        }
        return new Response('Not found', { status: 404 });
      }) as typeof fetch;

      const callbackReq = makeRequest(`/api/auth/google/callback?code=mock-code-nochan&state=${state}`, {
        headers: adminHeaders,
      });

      const callbackRes = await googleCallbackRoute.GET(callbackReq);
      assert.strictEqual(callbackRes.status, 307);
      const loc = callbackRes.headers.get('location') || '';
      assert.ok(loc.includes('warning=youtube_channel_not_found'), `Redirect must warn about missing channel: ${loc}`);

      // Verify YouTube is NOT marked connected in integrations
      const integrations = await Repository.getIntegrations();
      assert.strictEqual(integrations.youtube.connected, false, 'YouTube must NOT be marked connected without a channel');
      assert.strictEqual(await isYouTubeConnected(), false);
    });

    await test('YouTube OAuth callback with channel saves channelId & title and connects successfully', async () => {
      const state = 'valid-yt-channel-state-1234567890abcdef';
      await Repository.saveOAuthState(state, `${TEST_ORIGIN}/api/auth/google/callback`, 60000, 'google_youtube');

      const admin = makeAuthenticatedAdminSession();
      const signedCookie = signOAuthStateCookieValue(state, admin.jti);
      const adminHeaders = {
        ...admin.headers,
        cookie: `${admin.headers.cookie}; ${OAUTH_STATE_COOKIE_NAME}=${signedCookie}`,
      };

      globalThis.fetch = (async (url: string | URL | Request) => {
        const urlStr = url.toString();
        if (urlStr.includes('oauth2.googleapis.com/token')) {
          return new Response(
            JSON.stringify({
              access_token: 'mock-yt-access-token-valid',
              refresh_token: 'mock-yt-refresh-token-valid',
              expires_in: 3600,
              token_type: 'Bearer',
            }),
            { status: 200, headers: { 'Content-Type': 'application/json' } }
          );
        }
        if (urlStr.includes('googleapis.com/oauth2/v2/userinfo')) {
          return new Response(
            JSON.stringify({
              id: 'google-user-id-yt-valid',
              email: 'creator@example.com',
            }),
            { status: 200, headers: { 'Content-Type': 'application/json' } }
          );
        }
        if (urlStr.includes('youtube/v3/channels')) {
          return new Response(
            JSON.stringify({
              kind: 'youtube#channelListResponse',
              items: [
                {
                  id: 'UC_TEST_CHANNEL_12345',
                  snippet: {
                    title: 'AutoShorts Official Creator Channel',
                  },
                },
              ],
            }),
            { status: 200, headers: { 'Content-Type': 'application/json' } }
          );
        }
        return new Response('Not found', { status: 404 });
      }) as typeof fetch;

      const callbackReq = makeRequest(`/api/auth/google/callback?code=mock-code-valid&state=${state}`, {
        headers: adminHeaders,
      });

      const callbackRes = await googleCallbackRoute.GET(callbackReq);
      assert.strictEqual(callbackRes.status, 307);
      const loc = callbackRes.headers.get('location') || '';
      assert.ok(loc.includes('success=youtube_connected'), `Redirect must indicate youtube connected: ${loc}`);

      // Verify YouTube service credentials saved in repository
      const ytCreds = await Repository.getGoogleServiceCredentials('youtube');
      assert.ok(ytCreds, 'YouTube credentials must be saved');
      assert.strictEqual(ytCreds.channelId, 'UC_TEST_CHANNEL_12345');
      assert.strictEqual(ytCreds.channelTitle, 'AutoShorts Official Creator Channel');
      assert.strictEqual(decryptToken(ytCreds.encryptedAccessToken), 'mock-yt-access-token-valid');

      // Verify integration status reflects both services connected
      const integrations = await Repository.getIntegrations();
      assert.strictEqual(integrations.google_drive.connected, true);
      assert.strictEqual(integrations.youtube.connected, true);
      assert.strictEqual(integrations.youtube.channel_title, 'AutoShorts Official Creator Channel');
      assert.strictEqual(integrations.youtube.channel_id, 'UC_TEST_CHANNEL_12345');
    });

    // -------------------------------------------------------------------------
    console.log('\n--- Suite 4: Independent Token Getters & Fail-Closed Behavior ---');
    // -------------------------------------------------------------------------

    await test('getValidDriveAccessToken and getValidYouTubeAccessToken return isolated tokens', async () => {
      // Both are currently connected from previous tests
      const driveToken = await getValidDriveAccessToken();
      const ytToken = await getValidYouTubeAccessToken();

      assert.strictEqual(driveToken, 'existing-valid-drive-token');
      assert.strictEqual(ytToken, 'mock-yt-access-token-valid');
      assert.notStrictEqual(driveToken, ytToken, 'Drive and YouTube tokens must never be interchangeable');
    });

    await test('Disconnecting Drive does NOT disconnect or affect YouTube credentials', async () => {
      const adminDrive = makeAuthenticatedAdminSession();
      const res = await driveDisconnectRoute.POST(
        makeRequest('/api/auth/google/drive/disconnect', {
          method: 'POST',
          headers: adminDrive.headers,
        })
      );
      assert.strictEqual(res.status, 200);

      // Verify Drive is disconnected
      assert.strictEqual(await isDriveConnected(), false);
      const driveCreds = await Repository.getGoogleServiceCredentials('drive');
      assert.strictEqual(driveCreds, null);

      // Verify YouTube remains fully connected!
      assert.strictEqual(await isYouTubeConnected(), true);
      const ytCreds = await Repository.getGoogleServiceCredentials('youtube');
      assert.ok(ytCreds);
      assert.strictEqual(ytCreds.channelId, 'UC_TEST_CHANNEL_12345');
      const ytToken = await getValidYouTubeAccessToken();
      assert.strictEqual(ytToken, 'mock-yt-access-token-valid');

      // Verify getValidDriveAccessToken throws fail-closed error
      await assert.rejects(
        async () => {
          await getValidDriveAccessToken();
        },
        /Google Drive.*not connected/,
        'Must fail-closed when Drive is disconnected'
      );
    });

    await test('Disconnecting YouTube does NOT affect Drive credentials', async () => {
      // Re-connect Drive first
      await saveGoogleServiceCredentials(
        'drive',
        {
          access_token: 'reconnected-drive-access-token',
          refresh_token: 'reconnected-drive-refresh-token',
          expires_in: 3600,
          token_type: 'Bearer',
          scope: 'https://www.googleapis.com/auth/drive.file',
        },
        { email: 'reconnected@example.com' }
      );
      assert.strictEqual(await isDriveConnected(), true);

      // Now disconnect YouTube via route
      const adminYt = makeAuthenticatedAdminSession();
      const res = await ytDisconnectRoute.POST(
        makeRequest('/api/auth/google/youtube/disconnect', {
          method: 'POST',
          headers: adminYt.headers,
        })
      );
      assert.strictEqual(res.status, 200);

      // Verify YouTube is disconnected
      assert.strictEqual(await isYouTubeConnected(), false);
      const ytCreds = await Repository.getGoogleServiceCredentials('youtube');
      assert.strictEqual(ytCreds, null);

      // Verify Drive remains fully connected!
      assert.strictEqual(await isDriveConnected(), true);
      const driveCreds = await Repository.getGoogleServiceCredentials('drive');
      assert.ok(driveCreds);
      assert.strictEqual(driveCreds.email, 'reconnected@example.com');
      const driveToken = await getValidDriveAccessToken();
      assert.strictEqual(driveToken, 'reconnected-drive-access-token');

      // Verify getValidYouTubeAccessToken throws fail-closed error
      await assert.rejects(
        async () => {
          await getValidYouTubeAccessToken();
        },
        /YouTube.*not connected/,
        'Must fail-closed when YouTube is disconnected'
      );
    });

    // -------------------------------------------------------------------------
    console.log('\n--- Suite 5: 4-State Execution Readiness Matrix ---');
    // -------------------------------------------------------------------------

    await test('Execution readiness correctly handles all 4 integration states', async () => {
      // Setup monitored profile and valid automation settings
      const profiles = await Repository.getMonitoredProfiles();
      if (profiles.length === 0) {
        await Repository.addMonitoredProfile('https://instagram.com/test_creator', 'Test Creator');
      }
      await Repository.updateAutomationSettings({
        is_enabled: true,
        polling_interval_minutes: 30,
        max_uploads_per_day: 10,
        drive_folder_name: 'AutoShorts Backup',
        default_visibility: 'private',
      });

      // State 1: Disconnect both Drive and YouTube
      await Repository.clearGoogleServiceCredentials('drive');
      await Repository.clearGoogleServiceCredentials('youtube');
      await Repository.clearGoogleCredentials();

      const stateNeither = await Repository.evaluateExecutionReadiness();
      assert.strictEqual(stateNeither.ready_for_live_upload, false);
      assert.strictEqual(stateNeither.google_drive_connected, false);
      assert.strictEqual(stateNeither.youtube_connected, false);
      assert.ok(
        stateNeither.blocking_reasons.some((r) => r.includes('Google Drive OAuth integration is not connected')),
        'Must block on Drive'
      );
      assert.ok(
        stateNeither.blocking_reasons.some((r) => r.includes('YouTube channel OAuth integration is not connected')),
        'Must block on YouTube'
      );

      // State 2: Drive ONLY connected
      await saveGoogleServiceCredentials(
        'drive',
        {
          access_token: 'drive-only-token',
          refresh_token: 'drive-only-refresh',
          expires_in: 3600,
          token_type: 'Bearer',
          scope: 'https://www.googleapis.com/auth/drive.file',
        },
        { email: 'drive-only@example.com' }
      );
      const stateDriveOnly = await Repository.evaluateExecutionReadiness();
      assert.strictEqual(stateDriveOnly.ready_for_live_upload, false);
      assert.strictEqual(stateDriveOnly.google_drive_connected, true);
      assert.strictEqual(stateDriveOnly.youtube_connected, false);
      assert.ok(
        stateDriveOnly.blocking_reasons.some((r) => r.includes('YouTube channel OAuth integration is not connected')),
        'Must block on missing YouTube channel'
      );
      assert.ok(
        !stateDriveOnly.blocking_reasons.some((r) => r.includes('Google Drive OAuth integration is not connected')),
        'Must not block on Drive'
      );

      // State 3: YouTube ONLY connected
      await Repository.clearGoogleServiceCredentials('drive');
      await saveGoogleServiceCredentials(
        'youtube',
        {
          access_token: 'yt-only-token',
          refresh_token: 'yt-only-refresh',
          expires_in: 3600,
          token_type: 'Bearer',
        },
        {
          email: 'yt-only@example.com',
          channelId: 'UC_YT_ONLY',
          channelTitle: 'YouTube Only Channel',
        }
      );
      const stateYouTubeOnly = await Repository.evaluateExecutionReadiness();
      assert.strictEqual(stateYouTubeOnly.ready_for_live_upload, false);
      assert.strictEqual(stateYouTubeOnly.google_drive_connected, false);
      assert.strictEqual(stateYouTubeOnly.youtube_connected, true);
      assert.ok(
        stateYouTubeOnly.blocking_reasons.some((r) => r.includes('Google Drive OAuth integration is not connected')),
        'Must block on missing Drive'
      );
      assert.ok(
        !stateYouTubeOnly.blocking_reasons.some((r) => r.includes('YouTube channel OAuth integration is not connected')),
        'Must not block on YouTube'
      );

      // State 4: BOTH connected -> Live Upload Ready!
      await saveGoogleServiceCredentials(
        'drive',
        {
          access_token: 'both-drive-token',
          refresh_token: 'both-drive-refresh',
          expires_in: 3600,
          token_type: 'Bearer',
          scope: 'https://www.googleapis.com/auth/drive.file',
        },
        { email: 'both@example.com' }
      );
      const stateBoth = await Repository.evaluateExecutionReadiness();
      assert.strictEqual(stateBoth.ready_for_live_upload, true, 'Must be ready for live upload when both are connected');
      assert.strictEqual(stateBoth.google_drive_connected, true);
      assert.strictEqual(stateBoth.youtube_connected, true);
      assert.strictEqual(stateBoth.blocking_reasons.length, 0, 'No blocking reasons when fully configured');
    });

    await test('Execution readiness blocks with specific reason when Drive scope is missing', async () => {
      // Save Drive credentials with identity-only scope
      await saveGoogleServiceCredentials(
        'drive',
        {
          access_token: 'drive-no-file-scope-token',
          refresh_token: 'drive-no-file-scope-refresh',
          expires_in: 3600,
          token_type: 'Bearer',
          scope: 'https://www.googleapis.com/auth/userinfo.email openid',
        },
        { email: 'no-file-scope@example.com' }
      );

      const readiness = await Repository.evaluateExecutionReadiness();
      assert.strictEqual(readiness.ready_for_live_upload, false);
      assert.strictEqual(readiness.google_drive_connected, false);
      assert.ok(
        readiness.blocking_reasons.some((r) => r.includes('Google Drive permission (drive.file) not granted')),
        `Must indicate missing drive.file scope in blocking reasons: ${JSON.stringify(readiness.blocking_reasons)}`
      );

      // Restore valid Drive credentials with drive.file scope
      await saveGoogleServiceCredentials(
        'drive',
        {
          access_token: 'both-drive-token',
          refresh_token: 'both-drive-refresh',
          expires_in: 3600,
          token_type: 'Bearer',
          scope: 'https://www.googleapis.com/auth/drive.file',
        },
        { email: 'both@example.com' }
      );
    });

    // -------------------------------------------------------------------------
    console.log('\n--- Suite 6: Health Endpoint Isolation Reporting ---');
    // -------------------------------------------------------------------------

    await test('Health API reports both googleDriveTokensAvailable and youtubeTokensAvailable', async () => {
      const res = await healthRoute.GET();
      assert.strictEqual(res.status, 200);
      const data = (await res.json()) as {
        integrations: {
          googleDriveConnected: boolean;
          youtubeConnected: boolean;
          googleDriveTokensAvailable: boolean;
          youtubeTokensAvailable: boolean;
          googleOAuthTokensAvailable: boolean;
        };
      };

      assert.strictEqual(data.integrations.googleDriveConnected, true);
      assert.strictEqual(data.integrations.youtubeConnected, true);
      assert.strictEqual(data.integrations.googleDriveTokensAvailable, true);
      assert.strictEqual(data.integrations.youtubeTokensAvailable, true);
      assert.strictEqual(data.integrations.googleOAuthTokensAvailable, true);
    });

    console.log('\n================================================================');
    console.log(`ALL PHASE 9.7 TESTS PASSED (${passedTests}/${totalTests})`);
    console.log('================================================================\n');
  } finally {
    globalThis.fetch = originalFetch;
    process.env = envBackup;
  }
}

runPhase97SeparateOAuthTests().catch((err) => {
  console.error('\nTest runner failed:', err);
  process.exit(1);
});
