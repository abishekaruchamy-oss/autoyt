-- Initial Seed Data for PostgreSQL

-- 1. Insert Demo Creator Accounts
INSERT INTO instagram_accounts (
    id, instagram_user_id, username, name, profile_picture_url, 
    access_token_encrypted, token_expires_at, status, is_active, 
    last_synced_at, followers_count, media_count
) VALUES 
(
    '11111111-1111-4111-a111-111111111111',
    'ig_17841401234567890',
    'techtrends_daily',
    'Tech Trends & AI Daily',
    'https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?w=150&auto=format&fit=crop&q=80',
    '0123456789abcdef01234567:0123456789abcdef0123456789abcdef:mock_encrypted_token_techtrends',
    NOW() + INTERVAL '48 days',
    'ACTIVE',
    TRUE,
    NOW() - INTERVAL '14 minutes',
    148200,
    342
),
(
    '22222222-2222-4222-a222-222222222222',
    'ig_17841409876543210',
    'creativestudio_la',
    'Studio Los Angeles',
    'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=150&auto=format&fit=crop&q=80',
    '0123456789abcdef01234567:0123456789abcdef0123456789abcdef:mock_encrypted_token_creativestudio',
    NOW() + INTERVAL '3 days',
    'ACTIVE',
    FALSE,
    NOW() - INTERVAL '3 hours',
    89400,
    185
),
(
    '33333333-3333-4333-a333-333333333333',
    'ig_17841405556667770',
    'fitnessfuel_pro',
    'Fitness Fuel Pro',
    'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=150&auto=format&fit=crop&q=80',
    '0123456789abcdef01234567:0123456789abcdef0123456789abcdef:mock_encrypted_token_fitnessfuel',
    NOW() - INTERVAL '2 days',
    'EXPIRED',
    FALSE,
    NOW() - INTERVAL '5 days',
    215000,
    512
)
ON CONFLICT (instagram_user_id) DO NOTHING;

-- 2. Automation Settings
INSERT INTO automation_settings (
    id, is_enabled, active_account_id, polling_interval_minutes, 
    last_successful_check, is_running, max_uploads_per_day, 
    default_visibility, drive_folder_id, drive_folder_name
) VALUES (
    'aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa',
    TRUE,
    '11111111-1111-4111-a111-111111111111',
    30,
    NOW() - INTERVAL '14 minutes',
    FALSE,
    5,
    'private',
    'drive_folder_reels_backup_2026',
    'Instagram Reels Backup'
)
ON CONFLICT DO NOTHING;

-- 3. Initial Activity Logs
INSERT INTO activity_logs (event_type, message, account_username, created_at) VALUES
('ACCOUNT_CONNECTED', 'Instagram Creator account @techtrends_daily connected via Meta OAuth', 'techtrends_daily', NOW() - INTERVAL '5 days'),
('ACCOUNT_SWITCHED', 'Active Instagram source switched to @techtrends_daily', 'techtrends_daily', NOW() - INTERVAL '2 days'),
('SYNC_TRIGGERED', 'Automated sync executed successfully. 2 new Reels detected.', 'techtrends_daily', NOW() - INTERVAL '14 minutes'),
('DRIVE_UPLOAD', 'Reel #C8xQ9yK transferred to Google Drive storage (18.4 MB)', 'techtrends_daily', NOW() - INTERVAL '12 minutes'),
('YOUTUBE_UPLOAD', 'Published to YouTube Shorts: "Top 5 AI tools in 2026 #shorts #ai"', 'techtrends_daily', NOW() - INTERVAL '10 minutes');
