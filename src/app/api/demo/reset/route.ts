import { NextRequest, NextResponse } from 'next/server';
import { requireAdminApi } from '@/lib/auth';
import { NO_STORE_HEADERS, sanitizeErrorMessage } from '@/lib/security';
import { Repository } from '@/server/db/repository';

export async function POST(request: NextRequest) {
  const authError = requireAdminApi(request);
  if (authError) return authError;

  if (process.env.NODE_ENV === 'production') {
    return NextResponse.json(
      { success: false, error: 'Demo reset is disabled in production.' },
      { status: 403, headers: NO_STORE_HEADERS }
    );
  }

  try {
    Repository.resetDemo();
    return NextResponse.json(
      {
        success: true,
        message: 'Demo state reset to original sample dataset',
      },
      { headers: NO_STORE_HEADERS }
    );
  } catch (error) {
    return NextResponse.json(
      { success: false, error: sanitizeErrorMessage(error, 'Demo reset failed.') },
      { status: 500, headers: NO_STORE_HEADERS }
    );
  }
}
