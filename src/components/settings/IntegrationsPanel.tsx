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
} from 'lucide-react';
import { Instagram } from '@/components/ui/Icons';
import { IntegrationStatus, AutomationSettings } from '@/types';

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

  const handleResetDemo = async () => {
    if (confirm('Reset all demo state to original sample records?')) {
      await fetch('/api/demo/reset', { method: 'POST' });
      window.location.reload();
    }
  };

  return (
    <div className="space-y-6">
      <form onSubmit={handleSave} className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* 1. Google Drive Connection Status */}
        <div className="bg-zinc-900/60 border border-zinc-800 rounded-3xl p-6 flex flex-col justify-between space-y-4">
          <div>
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-2xl bg-cyan-500/10 text-cyan-400 flex items-center justify-center">
                  <HardDrive className="w-5 h-5" />
                </div>
                <div>
                  <h4 className="text-base font-bold text-white">Google Drive Storage</h4>
                  <span className="text-xs text-zinc-400">Google One Storage</span>
                </div>
              </div>
              <span className="px-2.5 py-1 rounded-full text-[10px] font-bold bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 flex items-center gap-1">
                <CheckCircle2 className="w-3 h-3" /> Connected
              </span>
            </div>

            <p className="text-xs text-zinc-400 leading-relaxed mb-4">
              Downloaded Reels are saved as MP4 files to your Google Drive before uploading to YouTube Shorts.
            </p>

            <div className="space-y-3 bg-zinc-950/60 p-4 rounded-2xl border border-zinc-800/80 text-xs">
              <div className="flex justify-between">
                <span className="text-zinc-400">Connected Account:</span>
                <span className="text-zinc-200 font-semibold">{integrations.google_drive.email}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-zinc-400">Quota Usage:</span>
                <span className="text-zinc-200 font-semibold">
                  {integrations.google_drive.quota_used_gb} GB / {integrations.google_drive.quota_total_gb} GB
                </span>
              </div>
              <div>
                <label className="text-zinc-400 block mb-1.5 font-medium">Backup Folder Name:</label>
                <input
                  type="text"
                  value={driveFolder}
                  onChange={(e) => setDriveFolder(e.target.value)}
                  className="w-full bg-zinc-900 border border-zinc-800 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-rose-500"
                />
              </div>
            </div>
          </div>
        </div>

        {/* 2. YouTube Channel Connection Status */}
        <div className="bg-zinc-900/60 border border-zinc-800 rounded-3xl p-6 flex flex-col justify-between space-y-4">
          <div>
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-2xl bg-red-500/10 text-red-400 flex items-center justify-center">
                  <UploadCloud className="w-5 h-5" />
                </div>
                <div>
                  <h4 className="text-base font-bold text-white">YouTube Channel</h4>
                  <span className="text-xs text-zinc-400">Shorts Destination</span>
                </div>
              </div>
              <span className="px-2.5 py-1 rounded-full text-[10px] font-bold bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 flex items-center gap-1">
                <CheckCircle2 className="w-3 h-3" /> Connected
              </span>
            </div>

            <p className="text-xs text-zinc-400 leading-relaxed mb-4">
              Automated publishing engine uploads Reels to YouTube Shorts using YouTube Data API v3.
            </p>

            <div className="space-y-3 bg-zinc-950/60 p-4 rounded-2xl border border-zinc-800/80 text-xs">
              <div className="flex justify-between">
                <span className="text-zinc-400">Target Channel:</span>
                <span className="text-zinc-200 font-semibold">{integrations.youtube.channel_title}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-zinc-400">Channel ID:</span>
                <span className="font-mono text-zinc-400 text-[11px]">{integrations.youtube.channel_id}</span>
              </div>
              <div>
                <label className="text-zinc-400 block mb-1.5 font-medium">Default Upload Visibility:</label>
                <select
                  value={youtubeVisibility}
                  onChange={(e) => setYoutubeVisibility(e.target.value as any)}
                  className="w-full bg-zinc-900 border border-zinc-800 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-rose-500"
                >
                  <option value="public">Public (Immediate Live Shorts)</option>
                  <option value="unlisted">Unlisted (Review First)</option>
                  <option value="private">Private</option>
                </select>
              </div>
            </div>
          </div>
        </div>

        {/* 3. Instagram Account Connections Summary */}
        <div className="bg-zinc-900/60 border border-zinc-800 rounded-3xl p-6 flex flex-col justify-between space-y-4">
          <div>
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-2xl bg-pink-500/10 text-pink-400 flex items-center justify-center">
                  <Instagram className="w-5 h-5" />
                </div>
                <div>
                  <h4 className="text-base font-bold text-white">Instagram Meta OAuth</h4>
                  <span className="text-xs text-zinc-400">Graph API v19.0</span>
                </div>
              </div>
              <span className="px-2.5 py-1 rounded-full text-[10px] font-bold bg-purple-500/10 text-purple-400 border border-purple-500/20">
                {accountsCount} Accounts
              </span>
            </div>

            <p className="text-xs text-zinc-400 leading-relaxed mb-4">
              All connected Creator accounts are secured with AES-256-GCM token encryption. No passwords stored.
            </p>

            <div className="space-y-2.5 bg-zinc-950/60 p-4 rounded-2xl border border-zinc-800/80 text-xs">
              <div className="flex justify-between">
                <span className="text-zinc-400">Meta App ID:</span>
                <span className="font-mono text-zinc-300">{integrations.meta.app_id}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-zinc-400">App Secret Status:</span>
                <span className="text-emerald-400 font-semibold">Configured</span>
              </div>
              <div className="flex justify-between">
                <span className="text-zinc-400">Encryption:</span>
                <span className="text-emerald-400 font-semibold">AES-256-GCM Active</span>
              </div>
            </div>
          </div>
        </div>

        {/* 4. n8n Automation Engine Status */}
        <div className="bg-zinc-900/60 border border-zinc-800 rounded-3xl p-6 flex flex-col justify-between space-y-4">
          <div>
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-2xl bg-purple-500/10 text-purple-400 flex items-center justify-center">
                  <Cpu className="w-5 h-5" />
                </div>
                <div>
                  <h4 className="text-base font-bold text-white">n8n Automation Node</h4>
                  <span className="text-xs text-zinc-400">Orchestrator</span>
                </div>
              </div>
              <span className="px-2.5 py-1 rounded-full text-[10px] font-bold bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 flex items-center gap-1">
                <CheckCircle2 className="w-3 h-3" /> Ready
              </span>
            </div>

            <p className="text-xs text-zinc-400 leading-relaxed mb-4">
              n8n workflow coordinates polling, downloading, Drive backup, and Shorts publication.
            </p>

            <div className="space-y-2.5 bg-zinc-950/60 p-4 rounded-2xl border border-zinc-800/80 text-xs">
              <div>
                <span className="text-zinc-400 block mb-1">Webhook URL:</span>
                <span className="font-mono text-[11px] text-zinc-300 block truncate bg-zinc-900 p-2 rounded-lg border border-zinc-800">
                  {integrations.n8n.webhook_url}
                </span>
              </div>
            </div>
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
            <span>Reset Demo Data to Initial State</span>
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
