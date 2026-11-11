import { NextRequest, NextResponse } from 'next/server';
import crypto from 'crypto';
import { requireAdminApi } from '@/lib/auth';
import { NO_STORE_HEADERS } from '@/lib/security';

export async function GET(request: NextRequest) {
  const authError = requireAdminApi(request, { requireCsrf: false });
  if (authError) return authError;

  const clientId = process.env.META_CLIENT_ID;
  const redirectUri =
    process.env.META_REDIRECT_URI || `${request.nextUrl.origin}/api/auth/instagram/callback`;

  // Generate secure random state token for CSRF protection
  const state = crypto.randomBytes(16).toString('hex');

  if (!clientId || clientId === 'your_meta_app_id_here') {
    return NextResponse.redirect(
      new URL('/accounts?auth_notice=missing_meta_credentials', request.url),
      { headers: NO_STORE_HEADERS }
    );
  }

  const scopes = [
    'instagram_basic',
    'instagram_content_publish',
    'pages_show_list',
    'pages_read_engagement',
    'business_management',
  ].join(',');

  const authUrl = new URL('https://www.facebook.com/v19.0/dialog/oauth');
  authUrl.searchParams.set('client_id', clientId);
  authUrl.searchParams.set('redirect_uri', redirectUri);
  authUrl.searchParams.set('scope', scopes);
  authUrl.searchParams.set('response_type', 'code');
  authUrl.searchParams.set('state', state);

  const response = NextResponse.redirect(authUrl.toString(), { headers: NO_STORE_HEADERS });
  response.cookies.set('ig_oauth_state', state, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: 600,
    path: '/api/auth/instagram',
  });

  return response;
}
