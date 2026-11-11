import { NextRequest, NextResponse } from 'next/server';
import { requireAdminApi } from '@/lib/auth';
import {
  NO_STORE_HEADERS,
  sanitizeAccountForApi,
  sanitizeAccountsForApi,
  sanitizeErrorMessage,
} from '@/lib/security';
import { Repository } from '@/server/db/repository';

export async function GET(request: NextRequest) {
  const authError = requireAdminApi(request);
  if (authError) return authError;

  try {
    const accounts = await Repository.getAccounts();
    return NextResponse.json(
      { success: true, accounts: sanitizeAccountsForApi(accounts) },
      { headers: NO_STORE_HEADERS }
    );
  } catch (error) {
    return NextResponse.json(
      { success: false, error: sanitizeErrorMessage(error, 'Failed to load accounts.') },
      { status: 500, headers: NO_STORE_HEADERS }
    );
  }
}

interface CreateAccountPayload {
  username?: string;
  name?: string;
  instagram_user_id?: string;
  profile_picture_url?: string;
  raw_token?: string;
}

export async function POST(request: NextRequest) {
  const authError = requireAdminApi(request);
  if (authError) return authError;

  try {
    const body = (await request.json()) as CreateAccountPayload;
    const { username, name, instagram_user_id, profile_picture_url, raw_token } = body;

    if (!username) {
      return NextResponse.json(
        { success: false, error: 'Username is required' },
        { status: 400, headers: NO_STORE_HEADERS }
      );
    }

    const cleanUsername = username.replace(/^@/, '');
    const account = await Repository.createAccount({
      username: cleanUsername,
      name: name || `@${cleanUsername}`,
      instagram_user_id: instagram_user_id || `ig_${Date.now()}`,
      profile_picture_url:
        profile_picture_url ||
        `https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?w=150&auto=format&fit=crop&q=80`,
      raw_token,
      expires_in_seconds: 60 * 24 * 60 * 60, // 60 days
    });

    return NextResponse.json(
      { success: true, account: sanitizeAccountForApi(account) },
      { headers: NO_STORE_HEADERS }
    );
  } catch (error) {
    return NextResponse.json(
      { success: false, error: sanitizeErrorMessage(error, 'Failed to create account.') },
      { status: 500, headers: NO_STORE_HEADERS }
    );
  }
}
