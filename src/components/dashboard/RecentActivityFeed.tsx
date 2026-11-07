'use client';

import React from 'react';
import Link from 'next/link';
import {
  ActivityLog,
  ActivityEventType,
} from '@/types';
import {
  Film,
  HardDrive,
  UploadCloud,
  AlertTriangle,
  ArrowRightLeft,
  RefreshCw,
  ShieldAlert,
  Sliders,
  CheckCircle2,
  ChevronRight,
} from 'lucide-react';
import { formatRelativeTime } from '@/lib/utils';

interface RecentActivityFeedProps {
  activities: ActivityLog[];
}

function getActivityIcon(type: ActivityEventType) {
  switch (type) {
    case 'YOUTUBE_UPLOAD':
      return <UploadCloud className="w-4 h-4 text-rose-400" />;
    case 'DRIVE_UPLOAD':
      return <HardDrive className="w-4 h-4 text-cyan-400" />;
    case 'REEL_DETECTED':
      return <Film className="w-4 h-4 text-purple-400" />;
    case 'ACCOUNT_SWITCHED':
      return <ArrowRightLeft className="w-4 h-4 text-amber-400" />;
    case 'TOKEN_EXPIRING':
      return <ShieldAlert className="w-4 h-4 text-amber-400" />;
    case 'UPLOAD_FAILED':
      return <AlertTriangle className="w-4 h-4 text-rose-400" />;
    case 'SYNC_TRIGGERED':
      return <RefreshCw className="w-4 h-4 text-blue-400" />;
    case 'SETTINGS_UPDATED':
      return <Sliders className="w-4 h-4 text-emerald-400" />;
    default:
      return <CheckCircle2 className="w-4 h-4 text-zinc-400" />;
  }
}

export function RecentActivityFeed({ activities }: RecentActivityFeedProps) {
  return (
    <div className="bg-zinc-900/60 border border-zinc-800 rounded-2xl p-6">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-base font-bold text-white">Recent Automation Activity</h3>
        <Link
          href="/uploads"
          className="text-xs text-zinc-400 hover:text-white flex items-center gap-1 font-medium"
        >
          View All Uploads <ChevronRight className="w-3.5 h-3.5" />
        </Link>
      </div>

      {activities.length === 0 ? (
        <p className="text-xs text-zinc-400 text-center py-6">No recent activity logged.</p>
      ) : (
        <div className="divide-y divide-zinc-800/80">
          {activities.map((item) => (
            <div key={item.id} className="py-3.5 flex items-start gap-3 first:pt-0 last:pb-0">
              <div className="w-8 h-8 rounded-xl bg-zinc-950 border border-zinc-800 flex items-center justify-center shrink-0 mt-0.5">
                {getActivityIcon(item.event_type)}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-xs text-zinc-200 leading-relaxed break-words font-medium">
                  {item.message}
                </p>
                <div className="flex items-center gap-2 mt-1 text-[11px] text-zinc-400">
                  {item.account_username && (
                    <span className="text-rose-400/90 font-medium">@{item.account_username}</span>
                  )}
                  {item.account_username && <span>•</span>}
                  <span>{formatRelativeTime(item.created_at)}</span>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
