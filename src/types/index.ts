export type ProfileMonitoringStatus =
  | 'ACTIVE'
  | 'PAUSED'
  | 'RESTRICTED'
  | 'NOT_FOUND'
  | 'ERROR';

// Retained for backward compatibility during migration
export type AccountStatus = 'ACTIVE' | 'EXPIRED' | 'DISCONNECTED' | 'ERROR';

export type JobStatus =
  | 'SUBMITTED'
  | 'VALIDATING'
  | 'RESOLVING_MEDIA'
  | 'MEDIA_AVAILABLE'
  | 'WAITING_FOR_AUTHORIZED_MEDIA'
  | 'ARCHIVING_TO_DRIVE'
  | 'STORED_IN_DRIVE'
  | 'UPLOADING_TO_YOUTUBE'
  | 'VERIFYING_UPLOAD'
  | 'COMPLETED'
  | 'FAILED'
  // Legacy aliases
  | 'DETECTED'
  | 'DOWNLOADING'
  | 'STORED_DRIVE'
  | 'RETRYING';

export type PublishingVisibility = 'public' | 'unlisted' | 'private';

export interface ReelSubmissionPayload {
  reelUrl: string;
  directVideoUrl?: string;
  driveFileId?: string;
  captionOverride?: string;
  visibility?: PublishingVisibility;
  confirmedRights: boolean;
}

/**
 * Public Monitored Instagram Profile (Phase 1.1)
 * No OAuth, no passwords, no tokens.
 */
export interface MonitoredProfile {
  id: string; // Internal UUID
  profile_url: string; // e.g. https://www.instagram.com/example_creator/
  username: string; // Extracted clean username
  display_name: string;
  avatar_url: string;
  status: ProfileMonitoringStatus;
  status_reason: string; // Explains accessibility state honestly (e.g. "Public profile accessible", "Login wall encountered")
  is_active_source: boolean; // Currently selected active source for automation pipeline
  last_checked_at: string | null;
  reels_detected_count: number;
  created_at: string;
  updated_at: string;
}

/**
 * Legacy InstagramAccount structure (maintained for non-breaking compatibility)
 */
export interface InstagramAccount {
  id: string;
  instagram_user_id: string;
  username: string;
  name: string;
  profile_picture_url: string;
  access_token_encrypted?: string;
  token_expires_at: string;
  status: AccountStatus;
  is_active: boolean;
  last_synced_at: string | null;
  followers_count: number;
  media_count: number;
  created_at: string;
  updated_at: string;
}

export interface AutomationSettings {
  id: string;
  is_enabled: boolean;
  active_account_id: string | null; // Profile / Account ID selected for active processing
  polling_interval_minutes: number;
  last_successful_check: string | null;
  is_running: boolean;
  lock_acquired_at: string | null;
  max_uploads_per_day: number;
  default_visibility: PublishingVisibility;
  drive_folder_id: string;
  drive_folder_name: string;
  created_at: string;
  updated_at: string;
}

export interface Reel {
  id: string;
  profile_id?: string;
  instagram_account_id?: string;
  instagram_media_id: string;
  caption: string;
  permalink: string;
  media_url: string;
  thumbnail_url: string;
  duration_seconds?: number;
  timestamp: string;
  created_at: string;
}

export interface UploadJob {
  id: string;
  reel_id: string;
  instagram_account_id: string; // Links to monitored profile or account
  account_username: string;
  caption: string;
  thumbnail_url: string;
  original_reel_url: string;
  drive_file_id: string | null;
  drive_file_url: string | null;
  youtube_video_id: string | null;
  youtube_video_url: string | null;
  status: JobStatus;
  error_details: string | null;
  retry_count: number;
  max_retries: number;
  detected_at: string;
  completed_at: string | null;
  shortcode?: string;
  rights_confirmed?: boolean;
  media_source_type?: string;
  created_at: string;
  updated_at: string;
}

export type ActivityEventType =
  | 'PROFILE_ADDED'
  | 'PROFILE_PAUSED'
  | 'PROFILE_RESUMED'
  | 'PROFILE_CHECKED'
  | 'PROFILE_REMOVED'
  | 'ACCOUNT_CONNECTED'
  | 'ACCOUNT_SWITCHED'
  | 'ACCOUNT_DISCONNECTED'
  | 'SYNC_TRIGGERED'
  | 'REEL_DETECTED'
  | 'DRIVE_UPLOAD'
  | 'YOUTUBE_UPLOAD'
  | 'UPLOAD_FAILED'
  | 'JOB_RETRIED'
  | 'TOKEN_EXPIRING'
  | 'SETTINGS_UPDATED';

export interface ActivityLog {
  id: string;
  event_type: ActivityEventType;
  message: string;
  account_username?: string;
  details?: Record<string, unknown>;
  created_at: string;
}

export interface StorageMetrics {
  used_bytes: number;
  total_bytes: number;
  used_formatted: string;
  total_formatted: string;
  percentage: number;
  reels_stored: number;
  folder_name: string;
}

export interface DashboardMetrics {
  total_profiles: number;
  active_profiles_count: number;
  active_profile: MonitoredProfile | null;
  // Legacy aliases for backward compatibility
  total_accounts: number;
  active_accounts_count: number;
  active_account: InstagramAccount | null;
  total_reels_detected: number;
  total_videos_uploaded: number;
  failed_uploads: number;
  in_progress_uploads: number;
  storage: StorageMetrics;
  automation: AutomationSettings;
  recent_activity: ActivityLog[];
}

export interface IntegrationStatus {
  meta: {
    connected: boolean;
    app_id: string;
    has_secret: boolean;
  };
  google_drive: {
    connected: boolean;
    email: string;
    target_folder: string;
    quota_used_gb: number;
    quota_total_gb: number;
  };
  youtube: {
    connected: boolean;
    channel_title: string;
    channel_id: string;
    default_visibility: PublishingVisibility;
  };
  n8n: {
    configured: boolean;
    webhook_url: string;
    last_ping: string | null;
  };
}

/**
 * Monitoring Adapter Protocol
 */
export interface ProfileCheckResult {
  accessible: boolean;
  username: string;
  profile_url: string;
  status: ProfileMonitoringStatus;
  status_reason: string;
  status_code?: number;
  avatar_url?: string;
  display_name?: string;
  checked_at: string;
}

export interface DiscoveredReel {
  reel_id: string;
  permalink: string;
  caption: string;
  thumbnail_url: string;
  video_source_url?: string;
  published_at: string;
}

export interface ReelsDiscoveryResult {
  profile_id: string;
  new_reels: DiscoveredReel[];
  total_discovered: number;
  checked_at: string;
  notes?: string;
}

export interface IMonitoringAdapter {
  readonly name: string;
  checkProfile(profileUrl: string): Promise<ProfileCheckResult>;
  discoverReels(profile: MonitoredProfile, since?: string | null): Promise<ReelsDiscoveryResult>;
}
