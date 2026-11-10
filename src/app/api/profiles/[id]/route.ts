import { NextRequest, NextResponse } from 'next/server';
import { Repository } from '@/server/db/repository';
import { MonitoredProfile } from '@/types';

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await context.params;
    const profile = await Repository.getMonitoredProfileById(id);
    if (!profile) {
      return NextResponse.json(
        { success: false, error: 'Monitored profile not found' },
        { status: 404 }
      );
    }
    return NextResponse.json({ success: true, profile });
  } catch (error) {
    return NextResponse.json(
      { success: false, error: (error as Error).message },
      { status: 500 }
    );
  }
}

export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await context.params;
    const body = (await request.json()) as Partial<MonitoredProfile>;
    const updated = await Repository.updateMonitoredProfile(id, body);
    if (!updated) {
      return NextResponse.json(
        { success: false, error: 'Monitored profile not found' },
        { status: 404 }
      );
    }
    return NextResponse.json({
      success: true,
      message: 'Profile updated successfully',
      profile: updated,
    });
  } catch (error) {
    return NextResponse.json(
      { success: false, error: (error as Error).message },
      { status: 500 }
    );
  }
}

export async function DELETE(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await context.params;
    const success = await Repository.removeMonitoredProfile(id);
    if (!success) {
      return NextResponse.json(
        { success: false, error: 'Monitored profile not found' },
        { status: 404 }
      );
    }
    return NextResponse.json({
      success: true,
      message: 'Profile removed from monitoring queue',
    });
  } catch (error) {
    return NextResponse.json(
      { success: false, error: (error as Error).message },
      { status: 500 }
    );
  }
}
