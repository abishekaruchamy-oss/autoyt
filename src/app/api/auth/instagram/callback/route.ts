import { NextRequest, NextResponse } from 'next/server';
import { Repository } from '@/server/db/repository';

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const code = searchParams.get('code');
  const state = searchParams.get('state');
  const error = searchParams.get('error');
  const errorDescription = searchParams.get('error_description');

  const cookieState = request.cookies.get('ig_oauth_state')?.value;

  if (error) {
    return NextResponse.redirect(
      new URL(
        `/accounts?error=${encodeURIComponent(errorDescription || error)}`,
        request.url
      )
    );
  }

  if (!code) {
    return NextResponse.redirect(
      new URL('/accounts?error=missing_code', request.url)
    );
  }

  // Validate CSRF state
  if (!cookieState || cookieState !== state) {
    console.warn('OAuth state mismatch during Instagram callback');
    // In production we enforce state match; in local development we tolerate if cookie was lost
    if (process.env.NODE_ENV === 'production') {
      return NextResponse.redirect(
        new URL('/accounts?error=invalid_csrf_state', request.url)
      );
    }
  }

  const clientId = process.env.META_CLIENT_ID;
  const clientSecret = process.env.META_CLIENT_SECRET;
  const redirectUri =
    process.env.META_REDIRECT_URI || `${request.nextUrl.origin}/api/auth/instagram/callback`;

  try {
    // 1. Exchange code for short-lived access token
    const tokenUrl = new URL('https://graph.facebook.com/v19.0/oauth/access_token');
    tokenUrl.searchParams.set('client_id', clientId || '');
    tokenUrl.searchParams.set('client_secret', clientSecret || '');
    tokenUrl.searchParams.set('redirect_uri', redirectUri);
    tokenUrl.searchParams.set('code', code);

    const tokenRes = await fetch(tokenUrl.toString());
    const tokenData = await tokenRes.json();

    if (!tokenRes.ok || tokenData.error) {
      throw new Error(tokenData.error?.message || 'Token exchange failed');
    }

    const shortLivedToken = tokenData.access_token;

    // 2. Exchange short-lived token for long-lived token (60-day expiry)
    const longLivedUrl = new URL('https://graph.facebook.com/v19.0/oauth/access_token');
    longLivedUrl.searchParams.set('grant_type', 'fb_exchange_token');
    longLivedUrl.searchParams.set('client_id', clientId || '');
    longLivedUrl.searchParams.set('client_secret', clientSecret || '');
    longLivedUrl.searchParams.set('fb_exchange_token', shortLivedToken);

    const longLivedRes = await fetch(longLivedUrl.toString());
    const longLivedData = await longLivedRes.json();

    const finalToken = longLivedData.access_token || shortLivedToken;
    const expiresInSeconds = longLivedData.expires_in || 60 * 24 * 60 * 60;

    // 3. Fetch connected Instagram Creator accounts
    const meRes = await fetch(
      `https://graph.facebook.com/v19.0/me/accounts?fields=instagram_business_account{id,username,name,profile_picture_url}&access_token=${finalToken}`
    );
    const meData = await meRes.json();

    const igAccount = meData.data?.[0]?.instagram_business_account;
    if (!igAccount) {
      throw new Error('No Instagram Business/Creator account found linked to this Meta login');
    }

    // 4. Save to database with AES-256-GCM encryption
    await Repository.createAccount({
      instagram_user_id: igAccount.id,
      username: igAccount.username,
      name: igAccount.name || igAccount.username,
      profile_picture_url:
        igAccount.profile_picture_url ||
        'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=150',
      raw_token: finalToken,
      expires_in_seconds: expiresInSeconds,
    });

    const response = NextResponse.redirect(
      new URL('/accounts?success=connected', request.url)
    );
    response.cookies.delete('ig_oauth_state');
    return response;
  } catch (err) {
    console.error('Error during Instagram OAuth callback:', err);
    return NextResponse.redirect(
      new URL(
        `/accounts?error=${encodeURIComponent((err as Error).message)}`,
        request.url
      )
    );
  }
}
