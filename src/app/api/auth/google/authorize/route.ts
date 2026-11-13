import { NextRequest, NextResponse } from 'next/server';
import {
  appendOAuthStateCookie,
  authorizeAdminRequest,
  signOAuthStateCookieValue,
} from '@/lib/auth';
import { NO_STORE_HEADERS, sanitizeErrorMessage } from '@/lib/security';
import { Repository } from '@/server/db/repository';
import { generateGoogleAuthUrl } from '@/server/services/googleAuthService';
import { GoogleOAuthService } from '@/types';

export async function GET(request: NextRequest) {
  const auth = authorizeAdminRequest(request, { requireCsrf: false });
  if (!auth.ok) {
    const prefersHtml = request.headers.get('accept')?.includes('text/html');
    if (prefersHtml && auth.status === 401) {
      return NextResponse.redirect(
        new URL('/login?next=%2Fsettings&error=session_required', request.url),
        { headers: NO_STORE_HEADERS }
      );
    }
    return NextResponse.json(
      { success: false, error: auth.error },
      { status: auth.status, headers: NO_STORE_HEADERS }
    );
  }

  const { searchParams } = new URL(request.url);
  const serviceParam = searchParams.get('service')?.toLowerCase();
  const service: GoogleOAuthService = serviceParam === 'youtube' ? 'youtube' : 'drive';
  const provider = service === 'youtube' ? 'google_youtube' : 'google_drive';

  const redirectUri =
    process.env.GOOGLE_REDIRECT_URI || `${request.nextUrl.origin}/api/auth/google/callback`;

  try {
    const { url, state } = generateGoogleAuthUrl(service, redirectUri);

    // Persist OAuth CSRF state in durable repository (D1 / DataStore) with service tag
    await Repository.saveOAuthState(state, redirectUri, 600000, provider);

    const signedCookieState = signOAuthStateCookieValue(state, auth.session.jti);
    const response = NextResponse.redirect(url, { headers: NO_STORE_HEADERS });
    appendOAuthStateCookie(response.headers, signedCookieState, request);

    return response;
  } catch (error) {
    console.warn('Google OAuth initiation failed:', sanitizeErrorMessage(error));
    return NextResponse.redirect(
      new URL('/settings?auth_notice=missing_google_credentials', request.url),
      { headers: NO_STORE_HEADERS }
    );
  }
}
