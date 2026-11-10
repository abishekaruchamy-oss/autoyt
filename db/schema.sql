-- Instagram-to-YouTube Shorts Automation Platform Schema
-- PostgreSQL 14+ compatible

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- 1. Instagram Accounts Table
CREATE TABLE IF NOT EXISTS instagram_accounts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    instagram_user_id VARCHAR(255) NOT NULL UNIQUE,
    username VARCHAR(255) NOT NULL,
    name VARCHAR(255),
    profile_picture_url TEXT,
    access_token_encrypted TEXT NOT NULL,
    token_expires_at TIMESTAMPTZ NOT NULL,
    status VARCHAR(50) NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'EXPIRED', 'DISCONNECTED', 'ERROR')),
    is_active BOOLEAN NOT NULL DEFAULT FALSE,
    last_synced_at TIMESTAMPTZ,
    followers_count INTEGER DEFAULT 0,
    media_count INTEGER DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Index for quickly locating the active account for n8n workers
CREATE INDEX IF NOT EXISTS idx_instagram_accounts_active ON instagram_accounts(is_active) WHERE is_active = TRUE;
CREATE INDEX IF NOT EXISTS idx_instagram_accounts_status ON instagram_accounts(status);

-- 2. Automation Settings Table (Single-row or multi-tenant system config)
CREATE TABLE IF NOT EXISTS automation_settings (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    is_enabled BOOLEAN NOT NULL DEFAULT TRUE,
    active_account_id UUID REFERENCES instagram_accounts(id) ON DELETE SET NULL,
    polling_interval_minutes INTEGER NOT NULL DEFAULT 60,
    last_successful_check TIMESTAMPTZ,
    is_running BOOLEAN NOT NULL DEFAULT FALSE,
    lock_acquired_at TIMESTAMPTZ,
    max_uploads_per_day INTEGER NOT NULL DEFAULT 5,
    default_visibility VARCHAR(20) NOT NULL DEFAULT 'private' CHECK (default_visibility IN ('public', 'unlisted', 'private')),
    drive_folder_id VARCHAR(255) NOT NULL DEFAULT 'root',
    drive_folder_name VARCHAR(255) NOT NULL DEFAULT 'Instagram Reels Backup',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 3. Reels Table (Separate reel histories for every account)
CREATE TABLE IF NOT EXISTS reels (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    instagram_account_id UUID NOT NULL REFERENCES instagram_accounts(id) ON DELETE CASCADE,
    instagram_media_id VARCHAR(255) NOT NULL UNIQUE,
    caption TEXT,
    permalink TEXT NOT NULL,
    media_url TEXT NOT NULL,
    thumbnail_url TEXT,
    duration_seconds NUMERIC(6,2),
    timestamp TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_reels_account_id ON reels(instagram_account_id);
CREATE INDEX IF NOT EXISTS idx_reels_timestamp ON reels(timestamp DESC);

-- 4. Upload Jobs Table (Tracks lifecycle of Reel -> Drive -> YouTube Shorts)
CREATE TABLE IF NOT EXISTS upload_jobs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    reel_id UUID NOT NULL REFERENCES reels(id) ON DELETE CASCADE,
    instagram_account_id UUID NOT NULL REFERENCES instagram_accounts(id) ON DELETE CASCADE,
    status VARCHAR(50) NOT NULL DEFAULT 'DETECTED' CHECK (status IN (
        'DETECTED', 'DOWNLOADING', 'STORED_DRIVE', 'UPLOADING_YOUTUBE', 'COMPLETED', 'FAILED', 'RETRYING'
    )),
    drive_file_id VARCHAR(255),
    drive_file_url TEXT,
    youtube_video_id VARCHAR(255),
    youtube_video_url TEXT,
    error_details TEXT,
    retry_count INTEGER NOT NULL DEFAULT 0,
    max_retries INTEGER NOT NULL DEFAULT 3,
    started_at TIMESTAMPTZ,
    completed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_upload_jobs_status ON upload_jobs(status);
CREATE INDEX IF NOT EXISTS idx_upload_jobs_account ON upload_jobs(instagram_account_id);
CREATE INDEX IF NOT EXISTS idx_upload_jobs_created ON upload_jobs(created_at DESC);

-- 5. Activity Logs Table
CREATE TABLE IF NOT EXISTS activity_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    event_type VARCHAR(100) NOT NULL,
    message TEXT NOT NULL,
    account_username VARCHAR(255),
    details JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_activity_logs_created ON activity_logs(created_at DESC);

-- 6. Integrations Config Table (Google Drive, YouTube, Meta OAuth status)
CREATE TABLE IF NOT EXISTS integrations_config (
    service_name VARCHAR(50) PRIMARY KEY,
    is_connected BOOLEAN NOT NULL DEFAULT FALSE,
    config_data JSONB NOT NULL DEFAULT '{}'::jsonb,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
