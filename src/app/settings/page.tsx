'use client';

import React, { useEffect, useState, useCallback } from 'react';
import { IntegrationStatus, AutomationSettings } from '@/types';
import { IntegrationsPanel } from '@/components/settings/IntegrationsPanel';
import { Settings, RefreshCw } from 'lucide-react';

export default function SettingsPage() {
  const [integrations, setIntegrations] = useState<IntegrationStatus | null>(null);
  const [automation, setAutomation] = useState<AutomationSettings | null>(null);
  const [accountsCount, setAccountsCount] = useState<number>(0);
  const [loading, setLoading] = useState(true);

  const fetchData = useCallback(async () => {
    try {
      const res = await fetch('/api/settings');
      const data = (await res.json()) as {
        success: boolean;
        integrations?: IntegrationStatus;
        automation?: AutomationSettings;
        accounts_count?: number;
      };
      if (data.success && data.integrations && data.automation) {
        setIntegrations(data.integrations);
        setAutomation(data.automation);
        setAccountsCount(data.accounts_count ?? 0);
      }
    } catch (err) {
      console.error('Failed to load settings:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  if (loading || !integrations || !automation) {
    return (
      <div className="flex items-center justify-center min-h-[60vh] text-zinc-400 gap-2 text-xs">
        <RefreshCw className="w-5 h-5 animate-spin text-rose-500" />
        <span>Loading integrations & settings...</span>
      </div>
    );
  }

  return (
    <div className="p-4 sm:p-8 space-y-8 max-w-7xl w-full mx-auto">
      {/* Page Title */}
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

      {/* Main Integrations Panel */}
      <IntegrationsPanel
        integrations={integrations}
        automation={automation}
        accountsCount={accountsCount}
        onUpdate={fetchData}
      />
    </div>
  );
}
