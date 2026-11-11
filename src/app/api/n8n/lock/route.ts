import { NextRequest, NextResponse } from 'next/server';
import { requireWebhookOrAdminApi } from '@/lib/auth';
import { NO_STORE_HEADERS, sanitizeErrorMessage } from '@/lib/security';
import { Repository } from '@/server/db/repository';

export async function POST(request: NextRequest) {
  const authError = requireWebhookOrAdminApi(request);
  if (authError) return authError;

  try {
    const locked = await Repository.acquireAutomationLock();
    if (!locked) {
      return NextResponse.json(
        {
          success: false,
          locked: false,
          message: 'Execution lock already held. Skipping overlapping run.',
        },
        { status: 409, headers: NO_STORE_HEADERS }
      );
    }

    return NextResponse.json(
      {
        success: true,
        locked: true,
        message: 'Execution lock acquired successfully.',
      },
      { headers: NO_STORE_HEADERS }
    );
  } catch (error) {
    return NextResponse.json(
      { success: false, error: sanitizeErrorMessage(error, 'Failed to acquire execution lock.') },
      { status: 500, headers: NO_STORE_HEADERS }
    );
  }
}
