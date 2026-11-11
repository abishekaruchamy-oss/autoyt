import { NextRequest, NextResponse } from 'next/server';
import { requireAdminApi } from '@/lib/auth';
import { NO_STORE_HEADERS, sanitizeAccountForApi, sanitizeErrorMessage } from '@/lib/security';
import { Repository } from '@/server/db/repository';
import { AutomationSettings } from '@/types';

export async function GET(request: NextRequest) {
  const authError = requireAdminApi(request);
  if (authError) return authError;

  try {
    const automation = await Repository.getAutomationSettings();
    const activeAccount = await Repository.getActiveAccount();
    return NextResponse.json(
      {
        success: true,
        automation,
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
    return NextResponse.json(
      {
        success: true,
        message: 'Automation settings updated',
        automation: updated,
      },
      { headers: NO_STORE_HEADERS }
    );
  } catch (error) {
    return NextResponse.json(
      { success: false, error: sanitizeErrorMessage(error, 'Failed to update automation settings.') },
      { status: 500, headers: NO_STORE_HEADERS }
    );
  }
}
