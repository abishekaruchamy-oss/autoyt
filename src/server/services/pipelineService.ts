import { Repository } from '../db/repository';
import {
  StandardPublicWebAdapter,
  PermittedSandboxAdapter,
  ReelDeduplicationStore,
  formatCaptionForYouTube,
} from '../monitoring/adapter';
import { GoogleDriveService } from './googleDriveService';
import { YouTubeService } from './youtubeService';
import { getValidAccessToken, isGoogleConnected } from './googleAuthService';
import { MonitoredProfile, UploadJob, DiscoveredReel, ReelSubmissionPayload } from '@/types';
import { extractReelShortcode, MediaResolver } from '../media/MediaResolver';

export interface PipelineSyncOptions {
  profileId?: string;
  force?: boolean;
  sandbox?: boolean;
}

export interface PipelineSyncResult {
  success: boolean;
  skipped?: boolean;
  reason?: string;
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

      // Check Google connection
      const googleConnected = await isGoogleConnected();
      let accessToken: string | null = null;
      if (googleConnected) {
        try {
          accessToken = await getValidAccessToken();
        } catch (err) {
          result.details.push(`Google token retrieval note: ${(err as Error).message}`);
        }
      }

      const adapter = options?.sandbox
        ? new PermittedSandboxAdapter()
        : new StandardPublicWebAdapter();

      // 4. Process each profile
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
          // Deduplication
          if (ReelDeduplicationStore.hasBeenSeen(reel.reel_id)) {
            result.details.push(`Skipping already-seen Reel: ${reel.reel_id}`);
            continue;
          }

          // Register in deduplication store
          ReelDeduplicationStore.recordReel(reel.reel_id, profile.id);

          // Create upload job record
          const job = await Repository.addUploadJob({
            reel_id: reel.reel_id,
            instagram_account_id: profile.id,
            account_username: profile.username,
            caption: reel.caption,
            thumbnail_url: reel.thumbnail_url,
            original_reel_url: reel.permalink,
            status: 'DETECTED',
          });

          await Repository.logActivity(
            'REEL_DETECTED',
            `New Reel detected on @${profile.username} (${reel.reel_id})`,
            profile.username,
            { reel_id: reel.reel_id, permalink: reel.permalink }
          );

          result.jobsProcessed += 1;

          // If video source is available and Google is connected, proceed through streaming upload
          if (reel.video_source_url && accessToken) {
            try {
              await this.executeJobUpload(job.id, reel, profile.username, accessToken, automation.drive_folder_name, automation.default_visibility);
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
            await Repository.updateUploadJob(job.id, {
              status: 'DETECTED',
              error_details: 'Google OAuth account not connected. Connect in Settings to enable automated uploads.',
            });
            result.details.push(`Job ${job.id} queued. Awaiting Google account authorization.`);
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
    accessToken: string,
    driveFolderName: string,
    defaultVisibility: 'public' | 'unlisted' | 'private'
  ): Promise<UploadJob> {
    if (!reel.video_source_url) {
      throw new Error('Video source URL is required for upload.');
    }

    // Step 1: Downloading & Google Drive Archival
    await Repository.updateUploadJob(jobId, { status: 'DOWNLOADING' });

    const folderId = await GoogleDriveService.getOrCreateFolder(driveFolderName, accessToken);
    const driveFileName = `reel_${reel.reel_id}_${username}.mp4`;

    const driveResult = await GoogleDriveService.streamVideoToDrive(
      reel.video_source_url,
      driveFileName,
      folderId,
      accessToken
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

    // Step 2: YouTube Shorts Streaming Publication
    await Repository.updateUploadJob(jobId, { status: 'UPLOADING_TO_YOUTUBE' });

    const ytResult = await YouTubeService.streamVideoToYouTube(
      reel.video_source_url,
      {
        caption: reel.caption,
        username,
        privacyStatus: defaultVisibility,
      },
      accessToken
    );

    const completedJob = await Repository.updateUploadJob(jobId, {
      status: 'COMPLETED',
      youtube_video_id: ytResult.videoId,
      youtube_video_url: ytResult.videoUrl,
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
  }

  /**
   * Retries an existing upload job from its current point of failure
   */
  static async retryJob(jobId: string): Promise<UploadJob> {
    const job = await Repository.getUploadJobById(jobId);
    if (!job) {
      throw new Error(`Upload job ${jobId} not found.`);
    }

    if (job.status === 'COMPLETED') {
      return job;
    }

    const accessToken = await getValidAccessToken();
    const automation = await Repository.getAutomationSettings();

    try {
      await Repository.updateUploadJob(jobId, {
        status: 'RETRYING',
        retry_count: job.retry_count + 1,
        error_details: null,
      });

      // Need video stream source (either from original Reel or Drive backup)
      const videoSource = job.original_reel_url;

      // If already stored on Drive, proceed straight to YouTube
      if (!job.drive_file_id) {
        const folderId = await GoogleDriveService.getOrCreateFolder(
          automation.drive_folder_name,
          accessToken
        );
        const fileName = `reel_${job.reel_id}_${job.account_username}.mp4`;
        const driveRes = await GoogleDriveService.streamVideoToDrive(
          videoSource,
          fileName,
          folderId,
          accessToken
        );
        await Repository.updateUploadJob(jobId, {
          drive_file_id: driveRes.fileId,
          drive_file_url: driveRes.webViewLink,
          status: 'STORED_DRIVE',
        });
      }

      // Upload to YouTube
      await Repository.updateUploadJob(jobId, { status: 'UPLOADING_TO_YOUTUBE' });
      const ytResult = await YouTubeService.streamVideoToYouTube(
        videoSource,
        {
          caption: job.caption,
          username: job.account_username,
          privacyStatus: automation.default_visibility,
        },
        accessToken
      );

      const finalJob = await Repository.updateUploadJob(jobId, {
        status: 'COMPLETED',
        youtube_video_id: ytResult.videoId,
        youtube_video_url: ytResult.videoUrl,
        completed_at: new Date().toISOString(),
        error_details: null,
      });

      return finalJob!;
    } catch (err) {
      const errMsg = (err as Error).message;
      await Repository.updateUploadJob(jobId, {
        status: 'FAILED',
        error_details: errMsg,
      });
      await Repository.logActivity(
        'UPLOAD_FAILED',
        `Retry failed for reel on @${job.account_username}: ${errMsg}`,
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
    // 1. Mandatory Rights Confirmation Check
    if (!payload.confirmedRights) {
      throw new Error(
        'Compliance requirement: Creator copyright or distribution rights confirmation is required before processing.'
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
        existing.status === 'UPLOADING_TO_YOUTUBE'
      ) {
        return existing;
      }
    }

    // 4. Create initial job record in SUBMITTED state
    const job = await Repository.addUploadJob({
      reel_id: `reel_${shortcode}`,
      shortcode,
      original_reel_url: canonicalUrl || `https://www.instagram.com/reel/${shortcode}/`,
      caption: payload.captionOverride || `Reel #${shortcode}`,
      account_username: 'creator',
      status: 'SUBMITTED',
      rights_confirmed: true,
      media_source_type: payload.directVideoUrl
        ? 'USER_DIRECT_STREAM'
        : payload.driveFileId
        ? 'GOOGLE_DRIVE_SOURCE'
        : 'PUBLIC_PROBE',
    });

    // 5. State: VALIDATING -> RESOLVING_MEDIA
    await Repository.updateUploadJob(job.id, { status: 'VALIDATING' });
    await Repository.updateUploadJob(job.id, { status: 'RESOLVING_MEDIA' });

    // 6. Media Resolution
    const resolution = await MediaResolver.resolveReel(payload.reelUrl, {
      directVideoUrl: payload.directVideoUrl,
      driveFileId: payload.driveFileId,
      confirmedRights: payload.confirmedRights,
      sandbox: options?.sandbox,
    });

    if (resolution.status === 'WAITING_FOR_AUTHORIZED_MEDIA') {
      const waitingJob = await Repository.updateUploadJob(job.id, {
        status: 'WAITING_FOR_AUTHORIZED_MEDIA',
        account_username: resolution.username || job.account_username,
        caption: payload.captionOverride || resolution.caption || job.caption,
        thumbnail_url: resolution.thumbnailUrl || job.thumbnail_url,
        error_details: resolution.reason,
      });

      await Repository.logActivity(
        'PROFILE_CHECKED',
        `Reel #${shortcode} queued: Waiting for creator-authorized media stream`,
        resolution.username || 'creator',
        { shortcode, reason: resolution.reason }
      );

      return waitingJob!;
    }

    if (
      resolution.status === 'NOT_FOUND' ||
      resolution.status === 'ERROR' ||
      resolution.status === 'ACCESS_RESTRICTED' ||
      !resolution.success
    ) {
      const failedJob = await Repository.updateUploadJob(job.id, {
        status: 'FAILED',
        error_details: resolution.reason,
      });

      await Repository.logActivity(
        'UPLOAD_FAILED',
        `Reel #${shortcode} resolution failed: ${resolution.reason}`,
        job.account_username
      );

      return failedJob!;
    }

    // Resolution was MEDIA_AVAILABLE
    await Repository.updateUploadJob(job.id, {
      status: 'MEDIA_AVAILABLE',
      account_username: resolution.username || job.account_username,
      caption: payload.captionOverride || resolution.caption || job.caption,
      thumbnail_url: resolution.thumbnailUrl || job.thumbnail_url,
      error_details: null,
    });

    // 7. Check Google Connection
    const googleConnected = await isGoogleConnected();
    let accessToken: string | null = null;
    if (googleConnected) {
      try {
        accessToken = await getValidAccessToken();
      } catch (tokenErr) {
        // Token retrieval failed
      }
    }

    if (!accessToken) {
      const awaitingJob = await Repository.updateUploadJob(job.id, {
        status: 'MEDIA_AVAILABLE',
        error_details:
          'Media source ready. Google account not connected - connect in Settings to execute Drive archive and YouTube upload.',
      });
      return awaitingJob!;
    }

    // 8. Streaming Transfer Pipeline (Zero Local SSD Disk Consumption)
    const automation = await Repository.getAutomationSettings();
    const visibility = payload.visibility || automation.default_visibility || 'private';
    const folderName = automation.drive_folder_name || 'Instagram Archive';

    try {
      // Step A: Archive to Google Drive
      await Repository.updateUploadJob(job.id, { status: 'ARCHIVING_TO_DRIVE' });
      const folderId = await GoogleDriveService.getOrCreateFolder(folderName, accessToken);
      const driveFileName = `reel_${shortcode}_${resolution.username || 'creator'}.mp4`;

      const driveResult = await GoogleDriveService.streamVideoToDrive(
        resolution.mediaUrl!,
        driveFileName,
        folderId,
        accessToken
      );

      await Repository.updateUploadJob(job.id, {
        status: 'STORED_IN_DRIVE',
        drive_file_id: driveResult.fileId,
        drive_file_url:
          driveResult.webViewLink ||
          `https://drive.google.com/file/d/${driveResult.fileId}/view`,
      });

      await Repository.logActivity(
        'DRIVE_UPLOAD',
        `Archived Reel #${shortcode} to Google Drive folder "${folderName}"`,
        resolution.username || 'creator',
        { fileId: driveResult.fileId, fileName: driveFileName }
      );

      // Step B: Upload to YouTube Shorts
      await Repository.updateUploadJob(job.id, { status: 'UPLOADING_TO_YOUTUBE' });

      const ytResult = await YouTubeService.streamVideoToYouTube(
        resolution.mediaUrl!,
        {
          caption: payload.captionOverride || resolution.caption || `Reel #${shortcode}`,
          username: resolution.username || 'creator',
          privacyStatus: visibility,
        },
        accessToken
      );

      await Repository.updateUploadJob(job.id, { status: 'VERIFYING_UPLOAD' });

      const completedJob = await Repository.updateUploadJob(job.id, {
        status: 'COMPLETED',
        youtube_video_id: ytResult.videoId,
        youtube_video_url: ytResult.videoUrl,
        completed_at: new Date().toISOString(),
        error_details: null,
      });

      await Repository.logActivity(
        'YOUTUBE_UPLOAD',
        `Published YouTube Short: "${ytResult.title}"`,
        resolution.username || 'creator',
        { videoId: ytResult.videoId, videoUrl: ytResult.videoUrl, visibility }
      );

      return completedJob!;
    } catch (err) {
      const errMsg = (err as Error).message;
      const failedJob = await Repository.updateUploadJob(job.id, {
        status: 'FAILED',
        error_details: errMsg,
      });

      await Repository.logActivity(
        'UPLOAD_FAILED',
        `Pipeline transfer failed for Reel #${shortcode}: ${errMsg}`,
        job.account_username,
        { error: errMsg }
      );

      return failedJob!;
    }
  }
}
