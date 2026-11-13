import { NextRequest, NextResponse } from 'next/server';
import { requireAdminApi } from '@/lib/auth';
import { NO_STORE_HEADERS, sanitizeErrorMessage } from '@/lib/security';
import { disconnectGoogle, disconnectGoogleService } from '@/server/services/googleAuthService';
import { GoogleOAuthService } from '@/types';

export async function POST(request: NextRequest) {
  const authError = requireAdminApi(request);
  if (authError) return authError;

  const { searchParams } = new URL(request.url);
  let service: GoogleOAuthService | undefined = undefined;

  const serviceQuery = searchParams.get('service')?.toLowerCase();
  if (serviceQuery === 'drive' || serviceQuery === 'youtube') {
    service = serviceQuery;
  } else {
    try {
      const body = (await request.json()) as { service?: string };
      if (body.service === 'drive' || body.service === 'youtube') {
        service = body.service;
      }
    } catch {
      // Body empty or not JSON, disconnect both
    }
  }

  try {
    if (service) {
      await disconnectGoogleService(service);
      return NextResponse.json(
        {
          success: true,
          message: `Google ${service === 'drive' ? 'Drive' : 'YouTube'} disconnected.`,
        },
        { headers: NO_STORE_HEADERS }
      );
    }

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
