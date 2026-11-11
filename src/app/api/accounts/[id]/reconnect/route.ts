import { NextRequest, NextResponse } from 'next/server';
import { requireAdminApi } from '@/lib/auth';
import { NO_STORE_HEADERS, sanitizeAccountForApi, sanitizeErrorMessage } from '@/lib/security';
import { Repository } from '@/server/db/repository';

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const authError = requireAdminApi(request);
  if (authError) return authError;

  try {
    const { id } = await context.params;
    let raw_token: string | undefined;
    try {
      const body = (await request.json()) as { raw_token?: string };
      raw_token = body.raw_token;
    } catch {
      // Body is optional
    }

    const account = await Repository.reconnectAccount(id, raw_token);
    if (!account) {
      return NextResponse.json(
        { success: false, error: 'Account not found' },
        { status: 404, headers: NO_STORE_HEADERS }
      );
    }

    return NextResponse.json(
      {
        success: true,
        message: `Account @${account.username} reconnected. OAuth token renewed for 60 days.`,
        account: sanitizeAccountForApi(account),
      },
      { headers: NO_STORE_HEADERS }
    );
  } catch (error) {
    return NextResponse.json(
      { success: false, error: sanitizeErrorMessage(error, 'Failed to reconnect account.') },
      { status: 500, headers: NO_STORE_HEADERS }
    );
  }
}
