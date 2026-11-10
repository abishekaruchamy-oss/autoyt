'use client';

import React, { useEffect, useState, useCallback } from 'react';
import { DashboardMetrics, InstagramAccount } from '@/types';
import { TopHeader } from '@/components/layout/TopHeader';
import { MetricsGrid } from '@/components/dashboard/MetricsGrid';
import { ActiveSourceCard } from '@/components/dashboard/ActiveSourceCard';
import { QuickControls } from '@/components/dashboard/QuickControls';
import { RecentActivityFeed } from '@/components/dashboard/RecentActivityFeed';
import { RefreshCw, PlayCircle } from 'lucide-react';

export default function DashboardPage() {
  const [metrics, setMetrics] = useState<DashboardMetrics | null>(null);
  const [allAccounts, setAllAccounts] = useState<InstagramAccount[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchData = useCallback(async () => {
    try {
      const [dashRes, accRes] = await Promise.all([
        fetch('/api/dashboard'),
        fetch('/api/accounts'),
      ]);

      const dashData = (await dashRes.json()) as { success: boolean; metrics?: DashboardMetrics };
      const accData = (await accRes.json()) as { success: boolean; accounts?: InstagramAccount[] };

      if (dashData.success && dashData.metrics) {
        setMetrics(dashData.metrics);
      }
      if (accData.success && accData.accounts) {
        setAllAccounts(accData.accounts);
      }
    } catch (err) {
      console.error('Failed to load dashboard metrics:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  if (loading || !metrics) {
    return (
      <div className="flex-1 flex items-center justify-center min-h-[60vh]">
        <div className="flex flex-col items-center gap-3 text-zinc-400">
          <RefreshCw className="w-6 h-6 animate-spin text-rose-500" />
          <span className="text-xs font-semibold">Loading Automation Dashboard...</span>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col min-h-full">
      {/* Top Header */}
      <TopHeader
        activeAccount={metrics.active_account}
        automation={metrics.automation}
        onRefresh={fetchData}
      />

      {/* Main Container */}
      <div className="p-4 sm:p-8 space-y-6 max-w-7xl w-full mx-auto">
        {/* Welcome Banner */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl sm:text-3xl font-extrabold text-white tracking-tight">
              Automation Overview
            </h1>
            <p className="text-xs sm:text-sm text-zinc-400 mt-1">
              Instagram Creator accounts to YouTube Shorts automated publishing pipeline.
            </p>
          </div>
        </div>

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
          onUpdate={fetchData}
        />

        {/* 4. Recent Activity Event Feed */}
        <RecentActivityFeed activities={metrics.recent_activity} />
      </div>
    </div>
  );
}
