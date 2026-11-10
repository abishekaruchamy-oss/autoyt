import { NextResponse } from 'next/server';
import { Repository } from '@/server/db/repository';
import { AutomationSettings, IntegrationName, IntegrationData } from '@/types';

interface SettingsPayload {
  integrations?: Record<string, IntegrationData>;
  automation?: Partial<AutomationSettings>;
}

export async function GET() {
  try {
    const integrations = await Repository.getIntegrations();
    const automation = await Repository.getAutomationSettings();
    const accounts = await Repository.getAccounts();

    return NextResponse.json({
      success: true,
      integrations,
      automation,
      accounts_count: accounts.length,
    });
  } catch (error) {
    return NextResponse.json(
      { success: false, error: (error as Error).message },
      { status: 500 }
    );
  }
}

export async function POST(request: Request) {
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

    return NextResponse.json({
      success: true,
      message: 'Settings updated successfully',
      integrations: currentIntegrations,
      automation: currentAutomation,
    });
  } catch (error) {
    return NextResponse.json(
      { success: false, error: (error as Error).message },
      { status: 500 }
    );
  }
}
