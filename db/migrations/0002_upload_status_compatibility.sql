-- Migration 0002: Upload Status Compatibility
-- Additive D1 (SQLite) schema migration for Cloudflare production deployment
-- Rebuilds upload_jobs table to expand the status CHECK constraint with AMBIGUOUS_UPLOAD
-- Preserves all existing columns, rows, values, foreign keys, and indexes without data loss
-- Safe for Cloudflare D1 implicit transactions: preserves active foreign-key enforcement without PRAGMA foreign_keys toggling
-- Fails fast if an unexpected upload_jobs_new staging table already exists

-- 1. Fail-fast creation of new upload_jobs_new table matching canonical db/d1-schema.sql
CREATE TABLE upload_jobs_new (
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
    encrypted_youtube_upload_session_uri TEXT,
    status TEXT NOT NULL DEFAULT 'SUBMITTED' CHECK (status IN (
        'SUBMITTED', 'VALIDATING', 'RESOLVING_MEDIA', 'MEDIA_AVAILABLE',
        'WAITING_FOR_AUTHORIZED_MEDIA', 'ARCHIVING_TO_DRIVE', 'STORED_IN_DRIVE',
        'UPLOADING_TO_YOUTUBE', 'VERIFYING_UPLOAD', 'COMPLETED', 'FAILED',
        'AMBIGUOUS_UPLOAD',
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

-- 2. Copy all existing records from upload_jobs into upload_jobs_new
INSERT INTO upload_jobs_new (
    id,
    reel_id,
    profile_id,
    account_username,
    caption,
    thumbnail_url,
    original_reel_url,
    shortcode,
    media_source_type,
    rights_confirmed,
    drive_file_id,
    drive_file_url,
    youtube_video_id,
    youtube_video_url,
    encrypted_youtube_upload_session_uri,
    status,
    error_details,
    retry_count,
    max_retries,
    detected_at,
    completed_at,
    created_at,
    updated_at
)
SELECT
    id,
    reel_id,
    profile_id,
    account_username,
    caption,
    thumbnail_url,
    original_reel_url,
    shortcode,
    media_source_type,
    rights_confirmed,
    drive_file_id,
    drive_file_url,
    youtube_video_id,
    youtube_video_url,
    encrypted_youtube_upload_session_uri,
    status,
    error_details,
    retry_count,
    max_retries,
    detected_at,
    completed_at,
    created_at,
    updated_at
FROM upload_jobs;

-- 3. Drop existing upload_jobs table (verified: zero incoming foreign keys from other tables)
DROP TABLE upload_jobs;

-- 4. Rename upload_jobs_new to upload_jobs
ALTER TABLE upload_jobs_new RENAME TO upload_jobs;

-- 5. Recreate all indexes to match canonical schema
CREATE INDEX idx_upload_jobs_status ON upload_jobs(status);
CREATE INDEX idx_upload_jobs_profile ON upload_jobs(profile_id);
CREATE UNIQUE INDEX idx_upload_jobs_unique_shortcode ON upload_jobs(shortcode) WHERE shortcode IS NOT NULL;
CREATE UNIQUE INDEX idx_upload_jobs_unique_reel_id ON upload_jobs(reel_id);
