import { NextRequest, NextResponse } from 'next/server';
import { Repository } from '@/server/db/repository';

export async function POST(request: NextRequest) {
  try {
    let success = true;
    try {
      const body = (await request.json()) as { success?: boolean };
      if (typeof body.success === 'boolean') {
        success = body.success;
      }
    } catch {
      // Optional body
    }

    await Repository.releaseAutomationLock(success);

    return NextResponse.json({
      success: true,
      message: 'Execution lock released successfully.',
    });
  } catch (error) {
    return NextResponse.json(
      { success: false, error: (error as Error).message },
      { status: 500 }
    );
  }
}
