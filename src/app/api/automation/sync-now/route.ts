import { NextRequest, NextResponse } from 'next/server';
import { PipelineService } from '@/server/services/pipelineService';

export async function POST(request: NextRequest) {
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
        { success: false, error: result.reason },
        { status: 409 }
      );
    }

    return NextResponse.json({
      success: true,
      message: `Automation sync completed: ${result.profilesChecked} profiles checked, ${result.reelsDetected} reels detected, ${result.jobsSucceeded} uploaded.`,
      result,
    });
  } catch (error) {
    return NextResponse.json(
      { success: false, error: (error as Error).message },
      { status: 500 }
    );
  }
}
