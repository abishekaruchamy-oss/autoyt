'use client';

import React, { useState } from 'react';
import {
  Check,
  Shield,
  RotateCcw,
  PowerOff,
  Trash2,
  Calendar,
  Layers,
  ArrowRightLeft,
  AlertCircle,
} from 'lucide-react';
import { Instagram } from '@/components/ui/Icons';
import { InstagramAccount } from '@/types';
import {
  getTokenExpiryInfo,
  formatRelativeTime,
  getAccountStatusBadge,
} from '@/lib/utils';

interface AccountCardProps {
  account: InstagramAccount;
  onActivate: (id: string) => Promise<void>;
  onReconnect: (account: InstagramAccount) => void;
  onDisconnect: (id: string) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
}

export function AccountCard({
  account,
  onActivate,
  onReconnect,
  onDisconnect,
  onDelete,
}: AccountCardProps) {
  const [loading, setLoading] = useState(false);
  const expiry = getTokenExpiryInfo(account.token_expires_at);
  const statusBadge = getAccountStatusBadge(account.status);

  const handleActivate = async () => {
    try {
      setLoading(true);
      await onActivate(account.id);
    } finally {
      setLoading(false);
    }
  };

  const handleDisconnect = async () => {
    if (confirm(`Disconnect @${account.username}? Automation will no longer process this account.`)) {
      try {
        setLoading(true);
        await onDisconnect(account.id);
      } finally {
        setLoading(false);
      }
    }
  };

  const handleDelete = async () => {
    if (confirm(`Permanently remove @${account.username} and its reel records from dashboard?`)) {
      try {
        setLoading(true);
        await onDelete(account.id);
      } finally {
        setLoading(false);
      }
    }
  };

  return (
    <div
      className={`relative rounded-2xl border transition-all duration-300 p-5 flex flex-col justify-between ${
        account.is_active
          ? 'bg-zinc-900/90 border-rose-500/50 shadow-lg shadow-rose-500/10'
          : 'bg-zinc-900/50 border-zinc-800 hover:border-zinc-700'
      }`}
    >
      {/* Top Header */}
      <div>
        <div className="flex items-start justify-between gap-3 mb-4">
          <div className="flex items-center gap-3.5">
            <div className="relative">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={account.profile_picture_url}
                alt={account.username}
                className={`w-14 h-14 rounded-2xl object-cover ring-2 ${
                  account.is_active ? 'ring-rose-500' : 'ring-zinc-700'
                }`}
              />
              <div className="absolute -bottom-1 -right-1 bg-gradient-to-tr from-amber-500 to-rose-500 p-1 rounded-md text-white">
                <Instagram className="w-3 h-3" />
              </div>
            </div>

            <div>
              <div className="flex items-center gap-2">
                <h4 className="text-base font-bold text-white tracking-tight">
                  @{account.username}
                </h4>
              </div>
              <p className="text-xs text-zinc-400">{account.name}</p>
              <div className="flex items-center gap-2 mt-1">
                <span
                  className={`px-2 py-0.5 rounded-full text-[10px] font-semibold border ${statusBadge.bg} ${statusBadge.text} ${statusBadge.border}`}
                >
                  {statusBadge.label}
                </span>
                {account.is_active && (
                  <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-rose-500/15 text-rose-400 border border-rose-500/30 flex items-center gap-1">
                    <span className="w-1.5 h-1.5 rounded-full bg-rose-400 animate-pulse" />
                    Active Source
                  </span>
                )}
              </div>
            </div>
          </div>

          {/* Delete Button */}
          <button
            onClick={handleDelete}
            title="Delete Account"
            className="p-1.5 text-zinc-400 hover:text-rose-400 hover:bg-zinc-800/80 rounded-lg transition-colors"
          >
            <Trash2 className="w-4 h-4" />
          </button>
        </div>

        {/* Stats Grid */}
        <div className="grid grid-cols-2 gap-2 my-4 p-3 bg-zinc-950/60 rounded-xl border border-zinc-800/70 text-xs">
          <div>
            <span className="text-[10px] uppercase tracking-wider text-zinc-400 block font-medium">
              Followers
            </span>
            <span className="text-sm font-bold text-zinc-200">
              {account.followers_count.toLocaleString()}
            </span>
          </div>
          <div>
            <span className="text-[10px] uppercase tracking-wider text-zinc-400 block font-medium">
              Media Count
            </span>
            <span className="text-sm font-bold text-zinc-200">{account.media_count}</span>
          </div>
        </div>

        {/* Token Expiration Status */}
        <div
          className={`p-2.5 rounded-xl border text-xs mb-4 flex items-center justify-between ${
            expiry.isExpired
              ? 'bg-rose-500/10 border-rose-500/30 text-rose-300'
              : expiry.isExpiringSoon
              ? 'bg-amber-500/10 border-amber-500/30 text-amber-300'
              : 'bg-zinc-950/40 border-zinc-800 text-zinc-400'
          }`}
        >
          <div className="flex items-center gap-2">
            <Shield className="w-3.5 h-3.5 shrink-0" />
            <span>OAuth Token: {expiry.formatted}</span>
          </div>
          {(expiry.isExpired || expiry.isExpiringSoon) && (
            <button
              onClick={() => onReconnect(account)}
              className="text-[11px] font-bold underline hover:text-white"
            >
              Reconnect
            </button>
          )}
        </div>
      </div>

      {/* Action Buttons */}
      <div className="space-y-2 pt-2 border-t border-zinc-800/80">
        {account.is_active ? (
          <div className="w-full py-2 bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 rounded-xl text-xs font-semibold flex items-center justify-center gap-1.5">
            <Check className="w-4 h-4" />
            <span>Currently Active Source</span>
          </div>
        ) : (
          <button
            onClick={handleActivate}
            disabled={loading || account.status !== 'ACTIVE'}
            className="w-full py-2 bg-zinc-800 hover:bg-rose-600 text-white rounded-xl text-xs font-semibold transition-all flex items-center justify-center gap-2 shadow-sm disabled:opacity-50"
          >
            <ArrowRightLeft className="w-3.5 h-3.5" />
            <span>Set as Active Source</span>
          </button>
        )}

        <div className="flex gap-2">
          <button
            onClick={() => onReconnect(account)}
            className="flex-1 py-1.5 px-3 bg-zinc-800/60 hover:bg-zinc-800 text-zinc-300 rounded-lg text-xs font-medium border border-zinc-700/60 transition-colors flex items-center justify-center gap-1.5"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            <span>Reconnect</span>
          </button>

          {account.status !== 'DISCONNECTED' && (
            <button
              onClick={handleDisconnect}
              className="py-1.5 px-3 bg-zinc-800/60 hover:bg-zinc-800 text-zinc-400 hover:text-amber-400 rounded-lg text-xs font-medium border border-zinc-700/60 transition-colors flex items-center justify-center gap-1"
            >
              <PowerOff className="w-3.5 h-3.5" />
              <span>Disconnect</span>
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
