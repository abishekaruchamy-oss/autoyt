-- Migration 0001: Atomic Reel Deduplication and Resumable Recovery
-- Additive D1 (SQLite) schema migration for Cloudflare production deployment
-- Preserves existing tables, rows, and constraints without dropping or recreating data

-- 1. Resumable upload session URI column for crash-recovery & deduplication (AES-256-GCM encrypted)
ALTER TABLE upload_jobs ADD COLUMN encrypted_youtube_upload_session_uri TEXT;

-- 2. Unique index on reel_id to enforce idempotency at database level
CREATE UNIQUE INDEX IF NOT EXISTS idx_upload_jobs_unique_reel_id ON upload_jobs(reel_id);

-- 3. Partial unique index on shortcode to prevent duplicate jobs for identical shortcodes
CREATE UNIQUE INDEX IF NOT EXISTS idx_upload_jobs_unique_shortcode ON upload_jobs(shortcode) WHERE shortcode IS NOT NULL;
