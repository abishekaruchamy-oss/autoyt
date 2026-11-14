import { sanitizeErrorMessage } from '@/lib/security';

export interface OAuthBannerFeedback {
  variant: 'success' | 'warning' | 'error';
  title: string;
  message: string;
}

export interface OAuthQueryFeedbackInput {
  success?: string | null;
  account?: string | null;
  authNotice?: string | null;
  warning?: string | null;
  error?: string | null;
}

/**
 * Translates Google OAuth callback query parameters into clear, non-sensitive
 * operator feedback messages for Settings > Integrations.
 */
export function resolveOAuthBannerFeedback(
  input: OAuthQueryFeedbackInput
): OAuthBannerFeedback | null {
  const success = input.success?.trim();
  const account = input.account?.trim();
  const authNotice = input.authNotice?.trim();
  const warning = input.warning?.trim();
  const error = input.error?.trim();
  const safeAccount = account ? sanitizeErrorMessage(account, '') : '';

  if (success === 'google_drive_connected') {
    return {
      variant: 'success',
      title: 'Google Drive Connected',
      message: safeAccount
        ? `Authorized ${safeAccount} for Google Drive video archival storage.`
        : 'Google account authorized for Google Drive video archival storage.',
    };
  }

  if (success === 'youtube_connected') {
    return {
      variant: 'success',
      title: 'YouTube Channel Connected',
      message: safeAccount
        ? `Authorized YouTube channel ${safeAccount} for automated Shorts publishing.`
        : 'YouTube channel authorized for automated Shorts publishing.',
    };
  }

  if (warning === 'youtube_channel_not_found') {
    return {
      variant: 'warning',
      title: 'No YouTube Channel Found',
      message: safeAccount
        ? `Google account ${safeAccount} was authorized, but no primary YouTube channel exists for it. Please create a YouTube channel under this account to enable Shorts publishing.`
        : 'Google account was authorized, but no primary YouTube channel exists for it. Please create a YouTube channel under this account to enable Shorts publishing.',
    };
  }

  if (success === 'google_connected') {
    return {
      variant: 'success',
      title: 'Google Account Connected',
      message: safeAccount
        ? `Authorized ${safeAccount} for Google Drive archiving and YouTube Shorts publishing.`
        : 'Google account authorized for Google Drive archiving and YouTube Shorts publishing.',
    };
  }

  if (authNotice === 'missing_google_credentials') {
    return {
      variant: 'warning',
      title: 'Google OAuth Credentials Missing',
      message:
        'GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET are not configured on the server yet. Configure them before connecting Google.',
    };
  }

  if (error) {
    switch (error) {
      case 'access_denied':
        return {
          variant: 'warning',
          title: 'Google Authorization Cancelled',
          message:
            'Consent was denied or cancelled at Google. No credentials were modified.',
        };
      case 'drive_scope_not_granted':
        return {
          variant: 'error',
          title: 'Google Drive Permission Required',
          message: safeAccount
            ? `Google account ${safeAccount} was authenticated, but the Google Drive file permission (drive.file) was not granted. On Google's consent screen, you must check the box next to "See, edit, create, and delete only the specific Google Drive files you use with this app".`
            : "Google account was authenticated, but the Google Drive file permission (drive.file) was not granted. On Google's consent screen, you must check the box next to \"See, edit, create, and delete only the specific Google Drive files you use with this app\".",
        };
      case 'invalid_csrf_state':
        return {
          variant: 'error',
          title: 'Security Check Failed (CSRF State Mismatch)',
          message:
            'The OAuth CSRF verification state was missing or did not match your session. Start authorization again from Settings.',
        };
      case 'expired_or_invalid_oauth_state':
        return {
          variant: 'error',
          title: 'Authorization Request Expired',
          message:
            'This OAuth state expired or was already consumed. Click Connect with Google to start a fresh authorization.',
        };
      case 'unauthorized':
        return {
          variant: 'error',
          title: 'Operator Session Required',
          message:
            'An active authenticated operator session is required to link Google OAuth credentials.',
        };
      case 'auth_not_configured':
        return {
          variant: 'error',
          title: 'Server Authentication Not Configured',
          message:
            'Configure ADMIN_ACCESS_KEY and ADMIN_SESSION_SECRET before connecting Google OAuth.',
        };
      case 'missing_auth_code':
        return {
          variant: 'error',
          title: 'Authorization Code Missing',
          message:
            'Google returned without an authorization code. Please try connecting again.',
        };
      default: {
        const lower = error.toLowerCase();
        if (
          lower.includes('reauthorization') ||
          lower.includes('invalid_grant') ||
          lower.includes('refresh')
        ) {
          return {
            variant: 'error',
            title: 'Google Reauthorization Required',
            message: sanitizeErrorMessage(
              error,
              'Your Google authorization expired or was revoked. Reconnect your Google account to restore access.'
            ),
          };
        }

        return {
          variant: 'error',
          title: 'Google OAuth Error',
          message: sanitizeErrorMessage(
            error,
            'Google authorization failed. Check server configuration and try again.'
          ),
        };
      }
    }
  }

  return null;
}
