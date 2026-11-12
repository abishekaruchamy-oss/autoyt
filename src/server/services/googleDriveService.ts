export interface DriveUploadResult {
  fileId: string;
  name: string;
  webViewLink?: string;
  webContentLink?: string;
  sizeBytes?: number;
}

export interface DriveResumableStatus {
  isComplete: boolean;
  bytesReceived: number;
}

export interface DriveFileMetadata {
  id: string;
  name: string;
  sizeBytes: number;
  mimeType: string;
  md5Checksum?: string;
  webViewLink?: string;
  webContentLink?: string;
  trashed: boolean;
}

export class GoogleDriveService {
  /**
   * Returns authenticated media stream download URL for a Google Drive file
   */
  static getMediaDownloadUrl(fileId: string): string {
    return `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?alt=media`;
  }

  /**
   * Returns required HTTP authorization headers for accessing Drive file media
   */
  static getAuthHeaders(accessToken: string): Record<string, string> {
    return {
      Authorization: `Bearer ${accessToken}`,
    };
  }

  /**
   * Retrieves verified file metadata (size, MIME type, md5 checksum) from Google Drive API
   */
  static async getFileMetadata(fileId: string, accessToken: string): Promise<DriveFileMetadata> {
    const fields = 'id,name,size,mimeType,md5Checksum,webViewLink,webContentLink,trashed';
    const res = await fetch(`https://www.googleapis.com/drive/v3/files/${fileId}?fields=${encodeURIComponent(fields)}`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });

    if (!res.ok) {
      const err = await res.text();
      throw new Error(`Failed to fetch Drive file metadata for ${fileId}: ${err}`);
    }

    const data = (await res.json()) as {
      id: string;
      name: string;
      size?: string;
      mimeType?: string;
      md5Checksum?: string;
      webViewLink?: string;
      webContentLink?: string;
      trashed?: boolean;
    };
    return {
      id: data.id,
      name: data.name,
      sizeBytes: data.size ? parseInt(data.size, 10) : 0,
      mimeType: data.mimeType || 'unknown',
      md5Checksum: data.md5Checksum,
      webViewLink: data.webViewLink,
      webContentLink: data.webContentLink,
      trashed: Boolean(data.trashed),
    };
  }
  /**
   * Finds an existing folder by name or creates it in Google Drive root
   */
  static async getOrCreateFolder(folderName: string, accessToken: string): Promise<string> {
    const cleanName = folderName.replace(/'/g, "\\'");
    const query = `name = '${cleanName}' and mimeType = 'application/vnd.google-apps.folder' and trashed = false`;
    const searchUrl = `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(
      query
    )}&fields=files(id,name)`;

    const res = await fetch(searchUrl, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });

    if (!res.ok) {
      const err = await res.text();
      throw new Error(`Google Drive folder search failed: ${err}`);
    }

    const data = (await res.json()) as { files?: Array<{ id: string; name: string }> };
    if (data.files && data.files.length > 0) {
      return data.files[0].id;
    }

    // Create new folder
    const createRes = await fetch('https://www.googleapis.com/drive/v3/files', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        name: folderName,
        mimeType: 'application/vnd.google-apps.folder',
      }),
    });

    if (!createRes.ok) {
      const err = await createRes.text();
      throw new Error(`Failed to create Google Drive folder: ${err}`);
    }

    const newFolder = (await createRes.json()) as { id: string; name: string };
    return newFolder.id;
  }

  /**
   * Checks whether a video file with the exact name already exists in the destination folder
   */
  static async checkFileExists(
    fileName: string,
    folderId: string,
    accessToken: string
  ): Promise<string | null> {
    const cleanName = fileName.replace(/'/g, "\\'");
    const query = `name = '${cleanName}' and '${folderId}' in parents and trashed = false`;
    const searchUrl = `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(
      query
    )}&fields=files(id,name,webViewLink)`;

    const res = await fetch(searchUrl, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });

    if (!res.ok) return null;
    const data = (await res.json()) as { files?: Array<{ id: string; name: string }> };
    if (data.files && data.files.length > 0) {
      return data.files[0].id;
    }
    return null;
  }

  /**
   * Initiates a Resumable Upload session for video files
   */
  static async initiateResumableUpload(
    metadata: {
      name: string;
      folderId: string;
      sizeBytes: number;
      description?: string;
    },
    accessToken: string
  ): Promise<string> {
    const initUrl = 'https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable';
    const body = {
      name: metadata.name,
      parents: [metadata.folderId],
      description: metadata.description || 'Archived Instagram Reel via AutoShorts',
      properties: {
        archived_by: 'AutoShorts',
        source: 'Instagram',
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
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const err = await res.text();
      throw new Error(`Failed to initiate Drive resumable upload: ${err}`);
    }

    const sessionUri = res.headers.get('Location');
    if (!sessionUri) {
      throw new Error('Google Drive did not return a resumable session URI.');
    }

    return sessionUri;
  }

  /**
   * Queries status of an interrupted resumable upload session
   */
  static async queryResumableStatus(
    sessionUri: string,
    totalBytes: number
  ): Promise<DriveResumableStatus> {
    const res = await fetch(sessionUri, {
      method: 'PUT',
      headers: {
        'Content-Range': `bytes */${totalBytes}`,
      },
    });

    if (res.status === 200 || res.status === 201) {
      return { isComplete: true, bytesReceived: totalBytes };
    }

    if (res.status === 308) {
      // 308 Resume Incomplete
      const range = res.headers.get('Range');
      if (range) {
        const match = range.match(/bytes=0-(\d+)/);
        if (match) {
          return { isComplete: false, bytesReceived: parseInt(match[1], 10) + 1 };
        }
      }
      return { isComplete: false, bytesReceived: 0 };
    }

    throw new Error(`Unexpected status querying resumable upload: ${res.status}`);
  }

  /**
   * Uploads binary video chunk / stream to an established resumable session URI
   */
  static async uploadStreamChunk(
    sessionUri: string,
    chunkBuffer: Uint8Array,
    startByte: number,
    totalBytes: number
  ): Promise<DriveUploadResult | null> {
    const endByte = startByte + chunkBuffer.byteLength - 1;

    const res = await fetch(sessionUri, {
      method: 'PUT',
      headers: {
        'Content-Type': 'video/mp4',
        'Content-Range': `bytes ${startByte}-${endByte}/${totalBytes}`,
      },
      body: chunkBuffer as unknown as BodyInit,
    });

    if (res.status === 200 || res.status === 201) {
      const file = (await res.json()) as { id: string; name: string };
      return {
        fileId: file.id,
        name: file.name,
        webViewLink: `https://drive.google.com/file/d/${file.id}/view`,
        sizeBytes: totalBytes,
      };
    }

    if (res.status === 308) {
      return null; // Chunk uploaded, more chunks required
    }

    const err = await res.text();
    throw new Error(`Drive chunk upload failed with HTTP ${res.status}: ${err}`);
  }

  /**
   * Streams video from a source URL directly into Google Drive without buffering whole file in RAM
   */
  static async streamVideoToDrive(
    sourceVideoUrl: string,
    destinationFileName: string,
    folderId: string,
    accessToken: string
  ): Promise<DriveUploadResult> {
    // 1. Check if file already exists in target folder (Deduplication)
    const existingFileId = await this.checkFileExists(destinationFileName, folderId, accessToken);
    if (existingFileId) {
      return {
        fileId: existingFileId,
        name: destinationFileName,
        webViewLink: `https://drive.google.com/file/d/${existingFileId}/view`,
      };
    }

    // 2. Fetch video headers to obtain total content length
    const headRes = await fetch(sourceVideoUrl, { method: 'HEAD' });
    const contentLength = headRes.headers.get('content-length');
    const totalBytes = contentLength ? parseInt(contentLength, 10) : 0;

    if (!totalBytes || totalBytes <= 0) {
      throw new Error('Source video Content-Length is missing or zero.');
    }

    // 3. Initiate resumable session
    const sessionUri = await this.initiateResumableUpload(
      {
        name: destinationFileName,
        folderId,
        sizeBytes: totalBytes,
      },
      accessToken
    );

    // 4. Stream response and upload in 5MB chunks (or full stream if small)
    const videoStreamRes = await fetch(sourceVideoUrl);
    if (!videoStreamRes.ok || !videoStreamRes.body) {
      throw new Error(`Failed to fetch source video stream: HTTP ${videoStreamRes.status}`);
    }

    // Stream consumption into chunks to avoid high memory spikes
    const reader = videoStreamRes.body.getReader();
    let uploadedBytes = 0;
    const CHUNK_SIZE = 5 * 1024 * 1024; // 5 MB chunks recommended by Google Drive
    let buffer = new Uint8Array(CHUNK_SIZE);
    let bufferOffset = 0;
    let finalResult: DriveUploadResult | null = null;

    while (true) {
      const { done, value } = await reader.read();

      if (value) {
        let chunkRemaining = value;
        while (chunkRemaining.length > 0) {
          const spaceInBuffer = CHUNK_SIZE - bufferOffset;
          if (chunkRemaining.length < spaceInBuffer) {
            buffer.set(chunkRemaining, bufferOffset);
            bufferOffset += chunkRemaining.length;
            break;
          } else {
            // Buffer full, upload chunk
            buffer.set(chunkRemaining.subarray(0, spaceInBuffer), bufferOffset);
            const uploadChunk = buffer.subarray(0, CHUNK_SIZE);
            finalResult = await this.uploadStreamChunk(
              sessionUri,
              uploadChunk,
              uploadedBytes,
              totalBytes
            );
            uploadedBytes += CHUNK_SIZE;

            chunkRemaining = chunkRemaining.subarray(spaceInBuffer);
            buffer = new Uint8Array(CHUNK_SIZE);
            bufferOffset = 0;
          }
        }
      }

      if (done) {
        // Upload any remaining buffer bytes
        if (bufferOffset > 0) {
          const lastChunk = buffer.subarray(0, bufferOffset);
          finalResult = await this.uploadStreamChunk(
            sessionUri,
            lastChunk,
            uploadedBytes,
            totalBytes
          );
        }
        break;
      }
    }

    if (!finalResult) {
      throw new Error('Resumable stream finished but Drive did not return file metadata.');
    }

    return finalResult;
  }

  /**
   * Fetches real Google Drive account storage quota when available from Google Drive API.
   * Never fabricates usage metrics when quota fields are unavailable or inaccessible.
   */
  static async getStorageQuota(accessToken: string): Promise<{
    available: boolean;
    usedBytes: number | null;
    totalBytes: number | null;
    note?: string;
  }> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 2500);
    try {
      const res = await fetch(
        'https://www.googleapis.com/drive/v3/about?fields=storageQuota(limit,usage,usageInDrive)',
        {
          headers: { Authorization: `Bearer ${accessToken}` },
          signal: controller.signal,
        }
      );

      if (!res.ok) {
        return {
          available: false,
          usedBytes: null,
          totalBytes: null,
          note: `Google Drive quota unavailable (HTTP ${res.status}).`,
        };
      }

      const data = (await res.json()) as {
        storageQuota?: { limit?: string; usage?: string; usageInDrive?: string };
      };
      const quota = data.storageQuota;
      const usedRaw = quota?.usage ?? quota?.usageInDrive;
      const limitRaw = quota?.limit;

      const usedBytes = usedRaw !== undefined ? Number(usedRaw) : NaN;
      const totalBytes = limitRaw !== undefined ? Number(limitRaw) : NaN;

      if (!Number.isFinite(usedBytes) || !Number.isFinite(totalBytes) || totalBytes <= 0) {
        return {
          available: false,
          usedBytes: null,
          totalBytes: null,
          note: 'Google Drive storage quota not returned for current OAuth scope.',
        };
      }

      return {
        available: true,
        usedBytes,
        totalBytes,
      };
    } catch {
      return {
        available: false,
        usedBytes: null,
        totalBytes: null,
        note: 'Google Drive quota lookup timed out or is currently unreachable.',
      };
    } finally {
      clearTimeout(timer);
    }
  }
}
