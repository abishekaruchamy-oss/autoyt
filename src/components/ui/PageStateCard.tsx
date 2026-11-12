'use client';

import React from 'react';
import { AlertCircle, CheckCircle2, RefreshCw, X } from 'lucide-react';

export function PageLoadingSkeleton({ label }: { label: string }) {
  return (
    <div className="p-4 sm:p-8 space-y-6 max-w-7xl w-full mx-auto animate-pulse">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-zinc-800/80">
        <div className="space-y-2">
          <div className="h-7 w-64 rounded-xl bg-zinc-800/80" />
          <div className="h-4 w-80 max-w-full rounded-lg bg-zinc-900" />
        </div>
        <div className="flex items-center gap-2 text-xs text-zinc-400">
          <RefreshCw className="w-4 h-4 animate-spin text-rose-500" />
          <span>{label}</span>
        </div>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {[0, 1, 2, 3].map((idx) => (
          <div
            key={idx}
            className="h-36 rounded-2xl bg-zinc-900/60 border border-zinc-800/80 p-5 space-y-3"
          >
            <div className="h-3 w-28 rounded bg-zinc-800" />
            <div className="h-8 w-20 rounded bg-zinc-800/90" />
            <div className="h-3 w-40 rounded bg-zinc-900" />
          </div>
        ))}
      </div>
      <div className="h-64 rounded-2xl bg-zinc-900/40 border border-zinc-800/80" />
    </div>
  );
}

export function PageErrorBanner({
  message,
  onRetry,
  retrying,
}: {
  message: string;
  onRetry: () => void;
  retrying?: boolean;
}) {
  return (
    <div className="p-4 sm:p-8 max-w-3xl mx-auto">
      <div className="p-6 rounded-2xl bg-zinc-900/90 border border-rose-500/30 text-xs text-rose-200 flex flex-col sm:flex-row sm:items-center justify-between gap-4 shadow-lg">
        <div className="flex items-start gap-3">
          <AlertCircle className="w-5 h-5 text-rose-400 shrink-0 mt-0.5" />
          <div className="space-y-1">
            <p className="font-semibold text-white text-sm">Unable to load page data</p>
            <p className="text-rose-200/90 leading-relaxed">{message}</p>
          </div>
        </div>
        <button
          type="button"
          onClick={onRetry}
          disabled={retrying}
          className="self-start sm:self-auto px-4 py-2 rounded-xl bg-zinc-800 hover:bg-zinc-700 text-zinc-100 font-semibold flex items-center gap-2 shrink-0 disabled:opacity-50 transition-colors"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${retrying ? 'animate-spin' : ''}`} />
          <span>{retrying ? 'Retrying...' : 'Retry'}</span>
        </button>
      </div>
    </div>
  );
}

export function InlineNoticeBanner({
  type,
  message,
  onDismiss,
}: {
  type: 'success' | 'error' | 'warning';
  message: string;
  onDismiss?: () => void;
}) {
  const styles =
    type === 'success'
      ? 'bg-emerald-500/10 border-emerald-500/25 text-emerald-200'
      : type === 'warning'
        ? 'bg-amber-500/10 border-amber-500/25 text-amber-200'
        : 'bg-rose-500/10 border-rose-500/25 text-rose-200';

  return (
    <div className={`p-3.5 rounded-2xl border text-xs flex items-start justify-between gap-3 ${styles}`}>
      <div className="flex items-start gap-2.5 min-w-0">
        {type === 'success' ? (
          <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5 text-emerald-400" />
        ) : (
          <AlertCircle
            className={`w-4 h-4 shrink-0 mt-0.5 ${
              type === 'warning' ? 'text-amber-400' : 'text-rose-400'
            }`}
          />
        )}
        <span className="leading-relaxed break-words">{message}</span>
      </div>
      {onDismiss && (
        <button
          type="button"
          onClick={onDismiss}
          className="text-zinc-400 hover:text-white p-0.5 shrink-0"
          aria-label="Dismiss message"
        >
          <X className="w-4 h-4" />
        </button>
      )}
    </div>
  );
}
