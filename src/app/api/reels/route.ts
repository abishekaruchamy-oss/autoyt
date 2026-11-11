import { NextRequest, NextResponse } from 'next/server';
import { requireAdminApi } from '@/lib/auth';
import {
  NO_STORE_HEADERS,
  sanitizeErrorMessage,
  sanitizeUploadJobForApi,
  sanitizeUploadJobsForApi,
} from '@/lib/security';
import { Repository } from '@/server/db/repository';
import { JobStatus } from '@/types';

export async function GET(request: NextRequest) {
  const authError = requireAdminApi(request);
  if (authError) return authError;

  try {
    const { searchParams } = new URL(request.url);
    const shortcode = searchParams.get('shortcode') || undefined;
    const status = (searchParams.get('status') as JobStatus) || undefined;
    const search = searchParams.get('search') || undefined;

    if (shortcode) {
      const job = await Repository.getUploadJobByShortcode(shortcode);
      return NextResponse.json(
        {
          success: true,
          count: job ? 1 : 0,
          jobs: job ? [sanitizeUploadJobForApi(job)] : [],
        },
        { headers: NO_STORE_HEADERS }
      );
    }

    const jobs = await Repository.getUploadJobs({
      status,
      search,
    });

    return NextResponse.json(
      {
        success: true,
        count: jobs.length,
        jobs: sanitizeUploadJobsForApi(jobs),
      },
      { headers: NO_STORE_HEADERS }
    );
  } catch (error) {
    return NextResponse.json(
      { success: false, error: sanitizeErrorMessage(error, 'Failed to fetch reels.') },
      { status: 500, headers: NO_STORE_HEADERS }
    );
  }
}
