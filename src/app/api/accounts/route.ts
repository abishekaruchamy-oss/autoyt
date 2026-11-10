import { NextResponse } from 'next/server';
import { Repository } from '@/server/db/repository';

export async function GET() {
  try {
    const accounts = await Repository.getAccounts();
    return NextResponse.json({ success: true, accounts });
  } catch (error) {
    return NextResponse.json(
      { success: false, error: (error as Error).message },
      { status: 500 }
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

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as CreateAccountPayload;
    const { username, name, instagram_user_id, profile_picture_url, raw_token } = body;

    if (!username) {
      return NextResponse.json(
        { success: false, error: 'Username is required' },
        { status: 400 }
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
      raw_token: raw_token || `EAAB_${Date.now()}_oauth_token_secret`,
      expires_in_seconds: 60 * 24 * 60 * 60, // 60 days
    });

    return NextResponse.json({ success: true, account });
  } catch (error) {
    return NextResponse.json(
      { success: false, error: (error as Error).message },
      { status: 500 }
    );
  }
}
