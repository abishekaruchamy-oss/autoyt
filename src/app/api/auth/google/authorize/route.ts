import { NextRequest, NextResponse } from 'next/server';
import {
  appendOAuthStateCookie,
  authorizeAdminRequest,
  signOAuthStateCookieValue,
} from '@/lib/auth';
import { NO_STORE_HEADERS, sanitizeErrorMessage } from '@/lib/security';
import { Repository } from '@/server/db/repository';
import { getGoogleAuthUrl } from '@/server/services/googleAuthService';

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

  const redirectUri =
    process.env.GOOGLE_REDIRECT_URI || `${request.nextUrl.origin}/api/auth/google/callback`;

  try {
    const { url, state } = getGoogleAuthUrl(redirectUri);

    // Persist OAuth CSRF state in durable repository (D1 / DataStore)
    await Repository.saveOAuthState(state, redirectUri);

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
