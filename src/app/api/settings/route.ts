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
    const integrations = await Repository.getIntegrations();
    const automation = await Repository.getAutomationSettings();
    const accounts = await Repository.getAccounts();

    return NextResponse.json(
      {
        success: true,
        integrations,
        automation,
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

    const currentIntegrations = await Repository.getIntegrations();
    const currentAutomation = await Repository.getAutomationSettings();

    return NextResponse.json(
      {
        success: true,
        message: 'Settings updated successfully',
        integrations: currentIntegrations,
        automation: currentAutomation,
      },
      { headers: NO_STORE_HEADERS }
    );
  } catch (error) {
    return NextResponse.json(
      { success: false, error: sanitizeErrorMessage(error, 'Failed to update settings.') },
      { status: 500, headers: NO_STORE_HEADERS }
    );
  }
}
