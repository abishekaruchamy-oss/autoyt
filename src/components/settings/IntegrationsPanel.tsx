'use client';

import React, { useState } from 'react';
import {
  HardDrive,
  CheckCircle2,
  AlertCircle,
  ExternalLink,
  Shield,
  RotateCcw,
  Save,
  LogIn,
  LogOut,
  Play,
  Cloud,
} from 'lucide-react';
import { Instagram } from '@/components/ui/Icons';
import { authFetch } from '@/lib/clientAuthFetch';
import type { OAuthBannerFeedback } from '@/lib/oauthFeedback';
import {
  IntegrationStatus,
  AutomationSettings,
  PublishingVisibility,
  ExecutionReadiness,
} from '@/types';
import Link from 'next/link';

interface IntegrationsPanelProps {
  integrations: IntegrationStatus;
  automation: AutomationSettings;
  readiness?: ExecutionReadiness;
  isProduction?: boolean;
  accountsCount: number;
  oauthBanner?: OAuthBannerFeedback | null;
  onDismissOAuthBanner?: () => void;
  onUpdate: () => void;
}

export function IntegrationsPanel({
  integrations,
  automation,
  readiness,
  isProduction = false,
  accountsCount,
  oauthBanner,
  onDismissOAuthBanner,
  onUpdate,
}: IntegrationsPanelProps) {
  const [driveFolder, setDriveFolder] = useState(automation.drive_folder_name);
  const [youtubeVisibility, setYoutubeVisibility] = useState(automation.default_visibility);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [syncMessage, setSyncMessage] = useState<string | null>(null);

  const isGoogleConnected =
    integrations.google_drive.connected &&
    integrations.google_drive.email !== 'Not connected' &&
    integrations.google_drive.email !== '';

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      setSaving(true);
      setSaved(false);
      const res = await authFetch('/api/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          automation: {
            drive_folder_name: driveFolder,
            default_visibility: youtubeVisibility,
          },
        }),
      });
      const data = (await res.json()) as { success: boolean; error?: string };
      if (data.success) {
        setSaved(true);
        setTimeout(() => setSaved(false), 2500);
        onUpdate();
      } else {
        alert(data.error || 'Error saving settings');
      }
    } catch {
      alert('Error saving settings');
    } finally {
      setSaving(false);
    }
  };

  const handleDisconnectGoogle = async () => {
    if (confirm('Disconnect your Google account? Uploads to Google Drive and YouTube Shorts will be paused.')) {
      try {
        const res = await authFetch('/api/auth/google/disconnect', { method: 'POST' });
        const data = (await res.json()) as { success: boolean; error?: string };
        if (data.success) {
          onUpdate();
        } else {
          alert(`Error: ${data.error}`);
        }
      } catch (err) {
        alert(`Failed to disconnect: ${(err as Error).message}`);
      }
    }
  };

  const handleTriggerSync = async () => {
    try {
      setSyncing(true);
      setSyncMessage(null);
      const res = await authFetch('/api/automation/sync-now', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sandbox: false }),
      });
      const data = (await res.json()) as { success: boolean; message?: string; error?: string };
      if (data.success) {
        setSyncMessage(data.message || 'Sync completed successfully.');
        onUpdate();
      } else {
        setSyncMessage(`Sync failed: ${data.error}`);
      }
    } catch (err) {
      setSyncMessage(`Sync error: ${(err as Error).message}`);
    } finally {
      setSyncing(false);
    }
  };

  const handleResetDemo = async () => {
    if (isProduction) {
      setSyncMessage('Demo reset is disabled in production Cloudflare D1 environments.');
      return;
    }
    if (
      confirm(
        'Reset local non-production development data back to sample records? This affects local memory only and is permanently disabled in production D1.'
      )
    ) {
      const res = await authFetch('/api/demo/reset', { method: 'POST' });
      const data = (await res.json()) as { success?: boolean; error?: string };
      if (!res.ok || !data.success) {
        setSyncMessage(`Reset blocked: ${data.error || 'Demo reset is unavailable.'}`);
        return;
      }
      onUpdate();
    }
  };

  return (
    <div className="space-y-6">
      {oauthBanner && (
        <div
          role="status"
          className={`p-4 rounded-2xl border flex items-start justify-between gap-4 text-xs ${
            oauthBanner.variant === 'success'
              ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-200'
              : oauthBanner.variant === 'warning'
              ? 'bg-amber-500/10 border-amber-500/30 text-amber-200'
              : 'bg-rose-500/10 border-rose-500/30 text-rose-200'
          }`}
        >
          <div className="flex items-start gap-2.5">
            {oauthBanner.variant === 'success' ? (
              <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
            ) : (
              <AlertCircle
                className={`w-4 h-4 shrink-0 mt-0.5 ${
                  oauthBanner.variant === 'warning' ? 'text-amber-400' : 'text-rose-400'
                }`}
              />
            )}
            <div>
              <p className="font-bold">{oauthBanner.title}</p>
              <p className="mt-0.5 opacity-90">{oauthBanner.message}</p>
            </div>
          </div>
          {onDismissOAuthBanner && (
            <button
              type="button"
              onClick={onDismissOAuthBanner}
              className="text-zinc-400 hover:text-zinc-200 shrink-0"
            >
              Dismiss
            </button>
          )}
        </div>
      )}

      {syncMessage && (
        <div className="p-4 rounded-2xl bg-zinc-900 border border-zinc-800 flex items-center justify-between text-xs">
          <div className="flex items-center gap-2 text-zinc-200">
            <CheckCircle2 className="w-4 h-4 text-emerald-400" />
            <span>{syncMessage}</span>
          </div>
          <button
            onClick={() => setSyncMessage(null)}
            className="text-zinc-500 hover:text-zinc-300"
          >
            Dismiss
          </button>
        </div>
      )}

      <form onSubmit={handleSave} className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* 1. Google Drive & YouTube OAuth Connection Card */}
        <div className="bg-zinc-900/60 border border-zinc-800 rounded-3xl p-6 flex flex-col justify-between space-y-4">
          <div>
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-2xl bg-cyan-500/10 text-cyan-400 flex items-center justify-center">
                  <HardDrive className="w-5 h-5" />
                </div>
                <div>
                  <h4 className="text-base font-bold text-white">Google Drive & YouTube</h4>
                  <span className="text-xs text-zinc-400">Google Cloud OAuth 2.0</span>
                </div>
              </div>
              {isGoogleConnected ? (
                <span className="px-2.5 py-1 rounded-full text-[10px] font-bold bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 flex items-center gap-1">
                  <CheckCircle2 className="w-3 h-3" /> Connected
                </span>
              ) : (
                <span className="px-2.5 py-1 rounded-full text-[10px] font-bold bg-amber-500/10 text-amber-400 border border-amber-500/20 flex items-center gap-1">
                  <AlertCircle className="w-3 h-3" /> Authorization Needed
                </span>
              )}
            </div>

            <p className="text-xs text-zinc-400 leading-relaxed mb-4">
              Connect your Google Account to enable automatic video archiving in Google Drive and publishing to YouTube Shorts.
            </p>

            <div className="space-y-3 bg-zinc-950/60 p-4 rounded-2xl border border-zinc-800/80 text-xs">
              <div className="flex justify-between items-center">
                <span className="text-zinc-400">Google Account:</span>
                <span className="text-zinc-200 font-semibold font-mono text-[11px]">
                  {isGoogleConnected ? integrations.google_drive.email : 'Not Authorized'}
                </span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-zinc-400">YouTube Channel:</span>
                <span className="text-zinc-200 font-semibold">
                  {integrations.youtube.connected ? integrations.youtube.channel_title : 'Pending Authorization'}
                </span>
              </div>
              <div>
                <label className="text-zinc-400 block mb-1.5 font-medium">Drive Archive Folder:</label>
                <input
                  type="text"
                  value={driveFolder}
                  onChange={(e) => setDriveFolder(e.target.value)}
                  placeholder="Instagram Reels Backup"
                  className="w-full bg-zinc-900 border border-zinc-800 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-rose-500"
                />
              </div>
              <div>
                <label className="text-zinc-400 block mb-1.5 font-medium">Default YouTube Visibility:</label>
                <select
                  value={youtubeVisibility}
                  onChange={(e) => setYoutubeVisibility(e.target.value as PublishingVisibility)}
                  className="w-full bg-zinc-900 border border-zinc-800 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-rose-500"
                >
                  <option value="public">Public (Immediate Live Shorts)</option>
                  <option value="unlisted">Unlisted (Review First)</option>
                  <option value="private">Private (Only You)</option>
                </select>
              </div>
            </div>
          </div>

          <div className="pt-2">
            {isGoogleConnected ? (
              <button
                type="button"
                onClick={handleDisconnectGoogle}
                className="w-full py-2.5 px-4 rounded-xl text-xs font-semibold bg-zinc-900 hover:bg-red-500/10 text-red-400 border border-zinc-800 hover:border-red-500/30 flex items-center justify-center gap-2 transition-colors"
              >
                <LogOut className="w-3.5 h-3.5" />
                <span>Disconnect Google Account</span>
              </button>
            ) : (
              <a
                href="/api/auth/google/authorize"
                className="w-full py-2.5 px-4 rounded-xl text-xs font-bold bg-blue-600 hover:bg-blue-500 text-white flex items-center justify-center gap-2 transition-all shadow-md shadow-blue-600/30"
              >
                <LogIn className="w-4 h-4" />
                <span>Connect with Google (Drive + YouTube)</span>
              </a>
            )}
          </div>
        </div>

        {/* 2. Instagram Public Profile Monitoring (Phase 1.1 + Phase 2) */}
        <div className="bg-zinc-900/60 border border-zinc-800 rounded-3xl p-6 flex flex-col justify-between space-y-4">
          <div>
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-2xl bg-pink-500/10 text-pink-400 flex items-center justify-center">
                  <Instagram className="w-5 h-5" />
                </div>
                <div>
                  <h4 className="text-base font-bold text-white">Public Profile Monitoring</h4>
                  <span className="text-xs text-zinc-400">Zero-OAuth Web Adapter</span>
                </div>
              </div>
              <span className="px-2.5 py-1 rounded-full text-[10px] font-bold bg-purple-500/10 text-purple-400 border border-purple-500/20">
                {accountsCount} Profiles
              </span>
            </div>

            <p className="text-xs text-zinc-400 leading-relaxed mb-4">
              Monitors public Instagram Creator profiles using terms-compliant public web requests. No account login, cookies, or passwords required.
            </p>

            <div className="space-y-2.5 bg-zinc-950/60 p-4 rounded-2xl border border-zinc-800/80 text-xs">
              <div className="flex justify-between">
                <span className="text-zinc-400">Authentication Mode:</span>
                <span className="text-emerald-400 font-semibold">Zero-OAuth (Public URLs)</span>
              </div>
              <div className="flex justify-between">
                <span className="text-zinc-400">Deduplication Store:</span>
                <span className="text-emerald-400 font-semibold">Persistent D1 / SQLite</span>
              </div>
              <div className="flex justify-between">
                <span className="text-zinc-400">Compliance Status:</span>
                <span className="text-zinc-300 font-medium">Standard GET Probes (No Bypasses)</span>
              </div>
            </div>
          </div>

          <div className="pt-2">
            <Link
              href="/accounts"
              className="w-full py-2.5 px-4 rounded-xl text-xs font-semibold bg-zinc-900 hover:bg-zinc-800 text-zinc-200 border border-zinc-800 flex items-center justify-center gap-2 transition-colors"
            >
              <span>Manage Monitored Profiles</span>
              <ExternalLink className="w-3.5 h-3.5 text-zinc-400" />
            </Link>
          </div>
        </div>

        {/* 3. Serverless Cloud Architecture (Cloudflare Workers / D1 / Cron) */}
        <div className="bg-zinc-900/60 border border-zinc-800 rounded-3xl p-6 flex flex-col justify-between space-y-4">
          <div>
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-2xl bg-amber-500/10 text-amber-400 flex items-center justify-center">
                  <Cloud className="w-5 h-5" />
                </div>
                <div>
                  <h4 className="text-base font-bold text-white">Cloudflare Serverless</h4>
                  <span className="text-xs text-zinc-400">Workers + D1 + Cron</span>
                </div>
              </div>
              {readiness?.ready_for_live_upload ? (
                <span className="px-2.5 py-1 rounded-full text-[10px] font-bold bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 flex items-center gap-1">
                  <CheckCircle2 className="w-3 h-3" /> Live Ready
                </span>
              ) : (
                <span className="px-2.5 py-1 rounded-full text-[10px] font-bold bg-amber-500/10 text-amber-300 border border-amber-500/20 flex items-center gap-1">
                  <AlertCircle className="w-3 h-3" /> Setup Incomplete
                </span>
              )}
            </div>

            <p className="text-xs text-zinc-400 leading-relaxed mb-4">
              Executes on Cloudflare Workers with Cloudflare D1 persistence and scheduled Cron triggers. Live upload execution remains blocked until required integrations and a monitored profile pass readiness checks.
            </p>

            <div className="space-y-2.5 bg-zinc-950/60 p-4 rounded-2xl border border-zinc-800/80 text-xs">
              <div className="flex justify-between gap-2">
                <span className="text-zinc-400">Cron Schedule:</span>
                <span className="font-mono text-zinc-300">*/30 * * * * (Every 30m)</span>
              </div>
              <div className="flex justify-between gap-2">
                <span className="text-zinc-400">Database Binding:</span>
                <span className="font-mono text-zinc-300">DB (autoshorts-db)</span>
              </div>
              <div className="flex justify-between gap-2">
                <span className="text-zinc-400">Concurrency Lock:</span>
                <span className="text-emerald-400 font-semibold">D1 Atomic Mutex</span>
              </div>
            </div>
          </div>

          <div className="pt-2 space-y-2">
            {readiness && !readiness.ready_for_live_upload && (
              <p className="text-[11px] text-amber-300 bg-amber-500/10 border border-amber-500/20 rounded-xl px-3 py-2 leading-relaxed">
                Readiness blocked: {readiness.blocking_reasons.join(' ')}
              </p>
            )}
            <button
              type="button"
              disabled={syncing || (readiness ? !readiness.ready_for_live_upload : false)}
              onClick={handleTriggerSync}
              className="w-full py-2.5 px-4 rounded-xl text-xs font-semibold bg-emerald-600/10 hover:bg-emerald-600/20 text-emerald-400 border border-emerald-500/30 flex items-center justify-center gap-2 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <Play className="w-3.5 h-3.5" />
              <span>{syncing ? 'Running Sync Pipeline...' : 'Run Pipeline Sync Now'}</span>
            </button>
          </div>
        </div>

        {/* 4. Security, AutoShorts Limits, Cloudflare & Google Quotas */}
        <div className="bg-zinc-900/60 border border-zinc-800 rounded-3xl p-6 flex flex-col justify-between space-y-4">
          <div>
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-2xl bg-purple-500/10 text-purple-400 flex items-center justify-center">
                  <Shield className="w-5 h-5" />
                </div>
                <div>
                  <h4 className="text-base font-bold text-white">Limits, Platform & API Quotas</h4>
                  <span className="text-xs text-zinc-400">App, Cloudflare & Google Boundaries</span>
                </div>
              </div>
              <span className="px-2.5 py-1 rounded-full text-[10px] font-bold bg-blue-500/10 text-blue-400 border border-blue-500/20">
                AES-256-GCM
              </span>
            </div>

            <p className="text-xs text-zinc-400 leading-relaxed mb-4">
              AutoShorts application ceilings are configured in D1 independently from Cloudflare Workers execution limits and upstream Google OAuth API quotas.
            </p>

            <div className="space-y-2.5 bg-zinc-950/60 p-4 rounded-2xl border border-zinc-800/80 text-xs">
              <div className="flex justify-between gap-2">
                <span className="text-zinc-400">AutoShorts Daily Cap:</span>
                <span className="font-semibold text-zinc-200">
                  {readiness ? `${readiness.daily_uploads_used} / ` : ''}
                  {automation.max_uploads_per_day} uploads/day
                </span>
              </div>
              <div className="flex justify-between gap-2">
                <span className="text-zinc-400">Cloudflare Chunk Streaming:</span>
                <span className="text-zinc-300 font-mono text-[11px]">5 MB resumable buffers</span>
              </div>
              <div className="flex justify-between gap-2">
                <span className="text-zinc-400">Google API Quota State:</span>
                <span
                  className={
                    integrations.youtube.connected && integrations.google_drive.connected
                      ? 'text-emerald-400 font-semibold'
                      : 'text-amber-300 font-semibold'
                  }
                >
                  {integrations.youtube.connected && integrations.google_drive.connected
                    ? 'Connected (OAuth Active)'
                    : 'Not Connected (N/A)'}
                </span>
              </div>
            </div>
          </div>

          <div className="pt-2 text-center text-[11px] text-zinc-500">
            Encrypted Google credentials are never returned in API payloads.
          </div>
        </div>

        {/* Submit & Production-Safe Dev Reset Bar */}
        <div className="md:col-span-2 flex flex-col sm:flex-row items-center justify-between gap-4 pt-4 border-t border-zinc-800">
          {!isProduction ? (
            <div className="flex flex-col sm:flex-row sm:items-center gap-2.5">
              <button
                type="button"
                onClick={handleResetDemo}
                className="flex items-center gap-2 text-xs text-zinc-400 hover:text-zinc-200 px-4 py-2 rounded-xl bg-zinc-900 border border-zinc-800 hover:bg-zinc-800 transition-colors"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                <span>Reset Local Dev Store</span>
              </button>
              <span className="text-[11px] text-zinc-500">
                Resets local non-production memory only (disabled on production D1).
              </span>
            </div>
          ) : (
            <span className="text-[11px] text-zinc-500">
              Production safeguard active: demo reset is disabled on Cloudflare D1.
            </span>
          )}

          <button
            type="submit"
            disabled={saving}
            className="w-full sm:w-auto px-6 py-2.5 rounded-xl text-xs font-bold bg-rose-600 hover:bg-rose-500 text-white flex items-center justify-center gap-2 transition-all shadow-md shadow-rose-600/30 disabled:opacity-50"
          >
            <Save className="w-4 h-4" />
            <span>{saving ? 'Saving Changes...' : saved ? 'Saved!' : 'Save Integration Settings'}</span>
          </button>
        </div>
      </form>
    </div>
  );
}
