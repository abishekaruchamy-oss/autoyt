import { NextRequest, NextResponse } from 'next/server';
import { requireWebhookOrAdminApi } from '@/lib/auth';
import { NO_STORE_HEADERS, sanitizeErrorMessage } from '@/lib/security';
import { Repository } from '@/server/db/repository';

export async function POST(request: NextRequest) {
  const authError = requireWebhookOrAdminApi(request);
  if (authError) return authError;

  try {
    let success = true;
    try {
      const body = (await request.json()) as { success?: boolean };
      if (typeof body.success === 'boolean') {
        success = body.success;
      }
    } catch {
      // Optional body
    }

    await Repository.releaseAutomationLock(success);

    return NextResponse.json(
      {
        success: true,
        message: 'Execution lock released successfully.',
      },
      { headers: NO_STORE_HEADERS }
    );
  } catch (error) {
    return NextResponse.json(
      { success: false, error: sanitizeErrorMessage(error, 'Failed to release execution lock.') },
      { status: 500, headers: NO_STORE_HEADERS }
    );
  }
}
