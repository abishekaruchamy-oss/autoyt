'use client';

import React, { useState } from 'react';
import {
  RefreshCw,
  Clock,
  ShieldCheck,
  Check,
  Sliders,
  Folder,
  Eye,
} from 'lucide-react';
import { Instagram } from '@/components/ui/Icons';
import { AutomationSettings, InstagramAccount, PublishingVisibility } from '@/types';
import { formatRelativeTime } from '@/lib/utils';
import { authFetch } from '@/lib/clientAuthFetch';

interface AutomationSettingsFormProps {
  automation: AutomationSettings;
  accounts: InstagramAccount[];
  onUpdate: () => void;
}

const POLLING_OPTIONS = [
  { value: 15, label: 'Every 15 minutes (High frequency)' },
  { value: 30, label: 'Every 30 minutes (Recommended)' },
  { value: 60, label: 'Every 1 hour (Standard)' },
  { value: 120, label: 'Every 2 hours' },
  { value: 360, label: 'Every 6 hours' },
  { value: 1440, label: 'Once a day (24 hours)' },
];

export function AutomationSettingsForm({
  automation,
  accounts,
  onUpdate,
}: AutomationSettingsFormProps) {
  const [isEnabled, setIsEnabled] = useState(automation.is_enabled);
  const [activeAccountId, setActiveAccountId] = useState(automation.active_account_id || '');
  const [interval, setInterval] = useState(automation.polling_interval_minutes);
  const [maxUploads, setMaxUploads] = useState(automation.max_uploads_per_day);
  const [visibility, setVisibility] = useState<PublishingVisibility>(automation.default_visibility);
  const [folderName, setFolderName] = useState(automation.drive_folder_name);
  const [saving, setSaving] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      setSaving(true);
      setSaveSuccess(false);

      // If active account changed, call activate endpoint
      if (activeAccountId && activeAccountId !== automation.active_account_id) {
        await authFetch(`/api/accounts/${activeAccountId}/activate`, { method: 'POST' });
      }

      const res = await authFetch('/api/automation', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          is_enabled: isEnabled,
          polling_interval_minutes: Number(interval),
          max_uploads_per_day: Number(maxUploads),
          default_visibility: visibility,
          drive_folder_name: folderName,
        }),
      });

      const data = (await res.json()) as { success: boolean; error?: string };
      if (data.success) {
        setSaveSuccess(true);
        setTimeout(() => setSaveSuccess(false), 2500);
        onUpdate();
      } else {
        alert(data.error || 'Failed to update settings');
      }
    } catch {
      alert('Error updating automation settings');
    } finally {
      setSaving(false);
    }
  };

  const handleSyncNow = async () => {
    try {
      setSyncing(true);
      const res = await authFetch('/api/automation/sync-now', { method: 'POST' });
      const data = (await res.json()) as { success: boolean; message?: string; error?: string };
      if (data.success) {
        alert(data.message || 'Sync completed');
        onUpdate();
      } else {
        alert(data.error || 'Manual sync failed');
      }
    } catch {
      alert('Error triggering manual sync');
    } finally {
      setSyncing(false);
    }
  };

  return (
    <form onSubmit={handleSave} className="bg-zinc-900/60 border border-zinc-800 rounded-3xl p-6 sm:p-8 space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-6 border-b border-zinc-800">
        <div>
          <h3 className="text-xl font-bold text-white tracking-tight">Automation Engine</h3>
          <p className="text-xs text-zinc-400 mt-1">
            <p className="text-xs text-zinc-400">
          Configure Cloudflare Cron polling schedule, active monitored public profile, and YouTube Shorts upload limits in Cloudflare D1.
        </p>
          </p>
        </div>

        {/* Master Enable/Disable Toggle */}
        <div className="flex items-center gap-3">
          <span className="text-xs font-semibold text-zinc-300">
            {isEnabled ? 'Engine Running' : 'Engine Paused'}
          </span>
          <button
            type="button"
            onClick={() => setIsEnabled(!isEnabled)}
            className={`w-14 h-8 rounded-full transition-colors relative p-1 ${
              isEnabled ? 'bg-rose-600' : 'bg-zinc-800'
            }`}
          >
            <div
              className={`w-6 h-6 rounded-full bg-white transition-transform ${
                isEnabled ? 'translate-x-6' : 'translate-x-0'
              }`}
            />
          </button>
        </div>
      </div>

      {/* Overlapping Protection & Status Bar */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 p-4 bg-zinc-950/70 rounded-2xl border border-zinc-800/80 text-xs">
        <div className="flex items-center gap-2.5">
          <ShieldCheck className="w-4 h-4 text-emerald-400 shrink-0" />
          <div>
            <span className="text-zinc-400 block text-[10px] uppercase font-semibold">Concurrency Lock</span>
            <span className="text-zinc-200 font-bold">
              {automation.is_running ? 'Running (Locked)' : 'Idle (Protected)'}
            </span>
          </div>
        </div>

        <div className="flex items-center gap-2.5">
          <Clock className="w-4 h-4 text-purple-400 shrink-0" />
          <div>
            <span className="text-zinc-400 block text-[10px] uppercase font-semibold">Last Polled</span>
            <span className="text-zinc-200 font-bold">
              {formatRelativeTime(automation.last_successful_check)}
            </span>
          </div>
        </div>

        <div className="flex items-center justify-start sm:justify-end">
          <button
            type="button"
            onClick={handleSyncNow}
            disabled={syncing || automation.is_running}
            className="px-3.5 py-1.5 bg-rose-600/20 hover:bg-rose-600/30 text-rose-300 border border-rose-500/30 rounded-xl text-xs font-semibold flex items-center gap-1.5 transition-colors disabled:opacity-50"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${syncing ? 'animate-spin' : ''}`} />
            <span>{syncing ? 'Executing...' : 'Trigger Sync Now'}</span>
          </button>
        </div>
      </div>

      {/* Main Settings Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* 1. Active Instagram Source Selection */}
        <div className="space-y-2">
          <label className="text-xs font-bold uppercase tracking-wider text-zinc-300 flex items-center gap-1.5">
            <Instagram className="w-3.5 h-3.5 text-rose-400" />
            <span>Active Monitored Profile (for Poller / Cron)</span>
          </label>
          <select
            value={activeAccountId}
            onChange={(e) => setActiveAccountId(e.target.value)}
            className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-4 py-3 text-xs text-white focus:outline-none focus:border-rose-500"
          >
            <option value="">-- Select Monitored Profile --</option>
            {accounts.map((acc) => (
              <option key={acc.id} value={acc.id}>
                @{acc.username} ({acc.status}) {acc.id === automation.active_account_id ? '★ Current' : ''}
              </option>
            ))}
          </select>
          <span className="text-[11px] text-zinc-400 block">
            The active profile is stored in the database. When changed, scheduled jobs target the new profile on next run.
          </span>
        </div>

        {/* 2. Polling Interval */}
        <div className="space-y-2">
          <label className="text-xs font-bold uppercase tracking-wider text-zinc-300 flex items-center gap-1.5">
            <Clock className="w-3.5 h-3.5 text-purple-400" />
            <span>Polling Interval</span>
          </label>
          <select
            value={interval}
            onChange={(e) => setInterval(Number(e.target.value))}
            className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-4 py-3 text-xs text-white focus:outline-none focus:border-rose-500"
          >
            {POLLING_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
          <span className="text-[11px] text-zinc-400 block">
            <span className="text-[11px] text-zinc-400 block">
            Polling interval stored in Cloudflare D1 (Cloudflare Worker Cron triggers every 30 mins).
          </span>
          </span>
        </div>

        {/* 3. Max Uploads Per Day */}
        <div className="space-y-2">
          <label className="text-xs font-bold uppercase tracking-wider text-zinc-300 flex items-center gap-1.5">
            <Sliders className="w-3.5 h-3.5 text-blue-400" />
            <span>Max Uploads Per Day Cap</span>
          </label>
          <input
            type="number"
            min={1}
            max={50}
            value={maxUploads}
            onChange={(e) => setMaxUploads(Number(e.target.value))}
            className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-4 py-3 text-xs text-white focus:outline-none focus:border-rose-500"
          />
          <span className="text-[11px] text-zinc-400 block">
            Protects against exhausting YouTube Data API v3 daily upload quota.
          </span>
        </div>

        {/* 4. Default Publishing Visibility */}
        <div className="space-y-2">
          <label className="text-xs font-bold uppercase tracking-wider text-zinc-300 flex items-center gap-1.5">
            <Eye className="w-3.5 h-3.5 text-amber-400" />
            <span>Default YouTube Visibility</span>
          </label>
          <select
            value={visibility}
            onChange={(e) => setVisibility(e.target.value as PublishingVisibility)}
            className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-4 py-3 text-xs text-white focus:outline-none focus:border-rose-500"
          >
            <option value="public">Public (Immediate Live Shorts)</option>
            <option value="unlisted">Unlisted (Review before public)</option>
            <option value="private">Private (Restricted)</option>
          </select>
          <span className="text-[11px] text-zinc-400 block">
            Privacy state assigned to new YouTube Shorts when uploaded.
          </span>
        </div>

        {/* 5. Google Drive Target Folder */}
        <div className="space-y-2 md:col-span-2">
          <label className="text-xs font-bold uppercase tracking-wider text-zinc-300 flex items-center gap-1.5">
            <Folder className="w-3.5 h-3.5 text-cyan-400" />
            <span>Google Drive Storage Folder</span>
          </label>
          <input
            type="text"
            value={folderName}
            onChange={(e) => setFolderName(e.target.value)}
            className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-4 py-3 text-xs text-white focus:outline-none focus:border-rose-500"
          />
          <span className="text-[11px] text-zinc-400 block">
            Folder in Google Drive where original Instagram Reel video files (.mp4) are archived.
          </span>
        </div>
      </div>

      {/* Save Button */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pt-4 border-t border-zinc-800">
        <span className="text-xs text-zinc-400">
          Changes persist to Cloudflare D1 immediately for upcoming Cron runs and manual syncs.
        </span>
        <button
          type="submit"
          disabled={saving}
          className="px-6 py-2.5 rounded-xl text-xs font-bold bg-rose-600 hover:bg-rose-500 text-white flex items-center gap-2 transition-all shadow-md shadow-rose-600/30 disabled:opacity-50"
        >
          {saveSuccess ? (
            <>
              <Check className="w-4 h-4 text-white" />
              <span>Saved!</span>
            </>
          ) : (
            <span>{saving ? 'Saving...' : 'Save Configuration'}</span>
          )}
        </button>
      </div>
    </form>
  );
}
