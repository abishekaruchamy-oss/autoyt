-- Migration 0004: Phase 11.0 Zero-Manual-Work Automated Pipeline
-- 1. Adds standing operator content-rights declarations table.
-- 2. Rebuilds upload_jobs to expand the durable stage-based CHECK constraint and
--    add non-sensitive pipeline telemetry columns (resolved_provider, media_duration_seconds,
--    media_size_bytes, youtube_privacy_status, stage_retries_json).
--    Preserves 100% of existing rows, foreign keys, and unique indexes.
-- 3. Ensures default_visibility is 'public' while keeping scheduled automation disabled.

CREATE TABLE IF NOT EXISTS operator_rights_declarations (
    id TEXT PRIMARY KEY,
    operator_identity TEXT NOT NULL,
    policy_version TEXT NOT NULL DEFAULT '1.0.0',
    status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'REVOKED')),
    declaration_text TEXT NOT NULL,
    declared_at TEXT NOT NULL,
    revoked_at TEXT,
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE upload_jobs_phase11 (
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
    resolved_provider TEXT,
    media_duration_seconds REAL,
    media_size_bytes INTEGER,
    youtube_privacy_status TEXT,
    stage_retries_json TEXT,
    status TEXT NOT NULL DEFAULT 'RECEIVED' CHECK (status IN (
        -- Phase 11.0 Durable Pipeline Stages
        'RECEIVED', 'VALIDATING_URL', 'CHECKING_RIGHTS_POLICY', 'RESOLVING_CREATOR',
        'RESOLVING_MEDIA', 'VALIDATING_MEDIA', 'MEDIA_AVAILABLE',
        'ARCHIVING_TO_DRIVE', 'VERIFYING_DRIVE_ARCHIVE', 'STORED_IN_DRIVE',
        'PREPARING_YOUTUBE_METADATA', 'UPLOADING_TO_YOUTUBE',
        'VERIFYING_YOUTUBE_PUBLICATION', 'COMPLETED', 'FAILED',
        'AMBIGUOUS_UPLOAD', 'WAITING_FOR_AUTHORIZED_MEDIA',
        -- Legacy status aliases retained for full backward compatibility
        'SUBMITTED', 'VALIDATING', 'VERIFYING_UPLOAD',
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

INSERT INTO upload_jobs_phase11 (
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

DROP TABLE upload_jobs;

ALTER TABLE upload_jobs_phase11 RENAME TO upload_jobs;

CREATE INDEX idx_upload_jobs_status ON upload_jobs(status);
CREATE INDEX idx_upload_jobs_profile ON upload_jobs(profile_id);
CREATE UNIQUE INDEX idx_upload_jobs_unique_shortcode ON upload_jobs(shortcode) WHERE shortcode IS NOT NULL;
CREATE UNIQUE INDEX idx_upload_jobs_unique_reel_id ON upload_jobs(reel_id);

-- Enforce permanent public default visibility without altering is_enabled/is_running
UPDATE automation_settings SET default_visibility = 'public' WHERE default_visibility != 'public';
