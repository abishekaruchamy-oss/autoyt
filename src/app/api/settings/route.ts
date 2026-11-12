import { NextRequest, NextResponse } from 'next/server';
import { requireAdminApi } from '@/lib/auth';
import { NO_STORE_HEADERS, sanitizeErrorMessage } from '@/lib/security';
import { Repository } from '@/server/db/repository';
import { AutomationSettings, IntegrationName, IntegrationData } from '@/types';

interface SettingsPayload {
  integrations?: Record<string, IntegrationData>;
  automation?: Partial<AutomationSettings>;
}

export async function GET(request: NextRequest) {
  const authError = requireAdminApi(request);
  if (authError) return authError;

  try {
    const [integrations, automation, accounts, readiness] = await Promise.all([
      Repository.getIntegrations(),
      Repository.getAutomationSettings(),
      Repository.getAccounts(),
      Repository.evaluateExecutionReadiness(),
    ]);

    return NextResponse.json(
      {
        success: true,
        integrations,
        automation,
        readiness,
        is_production: process.env.NODE_ENV === 'production',
        accounts_count: accounts.length,
      },
      { headers: NO_STORE_HEADERS }
    );
  } catch (error) {
    return NextResponse.json(
      { success: false, error: sanitizeErrorMessage(error, 'Failed to load settings.') },
      { status: 500, headers: NO_STORE_HEADERS }
    );
  }
}

export async function POST(request: NextRequest) {
  const authError = requireAdminApi(request);
  if (authError) return authError;

  try {
    const body = (await request.json()) as SettingsPayload;
    const { integrations: updatedIntegrations, automation: updatedAutomation } = body;

    if (updatedAutomation) {
      await Repository.updateAutomationSettings(updatedAutomation);
    }

    if (updatedIntegrations) {
      for (const [key, val] of Object.entries(updatedIntegrations)) {
        await Repository.updateIntegration(key as IntegrationName, val);
      }
    }

    const [currentIntegrations, currentAutomation, readiness] = await Promise.all([
      Repository.getIntegrations(),
      Repository.getAutomationSettings(),
      Repository.evaluateExecutionReadiness(),
    ]);

    return NextResponse.json(
      {
        success: true,
        message: 'Settings updated successfully',
        integrations: currentIntegrations,
        automation: currentAutomation,
        readiness,
      },
      { headers: NO_STORE_HEADERS }
    );
  } catch (error) {
    const msg = sanitizeErrorMessage(error, 'Failed to update settings.');
    const status = /must be|invalid/i.test(msg) ? 400 : 500;
    return NextResponse.json(
      { success: false, error: msg },
      { status, headers: NO_STORE_HEADERS }
    );
  }
}
