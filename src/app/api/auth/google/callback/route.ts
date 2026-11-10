import { NextRequest, NextResponse } from 'next/server';
import {
  exchangeCodeForTokens,
  saveGoogleCredentials,
} from '@/server/services/googleAuthService';
import { Repository } from '@/server/db/repository';

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const code = searchParams.get('code');
  const state = searchParams.get('state');
  const error = searchParams.get('error');

  const cookieState = request.cookies.get('google_oauth_state')?.value;

  if (error) {
    return NextResponse.redirect(
      new URL(`/settings?error=${encodeURIComponent(error)}`, request.url)
    );
  }

  if (!code) {
    return NextResponse.redirect(
      new URL('/settings?error=missing_auth_code', request.url)
    );
  }

  // 1. Validate CSRF state against cookie
  if (!state || !cookieState || cookieState !== state) {
    console.warn('Google OAuth cookie state mismatch or missing');
    return NextResponse.redirect(
      new URL('/settings?error=invalid_csrf_state', request.url)
    );
  }

  // 2. Validate and atomically consume state in durable D1 store (prevents replay attacks)
  const isValidState = await Repository.validateAndConsumeOAuthState(state);
  if (!isValidState) {
    console.warn('Google OAuth durable state expired or already consumed');
    return NextResponse.redirect(
      new URL('/settings?error=expired_or_invalid_oauth_state', request.url)
    );
  }

  const redirectUri = process.env.GOOGLE_REDIRECT_URI || `${request.nextUrl.origin}/api/auth/google/callback`;

  try {
    const tokens = await exchangeCodeForTokens(code, redirectUri);
    const details = await saveGoogleCredentials(tokens);

    const res = NextResponse.redirect(
      new URL(
        `/settings?success=google_connected&account=${encodeURIComponent(details.email)}`,
        request.url
      )
    );
    res.cookies.delete('google_oauth_state');
    return res;
  } catch (err) {
    console.error('Google OAuth callback error:', err);
    return NextResponse.redirect(
      new URL(`/settings?error=${encodeURIComponent((err as Error).message)}`, request.url)
    );
  }
}
