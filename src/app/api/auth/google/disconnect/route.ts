import { NextResponse } from 'next/server';
import { disconnectGoogle } from '@/server/services/googleAuthService';

export async function POST() {
  try {
    await disconnectGoogle();

    return NextResponse.json({
      success: true,
      message: 'Google account disconnected successfully.',
    });
  } catch (error) {
    return NextResponse.json(
      { success: false, error: (error as Error).message },
      { status: 500 }
    );
  }
}
