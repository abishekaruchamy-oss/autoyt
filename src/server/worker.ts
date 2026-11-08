/**
 * Cloudflare Worker Entrypoint for AutoShorts
 * Provides serverless runtime for API routes, D1 database binding,
 * and Cloudflare Cron triggers (scheduled polling).
 */

import { Repository } from './db/repository';
import { PipelineService } from './services/pipelineService';
import { getGoogleAuthUrl, exchangeCodeForTokens, saveGoogleCredentials, disconnectGoogle, isGoogleConnected } from './services/googleAuthService';

export interface CloudflareEnv {
  DB?: any; // Cloudflare D1 Database binding
  GOOGLE_CLIENT_ID?: string;
  GOOGLE_CLIENT_SECRET?: string;
  TOKEN_ENCRYPTION_KEY?: string;
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

export default {
  /**
   * HTTP Request Router for Cloudflare Worker
   */
  async fetch(request: Request, env: CloudflareEnv, ctx: ExecutionContext): Promise<Response> {
    // Populate environment variables into process.env if running in worker
    if (env.GOOGLE_CLIENT_ID) process.env.GOOGLE_CLIENT_ID = env.GOOGLE_CLIENT_ID;
    if (env.GOOGLE_CLIENT_SECRET) process.env.GOOGLE_CLIENT_SECRET = env.GOOGLE_CLIENT_SECRET;
    if (env.TOKEN_ENCRYPTION_KEY) process.env.TOKEN_ENCRYPTION_KEY = env.TOKEN_ENCRYPTION_KEY;
    if (env.NEXT_PUBLIC_APP_URL) process.env.NEXT_PUBLIC_APP_URL = env.NEXT_PUBLIC_APP_URL;

    const url = new URL(request.url);
    const path = url.pathname;
    const method = request.method;

    const jsonHeaders = {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, PATCH, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    };

    if (method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: jsonHeaders });
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

      // 2. Dashboard Metrics
      if (path === '/api/dashboard' && method === 'GET') {
        const metrics = await Repository.getDashboardMetrics();
        return new Response(JSON.stringify(metrics), { status: 200, headers: jsonHeaders });
      }

      // 3. Profiles API
      if (path === '/api/profiles' && method === 'GET') {
        const profiles = await Repository.getMonitoredProfiles();
        return new Response(JSON.stringify({ success: true, profiles }), { status: 200, headers: jsonHeaders });
      }

      if (path === '/api/profiles' && method === 'POST') {
        const body = await request.json() as { profile_url: string; display_name?: string };
        const newProf = await Repository.addMonitoredProfile(body.profile_url, body.display_name);
        return new Response(JSON.stringify({ success: true, profile: newProf }), { status: 201, headers: jsonHeaders });
      }

      // 4. Automation Sync Trigger
      if (path === '/api/automation/sync-now' && method === 'POST') {
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
      if (path === '/api/auth/google/authorize') {
        const redirectUri = `${url.origin}/api/auth/google/callback`;
        const { url: authUrl } = getGoogleAuthUrl(redirectUri);
        return Response.redirect(authUrl, 302);
      }

      if (path === '/api/auth/google/callback') {
        const code = url.searchParams.get('code');
        if (!code) {
          return new Response(JSON.stringify({ error: 'Missing code' }), { status: 400, headers: jsonHeaders });
        }
        const redirectUri = `${url.origin}/api/auth/google/callback`;
        const tokens = await exchangeCodeForTokens(code, redirectUri);
        await saveGoogleCredentials(tokens);
        return Response.redirect(`${url.origin}/settings?google_auth=success`, 302);
      }

      if (path === '/api/auth/google/disconnect' && method === 'POST') {
        await disconnectGoogle();
        return new Response(JSON.stringify({ success: true, message: 'Google disconnected' }), { status: 200, headers: jsonHeaders });
      }

      // 6. Settings API
      if (path === '/api/settings') {
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
        const jobs = await Repository.getUploadJobs();
        return new Response(JSON.stringify({ success: true, jobs }), { status: 200, headers: jsonHeaders });
      }

      // 8. Reel Direct Submission Engine (Phase 3B)
      if (path === '/api/reels/submit' && method === 'POST') {
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
          JSON.stringify({ success: true, message: `Reel processed. Status: ${job.status}`, job }),
          { status: 200, headers: jsonHeaders }
        );
      }

      if (path === '/api/reels' && method === 'GET') {
        const shortcode = url.searchParams.get('shortcode');
        if (shortcode) {
          const job = await Repository.getUploadJobByShortcode(shortcode);
          return new Response(
            JSON.stringify({ success: true, count: job ? 1 : 0, jobs: job ? [job] : [] }),
            { status: 200, headers: jsonHeaders }
          );
        }
        const jobs = await Repository.getUploadJobs();
        return new Response(JSON.stringify({ success: true, count: jobs.length, jobs }), { status: 200, headers: jsonHeaders });
      }

      return new Response(JSON.stringify({ error: `Not Found: ${path}` }), { status: 404, headers: jsonHeaders });
    } catch (err) {
      return new Response(
        JSON.stringify({ success: false, error: (err as Error).message }),
        { status: 500, headers: jsonHeaders }
      );
    }
  },

  /**
   * Cloudflare Cron Trigger (Scheduled Polling)
   * Automatically executes every 30 minutes via Cloudflare Cron
   */
  async scheduled(event: ScheduledEvent, env: CloudflareEnv, ctx: ExecutionContext): Promise<void> {
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
