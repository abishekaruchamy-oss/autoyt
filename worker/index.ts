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
  TOKEN_ENCRYPTION_KEY?: string;
  NEXT_PUBLIC_APP_URL?: string;
  STORAGE_DEFAULT_FOLDER?: string;
  POLLING_INTERVAL_MINUTES?: string;
  WORKER_SELF_REFERENCE?: any;
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
    // Connect D1 database binding to Repository
    if (env.DB) {
      Repository.setD1Database(env.DB);
    }

    // Populate process.env with Cloudflare Worker secrets and environment variables
    if (env.GOOGLE_CLIENT_ID) process.env.GOOGLE_CLIENT_ID = env.GOOGLE_CLIENT_ID;
    if (env.GOOGLE_CLIENT_SECRET) process.env.GOOGLE_CLIENT_SECRET = env.GOOGLE_CLIENT_SECRET;
    if (env.TOKEN_ENCRYPTION_KEY) process.env.TOKEN_ENCRYPTION_KEY = env.TOKEN_ENCRYPTION_KEY;
    if (env.NEXT_PUBLIC_APP_URL) process.env.NEXT_PUBLIC_APP_URL = env.NEXT_PUBLIC_APP_URL;
    if (env.POLLING_INTERVAL_MINUTES) process.env.POLLING_INTERVAL_MINUTES = env.POLLING_INTERVAL_MINUTES;

    return (openNextHandler as any).fetch(request, env, ctx);
  },

  /**
   * Cloudflare Cron Trigger (Scheduled Polling)
   * Automatically executes every 30 minutes via Cloudflare Cron
   */
  async scheduled(event: ScheduledEvent, env: CloudflareEnv, ctx: ExecutionContext): Promise<void> {
    // Connect D1 database binding for background execution
    if (env.DB) {
      Repository.setD1Database(env.DB);
    }
    if (env.GOOGLE_CLIENT_ID) process.env.GOOGLE_CLIENT_ID = env.GOOGLE_CLIENT_ID;
    if (env.GOOGLE_CLIENT_SECRET) process.env.GOOGLE_CLIENT_SECRET = env.GOOGLE_CLIENT_SECRET;
    if (env.TOKEN_ENCRYPTION_KEY) process.env.TOKEN_ENCRYPTION_KEY = env.TOKEN_ENCRYPTION_KEY;
    if (env.NEXT_PUBLIC_APP_URL) process.env.NEXT_PUBLIC_APP_URL = env.NEXT_PUBLIC_APP_URL;

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
