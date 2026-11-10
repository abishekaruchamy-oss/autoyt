/**
 * InstagramBusinessDiscovery.ts
 * 
 * Official Meta Instagram Graph API Business Discovery Provider.
 * Allows an authorized Instagram Business or Creator account to discover
 * public metadata and media from other Instagram Business/Creator accounts.
 * 
 * API Reference:
 * https://developers.facebook.com/docs/instagram-platform/instagram-graph-api/reference/ig-user/business_discovery
 * 
 * Strict Compliance:
 * - Uses only Meta's official supported Graph API endpoints.
 * - Does not use web scraping, private session cookies, or proxy evasion.
 * - Honestly verifies target profile eligibility (must be Business/Creator).
 * - Honestly reports when raw media requires authorized credentials or is gated.
 */

import {
  IMonitoringAdapter,
  MonitoredProfile,
  ProfileCheckResult,
  ReelsDiscoveryResult,
  DiscoveredReel,
} from '@/types';
import { normalizeProfileUrl } from './adapter';

export interface MetaBusinessDiscoveryMedia {
  id: string;
  caption?: string;
  media_type: 'IMAGE' | 'VIDEO' | 'CAROUSEL_ALBUM';
  media_product_type?: 'REELS' | 'FEED' | 'STORY' | 'AD';
  permalink: string;
  timestamp: string;
  media_url?: string;
  thumbnail_url?: string;
  like_count?: number;
  comments_count?: number;
}

export interface MetaBusinessDiscoveryProfile {
  id: string;
  username: string;
  name?: string;
  biography?: string;
  profile_picture_url?: string;
  followers_count?: number;
  follows_count?: number;
  media_count?: number;
  media?: {
    data: MetaBusinessDiscoveryMedia[];
    paging?: {
      cursors?: {
        after?: string;
        before?: string;
      };
    };
  };
}

export interface BusinessDiscoveryCheckResult {
  targetUsername: string;
  authenticated: boolean;
  eligible: boolean;
  status:
    | 'PROFILE_ACCESSIBLE'
    | 'PROFILE_NOT_ELIGIBLE'
    | 'AUTHORIZATION_REQUIRED'
    | 'REEL_DETECTED'
    | 'MEDIA_URL_AVAILABLE'
    | 'MEDIA_RETRIEVED'
    | 'WAITING_FOR_AUTHORIZED_MEDIA'
    | 'RETRIEVAL_FAILED';
  reason: string;
  profile?: MetaBusinessDiscoveryProfile;
  newestReel?: MetaBusinessDiscoveryMedia;
  mediaUrlAvailable: boolean;
  checkedAt: string;
}

export interface VideoStreamValidationResult {
  success: boolean;
  status: 'MEDIA_RETRIEVED' | 'WAITING_FOR_AUTHORIZED_MEDIA' | 'RETRIEVAL_FAILED';
  httpStatus?: number;
  contentType?: string;
  contentLength?: number;
  atomType?: string;
  majorBrand?: string;
  atomSize?: number;
  totalBytesStreamed: number;
  peakHeapDeltaMB: number;
  diskBytesWritten: 0; // Invariant: Zero SSD writes
  error?: string;
}

export class InstagramBusinessDiscoveryService {
  private static readonly GRAPH_API_BASE = 'https://graph.facebook.com';
  private static readonly GRAPH_VERSION = process.env.META_GRAPH_VERSION || 'v21.0';

  /**
   * Resolves active Meta Graph API credentials from environment or options
   */
  static getCredentials(options?: { accessToken?: string; instagramAccountId?: string }) {
    const accessToken = options?.accessToken || process.env.META_ACCESS_TOKEN || process.env.META_CLIENT_SECRET;
    const instagramAccountId = options?.instagramAccountId || process.env.INSTAGRAM_ACCOUNT_ID;
    const isConfigured = Boolean(accessToken && instagramAccountId);

    return {
      accessToken,
      instagramAccountId,
      isConfigured,
      graphVersion: this.GRAPH_VERSION,
    };
  }

  /**
   * Queries Meta Graph API Business Discovery for a target username
   */
  static async queryProfileAndMedia(
    targetInput: string,
    options?: { accessToken?: string; instagramAccountId?: string }
  ): Promise<BusinessDiscoveryCheckResult> {
    const { username } = normalizeProfileUrl(targetInput);
    const checkedAt = new Date().toISOString();

    const creds = this.getCredentials(options);

    // 1. Check Meta Authentication & Required Credentials
    if (!creds.isConfigured || !creds.accessToken || !creds.instagramAccountId) {
      return {
        targetUsername: username,
        authenticated: false,
        eligible: false,
        status: 'AUTHORIZATION_REQUIRED',
        reason:
          'Meta Graph API credentials missing. Business Discovery requires an authorized Instagram Professional (Business/Creator) account ID and access token with instagram_basic and pages_read_engagement permissions.',
        mediaUrlAvailable: false,
        checkedAt,
      };
    }

    // 2. Query Business Discovery endpoint
    // Endpoint: GET https://graph.facebook.com/v21.0/{ig_user_id}?fields=business_discovery.username({username}){...}
    const fields = [
      'id',
      'username',
      'name',
      'biography',
      'profile_picture_url',
      'followers_count',
      'follows_count',
      'media_count',
      'media{id,caption,media_type,media_product_type,permalink,timestamp,media_url,thumbnail_url}',
    ].join(',');

    const queryUrl = `${this.GRAPH_API_BASE}/${creds.graphVersion}/${creds.instagramAccountId}?fields=business_discovery.username(${username}){${fields}}&access_token=${encodeURIComponent(
      creds.accessToken
    )}`;

    try {
      const res = await fetch(queryUrl, {
        method: 'GET',
        headers: { Accept: 'application/json' },
      });

      const data = (await res.json()) as {
        error?: { message?: string; code?: number; error_subcode?: number };
        business_discovery?: MetaBusinessDiscoveryProfile;
      };

      // Check Meta API errors
      if (!res.ok || data.error) {
        const errorMsg = data.error?.message || `HTTP ${res.status}`;
        const errorCode = data.error?.code;
        const errorSubcode = data.error?.error_subcode;

        // Subcode 2108006 or specific message: target is not a business account
        if (
          errorSubcode === 2108006 ||
          errorMsg.toLowerCase().includes('not a business') ||
          errorMsg.toLowerCase().includes('nonexisting field')
        ) {
          return {
            targetUsername: username,
            authenticated: true,
            eligible: false,
            status: 'PROFILE_NOT_ELIGIBLE',
            reason: `Target @${username} is not an Instagram Business or Creator account. Meta Business Discovery requires the target to be a Professional account.`,
            mediaUrlAvailable: false,
            checkedAt,
          };
        }

        // Token invalid / expired
        if (errorCode === 190) {
          return {
            targetUsername: username,
            authenticated: false,
            eligible: false,
            status: 'AUTHORIZATION_REQUIRED',
            reason: `Meta OAuth token validation failed: ${errorMsg}`,
            mediaUrlAvailable: false,
            checkedAt,
          };
        }

        return {
          targetUsername: username,
          authenticated: true,
          eligible: false,
          status: 'RETRIEVAL_FAILED',
          reason: `Meta Graph API error (${errorCode}): ${errorMsg}`,
          mediaUrlAvailable: false,
          checkedAt,
        };
      }

      // Success: Profile is an eligible Business/Creator account
      const profileData = data.business_discovery;
      if (!profileData) {
        return {
          targetUsername: username,
          authenticated: true,
          eligible: false,
          status: 'PROFILE_NOT_ELIGIBLE',
          reason: `No business discovery record returned by Meta for @${username}.`,
          mediaUrlAvailable: false,
          checkedAt,
        };
      }

      // 3. Inspect recent media and filter for newest eligible Reel
      const mediaList = profileData.media?.data || [];
      const videoReels = mediaList.filter(
        (m) =>
          m.media_type === 'VIDEO' ||
          m.media_product_type === 'REELS' ||
          (m.permalink && m.permalink.includes('/reel/'))
      );

      // Sort newest first by timestamp
      videoReels.sort(
        (a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
      );

      const newestReel = videoReels[0];

      if (!newestReel) {
        return {
          targetUsername: username,
          authenticated: true,
          eligible: true,
          status: 'PROFILE_ACCESSIBLE',
          reason: `Profile @${username} is an eligible Professional account, but no eligible Reels were found in recent media.`,
          profile: profileData,
          mediaUrlAvailable: false,
          checkedAt,
        };
      }

      const mediaUrlAvailable = Boolean(newestReel.media_url);

      return {
        targetUsername: username,
        authenticated: true,
        eligible: true,
        status: mediaUrlAvailable ? 'MEDIA_URL_AVAILABLE' : 'WAITING_FOR_AUTHORIZED_MEDIA',
        reason: mediaUrlAvailable
          ? `Discovered latest Reel (${newestReel.id}) with direct media URL.`
          : `Discovered latest Reel (${newestReel.id}), but direct media_url is gated or requires creator-level media authorization.`,
        profile: profileData,
        newestReel,
        mediaUrlAvailable,
        checkedAt,
      };
    } catch (fetchErr) {
      return {
        targetUsername: username,
        authenticated: true,
        eligible: false,
        status: 'RETRIEVAL_FAILED',
        reason: `Network request to Meta Graph API failed: ${(fetchErr as Error).message}`,
        mediaUrlAvailable: false,
        checkedAt,
      };
    }
  }

  /**
   * Fetches the video stream from a verified media URL with bounded memory
   * and verifies MP4 container signatures (Zero local SSD writes).
   */
  static async validateAndStreamMedia(mediaUrl: string): Promise<VideoStreamValidationResult> {
    if (!mediaUrl || !mediaUrl.startsWith('http')) {
      return {
        success: false,
        status: 'WAITING_FOR_AUTHORIZED_MEDIA',
        totalBytesStreamed: 0,
        peakHeapDeltaMB: 0,
        diskBytesWritten: 0,
        error: 'Invalid or missing media stream URL.',
      };
    }

    const initialHeap = process.memoryUsage().heapUsed;

    try {
      // 1. Fetch headers (HEAD)
      const headRes = await fetch(mediaUrl, { method: 'HEAD' });
      const contentType = headRes.headers.get('content-type') || '';
      const contentLengthStr = headRes.headers.get('content-length');
      const contentLength = contentLengthStr ? parseInt(contentLengthStr, 10) : undefined;

      // 2. Stream video body
      const getRes = await fetch(mediaUrl);
      if (!getRes.ok || !getRes.body) {
        return {
          success: false,
          status: 'RETRIEVAL_FAILED',
          httpStatus: getRes.status,
          contentType,
          contentLength,
          totalBytesStreamed: 0,
          peakHeapDeltaMB: 0,
          diskBytesWritten: 0,
          error: `HTTP ${getRes.status} received when requesting media stream`,
        };
      }

      const reader = getRes.body.getReader();
      let totalBytesStreamed = 0;
      let atomType: string | undefined;
      let majorBrand: string | undefined;
      let atomSize: number | undefined;

      // Read first chunk to inspect MP4 container signature
      const firstChunk = await reader.read();
      if (firstChunk.value && firstChunk.value.byteLength >= 12) {
        const val = firstChunk.value;
        totalBytesStreamed += val.byteLength;

        const headerBuf = Buffer.from(val.buffer, val.byteOffset, val.byteLength);
        atomSize = headerBuf.readUInt32BE(0);
        atomType = headerBuf.toString('ascii', 4, 8);
        majorBrand = headerBuf.toString('ascii', 8, 12);
      }

      // Stream remainder using bounded memory chunks (Zero disk writes)
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (value) {
          totalBytesStreamed += value.byteLength;
        }
      }

      const finalHeap = process.memoryUsage().heapUsed;
      const peakHeapDeltaMB = Math.max(0, (finalHeap - initialHeap) / 1024 / 1024);

      const isMp4Valid = atomType === 'ftyp' && Boolean(majorBrand);

      return {
        success: isMp4Valid,
        status: isMp4Valid ? 'MEDIA_RETRIEVED' : 'RETRIEVAL_FAILED',
        httpStatus: getRes.status,
        contentType: contentType || 'video/mp4',
        contentLength: contentLength || totalBytesStreamed,
        atomType,
        majorBrand,
        atomSize,
        totalBytesStreamed,
        peakHeapDeltaMB: parseFloat(peakHeapDeltaMB.toFixed(2)),
        diskBytesWritten: 0, // Strict invariant
        error: isMp4Valid ? undefined : `Invalid MP4 container signature: atom="${atomType}"`,
      };
    } catch (streamErr) {
      return {
        success: false,
        status: 'RETRIEVAL_FAILED',
        totalBytesStreamed: 0,
        peakHeapDeltaMB: 0,
        diskBytesWritten: 0,
        error: `Stream retrieval error: ${(streamErr as Error).message}`,
      };
    }
  }
}

/**
 * Monitoring Adapter implementing IMonitoringAdapter using Meta Business Discovery
 */
export class InstagramBusinessDiscoveryAdapter implements IMonitoringAdapter {
  readonly name = 'InstagramBusinessDiscoveryAdapter';

  async checkProfile(profileUrl: string): Promise<ProfileCheckResult> {
    const { username, cleanUrl } = normalizeProfileUrl(profileUrl);
    const checkedAt = new Date().toISOString();

    const result = await InstagramBusinessDiscoveryService.queryProfileAndMedia(username);

    if (result.status === 'PROFILE_ACCESSIBLE' || result.status === 'REEL_DETECTED' || result.status === 'MEDIA_URL_AVAILABLE' || result.status === 'WAITING_FOR_AUTHORIZED_MEDIA') {
      return {
        accessible: true,
        username,
        profile_url: cleanUrl,
        status: 'ACTIVE',
        status_reason: result.reason,
        avatar_url: result.profile?.profile_picture_url,
        display_name: result.profile?.name || `@${username}`,
        checked_at: checkedAt,
      };
    }

    if (result.status === 'PROFILE_NOT_ELIGIBLE') {
      return {
        accessible: false,
        username,
        profile_url: cleanUrl,
        status: 'RESTRICTED',
        status_reason: result.reason,
        checked_at: checkedAt,
      };
    }

    // Authorization required or error
    return {
      accessible: false,
      username,
      profile_url: cleanUrl,
      status: 'RESTRICTED',
      status_reason: result.reason,
      checked_at: checkedAt,
    };
  }

  async discoverReels(profile: MonitoredProfile, since?: string | null): Promise<ReelsDiscoveryResult> {
    const checkedAt = new Date().toISOString();
    const result = await InstagramBusinessDiscoveryService.queryProfileAndMedia(profile.username);

    if (!result.eligible || !result.newestReel) {
      return {
        profile_id: profile.id,
        new_reels: [],
        total_discovered: 0,
        checked_at: checkedAt,
        notes: result.reason,
      };
    }

    const reel = result.newestReel;
    // Check if newer than since timestamp
    if (since && new Date(reel.timestamp).getTime() <= new Date(since).getTime()) {
      return {
        profile_id: profile.id,
        new_reels: [],
        total_discovered: 0,
        checked_at: checkedAt,
        notes: 'No new reels since last check timestamp.',
      };
    }

    const discovered: DiscoveredReel = {
      reel_id: reel.id,
      permalink: reel.permalink,
      caption: reel.caption || `Reel on @${profile.username}`,
      thumbnail_url: reel.thumbnail_url || reel.media_url || profile.avatar_url,
      video_source_url: reel.media_url,
      published_at: reel.timestamp,
    };

    return {
      profile_id: profile.id,
      new_reels: [discovered],
      total_discovered: 1,
      checked_at: checkedAt,
      notes: result.reason,
    };
  }
}
