/**
 * AUTOSHORTS PHASE 9.1 - PRODUCTION SECURITY HARDENING TEST SUITE
 *
 * Verifies:
 * 1. Unauthorized HTTP access fails closed across all protected admin & n8n routes
 * 2. Production mode fails closed when ADMIN_ACCESS_KEY / ADMIN_SESSION_SECRET / N8N_WEBHOOK_SECRET are absent
 * 3. Operator session sign-in, proxy routing gate, CSRF origin + token verification, and logout
 * 4. Google OAuth authorize/callback CSRF state, session binding, single-use replay defense, and UI feedback
 * 5. OAuth token refresh strictly throws on failure (never returning expired tokens), respects expires_in,
 *    preserves existing encrypted refresh tokens when omitted, and persists rotated refresh tokens
 * 6. Upstream Google token revocation on disconnect and zero credential/URI leakage in API JSON payloads
 */

import assert from 'node:assert';
import { NextRequest } from 'next/server';

import {
  CSRF_COOKIE_NAME,
  OAUTH_STATE_COOKIE_NAME,
  SESSION_COOKIE_NAME,
  createSessionToken,
} from '../src/lib/auth';
import { encryptToken, decryptToken } from '../src/lib/crypto';
import { sanitizeNextPath, submitOperatorLogin } from '../src/lib/clientAuthFetch';
import { resolveOAuthBannerFeedback } from '../src/lib/oauthFeedback';
import { sanitizeErrorMessage } from '../src/lib/security';
import { proxy } from '../src/proxy';
import { Repository } from '../src/server/db/repository';
import {
  disconnectGoogle,
  getValidAccessToken,
  isDriveConnected,
  isYouTubeConnected,
} from '../src/server/services/googleAuthService';

import * as sessionRoute from '../src/app/api/auth/session/route';
import * as googleAuthorizeRoute from '../src/app/api/auth/google/authorize/route';
import * as googleCallbackRoute from '../src/app/api/auth/google/callback/route';
import * as googleDisconnectRoute from '../src/app/api/auth/google/disconnect/route';
import * as igAuthorizeRoute from '../src/app/api/auth/instagram/authorize/route';
import * as igCallbackRoute from '../src/app/api/auth/instagram/callback/route';
import * as healthRoute from '../src/app/api/health/route';
import * as settingsRoute from '../src/app/api/settings/route';
import * as dashboardRoute from '../src/app/api/dashboard/route';
import * as automationRoute from '../src/app/api/automation/route';
import * as syncNowRoute from '../src/app/api/automation/sync-now/route';
import * as demoResetRoute from '../src/app/api/demo/reset/route';
import * as profilesRoute from '../src/app/api/profiles/route';
import * as profileByIdRoute from '../src/app/api/profiles/[id]/route';
import * as profileActivateRoute from '../src/app/api/profiles/[id]/activate/route';
import * as profileCheckRoute from '../src/app/api/profiles/[id]/check/route';
import * as profilePauseRoute from '../src/app/api/profiles/[id]/pause/route';
import * as profileResumeRoute from '../src/app/api/profiles/[id]/resume/route';
import * as accountsRoute from '../src/app/api/accounts/route';
import * as accountByIdRoute from '../src/app/api/accounts/[id]/route';
import * as accountActivateRoute from '../src/app/api/accounts/[id]/activate/route';
import * as accountDisconnectRoute from '../src/app/api/accounts/[id]/disconnect/route';
import * as accountReconnectRoute from '../src/app/api/accounts/[id]/reconnect/route';
import * as reelsRoute from '../src/app/api/reels/route';
import * as reelsSubmitRoute from '../src/app/api/reels/submit/route';
import * as uploadsRoute from '../src/app/api/uploads/route';
import * as uploadRetryRoute from '../src/app/api/uploads/[id]/retry/route';
import * as n8nActiveRoute from '../src/app/api/n8n/active-account/route';
import * as n8nLockRoute from '../src/app/api/n8n/lock/route';
import * as n8nUnlockRoute from '../src/app/api/n8n/unlock/route';
import * as n8nUploadStatusRoute from '../src/app/api/n8n/upload-status/route';

const TEST_ORIGIN = 'https://autoshorts.example';

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

function makeCookieMapFromSetCookie(setCookies: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const header of setCookies) {
    const firstPart = header.split(';')[0];
    const eq = firstPart.indexOf('=');
    if (eq > 0) {
      out[firstPart.slice(0, eq).trim()] = decodeURIComponent(firstPart.slice(eq + 1).trim());
    }
  }
  return out;
}

function getSetCookieHeaders(response: Response): string[] {
  const headersAny = response.headers as unknown as { getSetCookie?: () => string[] };
  if (typeof headersAny.getSetCookie === 'function') {
    return headersAny.getSetCookie();
  }
  const single = response.headers.get('set-cookie');
  return single ? [single] : [];
}

async function runPhase91SecurityTests() {
  console.log('================================================================');
  console.log('AUTOSHORTS PHASE 9.1 - SECURITY HARDENING VERIFICATION');
  console.log('================================================================\n');

  const envBackup = { ...process.env };
  const originalFetch = globalThis.fetch;

  const restoreEnv = () => {
    for (const k of Object.keys(process.env)) {
      if (!(k in envBackup)) {
        delete process.env[k];
      }
    }
    Object.assign(process.env, envBackup);
  };

  try {
    (process.env as Record<string, string | undefined>).NODE_ENV = 'test';
    process.env.TOKEN_ENCRYPTION_KEY =
      'a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8f90';
    process.env.ADMIN_ACCESS_KEY = 'phase91-operator-secret-key';
    process.env.ADMIN_SESSION_SECRET = 'phase91-session-signing-secret-key-256bit';
    process.env.N8N_WEBHOOK_SECRET = 'phase91-n8n-webhook-secret';
    process.env.GOOGLE_CLIENT_ID = 'test-client-id.apps.googleusercontent.com';
    process.env.GOOGLE_CLIENT_SECRET = 'test-client-secret-value';
    process.env.NEXT_PUBLIC_APP_URL = TEST_ORIGIN;

    Repository.resetDemo();

    // ---------------------------------------------------------------
    // 1. Unauthenticated requests MUST fail closed (HTTP 401)
    // ---------------------------------------------------------------
    console.log('[1/6] Verifying all protected API routes reject unauthenticated requests...');
    const dummyParams = { params: Promise.resolve({ id: 'prof_1' }) };

    const protectedCalls: Array<[string, () => Promise<Response>]> = [
      ['GET /api/auth/google/authorize', () => googleAuthorizeRoute.GET(makeRequest('/api/auth/google/authorize'))],
      ['POST /api/auth/google/disconnect', () => googleDisconnectRoute.POST(makeRequest('/api/auth/google/disconnect', { method: 'POST' }))],
      ['GET /api/auth/instagram/authorize', () => igAuthorizeRoute.GET(makeRequest('/api/auth/instagram/authorize'))],
      ['GET /api/auth/instagram/callback', () => igCallbackRoute.GET(makeRequest('/api/auth/instagram/callback?code=x&state=y'))],
      ['GET /api/settings', () => settingsRoute.GET(makeRequest('/api/settings'))],
      ['POST /api/settings', () => settingsRoute.POST(makeRequest('/api/settings', { method: 'POST', body: {} }))],
      ['GET /api/dashboard', () => dashboardRoute.GET(makeRequest('/api/dashboard'))],
      ['GET /api/automation', () => automationRoute.GET(makeRequest('/api/automation'))],
      ['POST /api/automation', () => automationRoute.POST(makeRequest('/api/automation', { method: 'POST', body: {} }))],
      ['POST /api/automation/sync-now', () => syncNowRoute.POST(makeRequest('/api/automation/sync-now', { method: 'POST' }))],
      ['POST /api/demo/reset', () => demoResetRoute.POST(makeRequest('/api/demo/reset', { method: 'POST' }))],
      ['GET /api/profiles', () => profilesRoute.GET(makeRequest('/api/profiles'))],
      ['POST /api/profiles', () => profilesRoute.POST(makeRequest('/api/profiles', { method: 'POST', body: {} }))],
      ['GET /api/profiles/[id]', () => profileByIdRoute.GET(makeRequest('/api/profiles/prof_1'), dummyParams)],
      ['PATCH /api/profiles/[id]', () => profileByIdRoute.PATCH(makeRequest('/api/profiles/prof_1', { method: 'PATCH', body: {} }), dummyParams)],
      ['DELETE /api/profiles/[id]', () => profileByIdRoute.DELETE(makeRequest('/api/profiles/prof_1', { method: 'DELETE' }), dummyParams)],
      ['POST /api/profiles/[id]/activate', () => profileActivateRoute.POST(makeRequest('/api/profiles/prof_1/activate', { method: 'POST' }), dummyParams)],
      ['POST /api/profiles/[id]/check', () => profileCheckRoute.POST(makeRequest('/api/profiles/prof_1/check', { method: 'POST' }), dummyParams)],
      ['POST /api/profiles/[id]/pause', () => profilePauseRoute.POST(makeRequest('/api/profiles/prof_1/pause', { method: 'POST' }), dummyParams)],
      ['POST /api/profiles/[id]/resume', () => profileResumeRoute.POST(makeRequest('/api/profiles/prof_1/resume', { method: 'POST' }), dummyParams)],
      ['GET /api/accounts', () => accountsRoute.GET(makeRequest('/api/accounts'))],
      ['POST /api/accounts', () => accountsRoute.POST(makeRequest('/api/accounts', { method: 'POST', body: {} }))],
      ['GET /api/accounts/[id]', () => accountByIdRoute.GET(makeRequest('/api/accounts/acc_1'), dummyParams)],
      ['DELETE /api/accounts/[id]', () => accountByIdRoute.DELETE(makeRequest('/api/accounts/acc_1', { method: 'DELETE' }), dummyParams)],
      ['POST /api/accounts/[id]/activate', () => accountActivateRoute.POST(makeRequest('/api/accounts/acc_1/activate', { method: 'POST' }), dummyParams)],
      ['POST /api/accounts/[id]/disconnect', () => accountDisconnectRoute.POST(makeRequest('/api/accounts/acc_1/disconnect', { method: 'POST' }), dummyParams)],
      ['POST /api/accounts/[id]/reconnect', () => accountReconnectRoute.POST(makeRequest('/api/accounts/acc_1/reconnect', { method: 'POST' }), dummyParams)],
      ['GET /api/reels', () => reelsRoute.GET(makeRequest('/api/reels'))],
      ['POST /api/reels/submit', () => reelsSubmitRoute.POST(makeRequest('/api/reels/submit', { method: 'POST', body: {} }))],
      ['GET /api/uploads', () => uploadsRoute.GET(makeRequest('/api/uploads'))],
      ['POST /api/uploads', () => uploadsRoute.POST(makeRequest('/api/uploads', { method: 'POST', body: {} }))],
      ['POST /api/uploads/[id]/retry', () => uploadRetryRoute.POST(makeRequest('/api/uploads/job_1/retry', { method: 'POST' }), dummyParams)],
      ['GET /api/n8n/active-account', () => n8nActiveRoute.GET(makeRequest('/api/n8n/active-account'))],
      ['POST /api/n8n/lock', () => n8nLockRoute.POST(makeRequest('/api/n8n/lock', { method: 'POST' }))],
      ['POST /api/n8n/unlock', () => n8nUnlockRoute.POST(makeRequest('/api/n8n/unlock', { method: 'POST' }))],
      ['POST /api/n8n/upload-status', () => n8nUploadStatusRoute.POST(makeRequest('/api/n8n/upload-status', { method: 'POST', body: {} }))],
    ];

    for (const [label, fn] of protectedCalls) {
      const res = await fn();
      assert.strictEqual(res.status, 401, `${label} must return 401 when unauthenticated, got ${res.status}`);
    }

    // Also verify /api/n8n/active-account stays closed even when N8N_WEBHOOK_SECRET is unset
    delete process.env.N8N_WEBHOOK_SECRET;
    const n8nNoSecretRes = await n8nActiveRoute.GET(makeRequest('/api/n8n/active-account'));
    assert.strictEqual(n8nNoSecretRes.status, 401);
    process.env.N8N_WEBHOOK_SECRET = 'phase91-n8n-webhook-secret';
    console.log(`✓ All ${protectedCalls.length} protected route handlers blocked unauthenticated access (401).`);

    // ---------------------------------------------------------------
    // 2. Production Fail-Closed When Auth Secrets Are Missing (HTTP 503)
    // ---------------------------------------------------------------
    console.log('[2/6] Verifying fail-closed behavior in production without configured secrets...');
    const savedAccessKey = process.env.ADMIN_ACCESS_KEY;
    const savedSessionSecret = process.env.ADMIN_SESSION_SECRET;
    const savedWebhookSecret = process.env.N8N_WEBHOOK_SECRET;
    (process.env as Record<string, string | undefined>).NODE_ENV = 'production';
    delete process.env.ADMIN_ACCESS_KEY;
    delete process.env.ADMIN_SESSION_SECRET;
    delete process.env.N8N_WEBHOOK_SECRET;

    for (const res of [
      await settingsRoute.GET(makeRequest('/api/settings')),
      await syncNowRoute.POST(makeRequest('/api/automation/sync-now', { method: 'POST' })),
      await googleDisconnectRoute.POST(makeRequest('/api/auth/google/disconnect', { method: 'POST' })),
      await uploadsRoute.GET(makeRequest('/api/uploads')),
      await n8nActiveRoute.GET(makeRequest('/api/n8n/active-account')),
      await n8nLockRoute.POST(makeRequest('/api/n8n/lock', { method: 'POST' })),
      await sessionRoute.POST(makeRequest('/api/auth/session', { method: 'POST', body: { accessKey: 'anything' } })),
    ]) {
      assert.strictEqual(res.status, 503, `Expected 503 fail-closed in production, got ${res.status}`);
    }

    const callbackUnconfiguredRes = await googleCallbackRoute.GET(
      makeRequest('/api/auth/google/callback?code=abc&state=xyz')
    );
    assert.strictEqual(callbackUnconfiguredRes.status, 307);
    assert.ok(
      callbackUnconfiguredRes.headers.get('location')?.includes('error=auth_not_configured'),
      'OAuth callback must reject when server auth is not configured'
    );

    process.env.ADMIN_ACCESS_KEY = savedAccessKey;
    process.env.ADMIN_SESSION_SECRET = savedSessionSecret;
    process.env.N8N_WEBHOOK_SECRET = savedWebhookSecret;
    (process.env as Record<string, string | undefined>).NODE_ENV = 'test';
    console.log('✓ Production fail-closed checks returned 503 / safe redirect.');

    // ---------------------------------------------------------------
    // 3. Session Sign-In, Proxy Routing, CSRF Protection, Webhook Bearer, Sign-Out
    // ---------------------------------------------------------------
    console.log('[3/6] Verifying session sign-in, proxy routing, CSRF checks, and n8n bearer auth...');
    const wrongLoginRes = await sessionRoute.POST(
      makeRequest('/api/auth/session', {
        method: 'POST',
        headers: { origin: TEST_ORIGIN },
        body: { accessKey: 'wrong-key' },
      })
    );
    assert.strictEqual(wrongLoginRes.status, 401);

    const loginRes = await sessionRoute.POST(
      makeRequest('/api/auth/session', {
        method: 'POST',
        headers: { origin: TEST_ORIGIN },
        body: { accessKey: 'phase91-operator-secret-key' },
      })
    );
    assert.strictEqual(loginRes.status, 200);
    const loginCookies = makeCookieMapFromSetCookie(getSetCookieHeaders(loginRes));
    const sessionToken = loginCookies[SESSION_COOKIE_NAME];
    const csrfToken = loginCookies[CSRF_COOKIE_NAME];
    assert.ok(sessionToken, 'Sign-in must issue HttpOnly session cookie');
    assert.ok(csrfToken, 'Sign-in must issue CSRF cookie');

    const authCookieHeader = `${SESSION_COOKIE_NAME}=${encodeURIComponent(sessionToken)}; ${CSRF_COOKIE_NAME}=${encodeURIComponent(csrfToken)}`;

    // Proxy redirects unauthenticated page routes to /login, never touches /api/health or /api/auth/google/callback
    const unauthPageRes = proxy(makeRequest('/settings'));
    assert.strictEqual(unauthPageRes.status, 307);
    assert.ok(unauthPageRes.headers.get('location')?.includes('/login'));

    const authPageRes = proxy(
      makeRequest('/settings', { headers: { cookie: authCookieHeader } })
    );
    assert.strictEqual(authPageRes.status, 200);
    assert.strictEqual(proxy(makeRequest('/api/auth/google/callback?code=1&state=2')).status, 200);

    // Tampered session token -> 401
    const tamperedCookie = `${SESSION_COOKIE_NAME}=${encodeURIComponent(sessionToken + 'tamper')}`;
    const tamperedRes = await settingsRoute.GET(
      makeRequest('/api/settings', { headers: { cookie: tamperedCookie } })
    );
    assert.strictEqual(tamperedRes.status, 401);

    // Missing / mismatched CSRF on state-changing routes -> 403
    const missingCsrfRes = await googleDisconnectRoute.POST(
      makeRequest('/api/auth/google/disconnect', {
        method: 'POST',
        headers: { cookie: authCookieHeader, origin: TEST_ORIGIN },
      })
    );
    assert.strictEqual(missingCsrfRes.status, 403);

    const badCsrfRes = await settingsRoute.POST(
      makeRequest('/api/settings', {
        method: 'POST',
        headers: {
          cookie: authCookieHeader,
          origin: TEST_ORIGIN,
          'x-csrf-token': 'forged-token',
        },
        body: { automation: { default_visibility: 'private' } },
      })
    );
    assert.strictEqual(badCsrfRes.status, 403);

    // Cross-origin request even with CSRF header -> 403
    const crossOriginRes = await syncNowRoute.POST(
      makeRequest('/api/automation/sync-now', {
        method: 'POST',
        headers: {
          cookie: authCookieHeader,
          origin: 'https://attacker.example',
          'sec-fetch-site': 'cross-site',
          'x-csrf-token': csrfToken,
        },
      })
    );
    assert.strictEqual(crossOriginRes.status, 403);

    // Valid authenticated GET / POST with CSRF -> 200
    const authSettingsRes = await settingsRoute.GET(
      makeRequest('/api/settings', { headers: { cookie: authCookieHeader } })
    );
    assert.strictEqual(authSettingsRes.status, 200);

    // Demo reset blocked in production even with valid session + CSRF
    (process.env as Record<string, string | undefined>).NODE_ENV = 'production';
    const { token: prodToken, payload: prodPayload } = createSessionToken();
    const prodCookie = `${SESSION_COOKIE_NAME}=${encodeURIComponent(prodToken)}; ${CSRF_COOKIE_NAME}=${encodeURIComponent(prodPayload.csrf)}`;
    const prodDemoReset = await demoResetRoute.POST(
      makeRequest('/api/demo/reset', {
        method: 'POST',
        headers: { cookie: prodCookie, origin: TEST_ORIGIN, 'x-csrf-token': prodPayload.csrf },
      })
    );
    assert.strictEqual(prodDemoReset.status, 403);
    (process.env as Record<string, string | undefined>).NODE_ENV = 'test';

    // n8n Bearer auth validation
    const badBearerRes = await n8nLockRoute.POST(
      makeRequest('/api/n8n/lock', {
        method: 'POST',
        headers: { authorization: 'Bearer wrong-secret' },
      })
    );
    assert.strictEqual(badBearerRes.status, 401);

    const okBearerLockRes = await n8nLockRoute.POST(
      makeRequest('/api/n8n/lock', {
        method: 'POST',
        headers: { authorization: 'Bearer phase91-n8n-webhook-secret' },
      })
    );
    assert.strictEqual(okBearerLockRes.status, 200);
    const okBearerUnlockRes = await n8nUnlockRoute.POST(
      makeRequest('/api/n8n/unlock', {
        method: 'POST',
        headers: { authorization: 'Bearer phase91-n8n-webhook-secret' },
      })
    );
    assert.strictEqual(okBearerUnlockRes.status, 200);

    // Sign-out clears session cookies cleanly
    const logoutRes = await sessionRoute.DELETE(
      makeRequest('/api/auth/session', {
        method: 'DELETE',
        headers: { cookie: authCookieHeader, origin: TEST_ORIGIN, 'x-csrf-token': csrfToken },
      })
    );
    assert.strictEqual(logoutRes.status, 200);
    assert.ok(getSetCookieHeaders(logoutRes).some((c) => c.includes('Max-Age=0')));
    console.log('✓ Session login/logout, proxy gating, CSRF defense, and n8n Bearer auth verified.');

    // ---------------------------------------------------------------
    // 4. Google OAuth Authorize / Callback CSRF, Replay & UX Feedback
    // ---------------------------------------------------------------
    console.log('[4/6] Verifying Google OAuth CSRF state, replay defense, and UI feedback banners...');
    const authInitRes = await googleAuthorizeRoute.GET(
      makeRequest('/api/auth/google/authorize', { headers: { cookie: authCookieHeader } })
    );
    assert.strictEqual(authInitRes.status, 307);
    const googleAuthLocation = authInitRes.headers.get('location');
    assert.ok(googleAuthLocation?.startsWith('https://accounts.google.com/o/oauth2/v2/auth'));
    const issuedState = new URL(googleAuthLocation!).searchParams.get('state')!;
    assert.ok(issuedState);
    const oauthCookies = makeCookieMapFromSetCookie(getSetCookieHeaders(authInitRes));
    const signedStateCookie = oauthCookies[OAUTH_STATE_COOKIE_NAME];
    assert.ok(signedStateCookie, 'OAuth initiation must issue bound HttpOnly OAuth state cookie');

    // Mismatched cookie/query state must redirect with invalid_csrf_state without consuming valid D1 state
    const badStateCallback = await googleCallbackRoute.GET(
      makeRequest(`/api/auth/google/callback?code=authcode&state=forged_state`, {
        headers: {
          cookie: `${authCookieHeader}; ${OAUTH_STATE_COOKIE_NAME}=${encodeURIComponent(signedStateCookie)}`,
        },
      })
    );
    assert.strictEqual(badStateCallback.status, 307);
    assert.ok(badStateCallback.headers.get('location')?.includes('error=invalid_csrf_state'));

    // Unauthenticated callback must redirect unauthorized
    const unauthCallback = await googleCallbackRoute.GET(
      makeRequest(`/api/auth/google/callback?code=authcode&state=${encodeURIComponent(issuedState)}`, {
        headers: {
          cookie: `${OAUTH_STATE_COOKIE_NAME}=${encodeURIComponent(signedStateCookie)}`,
        },
      })
    );
    assert.strictEqual(unauthCallback.status, 307);
    assert.ok(unauthCallback.headers.get('location')?.includes('error=unauthorized'));

    // Mock Google token + profile fetch for valid callback execution & replay test
    globalThis.fetch = async (input: RequestInfo | URL) => {
      const targetUrl = String(input);
      if (targetUrl === 'https://oauth2.googleapis.com/token') {
        return new Response(
          JSON.stringify({
            access_token: 'ya29.mock_access_token_phase91',
            refresh_token: '1//mock_refresh_token_phase91',
            expires_in: 3600,
            token_type: 'Bearer',
            scope: 'https://www.googleapis.com/auth/drive.file',
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      }
      if (targetUrl.includes('oauth2/v2/userinfo')) {
        return new Response(
          JSON.stringify({ email: 'operator@example.com', name: 'Operator' }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      }
      if (targetUrl.includes('youtube/v3/channels')) {
        return new Response(JSON.stringify({ items: [] }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      throw new Error(`Unexpected fetch URL in OAuth test: ${targetUrl}`);
    };

    const okCallback = await googleCallbackRoute.GET(
      makeRequest(`/api/auth/google/callback?code=valid_code&state=${encodeURIComponent(issuedState)}`, {
        headers: {
          cookie: `${authCookieHeader}; ${OAUTH_STATE_COOKIE_NAME}=${encodeURIComponent(signedStateCookie)}`,
        },
      })
    );
    assert.strictEqual(okCallback.status, 307);
    const okLoc = okCallback.headers.get('location') || '';
    assert.ok(
      okLoc.includes('success=google_drive_connected') || okLoc.includes('success=google_connected'),
      `Expected google_drive_connected or google_connected redirect, got ${okLoc}`
    );
    assert.ok(okLoc.includes('account=operator%40example.com'));

    // Replaying the exact same state MUST fail with expired_or_invalid_oauth_state
    const replayCallback = await googleCallbackRoute.GET(
      makeRequest(`/api/auth/google/callback?code=valid_code&state=${encodeURIComponent(issuedState)}`, {
        headers: {
          cookie: `${authCookieHeader}; ${OAUTH_STATE_COOKIE_NAME}=${encodeURIComponent(signedStateCookie)}`,
        },
      })
    );
    assert.strictEqual(replayCallback.status, 307);
    assert.ok(replayCallback.headers.get('location')?.includes('error=expired_or_invalid_oauth_state'));

    // UI OAuth feedback mapping sanity checks
    assert.strictEqual(
      resolveOAuthBannerFeedback({ success: 'google_connected', account: 'op@example.com' })?.variant,
      'success'
    );
    assert.strictEqual(
      resolveOAuthBannerFeedback({ authNotice: 'missing_google_credentials' })?.variant,
      'warning'
    );
    assert.strictEqual(resolveOAuthBannerFeedback({ error: 'access_denied' })?.variant, 'warning');
    assert.strictEqual(resolveOAuthBannerFeedback({ error: 'invalid_csrf_state' })?.variant, 'error');
    assert.strictEqual(
      resolveOAuthBannerFeedback({ error: 'Google OAuth reauthorization required: invalid_grant' })?.title,
      'Google Reauthorization Required'
    );
    console.log('✓ Google OAuth callback CSRF, session binding, single-use replay protection, and UI banners verified.');

    // ---------------------------------------------------------------
    // 5. Token Refresh Failure Must Never Return Expired Access Token
    // ---------------------------------------------------------------
    console.log('[5/6] Verifying OAuth token refresh handling & rotation...');
    await Repository.saveGoogleCredentials({
      encryptedAccessToken: encryptToken('ya29.EXPIRED_SHOULD_NEVER_BE_RETURNED'),
      encryptedRefreshToken: encryptToken('1//EXISTING_REFRESH_TOKEN'),
      expiresAt: Date.now() - 60_000,
      email: 'operator@example.com',
      updatedAt: new Date().toISOString(),
    });

    globalThis.fetch = async () =>
      new Response(
        JSON.stringify({ error: 'invalid_grant', error_description: 'Token has been revoked.' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );

    await assert.rejects(
      async () => getValidAccessToken(),
      /reauthorization required/i,
      'Refresh failure must throw clear reauthorization-required error instead of returning expired token'
    );

    // Verify expired token WITHOUT refresh token also throws reauthorization required
    await Repository.clearGoogleCredentials();
    await Repository.saveGoogleCredentials({
      encryptedAccessToken: encryptToken('ya29.EXPIRED_NO_REFRESH'),
      encryptedRefreshToken: undefined,
      expiresAt: Date.now() - 10_000,
      email: 'operator@example.com',
      updatedAt: new Date().toISOString(),
    });
    await assert.rejects(async () => getValidAccessToken(), /reauthorization required/i);

    // Refresh succeeds with expires_in=7200 and NO rotated refresh_token -> preserves existing refresh token
    await Repository.saveGoogleCredentials({
      encryptedAccessToken: encryptToken('ya29.EXPIRED_OLD'),
      encryptedRefreshToken: encryptToken('1//PRESERVED_REFRESH_TOKEN'),
      expiresAt: Date.now() - 60_000,
      email: 'operator@example.com',
      updatedAt: new Date().toISOString(),
    });

    globalThis.fetch = async () =>
      new Response(
        JSON.stringify({ access_token: 'ya29.FRESH_ACCESS_7200', expires_in: 7200 }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );

    const beforeRefresh = Date.now();
    const freshToken = await getValidAccessToken();
    assert.strictEqual(freshToken, 'ya29.FRESH_ACCESS_7200');
    const credsAfterPreserve = await Repository.getGoogleCredentials();
    assert.ok(credsAfterPreserve);
    assert.ok(
      credsAfterPreserve!.expiresAt >= beforeRefresh + 7100 * 1000,
      'expiresAt must honor Google expires_in lifetime'
    );
    assert.strictEqual(
      decryptToken(credsAfterPreserve!.encryptedRefreshToken!),
      '1//PRESERVED_REFRESH_TOKEN',
      'Existing encrypted refresh token must be preserved when omitted from refresh response'
    );

    // Refresh succeeds with rotated refresh_token -> persists new encrypted refresh token
    await Repository.saveGoogleCredentials({
      ...credsAfterPreserve!,
      expiresAt: Date.now() - 1000,
    });
    globalThis.fetch = async () =>
      new Response(
        JSON.stringify({
          access_token: 'ya29.FRESH_ACCESS_ROTATED',
          expires_in: 1800,
          refresh_token: '1//ROTATED_REFRESH_TOKEN',
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );

    const rotatedAccess = await getValidAccessToken();
    assert.strictEqual(rotatedAccess, 'ya29.FRESH_ACCESS_ROTATED');
    const credsAfterRotate = await Repository.getGoogleCredentials();
    assert.strictEqual(
      decryptToken(credsAfterRotate!.encryptedRefreshToken!),
      '1//ROTATED_REFRESH_TOKEN'
    );
    console.log('✓ Token refresh failure fail-closed, expires_in fidelity, preservation, and rotation verified.');

    // ---------------------------------------------------------------
    // 6. Upstream Revocation on Disconnect & Response Secret Hygiene
    // ---------------------------------------------------------------
    console.log('[6/6] Verifying upstream Google revocation on disconnect and zero API response leakage...');
    const revokeCalls: Array<{ url: string; method?: string; body: string }> = [];
    globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      revokeCalls.push({
        url: String(input),
        method: init?.method,
        body: String(init?.body || ''),
      });
      return new Response(null, { status: 200 });
    };

    const disconnectRes = await googleDisconnectRoute.POST(
      makeRequest('/api/auth/google/disconnect', {
        method: 'POST',
        headers: { cookie: authCookieHeader, origin: TEST_ORIGIN, 'x-csrf-token': csrfToken },
      })
    );
    assert.strictEqual(disconnectRes.status, 200);
    // Disconnecting all services must revoke every active service credential token upstream
    assert.strictEqual(revokeCalls.length, 2, 'Expected upstream revocation calls for both Drive and YouTube credentials');
    for (const call of revokeCalls) {
      assert.strictEqual(call.url, 'https://oauth2.googleapis.com/revoke');
      assert.strictEqual(call.method, 'POST');
    }
    assert.ok(
      revokeCalls.some((call) => call.body.includes('1%2F%2FROTATED_REFRESH_TOKEN')),
      'Drive rotated refresh token must be revoked upstream'
    );
    assert.ok(
      revokeCalls.some((call) => call.body.includes('1%2F%2FPRESERVED_REFRESH_TOKEN')),
      'YouTube refresh token must be revoked upstream'
    );
    assert.strictEqual(await Repository.getGoogleCredentials(), null);
    assert.strictEqual(await Repository.getGoogleServiceCredentials('drive'), null);
    assert.strictEqual(await Repository.getGoogleServiceCredentials('youtube'), null);
    assert.strictEqual(await isDriveConnected(), false);
    assert.strictEqual(await isYouTubeConnected(), false);

    // Revocation network error must NOT block local credential clearing
    await Repository.saveGoogleCredentials({
      encryptedAccessToken: encryptToken('ya29.TEMP_FAIL_REVOKE'),
      encryptedRefreshToken: encryptToken('1//TEMP_FAIL_REVOKE'),
      expiresAt: Date.now() + 3600_000,
      email: 'operator@example.com',
      updatedAt: new Date().toISOString(),
    });
    globalThis.fetch = async () => {
      throw new Error('Network unreachable');
    };
    await disconnectGoogle();
    assert.strictEqual(await Repository.getGoogleCredentials(), null);
    assert.strictEqual(await Repository.getGoogleServiceCredentials('drive'), null);
    assert.strictEqual(await Repository.getGoogleServiceCredentials('youtube'), null);

    // Upload job API sanitization: encrypted_youtube_upload_session_uri must NEVER appear in API JSON
    const secretUploadSessionUri = 'https://www.googleapis.com/upload/youtube/v3/videos?upload_id=SECRET_UPLOAD_999';
    const createdJob = await Repository.addUploadJob({
      account_username: 'security_check_user',
      caption: 'Sanitization test job',
      original_reel_url: 'https://www.instagram.com/reel/SecCheck123/',
      status: 'UPLOADING_TO_YOUTUBE',
      encrypted_youtube_upload_session_uri: encryptToken(secretUploadSessionUri),
    });

    const uploadListRes = await uploadsRoute.GET(
      makeRequest('/api/uploads', { headers: { cookie: authCookieHeader } })
    );
    const uploadListText = await uploadListRes.text();
    assert.ok(!uploadListText.includes('encrypted_youtube_upload_session_uri'), 'Uploads GET leaked encrypted URI key');
    assert.ok(!uploadListText.includes('SECRET_UPLOAD_999'), 'Uploads GET leaked upload session ID');

    const reelsListRes = await reelsRoute.GET(
      makeRequest('/api/reels', { headers: { cookie: authCookieHeader } })
    );
    const reelsListText = await reelsListRes.text();
    assert.ok(!reelsListText.includes('encrypted_youtube_upload_session_uri'), 'Reels GET leaked encrypted URI key');

    const retryFallbackRes = await uploadRetryRoute.POST(
      makeRequest(`/api/uploads/${createdJob.id}/retry`, {
        method: 'POST',
        headers: { cookie: authCookieHeader, origin: TEST_ORIGIN, 'x-csrf-token': csrfToken },
      }),
      { params: Promise.resolve({ id: createdJob.id }) }
    );
    const retryFallbackText = await retryFallbackRes.text();
    assert.ok(!retryFallbackText.includes('encrypted_youtube_upload_session_uri'), 'Retry POST leaked encrypted URI key');

    const n8nStatusRes = await n8nUploadStatusRoute.POST(
      makeRequest('/api/n8n/upload-status', {
        method: 'POST',
        headers: { authorization: 'Bearer phase91-n8n-webhook-secret' },
        body: { job_id: createdJob.id, status: 'STORED_IN_DRIVE' },
      })
    );
    const n8nStatusText = await n8nStatusRes.text();
    assert.ok(!n8nStatusText.includes('encrypted_youtube_upload_session_uri'), 'n8n upload-status leaked encrypted URI key');

    const healthRes = await healthRoute.GET();
    const healthText = await healthRes.text();
    for (const forbidden of [
      'phase91-operator-secret-key',
      'phase91-session-signing-secret-key-256bit',
      'phase91-n8n-webhook-secret',
      'operator@example.com',
      'encryptedAccessToken',
      'encryptedRefreshToken',
      'ya29.',
    ]) {
      assert.ok(!healthText.includes(forbidden), `/api/health leaked sensitive string: ${forbidden}`);
    }

    const sanitizedErr = sanitizeErrorMessage(
      new Error('Fetch failed for Bearer ya29.SECRET_ACCESS_TOKEN and refresh=1//SECRET_REFRESH&access_token=abc')
    );
    assert.ok(!sanitizedErr.includes('SECRET_ACCESS_TOKEN'));
    assert.ok(!sanitizedErr.includes('SECRET_REFRESH'));
    assert.ok(!sanitizedErr.includes('=abc'));

    console.log('✓ Google revocation on disconnect and zero credential leakage verified.');

    // ---------------------------------------------------------------
    // 7. Phase 9.5 Login Flow, Expiry, Cookie Attributes, & Frontend Regression
    // ---------------------------------------------------------------
    console.log('[7/7] Verifying Phase 9.5 login flow, session expiry, and frontend navigation handling...');

    // Missing / empty operator access key -> 401
    for (const emptyPayload of [{ accessKey: '' }, { accessKey: '   ' }, {}]) {
      const missingRes = await sessionRoute.POST(
        makeRequest('/api/auth/session', {
          method: 'POST',
          headers: { origin: TEST_ORIGIN },
          body: emptyPayload,
        })
      );
      assert.strictEqual(missingRes.status, 401, 'Empty or missing accessKey must return 401');
    }

    // Missing ADMIN_SESSION_SECRET alone (even with ADMIN_ACCESS_KEY set) -> fail closed 503
    const tempSessionSecret = process.env.ADMIN_SESSION_SECRET;
    delete process.env.ADMIN_SESSION_SECRET;
    const missingSecretRes = await sessionRoute.POST(
      makeRequest('/api/auth/session', {
        method: 'POST',
        headers: { origin: TEST_ORIGIN },
        body: { accessKey: 'phase91-operator-secret-key' },
      })
    );
    assert.strictEqual(missingSecretRes.status, 503);
    process.env.ADMIN_SESSION_SECRET = tempSessionSecret;

    // Fresh HTTPS production login -> HttpOnly, Secure, SameSite=Lax, Path=/ cookies + GET /api/auth/session true
    (process.env as Record<string, string | undefined>).NODE_ENV = 'production';
    const freshLoginRes = await sessionRoute.POST(
      makeRequest('/api/auth/session', {
        method: 'POST',
        headers: { origin: TEST_ORIGIN, 'x-forwarded-proto': 'https' },
        body: { accessKey: 'phase91-operator-secret-key' },
      })
    );
    assert.strictEqual(freshLoginRes.status, 200);
    const setCookieHeaders = getSetCookieHeaders(freshLoginRes);
    const sessionHeaderLine = setCookieHeaders.find((line) => line.startsWith(`${SESSION_COOKIE_NAME}=`));
    const csrfHeaderLine = setCookieHeaders.find((line) => line.startsWith(`${CSRF_COOKIE_NAME}=`));
    assert.ok(sessionHeaderLine?.includes('HttpOnly'), 'Session cookie must include HttpOnly');
    assert.ok(sessionHeaderLine?.includes('Secure'), 'Production HTTPS session cookie must include Secure');
    assert.ok(sessionHeaderLine?.includes('SameSite=Lax'), 'Session cookie must include SameSite=Lax');
    assert.ok(sessionHeaderLine?.includes('Path=/'), 'Session cookie must include Path=/');
    assert.ok(csrfHeaderLine && !csrfHeaderLine.includes('HttpOnly'), 'CSRF cookie must be readable by browser');
    (process.env as Record<string, string | undefined>).NODE_ENV = 'test';

    const freshCookies = makeCookieMapFromSetCookie(setCookieHeaders);
    const freshCookieHeader = `${SESSION_COOKIE_NAME}=${encodeURIComponent(freshCookies[SESSION_COOKIE_NAME])}; ${CSRF_COOKIE_NAME}=${encodeURIComponent(freshCookies[CSRF_COOKIE_NAME])}`;

    const activeSessionRes = await sessionRoute.GET(
      makeRequest('/api/auth/session', { headers: { cookie: freshCookieHeader } })
    );
    assert.strictEqual(activeSessionRes.status, 200);
    assert.deepStrictEqual(await activeSessionRes.json(), { authenticated: true, configured: true });

    // Expired session -> rejected by API & proxy
    const { token: expiredToken } = createSessionToken(-10);
    const expiredCookieHeader = `${SESSION_COOKIE_NAME}=${encodeURIComponent(expiredToken)}`;
    const expiredDashRes = await dashboardRoute.GET(
      makeRequest('/api/dashboard', { headers: { cookie: expiredCookieHeader } })
    );
    assert.strictEqual(expiredDashRes.status, 401);
    const expiredProxyRes = proxy(makeRequest('/', { headers: { cookie: expiredCookieHeader } }));
    assert.strictEqual(expiredProxyRes.status, 307);
    assert.ok(expiredProxyRes.headers.get('cache-control')?.includes('no-store'));

    // Authenticated dashboard GET -> 200; valid CSRF mutation POST /api/settings -> 200
    const authDashRes = await dashboardRoute.GET(
      makeRequest('/api/dashboard', { headers: { cookie: freshCookieHeader } })
    );
    assert.strictEqual(authDashRes.status, 200);
    const validMutationRes = await settingsRoute.POST(
      makeRequest('/api/settings', {
        method: 'POST',
        headers: {
          cookie: freshCookieHeader,
          origin: TEST_ORIGIN,
          'x-csrf-token': freshCookies[CSRF_COOKIE_NAME],
        },
        body: { automation: { default_visibility: 'private' } },
      })
    );
    assert.strictEqual(validMutationRes.status, 200);

    // Frontend submitOperatorLogin: server error, non-JSON 502 error, network failure, and full navigation
    let navigatedTo: string | null = null;
    const errLogin = await submitOperatorLogin({
      accessKey: 'wrong-key',
      nextPath: '/automation',
      fetchImpl: async () =>
        new Response(JSON.stringify({ success: false, error: 'Invalid access key.' }), {
          status: 401,
          headers: { 'content-type': 'application/json' },
        }),
      navigate: (t) => {
        navigatedTo = t;
      },
    });
    assert.deepStrictEqual(errLogin, { ok: false, status: 401, error: 'Invalid access key.' });
    assert.strictEqual(navigatedTo, null);

    const serverErrLogin = await submitOperatorLogin({
      accessKey: 'valid-key',
      fetchImpl: async () => new Response('Bad Gateway', { status: 502 }),
      navigate: (t) => {
        navigatedTo = t;
      },
    });
    assert.strictEqual(serverErrLogin.ok, false);
    assert.strictEqual(serverErrLogin.status, 502);
    assert.strictEqual(navigatedTo, null);

    const networkErrLogin = await submitOperatorLogin({
      accessKey: 'valid-key',
      fetchImpl: async () => {
        throw new Error('Network unreachable');
      },
      navigate: (t) => {
        navigatedTo = t;
      },
    });
    assert.deepStrictEqual(networkErrLogin, {
      ok: false,
      error: 'Unable to verify credentials. Please try again.',
    });
    assert.strictEqual(navigatedTo, null);

    const okLogin = await submitOperatorLogin({
      accessKey: 'phase91-operator-secret-key',
      nextPath: '/automation?tab=runs',
      fetchImpl: async () =>
        new Response(JSON.stringify({ success: true, authenticated: true }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      navigate: (t) => {
        navigatedTo = t;
      },
    });
    assert.deepStrictEqual(okLogin, { ok: true, nextPath: '/automation?tab=runs' });
    assert.strictEqual(navigatedTo, '/automation?tab=runs');
    assert.strictEqual(sanitizeNextPath('//attacker.example'), '/');
    assert.strictEqual(sanitizeNextPath('/\\attacker'), '/');

    console.log('✓ Phase 9.5 login, session expiry, cookie attributes, and frontend navigation verified.');
    console.log('\n================================================================');
    console.log('ALL PHASE 9.1 & 9.5 SECURITY HARDENING TESTS PASSED (7/7)');
    console.log('================================================================');
  } finally {
    globalThis.fetch = originalFetch;
    restoreEnv();
    Repository.resetDemo();
  }
}

runPhase91SecurityTests().catch((err) => {
  console.error('\n❌ Phase 9.1 Security Hardening Tests Failed:', err);
  process.exit(1);
});
