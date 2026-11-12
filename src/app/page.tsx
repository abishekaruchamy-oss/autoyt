'use client';

import React, { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import { DashboardMetrics, InstagramAccount } from '@/types';
import { TopHeader } from '@/components/layout/TopHeader';
import { MetricsGrid } from '@/components/dashboard/MetricsGrid';
import { ActiveSourceCard } from '@/components/dashboard/ActiveSourceCard';
import { QuickControls } from '@/components/dashboard/QuickControls';
import { RecentActivityFeed } from '@/components/dashboard/RecentActivityFeed';
import { fetchJsonWithTimeout } from '@/lib/apiClient';
import {
  PageLoadingSkeleton,
  PageErrorBanner,
  InlineNoticeBanner,
} from '@/components/ui/PageStateCard';
import { formatRelativeTime } from '@/lib/utils';
import { RefreshCw, ShieldAlert, Database, Clock } from 'lucide-react';

export default function DashboardPage() {
  const [metrics, setMetrics] = useState<DashboardMetrics | null>(null);
  const [allAccounts, setAllAccounts] = useState<InstagramAccount[]>([]);
  const [loading, setLoading] = useState(true);
  const [retrying, setRetrying] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [notice, setNotice] = useState<{
    type: 'success' | 'error' | 'warning';
    message: string;
  } | null>(null);

  const fetchData = useCallback(async () => {
    try {
      setRetrying(true);
      const [dashRes, accRes] = await Promise.all([
        fetchJsonWithTimeout<{ success: boolean; metrics?: DashboardMetrics; error?: string }>(
          '/api/dashboard'
        ),
        fetchJsonWithTimeout<{ success: boolean; accounts?: InstagramAccount[]; error?: string }>(
          '/api/accounts'
        ),
      ]);

      if (dashRes.ok && dashRes.data?.success && dashRes.data.metrics) {
        setMetrics(dashRes.data.metrics);
        setLoadError(null);
      } else {
        setLoadError(dashRes.error || dashRes.data?.error || 'Failed to load dashboard metrics.');
      }

      if (accRes.ok && accRes.data?.success && accRes.data.accounts) {
        setAllAccounts(accRes.data.accounts);
      }
    } finally {
      setLoading(false);
      setRetrying(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  if (loading) {
    return <PageLoadingSkeleton label="Loading Automation Dashboard..." />;
  }

  if (!metrics) {
    return (
      <PageErrorBanner
        message={loadError || 'Dashboard metrics could not be loaded.'}
        onRetry={fetchData}
        retrying={retrying}
      />
    );
  }

  return (
    <div className="flex flex-col min-h-full">
      {/* Top Header */}
      <TopHeader
        activeAccount={metrics.active_account}
        automation={metrics.automation}
        readiness={metrics.readiness}
        isProduction={metrics.is_production}
        onRefresh={fetchData}
        onNotice={setNotice}
      />

      {/* Main Container */}
      <div className="p-4 sm:p-8 space-y-6 max-w-7xl w-full mx-auto">
        {notice && (
          <InlineNoticeBanner
            type={notice.type}
            message={notice.message}
            onDismiss={() => setNotice(null)}
          />
        )}

        {loadError && (
          <InlineNoticeBanner
            type="warning"
            message={`Last background refresh failed: ${loadError}`}
            onDismiss={() => setLoadError(null)}
          />
        )}

        {/* Welcome Banner & Data Freshness */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl sm:text-3xl font-extrabold text-white tracking-tight">
              Automation Overview
            </h1>
            <p className="text-xs sm:text-sm text-zinc-400 mt-1">
              Public Instagram profile monitoring and creator-authorized Shorts pipeline on Cloudflare D1.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2 text-[11px] text-zinc-400">
            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-zinc-900 border border-zinc-800">
              <Database className="w-3.5 h-3.5 text-cyan-400" />
              <span>
                {metrics.data_source === 'cloudflare_d1' ? 'Cloudflare D1 (Live)' : 'Local Dev Store'}
              </span>
            </span>
            <span
              className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-zinc-900 border border-zinc-800"
              title={metrics.generated_at}
            >
              <Clock className="w-3.5 h-3.5 text-zinc-400" />
              <span>Updated {formatRelativeTime(metrics.generated_at)}</span>
            </span>
            <button
              type="button"
              onClick={fetchData}
              disabled={retrying}
              className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 text-zinc-300 font-medium transition-colors disabled:opacity-50"
            >
              <RefreshCw className={`w-3 h-3 ${retrying ? 'animate-spin' : ''}`} />
              <span>Refresh</span>
            </button>
          </div>
        </div>

        {/* Execution Readiness Guard Banner */}
        {!metrics.readiness.ready_for_live_upload && (
          <div className="p-4 rounded-2xl bg-amber-500/10 border border-amber-500/20 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs">
            <div className="flex items-start gap-2.5 text-amber-200">
              <ShieldAlert className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
              <div>
                <span className="font-semibold text-amber-300 block">
                  Live Automated Uploads Blocked Until Integrations Are Ready
                </span>
                <span className="text-amber-200/80">
                  {metrics.readiness.blocking_reasons.join(' ')}
                </span>
              </div>
            </div>
            <Link
              href="/settings"
              className="self-start sm:self-auto px-3 py-1.5 rounded-xl bg-zinc-900 hover:bg-zinc-800 text-zinc-200 border border-zinc-700 font-semibold shrink-0"
            >
              Review Integrations
            </Link>
          </div>
        )}

        {/* 1. KPI Metrics Grid */}
        <MetricsGrid metrics={metrics} />

        {/* 2. Active Instagram Source Account Card (with 1-click switcher) */}
        <ActiveSourceCard
          activeAccount={metrics.active_account}
          allAccounts={allAccounts}
          onAccountSwitched={fetchData}
        />

        {/* 3. Automation Controls Card */}
        <QuickControls
          automation={metrics.automation}
          readiness={metrics.readiness}
          onUpdate={fetchData}
          onNotice={setNotice}
        />

        {/* 4. Recent Activity Event Feed */}
        <RecentActivityFeed activities={metrics.recent_activity} />
      </div>
    </div>
  );
}
