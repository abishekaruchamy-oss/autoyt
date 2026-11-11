import { NextRequest, NextResponse } from 'next/server';
import {
  appendClearOAuthStateCookie,
  authorizeAdminRequest,
  OAUTH_STATE_COOKIE_NAME,
  parseCookiesFromRequest,
  verifyOAuthStateCookieValue,
} from '@/lib/auth';
import { NO_STORE_HEADERS, sanitizeErrorMessage } from '@/lib/security';
import { Repository } from '@/server/db/repository';
import {
  exchangeCodeForTokens,
  saveGoogleCredentials,
} from '@/server/services/googleAuthService';

export async function GET(request: NextRequest) {
  const redirectWithClearedState = (target: string) => {
    const response = NextResponse.redirect(new URL(target, request.url), {
      headers: NO_STORE_HEADERS,
    });
    appendClearOAuthStateCookie(response.headers, request);
    return response;
  };

  // Preserve Google top-level GET redirect via SameSite=Lax cookies while enforcing
  // active operator session + double-submit OAuth state cookie + single-use D1 state.
  const auth = authorizeAdminRequest(request, { requireCsrf: false });
  if (!auth.ok) {
    const errorCode = auth.status === 503 ? 'auth_not_configured' : 'unauthorized';
    return redirectWithClearedState(`/settings?error=${errorCode}`);
  }

  const { searchParams } = new URL(request.url);
  const code = searchParams.get('code');
  const state = searchParams.get('state');
  const error = searchParams.get('error');

  if (error) {
    const safeError = sanitizeErrorMessage(error, 'oauth_error');
    return redirectWithClearedState(`/settings?error=${encodeURIComponent(safeError)}`);
  }

  if (!code) {
    return redirectWithClearedState('/settings?error=missing_auth_code');
  }

  const cookies = parseCookiesFromRequest(request);
  const cookieState = cookies[OAUTH_STATE_COOKIE_NAME];

  // 1. Validate session-bound CSRF state cookie
  if (!verifyOAuthStateCookieValue(cookieState, state, auth.session.jti)) {
    console.warn('Google OAuth cookie state mismatch or missing');
    return redirectWithClearedState('/settings?error=invalid_csrf_state');
  }

  // 2. Validate and atomically consume state in durable D1 store (prevents replay attacks)
  const isValidState = state ? await Repository.validateAndConsumeOAuthState(state) : false;
  if (!isValidState) {
    console.warn('Google OAuth durable state expired or already consumed');
    return redirectWithClearedState('/settings?error=expired_or_invalid_oauth_state');
  }

  const redirectUri =
    process.env.GOOGLE_REDIRECT_URI || `${request.nextUrl.origin}/api/auth/google/callback`;

  try {
    const tokens = await exchangeCodeForTokens(code, redirectUri);
    const details = await saveGoogleCredentials(tokens);

    return redirectWithClearedState(
      `/settings?success=google_connected&account=${encodeURIComponent(details.email)}`
    );
  } catch (err) {
    const safeError = sanitizeErrorMessage(err, 'Google OAuth callback failed.');
    console.error('Google OAuth callback error:', safeError);
    return redirectWithClearedState(`/settings?error=${encodeURIComponent(safeError)}`);
  }
}
