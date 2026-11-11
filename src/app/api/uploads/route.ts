import { NextRequest, NextResponse } from 'next/server';
import { requireAdminApi } from '@/lib/auth';
import {
  NO_STORE_HEADERS,
  sanitizeErrorMessage,
  sanitizeUploadJobForApi,
  sanitizeUploadJobsForApi,
} from '@/lib/security';
import { Repository } from '@/server/db/repository';
import { JobStatus, UploadJob } from '@/types';

export async function GET(request: NextRequest) {
  const authError = requireAdminApi(request);
  if (authError) return authError;

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

    return NextResponse.json(
      { success: true, count: jobs.length, jobs: sanitizeUploadJobsForApi(jobs) },
      { headers: NO_STORE_HEADERS }
    );
  } catch (error) {
    return NextResponse.json(
      { success: false, error: sanitizeErrorMessage(error, 'Failed to load uploads.') },
      { status: 500, headers: NO_STORE_HEADERS }
    );
  }
}

export async function POST(request: NextRequest) {
  const authError = requireAdminApi(request);
  if (authError) return authError;

  try {
    const body = (await request.json()) as Partial<UploadJob>;
    const newJob = await Repository.addUploadJob(body);
    return NextResponse.json(
      { success: true, job: sanitizeUploadJobForApi(newJob) },
      { headers: NO_STORE_HEADERS }
    );
  } catch (error) {
    return NextResponse.json(
      { success: false, error: sanitizeErrorMessage(error, 'Failed to create upload job.') },
      { status: 500, headers: NO_STORE_HEADERS }
    );
  }
}
