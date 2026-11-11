'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import {
  ArrowRightLeft,
  Check,
  Clock,
  Sparkles,
  ExternalLink,
  ShieldCheck,
  RotateCcw,
} from 'lucide-react';
import { Instagram } from '@/components/ui/Icons';
import { authFetch } from '@/lib/clientAuthFetch';
import { InstagramAccount } from '@/types';
import { formatRelativeTime } from '@/lib/utils';

interface ActiveSourceCardProps {
  activeAccount: InstagramAccount | null;
  allAccounts: InstagramAccount[];
  onAccountSwitched: () => void;
}

export function ActiveSourceCard({
  activeAccount,
  allAccounts,
  onAccountSwitched,
}: ActiveSourceCardProps) {
  const [switching, setSwitching] = useState(false);
  const [showSwitchMenu, setShowSwitchMenu] = useState(false);

  const handleSwitch = async (id: string) => {
    try {
      setSwitching(true);
      setShowSwitchMenu(false);
      const res = await authFetch(`/api/accounts/${id}/activate`, { method: 'POST' });
      const data = (await res.json()) as { success: boolean; error?: string };
      if (data.success) {
        onAccountSwitched();
      } else {
        alert(data.error || 'Failed to switch active profile');
      }
    } catch {
      alert('Error switching active profile');
    } finally {
      setSwitching(false);
    }
  };

  if (!activeAccount) {
    return (
      <div className="bg-gradient-to-br from-zinc-900 to-zinc-950 border border-amber-500/30 rounded-2xl p-6 text-center">
        <Instagram className="w-10 h-10 text-amber-400 mx-auto mb-3" />
        <h3 className="text-lg font-bold text-white mb-1">No Active Profile Selected</h3>
        <p className="text-sm text-zinc-400 max-w-md mx-auto mb-4">
          Add public Instagram profile URLs or activate a monitored profile to start automated YouTube Shorts processing.
        </p>
        <Link
          href="/accounts"
          className="inline-flex items-center gap-2 px-4 py-2 bg-rose-600 hover:bg-rose-500 text-white rounded-xl text-sm font-semibold transition-all shadow-md shadow-rose-600/30"
        >
          <Instagram className="w-4 h-4" />
          <span>Manage Monitored Profiles</span>
        </Link>
      </div>
    );
  }

  const profileUrl = `https://www.instagram.com/${activeAccount.username}/`;

  return (
    <div className="relative overflow-hidden bg-gradient-to-br from-zinc-900 via-zinc-900/90 to-zinc-950 border border-zinc-800 rounded-3xl p-6 shadow-xl">
      <div className="absolute top-0 right-0 -mt-8 -mr-8 w-48 h-48 bg-gradient-to-bl from-rose-500/10 via-purple-500/10 to-transparent rounded-full blur-2xl pointer-events-none" />

      <div className="relative flex flex-col md:flex-row md:items-center justify-between gap-6">
        {/* Profile Info */}
        <div className="flex items-start sm:items-center gap-4">
          <div className="relative">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={activeAccount.profile_picture_url}
              alt={activeAccount.username}
              className="w-16 h-16 sm:w-20 sm:h-20 rounded-2xl object-cover ring-2 ring-rose-500 shadow-md"
            />
            <div className="absolute -bottom-1 -right-1 bg-gradient-to-tr from-amber-500 to-rose-500 p-1 rounded-lg text-white shadow">
              <Instagram className="w-3.5 h-3.5" />
            </div>
          </div>

          <div>
            <div className="flex flex-wrap items-center gap-2 mb-1">
              <h3 className="text-xl sm:text-2xl font-bold text-white tracking-tight">
                @{activeAccount.username}
              </h3>
              <span className="px-2.5 py-0.5 rounded-full text-xs font-semibold bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 flex items-center gap-1">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                Active Source
              </span>
            </div>

            <div className="flex items-center gap-2 text-xs text-zinc-400 mb-2">
              <span className="font-mono text-zinc-300">{profileUrl}</span>
              <a
                href={profileUrl}
                target="_blank"
                rel="noreferrer"
                className="text-pink-400 hover:text-pink-300 inline-flex items-center gap-0.5"
              >
                <ExternalLink className="w-3 h-3" />
              </a>
            </div>

            <div className="flex flex-wrap items-center gap-4 text-xs text-zinc-400">
              <div className="flex items-center gap-1 text-zinc-400">
                <Clock className="w-3 h-3 text-zinc-500" />
                <span>Last Polled: {formatRelativeTime(activeAccount.last_synced_at)}</span>
              </div>
              <div className="flex items-center gap-1 text-emerald-400">
                <ShieldCheck className="w-3.5 h-3.5" />
                <span>Zero Login Policy Compliant</span>
              </div>
            </div>
          </div>
        </div>

        {/* Switch Profile Dropdown Button */}
        <div className="relative w-full sm:w-auto">
          <button
            onClick={() => setShowSwitchMenu(!showSwitchMenu)}
            disabled={switching}
            className="w-full sm:w-auto flex items-center justify-center gap-2 px-4 py-2.5 bg-zinc-800 hover:bg-zinc-700 text-zinc-100 rounded-xl text-xs font-semibold border border-zinc-700 transition-colors shadow-sm"
          >
            <ArrowRightLeft className={`w-3.5 h-3.5 ${switching ? 'animate-spin' : ''}`} />
            <span>{switching ? 'Switching...' : 'Switch Active Profile'}</span>
          </button>

          {/* Dropdown Menu */}
          {showSwitchMenu && (
            <div className="absolute right-0 mt-2 w-72 bg-zinc-950 border border-zinc-800 rounded-2xl shadow-2xl p-2 z-30">
              <div className="px-3 py-2 text-[11px] font-semibold uppercase tracking-wider text-zinc-400 border-b border-zinc-800">
                Select Monitored Profile
              </div>
              <div className="max-h-60 overflow-y-auto space-y-1 py-1">
                {allAccounts.map((acc) => {
                  const isSelected = acc.id === activeAccount.id;
                  return (
                    <button
                      key={acc.id}
                      onClick={() => handleSwitch(acc.id)}
                      disabled={isSelected}
                      className={`w-full flex items-center justify-between p-2 rounded-xl text-left text-xs transition-colors ${
                        isSelected
                          ? 'bg-rose-500/15 text-rose-300'
                          : 'hover:bg-zinc-900 text-zinc-300'
                      }`}
                    >
                      <div className="flex items-center gap-2.5 truncate">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={acc.profile_picture_url}
                          alt={acc.username}
                          className="w-6 h-6 rounded-full object-cover shrink-0"
                        />
                        <span className="font-semibold truncate">@{acc.username}</span>
                      </div>
                      {isSelected && <Check className="w-4 h-4 text-rose-400 shrink-0" />}
                    </button>
                  );
                })}
              </div>
              <div className="p-2 border-t border-zinc-800 text-center">
                <Link
                  href="/accounts"
                  className="text-xs text-rose-400 hover:underline font-medium inline-block"
                >
                  + Add Public Profile URL
                </Link>
              </div>
            </div>
          )}
        </div>
      </div>

      <div className="mt-5 pt-4 border-t border-zinc-800/80 flex items-center justify-between text-[11px] text-zinc-400">
        <span className="flex items-center gap-1.5">
          <Sparkles className="w-3.5 h-3.5 text-rose-400" />
          <span>Active profile queried dynamically by scheduled runner on each cycle.</span>
        </span>
        <span className="hidden sm:inline text-zinc-400">Zero workflow modifications needed</span>
      </div>
    </div>
  );
}
