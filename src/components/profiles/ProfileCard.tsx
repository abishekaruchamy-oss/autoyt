'use client';

import React, { useState } from 'react';
import {
  ExternalLink,
  Check,
  Pause,
  Play,
  RotateCcw,
  Trash2,
  Clock,
  AlertCircle,
  Copy,
  ShieldCheck,
  ArrowRightLeft,
  CheckCircle2,
} from 'lucide-react';
import { Instagram } from '@/components/ui/Icons';
import { MonitoredProfile, ProfileMonitoringStatus } from '@/types';
import { formatRelativeTime } from '@/lib/utils';

interface ProfileCardProps {
  profile: MonitoredProfile;
  onActivate: (id: string) => Promise<void>;
  onTogglePause: (id: string, pause: boolean) => Promise<void>;
  onCheckNow: (id: string) => Promise<void>;
  onRemove: (id: string) => Promise<void>;
}

function getStatusBadge(status: ProfileMonitoringStatus): {
  bg: string;
  text: string;
  border: string;
  label: string;
} {
  switch (status) {
    case 'ACTIVE':
      return {
        bg: 'bg-emerald-500/10',
        text: 'text-emerald-400',
        border: 'border-emerald-500/20',
        label: 'Active & Monitored',
      };
    case 'PAUSED':
      return {
        bg: 'bg-amber-500/10',
        text: 'text-amber-400',
        border: 'border-amber-500/20',
        label: 'Monitoring Paused',
      };
    case 'RESTRICTED':
      return {
        bg: 'bg-purple-500/10',
        text: 'text-purple-400',
        border: 'border-purple-500/20',
        label: 'Platform Gated',
      };
    case 'NOT_FOUND':
      return {
        bg: 'bg-zinc-500/10',
        text: 'text-zinc-400',
        border: 'border-zinc-500/20',
        label: 'Profile Not Found',
      };
    case 'ERROR':
    default:
      return {
        bg: 'bg-rose-500/10',
        text: 'text-rose-400',
        border: 'border-rose-500/20',
        label: 'Check Error',
      };
  }
}

export function ProfileCard({
  profile,
  onActivate,
  onTogglePause,
  onCheckNow,
  onRemove,
}: ProfileCardProps) {
  const [loading, setLoading] = useState(false);
  const [checking, setChecking] = useState(false);
  const [copied, setCopied] = useState(false);
  const badge = getStatusBadge(profile.status);

  const handleCopyUrl = () => {
    navigator.clipboard.writeText(profile.profile_url);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleActivate = async () => {
    try {
      setLoading(true);
      await onActivate(profile.id);
    } finally {
      setLoading(false);
    }
  };

  const handleToggle = async () => {
    try {
      setLoading(true);
      await onTogglePause(profile.id, profile.status === 'ACTIVE');
    } finally {
      setLoading(false);
    }
  };

  const handleCheck = async () => {
    try {
      setChecking(true);
      await onCheckNow(profile.id);
    } finally {
      setChecking(false);
    }
  };

  const handleRemove = async () => {
    if (confirm(`Remove public profile @${profile.username} from monitoring list?`)) {
      try {
        setLoading(true);
        await onRemove(profile.id);
      } finally {
        setLoading(false);
      }
    }
  };

  return (
    <div
      className={`relative rounded-3xl border transition-all duration-300 p-5 flex flex-col justify-between ${
        profile.is_active_source
          ? 'bg-zinc-900/90 border-rose-500/50 shadow-lg shadow-rose-500/10'
          : 'bg-zinc-900/50 border-zinc-800 hover:border-zinc-700'
      }`}
    >
      <div>
        {/* Top Header */}
        <div className="flex items-start justify-between gap-3 mb-3">
          <div className="flex items-center gap-3">
            <div className="relative">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={profile.avatar_url}
                alt={profile.username}
                className={`w-14 h-14 rounded-2xl object-cover ring-2 ${
                  profile.is_active_source ? 'ring-rose-500' : 'ring-zinc-700'
                }`}
              />
              <div className="absolute -bottom-1 -right-1 bg-gradient-to-tr from-amber-500 to-rose-500 p-1 rounded-md text-white">
                <Instagram className="w-3 h-3" />
              </div>
            </div>

            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <h4 className="text-base font-bold text-white tracking-tight truncate">
                  @{profile.username}
                </h4>
              </div>
              <p className="text-xs text-zinc-400 truncate">{profile.display_name}</p>
              <div className="flex items-center gap-2 mt-1">
                <span
                  className={`px-2.5 py-0.5 rounded-full text-[10px] font-semibold border ${badge.bg} ${badge.text} ${badge.border}`}
                >
                  {badge.label}
                </span>
                {profile.is_active_source && (
                  <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-rose-500/15 text-rose-400 border border-rose-500/30 flex items-center gap-1">
                    <span className="w-1.5 h-1.5 rounded-full bg-rose-400 animate-pulse" />
                    Active Source
                  </span>
                )}
              </div>
            </div>
          </div>

          <button
            onClick={handleRemove}
            title="Remove Profile"
            className="p-1.5 text-zinc-400 hover:text-rose-400 hover:bg-zinc-800/80 rounded-lg transition-colors"
          >
            <Trash2 className="w-4 h-4" />
          </button>
        </div>

        {/* Public Profile URL Card */}
        <div className="bg-zinc-950/60 p-2.5 rounded-xl border border-zinc-800 text-xs mb-3 flex items-center justify-between gap-2">
          <span className="font-mono text-zinc-300 text-[11px] truncate">{profile.profile_url}</span>
          <div className="flex items-center gap-1 shrink-0">
            <button
              onClick={handleCopyUrl}
              className="p-1 text-zinc-400 hover:text-white rounded hover:bg-zinc-800 transition-colors"
              title="Copy URL"
            >
              {copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
            </button>
            <a
              href={profile.profile_url}
              target="_blank"
              rel="noreferrer"
              className="p-1 text-zinc-400 hover:text-white rounded hover:bg-zinc-800 transition-colors"
              title="Open in Instagram"
            >
              <ExternalLink className="w-3.5 h-3.5" />
            </a>
          </div>
        </div>

        {/* Status Reason Callout (Honest Reporting) */}
        <div className="p-3 bg-zinc-950/80 rounded-xl border border-zinc-800/80 text-xs mb-3">
          <div className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-zinc-400 mb-1">
            <ShieldCheck className="w-3.5 h-3.5 text-cyan-400" />
            <span>Monitoring State</span>
          </div>
          <p className="text-[11px] text-zinc-300 leading-relaxed">{profile.status_reason}</p>
          <div className="flex items-center gap-1 mt-2 text-[10px] text-zinc-400">
            <Clock className="w-3 h-3 text-zinc-500" />
            <span>Last checked: {formatRelativeTime(profile.last_checked_at)}</span>
          </div>
        </div>
      </div>

      {/* Action Buttons */}
      <div className="space-y-2 pt-3 border-t border-zinc-800">
        {profile.is_active_source ? (
          <div className="w-full py-2 bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 rounded-xl text-xs font-semibold flex items-center justify-center gap-1.5">
            <CheckCircle2 className="w-4 h-4" />
            <span>Currently Active Source</span>
          </div>
        ) : (
          <button
            onClick={handleActivate}
            disabled={loading || profile.status === 'PAUSED'}
            className="w-full py-2 bg-zinc-800 hover:bg-rose-600 text-white rounded-xl text-xs font-semibold transition-all flex items-center justify-center gap-2 shadow-sm disabled:opacity-50"
          >
            <ArrowRightLeft className="w-3.5 h-3.5" />
            <span>Set as Active Source</span>
          </button>
        )}

        <div className="flex gap-2">
          {/* Pause / Resume Button */}
          <button
            onClick={handleToggle}
            disabled={loading}
            className={`flex-1 py-1.5 px-3 rounded-xl text-xs font-medium border transition-colors flex items-center justify-center gap-1.5 ${
              profile.status === 'ACTIVE'
                ? 'bg-amber-500/10 text-amber-300 border-amber-500/20 hover:bg-amber-500/20'
                : 'bg-emerald-500/10 text-emerald-300 border-emerald-500/20 hover:bg-emerald-500/20'
            }`}
          >
            {profile.status === 'ACTIVE' ? (
              <>
                <Pause className="w-3.5 h-3.5" />
                <span>Pause</span>
              </>
            ) : (
              <>
                <Play className="w-3.5 h-3.5" />
                <span>Resume</span>
              </>
            )}
          </button>

          {/* Check Now Button */}
          <button
            onClick={handleCheck}
            disabled={checking}
            className="py-1.5 px-3 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 rounded-xl text-xs font-medium border border-zinc-700 transition-colors flex items-center justify-center gap-1.5 disabled:opacity-50"
            title="Execute permitted check now"
          >
            <RotateCcw className={`w-3.5 h-3.5 ${checking ? 'animate-spin' : ''}`} />
            <span>{checking ? 'Checking...' : 'Check Now'}</span>
          </button>
        </div>
      </div>
    </div>
  );
}
