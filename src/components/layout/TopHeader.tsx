'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import {
  RefreshCw,
  CheckCircle2,
  AlertCircle,
  RotateCcw,
  Sparkles,
} from 'lucide-react';
import { Instagram } from '@/components/ui/Icons';
import { authFetch } from '@/lib/clientAuthFetch';
import { InstagramAccount, AutomationSettings } from '@/types';

interface TopHeaderProps {
  activeAccount: InstagramAccount | null;
  automation: AutomationSettings | null;
  onRefresh?: () => void;
}

export function TopHeader({ activeAccount, automation, onRefresh }: TopHeaderProps) {
  const [isSyncing, setIsSyncing] = useState(false);
  const [syncMessage, setSyncMessage] = useState<string | null>(null);

  const handleManualSync = async () => {
    try {
      setIsSyncing(true);
      setSyncMessage(null);
      const res = await authFetch('/api/automation/sync-now', { method: 'POST' });
      const data = (await res.json()) as { success: boolean; error?: string };
      if (data.success) {
        setSyncMessage('Sync finished!');
        setTimeout(() => setSyncMessage(null), 3000);
        if (onRefresh) onRefresh();
      } else {
        alert(data.error || 'Failed to trigger sync');
      }
    } catch {
      alert('Network error while triggering sync');
    } finally {
      setIsSyncing(false);
    }
  };

  const handleResetDemo = async () => {
    if (confirm('Reset all demo accounts, uploads, and logs back to the initial sample data?')) {
      const res = await authFetch('/api/demo/reset', { method: 'POST' });
      if (!res.ok) {
        const data = (await res.json()) as { error?: string };
        alert(data.error || 'Demo reset is unavailable.');
        return;
      }
      if (onRefresh) onRefresh();
      window.location.reload();
    }
  };

  return (
    <header className="border-b border-zinc-800/80 bg-zinc-950/60 backdrop-blur-md px-4 sm:px-8 py-3.5 flex flex-wrap items-center justify-between gap-3">
      {/* Active Source Account Pill */}
      <div className="flex items-center gap-3">
        {activeAccount ? (
          <Link
            href="/accounts"
            className="flex items-center gap-2.5 px-3 py-1.5 rounded-full bg-zinc-900/90 border border-zinc-800 hover:border-zinc-700 transition-colors group"
          >
            <div className="relative">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={activeAccount.profile_picture_url}
                alt={activeAccount.username}
                className="w-6 h-6 rounded-full object-cover ring-1 ring-rose-500/50"
              />
              <span className="absolute -bottom-0.5 -right-0.5 w-2 h-2 rounded-full bg-emerald-500 ring-2 ring-zinc-950" />
            </div>
            <div className="flex items-center gap-1.5 text-xs">
              <span className="text-zinc-400">Active Source:</span>
              <span className="font-semibold text-zinc-200 group-hover:text-rose-400 transition-colors">
                @{activeAccount.username}
              </span>
            </div>
          </Link>
        ) : (
          <Link
            href="/accounts"
            className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-amber-500/10 border border-amber-500/20 text-xs text-amber-400"
          >
            <AlertCircle className="w-3.5 h-3.5" />
            <span>No Active Source Selected</span>
          </Link>
        )}

        {/* Automation Status Badge */}
        {automation && (
          <div className="hidden sm:flex items-center gap-1.5 text-xs text-zinc-400 bg-zinc-900/60 px-2.5 py-1 rounded-full border border-zinc-800">
            <span
              className={`w-2 h-2 rounded-full ${
                automation.is_enabled ? 'bg-emerald-400 animate-pulse' : 'bg-zinc-500'
              }`}
            />
            <span>{automation.is_enabled ? 'Auto-Poller Active' : 'Automation Paused'}</span>
          </div>
        )}
      </div>

      {/* Action Buttons */}
      <div className="flex items-center gap-2">
        {/* Reset Demo Button */}
        <button
          onClick={handleResetDemo}
          title="Reset demo data"
          className="hidden lg:flex items-center gap-1.5 px-2.5 py-1.5 text-xs text-zinc-400 hover:text-zinc-200 bg-zinc-900/80 hover:bg-zinc-800 rounded-lg border border-zinc-800 transition-colors"
        >
          <RotateCcw className="w-3.5 h-3.5" />
          <span>Reset Demo</span>
        </button>

        {/* Manual Sync Now Button */}
        <button
          onClick={handleManualSync}
          disabled={isSyncing}
          className="flex items-center gap-2 px-3.5 py-1.5 rounded-lg text-xs font-semibold bg-rose-600 hover:bg-rose-500 text-white transition-all shadow-sm shadow-rose-600/30 disabled:opacity-50"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${isSyncing ? 'animate-spin' : ''}`} />
          <span>{isSyncing ? 'Syncing...' : syncMessage || 'Sync Now'}</span>
        </button>
      </div>
    </header>
  );
}
