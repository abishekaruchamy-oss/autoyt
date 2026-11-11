import { NextRequest, NextResponse } from 'next/server';
import { requireAdminApi } from '@/lib/auth';
import { NO_STORE_HEADERS, sanitizeErrorMessage, sanitizeUploadJobForApi } from '@/lib/security';
import { Repository } from '@/server/db/repository';
import { PipelineService } from '@/server/services/pipelineService';
import { isGoogleConnected } from '@/server/services/googleAuthService';

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

    const connected = await isGoogleConnected();
    if (connected && existingJob.original_reel_url?.startsWith('http')) {
      try {
        const completedJob = await PipelineService.retryJob(id);
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
