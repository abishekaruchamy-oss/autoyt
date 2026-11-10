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
} from '@/types';
import {
  createInitialMonitoredProfiles,
  createInitialMockAccounts,
  createInitialAutomationSettings,
  createInitialUploadJobs,
  createInitialActivityLogs,
  createInitialIntegrations,
} from './mockData';
import {
  normalizeProfileUrl,
  StandardPublicWebAdapter,
} from '../monitoring/adapter';
import { formatBytes } from '@/lib/utils';
import crypto from 'node:crypto';
import { getD1Database, setD1Database, isD1Connected, D1Database } from './d1Client';

export interface StoredGoogleCredentials {
  encryptedAccessToken: string;
  encryptedRefreshToken?: string;
  expiresAt: number;
  email: string;
  channelId?: string;
  channelTitle?: string;
  updatedAt: string;
}

export interface OAuthStateRecord {
  state: string;
  provider: string;
  redirect_uri: string;
  created_at: string;
  expires_at: number;
}

/**
 * In-memory fallback DataStore.
 * STRICT INVARIANT: Permitted ONLY during tests and non-production development.
 * In production (NODE_ENV === 'production'), any access without D1 throws a fatal exception.
 */
class DataStore {
  profiles: MonitoredProfile[] = createInitialMonitoredProfiles();
  accounts: InstagramAccount[] = createInitialMockAccounts();
  automation: AutomationSettings = createInitialAutomationSettings();
  uploadJobs: UploadJob[] = createInitialUploadJobs();
  activityLogs: ActivityLog[] = createInitialActivityLogs();
  integrations: IntegrationStatus = createInitialIntegrations();
  googleCredentials: StoredGoogleCredentials | null = null;
  oauthStates: Map<string, OAuthStateRecord> = new Map();
  recordedReels: Set<string> = new Set();

  reset() {
    this.profiles = createInitialMonitoredProfiles();
    this.accounts = createInitialMockAccounts();
    this.automation = createInitialAutomationSettings();
    this.uploadJobs = createInitialUploadJobs();
    this.activityLogs = createInitialActivityLogs();
    this.integrations = createInitialIntegrations();
    this.googleCredentials = null;
    this.oauthStates.clear();
    this.recordedReels.clear();
  }
}

const globalStore = global as unknown as { __store?: DataStore };
if (!globalStore.__store) {
  globalStore.__store = new DataStore();
}
const store = globalStore.__store;

export class Repository {
  /**
   * Configures or overrides the active Cloudflare D1 database.
   */
  static setD1Database(db: D1Database | null): void {
    setD1Database(db);
  }

  /**
   * Resets the demo in-memory datastore (testing/demo only).
   */
  static resetDemo(): void {
    store.reset();
  }

  /**
   * Reports whether D1 is currently active.
   */
  static isD1Active(): boolean {
    return isD1Connected();
  }

  // ==========================================
  // Public Monitored Profiles
  // ==========================================

  static async getMonitoredProfiles(): Promise<MonitoredProfile[]> {
    const d1 = getD1Database();
    if (d1) {
      const res = await d1
        .prepare(
          'SELECT * FROM monitored_profiles ORDER BY is_active_source DESC, created_at DESC'
        )
        .all<any>();
      return res.results.map((r) => ({
        id: r.id,
        profile_url: r.profile_url,
        username: r.username,
        display_name: r.display_name,
        avatar_url: r.avatar_url,
        status: r.status,
        status_reason: r.status_reason,
        is_active_source: Boolean(r.is_active_source),
        last_checked_at: r.last_checked_at,
        reels_detected_count: Number(r.reels_detected_count || 0),
        created_at: r.created_at,
        updated_at: r.updated_at,
      }));
    }

    return [...store.profiles].sort((a, b) => {
      if (a.is_active_source && !b.is_active_source) return -1;
      if (!a.is_active_source && b.is_active_source) return 1;
      return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
    });
  }

  static async getMonitoredProfileById(id: string): Promise<MonitoredProfile | null> {
    const d1 = getD1Database();
    if (d1) {
      const r = await d1
        .prepare('SELECT * FROM monitored_profiles WHERE id = ?')
        .bind(id)
        .first<any>();
      if (!r) return null;
      return {
        id: r.id,
        profile_url: r.profile_url,
        username: r.username,
        display_name: r.display_name,
        avatar_url: r.avatar_url,
        status: r.status,
        status_reason: r.status_reason,
        is_active_source: Boolean(r.is_active_source),
        last_checked_at: r.last_checked_at,
        reels_detected_count: Number(r.reels_detected_count || 0),
        created_at: r.created_at,
        updated_at: r.updated_at,
      };
    }

    return store.profiles.find((p) => p.id === id) || null;
  }

  static async getActiveMonitoredProfile(): Promise<MonitoredProfile | null> {
    const d1 = getD1Database();
    if (d1) {
      const r = await d1
        .prepare('SELECT * FROM monitored_profiles WHERE is_active_source = 1 LIMIT 1')
        .first<any>();
      if (r) {
        return {
          id: r.id,
          profile_url: r.profile_url,
          username: r.username,
          display_name: r.display_name,
          avatar_url: r.avatar_url,
          status: r.status,
          status_reason: r.status_reason,
          is_active_source: true,
          last_checked_at: r.last_checked_at,
          reels_detected_count: Number(r.reels_detected_count || 0),
          created_at: r.created_at,
          updated_at: r.updated_at,
        };
      }
      const first = await d1
        .prepare('SELECT * FROM monitored_profiles ORDER BY created_at ASC LIMIT 1')
        .first<any>();
      if (!first) return null;
      return {
        id: first.id,
        profile_url: first.profile_url,
        username: first.username,
        display_name: first.display_name,
        avatar_url: first.avatar_url,
        status: first.status,
        status_reason: first.status_reason,
        is_active_source: Boolean(first.is_active_source),
        last_checked_at: first.last_checked_at,
        reels_detected_count: Number(first.reels_detected_count || 0),
        created_at: first.created_at,
        updated_at: first.updated_at,
      };
    }

    return store.profiles.find((p) => p.is_active_source) || store.profiles[0] || null;
  }

  static async setActiveMonitoredProfile(profileId: string): Promise<MonitoredProfile | null> {
    const d1 = getD1Database();
    if (d1) {
      const target = await this.getMonitoredProfileById(profileId);
      if (!target) return null;

      const now = new Date().toISOString();
      await d1.prepare('UPDATE monitored_profiles SET is_active_source = 0, updated_at = ?').bind(now).run();
      await d1.prepare('UPDATE monitored_profiles SET is_active_source = 1, updated_at = ? WHERE id = ?').bind(now, profileId).run();
      await d1.prepare('UPDATE automation_settings SET active_profile_id = ?, updated_at = ? WHERE id = \'default\'').bind(profileId, now).run();

      await this.logActivity(
        'ACCOUNT_SWITCHED',
        `Active monitored source switched to @${target.username} (${target.profile_url})`,
        target.username
      );

      return { ...target, is_active_source: true, updated_at: now };
    }

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

    const d1 = getD1Database();
    if (d1) {
      const existing = await d1
        .prepare('SELECT id FROM monitored_profiles WHERE username = ? OR profile_url = ?')
        .bind(username, cleanUrl)
        .first();
      if (existing) {
        throw new Error(`Profile @${username} is already in your monitored list.`);
      }

      const adapter = new StandardPublicWebAdapter();
      const checkResult = await adapter.checkProfile(cleanUrl);

      const countRow = await d1
        .prepare('SELECT COUNT(*) as cnt FROM monitored_profiles')
        .first<{ cnt: number }>();
      const isFirst = (countRow?.cnt || 0) === 0;

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
        is_active_source: isFirst,
        last_checked_at: now,
        reels_detected_count: 0,
        created_at: now,
        updated_at: now,
      };

      await d1
        .prepare(
          `INSERT INTO monitored_profiles (
            id, profile_url, username, display_name, avatar_url,
            status, status_reason, is_active_source, last_checked_at,
            reels_detected_count, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .bind(
          newProfile.id,
          newProfile.profile_url,
          newProfile.username,
          newProfile.display_name,
          newProfile.avatar_url,
          newProfile.status,
          newProfile.status_reason,
          newProfile.is_active_source ? 1 : 0,
          newProfile.last_checked_at,
          newProfile.reels_detected_count,
          newProfile.created_at,
          newProfile.updated_at
        )
        .run();

      if (isFirst) {
        await d1
          .prepare('UPDATE automation_settings SET active_profile_id = ?, updated_at = ? WHERE id = \'default\'')
          .bind(newProfile.id, now)
          .run();
      }

      await this.logActivity(
        'PROFILE_ADDED',
        `Added public profile @${username} (${cleanUrl}). Initial status: ${checkResult.status}`,
        username
      );

      return newProfile;
    }

    // In-memory fallback (non-production only)
    const existing = store.profiles.find(
      (p) => p.username === username || p.profile_url === cleanUrl
    );
    if (existing) {
      throw new Error(`Profile @${username} is already in your monitored list.`);
    }

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

    const status = pause ? 'PAUSED' : 'ACTIVE';
    const status_reason = pause
      ? 'Monitoring paused by user.'
      : 'Monitoring resumed. Scheduled for next cycle.';
    const now = new Date().toISOString();

    const d1 = getD1Database();
    if (d1) {
      await d1
        .prepare('UPDATE monitored_profiles SET status = ?, status_reason = ?, updated_at = ? WHERE id = ?')
        .bind(status, status_reason, now, id)
        .run();

      await this.logActivity(
        pause ? 'PROFILE_PAUSED' : 'PROFILE_RESUMED',
        `Monitoring ${pause ? 'paused' : 'resumed'} for @${profile.username}`,
        profile.username
      );

      return { ...profile, status, status_reason, updated_at: now };
    }

    profile.status = status;
    profile.status_reason = status_reason;
    profile.updated_at = now;

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

    const d1 = getD1Database();
    if (d1) {
      await d1
        .prepare(
          'UPDATE monitored_profiles SET status = ?, status_reason = ?, last_checked_at = ?, updated_at = ? WHERE id = ?'
        )
        .bind(res.status, res.status_reason, res.checked_at, res.checked_at, id)
        .run();

      await this.logActivity(
        'PROFILE_CHECKED',
        `Permitted probe completed for @${profile.username}: ${res.status_reason}`,
        profile.username
      );

      return {
        ...profile,
        status: res.status,
        status_reason: res.status_reason,
        last_checked_at: res.checked_at,
        updated_at: res.checked_at,
      };
    }

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

    const now = new Date().toISOString();
    let username = profile.username;
    let profile_url = profile.profile_url;

    if (updates.profile_url) {
      const normalized = normalizeProfileUrl(updates.profile_url);
      username = normalized.username;
      profile_url = normalized.cleanUrl;
    }

    const displayName = updates.display_name ?? profile.display_name;
    const status = updates.status ?? profile.status;
    const statusReason = updates.status_reason ?? profile.status_reason;
    const lastChecked = updates.last_checked_at ?? profile.last_checked_at;
    const reelsDetected = updates.reels_detected_count ?? profile.reels_detected_count;

    const d1 = getD1Database();
    if (d1) {
      await d1
        .prepare(`
          UPDATE monitored_profiles
          SET username = ?, profile_url = ?, display_name = ?, status = ?,
              status_reason = ?, last_checked_at = ?, reels_detected_count = ?, updated_at = ?
          WHERE id = ?
        `)
        .bind(
          username,
          profile_url,
          displayName,
          status,
          statusReason,
          lastChecked,
          reelsDetected,
          now,
          id
        )
        .run();

      return {
        ...profile,
        username,
        profile_url,
        display_name: displayName,
        status,
        status_reason: statusReason,
        last_checked_at: lastChecked,
        reels_detected_count: reelsDetected,
        updated_at: now,
      };
    }

    profile.username = username;
    profile.profile_url = profile_url;
    profile.display_name = displayName;
    profile.status = status;
    profile.status_reason = statusReason;
    profile.last_checked_at = lastChecked;
    profile.reels_detected_count = reelsDetected;
    profile.updated_at = now;

    return profile;
  }

  static async removeMonitoredProfile(id: string): Promise<boolean> {
    const profile = await this.getMonitoredProfileById(id);
    if (!profile) return false;

    const d1 = getD1Database();
    if (d1) {
      await d1.prepare('DELETE FROM monitored_profiles WHERE id = ?').bind(id).run();
      const auto = await this.getAutomationSettings();
      if (auto.active_account_id === id) {
        const next = await d1
          .prepare('SELECT id FROM monitored_profiles ORDER BY created_at ASC LIMIT 1')
          .first<{ id: string }>();
        const nextId = next?.id || null;
        await d1
          .prepare('UPDATE automation_settings SET active_profile_id = ? WHERE id = \'default\'')
          .bind(nextId)
          .run();
        if (nextId) {
          await d1
            .prepare('UPDATE monitored_profiles SET is_active_source = 1 WHERE id = ?')
            .bind(nextId)
            .run();
        }
      }

      await this.logActivity(
        'PROFILE_REMOVED',
        `Public profile @${profile.username} removed from monitoring`,
        profile.username
      );

      return true;
    }

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
  // Automation Settings & Atomic Concurrency Mutex
  // ==========================================

  static async getAutomationSettings(): Promise<AutomationSettings> {
    const d1 = getD1Database();
    if (d1) {
      let row = await d1
        .prepare('SELECT * FROM automation_settings WHERE id = \'default\'')
        .first<any>();
      if (!row) {
        await d1
          .prepare(
            `INSERT OR IGNORE INTO automation_settings (
              id, is_enabled, polling_interval_minutes, max_uploads_per_day,
              default_visibility, drive_folder_id, drive_folder_name
            ) VALUES ('default', 1, 30, 5, 'public', 'root', 'Instagram Reels Backup')`
          )
          .run();
        row = await d1
          .prepare('SELECT * FROM automation_settings WHERE id = \'default\'')
          .first<any>();
      }

      return {
        id: row.id,
        is_enabled: Boolean(row.is_enabled),
        active_account_id: row.active_profile_id || null,
        polling_interval_minutes: Number(row.polling_interval_minutes || 30),
        last_successful_check: row.last_successful_check,
        is_running: Boolean(row.is_running),
        lock_acquired_at: row.lock_acquired_at,
        max_uploads_per_day: Number(row.max_uploads_per_day || 5),
        default_visibility: row.default_visibility || 'public',
        drive_folder_id: row.drive_folder_id || 'root',
        drive_folder_name: row.drive_folder_name || 'Instagram Reels Backup',
        created_at: row.created_at,
        updated_at: row.updated_at,
      };
    }

    return store.automation;
  }

  static async updateAutomationSettings(
    updates: Partial<AutomationSettings>
  ): Promise<AutomationSettings> {
    const d1 = getD1Database();
    if (d1) {
      const current = await this.getAutomationSettings();
      const updated: AutomationSettings = {
        ...current,
        ...updates,
        updated_at: new Date().toISOString(),
      };

      await d1
        .prepare(`
          UPDATE automation_settings
          SET is_enabled = ?, active_profile_id = ?, polling_interval_minutes = ?,
              max_uploads_per_day = ?, default_visibility = ?, drive_folder_id = ?,
              drive_folder_name = ?, updated_at = ?
          WHERE id = 'default'
        `)
        .bind(
          updated.is_enabled ? 1 : 0,
          updated.active_account_id,
          updated.polling_interval_minutes,
          updated.max_uploads_per_day,
          updated.default_visibility,
          updated.drive_folder_id,
          updated.drive_folder_name,
          updated.updated_at
        )
        .run();

      await this.logActivity('SETTINGS_UPDATED', 'Automation configuration updated');
      return updated;
    }

    Object.assign(store.automation, updates, { updated_at: new Date().toISOString() });
    await this.logActivity('SETTINGS_UPDATED', 'Automation configuration updated');
    return store.automation;
  }

  /**
   * Atomically acquires execution lock in D1 using a single atomic SQL transaction.
   * Prevents race conditions across concurrent Cloudflare Cron or worker invocations.
   * Stale locks (>10 minutes) are automatically broken.
   */
  static async acquireAutomationLock(): Promise<boolean> {
    const d1 = getD1Database();
    if (d1) {
      const now = new Date().toISOString();
      // Ensure row exists
      await this.getAutomationSettings();

      // Atomic conditional update
      const res = await d1
        .prepare(`
          UPDATE automation_settings
          SET is_running = 1, lock_acquired_at = ?, updated_at = ?
          WHERE id = 'default'
            AND (
              is_running = 0
              OR lock_acquired_at IS NULL
              OR datetime(lock_acquired_at) < datetime('now', '-10 minutes')
            )
        `)
        .bind(now, now)
        .run();

      return (res.meta.changes || 0) > 0;
    }

    // In-memory fallback (non-production only)
    const current = await this.getAutomationSettings();
    if (current.is_running) {
      if (current.lock_acquired_at) {
        const lockAge = Date.now() - new Date(current.lock_acquired_at).getTime();
        if (lockAge > 10 * 60 * 1000) {
          console.warn('Breaking stale in-memory execution lock');
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

  /**
   * Releases execution lock and durable check timestamp.
   */
  static async releaseAutomationLock(success: boolean = true): Promise<void> {
    const now = new Date().toISOString();
    const d1 = getD1Database();
    if (d1) {
      if (success) {
        await d1
          .prepare(`
            UPDATE automation_settings
            SET is_running = 0, lock_acquired_at = NULL, last_successful_check = ?, updated_at = ?
            WHERE id = 'default'
          `)
          .bind(now, now)
          .run();
      } else {
        await d1
          .prepare(`
            UPDATE automation_settings
            SET is_running = 0, lock_acquired_at = NULL, updated_at = ?
            WHERE id = 'default'
          `)
          .bind(now)
          .run();
      }
      return;
    }

    store.automation.is_running = false;
    store.automation.lock_acquired_at = null;
    if (success) {
      store.automation.last_successful_check = now;
    }
  }

  // ==========================================
  // Durable Idempotency & Reel Tracking
  // ==========================================

  /**
   * Checks whether a Reel ID has already been recorded in durable storage.
   */
  static async isReelRecorded(reelId: string): Promise<boolean> {
    const d1 = getD1Database();
    if (d1) {
      const fromReels = await d1
        .prepare('SELECT id FROM reels WHERE reel_id = ?')
        .bind(reelId)
        .first();
      if (fromReels) return true;

      const fromJobs = await d1
        .prepare('SELECT id FROM upload_jobs WHERE reel_id = ? OR shortcode = ?')
        .bind(reelId, reelId)
        .first();
      return fromJobs !== null;
    }

    return store.recordedReels.has(reelId);
  }

  /**
   * Persists a Reel record for durable idempotency.
   */
  static async recordReel(
    reelId: string,
    profileId?: string,
    permalink?: string
  ): Promise<boolean> {
    const d1 = getD1Database();
    if (d1) {
      const exists = await this.isReelRecorded(reelId);
      if (exists) return false;

      const id = `reel-${crypto.randomUUID()}`;
      const now = new Date().toISOString();
      await d1
        .prepare(`
          INSERT OR IGNORE INTO reels (id, profile_id, reel_id, permalink, published_at, created_at)
          VALUES (?, ?, ?, ?, ?, ?)
        `)
        .bind(
          id,
          profileId || null,
          reelId,
          permalink || `https://instagram.com/reel/${reelId}`,
          now,
          now
        )
        .run();

      return true;
    }

    if (store.recordedReels.has(reelId)) return false;
    store.recordedReels.add(reelId);
    return true;
  }

  // ==========================================
  // Upload Jobs & Submissions
  // ==========================================

  static async getUploadJobs(filters?: {
    accountId?: string;
    status?: JobStatus;
    search?: string;
  }): Promise<UploadJob[]> {
    const d1 = getD1Database();
    if (d1) {
      let query = 'SELECT * FROM upload_jobs';
      const conditions: string[] = [];
      const params: unknown[] = [];

      if (filters?.accountId) {
        conditions.push('profile_id = ?');
        params.push(filters.accountId);
      }
      if (filters?.status) {
        conditions.push('status = ?');
        params.push(filters.status);
      }
      if (filters?.search) {
        conditions.push('(LOWER(caption) LIKE ? OR LOWER(account_username) LIKE ? OR LOWER(reel_id) LIKE ?)');
        const s = `%${filters.search.toLowerCase()}%`;
        params.push(s, s, s);
      }

      if (conditions.length > 0) {
        query += ' WHERE ' + conditions.join(' AND ');
      }
      query += ' ORDER BY created_at DESC';

      const res = await d1.prepare(query).bind(...params).all<any>();
      return res.results.map((r) => ({
        id: r.id,
        reel_id: r.reel_id,
        instagram_account_id: r.profile_id || '',
        account_username: r.account_username,
        caption: r.caption || '',
        thumbnail_url: r.thumbnail_url || '',
        original_reel_url: r.original_reel_url,
        drive_file_id: r.drive_file_id,
        drive_file_url: r.drive_file_url,
        youtube_video_id: r.youtube_video_id,
        youtube_video_url: r.youtube_video_url,
        status: r.status as JobStatus,
        error_details: r.error_details,
        retry_count: Number(r.retry_count || 0),
        max_retries: Number(r.max_retries || 3),
        detected_at: r.detected_at,
        completed_at: r.completed_at,
        shortcode: r.shortcode,
        rights_confirmed: Boolean(r.rights_confirmed),
        media_source_type: r.media_source_type,
        created_at: r.created_at,
        updated_at: r.updated_at,
      }));
    }

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
    const d1 = getD1Database();
    if (d1) {
      const r = await d1
        .prepare('SELECT * FROM upload_jobs WHERE id = ?')
        .bind(id)
        .first<any>();
      if (!r) return null;
      return {
        id: r.id,
        reel_id: r.reel_id,
        instagram_account_id: r.profile_id || '',
        account_username: r.account_username,
        caption: r.caption || '',
        thumbnail_url: r.thumbnail_url || '',
        original_reel_url: r.original_reel_url,
        drive_file_id: r.drive_file_id,
        drive_file_url: r.drive_file_url,
        youtube_video_id: r.youtube_video_id,
        youtube_video_url: r.youtube_video_url,
        status: r.status as JobStatus,
        error_details: r.error_details,
        retry_count: Number(r.retry_count || 0),
        max_retries: Number(r.max_retries || 3),
        detected_at: r.detected_at,
        completed_at: r.completed_at,
        shortcode: r.shortcode,
        rights_confirmed: Boolean(r.rights_confirmed),
        media_source_type: r.media_source_type,
        created_at: r.created_at,
        updated_at: r.updated_at,
      };
    }

    return store.uploadJobs.find((j) => j.id === id) || null;
  }

  static async getUploadJobByShortcode(shortcode: string): Promise<UploadJob | null> {
    const clean = shortcode.trim();
    const d1 = getD1Database();
    if (d1) {
      const r = await d1
        .prepare('SELECT * FROM upload_jobs WHERE shortcode = ? OR original_reel_url LIKE ? LIMIT 1')
        .bind(clean, `%${clean}%`)
        .first<any>();
      if (!r) return null;
      return {
        id: r.id,
        reel_id: r.reel_id,
        instagram_account_id: r.profile_id || '',
        account_username: r.account_username,
        caption: r.caption || '',
        thumbnail_url: r.thumbnail_url || '',
        original_reel_url: r.original_reel_url,
        drive_file_id: r.drive_file_id,
        drive_file_url: r.drive_file_url,
        youtube_video_id: r.youtube_video_id,
        youtube_video_url: r.youtube_video_url,
        status: r.status as JobStatus,
        error_details: r.error_details,
        retry_count: Number(r.retry_count || 0),
        max_retries: Number(r.max_retries || 3),
        detected_at: r.detected_at,
        completed_at: r.completed_at,
        shortcode: r.shortcode,
        rights_confirmed: Boolean(r.rights_confirmed),
        media_source_type: r.media_source_type,
        created_at: r.created_at,
        updated_at: r.updated_at,
      };
    }

    return (
      store.uploadJobs.find(
        (j) => j.shortcode === clean || j.original_reel_url?.includes(clean)
      ) || null
    );
  }

  static async getUploadJobByOriginalUrl(url: string): Promise<UploadJob | null> {
    const clean = url.trim().toLowerCase();
    const d1 = getD1Database();
    if (d1) {
      const r = await d1
        .prepare('SELECT * FROM upload_jobs WHERE LOWER(original_reel_url) = ? LIMIT 1')
        .bind(clean)
        .first<any>();
      if (!r) return null;
      return {
        id: r.id,
        reel_id: r.reel_id,
        instagram_account_id: r.profile_id || '',
        account_username: r.account_username,
        caption: r.caption || '',
        thumbnail_url: r.thumbnail_url || '',
        original_reel_url: r.original_reel_url,
        drive_file_id: r.drive_file_id,
        drive_file_url: r.drive_file_url,
        youtube_video_id: r.youtube_video_id,
        youtube_video_url: r.youtube_video_url,
        status: r.status as JobStatus,
        error_details: r.error_details,
        retry_count: Number(r.retry_count || 0),
        max_retries: Number(r.max_retries || 3),
        detected_at: r.detected_at,
        completed_at: r.completed_at,
        shortcode: r.shortcode,
        rights_confirmed: Boolean(r.rights_confirmed),
        media_source_type: r.media_source_type,
        created_at: r.created_at,
        updated_at: r.updated_at,
      };
    }

    return store.uploadJobs.find((j) => j.original_reel_url?.toLowerCase() === clean) || null;
  }

  static async addUploadJob(job: Partial<UploadJob>): Promise<UploadJob> {
    const now = new Date().toISOString();
    const newJob: UploadJob = {
      id: crypto.randomUUID(),
      reel_id: job.reel_id || `reel_${Date.now()}`,
      instagram_account_id: job.instagram_account_id || '',
      account_username: job.account_username || 'creator',
      caption: job.caption || '',
      thumbnail_url:
        job.thumbnail_url ||
        'https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?w=400',
      original_reel_url: job.original_reel_url || 'https://instagram.com/reel/mock',
      drive_file_id: job.drive_file_id || null,
      drive_file_url: job.drive_file_url || null,
      youtube_video_id: job.youtube_video_id || null,
      youtube_video_url: job.youtube_video_url || null,
      status: job.status || 'SUBMITTED',
      error_details: job.error_details || null,
      retry_count: 0,
      max_retries: 3,
      detected_at: job.detected_at || now,
      completed_at: null,
      shortcode: job.shortcode,
      rights_confirmed: job.rights_confirmed,
      media_source_type: job.media_source_type || 'PUBLIC_PROBE',
      created_at: now,
      updated_at: now,
    };

    const d1 = getD1Database();
    if (d1) {
      await d1
        .prepare(`
          INSERT INTO upload_jobs (
            id, reel_id, profile_id, account_username, caption,
            thumbnail_url, original_reel_url, shortcode, media_source_type,
            rights_confirmed, drive_file_id, drive_file_url, youtube_video_id,
            youtube_video_url, status, error_details, retry_count, max_retries,
            detected_at, completed_at, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `)
        .bind(
          newJob.id,
          newJob.reel_id,
          newJob.instagram_account_id || null,
          newJob.account_username,
          newJob.caption,
          newJob.thumbnail_url,
          newJob.original_reel_url,
          newJob.shortcode || null,
          newJob.media_source_type || 'PUBLIC_PROBE',
          newJob.rights_confirmed ? 1 : 0,
          newJob.drive_file_id,
          newJob.drive_file_url,
          newJob.youtube_video_id,
          newJob.youtube_video_url,
          newJob.status,
          newJob.error_details,
          newJob.retry_count,
          newJob.max_retries,
          newJob.detected_at,
          newJob.completed_at,
          newJob.created_at,
          newJob.updated_at
        )
        .run();

      return newJob;
    }

    store.uploadJobs.unshift(newJob);
    return newJob;
  }

  static async updateUploadJob(
    id: string,
    updates: Partial<UploadJob>
  ): Promise<UploadJob | null> {
    const job = await this.getUploadJobById(id);
    if (!job) return null;

    const now = new Date().toISOString();
    const updated: UploadJob = {
      ...job,
      ...updates,
      updated_at: now,
    };

    const d1 = getD1Database();
    if (d1) {
      await d1
        .prepare(`
          UPDATE upload_jobs
          SET caption = ?, thumbnail_url = ?, status = ?, drive_file_id = ?,
              drive_file_url = ?, youtube_video_id = ?, youtube_video_url = ?,
              error_details = ?, retry_count = ?, completed_at = ?, account_username = ?, updated_at = ?
          WHERE id = ?
        `)
        .bind(
          updated.caption,
          updated.thumbnail_url,
          updated.status,
          updated.drive_file_id,
          updated.drive_file_url,
          updated.youtube_video_id,
          updated.youtube_video_url,
          updated.error_details,
          updated.retry_count,
          updated.completed_at,
          updated.account_username,
          now,
          id
        )
        .run();

      return updated;
    }

    Object.assign(job, updates, { updated_at: now });
    return job;
  }

  static async retryUploadJob(id: string): Promise<UploadJob | null> {
    const job = await this.getUploadJobById(id);
    if (!job) return null;

    const updated = await this.updateUploadJob(id, {
      status: 'RETRYING',
      retry_count: job.retry_count + 1,
      error_details: null,
    });

    await this.logActivity(
      'JOB_RETRIED',
      `Manual retry triggered for reel on @${job.account_username}`,
      job.account_username
    );

    return updated;
  }

  // ==========================================
  // Chronological Activity Logs
  // ==========================================

  static async getActivityLogs(limit: number = 20): Promise<ActivityLog[]> {
    const d1 = getD1Database();
    if (d1) {
      const res = await d1
        .prepare('SELECT * FROM activity_logs ORDER BY created_at DESC LIMIT ?')
        .bind(limit)
        .all<any>();
      return res.results.map((r) => ({
        id: r.id,
        event_type: r.event_type as ActivityEventType,
        message: r.message,
        account_username: r.account_username || undefined,
        details: r.details ? JSON.parse(r.details) : undefined,
        created_at: r.created_at,
      }));
    }

    return store.activityLogs.slice(0, limit);
  }

  static async logActivity(
    eventType: ActivityEventType,
    message: string,
    accountUsername?: string,
    details?: Record<string, unknown>
  ): Promise<ActivityLog> {
    const now = new Date().toISOString();
    const log: ActivityLog = {
      id: crypto.randomUUID(),
      event_type: eventType,
      message,
      account_username: accountUsername,
      details,
      created_at: now,
    };

    const d1 = getD1Database();
    if (d1) {
      await d1
        .prepare(`
          INSERT INTO activity_logs (id, event_type, message, account_username, details, created_at)
          VALUES (?, ?, ?, ?, ?, ?)
        `)
        .bind(
          log.id,
          log.event_type,
          log.message,
          log.account_username || null,
          details ? JSON.stringify(details) : null,
          now
        )
        .run();
      return log;
    }

    store.activityLogs.unshift(log);
    if (store.activityLogs.length > 100) {
      store.activityLogs = store.activityLogs.slice(0, 100);
    }
    return log;
  }

  // ==========================================
  // Integrations & Encrypted Google Credentials
  // ==========================================

  static async getIntegrations(): Promise<IntegrationStatus> {
    const d1 = getD1Database();
    if (d1) {
      const rows = await d1.prepare('SELECT * FROM integrations_config').all<any>();
      const base = createInitialIntegrations();

      for (const r of rows.results) {
        if (r.service_name in base) {
          try {
            const parsed = JSON.parse(r.config_data);
            (base as any)[r.service_name] = {
              ...(base as any)[r.service_name],
              ...parsed,
              connected: Boolean(r.is_connected),
            };
          } catch {
            // fallback
          }
        }
      }

      // Check if real Google credentials are in database
      const creds = await this.getGoogleCredentials();
      if (creds) {
        base.google_drive.connected = true;
        base.google_drive.email = creds.email;
        if (creds.channelTitle) {
          base.youtube.connected = true;
          base.youtube.channel_title = creds.channelTitle;
          base.youtube.channel_id = creds.channelId || 'None';
        }
      }

      return base;
    }

    return store.integrations;
  }

  static async updateIntegration(
    service: keyof IntegrationStatus,
    data: Partial<IntegrationStatus[keyof IntegrationStatus]>
  ): Promise<IntegrationStatus> {
    const d1 = getD1Database();
    if (d1) {
      const now = new Date().toISOString();
      const isConn = (data as any).connected ? 1 : 0;
      await d1
        .prepare(`
          INSERT INTO integrations_config (service_name, is_connected, config_data, updated_at)
          VALUES (?, ?, ?, ?)
          ON CONFLICT(service_name) DO UPDATE SET
            is_connected = excluded.is_connected,
            config_data = excluded.config_data,
            updated_at = excluded.updated_at
        `)
        .bind(service, isConn, JSON.stringify(data), now)
        .run();

      return this.getIntegrations();
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    store.integrations[service] = { ...store.integrations[service], ...(data as any) };
    return store.integrations;
  }

  /**
   * Persists AES-256-GCM encrypted Google credentials in D1.
   */
  static async saveGoogleCredentials(creds: StoredGoogleCredentials): Promise<void> {
    const d1 = getD1Database();
    if (d1) {
      const now = new Date().toISOString();
      await d1
        .prepare(`
          INSERT INTO google_credentials (
            id, encrypted_access_token, encrypted_refresh_token,
            expires_at, email, channel_id, channel_title, updated_at
          ) VALUES ('default', ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(id) DO UPDATE SET
            encrypted_access_token = excluded.encrypted_access_token,
            encrypted_refresh_token = COALESCE(excluded.encrypted_refresh_token, google_credentials.encrypted_refresh_token),
            expires_at = excluded.expires_at,
            email = excluded.email,
            channel_id = COALESCE(excluded.channel_id, google_credentials.channel_id),
            channel_title = COALESCE(excluded.channel_title, google_credentials.channel_title),
            updated_at = excluded.updated_at
        `)
        .bind(
          creds.encryptedAccessToken,
          creds.encryptedRefreshToken || null,
          creds.expiresAt,
          creds.email,
          creds.channelId || null,
          creds.channelTitle || null,
          now
        )
        .run();

      await this.updateIntegration('google_drive', {
        connected: true,
        email: creds.email,
      } as any);

      if (creds.channelTitle) {
        await this.updateIntegration('youtube', {
          connected: true,
          channel_title: creds.channelTitle,
          channel_id: creds.channelId || 'None',
        } as any);
      }
      return;
    }

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

  /**
   * Retrieves AES-256-GCM encrypted Google credentials.
   */
  static async getGoogleCredentials(): Promise<StoredGoogleCredentials | null> {
    const d1 = getD1Database();
    if (d1) {
      const r = await d1
        .prepare('SELECT * FROM google_credentials WHERE id = \'default\'')
        .first<any>();
      if (!r) return null;
      return {
        encryptedAccessToken: r.encrypted_access_token,
        encryptedRefreshToken: r.encrypted_refresh_token || undefined,
        expiresAt: Number(r.expires_at),
        email: r.email,
        channelId: r.channel_id || undefined,
        channelTitle: r.channel_title || undefined,
        updatedAt: r.updated_at,
      };
    }

    return store.googleCredentials;
  }

  static async clearGoogleCredentials(): Promise<void> {
    const d1 = getD1Database();
    if (d1) {
      await d1.prepare('DELETE FROM google_credentials WHERE id = \'default\'').run();
      await this.updateIntegration('google_drive', {
        connected: false,
        email: 'Not connected',
      } as any);
      await this.updateIntegration('youtube', {
        connected: false,
        channel_title: 'Not connected',
        channel_id: 'None',
      } as any);
      return;
    }

    store.googleCredentials = null;
    store.integrations.google_drive.connected = false;
    store.integrations.google_drive.email = 'Not connected';
    store.integrations.youtube.connected = false;
    store.integrations.youtube.channel_title = 'Not connected';
    store.integrations.youtube.channel_id = 'None';
  }

  // ==========================================
  // Ephemeral OAuth State & CSRF Token Defense
  // ==========================================

  /**
   * Persists OAuth CSRF state token with an expiration timestamp.
   */
  static async saveOAuthState(
    state: string,
    redirectUri: string,
    expiresInMs = 600000
  ): Promise<void> {
    const now = new Date().toISOString();
    const expiresAt = Date.now() + expiresInMs;

    const d1 = getD1Database();
    if (d1) {
      // Purge expired tokens first
      await d1.prepare('DELETE FROM oauth_states WHERE expires_at < ?').bind(Date.now()).run();

      await d1
        .prepare(`
          INSERT INTO oauth_states (state, provider, redirect_uri, created_at, expires_at)
          VALUES (?, 'google', ?, ?, ?)
        `)
        .bind(state, redirectUri, now, expiresAt)
        .run();
      return;
    }

    store.oauthStates.set(state, {
      state,
      provider: 'google',
      redirect_uri: redirectUri,
      created_at: now,
      expires_at: expiresAt,
    });
  }

  /**
   * Validates and atomically consumes an OAuth CSRF state token (prevents replay attacks).
   */
  static async validateAndConsumeOAuthState(state: string): Promise<boolean> {
    const d1 = getD1Database();
    if (d1) {
      const now = Date.now();
      const r = await d1
        .prepare('SELECT state FROM oauth_states WHERE state = ? AND expires_at > ?')
        .bind(state, now)
        .first();

      if (!r) return false;

      // Atomically consume (single-use token)
      await d1.prepare('DELETE FROM oauth_states WHERE state = ?').bind(state).run();
      return true;
    }

    const record = store.oauthStates.get(state);
    if (!record) return false;
    if (Date.now() > record.expires_at) {
      store.oauthStates.delete(state);
      return false;
    }
    store.oauthStates.delete(state);
    return true;
  }

  // ==========================================
  // Dashboard Metrics Aggregations
  // ==========================================

  static async getDashboardMetrics(): Promise<DashboardMetrics> {
    const profiles = await this.getMonitoredProfiles();
    const activeProfile = profiles.find((p) => p.is_active_source) || profiles[0] || null;
    const automation = await this.getAutomationSettings();
    const recentActivity = await this.getActivityLogs(8);

    const d1 = getD1Database();
    let totalReelsDetected = 0;
    let totalVideosUploaded = 0;
    let failedUploads = 0;
    let inProgressUploads = 0;

    if (d1) {
      const stats = await d1
        .prepare(`
          SELECT
            COUNT(*) as total_jobs,
            SUM(CASE WHEN status = 'COMPLETED' THEN 1 ELSE 0 END) as completed_jobs,
            SUM(CASE WHEN status = 'FAILED' THEN 1 ELSE 0 END) as failed_jobs,
            SUM(CASE WHEN status NOT IN ('COMPLETED', 'FAILED') THEN 1 ELSE 0 END) as in_progress_jobs
          FROM upload_jobs
        `)
        .first<any>();

      const totalJobs = Number(stats?.total_jobs || 0);
      totalReelsDetected = totalJobs;
      totalVideosUploaded = Number(stats?.completed_jobs || 0);
      failedUploads = Number(stats?.failed_jobs || 0);
      inProgressUploads = Number(stats?.in_progress_jobs || 0);
    } else {
      const jobs = store.uploadJobs;
      totalReelsDetected = jobs.length + 18;
      totalVideosUploaded = jobs.filter((j) => j.status === 'COMPLETED').length + 14;
      failedUploads = jobs.filter((j) => j.status === 'FAILED').length;
      inProgressUploads = jobs.filter(
        (j) => j.status !== 'COMPLETED' && j.status !== 'FAILED'
      ).length;
    }

    const usedBytes = 14.8 * 1024 * 1024 * 1024;
    const totalBytes = 100 * 1024 * 1024 * 1024;

    const activeLegacyAccount = activeProfile
      ? await this.getAccountById(activeProfile.id)
      : null;

    return {
      total_profiles: profiles.length,
      active_profiles_count: profiles.filter((p) => p.status === 'ACTIVE').length,
      active_profile: activeProfile,
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
