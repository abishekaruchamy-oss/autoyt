import { NextRequest, NextResponse } from 'next/server';
import {
  exchangeCodeForTokens,
  saveGoogleCredentials,
} from '@/server/services/googleAuthService';

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

  // Validate CSRF state
  if (!cookieState || cookieState !== state) {
    console.warn('Google OAuth state mismatch');
    if (process.env.NODE_ENV === 'production') {
      return NextResponse.redirect(
        new URL('/settings?error=invalid_csrf_state', request.url)
      );
    }
  }

  const redirectUri = `${request.nextUrl.origin}/api/auth/google/callback`;

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
