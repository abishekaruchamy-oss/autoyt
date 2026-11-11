import type { InstagramAccount, UploadJob } from '@/types';

/**
 * Standard no-store cache headers for authenticated and security-sensitive responses.
 */
export const NO_STORE_HEADERS: Record<string, string> = {
  'Cache-Control': 'no-store, no-cache, must-revalidate, private',
  Pragma: 'no-cache',
};

/**
 * Redacts OAuth tokens, signed CDN parameters, bearer credentials, and
 * encrypted ciphertext payloads before logging or displaying error messages.
 */
export function redactSensitiveText(input: string): string {
  if (!input) return '';

  return input
    // Google OAuth access & refresh token formats
    .replace(/\bya29\.[A-Za-z0-9\-_.+/=]+/g, '[REDACTED_GOOGLE_ACCESS_TOKEN]')
    .replace(/\b1\/\/[A-Za-z0-9\-_.+/=]+/g, '[REDACTED_GOOGLE_REFRESH_TOKEN]')
    // Bearer / Basic headers
    .replace(/(Bearer\s+)[A-Za-z0-9\-._~+/=]+/gi, '$1[REDACTED_TOKEN]')
    // Sensitive query string parameters
    .replace(
      /([?&](?:access_token|refresh_token|client_secret|code|token|key|secret|_nc_token|oh|oe|signature|X-Goog-Signature|upload_id)=)[^&\s"']+/gi,
      '$1[REDACTED]'
    )
    // AES-256-GCM iv:authTag:ciphertext envelopes
    .replace(/\b[0-9a-f]{24}:[0-9a-f]{32}:[0-9a-f]{16,}\b/gi, '[REDACTED_ENCRYPTED_PAYLOAD]');
}

/**
 * Extracts and redacts a safe, bounded error message for responses and logs.
 */
export function sanitizeErrorMessage(err: unknown, fallback = 'An unexpected error occurred.'): string {
  const raw =
    err instanceof Error
      ? err.message
      : typeof err === 'string' && err.trim().length > 0
      ? err
      : fallback;

  const redacted = redactSensitiveText(raw).trim();
  if (!redacted) return fallback;
  return redacted.length > 500 ? `${redacted.slice(0, 497)}...` : redacted;
}

/**
 * Strips internal encrypted credentials and upload session URIs from UploadJob
 * before serializing over HTTP APIs.
 */
export function sanitizeUploadJobForApi(
  job: UploadJob
): Omit<UploadJob, 'encrypted_youtube_upload_session_uri'> {
  const sanitized = { ...job };
  delete sanitized.encrypted_youtube_upload_session_uri;
  return sanitized;
}

/**
 * Batch-sanitizes UploadJob arrays for API JSON output.
 */
export function sanitizeUploadJobsForApi(
  jobs: UploadJob[]
): Array<Omit<UploadJob, 'encrypted_youtube_upload_session_uri'>> {
  return jobs.map(sanitizeUploadJobForApi);
}

/**
 * Strips any encrypted token field from legacy InstagramAccount responses.
 */
export function sanitizeAccountForApi(
  account: InstagramAccount
): Omit<InstagramAccount, 'access_token_encrypted'> {
  const sanitized = { ...account };
  delete sanitized.access_token_encrypted;
  return sanitized;
}

/**
 * Batch-sanitizes InstagramAccount arrays for API JSON output.
 */
export function sanitizeAccountsForApi(
  accounts: InstagramAccount[]
): Array<Omit<InstagramAccount, 'access_token_encrypted'>> {
  return accounts.map(sanitizeAccountForApi);
}
