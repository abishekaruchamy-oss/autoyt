'use client';

import React from 'react';
import Link from 'next/link';
import {
  Users,
  Film,
  UploadCloud,
  AlertTriangle,
  HardDrive,
  ArrowUpRight,
} from 'lucide-react';
import { Instagram } from '@/components/ui/Icons';
import { DashboardMetrics } from '@/types';

interface MetricsGridProps {
  metrics: DashboardMetrics;
}

export function MetricsGrid({ metrics }: MetricsGridProps) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
      {/* 1. Monitored Profiles */}
      <div className="bg-zinc-900/60 border border-zinc-800 rounded-2xl p-5 hover:border-zinc-700 transition-all flex flex-col justify-between">
        <div className="flex items-center justify-between">
          <span className="text-xs font-semibold uppercase tracking-wider text-zinc-400">
            Monitored Profiles
          </span>
          <div className="w-8 h-8 rounded-lg bg-pink-500/10 text-pink-400 flex items-center justify-center">
            <Instagram className="w-4 h-4" />
          </div>
        </div>
        <div className="mt-4 flex items-baseline justify-between">
          <div>
            <span className="text-3xl font-bold tracking-tight text-white">
              {metrics.total_accounts}
            </span>
            <span className="text-xs text-zinc-400 ml-2">
              ({metrics.active_accounts_count} active)
            </span>
          </div>
          <Link
            href="/accounts"
            className="text-xs text-rose-400 hover:text-rose-300 font-medium flex items-center gap-0.5"
          >
            Manage <ArrowUpRight className="w-3.5 h-3.5" />
          </Link>
        </div>
      </div>

      {/* 2. Active Monitored Source */}
      <div className="bg-zinc-900/60 border border-zinc-800 rounded-2xl p-5 hover:border-zinc-700 transition-all flex flex-col justify-between">
        <div className="flex items-center justify-between">
          <span className="text-xs font-semibold uppercase tracking-wider text-zinc-400">
            Active Monitored Source
          </span>
          <div className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
        </div>
        <div className="mt-4 flex items-center justify-between">
          {metrics.active_account ? (
            <div className="flex items-center gap-3">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={metrics.active_account.profile_picture_url}
                alt={metrics.active_account.username}
                className="w-10 h-10 rounded-full object-cover ring-2 ring-rose-500/40"
              />
              <div>
                <span className="text-base font-bold text-white block">
                  @{metrics.active_account.username}
                </span>
                <span className="text-xs text-emerald-400 font-medium">Selected for pipeline</span>
              </div>
            </div>
          ) : (
            <div>
              <span className="text-sm font-semibold text-amber-400 block">No Active Profile</span>
              <span className="text-xs text-zinc-400">Select one in Profiles</span>
            </div>
          )}
          <Link
            href="/accounts"
            className="text-xs text-zinc-400 hover:text-white font-medium flex items-center gap-0.5"
          >
            Switch <ArrowUpRight className="w-3.5 h-3.5" />
          </Link>
        </div>
      </div>

      {/* 3. Total Reels Detected */}
      <div className="bg-zinc-900/60 border border-zinc-800 rounded-2xl p-5 hover:border-zinc-700 transition-all flex flex-col justify-between">
        <div className="flex items-center justify-between">
          <span className="text-xs font-semibold uppercase tracking-wider text-zinc-400">
            Reels Detected
          </span>
          <div className="w-8 h-8 rounded-lg bg-purple-500/10 text-purple-400 flex items-center justify-center">
            <Film className="w-4 h-4" />
          </div>
        </div>
        <div className="mt-4 flex items-baseline justify-between">
          <div>
            <span className="text-3xl font-bold tracking-tight text-white">
              {metrics.total_reels_detected}
            </span>
            <span className="text-xs text-emerald-400 ml-2 font-medium">+2 today</span>
          </div>
          <Link
            href="/uploads"
            className="text-xs text-purple-400 hover:text-purple-300 font-medium flex items-center gap-0.5"
          >
            History <ArrowUpRight className="w-3.5 h-3.5" />
          </Link>
        </div>
      </div>

      {/* 4. Total Videos Uploaded */}
      <div className="bg-zinc-900/60 border border-zinc-800 rounded-2xl p-5 hover:border-zinc-700 transition-all flex flex-col justify-between">
        <div className="flex items-center justify-between">
          <span className="text-xs font-semibold uppercase tracking-wider text-zinc-400">
            YouTube Shorts Uploaded
          </span>
          <div className="w-8 h-8 rounded-lg bg-red-500/10 text-red-400 flex items-center justify-center">
            <UploadCloud className="w-4 h-4" />
          </div>
        </div>
        <div className="mt-4 flex items-baseline justify-between">
          <div>
            <span className="text-3xl font-bold tracking-tight text-white">
              {metrics.total_videos_uploaded}
            </span>
            <span className="text-xs text-zinc-400 ml-2">Published</span>
          </div>
          <span className="text-xs px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-400 font-semibold border border-emerald-500/20">
            96% Success
          </span>
        </div>
      </div>

      {/* 5. Failed Uploads */}
      <div className="bg-zinc-900/60 border border-zinc-800 rounded-2xl p-5 hover:border-zinc-700 transition-all flex flex-col justify-between">
        <div className="flex items-center justify-between">
          <span className="text-xs font-semibold uppercase tracking-wider text-zinc-400">
            Failed Uploads
          </span>
          <div className="w-8 h-8 rounded-lg bg-rose-500/10 text-rose-400 flex items-center justify-center">
            <AlertTriangle className="w-4 h-4" />
          </div>
        </div>
        <div className="mt-4 flex items-baseline justify-between">
          <div>
            <span className="text-3xl font-bold tracking-tight text-rose-400">
              {metrics.failed_uploads}
            </span>
            <span className="text-xs text-zinc-400 ml-2">Needs attention</span>
          </div>
          {metrics.failed_uploads > 0 && (
            <Link
              href="/uploads?status=FAILED"
              className="text-xs text-rose-400 hover:underline font-medium flex items-center gap-0.5"
            >
              Retry <ArrowUpRight className="w-3.5 h-3.5" />
            </Link>
          )}
        </div>
      </div>

      {/* 6. Storage Usage */}
      <div className="bg-zinc-900/60 border border-zinc-800 rounded-2xl p-5 hover:border-zinc-700 transition-all flex flex-col justify-between">
        <div className="flex items-center justify-between">
          <span className="text-xs font-semibold uppercase tracking-wider text-zinc-400">
            Google Drive Storage
          </span>
          <div className="w-8 h-8 rounded-lg bg-blue-500/10 text-blue-400 flex items-center justify-center">
            <HardDrive className="w-4 h-4" />
          </div>
        </div>
        <div className="mt-3">
          <div className="flex justify-between text-xs mb-1.5">
            <span className="text-zinc-300 font-semibold">
              {metrics.storage.used_formatted} of {metrics.storage.total_formatted}
            </span>
            <span className="text-zinc-400">{metrics.storage.percentage}% used</span>
          </div>
          {/* Progress Bar */}
          <div className="w-full h-2 rounded-full bg-zinc-800 overflow-hidden">
            <div
              className="h-full rounded-full bg-gradient-to-r from-blue-500 to-cyan-400 transition-all duration-500"
              style={{ width: `${Math.min(metrics.storage.percentage, 100)}%` }}
            />
          </div>
          <span className="text-[11px] text-zinc-500 mt-2 block truncate">
            Target: &quot;{metrics.storage.folder_name}&quot; ({metrics.storage.reels_stored} videos stored)
          </span>
        </div>
      </div>
    </div>
  );
}
