import { NextRequest, NextResponse } from 'next/server';
import { requireAdminApi } from '@/lib/auth';
import { NO_STORE_HEADERS, sanitizeErrorMessage } from '@/lib/security';
import { Repository } from '@/server/db/repository';

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const authError = requireAdminApi(request);
  if (authError) return authError;

  try {
    const { id } = await context.params;
    const activated = await Repository.setActiveMonitoredProfile(id);
    if (!activated) {
      return NextResponse.json(
        { success: false, error: 'Monitored profile not found' },
        { status: 404, headers: NO_STORE_HEADERS }
      );
    }
    return NextResponse.json(
      {
        success: true,
        message: `Active monitored source switched to @${activated.username}`,
        profile: activated,
      },
      { headers: NO_STORE_HEADERS }
    );
  } catch (error) {
    return NextResponse.json(
      { success: false, error: sanitizeErrorMessage(error, 'Failed to activate profile.') },
      { status: 500, headers: NO_STORE_HEADERS }
    );
  }
}
