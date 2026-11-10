import crypto from 'node:crypto';
import { encryptToken, decryptToken } from '@/lib/crypto';
import { Repository } from '../db/repository';

export interface GoogleTokens {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
  token_type: string;
  scope: string;
  obtained_at: number;
}

export interface GoogleAccountDetails {
  email: string;
  name: string;
  picture?: string;
  youtubeChannel?: {
    id: string;
    title: string;
    customUrl?: string;
    subscriberCount?: string;
    thumbnailUrl?: string;
  };
}

const GOOGLE_SCOPES = [
  'https://www.googleapis.com/auth/drive.file',
  'https://www.googleapis.com/auth/youtube.upload',
  'https://www.googleapis.com/auth/youtube.readonly',
  'https://www.googleapis.com/auth/userinfo.email',
  'https://www.googleapis.com/auth/userinfo.profile',
].join(' ');

/**
 * Generates the Google OAuth 2.0 authorization URL
 */
export function getGoogleAuthUrl(redirectUri: string): { url: string; state: string } {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  if (!clientId) {
    throw new Error('GOOGLE_CLIENT_ID is not configured in environment variables.');
  }

  const state = crypto.randomBytes(16).toString('hex');
  const authUrl = new URL('https://accounts.google.com/o/oauth2/v2/auth');
  authUrl.searchParams.set('client_id', clientId);
  authUrl.searchParams.set('redirect_uri', redirectUri);
  authUrl.searchParams.set('response_type', 'code');
  authUrl.searchParams.set('scope', GOOGLE_SCOPES);
  authUrl.searchParams.set('access_type', 'offline'); // Requests refresh_token
  authUrl.searchParams.set('prompt', 'consent'); // Forces consent to guarantee refresh_token
  authUrl.searchParams.set('include_granted_scopes', 'true');
  authUrl.searchParams.set('state', state);

  return { url: authUrl.toString(), state };
}

/**
 * Exchanges authorization code for access and refresh tokens
 */
export async function exchangeCodeForTokens(
  code: string,
  redirectUri: string
): Promise<GoogleTokens> {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    throw new Error('Google OAuth credentials (CLIENT_ID / CLIENT_SECRET) are missing.');
  }

  const tokenUrl = 'https://oauth2.googleapis.com/token';
  const body = new URLSearchParams({
    code,
    client_id: clientId,
    client_secret: clientSecret,
    redirect_uri: redirectUri,
    grant_type: 'authorization_code',
  });

  const res = await fetch(tokenUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });

  const data = await res.json();
  if (!res.ok || data.error) {
    throw new Error(data.error_description || data.error || 'Failed to exchange Google OAuth code.');
  }

  return {
    access_token: data.access_token,
    refresh_token: data.refresh_token,
    expires_in: data.expires_in,
    token_type: data.token_type,
    scope: data.scope,
    obtained_at: Date.now(),
  };
}

/**
 * Refreshes an expired access token using the stored encrypted refresh token
 */
export async function refreshAccessToken(refreshTokenEncrypted: string): Promise<string> {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    throw new Error('Google OAuth credentials missing.');
  }

  const refreshToken = decryptToken(refreshTokenEncrypted);
  const tokenUrl = 'https://oauth2.googleapis.com/token';

  const body = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    refresh_token: refreshToken,
    grant_type: 'refresh_token',
  });

  const res = await fetch(tokenUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });

  const data = await res.json();
  if (!res.ok || data.error) {
    throw new Error(data.error_description || data.error || 'Failed to refresh Google access token.');
  }

  return data.access_token;
}

/**
 * Fetches user profile info and primary YouTube channel details
 */
export async function fetchGoogleAccountDetails(accessToken: string): Promise<GoogleAccountDetails> {
  // 1. Fetch User Info
  const userRes = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const userData = await userRes.json();

  let details: GoogleAccountDetails = {
    email: userData.email || 'unknown@gmail.com',
    name: userData.name || 'Google User',
    picture: userData.picture,
  };

  // 2. Fetch YouTube Channel
  try {
    const ytRes = await fetch(
      'https://www.googleapis.com/youtube/v3/channels?part=snippet,statistics&mine=true',
      {
        headers: { Authorization: `Bearer ${accessToken}` },
      }
    );
    const ytData = await ytRes.json();
    if (ytData.items && ytData.items.length > 0) {
      const ch = ytData.items[0];
      details.youtubeChannel = {
        id: ch.id,
        title: ch.snippet.title,
        customUrl: ch.snippet.customUrl,
        subscriberCount: ch.statistics?.subscriberCount,
        thumbnailUrl: ch.snippet.thumbnails?.default?.url,
      };
    }
  } catch (err) {
    console.warn('Could not retrieve YouTube channel info:', (err as Error).message);
  }

  return details;
}

/**
 * Saves Google credentials and updates integration state
 */
export async function saveGoogleCredentials(tokens: GoogleTokens): Promise<GoogleAccountDetails> {
  const details = await fetchGoogleAccountDetails(tokens.access_token);

  // Encrypt sensitive tokens at rest
  const encryptedAccess = encryptToken(tokens.access_token);
  const encryptedRefresh = tokens.refresh_token ? encryptToken(tokens.refresh_token) : undefined;
  const expiresAt = Date.now() + (tokens.expires_in || 3600) * 1000;

  // Persist encrypted credentials in Repository
  await Repository.saveGoogleCredentials({
    encryptedAccessToken: encryptedAccess,
    encryptedRefreshToken: encryptedRefresh,
    expiresAt,
    email: details.email,
    channelId: details.youtubeChannel?.id,
    channelTitle: details.youtubeChannel?.title,
    updatedAt: new Date().toISOString(),
  });

  // Log activity
  await Repository.logActivity(
    'SETTINGS_UPDATED',
    `Google account (${details.email}) authorized for Google Drive & YouTube Shorts`,
    undefined,
    {
      email: details.email,
      youtubeChannel: details.youtubeChannel?.title,
      hasRefreshToken: !!tokens.refresh_token,
    }
  );

  return details;
}

/**
 * Retrieves a valid, unexpired Google access token, automatically refreshing if needed
 */
export async function getValidAccessToken(): Promise<string> {
  const creds = await Repository.getGoogleCredentials();
  if (creds) {
    const isExpiring = Date.now() > creds.expiresAt - 5 * 60 * 1000; // 5 min buffer
    if (!isExpiring) {
      return decryptToken(creds.encryptedAccessToken);
    }

    // Refresh token if available
    if (creds.encryptedRefreshToken) {
      try {
        const freshToken = await refreshAccessToken(creds.encryptedRefreshToken);
        creds.encryptedAccessToken = encryptToken(freshToken);
        creds.expiresAt = Date.now() + 3500 * 1000;
        await Repository.saveGoogleCredentials(creds);
        return freshToken;
      } catch (err) {
        console.warn('Failed to refresh stored Google token:', (err as Error).message);
      }
    }
    return decryptToken(creds.encryptedAccessToken);
  }

  // Environment variable fallback (for CI / testing / serverless env)
  if (process.env.GOOGLE_ACCESS_TOKEN) {
    return process.env.GOOGLE_ACCESS_TOKEN;
  }

  throw new Error('Google account is not connected. Please authorize via Settings > Integrations.');
}

/**
 * Checks if a Google account is currently connected
 */
export async function isGoogleConnected(): Promise<boolean> {
  const creds = await Repository.getGoogleCredentials();
  return !!(creds || process.env.GOOGLE_ACCESS_TOKEN);
}

/**
 * Disconnects the Google integration
 */
export async function disconnectGoogle(): Promise<void> {
  await Repository.clearGoogleCredentials();
  await Repository.logActivity(
    'SETTINGS_UPDATED',
    'Google account disconnected from Google Drive and YouTube Shorts'
  );
}
