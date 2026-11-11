import { NextRequest, NextResponse } from 'next/server';
import { requireAdminApi } from '@/lib/auth';
import { NO_STORE_HEADERS, sanitizeErrorMessage } from '@/lib/security';
import { Repository } from '@/server/db/repository';
import { MonitoredProfile } from '@/types';

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const authError = requireAdminApi(request);
  if (authError) return authError;

  try {
    const { id } = await context.params;
    const profile = await Repository.getMonitoredProfileById(id);
    if (!profile) {
      return NextResponse.json(
        { success: false, error: 'Monitored profile not found' },
        { status: 404, headers: NO_STORE_HEADERS }
      );
    }
    return NextResponse.json({ success: true, profile }, { headers: NO_STORE_HEADERS });
  } catch (error) {
    return NextResponse.json(
      { success: false, error: sanitizeErrorMessage(error, 'Failed to fetch profile.') },
      { status: 500, headers: NO_STORE_HEADERS }
    );
  }
}

export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const authError = requireAdminApi(request);
  if (authError) return authError;

  try {
    const { id } = await context.params;
    const body = (await request.json()) as Partial<MonitoredProfile>;
    const updated = await Repository.updateMonitoredProfile(id, body);
    if (!updated) {
      return NextResponse.json(
        { success: false, error: 'Monitored profile not found' },
        { status: 404, headers: NO_STORE_HEADERS }
      );
    }
    return NextResponse.json(
      {
        success: true,
        message: 'Profile updated successfully',
        profile: updated,
      },
      { headers: NO_STORE_HEADERS }
    );
  } catch (error) {
    return NextResponse.json(
      { success: false, error: sanitizeErrorMessage(error, 'Failed to update profile.') },
      { status: 500, headers: NO_STORE_HEADERS }
    );
  }
}

export async function DELETE(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const authError = requireAdminApi(request);
  if (authError) return authError;

  try {
    const { id } = await context.params;
    const success = await Repository.removeMonitoredProfile(id);
    if (!success) {
      return NextResponse.json(
        { success: false, error: 'Monitored profile not found' },
        { status: 404, headers: NO_STORE_HEADERS }
      );
    }
    return NextResponse.json(
      {
        success: true,
        message: 'Profile removed from monitoring queue',
      },
      { headers: NO_STORE_HEADERS }
    );
  } catch (error) {
    return NextResponse.json(
      { success: false, error: sanitizeErrorMessage(error, 'Failed to delete profile.') },
      { status: 500, headers: NO_STORE_HEADERS }
    );
  }
}
