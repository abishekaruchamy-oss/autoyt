import { NextRequest, NextResponse } from 'next/server';
import { requireAdminApi } from '@/lib/auth';
import { NO_STORE_HEADERS, sanitizeAccountForApi, sanitizeErrorMessage } from '@/lib/security';
import { Repository } from '@/server/db/repository';

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const authError = requireAdminApi(request);
  if (authError) return authError;

  try {
    const { id } = await context.params;
    const account = await Repository.getAccountById(id);
    if (!account) {
      return NextResponse.json(
        { success: false, error: 'Account not found' },
        { status: 404, headers: NO_STORE_HEADERS }
      );
    }
    return NextResponse.json(
      { success: true, account: sanitizeAccountForApi(account) },
      { headers: NO_STORE_HEADERS }
    );
  } catch (error) {
    return NextResponse.json(
      { success: false, error: sanitizeErrorMessage(error, 'Failed to fetch account.') },
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
    const success = await Repository.deleteAccount(id);
    if (!success) {
      return NextResponse.json(
        { success: false, error: 'Account not found' },
        { status: 404, headers: NO_STORE_HEADERS }
      );
    }
    return NextResponse.json(
      {
        success: true,
        message: 'Account removed successfully',
      },
      { headers: NO_STORE_HEADERS }
    );
  } catch (error) {
    return NextResponse.json(
      { success: false, error: sanitizeErrorMessage(error, 'Failed to delete account.') },
      { status: 500, headers: NO_STORE_HEADERS }
    );
  }
}
