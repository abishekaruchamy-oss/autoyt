import { NextRequest, NextResponse } from 'next/server';
import { requireAdminApi } from '@/lib/auth';
import { NO_STORE_HEADERS, sanitizeErrorMessage } from '@/lib/security';
import { disconnectGoogleService } from '@/server/services/googleAuthService';

export async function POST(request: NextRequest) {
  const authError = requireAdminApi(request);
  if (authError) return authError;

  try {
    await disconnectGoogleService('youtube');

    return NextResponse.json(
      {
        success: true,
        message: 'YouTube channel disconnected.',
      },
      { headers: NO_STORE_HEADERS }
    );
  } catch (error) {
    return NextResponse.json(
      { success: false, error: sanitizeErrorMessage(error, 'Failed to disconnect YouTube channel.') },
      { status: 500, headers: NO_STORE_HEADERS }
    );
  }
}
