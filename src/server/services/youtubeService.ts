import { formatCaptionForYouTube } from '../monitoring/adapter';

export interface YouTubeUploadMetadata {
  caption: string;
  username: string;
  privacyStatus?: 'public' | 'unlisted' | 'private';
  tags?: string[];
  sizeBytes: number;
}

export interface YouTubeUploadResult {
  videoId: string;
  videoUrl: string;
  title: string;
  privacyStatus: string;
  publishedAt: string;
  sessionUri?: string;
}

export interface YouTubeResumableStatus {
  isComplete: boolean;
  bytesReceived: number;
  videoId?: string;
  videoUrl?: string;
}

export interface YouTubeChannelInfo {
  id: string;
  title: string;
  description?: string;
  customUrl?: string;
  subscriberCount?: string;
  videoCount?: string;
  thumbnailUrl?: string;
}

export class YouTubeService {
  /**
   * Retrieves primary authorized YouTube Channel details
   */
  static async getChannelDetails(accessToken: string): Promise<YouTubeChannelInfo> {
    const url =
      'https://www.googleapis.com/youtube/v3/channels?part=snippet,contentDetails,statistics&mine=true';

    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });

    if (!res.ok) {
      const err = await res.text();
      if (err.includes('quotaExceeded')) {
        throw new Error(
          'YouTube API daily quota exceeded (10,000 units/day limit). Quota resets at 00:00 PST.'
        );
      }
      throw new Error(`Failed to fetch YouTube channel details: ${err}`);
    }

    const data = (await res.json()) as {
      items?: Array<{
        id: string;
        snippet: {
          title: string;
          description?: string;
          customUrl?: string;
          thumbnails?: { default?: { url?: string } };
        };
        statistics?: {
          subscriberCount?: string;
          videoCount?: string;
        };
      }>;
    };
    if (!data.items || data.items.length === 0) {
      throw new Error(
        'No YouTube channel found for the authorized Google account. Please create a channel on YouTube first.'
      );
    }

    const channel = data.items[0];
    return {
      id: channel.id,
      title: channel.snippet.title,
      description: channel.snippet.description,
      customUrl: channel.snippet.customUrl,
      subscriberCount: channel.statistics?.subscriberCount,
      videoCount: channel.statistics?.videoCount,
      thumbnailUrl: channel.snippet.thumbnails?.default?.url,
    };
  }

  /**
   * Initiates a YouTube Resumable Upload session (YouTube Data API v3)
   */
  static async initiateResumableUpload(
    metadata: YouTubeUploadMetadata,
    accessToken: string
  ): Promise<{ sessionUri: string; title: string; description: string }> {
    const { title, description } = formatCaptionForYouTube(metadata.caption, metadata.username);

    const initUrl =
      'https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status';

    const requestBody = {
      snippet: {
        title,
        description,
        tags: metadata.tags || ['shorts', 'instagram', 'reels', metadata.username],
        categoryId: '22', // People & Blogs
      },
      status: {
        privacyStatus: metadata.privacyStatus || 'private',
        selfDeclaredMadeForKids: false,
        embeddable: true,
      },
    };

    const res = await fetch(initUrl, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json; charset=UTF-8',
        'X-Upload-Content-Type': 'video/mp4',
        'X-Upload-Content-Length': metadata.sizeBytes.toString(),
      },
      body: JSON.stringify(requestBody),
    });

    if (!res.ok) {
      const err = await res.text();
      if (err.includes('quotaExceeded') || err.includes('uploadLimitExceeded')) {
        throw new Error(
          'YouTube upload limit or Data API quota exceeded. Note: YouTube enforces a separate daily video upload bucket (default limit is approximately 100 uploads/day) alongside the general API quota.'
        );
      }
      throw new Error(`Failed to initiate YouTube resumable upload: ${err}`);
    }

    const sessionUri = res.headers.get('Location');
    if (!sessionUri) {
      throw new Error('YouTube did not return a resumable session URI.');
    }

    return { sessionUri, title, description };
  }

  /**
   * Queries status of an interrupted YouTube resumable upload session
   */
  static async queryResumableStatus(
    sessionUri: string,
    totalBytes: number
  ): Promise<YouTubeResumableStatus> {
    const res = await fetch(sessionUri, {
      method: 'PUT',
      headers: {
        'Content-Range': `bytes */${totalBytes}`,
      },
    });

    if (res.status === 200 || res.status === 201) {
      const data = (await res.json().catch(() => ({}))) as { id?: string };
      const videoId = data?.id;
      return {
        isComplete: true,
        bytesReceived: totalBytes,
        videoId,
        videoUrl: videoId ? `https://youtube.com/shorts/${videoId}` : undefined,
      };
    }

    if (res.status === 308) {
      const range = res.headers.get('Range');
      if (range) {
        const match = range.match(/bytes=0-(\d+)/);
        if (match) {
          return { isComplete: false, bytesReceived: parseInt(match[1], 10) + 1 };
        }
      }
      return { isComplete: false, bytesReceived: 0 };
    }

    if (res.status === 404 || res.status === 410) {
      return { isComplete: false, bytesReceived: 0 };
    }

    throw new Error(`Unexpected status querying YouTube resumable upload: ${res.status}`);
  }

  /**
   * Streams video binary from source directly to YouTube Resumable Session URI.
   * Supports authenticated source streams (e.g. Google Drive), session URI persistence,
   * and crash recovery.
   */
  static async streamVideoToYouTube(
    sourceVideoUrl: string,
    metadata: {
      caption: string;
      username: string;
      privacyStatus?: 'public' | 'unlisted' | 'private';
    },
    accessToken: string,
    options?: {
      sourceHeaders?: Record<string, string>;
      sessionUri?: string;
      onSessionInitiated?: (sessionUri: string) => Promise<void> | void;
    }
  ): Promise<YouTubeUploadResult> {
    // 1. Fetch source video Content-Length with optional sourceHeaders (e.g. Google Drive auth)
    const headRes = await fetch(sourceVideoUrl, {
      method: 'HEAD',
      headers: options?.sourceHeaders,
    });
    const contentLength = headRes.headers.get('content-length');
    const totalBytes = contentLength ? parseInt(contentLength, 10) : 0;

    if (!totalBytes || totalBytes <= 0) {
      throw new Error('Source video Content-Length is missing or zero.');
    }

    // 2. Obtain or initiate resumable upload session
    let sessionUri = options?.sessionUri;
    let title = metadata.caption;

    if (!sessionUri) {
      const initiated = await this.initiateResumableUpload(
        {
          caption: metadata.caption,
          username: metadata.username,
          privacyStatus: metadata.privacyStatus,
          sizeBytes: totalBytes,
        },
        accessToken
      );
      sessionUri = initiated.sessionUri;
      title = initiated.title;

      if (options?.onSessionInitiated) {
        await options.onSessionInitiated(sessionUri);
      }
    } else {
      // Existing session supplied: check if session has already completed before re-uploading chunks
      try {
        const existingStatus = await this.queryResumableStatus(sessionUri, totalBytes);
        if (existingStatus.isComplete && existingStatus.videoId) {
          return {
            videoId: existingStatus.videoId,
            videoUrl: existingStatus.videoUrl || `https://youtube.com/shorts/${existingStatus.videoId}`,
            title,
            privacyStatus: metadata.privacyStatus || 'private',
            publishedAt: new Date().toISOString(),
            sessionUri,
          };
        }
      } catch {
        // Proceed with streaming if query fails or is incomplete
      }
    }

    // 3. Stream binary directly to YouTube in 5MB chunks (or full stream)
    const streamRes = await fetch(sourceVideoUrl, {
      headers: options?.sourceHeaders,
    });
    if (!streamRes.ok || !streamRes.body) {
      throw new Error(`Failed to fetch source video stream: HTTP ${streamRes.status}`);
    }

    const reader = streamRes.body.getReader();
    let uploadedBytes = 0;
    const CHUNK_SIZE = 5 * 1024 * 1024;
    let buffer = new Uint8Array(CHUNK_SIZE);
    let bufferOffset = 0;
    let uploadResponseData: any = null;

    try {
      while (true) {
        const { done, value } = await reader.read();

        if (value) {
          let chunkRemaining = value;
          while (chunkRemaining.length > 0) {
            const space = CHUNK_SIZE - bufferOffset;
            if (chunkRemaining.length < space) {
              buffer.set(chunkRemaining, bufferOffset);
              bufferOffset += chunkRemaining.length;
              break;
            } else {
              buffer.set(chunkRemaining.subarray(0, space), bufferOffset);
              const chunkToUpload = buffer.subarray(0, CHUNK_SIZE);
              const endByte = uploadedBytes + CHUNK_SIZE - 1;

              const uploadRes = await fetch(sessionUri, {
                method: 'PUT',
                headers: {
                  'Content-Type': 'video/mp4',
                  'Content-Range': `bytes ${uploadedBytes}-${endByte}/${totalBytes}`,
                },
                body: chunkToUpload as unknown as BodyInit,
              });

              if (uploadRes.status === 200 || uploadRes.status === 201) {
                uploadResponseData = await uploadRes.json();
              } else if (uploadRes.status !== 308) {
                const err = await uploadRes.text();
                throw new Error(`YouTube upload chunk failed with HTTP ${uploadRes.status}: ${err}`);
              }

              uploadedBytes += CHUNK_SIZE;
              chunkRemaining = chunkRemaining.subarray(space);
              buffer = new Uint8Array(CHUNK_SIZE);
              bufferOffset = 0;
            }
          }
        }

        if (done) {
          if (bufferOffset > 0) {
            const lastChunk = buffer.subarray(0, bufferOffset);
            const endByte = uploadedBytes + bufferOffset - 1;

            const uploadRes = await fetch(sessionUri, {
              method: 'PUT',
              headers: {
                'Content-Type': 'video/mp4',
                'Content-Range': `bytes ${uploadedBytes}-${endByte}/${totalBytes}`,
              },
              body: lastChunk as unknown as BodyInit,
            });

            if (uploadRes.status === 200 || uploadRes.status === 201) {
              uploadResponseData = await uploadRes.json();
            } else {
              const err = await uploadRes.text();
              throw new Error(`Final YouTube chunk failed with HTTP ${uploadRes.status}: ${err}`);
            }
          }
          break;
        }
      }
    } catch (uploadErr: any) {
      // Attach the established session URI to enable ambiguous upload reconciliation
      uploadErr.sessionUri = sessionUri;
      throw uploadErr;
    }

    if (!uploadResponseData || !uploadResponseData.id) {
      const ambiguousErr: any = new Error(
        'Video stream completed, but YouTube response did not contain a valid video ID.'
      );
      ambiguousErr.sessionUri = sessionUri;
      throw ambiguousErr;
    }

    const videoId = uploadResponseData.id;
    return {
      videoId,
      videoUrl: `https://youtube.com/shorts/${videoId}`,
      title,
      privacyStatus: metadata.privacyStatus || 'private',
      publishedAt: new Date().toISOString(),
      sessionUri,
    };
  }
}
