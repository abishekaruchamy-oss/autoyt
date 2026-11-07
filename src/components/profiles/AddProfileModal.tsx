'use client';

import React, { useState } from 'react';
import { X, Plus, ShieldCheck, Link2, Sparkles, Check } from 'lucide-react';
import { Instagram } from '@/components/ui/Icons';

interface AddProfileModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
}

const PRESET_URLS = [
  {
    url: 'https://www.instagram.com/artisan_coffee_roasters/',
    name: 'Artisan Coffee Roasters',
  },
  {
    url: 'https://www.instagram.com/streetstyle_tokyo/',
    name: 'Tokyo Streetwear & Fashion',
  },
  {
    url: 'https://www.instagram.com/gamerzone_clips/',
    name: 'GamerZone Highlights',
  },
];

export function AddProfileModal({ isOpen, onClose, onSuccess }: AddProfileModalProps) {
  const [urlInput, setUrlInput] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!isOpen) return null;

  const handleSubmit = async (targetUrl: string, name?: string) => {
    try {
      setLoading(true);
      setError(null);

      const res = await fetch('/api/profiles', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          profile_url: targetUrl,
          display_name: name || undefined,
        }),
      });

      const data = await res.json();
      if (data.success) {
        setUrlInput('');
        setDisplayName('');
        onSuccess();
        onClose();
      } else {
        setError(data.error || 'Failed to add profile URL');
      }
    } catch {
      setError('Network error while adding profile');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="bg-zinc-950 border border-zinc-800 rounded-3xl w-full max-w-lg p-6 sm:p-8 shadow-2xl relative space-y-6">
        {/* Close Button */}
        <button
          onClick={onClose}
          className="absolute top-5 right-5 p-2 rounded-xl text-zinc-400 hover:text-white hover:bg-zinc-900 transition-colors"
        >
          <X className="w-5 h-5" />
        </button>

        {/* Modal Header */}
        <div className="flex items-center gap-3">
          <div className="w-12 h-12 rounded-2xl bg-gradient-to-tr from-amber-500 via-rose-500 to-purple-600 flex items-center justify-center text-white shadow-lg">
            <Link2 className="w-6 h-6" />
          </div>
          <div>
            <h3 className="text-xl font-bold text-white tracking-tight">Add Public Instagram Profile</h3>
            <p className="text-xs text-zinc-400 mt-0.5">
              Paste any public Instagram profile URL to monitor for YouTube Shorts republishing.
            </p>
          </div>
        </div>

        {/* Security / Compliance Notice */}
        <div className="bg-zinc-900/60 border border-zinc-800 rounded-2xl p-4 text-xs text-zinc-300 space-y-2">
          <div className="flex items-center gap-2 text-emerald-400 font-semibold">
            <ShieldCheck className="w-4 h-4" />
            <span>Zero Login or Password Requirement</span>
          </div>
          <p className="text-[11px] text-zinc-400 leading-relaxed">
            We use only permitted public web requests. No Instagram accounts, passwords, session tokens, or unauthorized scraping are required or used.
          </p>
        </div>

        {error && (
          <div className="p-3 bg-rose-500/10 border border-rose-500/20 text-rose-300 rounded-xl text-xs">
            {error}
          </div>
        )}

        {/* Form Inputs */}
        <form
          onSubmit={(e) => {
            e.preventDefault();
            handleSubmit(urlInput, displayName);
          }}
          className="space-y-4"
        >
          <div className="space-y-1.5">
            <label className="text-xs font-semibold text-zinc-300 block">
              Public Profile URL:
            </label>
            <input
              type="text"
              placeholder="https://www.instagram.com/example_creator/"
              value={urlInput}
              onChange={(e) => setUrlInput(e.target.value)}
              className="w-full bg-zinc-900 border border-zinc-800 rounded-xl px-4 py-3 text-xs text-white placeholder-zinc-500 focus:outline-none focus:border-rose-500"
              required
            />
            <span className="text-[10px] text-zinc-500 block">
              Accepts full URL or @handle (e.g. https://www.instagram.com/creators/ or @creators)
            </span>
          </div>

          <div className="space-y-1.5">
            <label className="text-xs font-semibold text-zinc-300 block">
              Display Label (Optional):
            </label>
            <input
              type="text"
              placeholder="e.g. Official Fashion Account"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              className="w-full bg-zinc-900 border border-zinc-800 rounded-xl px-4 py-3 text-xs text-white placeholder-zinc-500 focus:outline-none focus:border-rose-500"
            />
          </div>

          <button
            type="submit"
            disabled={loading || !urlInput.trim()}
            className="w-full py-3 bg-rose-600 hover:bg-rose-500 disabled:opacity-50 text-white rounded-xl text-xs font-bold transition-all shadow-md shadow-rose-600/30 flex items-center justify-center gap-2"
          >
            <Plus className="w-4 h-4" />
            <span>{loading ? 'Verifying & Adding Profile...' : 'Add Profile to Monitoring'}</span>
          </button>
        </form>

        {/* Presets */}
        <div className="pt-2 border-t border-zinc-800">
          <span className="text-xs font-semibold text-zinc-400 block mb-2">Or select a quick test profile:</span>
          <div className="grid grid-cols-1 gap-2">
            {PRESET_URLS.map((p) => (
              <button
                key={p.url}
                type="button"
                onClick={() => handleSubmit(p.url, p.name)}
                disabled={loading}
                className="flex items-center justify-between p-2.5 rounded-xl bg-zinc-900/60 hover:bg-zinc-900 border border-zinc-800 transition-colors text-left text-xs"
              >
                <div>
                  <span className="font-semibold text-zinc-200 block">{p.name}</span>
                  <span className="text-[10px] text-zinc-500 font-mono">{p.url}</span>
                </div>
                <span className="text-xs text-rose-400 font-semibold">+ Add</span>
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
