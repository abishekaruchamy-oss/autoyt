/**
 * Cloudflare-native upstream media stream validation helpers.
 * Uses native fetch() only (zero child_process, zero local disk writes).
 */

export const MAX_PERMITTED_MEDIA_BYTES = 256 * 1024 * 1024; // 256 MiB ceiling

export interface ValidatedStreamMetadata {
  totalBytes: number;
  contentType: string | null;
  status: number;
}

export interface Mp4SignatureResult {
  valid: boolean;
  atomSize: number;
  atomType: string;
  majorBrand: string;
  status: number;
  contentType: string | null;
}

/**
 * Returns true if the URL points to an Instagram HTML webpage (e.g. instagram.com/reel/...)
 * rather than a direct video binary stream.
 */
export function isInstagramWebpageUrl(candidate: string): boolean {
  try {
    const parsed = new URL(candidate);
    const host = parsed.hostname.toLowerCase();
    return (
      (host === 'instagram.com' ||
        host === 'www.instagram.com' ||
        host.endsWith('.instagram.com')) &&
      !parsed.pathname.toLowerCase().endsWith('.mp4')
    );
  } catch {
    return false;
  }
}

/**
 * Extracts expiration timestamp (ISO-8601 UTC) from a signed Meta CDN URL `oe` hex parameter,
 * without exposing any query string secrets.
 */
export function extractSignedUrlExpiryIso(rawUrl: string): string | null {
  try {
    const parsed = new URL(rawUrl);
    const oe = parsed.searchParams.get('oe');
    if (!oe || !/^[0-9a-fA-F]+$/.test(oe)) return null;
    const epochSeconds = parseInt(oe, 16);
    if (!Number.isFinite(epochSeconds) || epochSeconds <= 0) return null;
    return new Date(epochSeconds * 1000).toISOString();
  } catch {
    return null;
  }
}

/**
 * Fetches only the first 32 bytes (Range: bytes=0-31) of an upstream media URL
 * to verify genuine MP4 container integrity (`ftyp` box) in RAM without downloading the file.
 */
export async function verifyMp4ContainerSignature(
  sourceVideoUrl: string,
  sourceHeaders?: Record<string, string>
): Promise<Mp4SignatureResult> {
  const safeUrl = redactMediaUrl(sourceVideoUrl);
  if (isInstagramWebpageUrl(sourceVideoUrl)) {
    throw new Error(
      `Rejected Instagram webpage URL (${safeUrl}) — expected direct video/mp4 media stream.`
    );
  }

  const res = await fetch(sourceVideoUrl, {
    method: 'GET',
    headers: {
      ...(sourceHeaders || {}),
      Range: 'bytes=0-31',
    },
  });

  if (!res.ok) {
    throw new Error(
      `Upstream MP4 signature check failed (HTTP ${res.status}) for ${safeUrl}.`
    );
  }

  const contentType = res.headers.get('content-type');
  if (!isPermittedVideoContentType(contentType)) {
    throw new Error(
      `Invalid upstream media Content-Type "${contentType}" during MP4 signature check for ${safeUrl}.`
    );
  }

  const buf = await res.arrayBuffer();
  const bytes = new Uint8Array(buf);
  if (bytes.byteLength < 12) {
    throw new Error(
      `Upstream stream returned fewer than 12 header bytes (${bytes.byteLength}) for ${safeUrl}.`
    );
  }

  const atomSize =
    ((bytes[0] << 24) | (bytes[1] << 16) | (bytes[2] << 8) | bytes[3]) >>> 0;
  const atomType = String.fromCharCode(bytes[4], bytes[5], bytes[6], bytes[7]);
  const majorBrand = String.fromCharCode(bytes[8], bytes[9], bytes[10], bytes[11]);

  if (atomType !== 'ftyp') {
    throw new Error(
      `Invalid MP4 container signature (got atom "${atomType}" instead of "ftyp") for ${safeUrl}.`
    );
  }

  return {
    valid: true,
    atomSize,
    atomType,
    majorBrand,
    status: res.status,
    contentType,
  };
}

/**
 * Redacts signed CDN query parameters so temporary bearer tokens are never
 * written to logs, errors, or diagnostics.
 */
export function redactMediaUrl(rawUrl: string): string {
  try {
    const parsed = new URL(rawUrl);
    const paramCount = [...parsed.searchParams.keys()].length;
    if (paramCount === 0) {
      return `${parsed.protocol}//${parsed.host}${parsed.pathname}`;
    }
    return `${parsed.protocol}//${parsed.host}${parsed.pathname}?[REDACTED_PARAMS=${paramCount}]`;
  } catch {
    return '[REDACTED_INVALID_URL]';
  }
}

/**
 * Returns true if the supplied Content-Type header represents an allowed binary/video stream.
 * Allows null/absent Content-Type (e.g. authenticated Drive media stubs), while strictly
 * rejecting HTML/plain/JSON/XML error payloads.
 */
export function isPermittedVideoContentType(contentType: string | null): boolean {
  if (!contentType) return true;
  const normalized = contentType.split(';')[0].trim().toLowerCase();
  if (!normalized) return true;
  return (
    normalized.startsWith('video/') ||
    normalized === 'application/octet-stream' ||
    normalized === 'binary/octet-stream'
  );
}

/**
 * Parses total size in bytes from an HTTP Content-Range header (e.g. "bytes 0-0/8879901").
 */
export function parseTotalBytesFromContentRange(contentRange: string | null): number {
  if (!contentRange) return 0;
  const match = contentRange.match(/bytes\s+\d+-\d+\/(\d+)/i);
  if (!match) return 0;
  const parsed = parseInt(match[1], 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

/**
 * Probes an upstream media URL via HEAD (with safe Range: bytes=0-0 fallback),
 * validating HTTP status, video Content-Type, non-zero size, and maximum media ceiling.
 * Aborts immediately on expired/unauthorized signed URLs (HTTP 401/403/404/410)
 * before any Google Drive or YouTube upload session is created.
 */
export async function probeUpstreamVideoStream(
  sourceVideoUrl: string,
  sourceHeaders?: Record<string, string>,
  maxBytes: number = MAX_PERMITTED_MEDIA_BYTES
): Promise<ValidatedStreamMetadata> {
  const safeUrl = redactMediaUrl(sourceVideoUrl);

  const headRes = await fetch(sourceVideoUrl, {
    method: 'HEAD',
    headers: sourceHeaders,
  });

  // Handle servers that disallow HEAD (405 Method Not Allowed) via 1-byte Range probe
  if (headRes.status === 405) {
    const rangeRes = await fetch(sourceVideoUrl, {
      method: 'GET',
      headers: {
        ...(sourceHeaders || {}),
        Range: 'bytes=0-0',
      },
    });

    if (!rangeRes.ok) {
      throw new Error(
        `Upstream media stream rejected (HTTP ${rangeRes.status}) for ${safeUrl}. Signed URL may be expired or unauthorized.`
      );
    }

    const contentType = rangeRes.headers.get('content-type');
    if (!isPermittedVideoContentType(contentType)) {
      throw new Error(
        `Invalid upstream media Content-Type "${contentType}" for ${safeUrl}. Expected video/mp4.`
      );
    }

    const totalBytes =
      parseTotalBytesFromContentRange(rangeRes.headers.get('content-range')) ||
      parseInt(rangeRes.headers.get('content-length') || '0', 10);

    if (!Number.isFinite(totalBytes) || totalBytes <= 0) {
      throw new Error(`Source video Content-Length is missing or zero for ${safeUrl}.`);
    }

    if (totalBytes > maxBytes) {
      throw new Error(
        `Source video size (${totalBytes} bytes) exceeds maximum permitted limit (${maxBytes} bytes).`
      );
    }

    return { totalBytes, contentType, status: rangeRes.status };
  }

  if (!headRes.ok) {
    const expiredHint =
      headRes.status === 403 || headRes.status === 401 || headRes.status === 410
        ? ' Signed URL may be expired or unauthorized.'
        : '';
    throw new Error(
      `Upstream media stream rejected (HTTP ${headRes.status}) for ${safeUrl}.${expiredHint}`
    );
  }

  const headContentType = headRes.headers.get('content-type');
  if (!isPermittedVideoContentType(headContentType)) {
    throw new Error(
      `Invalid upstream media Content-Type "${headContentType}" for ${safeUrl}. Expected video/mp4.`
    );
  }

  const contentLengthHeader = headRes.headers.get('content-length');
  let totalBytes = contentLengthHeader ? parseInt(contentLengthHeader, 10) : 0;

  // Fallback to 1-byte Range probe if HEAD omitted Content-Length
  if (!Number.isFinite(totalBytes) || totalBytes <= 0) {
    const rangeRes = await fetch(sourceVideoUrl, {
      method: 'GET',
      headers: {
        ...(sourceHeaders || {}),
        Range: 'bytes=0-0',
      },
    });
    if (rangeRes.ok) {
      totalBytes =
        parseTotalBytesFromContentRange(rangeRes.headers.get('content-range')) ||
        parseInt(rangeRes.headers.get('content-length') || '0', 10);
    }
  }

  if (!Number.isFinite(totalBytes) || totalBytes <= 0) {
    throw new Error('Source video Content-Length is missing or zero.');
  }

  if (totalBytes > maxBytes) {
    throw new Error(
      `Source video size (${totalBytes} bytes) exceeds maximum permitted limit (${maxBytes} bytes).`
    );
  }

  return {
    totalBytes,
    contentType: headContentType,
    status: headRes.status,
  };
}
