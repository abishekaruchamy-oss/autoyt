'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import {
  Play,
  Pause,
  RefreshCw,
  Clock,
  ShieldCheck,
  Cpu,
  ChevronRight,
} from 'lucide-react';
import { AutomationSettings } from '@/types';
import { authFetch } from '@/lib/clientAuthFetch';
import { formatRelativeTime } from '@/lib/utils';

interface QuickControlsProps {
  automation: AutomationSettings;
  onUpdate: () => void;
}

export function QuickControls({ automation, onUpdate }: QuickControlsProps) {
  const [toggling, setToggling] = useState(false);
  const [syncing, setSyncing] = useState(false);

  const handleToggle = async () => {
    try {
      setToggling(true);
      const res = await authFetch('/api/automation', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ is_enabled: !automation.is_enabled }),
      });
      const data = (await res.json()) as { success: boolean; error?: string };
      if (data.success) {
        onUpdate();
      }
    } catch {
      alert('Failed to update automation state');
    } finally {
      setToggling(false);
    }
  };

  const handleSyncNow = async () => {
    try {
      setSyncing(true);
      const res = await authFetch('/api/automation/sync-now', { method: 'POST' });
      const data = (await res.json()) as { success: boolean; error?: string };
      if (data.success) {
        onUpdate();
      } else {
        alert(data.error || 'Sync failed');
      }
    } catch {
      alert('Error triggering sync');
    } finally {
      setSyncing(false);
    }
  };

  return (
    <div className="bg-zinc-900/60 border border-zinc-800 rounded-2xl p-6">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-lg bg-rose-500/10 text-rose-400 flex items-center justify-center">
            <Cpu className="w-4 h-4" />
          </div>
          <h3 className="text-base font-bold text-white">Automation Controls</h3>
        </div>
        <Link
          href="/automation"
          className="text-xs text-zinc-400 hover:text-white flex items-center gap-1 font-medium"
        >
          Detailed Config <ChevronRight className="w-3.5 h-3.5" />
        </Link>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Toggle Automation */}
        <div className="bg-zinc-950/60 border border-zinc-800/80 rounded-xl p-3.5 flex items-center justify-between">
          <div>
            <span className="text-[11px] font-semibold text-zinc-400 uppercase tracking-wider block">
              Auto Poller
            </span>
            <span className="text-sm font-bold text-zinc-200">
              {automation.is_enabled ? 'Active' : 'Paused'}
            </span>
          </div>
          <button
            onClick={handleToggle}
            disabled={toggling}
            className={`p-2 rounded-lg font-medium text-xs flex items-center gap-1.5 transition-all ${
              automation.is_enabled
                ? 'bg-amber-500/10 text-amber-400 hover:bg-amber-500/20 border border-amber-500/20'
                : 'bg-emerald-500/10 text-emerald-400 hover:bg-emerald-500/20 border border-emerald-500/20'
            }`}
          >
            {automation.is_enabled ? (
              <>
                <Pause className="w-4 h-4" />
                <span>Pause</span>
              </>
            ) : (
              <>
                <Play className="w-4 h-4" />
                <span>Resume</span>
              </>
            )}
          </button>
        </div>

        {/* Polling Interval */}
        <div className="bg-zinc-950/60 border border-zinc-800/80 rounded-xl p-3.5">
          <span className="text-[11px] font-semibold text-zinc-400 uppercase tracking-wider block">
            Polling Frequency
          </span>
          <div className="flex items-center gap-2 mt-1">
            <Clock className="w-4 h-4 text-purple-400" />
            <span className="text-sm font-bold text-zinc-200">
              Every {automation.polling_interval_minutes} mins
            </span>
          </div>
        </div>

        {/* Overlap Execution Guard */}
        <div className="bg-zinc-950/60 border border-zinc-800/80 rounded-xl p-3.5">
          <span className="text-[11px] font-semibold text-zinc-400 uppercase tracking-wider block">
            Overlap Protection
          </span>
          <div className="flex items-center gap-2 mt-1">
            <ShieldCheck className="w-4 h-4 text-emerald-400" />
            <span className="text-sm font-bold text-emerald-400">
              {automation.is_running ? 'Executing Job...' : 'Protected (Mutex)'}
            </span>
          </div>
        </div>

        {/* Manual Sync Trigger */}
        <div className="bg-zinc-950/60 border border-zinc-800/80 rounded-xl p-3.5 flex items-center justify-between">
          <div>
            <span className="text-[11px] font-semibold text-zinc-400 uppercase tracking-wider block">
              Last Polled
            </span>
            <span className="text-xs text-zinc-300 font-medium">
              {formatRelativeTime(automation.last_successful_check)}
            </span>
          </div>
          <button
            onClick={handleSyncNow}
            disabled={syncing || automation.is_running}
            className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-rose-600 hover:bg-rose-500 text-white flex items-center gap-1.5 transition-all shadow-sm disabled:opacity-50"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${syncing ? 'animate-spin' : ''}`} />
            <span>{syncing ? 'Syncing...' : 'Sync Now'}</span>
          </button>
        </div>
      </div>
    </div>
  );
}
