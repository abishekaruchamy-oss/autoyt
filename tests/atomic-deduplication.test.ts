/**
 * tests/atomic-deduplication.test.ts
 *
 * Test suite for Blocker 3: Atomic Reel Deduplication
 * Verifies:
 * 1. Additive migration (0001_atomic_deduplication.sql) applies cleanly
 * 2. Database-enforced uniqueness constraints on reel_id and shortcode
 * 3. Concurrent submission race conditions: simultaneous calls resolve to identical job
 * 4. Crash-recovery: orphaned reels without jobs are recovered rather than permanently lost
 * 5. Atomic registration of discovered reels via registerDiscoveredReel
 */

import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { Repository } from '../src/server/db/repository';
import { createSqliteD1Adapter } from '../src/server/db/d1Client';

console.log('================================================================');
console.log('AUTOSHORTS ATOMIC REEL DEDUPLICATION TEST SUITE');
console.log('================================================================\n');

async function runDeduplicationTests() {
  const schemaPath = path.join(__dirname, '..', 'db', 'd1-schema.sql');
  const migrationPath = path.join(__dirname, '..', 'db', 'migrations', '0001_atomic_deduplication.sql');
  const schemaSql = fs.readFileSync(schemaPath, 'utf8');
  const migrationSql = fs.readFileSync(migrationPath, 'utf8');

  // Helper to create a fresh D1 SQLite instance
  function createFreshD1() {
    const rawDb = new DatabaseSync(':memory:');
    rawDb.exec(schemaSql);
    return { rawDb, d1: createSqliteD1Adapter(rawDb) };
  }

  // -------------------------------------------------------------
  // Test 1: Additive Migration Application on Pre-existing Schema
  // -------------------------------------------------------------
  console.log('[Test 1] Testing additive migration (0001_atomic_deduplication.sql)...');
  const baseRawDb = new DatabaseSync(':memory:');
  // Load base schema without the unique indexes or session URI to simulate pre-existing production database
  baseRawDb.exec(`
    CREATE TABLE IF NOT EXISTS monitored_profiles (
      id TEXT PRIMARY KEY, profile_url TEXT NOT NULL UNIQUE, username TEXT NOT NULL,
      display_name TEXT, avatar_url TEXT, status TEXT NOT NULL DEFAULT 'ACTIVE',
      status_reason TEXT, is_active_source INTEGER NOT NULL DEFAULT 0,
      last_checked_at TEXT, reels_detected_count INTEGER DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS upload_jobs (
      id TEXT PRIMARY KEY, reel_id TEXT NOT NULL, profile_id TEXT, account_username TEXT NOT NULL,
      caption TEXT, thumbnail_url TEXT, original_reel_url TEXT NOT NULL, shortcode TEXT,
      media_source_type TEXT DEFAULT 'PUBLIC_PROBE', rights_confirmed INTEGER NOT NULL DEFAULT 0,
      drive_file_id TEXT, drive_file_url TEXT, youtube_video_id TEXT, youtube_video_url TEXT,
      status TEXT NOT NULL DEFAULT 'SUBMITTED', error_details TEXT, retry_count INTEGER NOT NULL DEFAULT 0,
      max_retries INTEGER NOT NULL DEFAULT 3, detected_at TEXT NOT NULL, completed_at TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS reels (
      id TEXT PRIMARY KEY, profile_id TEXT, reel_id TEXT NOT NULL UNIQUE,
      caption TEXT, permalink TEXT NOT NULL, media_url TEXT, thumbnail_url TEXT,
      duration_seconds REAL, published_at TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);

  // Insert pre-existing row to prove migration does not drop existing data
  baseRawDb.prepare(`
    INSERT INTO upload_jobs (id, reel_id, account_username, original_reel_url, shortcode, status, detected_at)
    VALUES ('job_existing_01', 'reel_existing_01', 'creator', 'https://instagram.com/reel/existing', 'EXISTING01', 'COMPLETED', datetime('now'))
  `).run();

  // Apply additive migration SQL
  baseRawDb.exec(migrationSql);

  const existingRow = baseRawDb.prepare("SELECT * FROM upload_jobs WHERE id = 'job_existing_01'").get() as any;
  assert.ok(existingRow, 'Pre-existing upload job must remain intact after migration');
  assert.strictEqual(existingRow.encrypted_youtube_upload_session_uri, null, 'New column must be accessible and null');
  console.log('✓ Additive migration 0001 applied cleanly without data loss or table truncation.');

  // -------------------------------------------------------------
  // Test 2: Database-Enforced Unique Indexes (reel_id and shortcode)
  // -------------------------------------------------------------
  console.log('\n[Test 2] Testing database-enforced unique constraints on upload_jobs...');
  const { rawDb, d1 } = createFreshD1();
  Repository.setD1Database(d1);

  // Attempt duplicate insert via raw SQL to confirm SQLite raises constraint violation
  rawDb.prepare(`
    INSERT INTO upload_jobs (id, reel_id, account_username, original_reel_url, shortcode, status, detected_at)
    VALUES ('job_u1', 'reel_unique_test', 'creator', 'https://instagram.com/reel/unique', 'UNIQUE123', 'SUBMITTED', datetime('now'))
  `).run();

  let reelIdConflictCaught = false;
  try {
    rawDb.prepare(`
      INSERT INTO upload_jobs (id, reel_id, account_username, original_reel_url, shortcode, status, detected_at)
      VALUES ('job_u2', 'reel_unique_test', 'creator2', 'https://instagram.com/reel/unique', 'DIFFERENT', 'SUBMITTED', datetime('now'))
    `).run();
  } catch (err: any) {
    reelIdConflictCaught = err.message.includes('UNIQUE constraint failed');
  }
  assert.strictEqual(reelIdConflictCaught, true, 'Unique index on reel_id must reject duplicate reel_id inserts');

  let shortcodeConflictCaught = false;
  try {
    rawDb.prepare(`
      INSERT INTO upload_jobs (id, reel_id, account_username, original_reel_url, shortcode, status, detected_at)
      VALUES ('job_u3', 'reel_unique_other', 'creator3', 'https://instagram.com/reel/unique', 'UNIQUE123', 'SUBMITTED', datetime('now'))
    `).run();
  } catch (err: any) {
    shortcodeConflictCaught = err.message.includes('UNIQUE constraint failed');
  }
  assert.strictEqual(shortcodeConflictCaught, true, 'Partial unique index on shortcode must reject duplicate shortcodes');
  console.log('✓ Database-enforced uniqueness verified: duplicate reel_ids and shortcodes strictly rejected.');

  // -------------------------------------------------------------
  // Test 3: Concurrent Submissions of the Same Shortcode
  // -------------------------------------------------------------
  console.log('\n[Test 3] Testing concurrent submissions of the same shortcode...');
  const concurrentShortcode = 'ConcurrentShort99';
  const concurrentReelId = `reel_${concurrentShortcode}`;

  // Launch 10 simultaneous submission calls
  const submissionPromises = Array.from({ length: 10 }, (_, i) =>
    Repository.addUploadJob({
      reel_id: concurrentReelId,
      shortcode: concurrentShortcode,
      original_reel_url: `https://www.instagram.com/reel/${concurrentShortcode}/`,
      caption: `Concurrent submission attempt #${i + 1}`,
      account_username: 'concurrent_creator',
      status: 'SUBMITTED',
      rights_confirmed: true,
    })
  );

  const results = await Promise.all(submissionPromises);

  // All 10 callers must receive the exact same job ID
  const canonicalJobId = results[0].id;
  for (let i = 1; i < results.length; i++) {
    assert.strictEqual(
      results[i].id,
      canonicalJobId,
      `Concurrent call #${i} must return canonical job ID ${canonicalJobId}`
    );
  }

  // Exactly ONE row must exist in D1
  const jobCount = rawDb
    .prepare('SELECT COUNT(*) as count FROM upload_jobs WHERE shortcode = ?')
    .get(concurrentShortcode) as { count: number };
  assert.strictEqual(jobCount.count, 1, 'Exactly 1 upload job row must exist in D1 for concurrent submissions');
  console.log('✓ Concurrent submissions deduplicated: 10 parallel requests resolved to 1 canonical job.');

  // -------------------------------------------------------------
  // Test 4: Crash-Recovery (Preventing Work Loss from Orphaned Reels)
  // -------------------------------------------------------------
  console.log('\n[Test 4] Testing crash-recovery between Reel registration and job creation...');
  const orphanedReelId = 'reel_crashed_before_job_creation_77';

  // Simulate a crash: An interrupted cycle inserted into 'reels' table, but worker died before creating upload_jobs
  rawDb.prepare(`
    INSERT INTO reels (id, reel_id, permalink, published_at, created_at)
    VALUES ('reel_orphan_id', ?, 'https://instagram.com/reel/orphan', datetime('now'), datetime('now'))
  `).run(orphanedReelId);

  // Default isReelRecorded without recovery flag reports true
  const standardCheck = await Repository.isReelRecorded(orphanedReelId);
  assert.strictEqual(standardCheck, true, 'Standard check recognizes reel row');

  // Recovery-aware check (used by automated discovery loop) detects orphaned state
  const recoveryCheck = await Repository.isReelRecorded(orphanedReelId, { allowOrphanRecovery: true });
  assert.strictEqual(
    recoveryCheck,
    false,
    'Recovery-aware check must return false when no upload_job exists, allowing processing recovery'
  );

  // Discovery pipeline recovers and creates the missing job
  const recoveredJob = await Repository.addUploadJob({
    reel_id: orphanedReelId,
    shortcode: 'CrashedShort77',
    original_reel_url: 'https://instagram.com/reel/orphan',
    caption: 'Recovered reel after simulated worker crash',
    account_username: 'creator',
    status: 'DETECTED',
  });

  assert.ok(recoveredJob.id, 'Recovered job must be successfully registered');
  const jobNowExists = await Repository.isReelRecorded(orphanedReelId, { allowOrphanRecovery: true });
  assert.strictEqual(jobNowExists, true, 'Once job is registered, recovery check correctly reports true');
  console.log('✓ Orphaned reel recovery verified: simulated crash between registration and job queueing recovered successfully.');

  // -------------------------------------------------------------
  // Test 5: Atomic Batch Registration via registerDiscoveredReel
  // -------------------------------------------------------------
  console.log('\n[Test 5] Testing atomic batch registration (registerDiscoveredReel)...');
  const batchProfile = await Repository.addMonitoredProfile('https://instagram.com/batch_creator');
  const batchReelId = 'reel_atomic_batch_discovery_42';

  const discoveredJob = await Repository.registerDiscoveredReel(
    {
      reel_id: batchReelId,
      permalink: 'https://instagram.com/reel/atomic42',
      caption: 'Atomic batch test #shorts',
    },
    batchProfile
  );

  assert.ok(discoveredJob.id, 'Discovered job must receive valid ID');
  assert.strictEqual(discoveredJob.reel_id, batchReelId);
  assert.strictEqual(discoveredJob.status, 'DETECTED');

  // Verify both tables were written in the single batch
  const reelRow = rawDb.prepare('SELECT id FROM reels WHERE reel_id = ?').get(batchReelId);
  assert.ok(reelRow, 'Reels table row must exist from batch');

  const jobRow = rawDb.prepare('SELECT id FROM upload_jobs WHERE reel_id = ?').get(batchReelId);
  assert.ok(jobRow, 'Upload_jobs table row must exist from batch');

  // Second registration of same reel is a no-op / returns existing job
  const duplicateBatchJob = await Repository.registerDiscoveredReel(
    {
      reel_id: batchReelId,
      permalink: 'https://instagram.com/reel/atomic42',
    },
    batchProfile
  );
  assert.strictEqual(duplicateBatchJob.id, discoveredJob.id, 'Duplicate discovery must return existing job');
  console.log('✓ Atomic batch registration verified: zero-gap atomic commitment across reels and upload_jobs.');

  console.log('\n================================================================');
  console.log('ALL ATOMIC REEL DEDUPLICATION TESTS PASSED (100% OK)');
  console.log('================================================================');
}

runDeduplicationTests().catch((err) => {
  console.error('\nAtomic Deduplication Tests Failed:', err);
  process.exit(1);
});
