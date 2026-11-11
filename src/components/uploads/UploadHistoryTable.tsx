'use client';

import React, { useState } from 'react';
import {
  UploadJob,
  JobStatus,
  InstagramAccount,
} from '@/types';
import {
  HardDrive,
  UploadCloud,
  ExternalLink,
  RotateCcw,
  Search,
  Filter,
  AlertTriangle,
  CheckCircle2,
  Clock,
  Eye,
  Info,
} from 'lucide-react';
import { Instagram } from '@/components/ui/Icons';
import { getJobStatusBadge, formatRelativeTime } from '@/lib/utils';
import { authFetch } from '@/lib/clientAuthFetch';

interface UploadHistoryTableProps {
  jobs: UploadJob[];
  accounts: InstagramAccount[];
  onJobRetried: () => void;
}

export function UploadHistoryTable({
  jobs,
  accounts,
  onJobRetried,
}: UploadHistoryTableProps) {
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('ALL');
  const [accountFilter, setAccountFilter] = useState<string>('ALL');
  const [retryingId, setRetryingId] = useState<string | null>(null);
  const [selectedJob, setSelectedJob] = useState<UploadJob | null>(null);

  const filteredJobs = jobs.filter((job) => {
    if (statusFilter !== 'ALL' && job.status !== statusFilter) return false;
    if (accountFilter !== 'ALL' && job.instagram_account_id !== accountFilter) return false;
    if (search.trim()) {
      const q = search.toLowerCase();
      return (
        job.caption.toLowerCase().includes(q) ||
        job.account_username.toLowerCase().includes(q) ||
        job.reel_id.toLowerCase().includes(q)
      );
    }
    return true;
  });

  const handleRetry = async (jobId: string) => {
    try {
      setRetryingId(jobId);
      const res = await authFetch(`/api/uploads/${jobId}/retry`, { method: 'POST' });
      const data = (await res.json()) as { success: boolean; error?: string };
      if (data.success) {
        onJobRetried();
      } else {
        alert(data.error || 'Failed to retry job');
      }
    } catch {
      alert('Network error retrying job');
    } finally {
      setRetryingId(null);
    }
  };

  return (
    <div className="space-y-4">
      {/* Search and Filters Bar */}
      <div className="bg-zinc-900/60 border border-zinc-800 rounded-2xl p-4 flex flex-col md:flex-row gap-3 items-center justify-between">
        {/* Search */}
        <div className="relative w-full md:w-80">
          <Search className="w-4 h-4 text-zinc-500 absolute left-3.5 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            placeholder="Search caption, username or reel ID..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full bg-zinc-950 border border-zinc-800 rounded-xl pl-9 pr-4 py-2 text-xs text-white placeholder-zinc-500 focus:outline-none focus:border-rose-500"
          />
        </div>

        {/* Filter dropdowns */}
        <div className="flex flex-wrap items-center gap-2.5 w-full md:w-auto">
          {/* Account Filter */}
          <select
            value={accountFilter}
            onChange={(e) => setAccountFilter(e.target.value)}
            className="bg-zinc-950 border border-zinc-800 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-rose-500"
          >
            <option value="ALL">All Creator Accounts</option>
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>
                @{a.username}
              </option>
            ))}
          </select>

          {/* Status Filter */}
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="bg-zinc-950 border border-zinc-800 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-rose-500"
          >
            <option value="ALL">All Statuses</option>
            <option value="COMPLETED">Live on Shorts</option>
            <option value="UPLOADING_YOUTUBE">Uploading YouTube</option>
            <option value="STORED_DRIVE">Saved to Drive</option>
            <option value="FAILED">Failed</option>
            <option value="RETRYING">Retrying</option>
          </select>
        </div>
      </div>

      {/* Desktop Table View */}
      <div className="hidden lg:block bg-zinc-900/60 border border-zinc-800 rounded-2xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs text-zinc-300">
            <thead className="bg-zinc-950/80 text-[11px] uppercase tracking-wider text-zinc-400 border-b border-zinc-800">
              <tr>
                <th className="py-3.5 px-4 font-semibold">Reel Video</th>
                <th className="py-3.5 px-4 font-semibold">Source Account</th>
                <th className="py-3.5 px-4 font-semibold">Pipeline Status</th>
                <th className="py-3.5 px-4 font-semibold">Google Drive File</th>
                <th className="py-3.5 px-4 font-semibold">YouTube Shorts Link</th>
                <th className="py-3.5 px-4 font-semibold text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-800/80">
              {filteredJobs.length === 0 ? (
                <tr>
                  <td colSpan={6} className="py-12 text-center text-zinc-500">
                    No upload jobs match your current filter.
                  </td>
                </tr>
              ) : (
                filteredJobs.map((job) => {
                  const badge = getJobStatusBadge(job.status);
                  const isRetrying = retryingId === job.id;

                  return (
                    <tr key={job.id} className="hover:bg-zinc-800/30 transition-colors">
                      {/* Reel Thumbnail & Caption */}
                      <td className="py-4 px-4">
                        <div className="flex items-center gap-3 max-w-sm">
                          <div className="relative w-12 h-16 rounded-lg overflow-hidden bg-zinc-950 shrink-0 border border-zinc-800">
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img
                              src={job.thumbnail_url}
                              alt="Thumbnail"
                              className="w-full h-full object-cover"
                            />
                          </div>
                          <div className="min-w-0">
                            <p className="font-medium text-zinc-200 line-clamp-2 leading-snug">
                              {job.caption || 'No caption available'}
                            </p>
                            <a
                              href={job.original_reel_url}
                              target="_blank"
                              rel="noreferrer"
                              className="inline-flex items-center gap-1 text-[11px] text-pink-400 hover:text-pink-300 mt-1"
                            >
                              <Instagram className="w-3 h-3" />
                              <span>Original Reel</span>
                              <ExternalLink className="w-2.5 h-2.5" />
                            </a>
                          </div>
                        </div>
                      </td>

                      {/* Source Account */}
                      <td className="py-4 px-4 whitespace-nowrap">
                        <span className="font-semibold text-zinc-200">
                          @{job.account_username}
                        </span>
                        <span className="text-[11px] text-zinc-400 block">
                          {formatRelativeTime(job.created_at)}
                        </span>
                      </td>

                      {/* Pipeline Status */}
                      <td className="py-4 px-4 whitespace-nowrap">
                        <span
                          className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-semibold border ${badge.bg} ${badge.text} ${badge.border}`}
                        >
                          <span
                            className={`w-1.5 h-1.5 rounded-full ${
                              job.status === 'COMPLETED'
                                ? 'bg-emerald-400'
                                : job.status === 'FAILED'
                                ? 'bg-rose-400'
                                : 'bg-blue-400 animate-pulse'
                            }`}
                          />
                          {badge.label}
                        </span>
                        {job.error_details && (
                          <p className="text-[10px] text-rose-400/90 mt-1 max-w-[200px] truncate" title={job.error_details}>
                            {job.error_details}
                          </p>
                        )}
                      </td>

                      {/* Google Drive Link */}
                      <td className="py-4 px-4 whitespace-nowrap">
                        {job.drive_file_url ? (
                          <a
                            href={job.drive_file_url}
                            target="_blank"
                            rel="noreferrer"
                            className="inline-flex items-center gap-1.5 text-xs text-cyan-400 hover:text-cyan-300 font-medium"
                          >
                            <HardDrive className="w-3.5 h-3.5" />
                            <span>View in Drive</span>
                            <ExternalLink className="w-2.5 h-2.5" />
                          </a>
                        ) : (
                          <span className="text-zinc-500 text-[11px]">—</span>
                        )}
                      </td>

                      {/* YouTube Shorts Link */}
                      <td className="py-4 px-4 whitespace-nowrap">
                        {job.youtube_video_url ? (
                          <a
                            href={job.youtube_video_url}
                            target="_blank"
                            rel="noreferrer"
                            className="inline-flex items-center gap-1.5 text-xs text-red-400 hover:text-red-300 font-semibold"
                          >
                            <UploadCloud className="w-3.5 h-3.5" />
                            <span>YouTube Short</span>
                            <ExternalLink className="w-2.5 h-2.5" />
                          </a>
                        ) : (
                          <span className="text-zinc-500 text-[11px]">Not uploaded</span>
                        )}
                      </td>

                      {/* Actions */}
                      <td className="py-4 px-4 whitespace-nowrap text-right">
                        <div className="flex items-center justify-end gap-2">
                          <button
                            type="button"
                            onClick={() => setSelectedJob(job)}
                            className="p-1.5 text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800 rounded-lg transition-colors"
                            title="View Details"
                          >
                            <Info className="w-4 h-4" />
                          </button>
                          {(job.status === 'FAILED' || job.status === 'AMBIGUOUS_UPLOAD') && (
                            <button
                              type="button"
                              onClick={() => handleRetry(job.id)}
                              disabled={isRetrying}
                              className="px-2.5 py-1 bg-rose-600/20 hover:bg-rose-600/30 text-rose-300 border border-rose-500/30 rounded-lg text-xs font-semibold flex items-center gap-1 transition-colors disabled:opacity-50"
                            >
                              <RotateCcw className={`w-3 h-3 ${isRetrying ? 'animate-spin' : ''}`} />
                              <span>{isRetrying ? 'Retrying...' : job.status === 'AMBIGUOUS_UPLOAD' ? 'Reconcile' : 'Retry'}</span>
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Mobile Card View */}
      <div className="lg:hidden space-y-3">
        {filteredJobs.length === 0 ? (
          <div className="bg-zinc-900/60 border border-zinc-800 rounded-2xl p-8 text-center text-zinc-500 text-xs">
            No upload jobs found.
          </div>
        ) : (
          filteredJobs.map((job) => {
            const badge = getJobStatusBadge(job.status);
            const isRetrying = retryingId === job.id;

            return (
              <div
                key={job.id}
                className="bg-zinc-900/60 border border-zinc-800 rounded-2xl p-4 space-y-3"
              >
                <div className="flex items-start gap-3">
                  <div className="relative w-16 h-20 rounded-xl overflow-hidden bg-zinc-950 shrink-0 border border-zinc-800">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={job.thumbnail_url}
                      alt="Thumbnail"
                      className="w-full h-full object-cover"
                    />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between gap-2 mb-1">
                      <span className="font-bold text-xs text-white">@{job.account_username}</span>
                      <span
                        className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold border ${badge.bg} ${badge.text} ${badge.border}`}
                      >
                        {badge.label}
                      </span>
                    </div>
                    <p className="text-xs text-zinc-300 line-clamp-2 leading-relaxed">
                      {job.caption || 'No caption'}
                    </p>
                    <span className="text-[10px] text-zinc-400 mt-1 block">
                      {formatRelativeTime(job.created_at)}
                    </span>
                  </div>
                </div>

                {job.error_details && (
                  <div className="p-2.5 rounded-xl bg-rose-500/10 border border-rose-500/20 text-rose-300 text-[11px]">
                    <span className="font-semibold block">Error:</span>
                    <span>{job.error_details}</span>
                  </div>
                )}

                <div className="pt-2 border-t border-zinc-800/80 flex items-center justify-between gap-2">
                  <div className="flex items-center gap-3 text-xs">
                    <a
                      href={job.original_reel_url}
                      target="_blank"
                      rel="noreferrer"
                      className="text-pink-400 hover:underline flex items-center gap-1"
                    >
                      <Instagram className="w-3.5 h-3.5" /> Reel
                    </a>
                    {job.drive_file_url && (
                      <a
                        href={job.drive_file_url}
                        target="_blank"
                        rel="noreferrer"
                        className="text-cyan-400 hover:underline flex items-center gap-1"
                      >
                        <HardDrive className="w-3.5 h-3.5" /> Drive
                      </a>
                    )}
                    {job.youtube_video_url && (
                      <a
                        href={job.youtube_video_url}
                        target="_blank"
                        rel="noreferrer"
                        className="text-red-400 hover:underline flex items-center gap-1 font-semibold"
                      >
                        <UploadCloud className="w-3.5 h-3.5" /> Shorts
                      </a>
                    )}
                  </div>

                  {(job.status === 'FAILED' || job.status === 'AMBIGUOUS_UPLOAD') && (
                    <button
                      type="button"
                      onClick={() => handleRetry(job.id)}
                      disabled={isRetrying}
                      className="px-3 py-1 bg-rose-600 text-white rounded-lg text-xs font-semibold flex items-center gap-1 shadow-sm disabled:opacity-50"
                    >
                      <RotateCcw className={`w-3 h-3 ${isRetrying ? 'animate-spin' : ''}`} />
                      <span>{isRetrying ? 'Retrying...' : job.status === 'AMBIGUOUS_UPLOAD' ? 'Reconcile' : 'Retry'}</span>
                    </button>
                  )}
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* Details Modal */}
      {selectedJob && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-zinc-950 border border-zinc-800 rounded-3xl w-full max-w-md p-6 shadow-2xl relative space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-base font-bold text-white">Upload Job Details</h3>
              <button
                type="button"
                onClick={() => setSelectedJob(null)}
                className="text-zinc-400 hover:text-white p-1"
              >
                ✕
              </button>
            </div>

            <div className="space-y-3 text-xs text-zinc-300">
              <div>
                <span className="text-zinc-400 block text-[10px] uppercase font-bold">Caption</span>
                <p className="mt-1 bg-zinc-900 p-2.5 rounded-xl border border-zinc-800 whitespace-pre-wrap">
                  {selectedJob.caption}
                </p>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <span className="text-zinc-400 block text-[10px] uppercase font-bold">Account</span>
                  <span className="text-white font-semibold">@{selectedJob.account_username}</span>
                </div>
                <div>
                  <span className="text-zinc-400 block text-[10px] uppercase font-bold">Status</span>
                  <span className="text-white font-semibold">{selectedJob.status}</span>
                </div>
              </div>

              {selectedJob.error_details && (
                <div>
                  <span className="text-rose-400 block text-[10px] uppercase font-bold">Error Message</span>
                  <p className="mt-1 bg-rose-500/10 text-rose-300 p-2.5 rounded-xl border border-rose-500/20 font-mono text-[11px]">
                    {selectedJob.error_details}
                  </p>
                </div>
              )}
            </div>

            <div className="pt-2 border-t border-zinc-800 text-right">
              <button
                type="button"
                onClick={() => setSelectedJob(null)}
                className="px-4 py-2 bg-zinc-800 hover:bg-zinc-700 text-white rounded-xl text-xs font-semibold"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
