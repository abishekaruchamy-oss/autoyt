import {
  MonitoredProfile,
  InstagramAccount,
  AutomationSettings,
  UploadJob,
  ActivityLog,
  IntegrationStatus,
} from '@/types';
import { encryptToken } from '@/lib/crypto';

export function createInitialMonitoredProfiles(): MonitoredProfile[] {
  const now = new Date();

  return [
    {
      id: 'prof-11111111-1111-4111-a111-111111111111',
      profile_url: 'https://www.instagram.com/techtrends_daily/',
      username: 'techtrends_daily',
      display_name: 'Tech Trends & AI Daily',
      avatar_url:
        'https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?w=150&auto=format&fit=crop&q=80',
      status: 'ACTIVE',
      status_reason: 'Public profile verified (HTTP 200). Actively monitored.',
      is_active_source: true, // Selected active source
      last_checked_at: new Date(now.getTime() - 14 * 60 * 1000).toISOString(),
      reels_detected_count: 23,
      created_at: new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString(),
      updated_at: new Date(now.getTime() - 14 * 60 * 1000).toISOString(),
    },
    {
      id: 'prof-22222222-2222-4222-a222-222222222222',
      profile_url: 'https://www.instagram.com/creativestudio_la/',
      username: 'creativestudio_la',
      display_name: 'Studio Los Angeles',
      avatar_url:
        'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=150&auto=format&fit=crop&q=80',
      status: 'ACTIVE',
      status_reason: 'Public profile verified (HTTP 200). Ready for next poll.',
      is_active_source: false,
      last_checked_at: new Date(now.getTime() - 3 * 60 * 60 * 1000).toISOString(),
      reels_detected_count: 14,
      created_at: new Date(now.getTime() - 45 * 24 * 60 * 60 * 1000).toISOString(),
      updated_at: new Date(now.getTime() - 3 * 60 * 60 * 1000).toISOString(),
    },
    {
      id: 'prof-33333333-3333-4333-a333-333333333333',
      profile_url: 'https://www.instagram.com/fitnessfuel_pro/',
      username: 'fitnessfuel_pro',
      display_name: 'Fitness Fuel Pro',
      avatar_url:
        'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=150&auto=format&fit=crop&q=80',
      status: 'PAUSED',
      status_reason: 'Monitoring paused by user.',
      is_active_source: false,
      last_checked_at: new Date(now.getTime() - 2 * 24 * 60 * 60 * 1000).toISOString(),
      reels_detected_count: 8,
      created_at: new Date(now.getTime() - 60 * 24 * 60 * 60 * 1000).toISOString(),
      updated_at: new Date(now.getTime() - 2 * 24 * 60 * 60 * 1000).toISOString(),
    },
  ];
}

export function createInitialMockAccounts(): InstagramAccount[] {
  const now = new Date();

  return [
    {
      id: '11111111-1111-4111-a111-111111111111',
      instagram_user_id: 'ig_17841401234567890',
      username: 'techtrends_daily',
      name: 'Tech Trends & AI Daily',
      profile_picture_url:
        'https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?w=150&auto=format&fit=crop&q=80',
      access_token_encrypted: encryptToken('EAABmock_token_techtrends_active_secret_key_99'),
      token_expires_at: new Date(now.getTime() + 48 * 24 * 60 * 60 * 1000).toISOString(),
      status: 'ACTIVE',
      is_active: true,
      last_synced_at: new Date(now.getTime() - 14 * 60 * 1000).toISOString(),
      followers_count: 148200,
      media_count: 342,
      created_at: new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString(),
      updated_at: new Date(now.getTime() - 14 * 60 * 1000).toISOString(),
    },
    {
      id: '22222222-2222-4222-a222-222222222222',
      instagram_user_id: 'ig_17841409876543210',
      username: 'creativestudio_la',
      name: 'Studio Los Angeles',
      profile_picture_url:
        'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=150&auto=format&fit=crop&q=80',
      access_token_encrypted: encryptToken('EAABmock_token_creativestudio_secret_key_88'),
      token_expires_at: new Date(now.getTime() + 3 * 24 * 60 * 60 * 1000).toISOString(),
      status: 'ACTIVE',
      is_active: false,
      last_synced_at: new Date(now.getTime() - 3 * 60 * 60 * 1000).toISOString(),
      followers_count: 89400,
      media_count: 185,
      created_at: new Date(now.getTime() - 45 * 24 * 60 * 60 * 1000).toISOString(),
      updated_at: new Date(now.getTime() - 3 * 60 * 60 * 1000).toISOString(),
    },
    {
      id: '33333333-3333-4333-a333-333333333333',
      instagram_user_id: 'ig_17841405556667770',
      username: 'fitnessfuel_pro',
      name: 'Fitness Fuel Pro',
      profile_picture_url:
        'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=150&auto=format&fit=crop&q=80',
      access_token_encrypted: encryptToken('EAABmock_token_fitnessfuel_secret_key_77'),
      token_expires_at: new Date(now.getTime() - 2 * 24 * 60 * 60 * 1000).toISOString(),
      status: 'EXPIRED',
      is_active: false,
      last_synced_at: new Date(now.getTime() - 5 * 24 * 60 * 60 * 1000).toISOString(),
      followers_count: 215000,
      media_count: 512,
      created_at: new Date(now.getTime() - 60 * 24 * 60 * 60 * 1000).toISOString(),
      updated_at: new Date(now.getTime() - 2 * 24 * 60 * 60 * 1000).toISOString(),
    },
  ];
}

export function createInitialAutomationSettings(): AutomationSettings {
  const now = new Date();
  return {
    id: 'aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa',
    is_enabled: true,
    active_account_id: 'prof-11111111-1111-4111-a111-111111111111',
    polling_interval_minutes: 30,
    last_successful_check: new Date(now.getTime() - 14 * 60 * 1000).toISOString(),
    is_running: false,
    lock_acquired_at: null,
    max_uploads_per_day: 5,
    default_visibility: 'public',
    drive_folder_id: 'drive_folder_reels_backup_2026',
    drive_folder_name: 'Instagram Reels Backup',
    created_at: new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString(),
    updated_at: new Date(now.getTime() - 14 * 60 * 1000).toISOString(),
  };
}

export function createInitialUploadJobs(): UploadJob[] {
  const now = new Date();

  return [
    {
      id: 'job-101',
      reel_id: 'reel_ig_349811234901',
      instagram_account_id: 'prof-11111111-1111-4111-a111-111111111111',
      account_username: 'techtrends_daily',
      caption:
        '🚀 5 AI Tools that will 10x your productivity in 2026!\nWhich one is your favorite? #ai #productivity #techtrends #shorts',
      thumbnail_url:
        'https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?w=400&auto=format&fit=crop&q=80',
      original_reel_url: 'https://www.instagram.com/reel/C8xQ9yKm3Z0/',
      drive_file_id: '1aB2c3D4e5F6g7H8i9J0kL',
      drive_file_url: 'https://drive.google.com/file/d/1aB2c3D4e5F6g7H8i9J0kL/view',
      youtube_video_id: 'dQw4w9WgXcQ',
      youtube_video_url: 'https://youtube.com/shorts/dQw4w9WgXcQ',
      status: 'COMPLETED',
      error_details: null,
      retry_count: 0,
      max_retries: 3,
      detected_at: new Date(now.getTime() - 2 * 60 * 60 * 1000).toISOString(),
      completed_at: new Date(now.getTime() - 1 * 60 * 60 * 1000).toISOString(),
      created_at: new Date(now.getTime() - 2 * 60 * 60 * 1000).toISOString(),
      updated_at: new Date(now.getTime() - 1 * 60 * 60 * 1000).toISOString(),
    },
    {
      id: 'job-102',
      reel_id: 'reel_ig_349811234902',
      instagram_account_id: 'prof-11111111-1111-4111-a111-111111111111',
      account_username: 'techtrends_daily',
      caption:
        '⚡ Why Quantum Computing is closer than you think!\nWatch until the end. #quantum #technology #future',
      thumbnail_url:
        'https://images.unsplash.com/photo-1635070041078-e363dbe005cb?w=400&auto=format&fit=crop&q=80',
      original_reel_url: 'https://www.instagram.com/reel/C8wP8xJm2Y9/',
      drive_file_id: '2bC3d4E5f6G7h8I9j0KlM',
      drive_file_url: 'https://drive.google.com/file/d/2bC3d4E5f6G7h8I9j0KlM/view',
      youtube_video_id: '7lCDEKSw3h8',
      youtube_video_url: 'https://youtube.com/shorts/7lCDEKSw3h8',
      status: 'COMPLETED',
      error_details: null,
      retry_count: 0,
      max_retries: 3,
      detected_at: new Date(now.getTime() - 5 * 60 * 60 * 1000).toISOString(),
      completed_at: new Date(now.getTime() - 4 * 60 * 60 * 1000).toISOString(),
      created_at: new Date(now.getTime() - 5 * 60 * 60 * 1000).toISOString(),
      updated_at: new Date(now.getTime() - 4 * 60 * 60 * 1000).toISOString(),
    },
    {
      id: 'job-103',
      reel_id: 'reel_ig_349811234903',
      instagram_account_id: 'prof-11111111-1111-4111-a111-111111111111',
      account_username: 'techtrends_daily',
      caption:
        '🔥 Best setup hacks for developers in 2026.\nCable management 10/10! #desksetup #workspace',
      thumbnail_url:
        'https://images.unsplash.com/photo-1527443224154-c4a3942d3acf?w=400&auto=format&fit=crop&q=80',
      original_reel_url: 'https://www.instagram.com/reel/C8vO7wIl1X8/',
      drive_file_id: '3cD4e5F6g7H8i9J0kL1mN',
      drive_file_url: 'https://drive.google.com/file/d/3cD4e5F6g7H8i9J0kL1mN/view',
      youtube_video_id: null,
      youtube_video_url: null,
      status: 'FAILED',
      error_details:
        'YouTube API Error: Upload quota exceeded for today. Reset expected at 00:00 UTC.',
      retry_count: 1,
      max_retries: 3,
      detected_at: new Date(now.getTime() - 8 * 60 * 60 * 1000).toISOString(),
      completed_at: null,
      created_at: new Date(now.getTime() - 8 * 60 * 60 * 1000).toISOString(),
      updated_at: new Date(now.getTime() - 7 * 60 * 60 * 1000).toISOString(),
    },
    {
      id: 'job-104',
      reel_id: 'reel_ig_349811234904',
      instagram_account_id: 'prof-22222222-2222-4222-a222-222222222222',
      account_username: 'creativestudio_la',
      caption:
        'Behind the scenes at our Los Angeles commercial shoot 🎬\nFull lighting setup #cinematography #filmmaking #bts',
      thumbnail_url:
        'https://images.unsplash.com/photo-1492691527719-9d1e07e534b4?w=400&auto=format&fit=crop&q=80',
      original_reel_url: 'https://www.instagram.com/reel/C8uN6vHk0W7/',
      drive_file_id: '4dE5f6G7h8I9j0KlM1nOp',
      drive_file_url: 'https://drive.google.com/file/d/4dE5f6G7h8I9j0KlM1nOp/view',
      youtube_video_id: 'J---aiyznGQ',
      youtube_video_url: 'https://youtube.com/shorts/J---aiyznGQ',
      status: 'COMPLETED',
      error_details: null,
      retry_count: 0,
      max_retries: 3,
      detected_at: new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString(),
      completed_at: new Date(now.getTime() - 23 * 60 * 60 * 1000).toISOString(),
      created_at: new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString(),
      updated_at: new Date(now.getTime() - 23 * 60 * 60 * 1000).toISOString(),
    },
    {
      id: 'job-105',
      reel_id: 'reel_ig_349811234905',
      instagram_account_id: 'prof-11111111-1111-4111-a111-111111111111',
      account_username: 'techtrends_daily',
      caption: '🤖 Is this the smartest robot vacuum of 2026?\nQuick test! #smartgadgets #tech',
      thumbnail_url:
        'https://images.unsplash.com/photo-1518770660439-4636190af475?w=400&auto=format&fit=crop&q=80',
      original_reel_url: 'https://www.instagram.com/reel/C8tM5uGj9V6/',
      drive_file_id: '5eF6g7H8i9J0kL1mN2oPq',
      drive_file_url: 'https://drive.google.com/file/d/5eF6g7H8i9J0kL1mN2oPq/view',
      youtube_video_id: null,
      youtube_video_url: null,
      status: 'STORED_DRIVE',
      error_details: null,
      retry_count: 0,
      max_retries: 3,
      detected_at: new Date(now.getTime() - 15 * 60 * 1000).toISOString(),
      completed_at: null,
      created_at: new Date(now.getTime() - 15 * 60 * 1000).toISOString(),
      updated_at: new Date(now.getTime() - 12 * 60 * 1000).toISOString(),
    },
  ];
}

export function createInitialActivityLogs(): ActivityLog[] {
  const now = new Date();

  return [
    {
      id: 'act-1',
      event_type: 'PROFILE_CHECKED',
      message:
        'Automated check completed for public profile @techtrends_daily. Status: Verified (HTTP 200).',
      account_username: 'techtrends_daily',
      created_at: new Date(now.getTime() - 14 * 60 * 1000).toISOString(),
    },
    {
      id: 'act-2',
      event_type: 'DRIVE_UPLOAD',
      message:
        'Archived reel #reel_ig_349811234905 to Google Drive folder "Instagram Reels Backup" (18.4 MB)',
      account_username: 'techtrends_daily',
      created_at: new Date(now.getTime() - 15 * 60 * 1000).toISOString(),
    },
    {
      id: 'act-3',
      event_type: 'REEL_DETECTED',
      message:
        'New Reel detected: "Is this the smartest robot vacuum of 2026?" (deduplicated)',
      account_username: 'techtrends_daily',
      created_at: new Date(now.getTime() - 16 * 60 * 1000).toISOString(),
    },
    {
      id: 'act-4',
      event_type: 'YOUTUBE_UPLOAD',
      message:
        'Published YouTube Short: "5 AI Tools that will 10x your productivity in 2026! #shorts"',
      account_username: 'techtrends_daily',
      created_at: new Date(now.getTime() - 60 * 60 * 1000).toISOString(),
    },
    {
      id: 'act-5',
      event_type: 'UPLOAD_FAILED',
      message: 'Failed to upload YouTube Short: Daily API quota reached.',
      account_username: 'techtrends_daily',
      created_at: new Date(now.getTime() - 7 * 60 * 60 * 1000).toISOString(),
    },
    {
      id: 'act-6',
      event_type: 'PROFILE_PAUSED',
      message: 'Monitoring paused for @fitnessfuel_pro by user.',
      account_username: 'fitnessfuel_pro',
      created_at: new Date(now.getTime() - 2 * 24 * 60 * 60 * 1000).toISOString(),
    },
    {
      id: 'act-7',
      event_type: 'PROFILE_ADDED',
      message: 'Public profile @creativestudio_la added to monitoring queue.',
      account_username: 'creativestudio_la',
      created_at: new Date(now.getTime() - 48 * 60 * 60 * 1000).toISOString(),
    },
  ];
}

export function createInitialIntegrations(): IntegrationStatus {
  return {
    meta: {
      connected: false, // Disconnected in Phase 1.1 in favor of public URL monitoring
      app_id: 'None (Unauthenticated Public URL Mode)',
      has_secret: false,
    },
    google_drive: {
      connected: true,
      email: 'creator.media.ops@gmail.com',
      target_folder: 'Instagram Reels Backup',
      quota_used_gb: 14.8,
      quota_total_gb: 100.0,
    },
    youtube: {
      connected: true,
      channel_title: 'Tech & Trends Official Shorts',
      channel_id: 'UC9xMockCreatorChannel99',
      default_visibility: 'public',
    },
    n8n: {
      configured: true,
      webhook_url: 'http://localhost:5678/webhook/instagram-to-youtube-trigger',
      last_ping: new Date().toISOString(),
    },
  };
}
