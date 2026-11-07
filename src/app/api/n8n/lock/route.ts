import { NextResponse } from 'next/server';
import { Repository } from '@/server/db/repository';

export async function POST() {
  try {
    const locked = await Repository.acquireAutomationLock();
    if (!locked) {
      return NextResponse.json(
        {
          success: false,
          locked: false,
          message: 'Execution lock already held. Skipping overlapping run.',
        },
        { status: 409 }
      );
    }

    return NextResponse.json({
      success: true,
      locked: true,
      message: 'Execution lock acquired successfully.',
    });
  } catch (error) {
    return NextResponse.json(
      { success: false, error: (error as Error).message },
      { status: 500 }
    );
  }
}
