'use client';

import React, { useEffect, useState, useCallback } from 'react';
import { UploadJob, InstagramAccount } from '@/types';
import { UploadHistoryTable } from '@/components/uploads/UploadHistoryTable';
import { fetchJsonWithTimeout } from '@/lib/apiClient';
import {
  PageLoadingSkeleton,
  PageErrorBanner,
  InlineNoticeBanner,
} from '@/components/ui/PageStateCard';
import { History, RefreshCw, CheckCircle2, AlertTriangle, Clock } from 'lucide-react';

export default function UploadsPage() {
  const [jobs, setJobs] = useState<UploadJob[]>([]);
  const [accounts, setAccounts] = useState<InstagramAccount[]>([]);
  const [loading, setLoading] = useState(true);
  const [retrying, setRetrying] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    try {
      setRetrying(true);
      const [jobsRes, accRes] = await Promise.all([
        fetchJsonWithTimeout<{ success: boolean; jobs?: UploadJob[]; error?: string }>(
          '/api/uploads'
        ),
        fetchJsonWithTimeout<{ success: boolean; accounts?: InstagramAccount[]; error?: string }>(
          '/api/accounts'
        ),
      ]);

      if (jobsRes.ok && jobsRes.data?.success && jobsRes.data.jobs) {
        setJobs(jobsRes.data.jobs);
        setLoadError(null);
      } else {
        setLoadError(jobsRes.error || jobsRes.data?.error || 'Failed to load upload history.');
      }

      if (accRes.ok && accRes.data?.success && accRes.data.accounts) {
        setAccounts(accRes.data.accounts);
      }
    } finally {
      setLoading(false);
      setRetrying(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const completedCount = jobs.filter((j) => j.status === 'COMPLETED').length;
  const failedCount = jobs.filter((j) => j.status === 'FAILED').length;
  const inProgressCount = jobs.filter(
    (j) => j.status !== 'COMPLETED' && j.status !== 'FAILED'
  ).length;

  if (loading) {
    return <PageLoadingSkeleton label="Loading upload history..." />;
  }

  if (loadError && jobs.length === 0) {
    return <PageErrorBanner message={loadError} onRetry={fetchData} retrying={retrying} />;
  }

  return (
    <div className="p-4 sm:p-8 space-y-6 max-w-7xl w-full mx-auto">
      {loadError && (
        <InlineNoticeBanner
          type="warning"
          message={`Refresh warning: ${loadError}`}
          onDismiss={() => setLoadError(null)}
        />
      )}

      {/* Title & Summary */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-zinc-800">
        <div>
          <div className="flex items-center gap-2.5 mb-1">
            <div className="w-8 h-8 rounded-xl bg-red-500/10 text-red-400 flex items-center justify-center">
              <History className="w-4 h-4" />
            </div>
            <h1 className="text-2xl sm:text-3xl font-extrabold text-white tracking-tight">
              Upload History & Pipeline Queue
            </h1>
          </div>
          <p className="text-xs text-zinc-400">
            Monitor Reel detection, Google Drive backup storage, and YouTube Shorts publishing lifecycle.
          </p>
        </div>

        {/* Quick Stats Pills */}
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <button
            type="button"
            onClick={fetchData}
            disabled={retrying}
            className="px-3 py-1.5 rounded-xl bg-zinc-900 hover:bg-zinc-800 text-zinc-300 border border-zinc-800 font-medium flex items-center gap-1.5 disabled:opacity-50"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${retrying ? 'animate-spin' : ''}`} />
            <span>Refresh</span>
          </button>
          <span className="px-3 py-1.5 rounded-xl bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 font-semibold flex items-center gap-1.5">
            <CheckCircle2 className="w-3.5 h-3.5" />
            <span>{completedCount} Live</span>
          </span>
          {inProgressCount > 0 && (
            <span className="px-3 py-1.5 rounded-xl bg-blue-500/10 text-blue-400 border border-blue-500/20 font-semibold flex items-center gap-1.5">
              <Clock className="w-3.5 h-3.5" />
              <span>{inProgressCount} Processing</span>
            </span>
          )}
          {failedCount > 0 && (
            <span className="px-3 py-1.5 rounded-xl bg-rose-500/10 text-rose-400 border border-rose-500/20 font-semibold flex items-center gap-1.5">
              <AlertTriangle className="w-3.5 h-3.5" />
              <span>{failedCount} Failed</span>
            </span>
          )}
        </div>
      </div>

      {/* Main Table & Filter List */}
      <UploadHistoryTable
        jobs={jobs}
        accounts={accounts}
        onJobRetried={fetchData}
      />
    </div>
  );
}
