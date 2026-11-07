import { NextRequest, NextResponse } from 'next/server';
import { Repository } from '@/server/db/repository';

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await context.params;
    const activated = await Repository.setActiveMonitoredProfile(id);
    if (!activated) {
      return NextResponse.json(
        { success: false, error: 'Monitored profile not found' },
        { status: 404 }
      );
    }
    return NextResponse.json({
      success: true,
      message: `Active monitored source switched to @${activated.username}`,
      profile: activated,
    });
  } catch (error) {
    return NextResponse.json(
      { success: false, error: (error as Error).message },
      { status: 500 }
    );
  }
}
