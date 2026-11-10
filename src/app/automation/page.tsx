'use client';

import React, { useEffect, useState, useCallback } from 'react';
import { AutomationSettings, InstagramAccount } from '@/types';
import { AutomationSettingsForm } from '@/components/automation/AutomationSettingsForm';
import { WorkflowEndpointsCard } from '@/components/automation/WorkflowEndpointsCard';
import { Cpu, RefreshCw } from 'lucide-react';

export default function AutomationPage() {
  const [automation, setAutomation] = useState<AutomationSettings | null>(null);
  const [accounts, setAccounts] = useState<InstagramAccount[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchData = useCallback(async () => {
    try {
      const [autoRes, accRes] = await Promise.all([
        fetch('/api/automation'),
        fetch('/api/accounts'),
      ]);

      const autoData = (await autoRes.json()) as { success: boolean; automation?: AutomationSettings };
      const accData = (await accRes.json()) as { success: boolean; accounts?: InstagramAccount[] };

      if (autoData.success && autoData.automation) {
        setAutomation(autoData.automation);
      }
      if (accData.success && accData.accounts) {
        setAccounts(accData.accounts);
      }
    } catch (err) {
      console.error('Failed to load automation config:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  if (loading || !automation) {
    return (
      <div className="flex items-center justify-center min-h-[60vh] text-zinc-400 gap-2 text-xs">
        <RefreshCw className="w-5 h-5 animate-spin text-rose-500" />
        <span>Loading automation settings...</span>
      </div>
    );
  }

  return (
    <div className="p-4 sm:p-8 space-y-8 max-w-7xl w-full mx-auto">
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
          Manage polling schedules, execution locks, active creator source selection, and n8n webhook orchestrations.
        </p>
      </div>

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
