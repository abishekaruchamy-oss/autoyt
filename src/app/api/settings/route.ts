import { NextResponse } from 'next/server';
import { Repository } from '@/server/db/repository';

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
    const body = await request.json();
    const { integrations: updatedIntegrations, automation: updatedAutomation } = body;

    if (updatedAutomation) {
      await Repository.updateAutomationSettings(updatedAutomation);
    }

    if (updatedIntegrations) {
      for (const [key, val] of Object.entries(updatedIntegrations)) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await Repository.updateIntegration(key as any, val as any);
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
