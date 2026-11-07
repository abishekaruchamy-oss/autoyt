import { NextRequest, NextResponse } from 'next/server';
import { Repository } from '@/server/db/repository';
import { PipelineService } from '@/server/services/pipelineService';
import { isGoogleConnected } from '@/server/services/googleAuthService';

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await context.params;
    const existingJob = await Repository.getUploadJobById(id);
    if (!existingJob) {
      return NextResponse.json(
        { success: false, error: 'Job not found' },
        { status: 404 }
      );
    }

    const connected = await isGoogleConnected();
    if (connected && existingJob.original_reel_url?.startsWith('http')) {
      try {
        const completedJob = await PipelineService.retryJob(id);
        return NextResponse.json({
          success: true,
          message: `Job ${id} retried and completed successfully.`,
          job: completedJob,
        });
      } catch (uploadErr) {
        // Updated by retryJob on failure
        const failedJob = await Repository.getUploadJobById(id);
        return NextResponse.json({
          success: false,
          error: (uploadErr as Error).message,
          job: failedJob,
        }, { status: 500 });
      }
    }

    // Default fallback retry registration
    const job = await Repository.retryUploadJob(id);

    return NextResponse.json({
      success: true,
      message: `Retrying upload job for reel on @${job?.account_username}`,
      job,
    });
  } catch (error) {
    return NextResponse.json(
      { success: false, error: (error as Error).message },
      { status: 500 }
    );
  }
}
