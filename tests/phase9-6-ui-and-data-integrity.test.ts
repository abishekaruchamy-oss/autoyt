/**
 * tests/phase9-6-ui-and-data-integrity.test.ts
 *
 * Phase 9.6 - UI Integrity, Data Consistency & Production Readiness Test Suite
 *
 * Verifies:
 * 1. Zero-data dashboard calculations (no fabricated +18, +14, +6, 14.8GB; success_rate = null when 0 uploads)
 * 2. Disconnected Google Drive & YouTube metrics state (storage.available = false, N/A formatting, live readiness blocked)
 * 3. Execution readiness validation (blocks live sync when integrations/profile missing, allows sandbox tests)
 * 4. Automation configuration validation (rejects invalid intervals, non-positive caps, invalid visibility)
 * 5. Production destructive action safeguards (POST /api/demo/reset is blocked 403 in production)
 * 6. Cloudflare D1 database naming & architecture parity (autoshorts-db, Cron, and no PostgreSQL/scraping bypass claims)
 */

import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { Repository } from '../src/server/db/repository';
import { createSqliteD1Adapter } from '../src/server/db/d1Client';
import { PipelineService } from '../src/server/services/pipelineService';
import * as demoResetRoute from '../src/app/api/demo/reset/route';
import * as dashboardRoute from '../src/app/api/dashboard/route';
import * as syncNowRoute from '../src/app/api/automation/sync-now/route';
import {
  createSessionToken,
  SESSION_COOKIE_NAME,
  CSRF_COOKIE_NAME,
} from '../src/lib/auth';
import { NextRequest } from 'next/server';

function createFreshD1Database() {
  const schemaPath = path.join(__dirname, '..', 'db', 'd1-schema.sql');
  const schemaSql = fs.readFileSync(schemaPath, 'utf8');
  const rawDb = new DatabaseSync(':memory:');
  rawDb.exec(schemaSql);
  return { rawDb, d1: createSqliteD1Adapter(rawDb) };
}

function createAuthCookieHeader() {
  const { token, payload } = createSessionToken();
  return {
    token,
    payload,
    cookieHeader: `${SESSION_COOKIE_NAME}=${encodeURIComponent(token)}; ${CSRF_COOKIE_NAME}=${encodeURIComponent(payload.csrf)}`,
  };
}

function makeAuthedRequest(urlPath: string, options: { method?: string; body?: unknown } = {}) {
  const auth = createAuthCookieHeader();
  return new NextRequest(`https://autoshorts.test${urlPath}`, {
    method: options.method || 'GET',
    headers: {
      cookie: auth.cookieHeader,
      origin: 'https://autoshorts.test',
      'sec-fetch-site': 'same-origin',
      'x-csrf-token': auth.payload.csrf,
      'content-type': 'application/json',
    },
    body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
  });
}

async function runPhase96TestSuite() {
  console.log('================================================================');
  console.log('PHASE 9.6 - UI INTEGRITY & DATA CONSISTENCY TEST SUITE');
  console.log('================================================================\n');

  process.env.ADMIN_ACCESS_KEY = 'phase96-operator-access-key-production';
  process.env.ADMIN_SESSION_SECRET = 'phase96-test-session-secret-at-least-32-chars-long';
  process.env.TOKEN_ENCRYPTION_KEY = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';

  // -------------------------------------------------------------
  // Test 1: Zero-Data Dashboard Integrity (No Fabricated Metrics)
  // -------------------------------------------------------------
  console.log('[Test 1] Verifying zero-data dashboard calculations...');
  const { d1 } = createFreshD1Database();
  Repository.setD1Database(d1);

  // Default state: 0 profiles, 0 jobs, 0 videos
  const zeroMetrics = await Repository.getDashboardMetrics();

  assert.strictEqual(zeroMetrics.total_reels_detected, 0, 'Total reels detected must be 0 for empty database');
  assert.strictEqual(zeroMetrics.reels_detected_today, 0, 'Today reels detected must be 0 for empty database');
  assert.strictEqual(zeroMetrics.total_videos_uploaded, 0, 'Total videos uploaded must be 0 for empty database');
  assert.strictEqual(zeroMetrics.failed_uploads, 0, 'Failed uploads must be 0 for empty database');
  assert.strictEqual(zeroMetrics.in_progress_uploads, 0, 'In progress uploads must be 0 for empty database');
  assert.strictEqual(
    zeroMetrics.success_rate,
    null,
    'Success rate must be null (displayed as N/A) when terminal uploads count is 0 (never 96%)'
  );
  assert.strictEqual(zeroMetrics.storage.available, false, 'Storage available must be false when disconnected');
  assert.strictEqual(zeroMetrics.storage.used_bytes, null, 'used_bytes must be null (never fake 14.8 GB)');
  assert.strictEqual(zeroMetrics.storage.total_bytes, null, 'total_bytes must be null (never fake 100 GB)');
  assert.strictEqual(zeroMetrics.storage.reels_stored, null, 'reels_stored must be null when Drive is disconnected');
  assert.strictEqual(zeroMetrics.storage.used_formatted, 'N/A', 'used_formatted must be N/A');
  assert.strictEqual(zeroMetrics.storage.percentage, null, 'percentage must be null');
  assert.strictEqual(zeroMetrics.data_source, 'cloudflare_d1', 'data_source must indicate live cloudflare_d1');

  // Verify memory fallback also avoids fabricated numbers
  Repository.setD1Database(null);
  Repository.resetDemo();
  const memoryJobs = await Repository.getUploadJobs();
  const memoryMetrics = await Repository.getDashboardMetrics();
  assert.strictEqual(
    memoryMetrics.total_reels_detected,
    memoryJobs.length,
    'Memory fallback must reflect exact store jobs length without adding +18 phantom reels'
  );
  assert.strictEqual(
    memoryMetrics.total_videos_uploaded,
    memoryJobs.filter((j) => j.status === 'COMPLETED').length,
    'Memory fallback must reflect exact COMPLETED jobs without adding +14 phantom uploads'
  );
  assert.strictEqual(memoryMetrics.storage.used_bytes, null, 'Memory fallback must not hardcode 14.8 GB');
  assert.strictEqual(memoryMetrics.storage.total_bytes, null, 'Memory fallback must not hardcode 100 GB');

  Repository.setD1Database(d1);
  console.log('✓ Zero-data metrics verified: No phantom +18/+14/+6, no fabricated 14.8GB, success rate correctly null (N/A).');

  // -------------------------------------------------------------
  // Test 2: Disconnected Drive & YouTube State
  // -------------------------------------------------------------
  console.log('\n[Test 2] Verifying disconnected Drive/YouTube state & execution readiness...');
  const readiness = await Repository.evaluateExecutionReadiness();
  assert.strictEqual(readiness.ready_for_live_upload, false, 'Readiness must be false when Google is disconnected');
  assert.strictEqual(readiness.google_drive_connected, false);
  assert.strictEqual(readiness.youtube_connected, false);
  assert.strictEqual(readiness.google_oauth_tokens_available, false);
  assert.ok(
    readiness.blocking_reasons.some((r) => r.includes('Google Drive OAuth integration is not connected')),
    'Must explicitly list missing Google Drive integration'
  );
  assert.ok(
    readiness.blocking_reasons.some((r) => r.includes('YouTube channel OAuth integration is not connected')),
    'Must explicitly list missing YouTube integration'
  );

  const dashHttpRes = await dashboardRoute.GET(makeAuthedRequest('/api/dashboard'));
  assert.strictEqual(dashHttpRes.status, 200, 'Authenticated GET /api/dashboard must return 200');
  const dashBody = (await dashHttpRes.json()) as {
    success: boolean;
    metrics: {
      success_rate: number | null;
      storage: { used_formatted: string };
      readiness: { ready_for_live_upload: boolean };
    };
  };
  assert.strictEqual(dashBody.success, true);
  assert.strictEqual(dashBody.metrics.success_rate, null);
  assert.strictEqual(dashBody.metrics.storage.used_formatted, 'N/A');
  assert.strictEqual(dashBody.metrics.readiness.ready_for_live_upload, false);
  console.log('✓ Disconnected state correctly blocks live readiness with human-readable reasons.');

  // -------------------------------------------------------------
  // Test 3: Live Sync Guard vs Permitted Sandbox Testing
  // -------------------------------------------------------------
  console.log('\n[Test 3] Verifying sync-now execution readiness guard and sandbox bypass...');
  // A. Live sync attempt when readiness fails must be skipped (HTTP 409 Conflict)
  const liveSyncRes = await PipelineService.runSync({ force: true, sandbox: false });
  assert.strictEqual(liveSyncRes.success, false, 'Live sync must not execute when unready');
  assert.strictEqual(liveSyncRes.skipped, true, 'Live sync must be skipped');
  assert.ok(
    liveSyncRes.reason?.includes('Execution readiness check failed'),
    'Skipped reason must cite execution readiness failure'
  );

  const syncHttpRes = await syncNowRoute.POST(
    makeAuthedRequest('/api/automation/sync-now', { method: 'POST', body: { sandbox: false } })
  );
  assert.strictEqual(syncHttpRes.status, 409, 'POST /api/automation/sync-now must return 409 when readiness fails');

  // B. Sandbox mode must remain permitted for pipeline verification without real credentials
  const sandboxSyncRes = await PipelineService.runSync({ force: true, sandbox: true });
  assert.strictEqual(sandboxSyncRes.success, true, 'Sandbox sync must be allowed to verify pipeline logic');
  console.log('✓ Pipeline service execution readiness guard verified (live sync blocked, sandbox test allowed).');

  // -------------------------------------------------------------
  // Test 4: Automation Settings Strict Validation
  // -------------------------------------------------------------
  console.log('\n[Test 4] Testing automation settings parameter validation...');
  // Invalid polling interval
  await assert.rejects(
    () => Repository.updateAutomationSettings({ polling_interval_minutes: 0 }),
    /Polling interval must be a whole number between 1 and 1440/
  );
  await assert.rejects(
    () => Repository.updateAutomationSettings({ polling_interval_minutes: 2000 }),
    /Polling interval must be a whole number between 1 and 1440/
  );

  // Invalid daily upload cap
  await assert.rejects(
    () => Repository.updateAutomationSettings({ max_uploads_per_day: -1 }),
    /Daily upload cap must be a whole number between 1 and 100/
  );
  await assert.rejects(
    () => Repository.updateAutomationSettings({ max_uploads_per_day: 0 }),
    /Daily upload cap must be a whole number between 1 and 100/
  );

  // Invalid visibility
  await assert.rejects(
    () => Repository.updateAutomationSettings({ default_visibility: 'invalid' as 'private' }),
    /Default YouTube visibility must be private, unlisted, or public/
  );

  // Valid updates succeed
  const updatedAuto = await Repository.updateAutomationSettings({
    polling_interval_minutes: 15,
    max_uploads_per_day: 10,
    default_visibility: 'private',
    drive_folder_name: 'Custom Shorts Archive',
  });
  assert.strictEqual(updatedAuto.polling_interval_minutes, 15);
  assert.strictEqual(updatedAuto.max_uploads_per_day, 10);
  assert.strictEqual(updatedAuto.default_visibility, 'private');
  assert.strictEqual(updatedAuto.drive_folder_name, 'Custom Shorts Archive');
  console.log('✓ Automation settings validation verified: Invalid intervals, caps, and visibilities rejected.');

  // -------------------------------------------------------------
  // Test 5: Production Destructive-Action Safeguards (/api/demo/reset)
  // -------------------------------------------------------------
  console.log('\n[Test 5] Verifying production demo reset safeguards...');
  const originalEnv = process.env.NODE_ENV;
  process.env.NODE_ENV = 'production';

  const prodResetRes = await demoResetRoute.POST(makeAuthedRequest('/api/demo/reset', { method: 'POST' }));
  assert.strictEqual(prodResetRes.status, 403, 'POST /api/demo/reset must return 403 in production');
  const prodResetBody = (await prodResetRes.json()) as { error?: string };
  assert.ok(
    prodResetBody.error?.includes('Demo reset is disabled in production'),
    'Response must cite production prohibition'
  );

  process.env.NODE_ENV = 'test';
  const testResetRes = await demoResetRoute.POST(makeAuthedRequest('/api/demo/reset', { method: 'POST' }));
  assert.strictEqual(testResetRes.status, 200, 'POST /api/demo/reset succeeds in non-production test mode');
  process.env.NODE_ENV = originalEnv;
  console.log('✓ Production demo reset guard verified: HTTP 403 in production, permitted in non-production.');

  // -------------------------------------------------------------
  // Test 6: Cloudflare D1 Naming & Copy Consistency
  // -------------------------------------------------------------
  console.log('\n[Test 6] Verifying D1 naming and architecture consistency in files...');
  const wranglerContent = fs.readFileSync(path.join(__dirname, '..', 'wrangler.jsonc'), 'utf8');
  assert.ok(wranglerContent.includes('"database_name": "autoshorts-db"'), 'wrangler.jsonc database_name must be autoshorts-db');
  assert.ok(wranglerContent.includes('"binding": "DB"'), 'wrangler.jsonc binding must be DB');

  const integrationsPanel = fs.readFileSync(
    path.join(__dirname, '..', 'src', 'components', 'settings', 'IntegrationsPanel.tsx'),
    'utf8'
  );
  assert.ok(
    !integrationsPanel.includes('autoshorts-d1'),
    'IntegrationsPanel must not reference stale autoshorts-d1 binding name'
  );
  assert.ok(
    integrationsPanel.includes('autoshorts-db'),
    'IntegrationsPanel must reference autoshorts-db'
  );

  const workflowCard = fs.readFileSync(
    path.join(__dirname, '..', 'src', 'components', 'automation', 'WorkflowEndpointsCard.tsx'),
    'utf8'
  );
  assert.ok(
    !workflowCard.includes('from PostgreSQL'),
    'WorkflowEndpointsCard must not claim data is retrieved from PostgreSQL'
  );

  const layoutContent = fs.readFileSync(
    path.join(__dirname, '..', 'src', 'app', 'layout.tsx'),
    'utf8'
  );
  assert.ok(
    !layoutContent.includes('PostgreSQL'),
    'Root layout metadata must not mention PostgreSQL'
  );
  console.log('✓ Naming and architecture consistency verified: autoshorts-db, Cloudflare Workers & D1.');

  console.log('\n================================================================');
  console.log('ALL PHASE 9.6 UI & DATA INTEGRITY TESTS PASSED (100% OK)');
  console.log('================================================================\n');
}

runPhase96TestSuite().catch((err) => {
  console.error('\nPhase 9.6 Test Suite Failed:', err);
  process.exit(1);
});
