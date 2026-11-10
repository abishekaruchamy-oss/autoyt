'use client';

import React, { useState } from 'react';
import {
  X,
  ShieldCheck,
  ExternalLink,
  Sparkles,
  Lock,
} from 'lucide-react';
import { Instagram } from '@/components/ui/Icons';

interface AddAccountModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
}

const PRESET_CREATORS = [
  {
    username: 'artisan_coffee_roasters',
    name: 'Artisan Coffee Roasters',
    profile_pic: 'https://images.unsplash.com/photo-1501339847302-ac426a4a7cbb?w=150',
  },
  {
    username: 'streetstyle_tokyo',
    name: 'Tokyo Streetwear & Fashion',
    profile_pic: 'https://images.unsplash.com/photo-1517841905240-472988babdf9?w=150',
  },
  {
    username: 'gamerzone_clips',
    name: 'GamerZone Highlights',
    profile_pic: 'https://images.unsplash.com/photo-1542751371-adc38448a05e?w=150',
  },
];

export function AddAccountModal({ isOpen, onClose, onSuccess }: AddAccountModalProps) {
  const [activeTab, setActiveTab] = useState<'meta' | 'demo'>('meta');
  const [customUsername, setCustomUsername] = useState('');
  const [customName, setCustomName] = useState('');
  const [loading, setLoading] = useState(false);

  if (!isOpen) return null;

  const handleCreateDemo = async (username: string, name: string, profilePic?: string) => {
    try {
      setLoading(true);
      const res = await fetch('/api/accounts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username,
          name,
          profile_picture_url:
            profilePic ||
            'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=150',
          raw_token: `EAAB_demo_token_${Date.now()}`,
        }),
      });
      const data = (await res.json()) as { success: boolean; error?: string };
      if (data.success) {
        onSuccess();
        onClose();
      } else {
        alert(data.error || 'Failed to connect account');
      }
    } catch {
      alert('Network error while connecting account');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="bg-zinc-950 border border-zinc-800 rounded-3xl w-full max-w-lg p-6 shadow-2xl relative">
        {/* Close Button */}
        <button
          onClick={onClose}
          className="absolute top-5 right-5 p-2 rounded-xl text-zinc-400 hover:text-white hover:bg-zinc-900 transition-colors"
        >
          <X className="w-5 h-5" />
        </button>

        {/* Modal Title */}
        <div className="flex items-center gap-3 mb-6">
          <div className="w-10 h-10 rounded-2xl bg-gradient-to-tr from-amber-500 via-rose-500 to-purple-600 flex items-center justify-center text-white shadow-lg">
            <Instagram className="w-5 h-5" />
          </div>
          <div>
            <h3 className="text-lg font-bold text-white">Connect Instagram Creator Account</h3>
            <p className="text-xs text-zinc-400">Add a source account for automated YouTube Shorts</p>
          </div>
        </div>

        {/* Tabs */}
        <div className="flex bg-zinc-900/80 p-1 rounded-xl mb-6 border border-zinc-800">
          <button
            onClick={() => setActiveTab('meta')}
            className={`flex-1 py-2 text-xs font-semibold rounded-lg transition-all ${
              activeTab === 'meta'
                ? 'bg-zinc-800 text-white shadow-sm'
                : 'text-zinc-400 hover:text-zinc-200'
            }`}
          >
            Official Meta OAuth
          </button>
          <button
            onClick={() => setActiveTab('demo')}
            className={`flex-1 py-2 text-xs font-semibold rounded-lg transition-all ${
              activeTab === 'demo'
                ? 'bg-zinc-800 text-white shadow-sm'
                : 'text-zinc-400 hover:text-zinc-200'
            }`}
          >
            Demo / Creator Sandbox
          </button>
        </div>

        {/* Tab 1: Meta OAuth */}
        {activeTab === 'meta' && (
          <div className="space-y-4">
            <div className="bg-zinc-900/50 border border-zinc-800/80 rounded-2xl p-4 text-xs text-zinc-300 space-y-2.5">
              <div className="flex items-start gap-2">
                <ShieldCheck className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
                <span>
                  <strong>Official Meta Graph API Integration:</strong> Uses Facebook Login dialog to request authorization for your Instagram Professional / Creator account.
                </span>
              </div>
              <div className="flex items-start gap-2">
                <Lock className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
                <span>
                  <strong>Strict Security:</strong> Instagram passwords are never entered or stored. Access tokens are encrypted at rest with AES-256-GCM.
                </span>
              </div>
            </div>

            <a
              href="/api/auth/instagram/authorize"
              className="w-full py-3.5 px-4 rounded-xl font-bold text-sm bg-gradient-to-r from-pink-600 via-rose-600 to-amber-600 hover:opacity-95 text-white flex items-center justify-center gap-2 shadow-lg shadow-rose-600/25 transition-opacity"
            >
              <Instagram className="w-5 h-5" />
              <span>Authorize with Meta / Instagram</span>
              <ExternalLink className="w-4 h-4 ml-1" />
            </a>

            <p className="text-[11px] text-zinc-400 text-center">
              Requires `META_CLIENT_ID` configured in your `.env.local` file.
            </p>
          </div>
        )}

        {/* Tab 2: Demo / Creator Sandbox */}
        {activeTab === 'demo' && (
          <div className="space-y-5">
            <div>
              <span className="text-xs font-semibold text-zinc-300 block mb-2">
                Select a Preset Creator Account:
              </span>
              <div className="grid grid-cols-1 gap-2">
                {PRESET_CREATORS.map((c) => (
                  <button
                    key={c.username}
                    onClick={() => handleCreateDemo(c.username, c.name, c.profile_pic)}
                    disabled={loading}
                    className="flex items-center justify-between p-3 rounded-xl bg-zinc-900/60 hover:bg-zinc-900 border border-zinc-800 hover:border-zinc-700 transition-all text-left"
                  >
                    <div className="flex items-center gap-3">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={c.profile_pic}
                        alt={c.username}
                        className="w-8 h-8 rounded-full object-cover"
                      />
                      <div>
                        <span className="text-xs font-bold text-white block">@{c.username}</span>
                        <span className="text-[11px] text-zinc-400">{c.name}</span>
                      </div>
                    </div>
                    <span className="text-xs font-semibold text-rose-400">+ Connect</span>
                  </button>
                ))}
              </div>
            </div>

            <div className="pt-2 border-t border-zinc-800">
              <span className="text-xs font-semibold text-zinc-300 block mb-2">
                Or Add Custom Creator Handle:
              </span>
              <div className="space-y-3">
                <input
                  type="text"
                  placeholder="@handle (e.g. foodies_paradise)"
                  value={customUsername}
                  onChange={(e) => setCustomUsername(e.target.value)}
                  className="w-full bg-zinc-900 border border-zinc-800 rounded-xl px-3.5 py-2.5 text-xs text-white placeholder-zinc-500 focus:outline-none focus:border-rose-500"
                />
                <input
                  type="text"
                  placeholder="Display Name (optional)"
                  value={customName}
                  onChange={(e) => setCustomName(e.target.value)}
                  className="w-full bg-zinc-900 border border-zinc-800 rounded-xl px-3.5 py-2.5 text-xs text-white placeholder-zinc-500 focus:outline-none focus:border-rose-500"
                />
                <button
                  onClick={() =>
                    handleCreateDemo(customUsername, customName || `@${customUsername}`)
                  }
                  disabled={loading || !customUsername.trim()}
                  className="w-full py-2.5 bg-rose-600 hover:bg-rose-500 disabled:opacity-50 text-white rounded-xl text-xs font-semibold transition-all shadow-md"
                >
                  {loading ? 'Connecting...' : 'Connect Custom Creator'}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
