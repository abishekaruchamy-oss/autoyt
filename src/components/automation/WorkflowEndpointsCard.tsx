'use client';

import React, { useState } from 'react';
import {
  Code,
  Copy,
  Check,
  ExternalLink,
  Cpu,
  Layers,
  ArrowRight,
} from 'lucide-react';

export function WorkflowEndpointsCard() {
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  const copyToClipboard = (text: string, key: string) => {
    navigator.clipboard.writeText(text);
    setCopiedKey(key);
    setTimeout(() => setCopiedKey(null), 2000);
  };

  const origin = typeof window !== 'undefined' ? window.location.origin : 'http://localhost:3000';

  const endpoints = [
    {
      name: '1. Fetch Active Instagram Account',
      method: 'GET',
      path: '/api/n8n/active-account',
      desc: 'n8n queries this first. Retrieves active account ID, username, and decrypted OAuth token dynamically from PostgreSQL.',
    },
    {
      name: '2. Acquire Execution Lock',
      method: 'POST',
      path: '/api/n8n/lock',
      desc: 'Prevents overlapping executions if an earlier run is still processing video downloads or uploads.',
    },
    {
      name: '3. Update Reel & Upload Status',
      method: 'POST',
      path: '/api/n8n/upload-status',
      desc: 'Reports status transitions (DOWNLOADING, STORED_DRIVE, UPLOADING_YOUTUBE, COMPLETED, FAILED) with URLs.',
    },
    {
      name: '4. Release Execution Lock',
      method: 'POST',
      path: '/api/n8n/unlock',
      desc: 'Unlocks the runner and updates last successful polling timestamp.',
    },
  ];

  return (
    <div className="bg-zinc-900/60 border border-zinc-800 rounded-3xl p-6 sm:p-8 space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-2xl bg-purple-500/10 text-purple-400 flex items-center justify-center">
            <Cpu className="w-5 h-5" />
          </div>
          <div>
            <h3 className="text-lg font-bold text-white">Scheduled Automation Engine (Cloudflare Cron / n8n)</h3>
            <p className="text-xs text-zinc-400">
              Database-backed dynamic endpoints for zero-downtime profile switching & execution locking
            </p>
          </div>
        </div>
      </div>

      {/* Step Diagram */}
      <div className="p-4 bg-zinc-950/80 rounded-2xl border border-zinc-800 text-xs">
        <div className="grid grid-cols-1 sm:grid-cols-4 gap-3 text-center">
          <div className="p-3 bg-zinc-900/70 rounded-xl border border-zinc-800">
            <span className="text-[10px] uppercase font-bold text-rose-400 block mb-1">Step 1</span>
            <span className="font-semibold text-zinc-200">Query DB Active Account</span>
          </div>
          <div className="p-3 bg-zinc-900/70 rounded-xl border border-zinc-800">
            <span className="text-[10px] uppercase font-bold text-purple-400 block mb-1">Step 2</span>
            <span className="font-semibold text-zinc-200">Instagram Graph API</span>
          </div>
          <div className="p-3 bg-zinc-900/70 rounded-xl border border-zinc-800">
            <span className="text-[10px] uppercase font-bold text-cyan-400 block mb-1">Step 3</span>
            <span className="font-semibold text-zinc-200">Google Drive Backup</span>
          </div>
          <div className="p-3 bg-zinc-900/70 rounded-xl border border-zinc-800">
            <span className="text-[10px] uppercase font-bold text-red-400 block mb-1">Step 4</span>
            <span className="font-semibold text-zinc-200">YouTube Shorts Upload</span>
          </div>
        </div>
      </div>

      {/* Endpoints List */}
      <div className="space-y-3">
        {endpoints.map((ep) => (
          <div
            key={ep.path}
            className="p-4 bg-zinc-950/60 rounded-2xl border border-zinc-800/80 space-y-2"
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-xs font-bold text-zinc-200">{ep.name}</span>
              <div className="flex items-center gap-2">
                <span
                  className={`text-[10px] font-bold px-2 py-0.5 rounded-md ${
                    ep.method === 'GET'
                      ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
                      : 'bg-blue-500/10 text-blue-400 border border-blue-500/20'
                  }`}
                >
                  {ep.method}
                </span>
                <button
                  type="button"
                  onClick={() => copyToClipboard(`${origin}${ep.path}`, ep.path)}
                  className="p-1 text-zinc-400 hover:text-white rounded-lg hover:bg-zinc-800 transition-colors"
                  title="Copy URL"
                >
                  {copiedKey === ep.path ? (
                    <Check className="w-3.5 h-3.5 text-emerald-400" />
                  ) : (
                    <Copy className="w-3.5 h-3.5" />
                  )}
                </button>
              </div>
            </div>
            <div className="font-mono text-xs text-rose-400 bg-zinc-900/80 p-2 rounded-xl break-all">
              {origin}
              {ep.path}
            </div>
            <p className="text-[11px] text-zinc-400">{ep.desc}</p>
          </div>
        ))}
      </div>
    </div>
  );
}
