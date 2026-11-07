import { NextRequest, NextResponse } from 'next/server';
import { getGoogleAuthUrl } from '@/server/services/googleAuthService';

export async function GET(request: NextRequest) {
  const redirectUri = `${request.nextUrl.origin}/api/auth/google/callback`;

  try {
    const { url, state } = getGoogleAuthUrl(redirectUri);

    const response = NextResponse.redirect(url);
    response.cookies.set('google_oauth_state', state, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 600, // 10 minutes
      path: '/',
    });

    return response;
  } catch (error) {
    console.warn('Google OAuth initiation failed:', (error as Error).message);
    return NextResponse.redirect(
      new URL('/settings?auth_notice=missing_google_credentials', request.url)
    );
  }
}
