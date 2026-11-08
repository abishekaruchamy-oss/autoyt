-- Cloudflare D1 (SQLite) Schema for AutoShorts
-- Production-ready serverless schema for Cloudflare D1 deployment

-- 1. Monitored Instagram Profiles (No OAuth, manual public URLs)
CREATE TABLE IF NOT EXISTS monitored_profiles (
    id TEXT PRIMARY KEY,
    profile_url TEXT NOT NULL UNIQUE,
    username TEXT NOT NULL,
    display_name TEXT,
    avatar_url TEXT,
    status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'PAUSED', 'RESTRICTED', 'NOT_FOUND', 'ERROR')),
    status_reason TEXT,
    is_active_source INTEGER NOT NULL DEFAULT 0,
    last_checked_at TEXT,
    reels_detected_count INTEGER DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_monitored_profiles_active ON monitored_profiles(is_active_source);
CREATE INDEX IF NOT EXISTS idx_monitored_profiles_status ON monitored_profiles(status);

-- 2. Automation Settings (Schedule, Locks, Visibility)
CREATE TABLE IF NOT EXISTS automation_settings (
    id TEXT PRIMARY KEY,
    is_enabled INTEGER NOT NULL DEFAULT 1,
    active_profile_id TEXT REFERENCES monitored_profiles(id) ON DELETE SET NULL,
    polling_interval_minutes INTEGER NOT NULL DEFAULT 30,
    last_successful_check TEXT,
    is_running INTEGER NOT NULL DEFAULT 0,
    lock_acquired_at TEXT,
    max_uploads_per_day INTEGER NOT NULL DEFAULT 5,
    default_visibility TEXT NOT NULL DEFAULT 'public' CHECK (default_visibility IN ('public', 'unlisted', 'private')),
    drive_folder_id TEXT NOT NULL DEFAULT 'root',
    drive_folder_name TEXT NOT NULL DEFAULT 'Instagram Reels Backup',
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- 3. Reels Metadata & Deduplication Store
CREATE TABLE IF NOT EXISTS reels (
    id TEXT PRIMARY KEY,
    profile_id TEXT NOT NULL REFERENCES monitored_profiles(id) ON DELETE CASCADE,
    reel_id TEXT NOT NULL UNIQUE, -- Composite or canonical Instagram Media ID for deduplication
    caption TEXT,
    permalink TEXT NOT NULL,
    media_url TEXT,
    thumbnail_url TEXT,
    duration_seconds REAL,
    published_at TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_reels_profile_id ON reels(profile_id);
CREATE INDEX IF NOT EXISTS idx_reels_published_at ON reels(published_at DESC);

-- 4. Upload Pipeline Jobs (Tracks Reels -> Google Drive -> YouTube Shorts)
CREATE TABLE IF NOT EXISTS upload_jobs (
    id TEXT PRIMARY KEY,
    reel_id TEXT NOT NULL REFERENCES reels(id) ON DELETE CASCADE,
    profile_id TEXT NOT NULL REFERENCES monitored_profiles(id) ON DELETE CASCADE,
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

CREATE INDEX IF NOT EXISTS idx_upload_jobs_status ON upload_jobs(status);
CREATE INDEX IF NOT EXISTS idx_upload_jobs_profile ON upload_jobs(profile_id);

-- 5. Chronological Activity Logs
CREATE TABLE IF NOT EXISTS activity_logs (
    id TEXT PRIMARY KEY,
    event_type TEXT NOT NULL,
    message TEXT NOT NULL,
    account_username TEXT,
    details TEXT, -- JSON string
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_activity_logs_created ON activity_logs(created_at DESC);

-- 6. Integrations Configuration
CREATE TABLE IF NOT EXISTS integrations_config (
    service_name TEXT PRIMARY KEY,
    is_connected INTEGER NOT NULL DEFAULT 0,
    config_data TEXT NOT NULL DEFAULT '{}',
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
