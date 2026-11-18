import { NextRequest, NextResponse } from 'next/server';
import { requireAdminApi } from '@/lib/auth';
import { NO_STORE_HEADERS, sanitizeErrorMessage, sanitizeUploadJobForApi } from '@/lib/security';
import { Repository } from '@/server/db/repository';
import { PipelineService } from '@/server/services/pipelineService';
import { isGoogleConnected } from '@/server/services/googleAuthService';
import { isValidPublicMediaUrl } from '@/server/media/MediaResolver';
import { redactMediaUrl } from '@/server/media/streamValidation';

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const authError = requireAdminApi(request);
  if (authError) return authError;

  try {
    const { id } = await context.params;
    const existingJob = await Repository.getUploadJobById(id);
    if (!existingJob) {
      return NextResponse.json(
        { success: false, error: 'Job not found' },
        { status: 404, headers: NO_STORE_HEADERS }
      );
    }

    let body: {
      directVideoUrl?: string;
      captionOverride?: string;
      visibility?: 'public' | 'unlisted' | 'private';
    } = {};

    try {
      body = (await request.json()) as typeof body;
    } catch {
      // Empty body is acceptable for standard retry
    }

    if (body.directVideoUrl) {
      const urlCheck = isValidPublicMediaUrl(body.directVideoUrl);
      if (!urlCheck.isValid) {
        return NextResponse.json(
          { success: false, error: `Invalid media URL: ${urlCheck.error}` },
          { status: 400, headers: NO_STORE_HEADERS }
        );
      }
      await Repository.logActivity(
        'JOB_RETRIED',
        `Authorized direct media stream attached to existing job ${id} (${existingJob.shortcode || existingJob.reel_id})`,
        existingJob.account_username,
        {
          jobId: id,
          shortcode: existingJob.shortcode || null,
          mediaSource: redactMediaUrl(body.directVideoUrl),
          visibility: body.visibility || 'public',
        }
      );
    }

    const connected = await isGoogleConnected();
    if (connected && (existingJob.original_reel_url?.startsWith('http') || body.directVideoUrl)) {
      try {
        const completedJob = await PipelineService.retryJob(id, body);
        return NextResponse.json(
          {
            success: true,
            message: `Job ${id} retried and completed successfully.`,
            job: sanitizeUploadJobForApi(completedJob),
          },
          { headers: NO_STORE_HEADERS }
        );
      } catch (uploadErr) {
        // Updated by retryJob on failure
        const failedJob = await Repository.getUploadJobById(id);
        return NextResponse.json(
          {
            success: false,
            error: sanitizeErrorMessage(uploadErr, 'Upload retry failed.'),
            job: failedJob ? sanitizeUploadJobForApi(failedJob) : null,
          },
          { status: 500, headers: NO_STORE_HEADERS }
        );
      }
    }

    // Default fallback retry registration
    const job = await Repository.retryUploadJob(id);

    return NextResponse.json(
      {
        success: true,
        message: `Retrying upload job for reel on @${job?.account_username}`,
        job: job ? sanitizeUploadJobForApi(job) : null,
      },
      { headers: NO_STORE_HEADERS }
    );
  } catch (error) {
    return NextResponse.json(
      { success: false, error: sanitizeErrorMessage(error, 'Failed to retry upload job.') },
      { status: 500, headers: NO_STORE_HEADERS }
    );
  }
}
