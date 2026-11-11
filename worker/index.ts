/**
 * Cloudflare Worker Custom Entrypoint for AutoShorts
 * Combines OpenNext Next.js 16 full-stack runtime with Cloudflare Cron Triggers.
 */

// @ts-ignore: .open-next/worker.js is generated dynamically by opennextjs-cloudflare build
import openNextHandler from '../.open-next/worker.js';
import { PipelineService } from '../src/server/services/pipelineService';
import { Repository } from '../src/server/db/repository';

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
  WORKER_SELF_REFERENCE?: any;
}

const FORWARDED_ENV_KEYS = [
  'GOOGLE_CLIENT_ID',
  'GOOGLE_CLIENT_SECRET',
  'GOOGLE_REDIRECT_URI',
  'TOKEN_ENCRYPTION_KEY',
  'ADMIN_ACCESS_KEY',
  'ADMIN_SESSION_SECRET',
  'N8N_WEBHOOK_SECRET',
  'NEXT_PUBLIC_APP_URL',
  'STORAGE_DEFAULT_FOLDER',
  'POLLING_INTERVAL_MINUTES',
] as const;

function applyWorkerEnv(env: CloudflareEnv): void {
  if (env.DB) {
    Repository.setD1Database(env.DB);
  }
  for (const key of FORWARDED_ENV_KEYS) {
    const val = env[key];
    if (typeof val === 'string' && val.length > 0) {
      process.env[key] = val;
    }
  }
}

export interface ScheduledEvent {
  cron: string;
  type: string;
  scheduledTime: number;
}

export interface ExecutionContext {
  waitUntil(promise: Promise<unknown>): void;
  passThroughOnException(): void;
}

export default {
  /**
   * HTTP Request Router: Delegates all incoming HTTP requests to OpenNext
   * Serves Next.js 16 App Router (SSR, client components, API route handlers, and static assets)
   */
  async fetch(request: Request, env: CloudflareEnv, ctx: ExecutionContext): Promise<Response> {
    applyWorkerEnv(env);
    return (openNextHandler as any).fetch(request, env, ctx);
  },

  /**
   * Cloudflare Cron Trigger (Scheduled Polling)
   * Automatically executes every 30 minutes via Cloudflare Cron
   */
  async scheduled(event: ScheduledEvent, env: CloudflareEnv, ctx: ExecutionContext): Promise<void> {
    applyWorkerEnv(env);

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

// Re-export OpenNext Durable Object handlers
// @ts-ignore
export { DOQueueHandler, DOShardedTagCache, BucketCachePurge } from '../.open-next/worker.js';
