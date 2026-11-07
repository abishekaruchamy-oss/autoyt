import { NextRequest, NextResponse } from 'next/server';
import { Repository } from '@/server/db/repository';

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await context.params;
    const profile = await Repository.checkProfileNow(id);
    if (!profile) {
      return NextResponse.json(
        { success: false, error: 'Monitored profile not found' },
        { status: 404 }
      );
    }
    return NextResponse.json({
      success: true,
      message: `Checked @${profile.username}: ${profile.status_reason}`,
      profile,
    });
  } catch (error) {
    return NextResponse.json(
      { success: false, error: (error as Error).message },
      { status: 500 }
    );
  }
}
