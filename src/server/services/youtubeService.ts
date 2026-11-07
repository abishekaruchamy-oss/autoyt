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

    const data = await res.json();
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
        privacyStatus: metadata.privacyStatus || 'public',
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
      if (err.includes('quotaExceeded')) {
        throw new Error(
          'YouTube Data API quota exceeded (10,000 units/day limit). Each upload costs 1,600 units (~6 uploads/day on free tier).'
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
   * Streams video binary from source directly to YouTube Resumable Session URI
   */
  static async streamVideoToYouTube(
    sourceVideoUrl: string,
    metadata: {
      caption: string;
      username: string;
      privacyStatus?: 'public' | 'unlisted' | 'private';
    },
    accessToken: string
  ): Promise<YouTubeUploadResult> {
    // 1. Fetch source video Content-Length
    const headRes = await fetch(sourceVideoUrl, { method: 'HEAD' });
    const contentLength = headRes.headers.get('content-length');
    const totalBytes = contentLength ? parseInt(contentLength, 10) : 0;

    if (!totalBytes || totalBytes <= 0) {
      throw new Error('Source video Content-Length is missing or zero.');
    }

    // 2. Initiate resumable upload session
    const { sessionUri, title } = await this.initiateResumableUpload(
      {
        caption: metadata.caption,
        username: metadata.username,
        privacyStatus: metadata.privacyStatus,
        sizeBytes: totalBytes,
      },
      accessToken
    );

    // 3. Stream binary directly to YouTube in 5MB chunks (or full stream)
    const streamRes = await fetch(sourceVideoUrl);
    if (!streamRes.ok || !streamRes.body) {
      throw new Error(`Failed to fetch source video stream: HTTP ${streamRes.status}`);
    }

    const reader = streamRes.body.getReader();
    let uploadedBytes = 0;
    const CHUNK_SIZE = 5 * 1024 * 1024;
    let buffer = new Uint8Array(CHUNK_SIZE);
    let bufferOffset = 0;
    let uploadResponseData: any = null;

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

    if (!uploadResponseData || !uploadResponseData.id) {
      throw new Error('Video stream completed, but YouTube did not return a valid video ID.');
    }

    const videoId = uploadResponseData.id;
    return {
      videoId,
      videoUrl: `https://youtube.com/shorts/${videoId}`,
      title,
      privacyStatus: metadata.privacyStatus || 'public',
      publishedAt: new Date().toISOString(),
    };
  }
}
