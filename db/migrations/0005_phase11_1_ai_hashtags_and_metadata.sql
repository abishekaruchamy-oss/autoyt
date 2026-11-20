-- Migration 0005: Phase 11.1 AI Hashtags & Clean YouTube Metadata
-- Adds dedicated columns to persist generated clean YouTube title, description, and tags on upload_jobs.
-- Preserves 100% of existing rows, foreign keys, and indexes without table rebuilding.

ALTER TABLE upload_jobs ADD COLUMN youtube_title TEXT;
ALTER TABLE upload_jobs ADD COLUMN youtube_description TEXT;
ALTER TABLE upload_jobs ADD COLUMN youtube_tags_json TEXT;
