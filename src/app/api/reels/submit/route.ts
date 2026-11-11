import { NextRequest, NextResponse } from 'next/server';
import { requireAdminApi } from '@/lib/auth';
import { NO_STORE_HEADERS, sanitizeErrorMessage, sanitizeUploadJobForApi } from '@/lib/security';
import { PipelineService } from '@/server/services/pipelineService';
import { ReelSubmissionPayload } from '@/types';
import { extractReelShortcode } from '@/server/media/MediaResolver';

export async function POST(request: NextRequest) {
  const authError = requireAdminApi(request);
  if (authError) return authError;

  try {
    const body = (await request.json()) as ReelSubmissionPayload;

    const {
      reelUrl,
      directVideoUrl,
      driveFileId,
      captionOverride,
      visibility,
      confirmedRights,
      sandbox,
    } = body;

    // 1. URL Presence & Format Validation
    if (!reelUrl || typeof reelUrl !== 'string') {
      return NextResponse.json(
        { success: false, error: 'Instagram Reel URL is required.' },
        { status: 400, headers: NO_STORE_HEADERS }
      );
    }

    const extraction = extractReelShortcode(reelUrl);
    if (!extraction.isValid || !extraction.shortcode) {
      return NextResponse.json(
        {
          success: false,
          error:
            extraction.error ||
            'Invalid Instagram Reel URL. Format must be e.g. https://www.instagram.com/reel/C3b4XyzABC1/',
        },
        { status: 400, headers: NO_STORE_HEADERS }
      );
    }

    // 2. Mandatory Copyright / Distribution Rights Confirmation Check
    if (!confirmedRights) {
      return NextResponse.json(
        {
          success: false,
          error:
            'Compliance requirement: You must confirm video ownership or authorized creator republishing rights before processing.',
        },
        { status: 400, headers: NO_STORE_HEADERS }
      );
    }

    const payload: ReelSubmissionPayload = {
      reelUrl,
      directVideoUrl: directVideoUrl || undefined,
      driveFileId: driveFileId || undefined,
      captionOverride: captionOverride || undefined,
      visibility: visibility || 'private',
      confirmedRights: Boolean(confirmedRights),
    };

    const job = await PipelineService.processSubmission(payload, {
      sandbox: Boolean(sandbox),
    });

    return NextResponse.json(
      {
        success: true,
        message: `Reel #${extraction.shortcode} submitted successfully. Current state: ${job.status}`,
        job: sanitizeUploadJobForApi(job),
      },
      { headers: NO_STORE_HEADERS }
    );
  } catch (error) {
    return NextResponse.json(
      { success: false, error: sanitizeErrorMessage(error, 'Failed to process Reel submission.') },
      { status: 500, headers: NO_STORE_HEADERS }
    );
  }
}
