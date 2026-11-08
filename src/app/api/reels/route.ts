import { NextRequest, NextResponse } from 'next/server';
import { Repository } from '@/server/db/repository';
import { JobStatus } from '@/types';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const shortcode = searchParams.get('shortcode') || undefined;
    const status = (searchParams.get('status') as JobStatus) || undefined;
    const search = searchParams.get('search') || undefined;

    if (shortcode) {
      const job = await Repository.getUploadJobByShortcode(shortcode);
      return NextResponse.json({
        success: true,
        count: job ? 1 : 0,
        jobs: job ? [job] : [],
      });
    }

    const jobs = await Repository.getUploadJobs({
      status,
      search,
    });

    return NextResponse.json({
      success: true,
      count: jobs.length,
      jobs,
    });
  } catch (error) {
    return NextResponse.json(
      { success: false, error: (error as Error).message },
      { status: 500 }
    );
  }
}
