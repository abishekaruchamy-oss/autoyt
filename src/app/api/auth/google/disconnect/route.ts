import { NextRequest, NextResponse } from 'next/server';
import { requireAdminApi } from '@/lib/auth';
import { NO_STORE_HEADERS, sanitizeErrorMessage } from '@/lib/security';
import { disconnectGoogle } from '@/server/services/googleAuthService';

export async function POST(request: NextRequest) {
  const authError = requireAdminApi(request);
  if (authError) return authError;

  try {
    await disconnectGoogle();

    return NextResponse.json(
      {
        success: true,
        message: 'Google account disconnected and remote token revocation attempted.',
      },
      { headers: NO_STORE_HEADERS }
    );
  } catch (error) {
    return NextResponse.json(
      { success: false, error: sanitizeErrorMessage(error, 'Failed to disconnect Google account.') },
      { status: 500, headers: NO_STORE_HEADERS }
    );
  }
}
