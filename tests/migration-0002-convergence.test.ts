/**
 * tests/migration-0002-convergence.test.ts
 *
 * LOCAL SQLite MIGRATION CONVERGENCE & HARDENING TEST SUITE
 * (Note: These are isolated local SQLite tests, NOT executed against live remote D1)
 *
 * Verifies the complete Phase 6.4 migration hardening requirements:
 * 1. Actual old production schema (Pre-0001)
 * 2. Migration 0001 (Atomic deduplication + encrypted session column)
 * 3. Bootstrap tracking script (d1_migrations schema & 0001 registration)
 * 4. Corrected Migration 0002 (active FK enforcement without PRAGMA foreign_keys=OFF/ON, fail-fast staging table)
 * 5. Schema convergence with canonical db/d1-schema.sql
 * 6. AMBIGUOUS_UPLOAD insert/update support & invalid status rejection
 * 7. Unique reel_id & partial unique shortcode enforcement (including multiple NULLs)
 * 8. Row preservation across migration
 * 9. Foreign key integrity & PRAGMA foreign_key_check verification
 * 10. Failure handling (unexpected upload_jobs_new fails fast cleanly without data corruption) & rerun safety
 */

import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

console.log('================================================================');
console.log('LOCAL SQLITE MIGRATION CONVERGENCE & HARDENING TEST SUITE');
console.log('(Running in isolated local SQLite DatabaseSync environment)');
console.log('================================================================\n');

function runMigrationConvergenceTests() {
  const migration0001Sql = fs.readFileSync(
    path.join(process.cwd(), 'db', 'migrations', '0001_atomic_deduplication.sql'),
    'utf8'
  );
  const migration0002Sql = fs.readFileSync(
    path.join(process.cwd(), 'db', 'migrations', '0002_upload_status_compatibility.sql'),
    'utf8'
  );
  const bootstrapSql = fs.readFileSync(
    path.join(process.cwd(), 'db', 'bootstrap-d1-migrations-0001.sql'),
    'utf8'
  );
  const canonicalSchemaSql = fs.readFileSync(
    path.join(process.cwd(), 'db', 'd1-schema.sql'),
    'utf8'
  );

  // Verify Migration 0002 obeys D1 PRAGMA & fail-fast rules statically
  const executable0002Sql = migration0002Sql.replace(/--.*$/gm, '');
  assert.strictEqual(
    /PRAGMA\s+foreign_keys/i.test(executable0002Sql),
    false,
    'Migration 0002 must NOT execute PRAGMA foreign_keys (disallowed in D1 implicit transactions)'
  );
  assert.strictEqual(
    /CREATE\s+TABLE\s+IF\s+NOT\s+EXISTS\s+upload_jobs_new/i.test(executable0002Sql),
    false,
    'Migration 0002 must use fail-fast CREATE TABLE upload_jobs_new (without IF NOT EXISTS)'
  );
  assert.strictEqual(
    /CREATE\s+TABLE\s+upload_jobs_new\s*\(/i.test(executable0002Sql),
    true,
    'Migration 0002 must create upload_jobs_new fail-fast'
  );
  console.log('[Pre-Check] Static hardening checks passed (No PRAGMA foreign_keys toggle, fail-fast temp table).');

  // Old production table schema definition (Pre-0001 state)
  const oldProductionSchemaSql = `
    PRAGMA foreign_keys = ON;

    CREATE TABLE monitored_profiles (
        id TEXT PRIMARY KEY,
        profile_url TEXT NOT NULL UNIQUE,
        username TEXT NOT NULL UNIQUE,
        display_name TEXT,
        avatar_url TEXT,
        status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'PAUSED', 'RESTRICTED', 'NOT_FOUND', 'ERROR')),
        status_reason TEXT NOT NULL DEFAULT 'Pending initial probe',
        is_active_source INTEGER NOT NULL DEFAULT 0,
        last_checked_at TEXT,
        reels_detected_count INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE upload_jobs (
        id TEXT PRIMARY KEY,
        reel_id TEXT NOT NULL,
        profile_id TEXT REFERENCES monitored_profiles(id) ON DELETE SET NULL,
        account_username TEXT NOT NULL,
        caption TEXT,
        thumbnail_url TEXT,
        original_reel_url TEXT NOT NULL,
        shortcode TEXT,
        media_source_type TEXT DEFAULT 'PUBLIC_PROBE',
        rights_confirmed INTEGER NOT NULL DEFAULT 0,
        drive_file_id TEXT,
        drive_file_url TEXT,
        youtube_video_id TEXT,
        youtube_video_url TEXT,
        status TEXT NOT NULL DEFAULT 'SUBMITTED' CHECK (status IN (
            'SUBMITTED', 'VALIDATING', 'RESOLVING_MEDIA', 'MEDIA_AVAILABLE',
            'WAITING_FOR_AUTHORIZED_MEDIA', 'ARCHIVING_TO_DRIVE', 'STORED_IN_DRIVE',
            'UPLOADING_TO_YOUTUBE', 'VERIFYING_UPLOAD', 'COMPLETED', 'FAILED',
            -- Legacy status aliases
            'DETECTED', 'DOWNLOADING', 'STORED_DRIVE', 'RETRYING'
        )),
        error_details TEXT,
        retry_count INTEGER NOT NULL DEFAULT 0,
        max_retries INTEGER NOT NULL DEFAULT 3,
        detected_at TEXT NOT NULL,
        completed_at TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX idx_upload_jobs_status ON upload_jobs(status);
    CREATE INDEX idx_upload_jobs_profile ON upload_jobs(profile_id);
    CREATE INDEX idx_upload_jobs_shortcode ON upload_jobs(shortcode);
    CREATE INDEX idx_upload_jobs_reel_id ON upload_jobs(reel_id);
  `;

  const db = new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys = ON;');
  db.exec(oldProductionSchemaSql);

  console.log('[Step 1] Initialized local SQLite database with old production schema (FK enforcement ON).');

  // Seed production-representative records (with nullable and active FKs)
  db.exec(`
    INSERT INTO monitored_profiles (id, profile_url, username)
    VALUES ('prof_1', 'https://instagram.com/test_creator', 'test_creator');

    INSERT INTO upload_jobs (
      id, reel_id, profile_id, account_username, original_reel_url, shortcode, status, detected_at
    ) VALUES (
      'job_existing_1', 'reel_100', 'prof_1', 'test_creator', 'https://instagram.com/reel/C123', 'C123', 'COMPLETED', '2026-11-01T10:00:00Z'
    );

    INSERT INTO upload_jobs (
      id, reel_id, profile_id, account_username, original_reel_url, shortcode, status, detected_at
    ) VALUES (
      'job_existing_2', 'reel_101', NULL, 'manual_creator', 'https://instagram.com/reel/C124', 'C124', 'FAILED', '2026-11-01T11:00:00Z'
    );
  `);
  console.log('[Step 2] Seeded existing production records (both linked and NULL profile_id).');

  // Apply Migration 0001
  db.exec(migration0001Sql);
  console.log('[Step 3] Applied migration 0001_atomic_deduplication.sql.');

  // Verify bootstrap tracking script creates d1_migrations and records 0001 cleanly
  db.exec(bootstrapSql);
  const trackedMigrations = db.prepare('SELECT id, name FROM d1_migrations').all() as { id: number; name: string }[];
  assert.strictEqual(trackedMigrations.length, 1);
  assert.strictEqual(trackedMigrations[0].name, '0001_atomic_deduplication.sql');
  // Bootstrap script is idempotent when rerun
  db.exec(bootstrapSql);
  const trackedAfterRerun = db.prepare('SELECT id, name FROM d1_migrations').all() as { id: number; name: string }[];
  assert.strictEqual(trackedAfterRerun.length, 1);
  console.log('[Step 4] Applied bootstrap tracking script & verified idempotent d1_migrations state.');

  // Verify that under 0001, AMBIGUOUS_UPLOAD fails due to old CHECK constraint
  let ambiguousFailedBefore0002 = false;
  try {
    db.prepare(`
      INSERT INTO upload_jobs (
        id, reel_id, profile_id, account_username, original_reel_url, shortcode, status, detected_at
      ) VALUES (
        'job_ambig_test', 'reel_102', 'prof_1', 'test_creator', 'https://instagram.com/reel/C125', 'C125', 'AMBIGUOUS_UPLOAD', datetime('now')
      );
    `).run();
  } catch (err: any) {
    ambiguousFailedBefore0002 = true;
    assert.match(err.message, /CHECK constraint failed/);
  }
  assert.strictEqual(ambiguousFailedBefore0002, true, 'AMBIGUOUS_UPLOAD must fail under migration 0001');

  // Test Failure Handling: Simulate pre-existing stale upload_jobs_new table before applying 0002
  const failDb = new DatabaseSync(':memory:');
  failDb.exec('PRAGMA foreign_keys = ON;');
  failDb.exec(oldProductionSchemaSql);
  failDb.exec(migration0001Sql);
  failDb.exec(`
    INSERT INTO upload_jobs (id, reel_id, account_username, original_reel_url, detected_at)
    VALUES ('keep_me', 'reel_keep', 'user1', 'https://instagram.com/reel/keep', '2026-11-01T00:00:00Z');
  `);
  failDb.exec('CREATE TABLE upload_jobs_new (id TEXT PRIMARY KEY, stale_col TEXT);');
  failDb.exec("INSERT INTO upload_jobs_new (id, stale_col) VALUES ('stale_row', 'stale');");

  let failFastTriggered = false;
  try {
    failDb.exec('BEGIN TRANSACTION;');
    failDb.exec(migration0002Sql);
    failDb.exec('COMMIT;');
  } catch (err: any) {
    failDb.exec('ROLLBACK;');
    failFastTriggered = true;
    assert.match(err.message, /table upload_jobs_new already exists/);
  }
  assert.strictEqual(failFastTriggered, true, 'Migration 0002 must fail fast if upload_jobs_new exists');
  const preservedAfterFailure = failDb.prepare('SELECT id FROM upload_jobs WHERE id = ?').get('keep_me') as any;
  assert.strictEqual(preservedAfterFailure?.id, 'keep_me', 'Original upload_jobs must remain untouched after fail-fast rollback');
  console.log('[Step 5] Verified fail-fast & transaction rollback when unexpected upload_jobs_new exists.');

  // Apply Migration 0002 inside explicit transaction with PRAGMA foreign_keys = ON
  const fkSetting = db.prepare('PRAGMA foreign_keys;').get() as { foreign_keys: number };
  assert.strictEqual(fkSetting.foreign_keys, 1, 'PRAGMA foreign_keys must be enabled during migration');

  db.exec('BEGIN TRANSACTION;');
  db.exec(migration0002Sql);
  db.exec('COMMIT;');
  console.log('[Step 6] Applied migration 0002_upload_status_compatibility.sql cleanly inside transaction with FKs enabled.');

  // Verify foreign keys state remained ON (not silently disabled)
  const fkSettingAfter = db.prepare('PRAGMA foreign_keys;').get() as { foreign_keys: number };
  assert.strictEqual(fkSettingAfter.foreign_keys, 1, 'PRAGMA foreign_keys must remain enabled after migration');

  // Run PRAGMA foreign_key_check verification
  const fkViolations = db.prepare('PRAGMA foreign_key_check;').all();
  assert.strictEqual(fkViolations.length, 0, `PRAGMA foreign_key_check returned violations: ${JSON.stringify(fkViolations)}`);
  console.log('  -> Confirmed: PRAGMA foreign_key_check returned 0 violations.');

  // Verify pre-existing records survived intact
  const existingJob1 = db.prepare('SELECT * FROM upload_jobs WHERE id = ?').get('job_existing_1') as any;
  assert.ok(existingJob1, 'job_existing_1 must survive table rebuild');
  assert.strictEqual(existingJob1.reel_id, 'reel_100');
  assert.strictEqual(existingJob1.shortcode, 'C123');
  assert.strictEqual(existingJob1.status, 'COMPLETED');
  assert.strictEqual(existingJob1.profile_id, 'prof_1');
  assert.strictEqual(existingJob1.detected_at, '2026-11-01T10:00:00Z');

  const existingJob2 = db.prepare('SELECT * FROM upload_jobs WHERE id = ?').get('job_existing_2') as any;
  assert.ok(existingJob2, 'job_existing_2 must survive table rebuild');
  assert.strictEqual(existingJob2.status, 'FAILED');
  assert.strictEqual(existingJob2.profile_id, null);
  console.log('  -> Confirmed: All seeded records preserved intact with exact field fidelity.');

  // Verify AMBIGUOUS_UPLOAD insert and update
  db.prepare(`
    INSERT INTO upload_jobs (
      id, reel_id, profile_id, account_username, original_reel_url, shortcode,
      status, encrypted_youtube_upload_session_uri, detected_at
    ) VALUES (
      'job_ambiguous_new', 'reel_103', 'prof_1', 'test_creator', 'https://instagram.com/reel/C126', 'C126',
      'AMBIGUOUS_UPLOAD', 'enc:test-session-uri', datetime('now')
    );
  `).run();

  const insertedAmbig = db.prepare('SELECT * FROM upload_jobs WHERE id = ?').get('job_ambiguous_new') as any;
  assert.strictEqual(insertedAmbig.status, 'AMBIGUOUS_UPLOAD');
  assert.strictEqual(insertedAmbig.encrypted_youtube_upload_session_uri, 'enc:test-session-uri');

  db.prepare('UPDATE upload_jobs SET status = ? WHERE id = ?').run('AMBIGUOUS_UPLOAD', 'job_existing_2');
  const updatedJob2 = db.prepare('SELECT status FROM upload_jobs WHERE id = ?').get('job_existing_2') as any;
  assert.strictEqual(updatedJob2.status, 'AMBIGUOUS_UPLOAD');
  console.log('  -> Confirmed: AMBIGUOUS_UPLOAD insert and update succeed cleanly.');

  // Verify invalid status rejected
  let invalidStatusFailed = false;
  try {
    db.prepare('UPDATE upload_jobs SET status = ? WHERE id = ?').run('INVALID_BOGUS_STATUS', 'job_existing_1');
  } catch (err: any) {
    invalidStatusFailed = true;
    assert.match(err.message, /CHECK constraint failed/);
  }
  assert.strictEqual(invalidStatusFailed, true);
  console.log('  -> Confirmed: Invalid status rejected by CHECK constraint.');

  // Verify unique constraints & partial shortcode index
  let duplicateReelFailed = false;
  try {
    db.prepare(`
      INSERT INTO upload_jobs (id, reel_id, account_username, original_reel_url, shortcode, status, detected_at)
      VALUES ('job_dup_reel', 'reel_100', 'test_creator', 'https://instagram.com/reel/C999', 'C999', 'SUBMITTED', datetime('now'));
    `).run();
  } catch (err: any) {
    duplicateReelFailed = true;
    assert.match(err.message, /UNIQUE constraint failed/);
  }
  assert.strictEqual(duplicateReelFailed, true);

  let duplicateShortcodeFailed = false;
  try {
    db.prepare(`
      INSERT INTO upload_jobs (id, reel_id, account_username, original_reel_url, shortcode, status, detected_at)
      VALUES ('job_dup_sc', 'reel_104', 'test_creator', 'https://instagram.com/reel/C123', 'C123', 'SUBMITTED', datetime('now'));
    `).run();
  } catch (err: any) {
    duplicateShortcodeFailed = true;
    assert.match(err.message, /UNIQUE constraint failed/);
  }
  assert.strictEqual(duplicateShortcodeFailed, true);

  // Multiple NULL shortcodes permitted by partial unique index
  db.prepare(`
    INSERT INTO upload_jobs (id, reel_id, account_username, original_reel_url, shortcode, status, detected_at)
    VALUES ('job_null_sc_1', 'reel_105', 'test_creator', 'https://instagram.com/reel/m1', NULL, 'SUBMITTED', datetime('now'));
  `).run();
  db.prepare(`
    INSERT INTO upload_jobs (id, reel_id, account_username, original_reel_url, shortcode, status, detected_at)
    VALUES ('job_null_sc_2', 'reel_106', 'test_creator', 'https://instagram.com/reel/m2', NULL, 'SUBMITTED', datetime('now'));
  `).run();
  console.log('  -> Confirmed: Unique reel_id, unique non-null shortcode, and multi-NULL shortcode rules enforced.');

  // Verify foreign key constraint & ON DELETE SET NULL
  let fkFailed = false;
  try {
    db.prepare(`
      INSERT INTO upload_jobs (id, reel_id, profile_id, account_username, original_reel_url, shortcode, status, detected_at)
      VALUES ('job_bad_fk', 'reel_107', 'nonexistent_prof', 'test_creator', 'https://instagram.com/reel/C9999', 'C9999', 'SUBMITTED', datetime('now'));
    `).run();
  } catch (err: any) {
    fkFailed = true;
    assert.match(err.message, /FOREIGN KEY constraint failed/);
  }
  assert.strictEqual(fkFailed, true);

  db.exec("DELETE FROM monitored_profiles WHERE id = 'prof_1';");
  const jobAfterDelete = db.prepare('SELECT profile_id FROM upload_jobs WHERE id = ?').get('job_existing_1') as any;
  assert.strictEqual(jobAfterDelete.profile_id, null);

  const fkViolationsAfterDelete = db.prepare('PRAGMA foreign_key_check;').all();
  assert.strictEqual(fkViolationsAfterDelete.length, 0);
  console.log('  -> Confirmed: Outgoing FK rejection & ON DELETE SET NULL work properly (0 FK violations).');

  // Test Rerun Safety (if migration 0002 is executed again on clean rebuilt schema, it rebuilds idempotently without loss)
  db.exec('BEGIN TRANSACTION;');
  db.exec(migration0002Sql);
  db.exec('COMMIT;');
  const countAfterRerun = (db.prepare('SELECT COUNT(*) as c FROM upload_jobs').get() as { c: number }).c;
  assert.strictEqual(countAfterRerun, 5);
  assert.strictEqual(db.prepare('PRAGMA foreign_key_check;').all().length, 0);
  console.log('  -> Confirmed: Migration 0002 rerun safety verified (all 5 rows & 0 FK violations).');

  // Schema Convergence with canonical db/d1-schema.sql
  const canonicalDb = new DatabaseSync(':memory:');
  canonicalDb.exec(canonicalSchemaSql);

  const migratedColumns = db.prepare('PRAGMA table_info(upload_jobs);').all() as any[];
  const canonicalColumns = canonicalDb.prepare('PRAGMA table_info(upload_jobs);').all() as any[];

  assert.strictEqual(migratedColumns.length, canonicalColumns.length);
  for (let i = 0; i < migratedColumns.length; i++) {
    assert.strictEqual(migratedColumns[i].name, canonicalColumns[i].name);
    assert.strictEqual(migratedColumns[i].type, canonicalColumns[i].type);
    assert.strictEqual(migratedColumns[i].notnull, canonicalColumns[i].notnull);
    assert.strictEqual(migratedColumns[i].dflt_value, canonicalColumns[i].dflt_value);
    assert.strictEqual(migratedColumns[i].pk, canonicalColumns[i].pk);
  }

  const migratedIndexes = db
    .prepare("SELECT name, sql FROM sqlite_master WHERE type='index' AND tbl_name='upload_jobs' AND sql IS NOT NULL ORDER BY name;")
    .all() as { name: string; sql: string }[];
  const canonicalIndexes = canonicalDb
    .prepare("SELECT name, sql FROM sqlite_master WHERE type='index' AND tbl_name='upload_jobs' AND sql IS NOT NULL ORDER BY name;")
    .all() as { name: string; sql: string }[];

  assert.strictEqual(migratedIndexes.length, canonicalIndexes.length);
  for (let i = 0; i < migratedIndexes.length; i++) {
    assert.strictEqual(migratedIndexes[i].name, canonicalIndexes[i].name);
    assert.strictEqual(migratedIndexes[i].sql, canonicalIndexes[i].sql);
  }

  const migratedFk = db.prepare('PRAGMA foreign_key_list(upload_jobs);').all() as any[];
  const canonicalFk = canonicalDb.prepare('PRAGMA foreign_key_list(upload_jobs);').all() as any[];
  assert.deepStrictEqual(migratedFk, canonicalFk);

  console.log('  -> Confirmed: Final columns, defaults, types, indexes, and FKs match db/d1-schema.sql identically!');

  console.log('\n================================================================');
  console.log('ALL HARDENED MIGRATION 0002 CONVERGENCE TESTS PASSED CLEANLY');
  console.log('================================================================\n');
}

runMigrationConvergenceTests();
