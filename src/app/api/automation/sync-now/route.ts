import { NextRequest, NextResponse } from 'next/server';
import { requireAdminApi } from '@/lib/auth';
import { NO_STORE_HEADERS, sanitizeErrorMessage } from '@/lib/security';
import { PipelineService } from '@/server/services/pipelineService';

export async function POST(request: NextRequest) {
  const authError = requireAdminApi(request);
  if (authError) return authError;

  try {
    let sandbox = false;
    let profileId: string | undefined;

    try {
      const body = (await request.json()) as { sandbox?: boolean; profileId?: string };
      sandbox = !!body.sandbox;
      profileId = body.profileId;
    } catch {
      // Empty body is acceptable for simple manual sync trigger
    }

    const result = await PipelineService.runSync({
      force: true,
      sandbox,
      profileId,
    });

    if (result.skipped) {
      return NextResponse.json(
        { success: false, error: result.reason, result },
        { status: 409, headers: NO_STORE_HEADERS }
      );
    }

    return NextResponse.json(
      {
        success: true,
        message: `Automation sync completed: ${result.profilesChecked} profiles checked, ${result.reelsDetected} reels detected, ${result.jobsSucceeded} uploaded.`,
        result,
      },
      { headers: NO_STORE_HEADERS }
    );
  } catch (error) {
    return NextResponse.json(
      { success: false, error: sanitizeErrorMessage(error, 'Automation sync failed.') },
      { status: 500, headers: NO_STORE_HEADERS }
    );
  }
}
