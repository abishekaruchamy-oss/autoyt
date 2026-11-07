import { NextRequest, NextResponse } from 'next/server';
import { Repository } from '@/server/db/repository';

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await context.params;
    const account = await Repository.getAccountById(id);
    if (!account) {
      return NextResponse.json(
        { success: false, error: 'Account not found' },
        { status: 404 }
      );
    }
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { access_token_encrypted, ...safeAccount } = account;
    return NextResponse.json({ success: true, account: safeAccount });
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
    const success = await Repository.deleteAccount(id);
    if (!success) {
      return NextResponse.json(
        { success: false, error: 'Account not found' },
        { status: 404 }
      );
    }
    return NextResponse.json({
      success: true,
      message: 'Account removed successfully',
    });
  } catch (error) {
    return NextResponse.json(
      { success: false, error: (error as Error).message },
      { status: 500 }
    );
  }
}
