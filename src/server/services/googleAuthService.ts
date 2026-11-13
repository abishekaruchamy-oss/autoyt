import crypto from 'node:crypto';
import { encryptToken, decryptToken } from '@/lib/crypto';
import { sanitizeErrorMessage } from '@/lib/security';
import { Repository } from '../db/repository';
import { GoogleOAuthService, StoredGoogleServiceCredentials } from '@/types';

export interface GoogleTokens {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
  token_type: string;
  scope: string;
  obtained_at: number;
}

export interface RefreshedGoogleTokens {
  accessToken: string;
  expiresIn: number;
  refreshToken?: string;
}

export interface GoogleUserProfile {
  email: string;
  name: string;
  picture?: string;
}

export interface YouTubeChannelProfile {
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

/**
 * Independent Scopes for Google Drive and YouTube
 * Do not include Drive scopes in YouTube requests or YouTube scopes in Drive requests.
 */
export const GOOGLE_DRIVE_SCOPES = [
  'https://www.googleapis.com/auth/drive.file',
  'https://www.googleapis.com/auth/userinfo.email',
  'https://www.googleapis.com/auth/userinfo.profile',
].join(' ');

export const YOUTUBE_SCOPES = [
  'https://www.googleapis.com/auth/youtube.upload',
  'https://www.googleapis.com/auth/youtube.readonly',
  'https://www.googleapis.com/auth/userinfo.email',
  'https://www.googleapis.com/auth/userinfo.profile',
].join(' ');

// Backward-compatible scope alias (deprecated, prefer GOOGLE_DRIVE_SCOPES or YOUTUBE_SCOPES)
export const GOOGLE_SCOPES = GOOGLE_DRIVE_SCOPES;

/**
 * Generates an independent Google OAuth 2.0 authorization URL for a specific service.
 * OMTTS include_granted_scopes to prevent cross-service scope bundling rejection.
 */
export function generateGoogleAuthUrl(
  service: GoogleOAuthService,
  redirectUri: string
): { url: string; state: string } {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  if (!clientId) {
    throw new Error('GOOGLE_CLIENT_ID is not configured in environment variables.');
  }

  const state = crypto.randomBytes(16).toString('hex');
  const authUrl = new URL('https://accounts.google.com/o/oauth2/v2/auth');
  authUrl.searchParams.set('client_id', clientId);
  authUrl.searchParams.set('redirect_uri', redirectUri);
  authUrl.searchParams.set('response_type', 'code');
  authUrl.searchParams.set(
    'scope',
    service === 'youtube' ? YOUTUBE_SCOPES : GOOGLE_DRIVE_SCOPES
  );
  authUrl.searchParams.set('access_type', 'offline'); // Requests refresh_token
  authUrl.searchParams.set('prompt', 'consent'); // Forces consent to guarantee refresh_token
  // Do NOT set include_granted_scopes to avoid merging unrelated previously granted scopes
  authUrl.searchParams.set('state', state);

  return { url: authUrl.toString(), state };
}

export function getGoogleDriveAuthUrl(redirectUri: string): { url: string; state: string } {
  return generateGoogleAuthUrl('drive', redirectUri);
}

export function getYouTubeAuthUrl(redirectUri: string): { url: string; state: string } {
  return generateGoogleAuthUrl('youtube', redirectUri);
}

/**
 * Backward-compatible wrapper for generating Google authorization URL.
 */
export function getGoogleAuthUrl(
  first: GoogleOAuthService | string,
  second?: GoogleOAuthService | string
): { url: string; state: string } {
  if (first === 'youtube' || first === 'drive') {
    return generateGoogleAuthUrl(first, typeof second === 'string' ? second : '');
  }
  if (second === 'youtube' || second === 'drive') {
    return generateGoogleAuthUrl(second, typeof first === 'string' ? first : '');
  }
  return generateGoogleAuthUrl('drive', typeof first === 'string' ? first : '');
}

/**
 * Exchanges authorization code for access and refresh tokens.
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

  const data = (await res.json()) as {
    access_token: string;
    refresh_token?: string;
    expires_in: number;
    token_type: string;
    scope: string;
    error?: string;
    error_description?: string;
  };
  if (!res.ok || data.error) {
    throw new Error(
      sanitizeErrorMessage(
        data.error_description || data.error,
        'Failed to exchange Google OAuth code.'
      )
    );
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
 * Refreshes an expired access token using the stored encrypted refresh token.
 */
export async function refreshGoogleTokens(
  refreshTokenEncrypted: string
): Promise<RefreshedGoogleTokens> {
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

  const data = (await res.json()) as {
    access_token?: string;
    expires_in?: number;
    refresh_token?: string;
    error?: string;
    error_description?: string;
  };
  if (!res.ok || data.error || !data.access_token) {
    throw new Error(
      sanitizeErrorMessage(
        data.error_description || data.error,
        'Failed to refresh Google access token.'
      )
    );
  }

  const expiresIn =
    typeof data.expires_in === 'number' && Number.isFinite(data.expires_in) && data.expires_in > 0
      ? data.expires_in
      : 3600;

  return {
    accessToken: data.access_token,
    expiresIn,
    refreshToken:
      typeof data.refresh_token === 'string' && data.refresh_token.length > 0
        ? data.refresh_token
        : undefined,
  };
}

/**
 * Backward-compatible wrapper returning only the refreshed access token string.
 */
export async function refreshAccessToken(refreshTokenEncrypted: string): Promise<string> {
  const refreshed = await refreshGoogleTokens(refreshTokenEncrypted);
  return refreshed.accessToken;
}

/**
 * Fetches Google user profile (email and name) using userinfo endpoint.
 * Safe to call with either Drive-only or YouTube-only tokens.
 */
export async function fetchGoogleUserProfile(accessToken: string): Promise<GoogleUserProfile> {
  const userRes = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!userRes.ok) {
    throw new Error('Failed to fetch Google user profile. Reauthorization may be required.');
  }
  const userData = (await userRes.json()) as {
    email?: string;
    name?: string;
    picture?: string;
  };

  return {
    email: userData.email || 'unknown@gmail.com',
    name: userData.name || 'Google User',
    picture: userData.picture,
  };
}

/**
 * Fetches YouTube channel info using the YouTube Data API.
 * MUST only be called with a token authorized for YouTube scopes.
 */
export async function fetchYouTubeChannelDetails(accessToken: string): Promise<YouTubeChannelProfile> {
  const user = await fetchGoogleUserProfile(accessToken);
  const profile: YouTubeChannelProfile = {
    email: user.email,
    name: user.name,
    picture: user.picture,
  };

  try {
    const ytRes = await fetch(
      'https://www.googleapis.com/youtube/v3/channels?part=snippet,statistics&mine=true',
      {
        headers: { Authorization: `Bearer ${accessToken}` },
      }
    );
    if (!ytRes.ok) {
      console.warn(`YouTube channel fetch returned HTTP ${ytRes.status}`);
      return profile;
    }

    const ytData = (await ytRes.json()) as {
      items?: Array<{
        id: string;
        snippet: {
          title: string;
          customUrl?: string;
          thumbnails?: { default?: { url?: string } };
        };
        statistics?: {
          subscriberCount?: string;
        };
      }>;
    };

    if (ytData.items && ytData.items.length > 0) {
      const ch = ytData.items[0];
      profile.youtubeChannel = {
        id: ch.id,
        title: ch.snippet.title,
        customUrl: ch.snippet.customUrl,
        subscriberCount: ch.statistics?.subscriberCount,
        thumbnailUrl: ch.snippet.thumbnails?.default?.url,
      };
    }
  } catch (err) {
    console.warn('Could not retrieve YouTube channel info:', sanitizeErrorMessage(err));
  }

  return profile;
}

/**
 * Backward-compatible account fetcher.
 */
export async function fetchGoogleAccountDetails(accessToken: string): Promise<GoogleAccountDetails> {
  return fetchYouTubeChannelDetails(accessToken);
}

/**
 * Saves separate Google service credentials (drive or youtube).
 */
export async function saveGoogleServiceCredentials(
  service: GoogleOAuthService,
  tokens: GoogleTokens,
  details: {
    email: string;
    channelId?: string;
    channelTitle?: string;
  }
): Promise<{ email: string; channelId?: string; channelTitle?: string }> {
  const encryptedAccess = encryptToken(tokens.access_token);
  const existing = tokens.refresh_token
    ? null
    : await Repository.getGoogleServiceCredentials(service);
  const encryptedRefresh = tokens.refresh_token
    ? encryptToken(tokens.refresh_token)
    : existing?.encryptedRefreshToken;
  const expiresAt = Date.now() + (tokens.expires_in || 3600) * 1000;

  const credsRecord: StoredGoogleServiceCredentials = {
    service,
    encryptedAccessToken: encryptedAccess,
    encryptedRefreshToken: encryptedRefresh,
    expiresAt,
    email: details.email,
    channelId: details.channelId,
    channelTitle: details.channelTitle,
    scope: tokens.scope,
    updatedAt: new Date().toISOString(),
  };

  await Repository.saveGoogleServiceCredentials(credsRecord);

  await Repository.logActivity(
    'SETTINGS_UPDATED',
    `Google ${service === 'drive' ? 'Drive' : 'YouTube'} account (${details.email}) authorized`,
    undefined,
    {
      service,
      email: details.email,
      channel: details.channelTitle,
      hasRefreshToken: !!tokens.refresh_token,
      scope: tokens.scope,
    }
  );

  return details;
}

/**
 * Backward-compatible credential saver.
 */
export async function saveGoogleCredentials(tokens: GoogleTokens): Promise<GoogleAccountDetails> {
  const details = await fetchGoogleAccountDetails(tokens.access_token);

  await saveGoogleServiceCredentials('drive', tokens, {
    email: details.email,
  });

  if (details.youtubeChannel?.id) {
    await saveGoogleServiceCredentials('youtube', tokens, {
      email: details.email,
      channelId: details.youtubeChannel.id,
      channelTitle: details.youtubeChannel.title,
    });
  }

  return details;
}

/**
 * Retrieves a valid Google Drive access token, automatically refreshing if needed.
 */
export async function getValidDriveAccessToken(): Promise<string> {
  const creds = await Repository.getGoogleServiceCredentials('drive');
  if (creds) {
    const EXPIRY_BUFFER_MS = 5 * 60 * 1000;
    const isExpiring = Date.now() > creds.expiresAt - EXPIRY_BUFFER_MS;
    if (!isExpiring) {
      return decryptToken(creds.encryptedAccessToken);
    }

    if (creds.encryptedRefreshToken) {
      try {
        const refreshed = await refreshGoogleTokens(creds.encryptedRefreshToken);
        const encryptedRefreshToken = refreshed.refreshToken
          ? encryptToken(refreshed.refreshToken)
          : creds.encryptedRefreshToken;

        await Repository.saveGoogleServiceCredentials({
          ...creds,
          service: 'drive',
          encryptedAccessToken: encryptToken(refreshed.accessToken),
          encryptedRefreshToken,
          expiresAt: Date.now() + refreshed.expiresIn * 1000,
          updatedAt: new Date().toISOString(),
        });

        return refreshed.accessToken;
      } catch (err) {
        const safeMessage = sanitizeErrorMessage(err, 'Google Drive token refresh failed.');
        console.warn('Failed to refresh stored Google Drive token:', safeMessage);
        throw new Error(
          `Google Drive OAuth reauthorization required: ${safeMessage} Please reconnect Google Drive in Settings > Integrations.`
        );
      }
    }

    if (Date.now() >= creds.expiresAt) {
      throw new Error(
        'Google Drive OAuth reauthorization required: Stored access token expired and no refresh token is available. Please reconnect Google Drive in Settings > Integrations.'
      );
    }

    return decryptToken(creds.encryptedAccessToken);
  }

  // Fallback to legacy credential ONLY if YouTube service credentials do not exist
  const ytCreds = await Repository.getGoogleServiceCredentials('youtube');
  if (!ytCreds) {
    const legacy = await Repository.getGoogleCredentials();
    if (legacy) {
      const EXPIRY_BUFFER_MS = 5 * 60 * 1000;
      const isExpiring = Date.now() > legacy.expiresAt - EXPIRY_BUFFER_MS;
      if (!isExpiring) {
        return decryptToken(legacy.encryptedAccessToken);
      }
      if (legacy.encryptedRefreshToken) {
        try {
          const refreshed = await refreshGoogleTokens(legacy.encryptedRefreshToken);
          await Repository.saveGoogleCredentials({
            ...legacy,
            encryptedAccessToken: encryptToken(refreshed.accessToken),
            expiresAt: Date.now() + refreshed.expiresIn * 1000,
          });
          return refreshed.accessToken;
        } catch (err) {
          const safeMessage = sanitizeErrorMessage(err, 'Token refresh failed.');
          console.warn('Failed to refresh stored legacy token:', safeMessage);
          throw new Error(
            `Google OAuth reauthorization required: ${safeMessage} Please reconnect in Settings > Integrations.`
          );
        }
      }
      if (Date.now() >= legacy.expiresAt) {
        throw new Error(
          'Google Drive OAuth reauthorization required: Stored access token expired. Please reconnect in Settings > Integrations.'
        );
      }
      return decryptToken(legacy.encryptedAccessToken);
    }
  }

  if (process.env.GOOGLE_ACCESS_TOKEN) {
    return process.env.GOOGLE_ACCESS_TOKEN;
  }

  throw new Error('Google Drive account is not connected. Please authorize via Settings > Integrations.');
}

/**
 * Retrieves a valid YouTube access token, automatically refreshing if needed.
 */
export async function getValidYouTubeAccessToken(): Promise<string> {
  const creds = await Repository.getGoogleServiceCredentials('youtube');
  if (creds) {
    const EXPIRY_BUFFER_MS = 5 * 60 * 1000;
    const isExpiring = Date.now() > creds.expiresAt - EXPIRY_BUFFER_MS;
    if (!isExpiring) {
      return decryptToken(creds.encryptedAccessToken);
    }

    if (creds.encryptedRefreshToken) {
      try {
        const refreshed = await refreshGoogleTokens(creds.encryptedRefreshToken);
        const encryptedRefreshToken = refreshed.refreshToken
          ? encryptToken(refreshed.refreshToken)
          : creds.encryptedRefreshToken;

        await Repository.saveGoogleServiceCredentials({
          ...creds,
          service: 'youtube',
          encryptedAccessToken: encryptToken(refreshed.accessToken),
          encryptedRefreshToken,
          expiresAt: Date.now() + refreshed.expiresIn * 1000,
          updatedAt: new Date().toISOString(),
        });

        return refreshed.accessToken;
      } catch (err) {
        const safeMessage = sanitizeErrorMessage(err, 'YouTube token refresh failed.');
        console.warn('Failed to refresh stored YouTube token:', safeMessage);
        throw new Error(
          `YouTube OAuth reauthorization required: ${safeMessage} Please reconnect YouTube in Settings > Integrations.`
        );
      }
    }

    if (Date.now() >= creds.expiresAt) {
      throw new Error(
        'YouTube OAuth reauthorization required: Stored access token expired and no refresh token is available. Please reconnect YouTube in Settings > Integrations.'
      );
    }

    return decryptToken(creds.encryptedAccessToken);
  }

  // Fallback to legacy credential ONLY if Drive service credentials do not exist
  const driveCreds = await Repository.getGoogleServiceCredentials('drive');
  if (!driveCreds) {
    const legacy = await Repository.getGoogleCredentials();
    if (legacy && (legacy.channelTitle || legacy.email)) {
      const EXPIRY_BUFFER_MS = 5 * 60 * 1000;
      const isExpiring = Date.now() > legacy.expiresAt - EXPIRY_BUFFER_MS;
      if (!isExpiring) {
        return decryptToken(legacy.encryptedAccessToken);
      }
      if (legacy.encryptedRefreshToken) {
        try {
          const refreshed = await refreshGoogleTokens(legacy.encryptedRefreshToken);
          await Repository.saveGoogleCredentials({
            ...legacy,
            encryptedAccessToken: encryptToken(refreshed.accessToken),
            expiresAt: Date.now() + refreshed.expiresIn * 1000,
          });
          return refreshed.accessToken;
        } catch (err) {
          const safeMessage = sanitizeErrorMessage(err, 'Token refresh failed.');
          console.warn('Failed to refresh stored legacy token:', safeMessage);
          throw new Error(
            `Google OAuth reauthorization required: ${safeMessage} Please reconnect in Settings > Integrations.`
          );
        }
      }
      if (Date.now() >= legacy.expiresAt) {
        throw new Error(
          'YouTube OAuth reauthorization required: Stored access token expired. Please reconnect in Settings > Integrations.'
        );
      }
      return decryptToken(legacy.encryptedAccessToken);
    }
  }

  if (process.env.GOOGLE_ACCESS_TOKEN) {
    return process.env.GOOGLE_ACCESS_TOKEN;
  }

  throw new Error('YouTube channel is not connected. Please authorize via Settings > Integrations.');
}

/**
 * Backward-compatible generic access token getter.
 */
export async function getValidAccessToken(): Promise<string> {
  const driveCreds = await Repository.getGoogleServiceCredentials('drive');
  const ytCreds = await Repository.getGoogleServiceCredentials('youtube');
  if (driveCreds) {
    return getValidDriveAccessToken();
  }
  if (ytCreds) {
    return getValidYouTubeAccessToken();
  }
  try {
    return await getValidDriveAccessToken();
  } catch (err) {
    if (err instanceof Error && /reauthorization required/i.test(err.message)) {
      throw err;
    }
    return await getValidYouTubeAccessToken();
  }
}

async function revokeGoogleTokenBestEffort(rawToken: string): Promise<void> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 4000);
  try {
    const res = await fetch('https://oauth2.googleapis.com/revoke', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ token: rawToken }).toString(),
      signal: controller.signal,
    });
    if (!res.ok) {
      console.warn(`Google OAuth token revocation returned HTTP ${res.status}`);
    }
  } catch (err) {
    console.warn('Google OAuth token revocation request failed:', sanitizeErrorMessage(err));
  } finally {
    clearTimeout(timer);
  }
}

export async function isDriveConnected(): Promise<boolean> {
  const creds = await Repository.getGoogleServiceCredentials('drive');
  if (creds) return true;
  const ytCreds = await Repository.getGoogleServiceCredentials('youtube');
  if (!ytCreds) {
    const legacy = await Repository.getGoogleCredentials();
    if (legacy && legacy.email) return true;
  }
  return Boolean(process.env.GOOGLE_ACCESS_TOKEN);
}

export async function isYouTubeConnected(): Promise<boolean> {
  const creds = await Repository.getGoogleServiceCredentials('youtube');
  if (creds && creds.channelId) return true;
  const driveCreds = await Repository.getGoogleServiceCredentials('drive');
  if (!driveCreds) {
    const legacy = await Repository.getGoogleCredentials();
    if (legacy && (legacy.channelTitle || legacy.email)) return true;
  }
  return Boolean(process.env.GOOGLE_ACCESS_TOKEN);
}

export async function isGoogleConnected(): Promise<boolean> {
  return (await isDriveConnected()) || (await isYouTubeConnected());
}

/**
 * Disconnects a single Google service (drive or youtube), attempting best-effort token revocation
 * on only that service's token, while keeping the other service's credentials completely intact.
 */
export async function disconnectGoogleService(service: GoogleOAuthService): Promise<void> {
  const creds = await Repository.getGoogleServiceCredentials(service);
  try {
    const candidate = creds?.encryptedRefreshToken || creds?.encryptedAccessToken;
    if (candidate) {
      try {
        const rawToken = decryptToken(candidate);
        if (rawToken) {
          await revokeGoogleTokenBestEffort(rawToken);
        }
      } catch (err) {
        console.warn(`Skipping token revocation for ${service}:`, sanitizeErrorMessage(err));
      }
    }
  } finally {
    await Repository.clearGoogleServiceCredentials(service);
    await Repository.logActivity(
      'SETTINGS_UPDATED',
      `Google ${service === 'drive' ? 'Drive' : 'YouTube'} account disconnected`
    );
  }
}

/**
 * Backward-compatible disconnect function (disconnects both services).
 */
export async function disconnectGoogle(): Promise<void> {
  const [driveCreds, ytCreds, legacyCreds] = await Promise.all([
    Repository.getGoogleServiceCredentials('drive'),
    Repository.getGoogleServiceCredentials('youtube'),
    Repository.getGoogleCredentials(),
  ]);

  const tokensToRevoke = new Set<string>();
  for (const c of [driveCreds, ytCreds, legacyCreds]) {
    const candidate = c?.encryptedRefreshToken || c?.encryptedAccessToken;
    if (candidate) {
      try {
        const raw = decryptToken(candidate);
        if (raw) tokensToRevoke.add(raw);
      } catch {
        // ignore
      }
    }
  }

  for (const raw of tokensToRevoke) {
    await revokeGoogleTokenBestEffort(raw);
  }

  await Repository.clearGoogleServiceCredentials('drive');
  await Repository.clearGoogleServiceCredentials('youtube');
  await Repository.clearGoogleCredentials();
  await Repository.logActivity('SETTINGS_UPDATED', 'All Google services disconnected');
}
