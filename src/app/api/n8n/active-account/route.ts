import { NextRequest, NextResponse } from 'next/server';
import { requireWebhookOrAdminApi } from '@/lib/auth';
import { NO_STORE_HEADERS, sanitizeErrorMessage } from '@/lib/security';
import { Repository } from '@/server/db/repository';

export async function GET(request: NextRequest) {
  const authError = requireWebhookOrAdminApi(request);
  if (authError) return authError;

  try {
    const automation = await Repository.getAutomationSettings();
    if (!automation.is_enabled) {
      return NextResponse.json(
        {
          success: true,
          is_enabled: false,
          message: 'Automation is currently paused by user.',
        },
        { headers: NO_STORE_HEADERS }
      );
    }

    // Retrieve active monitored profile
    const activeProfile = await Repository.getActiveMonitoredProfile();
    if (!activeProfile) {
      return NextResponse.json(
        {
          success: false,
          is_enabled: true,
          error: 'No active Instagram profile configured for monitoring.',
        },
        { status: 404, headers: NO_STORE_HEADERS }
      );
    }

    return NextResponse.json(
      {
        success: true,
        is_enabled: true,
        profile: {
          id: activeProfile.id,
          username: activeProfile.username,
          profile_url: activeProfile.profile_url,
          status: activeProfile.status,
          status_reason: activeProfile.status_reason,
          last_checked_at: activeProfile.last_checked_at,
        },
        // Backward compatibility alias for existing n8n workflows
        account: {
          id: activeProfile.id,
          instagram_user_id: `public_${activeProfile.username}`,
          username: activeProfile.username,
          access_token: 'UNAUTHENTICATED_PUBLIC_MODE',
          token_expires_at: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString(),
          status: activeProfile.status === 'ACTIVE' ? 'ACTIVE' : 'DISCONNECTED',
        },
        settings: {
          polling_interval_minutes: automation.polling_interval_minutes,
          max_uploads_per_day: automation.max_uploads_per_day,
          default_visibility: automation.default_visibility,
          drive_folder_id: automation.drive_folder_id,
          drive_folder_name: automation.drive_folder_name,
        },
      },
      { headers: NO_STORE_HEADERS }
    );
  } catch (error) {
    return NextResponse.json(
      { success: false, error: sanitizeErrorMessage(error, 'Failed to fetch active account.') },
      { status: 500, headers: NO_STORE_HEADERS }
    );
  }
}
