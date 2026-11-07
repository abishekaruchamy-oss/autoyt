import {
  MonitoredProfile,
  InstagramAccount,
  AutomationSettings,
  UploadJob,
  ActivityLog,
  IntegrationStatus,
  DashboardMetrics,
  JobStatus,
  ActivityEventType,
  ProfileMonitoringStatus,
} from '@/types';
import {
  createInitialMonitoredProfiles,
  createInitialMockAccounts,
  createInitialAutomationSettings,
  createInitialUploadJobs,
  createInitialActivityLogs,
  createInitialIntegrations,
} from './mockData';
import { getPgPool, checkPostgresConnection } from './client';
import {
  normalizeProfileUrl,
  StandardPublicWebAdapter,
  PermittedSandboxAdapter,
} from '../monitoring/adapter';
import { formatBytes } from '@/lib/utils';
import crypto from 'crypto';

export interface StoredGoogleCredentials {
  encryptedAccessToken: string;
  encryptedRefreshToken?: string;
  expiresAt: number;
  email: string;
  channelId?: string;
  channelTitle?: string;
  updatedAt: string;
}

class DataStore {
  profiles: MonitoredProfile[] = createInitialMonitoredProfiles();
  accounts: InstagramAccount[] = createInitialMockAccounts();
  automation: AutomationSettings = createInitialAutomationSettings();
  uploadJobs: UploadJob[] = createInitialUploadJobs();
  activityLogs: ActivityLog[] = createInitialActivityLogs();
  integrations: IntegrationStatus = createInitialIntegrations();
  googleCredentials: StoredGoogleCredentials | null = null;

  reset() {
    this.profiles = createInitialMonitoredProfiles();
    this.accounts = createInitialMockAccounts();
    this.automation = createInitialAutomationSettings();
    this.uploadJobs = createInitialUploadJobs();
    this.activityLogs = createInitialActivityLogs();
    this.integrations = createInitialIntegrations();
    this.googleCredentials = null;
  }
}

const globalStore = global as unknown as { __store?: DataStore };
if (!globalStore.__store) {
  globalStore.__store = new DataStore();
}
const store = globalStore.__store;

export class Repository {
  static resetDemo(): void {
    store.reset();
  }

  // ==========================================
  // Public Monitored Profiles (Phase 1.1)
  // ==========================================

  static async getMonitoredProfiles(): Promise<MonitoredProfile[]> {
    return [...store.profiles].sort((a, b) => {
      if (a.is_active_source && !b.is_active_source) return -1;
      if (!a.is_active_source && b.is_active_source) return 1;
      return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
    });
  }

  static async getMonitoredProfileById(id: string): Promise<MonitoredProfile | null> {
    return store.profiles.find((p) => p.id === id) || null;
  }

  static async getActiveMonitoredProfile(): Promise<MonitoredProfile | null> {
    return store.profiles.find((p) => p.is_active_source) || store.profiles[0] || null;
  }

  static async setActiveMonitoredProfile(profileId: string): Promise<MonitoredProfile | null> {
    const target = store.profiles.find((p) => p.id === profileId);
    if (!target) return null;

    store.profiles.forEach((p) => {
      p.is_active_source = p.id === profileId;
      p.updated_at = new Date().toISOString();
    });

    store.automation.active_account_id = profileId;
    store.automation.updated_at = new Date().toISOString();

    await this.logActivity(
      'ACCOUNT_SWITCHED',
      `Active monitored source switched to @${target.username} (${target.profile_url})`,
      target.username
    );

    return target;
  }

  static async addMonitoredProfile(
    inputUrl: string,
    displayName?: string
  ): Promise<MonitoredProfile> {
    const { username, cleanUrl } = normalizeProfileUrl(inputUrl);

    if (!username) {
      throw new Error('Invalid Instagram profile URL or username.');
    }

    // Check if already exists
    const existing = store.profiles.find(
      (p) => p.username === username || p.profile_url === cleanUrl
    );
    if (existing) {
      throw new Error(`Profile @${username} is already in your monitored list.`);
    }

    // Initial accessibility check using permitted adapter
    const adapter = new StandardPublicWebAdapter();
    const checkResult = await adapter.checkProfile(cleanUrl);

    const now = new Date().toISOString();
    const newProfile: MonitoredProfile = {
      id: `prof-${crypto.randomUUID()}`,
      profile_url: cleanUrl,
      username,
      display_name: displayName || `@${username}`,
      avatar_url:
        checkResult.avatar_url ||
        'https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?w=150',
      status: checkResult.status,
      status_reason: checkResult.status_reason,
      is_active_source: store.profiles.length === 0,
      last_checked_at: now,
      reels_detected_count: 0,
      created_at: now,
      updated_at: now,
    };

    store.profiles.push(newProfile);
    if (newProfile.is_active_source) {
      store.automation.active_account_id = newProfile.id;
    }

    await this.logActivity(
      'PROFILE_ADDED',
      `Added public profile @${username} (${cleanUrl}). Initial status: ${checkResult.status}`,
      username
    );

    return newProfile;
  }

  static async toggleProfileMonitoring(
    id: string,
    pause: boolean
  ): Promise<MonitoredProfile | null> {
    const profile = await this.getMonitoredProfileById(id);
    if (!profile) return null;

    profile.status = pause ? 'PAUSED' : 'ACTIVE';
    profile.status_reason = pause
      ? 'Monitoring paused by user.'
      : 'Monitoring resumed. Scheduled for next cycle.';
    profile.updated_at = new Date().toISOString();

    await this.logActivity(
      pause ? 'PROFILE_PAUSED' : 'PROFILE_RESUMED',
      `Monitoring ${pause ? 'paused' : 'resumed'} for @${profile.username}`,
      profile.username
    );

    return profile;
  }

  static async checkProfileNow(id: string): Promise<MonitoredProfile | null> {
    const profile = await this.getMonitoredProfileById(id);
    if (!profile) return null;

    const adapter = new StandardPublicWebAdapter();
    const res = await adapter.checkProfile(profile.profile_url);

    profile.status = res.status;
    profile.status_reason = res.status_reason;
    profile.last_checked_at = res.checked_at;
    profile.updated_at = res.checked_at;

    await this.logActivity(
      'PROFILE_CHECKED',
      `Permitted probe completed for @${profile.username}: ${res.status_reason}`,
      profile.username
    );

    return profile;
  }

  static async updateMonitoredProfile(
    id: string,
    updates: Partial<MonitoredProfile>
  ): Promise<MonitoredProfile | null> {
    const profile = await this.getMonitoredProfileById(id);
    if (!profile) return null;

    if (updates.profile_url) {
      const { username, cleanUrl } = normalizeProfileUrl(updates.profile_url);
      profile.username = username;
      profile.profile_url = cleanUrl;
    }
    if (updates.display_name) profile.display_name = updates.display_name;
    if (updates.status) profile.status = updates.status;
    profile.updated_at = new Date().toISOString();

    return profile;
  }

  static async removeMonitoredProfile(id: string): Promise<boolean> {
    const profile = await this.getMonitoredProfileById(id);
    if (!profile) return false;

    store.profiles = store.profiles.filter((p) => p.id !== id);
    if (store.automation.active_account_id === id) {
      store.automation.active_account_id = store.profiles[0]?.id || null;
      if (store.profiles[0]) {
        store.profiles[0].is_active_source = true;
      }
    }

    await this.logActivity(
      'PROFILE_REMOVED',
      `Public profile @${profile.username} removed from monitoring`,
      profile.username
    );

    return true;
  }

  // ==========================================
  // Legacy Account Compatibility Layer
  // ==========================================

  static async getAccounts(): Promise<InstagramAccount[]> {
    // Map monitored profiles to accounts format so legacy views don't break
    const profiles = await this.getMonitoredProfiles();
    return profiles.map((p) => ({
      id: p.id,
      instagram_user_id: `public_${p.username}`,
      username: p.username,
      name: p.display_name,
      profile_picture_url: p.avatar_url,
      token_expires_at: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString(),
      status: p.status === 'ACTIVE' ? 'ACTIVE' : p.status === 'PAUSED' ? 'DISCONNECTED' : 'ERROR',
      is_active: p.is_active_source,
      last_synced_at: p.last_checked_at,
      followers_count: 0,
      media_count: p.reels_detected_count,
      created_at: p.created_at,
      updated_at: p.updated_at,
    }));
  }

  static async getAccountById(id: string): Promise<InstagramAccount | null> {
    const p = await this.getMonitoredProfileById(id);
    if (!p) return null;
    return {
      id: p.id,
      instagram_user_id: `public_${p.username}`,
      username: p.username,
      name: p.display_name,
      profile_picture_url: p.avatar_url,
      token_expires_at: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString(),
      status: p.status === 'ACTIVE' ? 'ACTIVE' : 'DISCONNECTED',
      is_active: p.is_active_source,
      last_synced_at: p.last_checked_at,
      followers_count: 0,
      media_count: p.reels_detected_count,
      created_at: p.created_at,
      updated_at: p.updated_at,
    };
  }

  static async getActiveAccount(): Promise<InstagramAccount | null> {
    const active = await this.getActiveMonitoredProfile();
    if (!active) return null;
    return this.getAccountById(active.id);
  }

  static async setActiveAccount(id: string): Promise<InstagramAccount | null> {
    const activated = await this.setActiveMonitoredProfile(id);
    if (!activated) return null;
    return this.getAccountById(id);
  }

  static async createAccount(data: {
    username: string;
    name?: string;
    instagram_user_id?: string;
    profile_picture_url?: string;
    raw_token?: string;
    expires_in_seconds?: number;
  }): Promise<InstagramAccount> {
    const profile = await this.addMonitoredProfile(data.username, data.name);
    return (await this.getAccountById(profile.id))!;
  }

  static async disconnectAccount(id: string): Promise<boolean> {
    const updated = await this.toggleProfileMonitoring(id, true);
    return !!updated;
  }

  static async reconnectAccount(id: string, _raw_token?: string): Promise<InstagramAccount | null> {
    const checked = await this.checkProfileNow(id);
    if (!checked) return null;
    return this.getAccountById(id);
  }

  static async deleteAccount(id: string): Promise<boolean> {
    return this.removeMonitoredProfile(id);
  }

  // ==========================================
  // Automation Settings & Execution Mutex
  // ==========================================

  static async getAutomationSettings(): Promise<AutomationSettings> {
    return store.automation;
  }

  static async updateAutomationSettings(
    updates: Partial<AutomationSettings>
  ): Promise<AutomationSettings> {
    Object.assign(store.automation, updates, { updated_at: new Date().toISOString() });
    await this.logActivity('SETTINGS_UPDATED', 'Automation configuration updated');
    return store.automation;
  }

  static async acquireAutomationLock(): Promise<boolean> {
    const current = await this.getAutomationSettings();
    if (current.is_running) {
      if (current.lock_acquired_at) {
        const lockAge = Date.now() - new Date(current.lock_acquired_at).getTime();
        if (lockAge > 10 * 60 * 1000) {
          console.warn('Breaking stale execution lock');
        } else {
          return false;
        }
      } else {
        return false;
      }
    }

    const now = new Date().toISOString();
    store.automation.is_running = true;
    store.automation.lock_acquired_at = now;
    return true;
  }

  static async releaseAutomationLock(success: boolean = true): Promise<void> {
    const now = new Date().toISOString();
    store.automation.is_running = false;
    store.automation.lock_acquired_at = null;
    if (success) {
      store.automation.last_successful_check = now;
    }
  }

  // ==========================================
  // Upload Jobs & Reels
  // ==========================================

  static async getUploadJobs(filters?: {
    accountId?: string;
    status?: JobStatus;
    search?: string;
  }): Promise<UploadJob[]> {
    let jobs = [...store.uploadJobs];

    if (filters?.accountId) {
      jobs = jobs.filter((j) => j.instagram_account_id === filters.accountId);
    }
    if (filters?.status) {
      jobs = jobs.filter((j) => j.status === filters.status);
    }
    if (filters?.search) {
      const q = filters.search.toLowerCase();
      jobs = jobs.filter(
        (j) =>
          j.caption.toLowerCase().includes(q) ||
          j.account_username.toLowerCase().includes(q) ||
          j.reel_id.toLowerCase().includes(q)
      );
    }

    return jobs.sort(
      (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
    );
  }

  static async getUploadJobById(id: string): Promise<UploadJob | null> {
    return store.uploadJobs.find((j) => j.id === id) || null;
  }

  static async retryUploadJob(id: string): Promise<UploadJob | null> {
    const job = await this.getUploadJobById(id);
    if (!job) return null;

    job.status = 'RETRYING';
    job.retry_count += 1;
    job.error_details = null;
    job.updated_at = new Date().toISOString();

    await this.logActivity(
      'JOB_RETRIED',
      `Manual retry triggered for reel on @${job.account_username}`,
      job.account_username
    );

    setTimeout(() => {
      job.status = 'COMPLETED';
      job.youtube_video_id = 'dQw4w9WgXcQ_retried';
      job.youtube_video_url = 'https://youtube.com/shorts/dQw4w9WgXcQ';
      job.completed_at = new Date().toISOString();
      job.updated_at = new Date().toISOString();
      Repository.logActivity(
        'YOUTUBE_UPLOAD',
        `Retry successful: published to YouTube Shorts for @${job.account_username}`,
        job.account_username
      );
    }, 2500);

    return job;
  }

  static async addUploadJob(job: Partial<UploadJob>): Promise<UploadJob> {
    const newJob: UploadJob = {
      id: crypto.randomUUID(),
      reel_id: job.reel_id || `reel_${Date.now()}`,
      instagram_account_id: job.instagram_account_id || '',
      account_username: job.account_username || '',
      caption: job.caption || '',
      thumbnail_url:
        job.thumbnail_url ||
        'https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?w=400',
      original_reel_url: job.original_reel_url || 'https://instagram.com/reel/mock',
      drive_file_id: job.drive_file_id || null,
      drive_file_url: job.drive_file_url || null,
      youtube_video_id: job.youtube_video_id || null,
      youtube_video_url: job.youtube_video_url || null,
      status: job.status || 'DETECTED',
      error_details: job.error_details || null,
      retry_count: 0,
      max_retries: 3,
      detected_at: new Date().toISOString(),
      completed_at: null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    store.uploadJobs.unshift(newJob);
    return newJob;
  }

  static async updateUploadJob(
    id: string,
    updates: Partial<UploadJob>
  ): Promise<UploadJob | null> {
    const job = await this.getUploadJobById(id);
    if (!job) return null;

    Object.assign(job, updates, { updated_at: new Date().toISOString() });
    return job;
  }

  // ==========================================
  // Activity Logs
  // ==========================================

  static async getActivityLogs(limit: number = 20): Promise<ActivityLog[]> {
    return store.activityLogs.slice(0, limit);
  }

  static async logActivity(
    eventType: ActivityEventType,
    message: string,
    accountUsername?: string,
    details?: Record<string, unknown>
  ): Promise<ActivityLog> {
    const log: ActivityLog = {
      id: crypto.randomUUID(),
      event_type: eventType,
      message,
      account_username: accountUsername,
      details,
      created_at: new Date().toISOString(),
    };
    store.activityLogs.unshift(log);
    if (store.activityLogs.length > 100) {
      store.activityLogs = store.activityLogs.slice(0, 100);
    }
    return log;
  }

  // ==========================================
  // Integrations & Storage
  // ==========================================

  static async getIntegrations(): Promise<IntegrationStatus> {
    return store.integrations;
  }

  static async updateIntegration(
    service: keyof IntegrationStatus,
    data: Partial<IntegrationStatus[keyof IntegrationStatus]>
  ): Promise<IntegrationStatus> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    store.integrations[service] = { ...store.integrations[service], ...(data as any) };
    return store.integrations;
  }

  static async saveGoogleCredentials(creds: StoredGoogleCredentials): Promise<void> {
    store.googleCredentials = creds;
    store.integrations.google_drive.connected = true;
    store.integrations.google_drive.email = creds.email;
    if (creds.channelTitle) {
      store.integrations.youtube.connected = true;
      store.integrations.youtube.channel_title = creds.channelTitle;
      if (creds.channelId) {
        store.integrations.youtube.channel_id = creds.channelId;
      }
    }
  }

  static async getGoogleCredentials(): Promise<StoredGoogleCredentials | null> {
    return store.googleCredentials;
  }

  static async clearGoogleCredentials(): Promise<void> {
    store.googleCredentials = null;
    store.integrations.google_drive.connected = false;
    store.integrations.google_drive.email = 'Not connected';
    store.integrations.youtube.connected = false;
    store.integrations.youtube.channel_title = 'Not connected';
    store.integrations.youtube.channel_id = 'None';
  }

  // ==========================================
  // Dashboard Metrics Aggregate
  // ==========================================

  static async getDashboardMetrics(): Promise<DashboardMetrics> {
    const profiles = await this.getMonitoredProfiles();
    const activeProfile = profiles.find((p) => p.is_active_source) || profiles[0] || null;
    const automation = await this.getAutomationSettings();
    const jobs = store.uploadJobs;
    const recentActivity = await this.getActivityLogs(8);

    const totalReelsDetected = jobs.length + 18;
    const totalVideosUploaded = jobs.filter((j) => j.status === 'COMPLETED').length + 14;
    const failedUploads = jobs.filter((j) => j.status === 'FAILED').length;
    const inProgressUploads = jobs.filter(
      (j) => j.status !== 'COMPLETED' && j.status !== 'FAILED'
    ).length;

    const usedBytes = 14.8 * 1024 * 1024 * 1024;
    const totalBytes = 100 * 1024 * 1024 * 1024;

    const activeLegacyAccount = activeProfile
      ? await this.getAccountById(activeProfile.id)
      : null;

    return {
      total_profiles: profiles.length,
      active_profiles_count: profiles.filter((p) => p.status === 'ACTIVE').length,
      active_profile: activeProfile,
      // Legacy aliases
      total_accounts: profiles.length,
      active_accounts_count: profiles.filter((p) => p.status === 'ACTIVE').length,
      active_account: activeLegacyAccount,
      total_reels_detected: totalReelsDetected,
      total_videos_uploaded: totalVideosUploaded,
      failed_uploads: failedUploads,
      in_progress_uploads: inProgressUploads,
      storage: {
        used_bytes: usedBytes,
        total_bytes: totalBytes,
        used_formatted: formatBytes(usedBytes),
        total_formatted: formatBytes(totalBytes),
        percentage: Math.round((usedBytes / totalBytes) * 100),
        reels_stored: totalVideosUploaded + 6,
        folder_name: automation.drive_folder_name,
      },
      automation,
      recent_activity: recentActivity,
    };
  }
}
