import { NextResponse } from 'next/server';
import { Repository } from '@/server/db/repository';
import { isGoogleConnected } from '@/server/services/googleAuthService';
import { NO_STORE_HEADERS, sanitizeErrorMessage } from '@/lib/security';

export async function GET() {
  try {
    const automation = await Repository.getAutomationSettings();
    const profiles = await Repository.getMonitoredProfiles();
    const googleConnected = await isGoogleConnected();
    const integrations = await Repository.getIntegrations();

    const uptime = process.uptime ? Math.round(process.uptime()) : 0;
    const memory = process.memoryUsage ? process.memoryUsage() : null;

    return NextResponse.json(
      {
        status: 'healthy',
        version: '2.0.0',
        timestamp: new Date().toISOString(),
        runtime: {
          nodeVersion: process.version || 'serverless-edge',
          uptimeSeconds: uptime,
          memoryUsageMb: memory
            ? Math.round(memory.rss / (1024 * 1024))
            : 'N/A',
        },
        database: {
          mode: process.env.DATABASE_URL ? 'PostgreSQL' : 'Persistent Fallback / D1',
          connected: true,
        },
        monitoring: {
          totalProfiles: profiles.length,
          activeProfiles: profiles.filter((p) => p.status === 'ACTIVE').length,
          zeroOAuthMode: true,
        },
        integrations: {
          googleDriveConnected: integrations.google_drive.connected,
          youtubeConnected: integrations.youtube.connected,
          googleOAuthTokensAvailable: googleConnected,
        },
        automation: {
          enabled: automation.is_enabled,
          isRunning: automation.is_running,
          lastSuccessfulCheck: automation.last_successful_check,
          pollingIntervalMinutes: automation.polling_interval_minutes,
        },
      },
      { headers: NO_STORE_HEADERS }
    );
  } catch (error) {
    return NextResponse.json(
      {
        status: 'unhealthy',
        error: sanitizeErrorMessage(error, 'Health check failed.'),
        timestamp: new Date().toISOString(),
      },
      { status: 500, headers: NO_STORE_HEADERS }
    );
  }
}
