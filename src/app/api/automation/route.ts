import { NextResponse } from 'next/server';
import { Repository } from '@/server/db/repository';

export async function GET() {
  try {
    const automation = await Repository.getAutomationSettings();
    const activeAccount = await Repository.getActiveAccount();
    return NextResponse.json({
      success: true,
      automation,
      active_account: activeAccount,
    });
  } catch (error) {
    return NextResponse.json(
      { success: false, error: (error as Error).message },
      { status: 500 }
    );
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const updated = await Repository.updateAutomationSettings(body);
    return NextResponse.json({
      success: true,
      message: 'Automation settings updated',
      automation: updated,
    });
  } catch (error) {
    return NextResponse.json(
      { success: false, error: (error as Error).message },
      { status: 500 }
    );
  }
}
