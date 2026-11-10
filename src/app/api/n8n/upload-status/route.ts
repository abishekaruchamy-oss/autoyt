import { NextRequest, NextResponse } from 'next/server';
import { Repository } from '@/server/db/repository';
import { JobStatus } from '@/types';

interface UploadStatusPayload {
  job_id?: string;
  reel_id?: string;
  instagram_account_id?: string;
  account_username?: string;
  caption?: string;
  original_reel_url?: string;
  thumbnail_url?: string;
  drive_file_id?: string;
  drive_file_url?: string;
  youtube_video_id?: string;
  youtube_video_url?: string;
  status?: JobStatus;
  error_details?: string;
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as UploadStatusPayload;
    const {
      job_id,
      reel_id,
      instagram_account_id,
      account_username,
      caption,
      original_reel_url,
      thumbnail_url,
      drive_file_id,
      drive_file_url,
      youtube_video_id,
      youtube_video_url,
      status,
      error_details,
    } = body;

    let targetJob = null;
    if (job_id) {
      targetJob = await Repository.getUploadJobById(job_id);
    }

    if (targetJob) {
      if (status) targetJob.status = status as JobStatus;
      if (drive_file_id) targetJob.drive_file_id = drive_file_id;
      if (drive_file_url) targetJob.drive_file_url = drive_file_url;
      if (youtube_video_id) targetJob.youtube_video_id = youtube_video_id;
      if (youtube_video_url) targetJob.youtube_video_url = youtube_video_url;
      if (error_details) targetJob.error_details = error_details;
      if (status === 'COMPLETED') {
        targetJob.completed_at = new Date().toISOString();
      }
      targetJob.updated_at = new Date().toISOString();
    } else {
      targetJob = await Repository.addUploadJob({
        reel_id,
        instagram_account_id,
        account_username,
        caption,
        original_reel_url,
        thumbnail_url,
        drive_file_id,
        drive_file_url,
        youtube_video_id,
        youtube_video_url,
        status: (status as JobStatus) || 'DETECTED',
        error_details,
      });
    }

    if (status === 'COMPLETED') {
      await Repository.logActivity(
        'YOUTUBE_UPLOAD',
        `Uploaded to YouTube Shorts: "${caption?.substring(0, 30) || 'Reel'}..."`,
        account_username
      );
    } else if (status === 'STORED_DRIVE') {
      await Repository.logActivity(
        'DRIVE_UPLOAD',
        `Reel downloaded & stored in Google Drive`,
        account_username
      );
    } else if (status === 'FAILED') {
      await Repository.logActivity(
        'UPLOAD_FAILED',
        `Upload pipeline failed: ${error_details || 'Unknown error'}`,
        account_username
      );
    }

    return NextResponse.json({ success: true, job: targetJob });
  } catch (error) {
    return NextResponse.json(
      { success: false, error: (error as Error).message },
      { status: 500 }
    );
  }
}
