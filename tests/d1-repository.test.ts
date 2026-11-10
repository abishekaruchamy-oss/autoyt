/**
 * tests/d1-repository.test.ts
 *
 * Comprehensive Cloudflare D1 Repository Test Suite for AutoShorts.
 * Tests:
 * 1. Cloudflare D1 SQLite Schema Migration & Table Creation
 * 2. Profile CRUD, Active Source Switching & Probe Lifecycle
 * 3. Atomic Concurrency Mutex Locking & Stale Lock Recovery
 * 4. Durable Idempotency (D1 Reels Store & Deduplication)
 * 5. Reel Submission & Upload Job Lifecycle (with nullable profile)
 * 6. AES-256-GCM Google OAuth Token Persistence & Refresh
 * 7. Ephemeral OAuth State Storage & Replay Attack Defense
 * 8. Worker Restart / Isolate Reinitialization Persistence
 * 9. Production Invariant: Prohibition of Silent In-Memory Fallback
 */

import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { Repository } from '../src/server/db/repository';
import { createSqliteD1Adapter } from '../src/server/db/d1Client';
import { encryptToken, decryptToken } from '../src/lib/crypto';

console.log('================================================================');
console.log('AUTOSHORTS CLOUDFLARE D1 REPOSITORY & PERSISTENCE TEST SUITE');
console.log('================================================================\n');

async function runD1TestSuite() {
  const schemaPath = path.join(__dirname, '..', 'db', 'd1-schema.sql');
  const schemaSql = fs.readFileSync(schemaPath, 'utf8');

  // Helper to create a fresh D1 SQLite instance
  function createFreshD1() {
    const rawDb = new DatabaseSync(':memory:');
    rawDb.exec(schemaSql);
    return { rawDb, d1: createSqliteD1Adapter(rawDb) };
  }

  // -------------------------------------------------------------
  // Test 1: Cloudflare D1 Schema Execution & Initial State
  // -------------------------------------------------------------
  console.log('[Test 1] Verifying Cloudflare D1 Schema & Initial State...');
  const { rawDb, d1 } = createFreshD1();
  Repository.setD1Database(d1);

  const tables = rawDb
    .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
    .all() as { name: string }[];
  const tableNames = tables.map((t) => t.name);

  assert.ok(tableNames.includes('monitored_profiles'), 'monitored_profiles table must exist');
  assert.ok(tableNames.includes('automation_settings'), 'automation_settings table must exist');
  assert.ok(tableNames.includes('reels'), 'reels table must exist');
  assert.ok(tableNames.includes('upload_jobs'), 'upload_jobs table must exist');
  assert.ok(tableNames.includes('activity_logs'), 'activity_logs table must exist');
  assert.ok(tableNames.includes('integrations_config'), 'integrations_config table must exist');
  assert.ok(tableNames.includes('google_credentials'), 'google_credentials table must exist');
  assert.ok(tableNames.includes('oauth_states'), 'oauth_states table must exist');
  console.log('✓ All 8 Cloudflare D1 tables verified in SQLite catalog.');

  // Verify initial automation settings seeded
  const initialSettings = await Repository.getAutomationSettings();
  assert.strictEqual(initialSettings.id, 'default');
  assert.strictEqual(initialSettings.is_enabled, true);
  assert.strictEqual(initialSettings.polling_interval_minutes, 30);
  assert.strictEqual(initialSettings.is_running, false);
  console.log('✓ Default automation_settings row verified (id="default", is_enabled=true).');

  // -------------------------------------------------------------
  // Test 2: Profile CRUD & Active Source Management in D1
  // -------------------------------------------------------------
  console.log('\n[Test 2] Testing Profile CRUD & Active Source Management in D1...');
  const profile1 = await Repository.addMonitoredProfile(
    'https://www.instagram.com/techtrends_daily/',
    'Tech Trends Daily'
  );
  assert.strictEqual(profile1.username, 'techtrends_daily');
  assert.strictEqual(profile1.is_active_source, true, 'First profile should become active source');

  const profile2 = await Repository.addMonitoredProfile(
    'https://www.instagram.com/creativestudio_la/',
    'Creative Studio LA'
  );
  assert.strictEqual(profile2.username, 'creativestudio_la');
  assert.strictEqual(profile2.is_active_source, false, 'Second profile should not be active source');

  // Switch active source
  const switched = await Repository.setActiveMonitoredProfile(profile2.id);
  assert.strictEqual(switched?.id, profile2.id);
  assert.strictEqual(switched?.is_active_source, true);

  const active = await Repository.getActiveMonitoredProfile();
  assert.strictEqual(active?.id, profile2.id, 'Active monitored profile should now be profile2');

  // Toggle monitoring
  const paused = await Repository.toggleProfileMonitoring(profile2.id, true);
  assert.strictEqual(paused?.status, 'PAUSED');

  const resumed = await Repository.toggleProfileMonitoring(profile2.id, false);
  assert.strictEqual(resumed?.status, 'ACTIVE');

  // Update profile
  const updated = await Repository.updateMonitoredProfile(profile1.id, {
    display_name: 'Tech Trends Daily Updated',
  });
  assert.strictEqual(updated?.display_name, 'Tech Trends Daily Updated');

  console.log('✓ Profile CRUD, active source promotion, pause/resume, and updates verified in D1.');

  // -------------------------------------------------------------
  // Test 3: Atomic Concurrency Mutex & Stale Lock Recovery
  // -------------------------------------------------------------
  console.log('\n[Test 3] Testing Atomic Concurrency Mutex & Stale Lock Recovery in D1...');

  // 1. Worker A acquires lock
  const lockA = await Repository.acquireAutomationLock();
  assert.strictEqual(lockA, true, 'Worker A should acquire lock');

  // 2. Worker B attempts to acquire while locked
  const lockB = await Repository.acquireAutomationLock();
  assert.strictEqual(lockB, false, 'Worker B must be rejected while lock is held');

  // 3. Worker A releases lock successfully
  await Repository.releaseAutomationLock(true);

  // 4. Worker B acquires lock now
  const lockB2 = await Repository.acquireAutomationLock();
  assert.strictEqual(lockB2, true, 'Worker B should now successfully acquire lock');

  // 5. Test Stale Lock Break (simulate lock acquired 15 minutes ago)
  const fifteenMinutesAgo = new Date(Date.now() - 15 * 60 * 1000).toISOString();
  await d1
    .prepare('UPDATE automation_settings SET lock_acquired_at = ? WHERE id = \'default\'')
    .bind(fifteenMinutesAgo)
    .run();

  const staleLockBroke = await Repository.acquireAutomationLock();
  assert.strictEqual(staleLockBroke, true, 'Stale lock (>10m) must be automatically broken');

  await Repository.releaseAutomationLock(true);
  console.log('✓ Atomic concurrency mutex, race condition prevention, and stale-lock recovery verified.');

  // -------------------------------------------------------------
  // Test 4: Durable Idempotency (D1 Reels Table)
  // -------------------------------------------------------------
  console.log('\n[Test 4] Testing Durable Idempotency (D1 Reels Table)...');
  const testReelId = 'reel_test_canonical_9988';

  const seenBefore = await Repository.isReelRecorded(testReelId);
  assert.strictEqual(seenBefore, false, 'Reel should not be recorded initially');

  const recorded = await Repository.recordReel(testReelId, profile1.id, 'https://instagram.com/reel/9988');
  assert.strictEqual(recorded, true, 'Reel should be recorded on first occurrence');

  const seenAfter = await Repository.isReelRecorded(testReelId);
  assert.strictEqual(seenAfter, true, 'Reel must be reported as recorded after insertion');

  const recordAgain = await Repository.recordReel(testReelId, profile1.id);
  assert.strictEqual(recordAgain, false, 'Duplicate recording must return false');
  console.log('✓ Durable idempotency verified in D1: duplicate Reel detection preserved.');

  // -------------------------------------------------------------
  // Test 5: Upload Jobs & Manual Reel Submissions in D1
  // -------------------------------------------------------------
  console.log('\n[Test 5] Testing Upload Jobs & Manual Submissions in D1...');
  const newJob = await Repository.addUploadJob({
    reel_id: 'reel_manual_submission_01',
    shortcode: 'ManualShort01',
    original_reel_url: 'https://www.instagram.com/reel/ManualShort01/',
    caption: 'Manual Creator Reel Submission #shorts',
    account_username: 'creator_studio',
    status: 'SUBMITTED',
    rights_confirmed: true,
    media_source_type: 'USER_DIRECT_STREAM',
  });

  assert.ok(newJob.id, 'Job should receive a generated UUID');
  assert.strictEqual(newJob.shortcode, 'ManualShort01');
  assert.strictEqual(newJob.status, 'SUBMITTED');

  // Retrieve by shortcode
  const fetchedByShortcode = await Repository.getUploadJobByShortcode('ManualShort01');
  assert.ok(fetchedByShortcode, 'Job must be retrievable by shortcode');
  assert.strictEqual(fetchedByShortcode?.id, newJob.id);

  // Transition through pipeline states
  const validatingJob = await Repository.updateUploadJob(newJob.id, { status: 'VALIDATING' });
  assert.strictEqual(validatingJob?.status, 'VALIDATING');

  const driveJob = await Repository.updateUploadJob(newJob.id, {
    status: 'STORED_IN_DRIVE',
    drive_file_id: 'drive_file_d1_test_123',
    drive_file_url: 'https://drive.google.com/file/d/drive_file_d1_test_123/view',
  });
  assert.strictEqual(driveJob?.status, 'STORED_IN_DRIVE');
  assert.strictEqual(driveJob?.drive_file_id, 'drive_file_d1_test_123');

  const completedJob = await Repository.updateUploadJob(newJob.id, {
    status: 'COMPLETED',
    youtube_video_id: 'yt_vid_d1_99',
    youtube_video_url: 'https://youtube.com/shorts/yt_vid_d1_99',
    completed_at: new Date().toISOString(),
  });
  assert.strictEqual(completedJob?.status, 'COMPLETED');

  // Filter jobs
  const completedJobs = await Repository.getUploadJobs({ status: 'COMPLETED' });
  assert.ok(completedJobs.some((j) => j.id === newJob.id), 'Filter by status must return completed job');

  const searchJobs = await Repository.getUploadJobs({ search: 'Manual Creator' });
  assert.ok(searchJobs.some((j) => j.id === newJob.id), 'Search filter must find matching caption');
  console.log('✓ Manual Reel submission, pipeline status transitions, and search filters verified in D1.');

  // -------------------------------------------------------------
  // Test 6: AES-256-GCM Google Credentials & Refresh in D1
  // -------------------------------------------------------------
  console.log('\n[Test 6] Testing Encrypted Google Credentials & Refresh in D1...');
  const rawAccess = 'ya29.a0AfH6SMC_mock_access_token_d1_testing';
  const rawRefresh = '1//0gMOCK_refresh_token_d1_secure_storage';
  const encAccess = encryptToken(rawAccess);
  const encRefresh = encryptToken(rawRefresh);
  const expiresAt = Date.now() + 3600 * 1000;

  await Repository.saveGoogleCredentials({
    encryptedAccessToken: encAccess,
    encryptedRefreshToken: encRefresh,
    expiresAt,
    email: 'autoshorts.production@gmail.com',
    channelId: 'UC_D1_PROD_CHANNEL_01',
    channelTitle: 'AutoShorts Production Channel',
    updatedAt: new Date().toISOString(),
  });

  const storedCreds = await Repository.getGoogleCredentials();
  assert.ok(storedCreds, 'Stored Google credentials must exist in D1');
  assert.strictEqual(storedCreds?.email, 'autoshorts.production@gmail.com');
  assert.strictEqual(decryptToken(storedCreds!.encryptedAccessToken), rawAccess);
  assert.strictEqual(decryptToken(storedCreds!.encryptedRefreshToken!), rawRefresh);

  // Refresh token preservation when access token is refreshed
  const refreshedRawAccess = 'ya29.a0AfH6SMC_refreshed_access_token_d1_new';
  const encRefreshedAccess = encryptToken(refreshedRawAccess);

  await Repository.saveGoogleCredentials({
    encryptedAccessToken: encRefreshedAccess,
    expiresAt: Date.now() + 3600 * 1000,
    email: 'autoshorts.production@gmail.com',
    channelId: 'UC_D1_PROD_CHANNEL_01',
    channelTitle: 'AutoShorts Production Channel',
    updatedAt: new Date().toISOString(),
  });

  const afterRefresh = await Repository.getGoogleCredentials();
  assert.strictEqual(decryptToken(afterRefresh!.encryptedAccessToken), refreshedRawAccess);
  assert.strictEqual(
    decryptToken(afterRefresh!.encryptedRefreshToken!),
    rawRefresh,
    'Refresh token must be preserved via COALESCE during access token updates'
  );
  console.log('✓ Encrypted token persistence, AES-256-GCM at rest, and refresh-token retention verified.');

  // -------------------------------------------------------------
  // Test 7: Ephemeral OAuth States & CSRF Defense in D1
  // -------------------------------------------------------------
  console.log('\n[Test 7] Testing Ephemeral OAuth States & CSRF Defense in D1...');
  const testState = 'csrf_state_token_random_hex_999888';
  const redirectUri = 'https://autoshorts.workers.dev/api/auth/google/callback';

  await Repository.saveOAuthState(testState, redirectUri);

  // First validation should succeed (atomic consumption)
  const firstValidation = await Repository.validateAndConsumeOAuthState(testState);
  assert.strictEqual(firstValidation, true, 'Valid unexpired OAuth state must be accepted');

  // Second validation of the same state MUST fail (single-use token against replay attacks)
  const replayValidation = await Repository.validateAndConsumeOAuthState(testState);
  assert.strictEqual(replayValidation, false, 'Replayed OAuth state must be strictly rejected');

  // Expired state test
  const expiredState = 'csrf_state_expired_token_000';
  await Repository.saveOAuthState(expiredState, redirectUri, -1000); // Expired 1 second ago
  const expiredValidation = await Repository.validateAndConsumeOAuthState(expiredState);
  assert.strictEqual(expiredValidation, false, 'Expired OAuth state must be rejected');
  console.log('✓ Ephemeral OAuth CSRF defense verified: single-use tokens and expiration enforced in D1.');

  // -------------------------------------------------------------
  // Test 8: Worker Restart / Isolate Reinitialization Persistence
  // -------------------------------------------------------------
  console.log('\n[Test 8] Testing Worker Restart & Isolate Reinitialization...');
  // Simulate complete isolate shutdown:
  // We point a completely new Repository session to the same D1 raw database
  Repository.setD1Database(null); // Clear active binding
  Repository.resetDemo(); // Clear any in-memory state

  // Reinitialize as if a new Cloudflare Worker isolate spawned
  const restartedD1 = createSqliteD1Adapter(rawDb);
  Repository.setD1Database(restartedD1);

  const profilesAfterRestart = await Repository.getMonitoredProfiles();
  assert.strictEqual(profilesAfterRestart.length, 2, 'Profiles must persist across isolate restarts');

  const jobsAfterRestart = await Repository.getUploadJobs();
  assert.strictEqual(jobsAfterRestart.length, 1, 'Upload jobs must persist across isolate restarts');
  assert.strictEqual(jobsAfterRestart[0].shortcode, 'ManualShort01');

  const credsAfterRestart = await Repository.getGoogleCredentials();
  assert.ok(credsAfterRestart, 'Google credentials must persist across isolate restarts');
  assert.strictEqual(credsAfterRestart?.email, 'autoshorts.production@gmail.com');
  console.log('✓ Worker isolate restart simulation: 100% of state preserved in D1 database.');

  // -------------------------------------------------------------
  // Test 9: Production Invariant (Prohibition of Silent In-Memory Fallback)
  // -------------------------------------------------------------
  console.log('\n[Test 9] Testing Production Invariant: Silent Fallback Prohibition...');
  const originalEnv = process.env.NODE_ENV;
  process.env.NODE_ENV = 'production';
  Repository.setD1Database(null); // Simulate missing D1 binding in production

  let thrownError: Error | null = null;
  try {
    await Repository.getMonitoredProfiles();
  } catch (err) {
    thrownError = err as Error;
  } finally {
    process.env.NODE_ENV = originalEnv;
  }

  assert.ok(thrownError, 'Production environment must throw when D1 is missing');
  assert.ok(
    thrownError.message.includes('strictly prohibited') ||
      thrownError.message.includes('FATAL CONFIGURATION ERROR'),
    'Error message must explicitly cite prohibition of silent in-memory fallback'
  );
  console.log('✓ Production invariant enforced: System refuses to run without D1 in production.');

  // -------------------------------------------------------------
  // Test 10: Dashboard Metrics Aggregates in D1
  // -------------------------------------------------------------
  console.log('\n[Test 10] Testing Dashboard Metrics Aggregation in D1...');
  Repository.setD1Database(restartedD1);
  const metrics = await Repository.getDashboardMetrics();

  assert.strictEqual(metrics.total_profiles, 2);
  assert.strictEqual(metrics.total_videos_uploaded, 1);
  assert.strictEqual(metrics.failed_uploads, 0);
  assert.strictEqual(metrics.in_progress_uploads, 0);
  assert.ok(metrics.recent_activity.length > 0, 'Recent activity logs must be populated');
  console.log('✓ Dashboard metrics aggregations successfully computed from D1 SQL queries.');

  console.log('\n================================================================');
  console.log('ALL 10 D1 REPOSITORY & PERSISTENCE TESTS PASSED (100% OK)');
  console.log('================================================================');
}

runD1TestSuite().catch((err) => {
  console.error('\nD1 Repository Test Suite Failed:', err);
  process.exit(1);
});
