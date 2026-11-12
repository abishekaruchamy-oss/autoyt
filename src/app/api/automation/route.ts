import { NextRequest, NextResponse } from 'next/server';
import { requireAdminApi } from '@/lib/auth';
import { NO_STORE_HEADERS, sanitizeAccountForApi, sanitizeErrorMessage } from '@/lib/security';
import { Repository } from '@/server/db/repository';
import { AutomationSettings } from '@/types';

export async function GET(request: NextRequest) {
  const authError = requireAdminApi(request);
  if (authError) return authError;

  try {
    const [automation, activeAccount, readiness] = await Promise.all([
      Repository.getAutomationSettings(),
      Repository.getActiveAccount(),
      Repository.evaluateExecutionReadiness(),
    ]);
    return NextResponse.json(
      {
        success: true,
        automation,
        readiness,
        is_production: process.env.NODE_ENV === 'production',
        active_account: activeAccount ? sanitizeAccountForApi(activeAccount) : null,
      },
      { headers: NO_STORE_HEADERS }
    );
  } catch (error) {
    return NextResponse.json(
      { success: false, error: sanitizeErrorMessage(error, 'Failed to load automation settings.') },
      { status: 500, headers: NO_STORE_HEADERS }
    );
  }
}

export async function POST(request: NextRequest) {
  const authError = requireAdminApi(request);
  if (authError) return authError;

  try {
    const body = (await request.json()) as Partial<AutomationSettings>;
    const updated = await Repository.updateAutomationSettings(body);
    const readiness = await Repository.evaluateExecutionReadiness();
    return NextResponse.json(
      {
        success: true,
        message: 'Automation settings updated',
        automation: updated,
        readiness,
      },
      { headers: NO_STORE_HEADERS }
    );
  } catch (error) {
    const msg = sanitizeErrorMessage(error, 'Failed to update automation settings.');
    const status = /must be|invalid/i.test(msg) ? 400 : 500;
    return NextResponse.json(
      { success: false, error: msg },
      { status, headers: NO_STORE_HEADERS }
    );
  }
}
