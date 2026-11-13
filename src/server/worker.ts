/**
 * Cloudflare Worker Entrypoint for AutoShorts
 * Provides serverless runtime for API routes, D1 database binding,
 * and Cloudflare Cron triggers (scheduled polling).
 */

import {
  appendClearOAuthStateCookie,
  appendOAuthStateCookie,
  authorizeAdminRequest,
  OAUTH_STATE_COOKIE_NAME,
  parseCookiesFromRequest,
  signOAuthStateCookieValue,
  verifyOAuthStateCookieValue,
} from '../lib/auth';
import {
  NO_STORE_HEADERS,
  sanitizeErrorMessage,
  sanitizeUploadJobForApi,
  sanitizeUploadJobsForApi,
} from '../lib/security';
import { Repository } from './db/repository';
import { PipelineService } from './services/pipelineService';
import {
  getGoogleDriveAuthUrl,
  getYouTubeAuthUrl,
  exchangeCodeForTokens,
  saveGoogleServiceCredentials,
  disconnectGoogle,
  disconnectGoogleService,
  isGoogleConnected,
  isDriveConnected,
  isYouTubeConnected,
  fetchGoogleUserProfile,
  fetchYouTubeChannelDetails,
} from './services/googleAuthService';

export interface CloudflareEnv {
  DB?: any; // Cloudflare D1 Database binding
  GOOGLE_CLIENT_ID?: string;
  GOOGLE_CLIENT_SECRET?: string;
  GOOGLE_REDIRECT_URI?: string;
  TOKEN_ENCRYPTION_KEY?: string;
  ADMIN_ACCESS_KEY?: string;
  ADMIN_SESSION_SECRET?: string;
  N8N_WEBHOOK_SECRET?: string;
  NEXT_PUBLIC_APP_URL?: string;
  STORAGE_DEFAULT_FOLDER?: string;
  POLLING_INTERVAL_MINUTES?: string;
}

export interface ExecutionContext {
  waitUntil(promise: Promise<unknown>): void;
  passThroughOnException(): void;
}

export interface ScheduledEvent {
  cron: string;
  type: string;
  scheduledTime: number;
}

const submissionRateLimits = new Map<string, { count: number; resetAt: number }>();

function checkRateLimit(ip: string, limit = 30, windowMs = 60000): boolean {
  const now = Date.now();
  const entry = submissionRateLimits.get(ip);
  if (!entry || now > entry.resetAt) {
    submissionRateLimits.set(ip, { count: 1, resetAt: now + windowMs });
    return true;
  }
  if (entry.count >= limit) {
    return false;
  }
  entry.count++;
  return true;
}

export default {
  /**
   * HTTP Request Router for Cloudflare Worker
   */
  async fetch(request: Request, env: CloudflareEnv, ctx: ExecutionContext): Promise<Response> {
    if (env.DB) Repository.setD1Database(env.DB);
    // Populate environment variables into process.env if running in worker
    if (env.GOOGLE_CLIENT_ID) process.env.GOOGLE_CLIENT_ID = env.GOOGLE_CLIENT_ID;
    if (env.GOOGLE_CLIENT_SECRET) process.env.GOOGLE_CLIENT_SECRET = env.GOOGLE_CLIENT_SECRET;
    if (env.GOOGLE_REDIRECT_URI) process.env.GOOGLE_REDIRECT_URI = env.GOOGLE_REDIRECT_URI;
    if (env.TOKEN_ENCRYPTION_KEY) process.env.TOKEN_ENCRYPTION_KEY = env.TOKEN_ENCRYPTION_KEY;
    if (env.ADMIN_ACCESS_KEY) process.env.ADMIN_ACCESS_KEY = env.ADMIN_ACCESS_KEY;
    if (env.ADMIN_SESSION_SECRET) process.env.ADMIN_SESSION_SECRET = env.ADMIN_SESSION_SECRET;
    if (env.N8N_WEBHOOK_SECRET) process.env.N8N_WEBHOOK_SECRET = env.N8N_WEBHOOK_SECRET;
    if (env.NEXT_PUBLIC_APP_URL) process.env.NEXT_PUBLIC_APP_URL = env.NEXT_PUBLIC_APP_URL;

    const url = new URL(request.url);
    const path = url.pathname;
    const method = request.method;

    const jsonHeaders = {
      'Content-Type': 'application/json',
      ...NO_STORE_HEADERS,
    };

    if (method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: NO_STORE_HEADERS });
    }

    try {
      // 1. Health Check
      if (path === '/api/health') {
        const automation = await Repository.getAutomationSettings();
        const profiles = await Repository.getMonitoredProfiles();
        const googleConnected = await isGoogleConnected();
        const integrations = await Repository.getIntegrations();

        return new Response(
          JSON.stringify({
            status: 'healthy',
            version: '2.1.0',
            environment: 'cloudflare-worker',
            timestamp: new Date().toISOString(),
            database: {
              mode: env.DB ? 'Cloudflare D1 (Bound)' : 'Persistent Fallback / SQLite',
              connected: true,
            },
            monitoring: {
              totalProfiles: profiles.length,
              activeProfiles: profiles.filter((p) => p.status === 'ACTIVE').length,
              zeroOAuthMode: true,
            },
            integrations: {
              googleDriveConnected: integrations.google_drive.connected,
              youtubeConnected: integrations.youtube.connected,
              googleDriveTokensAvailable: await isDriveConnected(),
              youtubeTokensAvailable: await isYouTubeConnected(),
              googleOAuthTokensAvailable: googleConnected,
            },
            automation: {
              enabled: automation.is_enabled,
              isRunning: automation.is_running,
              lastSuccessfulCheck: automation.last_successful_check,
              pollingIntervalMinutes: automation.polling_interval_minutes,
            },
          }),
          { status: 200, headers: jsonHeaders }
        );
      }

      const requireWorkerAdmin = (requireCsrf?: boolean): Response | null => {
        const auth = authorizeAdminRequest(request, { requireCsrf });
        if (auth.ok) return null;
        return new Response(JSON.stringify({ success: false, error: auth.error }), {
          status: auth.status,
          headers: jsonHeaders,
        });
      };

      // 2. Dashboard Metrics
      if (path === '/api/dashboard' && method === 'GET') {
        const authFailure = requireWorkerAdmin();
        if (authFailure) return authFailure;
        const metrics = await PipelineService.getEnrichedDashboardMetrics();
        return new Response(JSON.stringify(metrics), { status: 200, headers: jsonHeaders });
      }

      // 3. Profiles API
      if (path === '/api/profiles' && method === 'GET') {
        const authFailure = requireWorkerAdmin();
        if (authFailure) return authFailure;
        const profiles = await Repository.getMonitoredProfiles();
        return new Response(JSON.stringify({ success: true, profiles }), { status: 200, headers: jsonHeaders });
      }

      if (path === '/api/profiles' && method === 'POST') {
        const authFailure = requireWorkerAdmin();
        if (authFailure) return authFailure;
        const body = await request.json() as { profile_url: string; display_name?: string };
        const newProf = await Repository.addMonitoredProfile(body.profile_url, body.display_name);
        return new Response(JSON.stringify({ success: true, profile: newProf }), { status: 201, headers: jsonHeaders });
      }

      // 4. Automation Sync Trigger
      if (path === '/api/automation/sync-now' && method === 'POST') {
        const authFailure = requireWorkerAdmin();
        if (authFailure) return authFailure;
        let sandbox = false;
        try {
          const body = (await request.json()) as { sandbox?: boolean };
          sandbox = !!body.sandbox;
        } catch {
          // empty body ok
        }

        const result = await PipelineService.runSync({ force: true, sandbox });
        return new Response(
          JSON.stringify({
            success: !result.skipped,
            message: `Pipeline sync finished. ${result.profilesChecked} checked, ${result.reelsDetected} detected.`,
            result,
          }),
          { status: result.skipped ? 409 : 200, headers: jsonHeaders }
        );
      }

      // 5. Google OAuth Endpoints
      if (
        path === '/api/auth/google/authorize' ||
        path === '/api/auth/google/drive/authorize' ||
        path === '/api/auth/google/youtube/authorize'
      ) {
        const auth = authorizeAdminRequest(request, { requireCsrf: false });
        if (!auth.ok) {
          return new Response(JSON.stringify({ success: false, error: auth.error }), {
            status: auth.status,
            headers: jsonHeaders,
          });
        }
        const serviceParam = url.searchParams.get('service');
        const isYouTube = path === '/api/auth/google/youtube/authorize' || serviceParam === 'youtube';
        const redirectUri = process.env.GOOGLE_REDIRECT_URI || `${url.origin}/api/auth/google/callback`;
        const { url: authUrl, state } = isYouTube
          ? getYouTubeAuthUrl(redirectUri)
          : getGoogleDriveAuthUrl(redirectUri);
        const providerTag = isYouTube ? 'google_youtube' : 'google_drive';
        await Repository.saveOAuthState(state, redirectUri, 600000, providerTag);
        const headers = new Headers({ Location: authUrl, ...NO_STORE_HEADERS });
        appendOAuthStateCookie(headers, signOAuthStateCookieValue(state, auth.session.jti), request);
        return new Response(null, { status: 302, headers });
      }

      if (path === '/api/auth/google/callback') {
        const clearRedirect = (target: string) => {
          const headers = new Headers({ Location: target, ...NO_STORE_HEADERS });
          appendClearOAuthStateCookie(headers, request);
          return new Response(null, { status: 302, headers });
        };

        const auth = authorizeAdminRequest(request, { requireCsrf: false });
        if (!auth.ok) {
          return clearRedirect(`${url.origin}/settings?error=unauthorized`);
        }

        const code = url.searchParams.get('code');
        const state = url.searchParams.get('state');
        if (!code) {
          return clearRedirect(`${url.origin}/settings?error=missing_auth_code`);
        }
        const cookies = parseCookiesFromRequest(request);
        if (!verifyOAuthStateCookieValue(cookies[OAUTH_STATE_COOKIE_NAME], state, auth.session.jti)) {
          return clearRedirect(`${url.origin}/settings?error=invalid_csrf_state`);
        }
        const stateRecord = state ? await Repository.consumeOAuthStateRecord(state) : null;
        if (!stateRecord || !stateRecord.valid) {
          return clearRedirect(`${url.origin}/settings?error=expired_or_invalid_oauth_state`);
        }
        const redirectUri = stateRecord.redirectUri || process.env.GOOGLE_REDIRECT_URI || `${url.origin}/api/auth/google/callback`;
        const tokens = await exchangeCodeForTokens(code, redirectUri);
        const isYouTube = stateRecord.provider === 'google_youtube';

        if (isYouTube) {
          const channelProfile = await fetchYouTubeChannelDetails(tokens.access_token);
          if (!channelProfile.youtubeChannel?.id) {
            await saveGoogleServiceCredentials('youtube', tokens, {
              email: channelProfile.email,
            });
            return clearRedirect(`${url.origin}/settings?warning=youtube_channel_not_found`);
          }
          await saveGoogleServiceCredentials('youtube', tokens, {
            email: channelProfile.email,
            channelId: channelProfile.youtubeChannel.id,
            channelTitle: channelProfile.youtubeChannel.title,
          });
          return clearRedirect(
            `${url.origin}/settings?success=youtube_connected&account=${encodeURIComponent(
              channelProfile.youtubeChannel.title || channelProfile.email || ''
            )}`
          );
        } else {
          const userProfile = await fetchGoogleUserProfile(tokens.access_token);
          await saveGoogleServiceCredentials('drive', tokens, {
            email: userProfile.email,
          });
          return clearRedirect(
            `${url.origin}/settings?success=google_drive_connected&account=${encodeURIComponent(
              userProfile.email || ''
            )}`
          );
        }
      }

      if (
        (path === '/api/auth/google/disconnect' ||
          path === '/api/auth/google/drive/disconnect' ||
          path === '/api/auth/google/youtube/disconnect') &&
        method === 'POST'
      ) {
        const authFailure = requireWorkerAdmin();
        if (authFailure) return authFailure;

        if (path === '/api/auth/google/drive/disconnect') {
          await disconnectGoogleService('drive');
          return new Response(JSON.stringify({ success: true, message: 'Google Drive disconnected' }), {
            status: 200,
            headers: jsonHeaders,
          });
        }

        if (path === '/api/auth/google/youtube/disconnect') {
          await disconnectGoogleService('youtube');
          return new Response(JSON.stringify({ success: true, message: 'YouTube channel disconnected' }), {
            status: 200,
            headers: jsonHeaders,
          });
        }

        let bodyService: string | undefined;
        try {
          const body = (await request.json()) as { service?: string };
          bodyService = body.service;
        } catch {
          // ignore
        }
        const service = url.searchParams.get('service') || bodyService;
        if (service === 'drive' || service === 'youtube') {
          await disconnectGoogleService(service);
          return new Response(JSON.stringify({ success: true, message: `Google ${service} disconnected` }), {
            status: 200,
            headers: jsonHeaders,
          });
        }

        await disconnectGoogle();
        return new Response(JSON.stringify({ success: true, message: 'Google services disconnected' }), {
          status: 200,
          headers: jsonHeaders,
        });
      }

      // 6. Settings API
      if (path === '/api/settings') {
        const authFailure = requireWorkerAdmin();
        if (authFailure) return authFailure;
        if (method === 'GET') {
          const integrations = await Repository.getIntegrations();
          const automation = await Repository.getAutomationSettings();
          const accounts = await Repository.getAccounts();
          return new Response(
            JSON.stringify({ success: true, integrations, automation, accounts_count: accounts.length }),
            { status: 200, headers: jsonHeaders }
          );
        }
        if (method === 'POST') {
          const body = (await request.json()) as any;
          if (body.automation) await Repository.updateAutomationSettings(body.automation);
          const integrations = await Repository.getIntegrations();
          const automation = await Repository.getAutomationSettings();
          return new Response(JSON.stringify({ success: true, integrations, automation }), { status: 200, headers: jsonHeaders });
        }
      }

      // 7. Uploads API
      if (path === '/api/uploads' && method === 'GET') {
        const authFailure = requireWorkerAdmin();
        if (authFailure) return authFailure;
        const jobs = await Repository.getUploadJobs();
        return new Response(
          JSON.stringify({ success: true, jobs: sanitizeUploadJobsForApi(jobs) }),
          { status: 200, headers: jsonHeaders }
        );
      }

      // 8. Reel Direct Submission Engine (Phase 3B)
      if (path === '/api/reels/submit' && method === 'POST') {
        const clientIp =
          request.headers.get('cf-connecting-ip') ||
          request.headers.get('x-forwarded-for') ||
          '127.0.0.1';
        if (!checkRateLimit(clientIp)) {
          return new Response(
            JSON.stringify({ success: false, error: 'Rate limit exceeded. Maximum 30 submissions per minute.' }),
            { status: 429, headers: { ...jsonHeaders, 'Retry-After': '60' } }
          );
        }

        const authFailure = requireWorkerAdmin();
        if (authFailure) return authFailure;

        const body = (await request.json()) as any;
        if (!body.reelUrl) {
          return new Response(
            JSON.stringify({ success: false, error: 'Instagram Reel URL is required.' }),
            { status: 400, headers: jsonHeaders }
          );
        }
        if (!body.confirmedRights) {
          return new Response(
            JSON.stringify({
              success: false,
              error: 'Compliance requirement: Creator copyright or distribution rights confirmation is required.',
            }),
            { status: 400, headers: jsonHeaders }
          );
        }

        const job = await PipelineService.processSubmission(
          {
            reelUrl: body.reelUrl,
            directVideoUrl: body.directVideoUrl,
            driveFileId: body.driveFileId,
            captionOverride: body.captionOverride,
            visibility: body.visibility || 'private',
            confirmedRights: Boolean(body.confirmedRights),
          },
          { sandbox: Boolean(body.sandbox) }
        );

        return new Response(
          JSON.stringify({
            success: true,
            message: `Reel processed. Status: ${job.status}`,
            job: sanitizeUploadJobForApi(job),
          }),
          { status: 200, headers: jsonHeaders }
        );
      }

      if (path === '/api/reels' && method === 'GET') {
        const authFailure = requireWorkerAdmin();
        if (authFailure) return authFailure;
        const shortcode = url.searchParams.get('shortcode');
        if (shortcode) {
          const job = await Repository.getUploadJobByShortcode(shortcode);
          return new Response(
            JSON.stringify({
              success: true,
              count: job ? 1 : 0,
              jobs: job ? [sanitizeUploadJobForApi(job)] : [],
            }),
            { status: 200, headers: jsonHeaders }
          );
        }
        const jobs = await Repository.getUploadJobs();
        return new Response(
          JSON.stringify({ success: true, count: jobs.length, jobs: sanitizeUploadJobsForApi(jobs) }),
          { status: 200, headers: jsonHeaders }
        );
      }

      return new Response(JSON.stringify({ error: `Not Found: ${path}` }), { status: 404, headers: jsonHeaders });
    } catch (err) {
      return new Response(
        JSON.stringify({ success: false, error: sanitizeErrorMessage(err) }),
        { status: 500, headers: jsonHeaders }
      );
    }
  },

  /**
   * Cloudflare Cron Trigger (Scheduled Polling)
   * Automatically executes every 30 minutes via Cloudflare Cron
   */
  async scheduled(event: ScheduledEvent, env: CloudflareEnv, ctx: ExecutionContext): Promise<void> {
    if (env.DB) Repository.setD1Database(env.DB);
    if (env.GOOGLE_CLIENT_ID) process.env.GOOGLE_CLIENT_ID = env.GOOGLE_CLIENT_ID;
    if (env.GOOGLE_CLIENT_SECRET) process.env.GOOGLE_CLIENT_SECRET = env.GOOGLE_CLIENT_SECRET;
    if (env.TOKEN_ENCRYPTION_KEY) process.env.TOKEN_ENCRYPTION_KEY = env.TOKEN_ENCRYPTION_KEY;

    ctx.waitUntil(
      (async () => {
        try {
          console.log(`[Cloudflare Cron] Executing scheduled profile check at ${new Date(event.scheduledTime).toISOString()}...`);
          const result = await PipelineService.runSync({ force: false });
          console.log(`[Cloudflare Cron] Check complete. Profiles: ${result.profilesChecked}, Detected: ${result.reelsDetected}`);
        } catch (err) {
          console.error('[Cloudflare Cron] Execution failed:', (err as Error).message);
        }
      })()
    );
  },
};
