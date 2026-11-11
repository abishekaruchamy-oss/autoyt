import { NextRequest, NextResponse } from 'next/server';
import { requireAdminApi } from '@/lib/auth';
import { NO_STORE_HEADERS, sanitizeErrorMessage } from '@/lib/security';
import { Repository } from '@/server/db/repository';

export async function GET(request: NextRequest) {
  const authError = requireAdminApi(request);
  if (authError) return authError;

  try {
    const profiles = await Repository.getMonitoredProfiles();
    return NextResponse.json(
      { success: true, count: profiles.length, profiles },
      { headers: NO_STORE_HEADERS }
    );
  } catch (error) {
    return NextResponse.json(
      { success: false, error: sanitizeErrorMessage(error, 'Failed to list profiles.') },
      { status: 500, headers: NO_STORE_HEADERS }
    );
  }
}

interface AddProfilePayload {
  profile_url?: string;
  display_name?: string;
}

export async function POST(request: NextRequest) {
  const authError = requireAdminApi(request);
  if (authError) return authError;

  try {
    const body = (await request.json()) as AddProfilePayload;
    const { profile_url, display_name } = body;

    if (!profile_url) {
      return NextResponse.json(
        {
          success: false,
          error: 'Instagram profile URL is required (e.g. https://www.instagram.com/username/)',
        },
        { status: 400, headers: NO_STORE_HEADERS }
      );
    }

    const profile = await Repository.addMonitoredProfile(profile_url, display_name);

    return NextResponse.json(
      {
        success: true,
        message: `Profile @${profile.username} added successfully to monitoring.`,
        profile,
      },
      { headers: NO_STORE_HEADERS }
    );
  } catch (error) {
    return NextResponse.json(
      { success: false, error: sanitizeErrorMessage(error, 'Failed to add profile.') },
      { status: 400, headers: NO_STORE_HEADERS }
    );
  }
}
