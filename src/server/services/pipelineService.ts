import { Repository } from '../db/repository';
import {
  StandardPublicWebAdapter,
  PermittedSandboxAdapter,
  ReelDeduplicationStore,
} from '../monitoring/adapter';
import {
  InstagramBusinessDiscoveryAdapter,
  InstagramBusinessDiscoveryService,
} from '../monitoring/businessDiscovery';
import { GoogleDriveService } from './googleDriveService';
import { YouTubeService } from './youtubeService';
import {
  getValidDriveAccessToken,
  getValidYouTubeAccessToken,
  isDriveConnected,
  isYouTubeConnected,
} from './googleAuthService';
import {
  MonitoredProfile,
  UploadJob,
  DiscoveredReel,
  ReelSubmissionPayload,
  ExecutionReadiness,
  DashboardMetrics,
} from '@/types';
import { extractReelShortcode, MediaResolver } from '../media/MediaResolver';
import {
  isInstagramWebpageUrl,
  probeUpstreamVideoStream,
  verifyMp4ContainerSignature,
  redactMediaUrl,
} from '../media/streamValidation';
import { encryptToken, decryptToken } from '@/lib/crypto';
import { formatBytes } from '@/lib/utils';

function buildAttributedCaption(rawCaption: string | undefined, username: string, shortcode: string): string {
  const cleanUser = (username || 'creator').replace(/^@/, '').trim() || 'creator';
  const base = (rawCaption || '').trim() || `Instagram Reel #${shortcode}`;
  if (cleanUser === 'creator') return base;
  if (base.toLowerCase().includes(`@${cleanUser.toLowerCase()}`)) {
    return base;
  }
  return `${base} | Credit: @${cleanUser}`;
}

export interface PipelineSyncOptions {
  profileId?: string;
  force?: boolean;
  sandbox?: boolean;
}

export interface PipelineSyncResult {
  success: boolean;
  skipped?: boolean;
  reason?: string;
  readiness?: ExecutionReadiness;
  profilesChecked: number;
  reelsDetected: number;
  jobsProcessed: number;
  jobsSucceeded: number;
  jobsFailed: number;
  details: string[];
}

export class PipelineService {
  /**
   * Main automation sync orchestrator:
   * 1. Acquires concurrency lock
   * 2. Inspects active monitored profile(s)
   * 3. Discovers new Reels using permitted adapter
   * 4. Enforces deduplication
   * 5. Performs streaming upload to Google Drive
   * 6. Performs streaming upload to YouTube Shorts with formatting rules
   * 7. Releases lock and records execution log
   */
  static async runSync(options?: PipelineSyncOptions): Promise<PipelineSyncResult> {
    const automation = await Repository.getAutomationSettings();

    // 1. Check automation enabled status
    if (!automation.is_enabled && !options?.force) {
      return {
        success: false,
        skipped: true,
        reason: 'Automation is currently disabled in settings.',
        profilesChecked: 0,
        reelsDetected: 0,
        jobsProcessed: 0,
        jobsSucceeded: 0,
        jobsFailed: 0,
        details: ['Sync skipped: Automation is disabled.'],
      };
    }

    // 1b. Check execution readiness before running live sync/scheduled upload automation
    const readiness = await Repository.evaluateExecutionReadiness();
    if (!options?.sandbox && !readiness.ready_for_live_upload) {
      return {
        success: false,
        skipped: true,
        reason: `Execution readiness check failed: ${readiness.blocking_reasons.join(' ')}`,
        readiness,
        profilesChecked: 0,
        reelsDetected: 0,
        jobsProcessed: 0,
        jobsSucceeded: 0,
        jobsFailed: 0,
        details: readiness.blocking_reasons,
      };
    }

    // 2. Concurrency Lock
    const lockAcquired = await Repository.acquireAutomationLock();
    if (!lockAcquired) {
      return {
        success: false,
        skipped: true,
        reason: 'Execution lock is currently active. Another sync is running.',
        profilesChecked: 0,
        reelsDetected: 0,
        jobsProcessed: 0,
        jobsSucceeded: 0,
        jobsFailed: 0,
        details: ['Sync skipped: Lock held.'],
      };
    }

    const result: PipelineSyncResult = {
      success: true,
      profilesChecked: 0,
      reelsDetected: 0,
      jobsProcessed: 0,
      jobsSucceeded: 0,
      jobsFailed: 0,
      details: [],
    };

    try {
      // 3. Resolve target profiles
      let targetProfiles: MonitoredProfile[] = [];
      if (options?.profileId) {
        const p = await Repository.getMonitoredProfileById(options.profileId);
        if (p) targetProfiles = [p];
      } else {
        const active = await Repository.getActiveMonitoredProfile();
        if (active) {
          targetProfiles = [active];
        } else {
          const all = await Repository.getMonitoredProfiles();
          targetProfiles = all.filter((p) => p.status === 'ACTIVE');
        }
      }

      if (targetProfiles.length === 0) {
        result.details.push('No active monitored profiles found to check.');
        return result;
      }

      // Check Google connections (independent Drive and YouTube)
      const [driveConnected, youtubeConnected] = await Promise.all([
        isDriveConnected(),
        isYouTubeConnected(),
      ]);
      let driveToken: string | null = null;
      let youtubeToken: string | null = null;
      if (driveConnected) {
        try {
          driveToken = await getValidDriveAccessToken();
        } catch (err) {
          result.details.push(`Google Drive token retrieval note: ${(err as Error).message}`);
        }
      }
      if (youtubeConnected) {
        try {
          youtubeToken = await getValidYouTubeAccessToken();
        } catch (err) {
          result.details.push(`YouTube token retrieval note: ${(err as Error).message}`);
        }
      }

      const metaCreds = InstagramBusinessDiscoveryService.getCredentials();
      const adapter = options?.sandbox
        ? new PermittedSandboxAdapter()
        : metaCreds.isConfigured
        ? new InstagramBusinessDiscoveryAdapter()
        : new StandardPublicWebAdapter();

      // 4. Process each profile
      let uploadsThisRun = 0;
      for (const profile of targetProfiles) {
        result.profilesChecked += 1;
        result.details.push(`Checking profile @${profile.username}...`);

        const checkRes = await adapter.checkProfile(profile.profile_url);
        await Repository.updateMonitoredProfile(profile.id, {
          status: checkRes.status,
          status_reason: checkRes.status_reason,
          last_checked_at: checkRes.checked_at,
        });

        // Discover new Reels
        const discovery = await adapter.discoverReels(profile, profile.last_checked_at || undefined);
        result.reelsDetected += discovery.new_reels.length;

        for (const reel of discovery.new_reels) {
          // Durable Deduplication across database and cache (with orphan crash recovery)
          const alreadySeen =
            (await Repository.isReelRecorded(reel.reel_id, { allowOrphanRecovery: true })) ||
            ReelDeduplicationStore.hasBeenSeen(reel.reel_id);
          if (alreadySeen) {
            result.details.push(`Skipping already-seen Reel: ${reel.reel_id}`);
            continue;
          }

          // Atomically register in durable deduplication store and queue initial upload job
          const job = await Repository.registerDiscoveredReel(reel, profile);
          ReelDeduplicationStore.recordReel(reel.reel_id, profile.id);

          await Repository.logActivity(
            'REEL_DETECTED',
            `New Reel detected on @${profile.username} (${reel.reel_id})`,
            profile.username,
            { reel_id: reel.reel_id, permalink: reel.permalink }
          );

          result.jobsProcessed += 1;

          // If video source is available and both services are connected, enforce daily upload cap before live upload
          if (
            reel.video_source_url &&
            driveToken &&
            youtubeToken &&
            !options?.sandbox &&
            readiness.daily_uploads_used + uploadsThisRun >= automation.max_uploads_per_day
          ) {
            await Repository.updateUploadJob(job.id, {
              status: 'MEDIA_AVAILABLE',
              error_details: `Daily upload cap reached (${readiness.daily_uploads_used + uploadsThisRun}/${automation.max_uploads_per_day}). Queued for next quota window.`,
            });
            result.details.push(`Job ${job.id} queued: Daily upload limit reached.`);
            continue;
          }

          if (reel.video_source_url && driveToken && youtubeToken) {
            try {
              await this.executeJobUpload(
                job.id,
                reel,
                profile.username,
                driveToken,
                youtubeToken,
                automation.drive_folder_name,
                automation.default_visibility || 'public'
              );
              uploadsThisRun += 1;
              result.jobsSucceeded += 1;
              result.details.push(`Job ${job.id} completed: Drive + YouTube uploaded.`);
            } catch (jobErr) {
              result.jobsFailed += 1;
              result.details.push(`Job ${job.id} failed: ${(jobErr as Error).message}`);
            }
          } else if (!reel.video_source_url) {
            await Repository.updateUploadJob(job.id, {
              status: 'DETECTED',
              error_details: 'Unauthenticated public web probe: Direct video stream gated by platform. Metadata archived.',
            });
            result.details.push(`Job ${job.id} metadata archived. Video binary requires authorized access.`);
          } else {
            const missing = !driveToken && !youtubeToken
              ? 'Google Drive & YouTube accounts'
              : !driveToken
              ? 'Google Drive account'
              : 'YouTube channel';
            await Repository.updateUploadJob(job.id, {
              status: 'DETECTED',
              error_details: `${missing} not connected. Connect in Settings to enable automated uploads.`,
            });
            result.details.push(`Job ${job.id} queued. Awaiting ${missing} authorization.`);
          }
        }
      }

      // Update last successful check timestamp
      await Repository.updateAutomationSettings({
        last_successful_check: new Date().toISOString(),
      });

      await Repository.logActivity(
        'SYNC_TRIGGERED',
        `Automation sync executed: ${result.profilesChecked} profiles checked, ${result.reelsDetected} reels detected`,
        targetProfiles[0]?.username,
        {
          profilesChecked: result.profilesChecked,
          reelsDetected: result.reelsDetected,
          jobsProcessed: result.jobsProcessed,
          jobsSucceeded: result.jobsSucceeded,
        }
      );

      return result;
    } finally {
      // 5. Always release automation lock
      await Repository.releaseAutomationLock();
    }
  }

  /**
   * Executes the streaming upload pipeline for a single Reel job:
   * Step 1: Stream to Google Drive (Resumable 5MB chunks)
   * Step 2: Stream to YouTube Shorts (Title = first line + #shorts, Description = caption + source)
   */
  static async executeJobUpload(
    jobId: string,
    reel: DiscoveredReel,
    username: string,
    driveToken: string,
    youtubeToken: string,
    driveFolderName: string,
    defaultVisibility: 'public' | 'unlisted' | 'private'
  ): Promise<UploadJob> {
    if (!reel.video_source_url) {
      throw new Error('Video source URL is required for upload.');
    }

    // Step 1: Downloading & Google Drive Archival
    await Repository.updateUploadJob(jobId, { status: 'DOWNLOADING' });

    const folderId = await GoogleDriveService.getOrCreateFolder(driveFolderName, driveToken);
    const driveFileName = `reel_${reel.reel_id}_${username}.mp4`;

    const driveResult = await GoogleDriveService.streamVideoToDrive(
      reel.video_source_url,
      driveFileName,
      folderId,
      driveToken
    );

    await Repository.updateUploadJob(jobId, {
      status: 'STORED_DRIVE',
      drive_file_id: driveResult.fileId,
      drive_file_url: driveResult.webViewLink || `https://drive.google.com/file/d/${driveResult.fileId}/view`,
    });

    await Repository.logActivity(
      'DRIVE_UPLOAD',
      `Archived reel ${reel.reel_id} to Google Drive folder "${driveFolderName}"`,
      username,
      { fileId: driveResult.fileId, fileName: driveFileName }
    );

    // Step 2: YouTube Shorts Streaming Publication via authenticated Drive backup
    await Repository.updateUploadJob(jobId, { status: 'UPLOADING_TO_YOUTUBE' });

    const driveStreamUrl = GoogleDriveService.getMediaDownloadUrl(driveResult.fileId);
    const driveHeaders = GoogleDriveService.getAuthHeaders(driveToken);

    try {
      const ytResult = await YouTubeService.streamVideoToYouTube(
        driveStreamUrl,
        {
          caption: reel.caption,
          username,
          privacyStatus: defaultVisibility,
        },
        youtubeToken,
        {
          sourceHeaders: driveHeaders,
          onSessionInitiated: async (sessionUri) => {
            const enc = sessionUri ? encryptToken(sessionUri) : null;
            await Repository.updateUploadJob(jobId, {
              encrypted_youtube_upload_session_uri: enc,
            });
          },
        }
      );

      const completedJob = await Repository.updateUploadJob(jobId, {
        status: 'COMPLETED',
        youtube_video_id: ytResult.videoId,
        youtube_video_url: ytResult.videoUrl,
        encrypted_youtube_upload_session_uri: ytResult.sessionUri ? encryptToken(ytResult.sessionUri) : null,
        completed_at: new Date().toISOString(),
        error_details: null,
      });

      await Repository.logActivity(
        'YOUTUBE_UPLOAD',
        `Published YouTube Short: "${ytResult.title}"`,
        username,
        { videoId: ytResult.videoId, videoUrl: ytResult.videoUrl, visibility: defaultVisibility }
      );

      return completedJob!;
    } catch (err: any) {
      const errMsg = err.message || String(err);
      const sessionUri = err.sessionUri;
      const status = sessionUri ? 'AMBIGUOUS_UPLOAD' : 'FAILED';
      const enc = sessionUri ? encryptToken(sessionUri) : null;

      await Repository.updateUploadJob(jobId, {
        status,
        encrypted_youtube_upload_session_uri: enc,
        error_details: errMsg,
      });

      await Repository.logActivity(
        'UPLOAD_FAILED',
        `YouTube upload failed (${status}) for reel on @${username}: ${errMsg}`,
        username,
        { error: errMsg }
      );

      throw err;
    }
  }

  /**
   * Retries an existing upload job from its current point of failure
   */
  static async retryJob(
    jobId: string,
    options?: {
      directVideoUrl?: string;
      captionOverride?: string;
      visibility?: 'public' | 'unlisted' | 'private';
    }
  ): Promise<UploadJob> {
    const job = await Repository.getUploadJobById(jobId);
    if (!job) {
      throw new Error(`Upload job ${jobId} not found.`);
    }

    if (job.status === 'COMPLETED' || job.youtube_video_id) {
      if (job.status !== 'COMPLETED') {
        return (
          (await Repository.updateUploadJob(jobId, {
            status: 'COMPLETED',
            error_details: null,
          })) || job
        );
      }
      return job;
    }

    const [driveToken, youtubeToken] = await Promise.all([
      getValidDriveAccessToken(),
      getValidYouTubeAccessToken(),
    ]);
    const automation = await Repository.getAutomationSettings();

    let currentSessionUri: string | undefined = undefined;

    try {
      const extractHandleFromText = (text?: string | null): string | null => {
        if (!text) return null;
        const m = text.match(/@([A-Za-z0-9_.]{1,30})/);
        return m ? m[1] : null;
      };
      const authorUsername =
        extractHandleFromText(options?.captionOverride) ||
        extractHandleFromText(job.caption) ||
        (job.account_username && job.account_username !== 'creator' ? job.account_username : 'creator');

      const targetCaption = options?.captionOverride || job.caption;
      const targetVisibility = options?.visibility || automation.default_visibility || 'public';

      await Repository.updateUploadJob(jobId, {
        status: 'RETRYING',
        retry_count: job.retry_count + 1,
        caption: targetCaption,
        account_username: authorUsername,
        media_source_type: options?.directVideoUrl ? 'USER_DIRECT_STREAM' : job.media_source_type,
        error_details: null,
      });

      // 1. YouTube Resumable Reconciliation Check:
      // If an encrypted session URI is saved, decrypt it and check whether YouTube already received the complete video!
      if (job.encrypted_youtube_upload_session_uri) {
        try {
          currentSessionUri = decryptToken(job.encrypted_youtube_upload_session_uri);
        } catch {
          console.warn(`[Retry] Failed to decrypt session URI for job ${jobId}; discarding invalid session.`);
        }
      }

      if (currentSessionUri) {
        try {
          let totalBytes = 0;
          if (job.drive_file_id) {
            const meta = await GoogleDriveService.getFileMetadata(job.drive_file_id, driveToken);
            totalBytes = meta.sizeBytes;
          }
          if (totalBytes > 0) {
            const resumableStatus = await YouTubeService.queryResumableStatus(
              currentSessionUri,
              totalBytes
            );
            if (resumableStatus.isComplete && resumableStatus.videoId) {
              const completedJob = await Repository.updateUploadJob(jobId, {
                status: 'COMPLETED',
                youtube_video_id: resumableStatus.videoId,
                youtube_video_url:
                  resumableStatus.videoUrl ||
                  `https://youtube.com/shorts/${resumableStatus.videoId}`,
                completed_at: new Date().toISOString(),
                error_details: null,
              });

              await Repository.recordReel(job.reel_id, job.instagram_account_id, job.original_reel_url);
              await Repository.logActivity(
                'YOUTUBE_UPLOAD',
                `Reconciled and published YouTube Short: "${resumableStatus.videoId}" (no re-upload required)`,
                authorUsername,
                { videoId: resumableStatus.videoId }
              );
              return completedJob!;
            }
          }
        } catch (reconcileErr) {
          console.warn(`[Retry] Resumable reconciliation check failed:`, reconcileErr);
        }
      }

      // 2. Determine video stream source:
      // When a Drive backup exists, use the authenticated Drive download stream as the retry source
      let videoSourceUrl: string;
      let sourceHeaders: Record<string, string> | undefined = undefined;
      let resolvedUsername = authorUsername;
      let resolvedCaption = targetCaption;
      const fileShortcode = job.shortcode || job.reel_id.replace(/^reel_/, '');

      if (job.drive_file_id) {
        videoSourceUrl = GoogleDriveService.getMediaDownloadUrl(job.drive_file_id);
        sourceHeaders = GoogleDriveService.getAuthHeaders(driveToken);
      } else {
        // Automatically resolve direct MP4 media stream (or validate admin-supplied recovery URL)
        await Repository.updateUploadJob(jobId, { status: 'RESOLVING_MEDIA' });

        if (options?.directVideoUrl && isInstagramWebpageUrl(options.directVideoUrl)) {
          throw new Error(
            'Direct MP4 stream URL cannot be an instagram.com webpage URL. Provide a verified direct CDN .mp4 stream URL.'
          );
        }

        const resolution = await MediaResolver.resolveReel(job.original_reel_url, {
          directVideoUrl: options?.directVideoUrl,
          confirmedRights: true,
          caption: options?.captionOverride,
          username: authorUsername !== 'creator' ? authorUsername : undefined,
        });

        if (!resolution.success || !resolution.mediaUrl || isInstagramWebpageUrl(resolution.mediaUrl)) {
          throw new Error(
            resolution.reason ||
              'Automated media resolution could not retrieve a valid direct MP4 stream for this Reel.'
          );
        }

        const sourceUrlToArchive = resolution.mediaUrl;
        resolvedUsername =
          resolution.username && resolution.username !== 'creator'
            ? resolution.username
            : authorUsername;
        resolvedCaption = buildAttributedCaption(
          options?.captionOverride || resolution.caption || job.caption,
          resolvedUsername,
          fileShortcode
        );

        await Repository.updateUploadJob(jobId, {
          status: 'VALIDATING_MEDIA',
          account_username: resolvedUsername,
          caption: resolvedCaption,
          thumbnail_url: resolution.thumbnailUrl || job.thumbnail_url,
          resolved_provider: resolution.provider,
          media_duration_seconds: resolution.durationSeconds ?? null,
        });

        // Validate HTTP 200/206, Content-Type video/mp4, Content-Length, and MP4 ftyp atom
        const [streamProbe] = await Promise.all([
          probeUpstreamVideoStream(sourceUrlToArchive),
          verifyMp4ContainerSignature(sourceUrlToArchive),
        ]);

        await Repository.updateUploadJob(jobId, {
          status: 'MEDIA_AVAILABLE',
          media_size_bytes: streamProbe.totalBytes,
          media_source_type: options?.directVideoUrl ? 'USER_DIRECT_STREAM' : resolution.provider,
          error_details: null,
        });

        const folderId = await GoogleDriveService.getOrCreateFolder(
          automation.drive_folder_name,
          driveToken
        );
        const fileName = `reel_${fileShortcode}_${resolvedUsername}.mp4`;

        await Repository.updateUploadJob(jobId, { status: 'ARCHIVING_TO_DRIVE' });
        const driveRes = await GoogleDriveService.streamVideoToDrive(
          sourceUrlToArchive,
          fileName,
          folderId,
          driveToken
        );

        await Repository.updateUploadJob(jobId, { status: 'VERIFYING_DRIVE_ARCHIVE' });
        const driveMeta = await GoogleDriveService.getFileMetadata(driveRes.fileId, driveToken);
        if (driveMeta.trashed || driveMeta.sizeBytes <= 0) {
          throw new Error(
            `Google Drive archive verification failed for file ${driveRes.fileId} (size=${driveMeta.sizeBytes}, trashed=${driveMeta.trashed}).`
          );
        }

        await Repository.updateUploadJob(jobId, {
          drive_file_id: driveRes.fileId,
          drive_file_url: driveRes.webViewLink || `https://drive.google.com/file/d/${driveRes.fileId}/view`,
          status: 'STORED_IN_DRIVE',
          account_username: resolvedUsername,
          caption: resolvedCaption,
          media_size_bytes: driveMeta.sizeBytes,
        });

        await Repository.logActivity(
          'DRIVE_UPLOAD',
          `Archived and verified Reel #${fileShortcode} (${driveMeta.sizeBytes} bytes) in Google Drive folder "${automation.drive_folder_name}"`,
          resolvedUsername,
          {
            fileId: driveRes.fileId,
            fileName,
            sizeBytes: driveMeta.sizeBytes,
            provider: resolution.provider,
            redactedSource: redactMediaUrl(sourceUrlToArchive),
          }
        );

        // Stream YouTube upload directly from the verified durable Google Drive archive
        videoSourceUrl = GoogleDriveService.getMediaDownloadUrl(driveRes.fileId);
        sourceHeaders = GoogleDriveService.getAuthHeaders(driveToken);
      }

      // 3. Prepare YouTube metadata & upload using authenticated Drive stream + session tracking
      await Repository.updateUploadJob(jobId, { status: 'PREPARING_YOUTUBE_METADATA' });
      const finalCaption = buildAttributedCaption(resolvedCaption, resolvedUsername, fileShortcode);

      await Repository.updateUploadJob(jobId, {
        status: 'UPLOADING_TO_YOUTUBE',
        caption: finalCaption,
        account_username: resolvedUsername,
      });

      const ytResult = await YouTubeService.streamVideoToYouTube(
        videoSourceUrl,
        {
          caption: finalCaption,
          username: resolvedUsername,
          privacyStatus: targetVisibility,
        },
        youtubeToken,
        {
          sourceHeaders,
          sessionUri: currentSessionUri,
          onSessionInitiated: async (newSessionUri) => {
            currentSessionUri = newSessionUri;
            const enc = newSessionUri ? encryptToken(newSessionUri) : null;
            await Repository.updateUploadJob(jobId, {
              encrypted_youtube_upload_session_uri: enc,
            });
          },
        }
      );

      await Repository.updateUploadJob(jobId, { status: 'VERIFYING_YOUTUBE_PUBLICATION' });
      let verifiedPrivacy = targetVisibility;
      try {
        const ytDetails = await YouTubeService.getVideoDetails(ytResult.videoId, youtubeToken);
        if (ytDetails.privacyStatus) {
          verifiedPrivacy = ytDetails.privacyStatus as typeof targetVisibility;
          if (targetVisibility === 'public' && ytDetails.privacyStatus !== 'public') {
            throw new Error(
              `YouTube published video ${ytResult.videoId} with privacyStatus="${ytDetails.privacyStatus}" instead of required "public".`
            );
          }
        }
      } catch (verifyErr) {
        if (
          process.env.NODE_ENV === 'production' ||
          (verifyErr instanceof Error && verifyErr.message.includes('instead of required "public"'))
        ) {
          throw verifyErr;
        }
      }

      const finalSession = ytResult.sessionUri || currentSessionUri;
      const finalJob = await Repository.updateUploadJob(jobId, {
        status: 'COMPLETED',
        youtube_video_id: ytResult.videoId,
        youtube_video_url: ytResult.videoUrl,
        youtube_privacy_status: verifiedPrivacy,
        encrypted_youtube_upload_session_uri: finalSession ? encryptToken(finalSession) : null,
        completed_at: new Date().toISOString(),
        error_details: null,
      });

      await Repository.recordReel(job.reel_id, job.instagram_account_id, job.original_reel_url);
      ReelDeduplicationStore.recordReel(job.reel_id);

      await Repository.logActivity(
        'YOUTUBE_UPLOAD',
        `Published YouTube Short: "${ytResult.title}"`,
        authorUsername,
        { videoId: ytResult.videoId, videoUrl: ytResult.videoUrl, visibility: targetVisibility }
      );

      return finalJob!;
    } catch (err: any) {
      const errMsg = err.message || String(err);
      const sessionUri = err.sessionUri || currentSessionUri;
      const newStatus = sessionUri ? 'AMBIGUOUS_UPLOAD' : 'FAILED';
      const enc = sessionUri ? encryptToken(sessionUri) : null;

      await Repository.updateUploadJob(jobId, {
        status: newStatus,
        encrypted_youtube_upload_session_uri: enc,
        error_details: errMsg,
      });

      await Repository.logActivity(
        'UPLOAD_FAILED',
        `Retry ${newStatus === 'AMBIGUOUS_UPLOAD' ? 'marked ambiguous' : 'failed'} for reel on @${job.account_username}: ${errMsg}`,
        job.account_username,
        { error: errMsg }
      );
      throw err;
    }
  }

  /**
   * Processes a direct Instagram Reel URL submission through the unified pipeline:
   * 1. Validates Reel URL format & extracts canonical shortcode
   * 2. Enforces mandatory creator copyright / distribution rights confirmation
   * 3. Prevents duplicate processing of previously submitted or completed Reels
   * 4. Transitions through granular pipeline states:
   *    SUBMITTED -> VALIDATING -> RESOLVING_MEDIA -> MEDIA_AVAILABLE / WAITING_FOR_AUTHORIZED_MEDIA
   *    -> ARCHIVING_TO_DRIVE -> STORED_IN_DRIVE -> UPLOADING_TO_YOUTUBE -> VERIFYING_UPLOAD -> COMPLETED
   */
  static async processSubmission(
    payload: ReelSubmissionPayload,
    options?: { sandbox?: boolean; mockStream?: boolean }
  ): Promise<UploadJob> {
    // 1. Mandatory Rights Confirmation Check (standing account-level declaration OR per-request confirmation)
    const standingRightsActive = await Repository.hasActiveRightsDeclaration();
    if (!payload.confirmedRights && !standingRightsActive) {
      throw new Error(
        'Compliance requirement: Creator copyright or distribution rights confirmation is required before processing (activate standing declaration in Settings or confirm rights).'
      );
    }

    // 2. Validate URL and extract shortcode
    const extraction = extractReelShortcode(payload.reelUrl);
    if (!extraction.isValid || !extraction.shortcode) {
      throw new Error(extraction.error || 'Invalid Instagram Reel URL format.');
    }

    const { shortcode, canonicalUrl } = extraction;

    // 3. Deduplication Check
    const existing = await Repository.getUploadJobByShortcode(shortcode);

    if (existing) {
      if (
        existing.status === 'COMPLETED' ||
        existing.status === 'STORED_IN_DRIVE' ||
        existing.status === 'ARCHIVING_TO_DRIVE' ||
        existing.status === 'VERIFYING_DRIVE_ARCHIVE' ||
        existing.status === 'UPLOADING_TO_YOUTUBE' ||
        existing.status === 'VERIFYING_YOUTUBE_PUBLICATION' ||
        existing.youtube_video_id
      ) {
        return existing;
      }
    } else {
      const isRecorded = await Repository.isReelRecorded(`reel_${shortcode}`);
      if (isRecorded) {
        const pastJob = await Repository.getUploadJobByReelId(`reel_${shortcode}`);
        if (pastJob) return pastJob;
      }
    }

    // 3b. Reject Instagram webpage URLs supplied as directVideoUrl
    if (payload.directVideoUrl && isInstagramWebpageUrl(payload.directVideoUrl)) {
      throw new Error(
        'Direct MP4 stream URL cannot be an instagram.com webpage URL. Provide a verified direct CDN .mp4 stream URL.'
      );
    }

    // 4. Create initial job record in RECEIVED state (reusing existing pending/waiting/failed job to prevent duplicates)
    const handleMatch = payload.captionOverride?.match(/@([A-Za-z0-9_.]{1,30})/);
    const initialUsername =
      (handleMatch ? handleMatch[1] : null) ||
      (existing?.account_username && existing.account_username !== 'creator'
        ? existing.account_username
        : 'creator');

    let job: UploadJob;
    if (existing) {
      job = (await Repository.updateUploadJob(existing.id, {
        status: 'RECEIVED',
        caption: payload.captionOverride || existing.caption,
        account_username: initialUsername,
        rights_confirmed: true,
        media_source_type: payload.directVideoUrl
          ? 'USER_DIRECT_STREAM'
          : payload.driveFileId
          ? 'GOOGLE_DRIVE_SOURCE'
          : 'PUBLIC_IG_NATIVE',
        error_details: null,
      })) || existing;
    } else {
      job = await Repository.addUploadJob({
        reel_id: `reel_${shortcode}`,
        shortcode,
        original_reel_url: canonicalUrl || `https://www.instagram.com/reel/${shortcode}/`,
        caption: payload.captionOverride || `Reel #${shortcode}`,
        account_username: initialUsername,
        status: 'RECEIVED',
        rights_confirmed: true,
        media_source_type: payload.directVideoUrl
          ? 'USER_DIRECT_STREAM'
          : payload.driveFileId
          ? 'GOOGLE_DRIVE_SOURCE'
          : 'PUBLIC_IG_NATIVE',
      });
    }

    // 5. Durable Stage Progression: VALIDATING_URL -> CHECKING_RIGHTS_POLICY -> RESOLVING_CREATOR -> RESOLVING_MEDIA
    await Repository.updateUploadJob(job.id, { status: 'VALIDATING_URL' });
    await Repository.updateUploadJob(job.id, { status: 'CHECKING_RIGHTS_POLICY' });
    await Repository.updateUploadJob(job.id, { status: 'RESOLVING_CREATOR' });
    await Repository.updateUploadJob(job.id, { status: 'RESOLVING_MEDIA' });

    // 6. Automated Media Resolution (no manual direct MP4 URL required)
    const resolution = await MediaResolver.resolveReel(payload.reelUrl, {
      directVideoUrl: payload.directVideoUrl,
      driveFileId: payload.driveFileId,
      confirmedRights: true,
      sandbox: options?.sandbox,
      caption: payload.captionOverride,
      username: initialUsername !== 'creator' ? initialUsername : undefined,
    });

    if (resolution.status === 'WAITING_FOR_AUTHORIZED_MEDIA') {
      const waitingJob = await Repository.updateUploadJob(job.id, {
        status: 'WAITING_FOR_AUTHORIZED_MEDIA',
        account_username: resolution.username || job.account_username,
        caption: payload.captionOverride || resolution.caption || job.caption,
        thumbnail_url: resolution.thumbnailUrl || job.thumbnail_url,
        resolved_provider: resolution.provider,
        error_details: resolution.reason,
      });

      await Repository.logActivity(
        'PROFILE_CHECKED',
        `Reel #${shortcode} queued: Waiting for authorized media stream (${resolution.provider})`,
        resolution.username || 'creator',
        { shortcode, provider: resolution.provider, reason: resolution.reason }
      );

      return waitingJob!;
    }

    if (
      resolution.status === 'NOT_FOUND' ||
      resolution.status === 'ERROR' ||
      resolution.status === 'ACCESS_RESTRICTED' ||
      !resolution.success ||
      !resolution.mediaUrl
    ) {
      const failedJob = await Repository.updateUploadJob(job.id, {
        status: 'FAILED',
        resolved_provider: resolution.provider,
        error_details: resolution.reason,
      });

      await Repository.logActivity(
        'UPLOAD_FAILED',
        `Reel #${shortcode} resolution failed: ${resolution.reason}`,
        job.account_username
      );

      return failedJob!;
    }

    const resolvedUsername =
      resolution.username && resolution.username !== 'creator'
        ? resolution.username
        : initialUsername;
    const attributedCaption = buildAttributedCaption(
      payload.captionOverride || resolution.caption || job.caption,
      resolvedUsername,
      shortcode
    );

    // 6b. Stage: VALIDATING_MEDIA (strict upstream HTTP 200/206, Content-Type, size, and MP4 ftyp verification in live mode)
    await Repository.updateUploadJob(job.id, {
      status: 'VALIDATING_MEDIA',
      account_username: resolvedUsername,
      caption: attributedCaption,
      thumbnail_url: resolution.thumbnailUrl || job.thumbnail_url,
      resolved_provider: resolution.provider,
      media_duration_seconds: resolution.durationSeconds ?? null,
    });

    let verifiedSizeBytes = resolution.sizeBytes ?? null;
    if (!options?.sandbox && resolution.provider !== 'SANDBOX' && !options?.mockStream) {
      try {
        const [probe] = await Promise.all([
          probeUpstreamVideoStream(resolution.mediaUrl),
          verifyMp4ContainerSignature(resolution.mediaUrl),
        ]);
        verifiedSizeBytes = probe.totalBytes;
      } catch (valErr) {
        const reason = valErr instanceof Error ? valErr.message : String(valErr);
        const failedJob = await Repository.updateUploadJob(job.id, {
          status: 'FAILED',
          error_details: reason,
        });
        await Repository.logActivity(
          'UPLOAD_FAILED',
          `Reel #${shortcode} media validation failed: ${reason}`,
          resolvedUsername
        );
        return failedJob!;
      }
    }

    // Resolution & Validation succeeded -> MEDIA_AVAILABLE (signed URL NEVER persisted in D1)
    await Repository.updateUploadJob(job.id, {
      status: 'MEDIA_AVAILABLE',
      account_username: resolvedUsername,
      caption: attributedCaption,
      thumbnail_url: resolution.thumbnailUrl || job.thumbnail_url,
      resolved_provider: resolution.provider,
      media_source_type: payload.directVideoUrl ? 'USER_DIRECT_STREAM' : resolution.provider,
      media_size_bytes: verifiedSizeBytes,
      error_details: null,
    });

    // 7. Check Google Connections (Independent Drive + YouTube credentials)
    const [driveConnected, youtubeConnected] = await Promise.all([
      isDriveConnected(),
      isYouTubeConnected(),
    ]);
    let driveToken: string | null = null;
    let youtubeToken: string | null = null;
    if (driveConnected) {
      try {
        driveToken = await getValidDriveAccessToken();
      } catch {
        // Token retrieval failed
      }
    }
    if (youtubeConnected) {
      try {
        youtubeToken = await getValidYouTubeAccessToken();
      } catch {
        // Token retrieval failed
      }
    }

    if (!driveToken || !youtubeToken) {
      const missing = !driveToken && !youtubeToken
        ? 'Google Drive & YouTube accounts'
        : !driveToken
        ? 'Google Drive account'
        : 'YouTube channel';
      const awaitingJob = await Repository.updateUploadJob(job.id, {
        status: 'MEDIA_AVAILABLE',
        error_details:
          `Media source ready. ${missing} not connected - connect in Settings to execute Drive archive and YouTube upload.`,
      });
      return awaitingJob!;
    }

    // 8. Cloud-to-Cloud Streaming Transfer Pipeline (Zero Local SSD Disk Consumption)
    const automation = await Repository.getAutomationSettings();
    const visibility = payload.visibility || automation.default_visibility || 'public';
    const folderName = automation.drive_folder_name || 'Instagram Reels Backup';

    if (!options?.sandbox) {
      const todayUploads = await Repository.getTodayCompletedUploadsCount();
      if (todayUploads >= automation.max_uploads_per_day) {
        const cappedJob = await Repository.updateUploadJob(job.id, {
          status: 'MEDIA_AVAILABLE',
          error_details: `Daily upload limit reached (${todayUploads}/${automation.max_uploads_per_day} today). Media resolved and queued without exceeding daily cap.`,
        });
        return cappedJob!;
      }
    }

    try {
      // Step A: Archive to Google Drive
      await Repository.updateUploadJob(job.id, { status: 'ARCHIVING_TO_DRIVE' });
      const folderId = await GoogleDriveService.getOrCreateFolder(folderName, driveToken);
      const driveFileName = `reel_${shortcode}_${resolvedUsername}.mp4`;

      const driveResult = await GoogleDriveService.streamVideoToDrive(
        resolution.mediaUrl,
        driveFileName,
        folderId,
        driveToken
      );

      // Step A2: Verify Google Drive archive exists and is non-empty
      await Repository.updateUploadJob(job.id, { status: 'VERIFYING_DRIVE_ARCHIVE' });
      let archivedBytes = driveResult.sizeBytes ?? verifiedSizeBytes ?? null;
      if (!options?.sandbox) {
        const driveMeta = await GoogleDriveService.getFileMetadata(driveResult.fileId, driveToken);
        if (driveMeta.trashed || driveMeta.sizeBytes <= 0) {
          throw new Error(
            `Google Drive archive verification failed for file ${driveResult.fileId} (size=${driveMeta.sizeBytes}, trashed=${driveMeta.trashed}).`
          );
        }
        archivedBytes = driveMeta.sizeBytes;
      }

      await Repository.updateUploadJob(job.id, {
        status: 'STORED_IN_DRIVE',
        drive_file_id: driveResult.fileId,
        drive_file_url:
          driveResult.webViewLink ||
          `https://drive.google.com/file/d/${driveResult.fileId}/view`,
        media_size_bytes: archivedBytes,
      });

      await Repository.logActivity(
        'DRIVE_UPLOAD',
        `Archived and verified Reel #${shortcode} in Google Drive folder "${folderName}"`,
        resolvedUsername,
        {
          fileId: driveResult.fileId,
          fileName: driveFileName,
          sizeBytes: archivedBytes,
          provider: resolution.provider,
          redactedSource: redactMediaUrl(resolution.mediaUrl),
        }
      );

      // Step B: Prepare YouTube Metadata & Upload directly from verified Google Drive archive
      await Repository.updateUploadJob(job.id, { status: 'PREPARING_YOUTUBE_METADATA' });
      await Repository.updateUploadJob(job.id, { status: 'UPLOADING_TO_YOUTUBE' });

      const ytStreamUrl = GoogleDriveService.getMediaDownloadUrl(driveResult.fileId);
      const ytStreamHeaders = GoogleDriveService.getAuthHeaders(driveToken);

      const ytResult = await YouTubeService.streamVideoToYouTube(
        ytStreamUrl,
        {
          caption: attributedCaption,
          username: resolvedUsername,
          privacyStatus: visibility,
        },
        youtubeToken,
        {
          sourceHeaders: ytStreamHeaders,
          onSessionInitiated: async (sessionUri) => {
            const enc = sessionUri ? encryptToken(sessionUri) : null;
            await Repository.updateUploadJob(job.id, {
              encrypted_youtube_upload_session_uri: enc,
            });
          },
        }
      );

      // Step C: Verify YouTube publication & explicit PUBLIC privacyStatus
      await Repository.updateUploadJob(job.id, { status: 'VERIFYING_YOUTUBE_PUBLICATION' });
      let verifiedPrivacy = visibility;
      if (!options?.sandbox) {
        try {
          const ytDetails = await YouTubeService.getVideoDetails(ytResult.videoId, youtubeToken);
          if (ytDetails.privacyStatus) {
            verifiedPrivacy = ytDetails.privacyStatus as typeof visibility;
            if (visibility === 'public' && ytDetails.privacyStatus !== 'public') {
              throw new Error(
                `YouTube published video ${ytResult.videoId} with privacyStatus="${ytDetails.privacyStatus}" instead of required "public".`
              );
            }
          }
        } catch (verifyErr) {
          if (
            process.env.NODE_ENV === 'production' ||
            (verifyErr instanceof Error && verifyErr.message.includes('instead of required "public"'))
          ) {
            throw verifyErr;
          }
        }
      }

      const completedJob = await Repository.updateUploadJob(job.id, {
        status: 'COMPLETED',
        youtube_video_id: ytResult.videoId,
        youtube_video_url: ytResult.videoUrl,
        youtube_privacy_status: verifiedPrivacy,
        encrypted_youtube_upload_session_uri: ytResult.sessionUri ? encryptToken(ytResult.sessionUri) : null,
        completed_at: new Date().toISOString(),
        error_details: null,
      });

      // Record in durable deduplication store
      await Repository.recordReel(`reel_${shortcode}`, undefined, payload.reelUrl);
      ReelDeduplicationStore.recordReel(`reel_${shortcode}`);

      await Repository.logActivity(
        'YOUTUBE_UPLOAD',
        `Published YouTube Short (${verifiedPrivacy}): "${ytResult.title}"`,
        resolvedUsername,
        { videoId: ytResult.videoId, videoUrl: ytResult.videoUrl, visibility: verifiedPrivacy }
      );

      return completedJob!;
    } catch (err: any) {
      const errMsg = err.message || String(err);
      const sessionUri = err.sessionUri;
      const status = sessionUri ? 'AMBIGUOUS_UPLOAD' : 'FAILED';
      const enc = sessionUri ? encryptToken(sessionUri) : null;

      const failedJob = await Repository.updateUploadJob(job.id, {
        status,
        encrypted_youtube_upload_session_uri: enc,
        error_details: errMsg,
      });

      await Repository.logActivity(
        'UPLOAD_FAILED',
        `Pipeline transfer failed (${status}) for Reel #${shortcode}: ${errMsg}`,
        job.account_username,
        { error: errMsg }
      );

      return failedJob!;
    }
  }

  /**
   * Loads persisted dashboard metrics and enriches storage quota from live Google Drive API
   * when Drive is connected. Never fabricates quota numbers when unavailable.
   */
  static async getEnrichedDashboardMetrics(): Promise<DashboardMetrics> {
    const metrics = await Repository.getDashboardMetrics();

    if (!metrics.storage.connected || process.env.NODE_ENV === 'test') {
      return metrics;
    }

    try {
      const driveToken = await getValidDriveAccessToken();
      const quota = await GoogleDriveService.getStorageQuota(driveToken);
      if (quota.available && quota.usedBytes !== null && quota.totalBytes !== null && quota.totalBytes > 0) {
        return {
          ...metrics,
          storage: {
            ...metrics.storage,
            available: true,
            used_bytes: quota.usedBytes,
            total_bytes: quota.totalBytes,
            used_formatted: formatBytes(quota.usedBytes),
            total_formatted: formatBytes(quota.totalBytes),
            percentage: Math.min(100, Math.round((quota.usedBytes / quota.totalBytes) * 100)),
            source: 'google_drive_api',
            note: undefined,
          },
        };
      }

      return {
        ...metrics,
        storage: {
          ...metrics.storage,
          note: quota.note || metrics.storage.note,
        },
      };
    } catch {
      return {
        ...metrics,
        storage: {
          ...metrics.storage,
          note: 'Google Drive OAuth token requires reauthorization to query storage quota.',
        },
      };
    }
  }
}
