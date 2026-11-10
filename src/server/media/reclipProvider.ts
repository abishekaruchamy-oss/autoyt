/**
 * reclipProvider.ts
 *
 * ReClip / yt-dlp Media Provider for AutoShorts.
 * Integrates yt-dlp extraction logic (inspired by averygan/reclip) into AutoShorts'
 * provider-independent MediaResolver interface.
 *
 * Strict Architectural Invariants:
 * - Zero Local SSD Writes: Never calls yt-dlp with disk download flags.
 * - Streams directly via HTTPS URLs in 5MB bounded memory buffers.
 * - Anti-Bypass Compliance: Never uses stolen session cookies or automated CAPTCHA bypasses.
 * - Masked Security: Strips sensitive query tokens from logged media URLs.
 * - Remote / Serverless Ready: Supports remote microservice (RECLIP_SERVICE_URL) or local CLI.
 */

import { IMediaProvider, MediaResolutionResult } from './MediaResolver';

/**
 * Safely loads execFile only in Node.js runtime without breaking Cloudflare Worker bundlers.
 */
async function getExecFile(): Promise<any> {
  if (typeof process === 'undefined' || !process.versions?.node) {
    throw new Error(
      'Local yt-dlp CLI is only supported in Node.js container/CLI runtimes. In Cloudflare Workers, please set RECLIP_SERVICE_URL to connect to your remote media worker.'
    );
  }
  try {
    const moduleName = 'child_process';
    const cp = await import(/* webpackIgnore: true */ moduleName);
    return cp.execFile;
  } catch (e) {
    throw new Error(`Failed to load child_process: ${(e as Error).message}`);
  }
}

export interface YtDlpFormat {
  format_id?: string;
  url?: string;
  ext?: string;
  vcodec?: string;
  acodec?: string;
  width?: number;
  height?: number;
  filesize?: number;
  filesize_approx?: number;
  tbr?: number;
}

export interface YtDlpInfo {
  id?: string;
  title?: string;
  description?: string;
  uploader?: string;
  channel?: string;
  thumbnail?: string;
  url?: string;
  ext?: string;
  format_id?: string;
  formats?: YtDlpFormat[];
  extractor?: string;
  extractor_key?: string;
}

/**
 * Parses yt-dlp JSON output safely, following ReClip's line-by-line parsing
 * to avoid "Extra data" errors when extractors emit multi-line objects.
 */
export function parseYtDlpJson(stdout: string): YtDlpInfo {
  for (const line of stdout.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      return JSON.parse(trimmed) as YtDlpInfo;
    } catch {
      // Continue searching next line
    }
  }
  throw new Error('yt-dlp returned no valid JSON data');
}

/**
 * Masks query parameters from signed CDN URLs to prevent exposing tokens in logs.
 */
export function maskMediaUrl(rawUrl?: string): string {
  if (!rawUrl) return '(none)';
  try {
    const parsed = new URL(rawUrl);
    return `${parsed.origin}${parsed.pathname}?_nc_token=[MASKED]`;
  } catch {
    return rawUrl.substring(0, 48) + '...[MASKED]';
  }
}

export class ReClipYtDlpProvider implements IMediaProvider {
  readonly providerName = 'RECLIP_YT_DLP';

  /**
   * Checks whether this provider can attempt resolution.
   */
  canResolve(url: string, options?: { disableYtDlp?: boolean; sandbox?: boolean }): boolean {
    if (options?.disableYtDlp || options?.sandbox) {
      return false;
    }
    // Can resolve any valid Instagram Reel or post URL
    return /instagram\.com\/(?:reel|reels|p|tv)\/[A-Za-z0-9_-]+/i.test(url);
  }

  /**
   * Resolves direct media stream URL from Instagram Reel via yt-dlp / ReClip engine.
   * Crucially, this only fetches metadata and progressive stream URLs (0 disk writes).
   */
  async resolve(
    url: string,
    shortcode: string,
    options?: { timeoutMs?: number; serviceUrl?: string }
  ): Promise<MediaResolutionResult> {
    const canonicalUrl = `https://www.instagram.com/reel/${shortcode}/`;
    const serviceUrl = options?.serviceUrl || process.env.RECLIP_SERVICE_URL;

    try {
      let info: YtDlpInfo;

      if (serviceUrl) {
        // Mode A: Remote ReClip Microservice (for Cloudflare Workers / Serverless Runtimes)
        info = await this.queryRemoteReClipService(serviceUrl, canonicalUrl, options?.timeoutMs || 30000);
      } else {
        // Mode B: Direct CLI Execution (Node.js runtime / Container Worker)
        info = await this.queryLocalYtDlpCli(canonicalUrl, options?.timeoutMs || 30000);
      }

      // Find best progressive format (contains both video and audio)
      const formats = info.formats || [];
      const progressiveFormats = formats.filter(
        (f) => f.url && f.vcodec && f.vcodec !== 'none' && f.acodec && f.acodec !== 'none'
      );

      // Prefer highest resolution progressive format, fallback to default info.url
      let chosenMediaUrl: string | undefined = undefined;
      if (progressiveFormats.length > 0) {
        // Sort descending by height / tbr
        progressiveFormats.sort((a, b) => (b.height || 0) - (a.height || 0) || (b.tbr || 0) - (a.tbr || 0));
        chosenMediaUrl = progressiveFormats[0].url;
      } else if (info.url && info.ext === 'mp4') {
        chosenMediaUrl = info.url;
      }

      if (!chosenMediaUrl) {
        return {
          success: false,
          shortcode,
          canonicalUrl,
          provider: 'RECLIP_YT_DLP',
          status: 'WAITING_FOR_AUTHORIZED_MEDIA',
          reason: 'ReClip/yt-dlp extracted post metadata, but no direct progressive MP4 stream was available without platform authentication.',
          requiresManualMedia: true,
        };
      }

      const caption = info.description || info.title || `Reel #${shortcode}`;
      const username = info.channel || info.uploader || 'creator';

      return {
        success: true,
        shortcode,
        canonicalUrl,
        provider: 'RECLIP_YT_DLP',
        mediaUrl: chosenMediaUrl,
        caption,
        username,
        thumbnailUrl: info.thumbnail,
        status: 'MEDIA_AVAILABLE',
        reason: `Direct progressive MP4 stream resolved via ReClip/yt-dlp engine for @${username} (Zero-SSD RAM mode).`,
        requiresManualMedia: false,
      };
    } catch (err) {
      const errMsg = (err as Error).message || String(err);

      // When unauthenticated extraction fails for any reason (login wall, rate limit, 404, or parsing):
      // Honestly report WAITING_FOR_AUTHORIZED_MEDIA prompting creator-authorized stream without crashing.
      return {
        success: false,
        shortcode,
        canonicalUrl,
        provider: 'RECLIP_YT_DLP',
        status: 'WAITING_FOR_AUTHORIZED_MEDIA',
        reason: `ReClip/yt-dlp unauthenticated extraction unavailable (${errMsg.trim()}). Please provide creator-authorized direct media link or original video file.`,
        requiresManualMedia: true,
      };
    }
  }

  /**
   * Invokes yt-dlp via CLI with arguments ensuring zero disk downloads.
   */
  private async queryLocalYtDlpCli(url: string, timeoutMs: number): Promise<YtDlpInfo> {
    const execFile = await getExecFile();
    return new Promise((resolve, reject) => {
      // Execute with args: --no-playlist -j (prints JSON only, no media downloaded)
      const args = ['--no-playlist', '-j', '--no-warnings', url];

      // Try 'yt-dlp' executable first, fallback to 'python -m yt_dlp'
      execFile(
        'yt-dlp',
        args,
        { timeout: timeoutMs, maxBuffer: 10 * 1024 * 1024 },
        (err, stdout, stderr) => {
          if (!err && stdout) {
            try {
              return resolve(parseYtDlpJson(stdout));
            } catch (e) {
              return reject(e);
            }
          }

          // Fallback to python -m yt_dlp
          execFile(
            'python',
            ['-m', 'yt_dlp', ...args],
            { timeout: timeoutMs, maxBuffer: 10 * 1024 * 1024 },
            (pyErr, pyStdout, pyStderr) => {
              if (pyErr) {
                const finalErr = pyStderr || stderr || pyErr.message;
                return reject(new Error(finalErr.trim().split('\n').pop() || finalErr));
              }
              try {
                resolve(parseYtDlpJson(pyStdout));
              } catch (e) {
                reject(e);
              }
            }
          );
        }
      );
    });
  }

  /**
   * Queries a remote ReClip microservice (e.g. running on Docker / Cloud Run / VPS).
   */
  private async queryRemoteReClipService(
    serviceUrl: string,
    url: string,
    timeoutMs: number
  ): Promise<YtDlpInfo> {
    const endpoint = serviceUrl.endsWith('/') ? `${serviceUrl}api/info` : `${serviceUrl}/api/info`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    const apiKey = process.env.RECLIP_API_KEY;
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    if (apiKey) {
      headers['X-API-Key'] = apiKey;
      headers['Authorization'] = `Bearer ${apiKey}`;
    }

    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers,
        body: JSON.stringify({ url }),
        signal: controller.signal,
      });

      if (!res.ok) {
        const errorData = await res.json().catch(() => ({}));
        throw new Error(errorData.error || `Remote ReClip service returned HTTP ${res.status}`);
      }

      return (await res.json()) as YtDlpInfo;
    } finally {
      clearTimeout(timer);
    }
  }
}
