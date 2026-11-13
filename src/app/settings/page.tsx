'use client';

import React, { Suspense, useEffect, useState, useCallback } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { IntegrationStatus, AutomationSettings, ExecutionReadiness } from '@/types';
import { IntegrationsPanel } from '@/components/settings/IntegrationsPanel';
import { authFetch, redirectToPath } from '@/lib/clientAuthFetch';
import { fetchJsonWithTimeout } from '@/lib/apiClient';
import { resolveOAuthBannerFeedback } from '@/lib/oauthFeedback';
import { PageLoadingSkeleton, PageErrorBanner } from '@/components/ui/PageStateCard';
import { Settings, RefreshCw, LogOut } from 'lucide-react';

function SettingsContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [integrations, setIntegrations] = useState<IntegrationStatus | null>(null);
  const [automation, setAutomation] = useState<AutomationSettings | null>(null);
  const [readiness, setReadiness] = useState<ExecutionReadiness | null>(null);
  const [isProduction, setIsProduction] = useState(false);
  const [accountsCount, setAccountsCount] = useState<number>(0);
  const [loading, setLoading] = useState(true);
  const [retrying, setRetrying] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [dismissedBannerKey, setDismissedBannerKey] = useState<string | null>(null);

  const queryKey = searchParams.toString();
  const oauthFeedback = resolveOAuthBannerFeedback({
    success: searchParams.get('success'),
    account: searchParams.get('account'),
    authNotice: searchParams.get('auth_notice'),
    warning: searchParams.get('warning'),
    error: searchParams.get('error'),
  });
  const activeOAuthBanner =
    oauthFeedback && dismissedBannerKey !== queryKey ? oauthFeedback : null;

  const fetchSettingsPayload = useCallback(async () => {
    const res = await fetchJsonWithTimeout<{
      success: boolean;
      integrations?: IntegrationStatus;
      automation?: AutomationSettings;
      readiness?: ExecutionReadiness;
      is_production?: boolean;
      accounts_count?: number;
      error?: string;
    }>('/api/settings');

    if (res.status === 401) {
      redirectToPath('/login?next=%2Fsettings');
      return { redirected: true as const, data: null };
    }

    if (!res.ok || !res.data) {
      return {
        redirected: false as const,
        data: { success: false, error: res.error || 'Failed to load integration settings.' },
      };
    }

    return { redirected: false as const, data: res.data };
  }, []);

  const fetchData = useCallback(async () => {
    try {
      setRetrying(true);
      const outcome = await fetchSettingsPayload();
      if (outcome.redirected || !outcome.data) return;
      const { data } = outcome;
      if (data.success && data.integrations && data.automation) {
        setLoadError(null);
        setIntegrations(data.integrations);
        setAutomation(data.automation);
        setReadiness(data.readiness || null);
        setIsProduction(Boolean(data.is_production));
        setAccountsCount(data.accounts_count ?? 0);
      } else {
        setLoadError(data.error || 'Failed to load integration settings.');
      }
    } finally {
      setLoading(false);
      setRetrying(false);
    }
  }, [fetchSettingsPayload]);

  useEffect(() => {
    let active = true;
    fetchSettingsPayload()
      .then((outcome) => {
        if (!active || outcome.redirected || !outcome.data) return;
        const { data } = outcome;
        if (data.success && data.integrations && data.automation) {
          setLoadError(null);
          setIntegrations(data.integrations);
          setAutomation(data.automation);
          setReadiness(data.readiness || null);
          setIsProduction(Boolean(data.is_production));
          setAccountsCount(data.accounts_count ?? 0);
        } else {
          setLoadError(data.error || 'Failed to load integration settings.');
        }
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [fetchSettingsPayload]);

  const handleDismissOAuthBanner = () => {
    setDismissedBannerKey(queryKey);
    router.replace('/settings', { scroll: false });
  };

  const handleSignOut = async () => {
    await authFetch('/api/auth/session', { method: 'DELETE' });
    redirectToPath('/login');
  };

  if (loading) {
    return <PageLoadingSkeleton label="Loading integrations & settings..." />;
  }

  if (!integrations || !automation) {
    return (
      <PageErrorBanner
        message={loadError || 'Settings are temporarily unavailable.'}
        onRetry={fetchData}
        retrying={retrying}
      />
    );
  }

  return (
    <div className="p-4 sm:p-8 space-y-8 max-w-7xl w-full mx-auto">
      {/* Page Title */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2.5 mb-1">
            <div className="w-8 h-8 rounded-xl bg-cyan-500/10 text-cyan-400 flex items-center justify-center">
              <Settings className="w-4 h-4" />
            </div>
            <h1 className="text-2xl sm:text-3xl font-extrabold text-white tracking-tight">
              Settings & Integrations
            </h1>
          </div>
          <p className="text-xs text-zinc-400">
            Manage Google Drive storage folders, YouTube channel connection, public profile monitoring, and system quotas.
          </p>
        </div>

        <button
          type="button"
          onClick={handleSignOut}
          className="self-start sm:self-auto flex items-center gap-2 px-3.5 py-2 rounded-xl text-xs font-semibold bg-zinc-900 hover:bg-zinc-800 text-zinc-300 border border-zinc-800 transition-colors"
        >
          <LogOut className="w-3.5 h-3.5" />
          <span>Sign Out</span>
        </button>
      </div>

      {/* Main Integrations Panel */}
      <IntegrationsPanel
        integrations={integrations}
        automation={automation}
        readiness={readiness || undefined}
        isProduction={isProduction}
        accountsCount={accountsCount}
        oauthBanner={activeOAuthBanner}
        onDismissOAuthBanner={handleDismissOAuthBanner}
        onUpdate={fetchData}
      />
    </div>
  );
}

export default function SettingsPage() {
  return (
    <Suspense
      fallback={
        <div className="flex items-center justify-center min-h-[60vh] text-zinc-400 gap-2 text-xs">
          <RefreshCw className="w-5 h-5 animate-spin text-rose-500" />
          <span>Loading integrations & settings...</span>
        </div>
      }
    >
      <SettingsContent />
    </Suspense>
  );
}
