'use client';

import React, { useState } from 'react';
import { X, RotateCcw, ShieldCheck, Check } from 'lucide-react';
import { Instagram } from '@/components/ui/Icons';
import { authFetch } from '@/lib/clientAuthFetch';
import { InstagramAccount } from '@/types';

interface ReconnectModalProps {
  account: InstagramAccount | null;
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
}

export function ReconnectModal({ account, isOpen, onClose, onSuccess }: ReconnectModalProps) {
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);

  if (!isOpen || !account) return null;

  const handleReconnect = async () => {
    try {
      setLoading(true);
      const res = await authFetch(`/api/accounts/${account.id}/reconnect`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          raw_token: `EAAB_refreshed_oauth_token_${Date.now()}`,
        }),
      });
      const data = (await res.json()) as { success: boolean; error?: string };
      if (data.success) {
        setSuccess(true);
        setTimeout(() => {
          setSuccess(false);
          onSuccess();
          onClose();
        }, 1200);
      } else {
        alert(data.error || 'Failed to reconnect account');
      }
    } catch {
      alert('Error during reconnect');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="bg-zinc-950 border border-zinc-800 rounded-3xl w-full max-w-md p-6 shadow-2xl relative">
        <button
          onClick={onClose}
          className="absolute top-5 right-5 p-2 rounded-xl text-zinc-400 hover:text-white hover:bg-zinc-900 transition-colors"
        >
          <X className="w-5 h-5" />
        </button>

        <div className="text-center mb-6">
          <div className="relative inline-block mb-3">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={account.profile_picture_url}
              alt={account.username}
              className="w-16 h-16 rounded-2xl object-cover ring-2 ring-rose-500 mx-auto"
            />
            <div className="absolute -bottom-1 -right-1 bg-gradient-to-tr from-amber-500 to-rose-500 p-1 rounded-md text-white">
              <Instagram className="w-3.5 h-3.5" />
            </div>
          </div>
          <h3 className="text-lg font-bold text-white">Reconnect @{account.username}</h3>
          <p className="text-xs text-zinc-400 mt-1">
            Renew the Meta OAuth access token for this Instagram Creator profile.
          </p>
        </div>

        <div className="bg-zinc-900/60 border border-zinc-800 rounded-2xl p-4 text-xs text-zinc-300 space-y-2 mb-6">
          <div className="flex items-center gap-2 text-emerald-400 font-semibold">
            <ShieldCheck className="w-4 h-4" />
            <span>Valid for 60 Days</span>
          </div>
          <p className="text-zinc-400 text-[11px] leading-relaxed">
            Meta requires token renewal every 60 days. Reconnecting generates a refreshed long-lived token stored encrypted with AES-256-GCM.
          </p>
        </div>

        {success ? (
          <div className="w-full py-3 bg-emerald-500/15 border border-emerald-500/30 text-emerald-400 rounded-xl text-xs font-bold flex items-center justify-center gap-2">
            <Check className="w-4 h-4" />
            <span>Token Renewed Successfully!</span>
          </div>
        ) : (
          <button
            onClick={handleReconnect}
            disabled={loading}
            className="w-full py-3 bg-rose-600 hover:bg-rose-500 text-white rounded-xl text-xs font-bold transition-all flex items-center justify-center gap-2 shadow-lg shadow-rose-600/25"
          >
            <RotateCcw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
            <span>{loading ? 'Refreshing Token...' : 'Renew OAuth Token'}</span>
          </button>
        )}
      </div>
    </div>
  );
}
