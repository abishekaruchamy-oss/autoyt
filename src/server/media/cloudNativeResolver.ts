/**
 * Cloud-native Instagram Reel media resolvers for Cloudflare Workers & Node.js.
 * Zero child_process, zero yt-dlp binaries, zero local disk writes, zero signed URL logging.
 */

import type { IMediaProvider, MediaResolutionResult } from './MediaResolver';
import {
  extractSignedUrlExpiryIso,
  isInstagramWebpageUrl,
  isValidPublicMediaUrl,
  redactMediaUrl,
} from './streamValidation';

interface PublicHttpResponse {
  status: number;
  url: string;
  setCookies: string[];
  body: string;
}

const PUBLIC_WEB_HEADERS: Record<string, string> = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36',
  Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'en-us,en;q=0.5',
  'Sec-Fetch-Mode': 'navigate',
};

function isCloudflareWorkerRuntime(): boolean {
  return (
    typeof (globalThis as Record<string, unknown>).WebSocketPair !== 'undefined' ||
    typeof process === 'undefined' ||
    Boolean(process.env.CF_PAGES) ||
    Boolean(process.env.CLOUDFLARE_WORKER)
  );
}

/**
 * Performs an HTTPS GET using node:https (HTTP/1.1) in Node runtimes, or native fetch()
 * in Cloudflare Workers / Edge runtimes, returning status, final URL, Set-Cookie headers, and body.
 */
async function performPublicHttpsGet(
  targetUrl: string,
  extraHeaders?: Record<string, string>,
  timeoutMs: number = 12000
): Promise<PublicHttpResponse> {
  const headers: Record<string, string> = {
    ...PUBLIC_WEB_HEADERS,
    ...(extraHeaders || {}),
  };

  // In Node.js, node:https HTTP/1.1 avoids undici auto-injected headers that trigger empty HTML shells
  if (!isCloudflareWorkerRuntime()) {
    try {
      const httpsModule = await import('node:https');
      return await new Promise<PublicHttpResponse>((resolve, reject) => {
        const req = httpsModule.get(targetUrl, { headers, timeout: timeoutMs }, (res) => {
          const status = res.statusCode || 0;
          const location = res.headers.location;
          if (status >= 300 && status < 400 && location) {
            res.resume();
            const nextUrl = new URL(location, targetUrl).toString();
            resolve({
              status,
              url: nextUrl,
              setCookies: Array.isArray(res.headers['set-cookie']) ? res.headers['set-cookie'] : [],
              body: '',
            });
            return;
          }

          const chunks: Buffer[] = [];
          res.on('data', (chunk: Buffer | string) => {
            chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
          });
          res.on('end', () => {
            const rawCookies = res.headers['set-cookie'];
            resolve({
              status,
              url: targetUrl,
              setCookies: Array.isArray(rawCookies) ? rawCookies : [],
              body: Buffer.concat(chunks).toString('utf8'),
            });
          });
        });

        req.on('timeout', () => {
          req.destroy(new Error(`HTTPS request timed out after ${timeoutMs}ms`));
        });
        req.on('error', reject);
      });
    } catch {
      // Fall through to native fetch()
    }
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(targetUrl, {
      method: 'GET',
      headers,
      redirect: 'follow',
      signal: controller.signal,
    });
    const setCookies: string[] = [];
    const headersWithGetSetCookie = res.headers as Headers & {
      getSetCookie?: () => string[];
    };
    if (typeof headersWithGetSetCookie.getSetCookie === 'function') {
      setCookies.push(...headersWithGetSetCookie.getSetCookie());
    } else {
      const single = res.headers.get('set-cookie');
      if (single) setCookies.push(single);
    }
    const body = await res.text();
    return {
      status: res.status,
      url: res.url || targetUrl,
      setCookies,
      body,
    };
  } finally {
    clearTimeout(timer);
  }
}

function findNestedKey(obj: unknown, key: string): Record<string, unknown> | null {
  if (!obj || typeof obj !== 'object') return null;
  if (!Array.isArray(obj)) {
    const record = obj as Record<string, unknown>;
    if (Object.prototype.hasOwnProperty.call(record, key)) {
      const val = record[key];
      if (val && typeof val === 'object' && !Array.isArray(val)) {
        return val as Record<string, unknown>;
      }
    }
    for (const k of Object.keys(record)) {
      const nested = findNestedKey(record[k], key);
      if (nested) return nested;
    }
  } else {
    for (const item of obj) {
      const nested = findNestedKey(item, key);
      if (nested) return nested;
    }
  }
  return null;
}

function decodeEfgDurationSeconds(mediaUrl: string): number | undefined {
  try {
    const parsed = new URL(mediaUrl);
    const efgRaw = parsed.searchParams.get('efg');
    if (!efgRaw) return undefined;
    const decodedStr =
      typeof Buffer !== 'undefined'
        ? Buffer.from(efgRaw, 'base64').toString('utf8')
        : atob(efgRaw);
    const efg = JSON.parse(decodedStr) as { duration_s?: number };
    return typeof efg.duration_s === 'number' && efg.duration_s > 0
      ? efg.duration_s
      : undefined;
  } catch {
    return undefined;
  }
}

interface PolarisVideoVersion {
  url?: string;
  width?: number;
  height?: number;
  type?: number;
}

/**
 * Extracts structured Reel metadata and direct Meta CDN MP4 URL from public
 * Instagram `<script type="application/json" data-sjs>` payloads.
 */
export function parsePublicPolarisMediaFromHtml(
  html: string,
  expectedShortcode: string
): {
  shortcode: string;
  username?: string;
  caption?: string;
  mediaUrl: string;
  thumbnailUrl?: string;
  durationSeconds?: number;
  width?: number;
  height?: number;
  mediaExpiresAt?: string | null;
} | null {
  if (!html || !html.includes('xig_polaris_media')) return null;

  const scriptRegex =
    /<script[^>]*type="application\/json"[^>]*data-sjs[^>]*>([\s\S]*?)<\/script>/gi;
  let match: RegExpExecArray | null;

  while ((match = scriptRegex.exec(html)) !== null) {
    const scriptBody = match[1];
    if (!scriptBody.includes('xig_polaris_media')) continue;

    try {
      const parsed: unknown = JSON.parse(scriptBody);
      const polarisMedia = findNestedKey(parsed, 'xig_polaris_media');
      const productInfo = polarisMedia?.if_not_gated_logged_out as
        | Record<string, unknown>
        | undefined;
      if (!productInfo || typeof productInfo !== 'object') continue;

      const resolvedCode =
        typeof productInfo.code === 'string' ? productInfo.code : expectedShortcode;
      if (resolvedCode !== expectedShortcode) {
        continue;
      }

      const versions = Array.isArray(productInfo.video_versions)
        ? (productInfo.video_versions as PolarisVideoVersion[])
        : [];
      const validVersions = versions.filter(
        (v): v is Required<Pick<PolarisVideoVersion, 'url'>> & PolarisVideoVersion =>
          typeof v.url === 'string' &&
          v.url.startsWith('https://') &&
          !isInstagramWebpageUrl(v.url) &&
          isValidPublicMediaUrl(v.url).isValid
      );
      if (validVersions.length === 0) continue;

      // Prefer highest resolution progressive MP4 stream
      validVersions.sort(
        (a, b) => (b.width || 0) * (b.height || 0) - (a.width || 0) * (a.height || 0)
      );
      const best = validVersions[0];

      const user = productInfo.user as { username?: string } | undefined;
      const captionObj = productInfo.caption as { text?: string } | undefined;
      const imageVersions = productInfo.image_versions2 as
        | { candidates?: Array<{ url?: string }> }
        | undefined;
      const rawDuration =
        typeof productInfo.video_duration === 'number'
          ? productInfo.video_duration
          : decodeEfgDurationSeconds(best.url);

      return {
        shortcode: resolvedCode,
        username: user?.username || undefined,
        caption: captionObj?.text || undefined,
        mediaUrl: best.url,
        thumbnailUrl: imageVersions?.candidates?.[0]?.url || undefined,
        durationSeconds: rawDuration,
        width: best.width,
        height: best.height,
        mediaExpiresAt: extractSignedUrlExpiryIso(best.url),
      };
    } catch {
      // Continue scanning scripts
    }
  }

  return null;
}

/**
 * Provider: Cloud-Native Public Instagram Reel Resolver
 * Uses standard logged-out public HTTPS requests only (no login/CAPTCHA bypass, no child_process).
 */
export class CloudNativePublicReelProvider implements IMediaProvider {
  readonly providerName = 'PUBLIC_IG_NATIVE';

  canResolve(
    _url: string,
    options?: {
      directVideoUrl?: string;
      driveFileId?: string;
      sandbox?: boolean;
      disablePublicNative?: boolean;
    }
  ): boolean {
    if (options?.directVideoUrl || options?.driveFileId || options?.sandbox) return false;
    if (options?.disablePublicNative) return false;
    return true;
  }

  async resolve(
    _url: string,
    shortcode: string,
    options?: { caption?: string; username?: string }
  ): Promise<MediaResolutionResult> {
    const canonicalUrl = `https://www.instagram.com/reel/${shortcode}/`;

    try {
      // 1. Obtain anonymous public session cookies from Instagram landing page
      const initRes = await performPublicHttpsGet('https://www.instagram.com/', undefined, 10000);
      const cookieHeader = initRes.setCookies
        .map((c) => c.split(';')[0].trim())
        .filter(Boolean)
        .join('; ');

      // 2. Fetch public post page /p/{shortcode}
      const postRes = await performPublicHttpsGet(
        `https://www.instagram.com/p/${shortcode}`,
        cookieHeader ? { Cookie: cookieHeader } : undefined,
        12000
      );

      if (postRes.status === 404) {
        return {
          success: false,
          shortcode,
          canonicalUrl,
          provider: this.providerName,
          status: 'NOT_FOUND',
          reason: `Instagram Reel #${shortcode} not found (HTTP 404).`,
          requiresManualMedia: false,
        };
      }

      if (
        postRes.url.includes('/accounts/login') ||
        postRes.status === 401 ||
        postRes.status === 403 ||
        postRes.status === 429
      ) {
        return {
          success: false,
          shortcode,
          canonicalUrl,
          provider: this.providerName,
          status: 'ACCESS_RESTRICTED',
          reason: `Public Instagram endpoint restricted or rate-limited (HTTP ${postRes.status}).`,
          requiresManualMedia: false,
        };
      }

      const extracted = parsePublicPolarisMediaFromHtml(postRes.body, shortcode);
      if (!extracted) {
        return {
          success: false,
          shortcode,
          canonicalUrl,
          provider: this.providerName,
          status: 'WAITING_FOR_AUTHORIZED_MEDIA',
          reason:
            'Public Instagram HTML did not include unauthenticated video metadata (post may be private or edge IP returned an empty shell).',
          requiresManualMedia: false,
        };
      }

      return {
        success: true,
        shortcode: extracted.shortcode,
        canonicalUrl,
        provider: this.providerName,
        mediaUrl: extracted.mediaUrl,
        caption: options?.caption || extracted.caption || `Instagram Reel #${shortcode}`,
        username: extracted.username || options?.username || 'creator',
        thumbnailUrl: extracted.thumbnailUrl,
        durationSeconds: extracted.durationSeconds,
        width: extracted.width,
        height: extracted.height,
        mimeType: 'video/mp4',
        mediaExpiresAt: extracted.mediaExpiresAt || undefined,
        status: 'MEDIA_AVAILABLE',
        reason: `Resolved public Reel stream automatically via ${this.providerName} (${redactMediaUrl(extracted.mediaUrl)}).`,
        requiresManualMedia: false,
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return {
        success: false,
        shortcode,
        canonicalUrl,
        provider: this.providerName,
        status: 'ERROR',
        reason: `Cloud-native public Reel resolution failed: ${msg}`,
        requiresManualMedia: false,
      };
    }
  }
}

/**
 * Provider: Authenticated External Cloud Resolver Service (HTTPS service-to-service).
 * Configured via MEDIA_RESOLVER_URL and optional MEDIA_RESOLVER_TOKEN secrets.
 */
export class ExternalCloudResolverProvider implements IMediaProvider {
  readonly providerName = 'EXTERNAL_CLOUD_RESOLVER';

  private getEndpoint(): { url: string; token?: string } | null {
    const rawUrl = process.env.MEDIA_RESOLVER_URL?.trim();
    if (!rawUrl || !rawUrl.startsWith('https://')) return null;
    const token = process.env.MEDIA_RESOLVER_TOKEN?.trim();
    return { url: rawUrl.replace(/\/+$/, ''), token };
  }

  canResolve(
    _url: string,
    options?: { directVideoUrl?: string; driveFileId?: string; sandbox?: boolean }
  ): boolean {
    if (options?.directVideoUrl || options?.driveFileId || options?.sandbox) return false;
    return this.getEndpoint() !== null;
  }

  async resolve(
    _url: string,
    shortcode: string,
    options?: { caption?: string; username?: string }
  ): Promise<MediaResolutionResult> {
    const canonicalUrl = `https://www.instagram.com/reel/${shortcode}/`;
    const cfg = this.getEndpoint();
    if (!cfg) {
      return {
        success: false,
        shortcode,
        canonicalUrl,
        provider: this.providerName,
        status: 'WAITING_FOR_AUTHORIZED_MEDIA',
        reason: 'External cloud resolver endpoint is not configured.',
        requiresManualMedia: false,
      };
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 25000);
    try {
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        Accept: 'application/json',
      };
      if (cfg.token) {
        headers.Authorization = `Bearer ${cfg.token}`;
      }

      const res = await fetch(`${cfg.url}/resolve`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ reelUrl: canonicalUrl, shortcode }),
        signal: controller.signal,
      });

      if (!res.ok) {
        return {
          success: false,
          shortcode,
          canonicalUrl,
          provider: this.providerName,
          status: res.status === 404 ? 'NOT_FOUND' : 'ERROR',
          reason: `External cloud resolver returned HTTP ${res.status}.`,
          requiresManualMedia: false,
        };
      }

      const data = (await res.json()) as {
        shortcode?: string;
        creatorHandle?: string;
        username?: string;
        caption?: string;
        mediaUrl?: string;
        thumbnailUrl?: string;
        mimeType?: string;
        durationSeconds?: number;
        width?: number;
        height?: number;
        mediaExpiresAt?: string;
        sizeBytes?: number;
      };

      if (data.shortcode && data.shortcode !== shortcode) {
        return {
          success: false,
          shortcode,
          canonicalUrl,
          provider: this.providerName,
          status: 'ERROR',
          reason: `External resolver shortcode mismatch (expected ${shortcode}, got ${data.shortcode}).`,
          requiresManualMedia: false,
        };
      }

      if (
        !data.mediaUrl ||
        isInstagramWebpageUrl(data.mediaUrl) ||
        !isValidPublicMediaUrl(data.mediaUrl).isValid
      ) {
        return {
          success: false,
          shortcode,
          canonicalUrl,
          provider: this.providerName,
          status: 'ERROR',
          reason: 'External cloud resolver did not return a valid HTTPS direct MP4 media URL.',
          requiresManualMedia: false,
        };
      }

      return {
        success: true,
        shortcode,
        canonicalUrl,
        provider: this.providerName,
        mediaUrl: data.mediaUrl,
        caption: options?.caption || data.caption || `Instagram Reel #${shortcode}`,
        username: data.creatorHandle || data.username || options?.username || 'creator',
        thumbnailUrl: data.thumbnailUrl,
        mimeType: data.mimeType || 'video/mp4',
        durationSeconds: data.durationSeconds,
        width: data.width,
        height: data.height,
        sizeBytes: data.sizeBytes,
        mediaExpiresAt: data.mediaExpiresAt || extractSignedUrlExpiryIso(data.mediaUrl) || undefined,
        status: 'MEDIA_AVAILABLE',
        reason: `Resolved via authenticated cloud resolver (${redactMediaUrl(data.mediaUrl)}).`,
        requiresManualMedia: false,
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return {
        success: false,
        shortcode,
        canonicalUrl,
        provider: this.providerName,
        status: 'ERROR',
        reason: `External cloud resolver error: ${msg}`,
        requiresManualMedia: false,
      };
    } finally {
      clearTimeout(timer);
    }
  }
}
