import { NextResponse } from 'next/server';
import { Repository } from '@/server/db/repository';

export async function GET() {
  try {
    const metrics = await Repository.getDashboardMetrics();
    return NextResponse.json({ success: true, metrics });
  } catch (error) {
    return NextResponse.json(
      { success: false, error: (error as Error).message },
      { status: 500 }
    );
  }
}
