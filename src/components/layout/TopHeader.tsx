'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import {
  RefreshCw,
  AlertCircle,
  RotateCcw,
} from 'lucide-react';
import { InstagramAccount, AutomationSettings, ExecutionReadiness } from '@/types';
import { fetchJsonWithTimeout } from '@/lib/apiClient';

interface TopHeaderProps {
  activeAccount: InstagramAccount | null;
  automation: AutomationSettings | null;
  readiness?: ExecutionReadiness;
  isProduction?: boolean;
  onRefresh?: () => void;
  onNotice?: (notice: { type: 'success' | 'error' | 'warning'; message: string }) => void;
}

export function TopHeader({
  activeAccount,
  automation,
  readiness,
  isProduction = false,
  onRefresh,
  onNotice,
}: TopHeaderProps) {
  const [isSyncing, setIsSyncing] = useState(false);
  const [isResetting, setIsResetting] = useState(false);
  const [syncMessage, setSyncMessage] = useState<string | null>(null);

  const handleManualSync = async () => {
    if (readiness && !readiness.ready_for_live_upload) {
      const reason = readiness.blocking_reasons.join(' ');
      onNotice?.({
        type: 'warning',
        message: `Live sync blocked until readiness checks pass: ${reason}`,
      });
      return;
    }

    try {
      setIsSyncing(true);
      setSyncMessage(null);
      const res = await fetchJsonWithTimeout<{ success: boolean; message?: string; error?: string }>(
        '/api/automation/sync-now',
        { method: 'POST' },
        20000
      );
      if (res.ok && res.data?.success) {
        setSyncMessage('Sync finished!');
        onNotice?.({
          type: 'success',
          message: res.data.message || 'Automation sync completed.',
        });
        setTimeout(() => setSyncMessage(null), 3000);
        if (onRefresh) onRefresh();
      } else {
        onNotice?.({
          type: 'error',
          message: res.error || res.data?.error || 'Failed to trigger sync.',
        });
      }
    } finally {
      setIsSyncing(false);
    }
  };

  const handleResetDemo = async () => {
    if (isProduction) return;
    if (
      confirm(
        'Reset local non-production development data? This restores sample profiles, jobs, and logs in local memory only and is disabled in production D1.'
      )
    ) {
      try {
        setIsResetting(true);
        const res = await fetchJsonWithTimeout<{ success?: boolean; error?: string }>(
          '/api/demo/reset',
          { method: 'POST' }
        );
        if (!res.ok) {
          onNotice?.({
            type: 'error',
            message: res.error || 'Demo reset is disabled in production.',
          });
          return;
        }
        if (onRefresh) onRefresh();
      } finally {
        setIsResetting(false);
      }
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
        {/* Reset Demo Button (non-production local development only) */}
        {!isProduction && (
          <button
            type="button"
            onClick={handleResetDemo}
            disabled={isResetting}
            title="Reset local non-production development data (disabled in production D1)"
            className="hidden lg:flex items-center gap-1.5 px-2.5 py-1.5 text-xs text-zinc-400 hover:text-zinc-200 bg-zinc-900/80 hover:bg-zinc-800 rounded-lg border border-zinc-800 transition-colors disabled:opacity-50"
          >
            <RotateCcw className={`w-3.5 h-3.5 ${isResetting ? 'animate-spin' : ''}`} />
            <span>{isResetting ? 'Resetting...' : 'Reset Demo'}</span>
          </button>
        )}

        {/* Manual Sync Now Button */}
        <button
          type="button"
          onClick={handleManualSync}
          disabled={isSyncing || (readiness ? !readiness.ready_for_live_upload : false)}
          title={
            readiness && !readiness.ready_for_live_upload
              ? readiness.blocking_reasons.join(' ')
              : 'Trigger manual sync check'
          }
          className="flex items-center gap-2 px-3.5 py-1.5 rounded-lg text-xs font-semibold bg-rose-600 hover:bg-rose-500 text-white transition-all shadow-sm shadow-rose-600/30 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${isSyncing ? 'animate-spin' : ''}`} />
          <span>{isSyncing ? 'Syncing...' : syncMessage || 'Sync Now'}</span>
        </button>
      </div>
    </header>
  );
}
