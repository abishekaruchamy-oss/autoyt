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
  fetchGoogleUserProfile,
  fetchYouTubeChannelDetails,
  saveGoogleServiceCredentials,
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
  const stateRecord = state ? await Repository.consumeOAuthStateRecord(state) : null;
  if (!stateRecord || !stateRecord.valid) {
    console.warn('Google OAuth durable state expired or already consumed');
    return redirectWithClearedState('/settings?error=expired_or_invalid_oauth_state');
  }

  const redirectUri =
    process.env.GOOGLE_REDIRECT_URI || `${request.nextUrl.origin}/api/auth/google/callback`;

  // Determine service strictly from validated durable state
  const isYouTube = stateRecord.provider === 'google_youtube';

  try {
    const tokens = await exchangeCodeForTokens(code, redirectUri);

    if (isYouTube) {
      // YouTube OAuth Flow: Retrieve channel details using the YouTube token
      const channelProfile = await fetchYouTubeChannelDetails(tokens.access_token);

      if (!channelProfile.youtubeChannel?.id) {
        console.warn('No YouTube channel found on authorized Google account.');
        await saveGoogleServiceCredentials('youtube', tokens, {
          email: channelProfile.email,
        });
        return redirectWithClearedState(
          `/settings?warning=youtube_channel_not_found&account=${encodeURIComponent(channelProfile.email)}`
        );
      }

      await saveGoogleServiceCredentials('youtube', tokens, {
        email: channelProfile.email,
        channelId: channelProfile.youtubeChannel.id,
        channelTitle: channelProfile.youtubeChannel.title,
      });

      return redirectWithClearedState(
        `/settings?success=youtube_connected&account=${encodeURIComponent(
          channelProfile.youtubeChannel.title || channelProfile.email
        )}`
      );
    } else {
      // Google Drive OAuth Flow: Retrieve Google account identity only without YouTube calls
      const userProfile = await fetchGoogleUserProfile(tokens.access_token);
      await saveGoogleServiceCredentials('drive', tokens, {
        email: userProfile.email,
      });

      return redirectWithClearedState(
        `/settings?success=google_drive_connected&account=${encodeURIComponent(userProfile.email)}`
      );
    }
  } catch (err) {
    const safeError = sanitizeErrorMessage(err, 'Google OAuth callback failed.');
    console.error('Google OAuth callback error:', safeError);
    return redirectWithClearedState(`/settings?error=${encodeURIComponent(safeError)}`);
  }
}
