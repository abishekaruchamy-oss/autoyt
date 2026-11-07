import { NextRequest, NextResponse } from 'next/server';
import { Repository } from '@/server/db/repository';
import { JobStatus } from '@/types';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const accountId = searchParams.get('accountId') || undefined;
    const status = (searchParams.get('status') as JobStatus) || undefined;
    const search = searchParams.get('search') || undefined;

    const jobs = await Repository.getUploadJobs({
      accountId,
      status,
      search,
    });

    return NextResponse.json({ success: true, count: jobs.length, jobs });
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
    const newJob = await Repository.addUploadJob(body);
    return NextResponse.json({ success: true, job: newJob });
  } catch (error) {
    return NextResponse.json(
      { success: false, error: (error as Error).message },
      { status: 500 }
    );
  }
}
