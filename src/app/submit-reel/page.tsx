'use client';

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import Link from 'next/link';
import {
  Film,
  UploadCloud,
  CheckCircle2,
  AlertCircle,
  RefreshCw,
  ExternalLink,
  ShieldCheck,
  HardDrive,
  ChevronRight,
  RotateCcw,
} from 'lucide-react';
import { YouTubeIcon } from '@/components/ui/Icons';
import { UploadJob, OperatorRightsDeclaration } from '@/types';
import { getJobStatusBadge, formatRelativeTime } from '@/lib/utils';
import { fetchJsonWithTimeout } from '@/lib/apiClient';
import { InlineNoticeBanner } from '@/components/ui/PageStateCard';

const PIPELINE_STAGES: ReadonlyArray<{ key: string; label: string }> = [
  { key: 'RECEIVED', label: 'Received' },
  { key: 'RESOLVING_MEDIA', label: 'Resolving Media' },
  { key: 'VALIDATING_MEDIA', label: 'Validating MP4' },
  { key: 'ARCHIVING_TO_DRIVE', label: 'Drive Archive' },
  { key: 'UPLOADING_TO_YOUTUBE', label: 'YouTube Upload' },
  { key: 'VERIFYING_YOUTUBE_PUBLICATION', label: 'Verify Public' },
  { key: 'COMPLETED', label: 'Completed' },
];

export default function SubmitReelPage() {
  const [reelUrl, setReelUrl] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [retryingJobId, setRetryingJobId] = useState<string | null>(null);
  const [activatingRights, setActivatingRights] = useState(false);

  const [rightsDeclaration, setRightsDeclaration] = useState<OperatorRightsDeclaration | null>(null);
  const [rightsActive, setRightsActive] = useState<boolean>(false);
  const [loadingRights, setLoadingRights] = useState<boolean>(true);

  const [submissionFeedback, setSubmissionFeedback] = useState<{
    type: 'success' | 'error' | 'info';
    message: string;
  } | null>(null);

  const [jobs, setJobs] = useState<UploadJob[]>([]);
  const [loadingJobs, setLoadingJobs] = useState(true);
  const [loadJobsError, setLoadJobsError] = useState<string | null>(null);

  // Live client-side shortcode extraction (supports /reel/, /reels/, /p/, /tv/, query params, or bare shortcode)
  const extractedShortcode = useMemo(() => {
    if (!reelUrl.trim()) return null;
    const match = reelUrl.match(/(?:reel|reels|p|tv)\/([A-Za-z0-9_-]{9,25})/i);
    if (match && match[1]) return match[1];
    if (/^[A-Za-z0-9_-]{9,25}$/.test(reelUrl.trim())) return reelUrl.trim();
    return null;
  }, [reelUrl]);

  const fetchRightsDeclaration = useCallback(async () => {
    try {
      const res = await fetchJsonWithTimeout<{
        success: boolean;
        isActive?: boolean;
        declaration?: OperatorRightsDeclaration | null;
      }>('/api/rights-declaration');
      if (res.ok && res.data?.success) {
        setRightsActive(Boolean(res.data.isActive));
        setRightsDeclaration(res.data.declaration ?? null);
      }
    } finally {
      setLoadingRights(false);
    }
  }, []);

  const fetchJobs = useCallback(async () => {
    try {
      const res = await fetchJsonWithTimeout<{
        success: boolean;
        jobs?: UploadJob[];
        error?: string;
      }>('/api/reels');
      if (res.ok && res.data?.success && res.data.jobs) {
        setJobs(res.data.jobs);
        setLoadJobsError(null);
      } else {
        setLoadJobsError(res.error || res.data?.error || 'Failed to load queue state.');
      }
    } finally {
      setLoadingJobs(false);
    }
  }, []);

  useEffect(() => {
    fetchRightsDeclaration();
    fetchJobs();
    const interval = setInterval(fetchJobs, 4000);
    return () => clearInterval(interval);
  }, [fetchJobs, fetchRightsDeclaration]);

  const handleActivateStandingRights = async () => {
    setActivatingRights(true);
    setSubmissionFeedback(null);
    try {
      const res = await fetchJsonWithTimeout<{
        success: boolean;
        isActive?: boolean;
        declaration?: OperatorRightsDeclaration;
        error?: string;
      }>('/api/rights-declaration', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          operatorIdentity: 'operator-admin',
          policyVersion: '1.0.0',
          status: 'ACTIVE',
        }),
      });
      if (res.ok && res.data?.success) {
        setRightsActive(Boolean(res.data.isActive));
        setRightsDeclaration(res.data.declaration ?? null);
        setSubmissionFeedback({
          type: 'success',
          message:
            'Standing content-rights declaration activated (v1.0.0). Future Reels can be submitted with a single click.',
        });
      } else {
        setSubmissionFeedback({
          type: 'error',
          message: res.error || res.data?.error || 'Failed to activate standing rights declaration.',
        });
      }
    } finally {
      setActivatingRights(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmissionFeedback(null);

    if (!reelUrl.trim() || !extractedShortcode) {
      setSubmissionFeedback({
        type: 'error',
        message:
          'Please paste a valid Instagram Reel URL (e.g. https://www.instagram.com/reel/Df22NkrBxal/).',
      });
      return;
    }

    if (!rightsActive) {
      setSubmissionFeedback({
        type: 'error',
        message:
          'Activate your one-time Standing Content-Rights Declaration above (or in Settings) before submitting.',
      });
      return;
    }

    setSubmitting(true);
    try {
      const res = await fetchJsonWithTimeout<{
        success: boolean;
        message?: string;
        error?: string;
        job?: UploadJob;
      }>(
        '/api/reels/submit',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            reelUrl: reelUrl.trim(),
          }),
        },
        120000
      );

      if (res.ok && res.data?.success) {
        setSubmissionFeedback({
          type: 'success',
          message:
            res.data.message ||
            `Reel #${extractedShortcode} processed automatically. Status: ${res.data.job?.status ?? 'RECEIVED'}`,
        });
        setReelUrl('');
        await fetchJobs();
      } else {
        setSubmissionFeedback({
          type: 'error',
          message: res.error || res.data?.error || 'Failed to process Reel submission.',
        });
      }
    } finally {
      setSubmitting(false);
    }
  };

  const handleAutomaticRetry = async (jobId: string) => {
    setRetryingJobId(jobId);
    setSubmissionFeedback(null);
    try {
      const res = await fetchJsonWithTimeout<{
        success: boolean;
        message?: string;
        error?: string;
      }>(
        `/api/uploads/${jobId}/retry`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({}),
        },
        120000
      );
      if (res.ok && res.data?.success) {
        setSubmissionFeedback({
          type: 'success',
          message: res.data.message || 'Automatic retry completed.',
        });
        await fetchJobs();
      } else {
        setSubmissionFeedback({
          type: 'error',
          message: res.error || res.data?.error || 'Automatic retry failed.',
        });
      }
    } finally {
      setRetryingJobId(null);
    }
  };

  return (
    <div className="p-4 sm:p-8 space-y-8 max-w-6xl w-full mx-auto">
      {/* Page Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-6 border-b border-zinc-800">
        <div>
          <div className="flex items-center gap-2.5 mb-1.5">
            <div className="p-2 bg-gradient-to-tr from-rose-500/20 to-purple-500/20 border border-rose-500/30 rounded-xl text-rose-400">
              <Film className="w-6 h-6" />
            </div>
            <h1 className="text-2xl font-bold tracking-tight text-white">Submit Instagram Reel</h1>
          </div>
          <p className="text-sm text-zinc-400">
            Paste one Instagram Reel URL. AutoShorts automatically resolves media, archives to Google Drive, and publishes publicly to YouTube Shorts.
          </p>
        </div>

        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => fetchJobs()}
            className="flex items-center gap-2 px-3 py-2 bg-zinc-900 hover:bg-zinc-800 border border-zinc-700/80 rounded-xl text-xs font-medium text-zinc-300 transition-colors"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loadingJobs ? 'animate-spin' : ''}`} />
            Refresh Queue
          </button>
        </div>
      </div>

      {/* Standing Account Policy Strip */}
      <div className="bg-zinc-900/60 border border-zinc-800 rounded-2xl p-4 flex flex-col md:flex-row md:items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2.5 text-xs">
          <span
            className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full font-semibold border ${
              rightsActive
                ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20'
                : 'bg-amber-500/10 text-amber-300 border-amber-500/20'
            }`}
          >
            <ShieldCheck className="w-3.5 h-3.5" />
            {loadingRights
              ? 'Checking Rights Policy...'
              : rightsActive
              ? `Standing Rights Active (v${rightsDeclaration?.policy_version || '1.0.0'})`
              : 'Standing Rights Declaration Required'}
          </span>
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-rose-500/10 text-rose-300 border border-rose-500/20 font-semibold">
            <YouTubeIcon className="w-3.5 h-3.5" />
            Visibility: PUBLIC (Permanent)
          </span>
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-cyan-500/10 text-cyan-300 border border-cyan-500/20 font-medium">
            <HardDrive className="w-3.5 h-3.5" />
            Archive: Instagram Reels Backup
          </span>
        </div>

        {!loadingRights && !rightsActive ? (
          <button
            type="button"
            onClick={handleActivateStandingRights}
            disabled={activatingRights}
            className="px-3.5 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl text-xs font-semibold transition-colors disabled:opacity-50"
          >
            {activatingRights ? 'Activating...' : 'Activate One-Time Rights Declaration'}
          </button>
        ) : (
          <Link
            href="/settings"
            className="text-xs text-zinc-400 hover:text-zinc-200 inline-flex items-center gap-1"
          >
            Manage account defaults <ChevronRight className="w-3.5 h-3.5" />
          </Link>
        )}
      </div>

      {/* Main Single-Field Form */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
        <div className="lg:col-span-7 space-y-6">
          <form
            onSubmit={handleSubmit}
            className="bg-zinc-900/50 border border-zinc-800/80 rounded-2xl p-6 space-y-5 shadow-xl backdrop-blur-sm"
          >
            <div className="space-y-2">
              <label
                htmlFor="instagram-reel-url"
                className="text-sm font-semibold text-white block"
              >
                Instagram Reel URL
              </label>
              <input
                id="instagram-reel-url"
                type="text"
                placeholder="Paste Instagram Reel URL (e.g. https://www.instagram.com/reel/Df22NkrBxal/)"
                value={reelUrl}
                onChange={(e) => setReelUrl(e.target.value)}
                disabled={submitting}
                className="w-full bg-zinc-950 border border-zinc-700/80 rounded-xl px-4 py-3 text-sm text-white placeholder-zinc-500 focus:outline-none focus:ring-2 focus:ring-rose-500/50 focus:border-rose-500 transition disabled:opacity-60"
                required
              />

              {extractedShortcode && (
                <div className="flex items-center gap-2 pt-1 text-xs">
                  <span className="text-zinc-400">Detected Shortcode:</span>
                  <span className="px-2 py-0.5 rounded-md bg-zinc-800 font-mono text-rose-300 border border-zinc-700">
                    {extractedShortcode}
                  </span>
                  <span className="text-emerald-400 flex items-center gap-1">
                    <CheckCircle2 className="w-3.5 h-3.5" /> Ready
                  </span>
                </div>
              )}
            </div>

            {submissionFeedback && (
              <div
                className={`p-3.5 rounded-xl border text-xs flex items-start gap-2.5 ${
                  submissionFeedback.type === 'success'
                    ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-300'
                    : submissionFeedback.type === 'error'
                    ? 'bg-rose-500/10 border-rose-500/20 text-rose-300'
                    : 'bg-blue-500/10 border-blue-500/20 text-blue-300'
                }`}
              >
                {submissionFeedback.type === 'success' ? (
                  <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5" />
                ) : (
                  <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                )}
                <span className="leading-relaxed">{submissionFeedback.message}</span>
              </div>
            )}

            <button
              type="submit"
              disabled={submitting || !extractedShortcode || !rightsActive}
              className="w-full py-3 px-5 bg-gradient-to-r from-rose-600 to-pink-600 hover:from-rose-500 hover:to-pink-500 disabled:from-zinc-800 disabled:to-zinc-800 disabled:text-zinc-500 text-white font-semibold rounded-xl text-sm flex items-center justify-center gap-2 shadow-lg shadow-rose-900/20 transition-all"
            >
              {submitting ? (
                <>
                  <RefreshCw className="w-4 h-4 animate-spin" />
                  <span>Processing Reel Automatically (Resolving, Archiving &amp; Publishing)...</span>
                </>
              ) : (
                <>
                  <UploadCloud className="w-4 h-4" />
                  <span>Process Reel Automatically</span>
                </>
              )}
            </button>
          </form>

          {/* Pipeline Stages Overview */}
          <div className="bg-zinc-900/40 border border-zinc-800/80 rounded-2xl p-5 space-y-3">
            <h2 className="text-xs font-semibold uppercase tracking-wider text-zinc-400">
              Automated Cloud Pipeline
            </h2>
            <div className="flex flex-wrap items-center gap-2 text-[11px] text-zinc-300">
              {PIPELINE_STAGES.map((stage, idx) => (
                <React.Fragment key={stage.key}>
                  <span className="px-2.5 py-1 rounded-lg bg-zinc-950 border border-zinc-800 font-medium">
                    {stage.label}
                  </span>
                  {idx < PIPELINE_STAGES.length - 1 && (
                    <ChevronRight className="w-3 h-3 text-zinc-600" />
                  )}
                </React.Fragment>
              ))}
            </div>
          </div>
        </div>

        {/* Right Column: Live Recent Jobs */}
        <div className="lg:col-span-5 space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-white">Live Processing Queue</h2>
            <Link
              href="/uploads"
              className="text-xs text-rose-400 hover:text-rose-300 font-medium"
            >
              Full Upload History →
            </Link>
          </div>

          {loadJobsError && (
            <InlineNoticeBanner type="warning" message={loadJobsError} />
          )}

          <div className="space-y-3">
            {jobs.length === 0 ? (
              <div className="bg-zinc-900/50 border border-zinc-800 rounded-2xl p-8 text-center text-xs text-zinc-500">
                No Reel jobs yet. Paste an Instagram Reel URL to launch the automated pipeline.
              </div>
            ) : (
              jobs.slice(0, 6).map((job) => {
                const badge = getJobStatusBadge(job.status);
                const isRetrying = retryingJobId === job.id;
                const canAutoRetry =
                  job.status === 'FAILED' ||
                  job.status === 'WAITING_FOR_AUTHORIZED_MEDIA' ||
                  job.status === 'AMBIGUOUS_UPLOAD';

                return (
                  <div
                    key={job.id}
                    className="bg-zinc-900/60 border border-zinc-800 rounded-2xl p-4 space-y-2.5"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="text-xs font-semibold text-white truncate">
                          {job.caption || `Reel #${job.shortcode || job.reel_id}`}
                        </p>
                        <p className="text-[11px] text-zinc-400 font-mono mt-0.5">
                          @{job.account_username} • {job.shortcode || job.reel_id} •{' '}
                          {formatRelativeTime(job.updated_at || job.created_at)}
                        </p>
                      </div>
                      <span
                        className={`shrink-0 inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[10px] font-semibold border ${badge.bg} ${badge.text} ${badge.border}`}
                      >
                        {badge.label}
                      </span>
                    </div>

                    {job.error_details && (
                      <p className="text-[11px] text-rose-300 bg-rose-500/10 border border-rose-500/20 rounded-xl p-2 break-words">
                        {job.error_details}
                      </p>
                    )}

                    <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
                      <div className="flex items-center gap-3 text-[11px]">
                        {job.drive_file_url && (
                          <a
                            href={job.drive_file_url}
                            target="_blank"
                            rel="noreferrer"
                            className="inline-flex items-center gap-1 text-cyan-400 hover:underline font-medium"
                          >
                            <HardDrive className="w-3 h-3" />
                            Drive Archive
                            <ExternalLink className="w-2.5 h-2.5" />
                          </a>
                        )}
                        {job.youtube_video_url && (
                          <a
                            href={job.youtube_video_url}
                            target="_blank"
                            rel="noreferrer"
                            className="inline-flex items-center gap-1 text-red-400 hover:underline font-semibold"
                          >
                            <YouTubeIcon className="w-3 h-3" />
                            Public Short
                            <ExternalLink className="w-2.5 h-2.5" />
                          </a>
                        )}
                      </div>

                      {canAutoRetry && (
                        <button
                          type="button"
                          onClick={() => handleAutomaticRetry(job.id)}
                          disabled={isRetrying}
                          className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-rose-600/20 hover:bg-rose-600/30 text-rose-300 border border-rose-500/30 text-[11px] font-semibold disabled:opacity-50"
                        >
                          <RotateCcw className={`w-3 h-3 ${isRetrying ? 'animate-spin' : ''}`} />
                          {isRetrying ? 'Retrying...' : 'Retry Automatically'}
                        </button>
                      )}
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
