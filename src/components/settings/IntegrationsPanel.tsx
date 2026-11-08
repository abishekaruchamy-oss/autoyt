'use client';

import React, { useState } from 'react';
import {
  HardDrive,
  UploadCloud,
  Cpu,
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
  Check,
} from 'lucide-react';
import { Instagram } from '@/components/ui/Icons';
import { IntegrationStatus, AutomationSettings } from '@/types';
import Link from 'next/link';

interface IntegrationsPanelProps {
  integrations: IntegrationStatus;
  automation: AutomationSettings;
  accountsCount: number;
  onUpdate: () => void;
}

export function IntegrationsPanel({
  integrations,
  automation,
  accountsCount,
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
      const res = await fetch('/api/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          automation: {
            drive_folder_name: driveFolder,
            default_visibility: youtubeVisibility,
          },
        }),
      });
      const data = await res.json();
      if (data.success) {
        setSaved(true);
        setTimeout(() => setSaved(false), 2500);
        onUpdate();
      }
    } catch {
      alert('Error saving settings');
    } finally {
      setSaving(false);
    }
  };

  const handleConnectGoogle = () => {
    window.location.href = '/api/auth/google/authorize';
  };

  const handleDisconnectGoogle = async () => {
    if (confirm('Disconnect your Google account? Uploads to Google Drive and YouTube Shorts will be paused.')) {
      try {
        const res = await fetch('/api/auth/google/disconnect', { method: 'POST' });
        const data = await res.json();
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
      const res = await fetch('/api/automation/sync-now', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sandbox: false }),
      });
      const data = await res.json();
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
    if (confirm('Reset all demo state to original sample records?')) {
      await fetch('/api/demo/reset', { method: 'POST' });
      window.location.reload();
    }
  };

  return (
    <div className="space-y-6">
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
                  onChange={(e) => setYoutubeVisibility(e.target.value as any)}
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
              <button
                type="button"
                onClick={handleConnectGoogle}
                className="w-full py-2.5 px-4 rounded-xl text-xs font-bold bg-blue-600 hover:bg-blue-500 text-white flex items-center justify-center gap-2 transition-all shadow-md shadow-blue-600/30"
              >
                <LogIn className="w-4 h-4" />
                <span>Connect with Google (Drive + YouTube)</span>
              </button>
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
              <span className="px-2.5 py-1 rounded-full text-[10px] font-bold bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 flex items-center gap-1">
                <CheckCircle2 className="w-3 h-3" /> Ready
              </span>
            </div>

            <p className="text-xs text-zinc-400 leading-relaxed mb-4">
              Production target executes on Cloudflare edge workers with zero container overhead and automated Cron triggers.
            </p>

            <div className="space-y-2.5 bg-zinc-950/60 p-4 rounded-2xl border border-zinc-800/80 text-xs">
              <div className="flex justify-between">
                <span className="text-zinc-400">Cron Schedule:</span>
                <span className="font-mono text-zinc-300">*/30 * * * * (Every 30m)</span>
              </div>
              <div className="flex justify-between">
                <span className="text-zinc-400">Database Binding:</span>
                <span className="font-mono text-zinc-300">DB (autoshorts-d1)</span>
              </div>
              <div className="flex justify-between">
                <span className="text-zinc-400">Concurrency Lock:</span>
                <span className="text-emerald-400 font-semibold">Active & Mutex-Protected</span>
              </div>
            </div>
          </div>

          <div className="pt-2">
            <button
              type="button"
              disabled={syncing}
              onClick={handleTriggerSync}
              className="w-full py-2.5 px-4 rounded-xl text-xs font-semibold bg-emerald-600/10 hover:bg-emerald-600/20 text-emerald-400 border border-emerald-500/30 flex items-center justify-center gap-2 transition-colors disabled:opacity-50"
            >
              <Play className="w-3.5 h-3.5" />
              <span>{syncing ? 'Running Sync Pipeline...' : 'Run Pipeline Sync Now'}</span>
            </button>
          </div>
        </div>

        {/* 4. Security & API Quotas */}
        <div className="bg-zinc-900/60 border border-zinc-800 rounded-3xl p-6 flex flex-col justify-between space-y-4">
          <div>
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-2xl bg-purple-500/10 text-purple-400 flex items-center justify-center">
                  <Shield className="w-5 h-5" />
                </div>
                <div>
                  <h4 className="text-base font-bold text-white">Quotas & Security</h4>
                  <span className="text-xs text-zinc-400">Safety Ceilings</span>
                </div>
              </div>
              <span className="px-2.5 py-1 rounded-full text-[10px] font-bold bg-blue-500/10 text-blue-400 border border-blue-500/20">
                Protected
              </span>
            </div>

            <p className="text-xs text-zinc-400 leading-relaxed mb-4">
              All credentials encrypted at rest. YouTube API quotas are capped to stay comfortably within free-tier allowances.
            </p>

            <div className="space-y-2.5 bg-zinc-950/60 p-4 rounded-2xl border border-zinc-800/80 text-xs">
              <div className="flex justify-between">
                <span className="text-zinc-400">Token Encryption:</span>
                <span className="text-emerald-400 font-semibold">AES-256-GCM Active</span>
              </div>
              <div className="flex justify-between">
                <span className="text-zinc-400">Daily Upload Ceiling:</span>
                <span className="font-semibold text-zinc-200">{automation.max_uploads_per_day} uploads/day (Configurable)</span>
              </div>
              <div className="flex justify-between">
                <span className="text-zinc-400">YouTube Upload Limit Bucket:</span>
                <span className="text-zinc-400 font-mono text-[11px]">~100 uploads/day limit</span>
              </div>
            </div>
          </div>

          <div className="pt-2 text-center text-[11px] text-zinc-500">
            Resumable 5MB streaming chunks prevent memory spikes.
          </div>
        </div>

        {/* Submit & Reset Bar */}
        <div className="md:col-span-2 flex flex-col sm:flex-row items-center justify-between gap-4 pt-4 border-t border-zinc-800">
          <button
            type="button"
            onClick={handleResetDemo}
            className="flex items-center gap-2 text-xs text-zinc-400 hover:text-zinc-200 px-4 py-2 rounded-xl bg-zinc-900 border border-zinc-800 hover:bg-zinc-800 transition-colors"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            <span>Reset Demo State</span>
          </button>

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
