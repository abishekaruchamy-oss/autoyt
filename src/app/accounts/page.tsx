'use client';

import React, { useEffect, useState, useCallback, Suspense } from 'react';
import { MonitoredProfile } from '@/types';
import { ProfileCard } from '@/components/profiles/ProfileCard';
import { AddProfileModal } from '@/components/profiles/AddProfileModal';
import { Plus, ShieldCheck, RefreshCw, Link2, AlertCircle } from 'lucide-react';
import { Instagram } from '@/components/ui/Icons';
import { authFetch } from '@/lib/clientAuthFetch';

function ProfilesContent() {
  const [profiles, setProfiles] = useState<MonitoredProfile[]>([]);
  const [loading, setLoading] = useState(true);
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [bannerNotice, setBannerNotice] = useState<string | null>(null);

  const fetchProfiles = useCallback(async () => {
    try {
      const res = await authFetch('/api/profiles');
      const data = (await res.json()) as { success: boolean; profiles?: MonitoredProfile[]; error?: string };
      if (data.success && data.profiles) {
        setProfiles(data.profiles);
      }
    } catch (err) {
      console.error('Error fetching monitored profiles:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchProfiles();
  }, [fetchProfiles]);

  const handleActivate = async (id: string) => {
    const res = await authFetch(`/api/profiles/${id}/activate`, { method: 'POST' });
    const data = (await res.json()) as { success: boolean; error?: string };
    if (data.success) {
      await fetchProfiles();
    } else {
      alert(data.error || 'Failed to switch active source');
    }
  };

  const handleTogglePause = async (id: string, pause: boolean) => {
    const endpoint = pause ? `/api/profiles/${id}/pause` : `/api/profiles/${id}/resume`;
    const res = await authFetch(endpoint, { method: 'POST' });
    const data = (await res.json()) as { success: boolean; error?: string };
    if (data.success) {
      await fetchProfiles();
    } else {
      alert(data.error || 'Failed to update profile monitoring status');
    }
  };

  const handleCheckNow = async (id: string) => {
    const res = await authFetch(`/api/profiles/${id}/check`, { method: 'POST' });
    const data = (await res.json()) as { success: boolean; error?: string };
    if (data.success) {
      await fetchProfiles();
    } else {
      alert(data.error || 'Check failed');
    }
  };

  const handleRemove = async (id: string) => {
    const res = await authFetch(`/api/profiles/${id}`, { method: 'DELETE' });
    const data = (await res.json()) as { success: boolean; error?: string };
    if (data.success) {
      await fetchProfiles();
    } else {
      alert(data.error || 'Failed to remove profile');
    }
  };

  return (
    <div className="p-4 sm:p-8 space-y-6 max-w-7xl w-full mx-auto">
      {/* Banner Notice */}
      {bannerNotice && (
        <div className="p-4 rounded-2xl bg-zinc-900 border border-zinc-800 flex items-start justify-between gap-3 text-xs">
          <div className="flex items-start gap-2.5">
            <AlertCircle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
            <span className="text-zinc-200">{bannerNotice}</span>
          </div>
          <button
            onClick={() => setBannerNotice(null)}
            className="text-zinc-400 hover:text-white font-bold"
          >
            ✕
          </button>
        </div>
      )}

      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-zinc-800">
        <div>
          <div className="flex items-center gap-2.5 mb-1">
            <div className="w-8 h-8 rounded-xl bg-pink-500/10 text-pink-400 flex items-center justify-center">
              <Link2 className="w-4 h-4" />
            </div>
            <h1 className="text-2xl sm:text-3xl font-extrabold text-white tracking-tight">
              Public Profile Manager
            </h1>
          </div>
          <p className="text-xs text-zinc-400">
            Monitor public Instagram profile URLs manually. Zero OAuth or passwords required. Switch active source without changing workflows.
          </p>
        </div>

        <button
          onClick={() => setIsAddModalOpen(true)}
          className="flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl font-bold text-xs bg-rose-600 hover:bg-rose-500 text-white transition-all shadow-md shadow-rose-600/30"
        >
          <Plus className="w-4 h-4" />
          <span>Add Profile URL</span>
        </button>
      </div>

      {/* Compliance & Policy Banner */}
      <div className="bg-gradient-to-r from-zinc-900 via-zinc-900 to-zinc-950 border border-zinc-800/80 rounded-2xl p-4 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 text-xs text-zinc-300">
        <div className="flex items-center gap-2.5">
          <ShieldCheck className="w-5 h-5 text-emerald-400 shrink-0" />
          <span>
            <strong>Zero Login & Anti-Bypass Policy:</strong> Uses only permitted, publicly accessible information. If a profile requires authentication, the platform accurately reports the reason.
          </span>
        </div>
        <span className="text-[11px] text-emerald-400 font-semibold shrink-0">Unauthenticated Public Mode</span>
      </div>

      {/* Profiles Grid */}
      {loading ? (
        <div className="flex items-center justify-center py-24 text-zinc-400 gap-2 text-xs">
          <RefreshCw className="w-5 h-5 animate-spin text-rose-500" />
          <span>Loading monitored profiles...</span>
        </div>
      ) : profiles.length === 0 ? (
        <div className="bg-zinc-900/40 border border-dashed border-zinc-800 rounded-3xl p-12 text-center space-y-4">
          <div className="w-16 h-16 rounded-3xl bg-pink-500/10 text-pink-400 flex items-center justify-center mx-auto">
            <Instagram className="w-8 h-8" />
          </div>
          <div>
            <h3 className="text-base font-bold text-white">No Monitored Profiles Configured</h3>
            <p className="text-xs text-zinc-400 max-w-sm mx-auto mt-1">
              Add your first public Instagram profile URL (e.g. https://www.instagram.com/example/) to begin automated monitoring.
            </p>
          </div>
          <button
            onClick={() => setIsAddModalOpen(true)}
            className="px-5 py-2.5 bg-rose-600 hover:bg-rose-500 text-white rounded-xl text-xs font-bold transition-all shadow-md"
          >
            Add Profile URL
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
          {profiles.map((p) => (
            <ProfileCard
              key={p.id}
              profile={p}
              onActivate={handleActivate}
              onTogglePause={handleTogglePause}
              onCheckNow={handleCheckNow}
              onRemove={handleRemove}
            />
          ))}
        </div>
      )}

      {/* Add Profile Modal */}
      <AddProfileModal
        isOpen={isAddModalOpen}
        onClose={() => setIsAddModalOpen(false)}
        onSuccess={fetchProfiles}
      />
    </div>
  );
}

export default function AccountsPage() {
  return (
    <Suspense
      fallback={
        <div className="flex items-center justify-center min-h-[60vh] text-zinc-400 gap-2 text-xs">
          <RefreshCw className="w-5 h-5 animate-spin text-rose-500" />
          <span>Loading profile manager...</span>
        </div>
      }
    >
      <ProfilesContent />
    </Suspense>
  );
}
