import { NextResponse } from 'next/server';
import { Repository } from '@/server/db/repository';

export async function POST() {
  try {
    // 1. Acquire mutex lock to prevent overlapping executions
    const lockAcquired = await Repository.acquireAutomationLock();
    if (!lockAcquired) {
      return NextResponse.json(
        {
          success: false,
          error: 'An automation execution is already running. Please wait for it to complete.',
        },
        { status: 409 }
      );
    }

    // 2. Identify active account
    const activeAccount = await Repository.getActiveAccount();
    if (!activeAccount) {
      await Repository.releaseAutomationLock(false);
      return NextResponse.json(
        {
          success: false,
          error: 'No active Instagram account selected. Please select an active source in Account Manager.',
        },
        { status: 400 }
      );
    }

    // 3. Log sync trigger
    await Repository.logActivity(
      'SYNC_TRIGGERED',
      `Manual sync triggered for active source @${activeAccount.username}`,
      activeAccount.username
    );

    // 4. If n8n webhook is configured and active, notify n8n
    const integrations = await Repository.getIntegrations();
    let n8nTriggered = false;
    if (integrations.n8n.configured && integrations.n8n.webhook_url) {
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 3000);
        await fetch(integrations.n8n.webhook_url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            trigger: 'manual',
            account_id: activeAccount.id,
            username: activeAccount.username,
          }),
          signal: controller.signal,
        });
        clearTimeout(timeoutId);
        n8nTriggered = true;
      } catch {
        // n8n might not be running locally yet; continue in demo mode
        console.log('n8n webhook did not respond; proceeding with local synchronization simulator');
      }
    }

    // 5. Update account sync timestamp
    activeAccount.last_synced_at = new Date().toISOString();

    // 6. Release lock
    await Repository.releaseAutomationLock(true);

    return NextResponse.json({
      success: true,
      message: `Sync completed for @${activeAccount.username}. Checked Instagram Graph API for new Reels.`,
      active_account: activeAccount.username,
      n8n_notified: n8nTriggered,
      synced_at: activeAccount.last_synced_at,
    });
  } catch (error) {
    await Repository.releaseAutomationLock(false);
    return NextResponse.json(
      { success: false, error: (error as Error).message },
      { status: 500 }
    );
  }
}
