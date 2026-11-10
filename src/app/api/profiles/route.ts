import { NextRequest, NextResponse } from 'next/server';
import { Repository } from '@/server/db/repository';

export async function GET() {
  try {
    const profiles = await Repository.getMonitoredProfiles();
    return NextResponse.json({ success: true, count: profiles.length, profiles });
  } catch (error) {
    return NextResponse.json(
      { success: false, error: (error as Error).message },
      { status: 500 }
    );
  }
}

interface AddProfilePayload {
  profile_url?: string;
  display_name?: string;
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as AddProfilePayload;
    const { profile_url, display_name } = body;

    if (!profile_url) {
      return NextResponse.json(
        { success: false, error: 'Instagram profile URL is required (e.g. https://www.instagram.com/username/)' },
        { status: 400 }
      );
    }

    const profile = await Repository.addMonitoredProfile(profile_url, display_name);

    return NextResponse.json({
      success: true,
      message: `Profile @${profile.username} added successfully to monitoring.`,
      profile,
    });
  } catch (error) {
    return NextResponse.json(
      { success: false, error: (error as Error).message },
      { status: 400 }
    );
  }
}
