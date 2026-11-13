-- Migration 0003: Separate Google Service Credentials for Drive and YouTube
-- Additive D1 (SQLite) schema migration for independent OAuth service credentials
-- Preserves existing google_credentials table intact for full backward compatibility

CREATE TABLE IF NOT EXISTS google_service_credentials (
    service TEXT PRIMARY KEY CHECK (service IN ('drive', 'youtube')),
    encrypted_access_token TEXT NOT NULL,
    encrypted_refresh_token TEXT,
    expires_at INTEGER NOT NULL,
    email TEXT NOT NULL,
    channel_id TEXT,
    channel_title TEXT,
    scope TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_google_service_credentials_expires ON google_service_credentials(expires_at);
