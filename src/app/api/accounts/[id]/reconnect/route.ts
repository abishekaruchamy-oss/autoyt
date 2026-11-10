import { NextRequest, NextResponse } from 'next/server';
import { Repository } from '@/server/db/repository';

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
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
        { status: 404 }
      );
    }

    return NextResponse.json({
      success: true,
      message: `Account @${account.username} reconnected. OAuth token renewed for 60 days.`,
      account,
    });
  } catch (error) {
    return NextResponse.json(
      { success: false, error: (error as Error).message },
      { status: 500 }
    );
  }
}
