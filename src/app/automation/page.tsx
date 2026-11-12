'use client';

import React, { useEffect, useState, useCallback } from 'react';
import { AutomationSettings, InstagramAccount, ExecutionReadiness } from '@/types';
import { AutomationSettingsForm } from '@/components/automation/AutomationSettingsForm';
import { WorkflowEndpointsCard } from '@/components/automation/WorkflowEndpointsCard';
import { fetchJsonWithTimeout } from '@/lib/apiClient';
import {
  PageLoadingSkeleton,
  PageErrorBanner,
  InlineNoticeBanner,
} from '@/components/ui/PageStateCard';
import { Cpu } from 'lucide-react';

export default function AutomationPage() {
  const [automation, setAutomation] = useState<AutomationSettings | null>(null);
  const [readiness, setReadiness] = useState<ExecutionReadiness | null>(null);
  const [accounts, setAccounts] = useState<InstagramAccount[]>([]);
  const [loading, setLoading] = useState(true);
  const [retrying, setRetrying] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    try {
      setRetrying(true);
      const [autoRes, accRes] = await Promise.all([
        fetchJsonWithTimeout<{
          success: boolean;
          automation?: AutomationSettings;
          readiness?: ExecutionReadiness;
          error?: string;
        }>('/api/automation'),
        fetchJsonWithTimeout<{ success: boolean; accounts?: InstagramAccount[]; error?: string }>(
          '/api/accounts'
        ),
      ]);

      if (autoRes.ok && autoRes.data?.success && autoRes.data.automation) {
        setAutomation(autoRes.data.automation);
        setReadiness(autoRes.data.readiness || null);
        setLoadError(null);
      } else {
        setLoadError(autoRes.error || autoRes.data?.error || 'Failed to load automation settings.');
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

  if (loading) {
    return <PageLoadingSkeleton label="Loading automation settings..." />;
  }

  if (!automation) {
    return (
      <PageErrorBanner
        message={loadError || 'Automation settings are temporarily unavailable.'}
        onRetry={fetchData}
        retrying={retrying}
      />
    );
  }

  return (
    <div className="p-4 sm:p-8 space-y-8 max-w-7xl w-full mx-auto">
      {loadError && (
        <InlineNoticeBanner
          type="warning"
          message={`Refresh warning: ${loadError}`}
          onDismiss={() => setLoadError(null)}
        />
      )}

      {/* Page Title */}
      <div>
        <div className="flex items-center gap-2.5 mb-1">
          <div className="w-8 h-8 rounded-xl bg-purple-500/10 text-purple-400 flex items-center justify-center">
            <Cpu className="w-4 h-4" />
          </div>
          <h1 className="text-2xl sm:text-3xl font-extrabold text-white tracking-tight">
            Automation Controls & Engine
          </h1>
        </div>
        <p className="text-xs text-zinc-400">
          Manage Cloudflare D1 polling configuration, execution locks, active monitored source, and optional webhook endpoints.
        </p>
      </div>

      {readiness && !readiness.ready_for_live_upload && (
        <InlineNoticeBanner
          type="warning"
          message={`Live upload execution readiness is blocked: ${readiness.blocking_reasons.join(' ')}`}
        />
      )}

      {/* Settings Form */}
      <AutomationSettingsForm
        automation={automation}
        accounts={accounts}
        onUpdate={fetchData}
      />

      {/* n8n Endpoints & Integration Architecture Card */}
      <WorkflowEndpointsCard />
    </div>
  );
}
