import { NextRequest, NextResponse } from 'next/server';
import { requireAdminApi } from '@/lib/auth';
import { NO_STORE_HEADERS, sanitizeAccountForApi, sanitizeErrorMessage } from '@/lib/security';
import { Repository } from '@/server/db/repository';

export async function GET(request: NextRequest) {
  const authError = requireAdminApi(request);
  if (authError) return authError;

  try {
    const metrics = await Repository.getDashboardMetrics();
    return NextResponse.json(
      {
        success: true,
        metrics: {
          ...metrics,
          active_account: metrics.active_account
            ? sanitizeAccountForApi(metrics.active_account)
            : null,
        },
      },
      { headers: NO_STORE_HEADERS }
    );
  } catch (error) {
    return NextResponse.json(
      { success: false, error: sanitizeErrorMessage(error, 'Failed to load dashboard metrics.') },
      { status: 500, headers: NO_STORE_HEADERS }
    );
  }
}
