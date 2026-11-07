import { NextResponse } from 'next/server';
import { Repository } from '@/server/db/repository';

export async function POST() {
  try {
    Repository.resetDemo();
    return NextResponse.json({
      success: true,
      message: 'Demo state reset to original sample dataset',
    });
  } catch (error) {
    return NextResponse.json(
      { success: false, error: (error as Error).message },
      { status: 500 }
    );
  }
}
