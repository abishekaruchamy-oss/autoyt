'use client';

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  Film,
  UploadCloud,
  CheckCircle2,
  AlertCircle,
  RefreshCw,
  ExternalLink,
  ShieldCheck,
  PlayCircle,
  Copy,
  Info,
  HardDrive,
  Layers,
  ChevronRight,
} from 'lucide-react';
import { YouTubeIcon } from '@/components/ui/Icons';
import { UploadJob, PublishingVisibility } from '@/types';
import { getJobStatusBadge, formatRelativeTime } from '@/lib/utils';

export default function SubmitReelPage() {
  const [reelUrl, setReelUrl] = useState('');
  const [directVideoUrl, setDirectVideoUrl] = useState('');
  const [captionOverride, setCaptionOverride] = useState('');
  const [visibility, setVisibility] = useState<PublishingVisibility>('private');
  const [confirmedRights, setConfirmedRights] = useState(false);
  const [useSandbox, setUseSandbox] = useState(false);

  const [submitting, setSubmitting] = useState(false);
  const [submissionFeedback, setSubmissionFeedback] = useState<{
    type: 'success' | 'error' | 'info';
    message: string;
  } | null>(null);

  const [jobs, setJobs] = useState<UploadJob[]>([]);
  const [loadingJobs, setLoadingJobs] = useState(true);

  // Live client-side shortcode extraction
  const extractedShortcode = useMemo(() => {
    if (!reelUrl.trim()) return null;
    const match = reelUrl.match(/(?:reel|reels|p|tv)\/([A-Za-z0-9_-]{9,15})/i);
    if (match && match[1]) return match[1];
    if (/^[A-Za-z0-9_-]{9,15}$/.test(reelUrl.trim())) return reelUrl.trim();
    return null;
  }, [reelUrl]);

  const fetchJobs = useCallback(async () => {
    try {
      const res = await fetch('/api/reels');
      const data = (await res.json()) as { success: boolean; jobs?: UploadJob[] };
      if (data.success && data.jobs) {
        setJobs(data.jobs);
      }
    } catch (err) {
      console.error('Failed to load submitted reels:', err);
    } finally {
      setLoadingJobs(false);
    }
  }, []);

  useEffect(() => {
    fetchJobs();
    const interval = setInterval(fetchJobs, 6000);
    return () => clearInterval(interval);
  }, [fetchJobs]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmissionFeedback(null);

    if (!reelUrl.trim()) {
      setSubmissionFeedback({ type: 'error', message: 'Please enter a valid Instagram Reel URL.' });
      return;
    }

    if (!confirmedRights) {
      setSubmissionFeedback({
        type: 'error',
        message: 'Compliance requirement: You must confirm creator ownership or republishing rights before submitting.',
      });
      return;
    }

    setSubmitting(true);
    try {
      const res = await fetch('/api/reels/submit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          reelUrl: reelUrl.trim(),
          directVideoUrl: directVideoUrl.trim() || undefined,
          captionOverride: captionOverride.trim() || undefined,
          visibility,
          confirmedRights,
          sandbox: useSandbox,
        }),
      });

      const data = (await res.json()) as {
        success: boolean;
        message?: string;
        error?: string;
        job?: UploadJob;
      };
      if (!res.ok || !data.success) {
        throw new Error(data.error || 'Failed to submit Reel');
      }

      setSubmissionFeedback({
        type: 'success',
        message: data.message || `Reel submitted successfully! Current status: ${data.job?.status}`,
      });

      // Clear input fields on success
      setReelUrl('');
      setDirectVideoUrl('');
      setCaptionOverride('');
      setConfirmedRights(false);

      await fetchJobs();
    } catch (err) {
      setSubmissionFeedback({
        type: 'error',
        message: (err as Error).message || 'An error occurred during submission.',
      });
    } finally {
      setSubmitting(false);
    }
  };

  const handleRetry = async (jobId: string) => {
    try {
      const res = await fetch(`/api/uploads/${jobId}/retry`, { method: 'POST' });
      const data = (await res.json()) as { success: boolean; error?: string };
      if (data.success) {
        await fetchJobs();
      }
    } catch (err) {
      console.error('Retry failed:', err);
    }
  };

  return (
    <div className="p-4 sm:p-8 space-y-8 max-w-7xl w-full mx-auto">
      {/* Page Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-6 border-b border-zinc-800">
        <div>
          <div className="flex items-center gap-2.5 mb-1.5">
            <div className="p-2 bg-gradient-to-tr from-rose-500/20 to-purple-500/20 border border-rose-500/30 rounded-xl text-rose-400">
              <Film className="w-6 h-6" />
            </div>
            <h1 className="text-2xl font-bold tracking-tight text-white">Instagram Reel Submission</h1>
          </div>
          <p className="text-sm text-zinc-400">
            Submit public Instagram Reel URLs directly to the cloud streaming pipeline. Never stores video binaries on your laptop SSD.
          </p>
        </div>

        <div className="flex items-center gap-3">
          <button
            onClick={() => fetchJobs()}
            className="flex items-center gap-2 px-3 py-2 bg-zinc-900 hover:bg-zinc-800 border border-zinc-700/80 rounded-xl text-xs font-medium text-zinc-300 transition-colors"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loadingJobs ? 'animate-spin' : ''}`} />
            Refresh Queue
          </button>
        </div>
      </div>

      {/* Main Grid: Form (Left) & Pipeline Status / Architecture Details (Right) */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
        {/* Left Column: Submission Form */}
        <div className="lg:col-span-7 space-y-6">
          <form
            onSubmit={handleSubmit}
            className="bg-zinc-900/50 border border-zinc-800/80 rounded-2xl p-6 space-y-5 shadow-xl backdrop-blur-sm"
          >
            <div className="flex items-center justify-between pb-3 border-b border-zinc-800">
              <h2 className="text-base font-semibold text-white flex items-center gap-2">
                <UploadCloud className="w-4 h-4 text-rose-400" />
                Submit New Reel
              </h2>
              <span className="text-xs px-2.5 py-0.5 rounded-full bg-rose-500/10 text-rose-400 border border-rose-500/20 font-medium">
                Primary Flow
              </span>
            </div>

            {/* Reel URL Input */}
            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-zinc-300 block">
                Instagram Reel URL or Shortcode <span className="text-rose-400">*</span>
              </label>
              <div className="relative">
                <input
                  type="text"
                  placeholder="https://www.instagram.com/reel/C3b4XyzABC1/ or C3b4XyzABC1"
                  value={reelUrl}
                  onChange={(e) => setReelUrl(e.target.value)}
                  className="w-full bg-zinc-950 border border-zinc-700/80 rounded-xl px-4 py-2.5 text-sm text-white placeholder-zinc-500 focus:outline-none focus:ring-2 focus:ring-rose-500/50 focus:border-rose-500 transition"
                  required
                />
              </div>

              {/* Live Shortcode Badge */}
              {extractedShortcode && (
                <div className="flex items-center gap-2 pt-1 text-xs">
                  <span className="text-zinc-400">Canonical Shortcode:</span>
                  <span className="px-2 py-0.5 rounded-md bg-zinc-800 font-mono text-rose-300 border border-zinc-700">
                    {extractedShortcode}
                  </span>
                  <span className="text-emerald-400 flex items-center gap-1">
                    <CheckCircle2 className="w-3.5 h-3.5" /> Valid Format
                  </span>
                </div>
              )}
            </div>

            {/* Direct Video / Authorized Stream URL (Optional) */}
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <label className="text-xs font-semibold text-zinc-300">
                  Creator-Authorized Direct Video Stream / CDN Link <span className="text-zinc-500 font-normal">(Optional)</span>
                </label>
                <span className="text-[11px] text-zinc-500">Bypasses platform login gate</span>
              </div>
              <input
                type="url"
                placeholder="https://creator-storage.example.com/video.mp4 (Optional direct MP4 link)"
                value={directVideoUrl}
                onChange={(e) => setDirectVideoUrl(e.target.value)}
                className="w-full bg-zinc-950 border border-zinc-700/80 rounded-xl px-4 py-2.5 text-sm text-white placeholder-zinc-500 focus:outline-none focus:ring-2 focus:ring-rose-500/50 focus:border-rose-500 transition"
              />
              <p className="text-[11px] text-zinc-400 leading-relaxed">
                If unauthenticated Instagram blocks video binary retrieval, supplying an authorized MP4 or Drive source ensures immediate automated publication.
              </p>
            </div>

            {/* Caption & Title Override */}
            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-zinc-300">
                Custom Caption Override <span className="text-zinc-500 font-normal">(Optional)</span>
              </label>
              <textarea
                placeholder="Leave blank to use original caption, or write custom YouTube Shorts title & description..."
                value={captionOverride}
                onChange={(e) => setCaptionOverride(e.target.value)}
                rows={2}
                className="w-full bg-zinc-950 border border-zinc-700/80 rounded-xl px-4 py-2 text-sm text-white placeholder-zinc-500 focus:outline-none focus:ring-2 focus:ring-rose-500/50 focus:border-rose-500 transition resize-none"
              />
            </div>

            {/* YouTube Shorts Visibility */}
            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-zinc-300 block">
                YouTube Shorts Visibility
              </label>
              <div className="grid grid-cols-3 gap-2">
                {(['private', 'unlisted', 'public'] as PublishingVisibility[]).map((v) => (
                  <button
                    key={v}
                    type="button"
                    onClick={() => setVisibility(v)}
                    className={`py-2 px-3 rounded-xl text-xs font-medium border capitalize transition-all ${
                      visibility === v
                        ? 'bg-rose-500/15 border-rose-500 text-rose-300 shadow-sm'
                        : 'bg-zinc-950 border-zinc-800 text-zinc-400 hover:text-zinc-200 hover:bg-zinc-900'
                    }`}
                  >
                    {v === 'private' ? 'Private (Default)' : v}
                  </button>
                ))}
              </div>
            </div>

            {/* Sandbox Test Mode Toggle */}
            <div className="flex items-center justify-between p-3 rounded-xl bg-zinc-950/60 border border-zinc-800/80">
              <div className="space-y-0.5">
                <span className="text-xs font-semibold text-zinc-300 block">Sandbox Verification Mode</span>
                <span className="text-[11px] text-zinc-500">Simulate end-to-end streaming without consuming live YouTube API quota</span>
              </div>
              <input
                type="checkbox"
                checked={useSandbox}
                onChange={(e) => setUseSandbox(e.target.checked)}
                className="w-4 h-4 accent-rose-500 cursor-pointer rounded"
              />
            </div>

            {/* Mandatory Rights Confirmation Checkbox */}
            <div className="p-3.5 rounded-xl bg-zinc-950/90 border border-rose-500/30 space-y-2">
              <label className="flex items-start gap-3 cursor-pointer">
                <input
                  type="checkbox"
                  checked={confirmedRights}
                  onChange={(e) => setConfirmedRights(e.target.checked)}
                  className="mt-1 w-4 h-4 accent-rose-500 cursor-pointer rounded"
                  required
                />
                <span className="text-xs text-zinc-300 leading-relaxed">
                  <strong className="text-white">Copyright & Ownership Confirmation:</strong> I confirm that I own this video or have explicit creator permission to republish it to YouTube Shorts. AutoShorts complies with developer terms and does not support unauthorized content re-uploading.
                </span>
              </label>
            </div>

            {/* Feedback Alert */}
            {submissionFeedback && (
              <div
                className={`p-3.5 rounded-xl text-xs flex items-start gap-2.5 border ${
                  submissionFeedback.type === 'success'
                    ? 'bg-emerald-500/10 text-emerald-300 border-emerald-500/20'
                    : 'bg-rose-500/10 text-rose-300 border-rose-500/20'
                }`}
              >
                {submissionFeedback.type === 'success' ? (
                  <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5 text-emerald-400" />
                ) : (
                  <AlertCircle className="w-4 h-4 shrink-0 mt-0.5 text-rose-400" />
                )}
                <div className="leading-relaxed">{submissionFeedback.message}</div>
              </div>
            )}

            {/* Submit Action Button */}
            <button
              type="submit"
              disabled={submitting || !confirmedRights || !reelUrl.trim()}
              className="w-full py-3 px-4 rounded-xl font-medium text-sm text-white bg-gradient-to-r from-rose-600 via-rose-500 to-amber-500 hover:from-rose-500 hover:to-amber-400 disabled:opacity-50 disabled:cursor-not-allowed shadow-lg shadow-rose-500/20 transition-all flex items-center justify-center gap-2"
            >
              {submitting ? (
                <>
                  <RefreshCw className="w-4 h-4 animate-spin" />
                  <span>Processing Stream Pipeline...</span>
                </>
              ) : (
                <>
                  <Film className="w-4 h-4" />
                  <span>Submit Reel to Pipeline</span>
                </>
              )}
            </button>
          </form>
        </div>

        {/* Right Column: Architectural Pipeline Rules & Stream Flow */}
        <div className="lg:col-span-5 space-y-6">
          {/* Architecture Overview */}
          <div className="bg-zinc-900/50 border border-zinc-800/80 rounded-2xl p-6 space-y-4">
            <h3 className="text-sm font-semibold text-white flex items-center gap-2">
              <ShieldCheck className="w-4 h-4 text-emerald-400" />
              Pipeline Execution Guarantees
            </h3>

            <div className="space-y-3 text-xs text-zinc-400">
              <div className="flex gap-2.5">
                <span className="font-mono text-rose-400 font-bold shrink-0">01</span>
                <div>
                  <strong className="text-zinc-200 block mb-0.5">Zero Local SSD Storage</strong>
                  <span>Media streams directly from cloud origin to Google Drive and YouTube Shorts using 5MB RAM buffers. 0 bytes written to laptop disk.</span>
                </div>
              </div>

              <div className="flex gap-2.5">
                <span className="font-mono text-rose-400 font-bold shrink-0">02</span>
                <div>
                  <strong className="text-zinc-200 block mb-0.5">Strict Policy Compliance</strong>
                  <span>No session stealing, no CAPTCHA bypasses, and no proxy evasion. Protected content reports waiting state honestly.</span>
                </div>
              </div>

              <div className="flex gap-2.5">
                <span className="font-mono text-rose-400 font-bold shrink-0">03</span>
                <div>
                  <strong className="text-zinc-200 block mb-0.5">Deduplication Protection</strong>
                  <span>Shortcode hashing prevents duplicate processing and double YouTube uploads.</span>
                </div>
              </div>

              <div className="flex gap-2.5">
                <span className="font-mono text-rose-400 font-bold shrink-0">04</span>
                <div>
                  <strong className="text-zinc-200 block mb-0.5">Automatic #shorts Formatting</strong>
                  <span>Shorts titles format automatically with valid hashtags and source attribution.</span>
                </div>
              </div>
            </div>
          </div>

          {/* Granular Pipeline State Map */}
          <div className="bg-zinc-900/50 border border-zinc-800/80 rounded-2xl p-6 space-y-3">
            <h3 className="text-sm font-semibold text-white flex items-center gap-2">
              <Layers className="w-4 h-4 text-purple-400" />
              Pipeline State Machine
            </h3>

            <div className="space-y-2 text-xs">
              <div className="flex items-center gap-2 text-zinc-300">
                <span className="w-2 h-2 rounded-full bg-zinc-500"></span>
                <span className="font-mono">SUBMITTED</span>
                <ChevronRight className="w-3 h-3 text-zinc-600" />
                <span className="font-mono">VALIDATING</span>
                <ChevronRight className="w-3 h-3 text-zinc-600" />
                <span className="font-mono">RESOLVING_MEDIA</span>
              </div>
              <div className="flex items-center gap-2 text-zinc-300 pl-4 border-l-2 border-zinc-800">
                <ChevronRight className="w-3 h-3 text-emerald-400" />
                <span className="font-mono text-emerald-400">MEDIA_AVAILABLE</span>
                <span className="text-zinc-500">or</span>
                <span className="font-mono text-amber-400">WAITING_FOR_AUTHORIZED_MEDIA</span>
              </div>
              <div className="flex items-center gap-2 text-zinc-300 pl-4 border-l-2 border-zinc-800">
                <ChevronRight className="w-3 h-3 text-blue-400" />
                <span className="font-mono text-indigo-400">ARCHIVING_TO_DRIVE</span>
                <ChevronRight className="w-3 h-3 text-zinc-600" />
                <span className="font-mono text-cyan-400">STORED_IN_DRIVE</span>
              </div>
              <div className="flex items-center gap-2 text-zinc-300 pl-4 border-l-2 border-zinc-800">
                <ChevronRight className="w-3 h-3 text-rose-400" />
                <span className="font-mono text-blue-400">UPLOADING_TO_YOUTUBE</span>
                <ChevronRight className="w-3 h-3 text-zinc-600" />
                <span className="font-mono text-emerald-400">COMPLETED</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Reel Submissions & Processing Queue Table */}
      <div className="space-y-4 pt-4">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-lg font-bold text-white flex items-center gap-2">
              <Film className="w-5 h-5 text-rose-400" />
              Reel Submission & Queue Monitor
            </h2>
            <p className="text-xs text-zinc-400">Real-time status of all submitted Instagram Reels</p>
          </div>
          <span className="text-xs text-zinc-400 bg-zinc-900 px-3 py-1.5 rounded-xl border border-zinc-800">
            {jobs.length} Total Submissions
          </span>
        </div>

        <div className="bg-zinc-900/40 border border-zinc-800/80 rounded-2xl overflow-hidden shadow-xl">
          {jobs.length === 0 ? (
            <div className="p-12 text-center space-y-3">
              <Film className="w-8 h-8 text-zinc-600 mx-auto" />
              <p className="text-sm text-zinc-400 font-medium">No Reels submitted yet.</p>
              <p className="text-xs text-zinc-500">
                Enter an Instagram Reel URL above to start streaming directly to YouTube Shorts.
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="bg-zinc-950/80 text-zinc-400 border-b border-zinc-800 uppercase tracking-wider font-semibold">
                  <tr>
                    <th className="py-3 px-4">Reel / Shortcode</th>
                    <th className="py-3 px-4">Status</th>
                    <th className="py-3 px-4">Cloud Drive Archive</th>
                    <th className="py-3 px-4">YouTube Shorts</th>
                    <th className="py-3 px-4">Details / Timestamp</th>
                    <th className="py-3 px-4 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-800/60">
                  {jobs.map((job) => {
                    const badge = getJobStatusBadge(job.status);
                    return (
                      <tr key={job.id} className="hover:bg-zinc-900/50 transition-colors">
                        {/* Reel / Shortcode */}
                        <td className="py-3.5 px-4">
                          <div className="space-y-1">
                            <div className="flex items-center gap-2">
                              <span className="font-mono text-zinc-200 font-bold">
                                {job.shortcode || job.reel_id}
                              </span>
                              {job.original_reel_url && (
                                <a
                                  href={job.original_reel_url}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="text-zinc-500 hover:text-zinc-300"
                                >
                                  <ExternalLink className="w-3.5 h-3.5" />
                                </a>
                              )}
                            </div>
                            <p className="text-[11px] text-zinc-400 line-clamp-1 max-w-xs">
                              {job.caption || 'No caption provided'}
                            </p>
                          </div>
                        </td>

                        {/* Status */}
                        <td className="py-3.5 px-4 whitespace-nowrap">
                          <span
                            className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-medium border ${badge.bg} ${badge.text} ${badge.border}`}
                          >
                            <span className="w-1.5 h-1.5 rounded-full bg-current"></span>
                            {badge.label}
                          </span>
                        </td>

                        {/* Google Drive Archive */}
                        <td className="py-3.5 px-4 whitespace-nowrap">
                          {job.drive_file_id ? (
                            <a
                              href={job.drive_file_url || `https://drive.google.com/file/d/${job.drive_file_id}/view`}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="inline-flex items-center gap-1.5 text-cyan-400 hover:text-cyan-300 hover:underline"
                            >
                              <HardDrive className="w-3.5 h-3.5" />
                              <span>View in Drive</span>
                              <ExternalLink className="w-3 h-3" />
                            </a>
                          ) : (
                            <span className="text-zinc-500">—</span>
                          )}
                        </td>

                        {/* YouTube Shorts */}
                        <td className="py-3.5 px-4 whitespace-nowrap">
                          {job.youtube_video_id ? (
                            <a
                              href={job.youtube_video_url || `https://youtube.com/shorts/${job.youtube_video_id}`}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="inline-flex items-center gap-1.5 text-rose-400 hover:text-rose-300 font-medium hover:underline"
                            >
                              <YouTubeIcon className="w-3.5 h-3.5" />
                              <span>Watch Short</span>
                              <ExternalLink className="w-3 h-3" />
                            </a>
                          ) : (
                            <span className="text-zinc-500">—</span>
                          )}
                        </td>

                        {/* Details / Timestamp */}
                        <td className="py-3.5 px-4 max-w-xs">
                          {job.error_details ? (
                            <p className="text-[11px] text-amber-400 line-clamp-2" title={job.error_details}>
                              {job.error_details}
                            </p>
                          ) : (
                            <span className="text-[11px] text-zinc-500">
                              {formatRelativeTime(job.created_at)}
                            </span>
                          )}
                        </td>

                        {/* Actions */}
                        <td className="py-3.5 px-4 text-right whitespace-nowrap">
                          {job.status === 'FAILED' && (
                            <button
                              onClick={() => handleRetry(job.id)}
                              className="px-2.5 py-1 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 rounded-lg text-[11px] font-medium border border-zinc-700 transition-colors"
                            >
                              Retry
                            </button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
