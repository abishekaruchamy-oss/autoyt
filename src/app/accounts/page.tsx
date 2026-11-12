'use client';

import React, { useEffect, useState, useCallback, Suspense } from 'react';
import { MonitoredProfile } from '@/types';
import { ProfileCard } from '@/components/profiles/ProfileCard';
import { AddProfileModal } from '@/components/profiles/AddProfileModal';
import { Plus, ShieldCheck, RefreshCw, Link2 } from 'lucide-react';
import { Instagram } from '@/components/ui/Icons';
import { fetchJsonWithTimeout } from '@/lib/apiClient';
import {
  PageLoadingSkeleton,
  PageErrorBanner,
  InlineNoticeBanner,
} from '@/components/ui/PageStateCard';

function ProfilesContent() {
  const [profiles, setProfiles] = useState<MonitoredProfile[]>([]);
  const [loading, setLoading] = useState(true);
  const [retrying, setRetrying] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [bannerNotice, setBannerNotice] = useState<{
    type: 'success' | 'error' | 'warning';
    message: string;
  } | null>(null);

  const fetchProfiles = useCallback(async () => {
    try {
      setRetrying(true);
      const res = await fetchJsonWithTimeout<{
        success: boolean;
        profiles?: MonitoredProfile[];
        error?: string;
      }>('/api/profiles');
      if (res.ok && res.data?.success && res.data.profiles) {
        setProfiles(res.data.profiles);
        setLoadError(null);
      } else {
        setLoadError(res.error || res.data?.error || 'Failed to load monitored profiles.');
      }
    } finally {
      setLoading(false);
      setRetrying(false);
    }
  }, []);

  useEffect(() => {
    fetchProfiles();
  }, [fetchProfiles]);

  const handleActivate = async (id: string) => {
    const res = await fetchJsonWithTimeout<{ success: boolean; message?: string; error?: string }>(
      `/api/profiles/${id}/activate`,
      { method: 'POST' }
    );
    if (res.ok && res.data?.success) {
      setBannerNotice({
        type: 'success',
        message: res.data.message || 'Active monitored source updated.',
      });
      await fetchProfiles();
    } else {
      setBannerNotice({
        type: 'error',
        message: res.error || res.data?.error || 'Failed to switch active source.',
      });
    }
  };

  const handleTogglePause = async (id: string, pause: boolean) => {
    const endpoint = pause ? `/api/profiles/${id}/pause` : `/api/profiles/${id}/resume`;
    const res = await fetchJsonWithTimeout<{ success: boolean; error?: string }>(endpoint, {
      method: 'POST',
    });
    if (res.ok && res.data?.success) {
      setBannerNotice({
        type: 'success',
        message: pause ? 'Profile monitoring paused.' : 'Profile monitoring resumed.',
      });
      await fetchProfiles();
    } else {
      setBannerNotice({
        type: 'error',
        message: res.error || res.data?.error || 'Failed to update profile monitoring status.',
      });
    }
  };

  const handleCheckNow = async (id: string) => {
    const res = await fetchJsonWithTimeout<{ success: boolean; message?: string; error?: string }>(
      `/api/profiles/${id}/check`,
      { method: 'POST' },
      15000
    );
    if (res.ok && res.data?.success) {
      setBannerNotice({
        type: 'success',
        message: res.data.message || 'Public profile reachability probe completed.',
      });
      await fetchProfiles();
    } else {
      setBannerNotice({
        type: 'error',
        message: res.error || res.data?.error || 'Profile check failed.',
      });
    }
  };

  const handleRemove = async (id: string) => {
    const res = await fetchJsonWithTimeout<{ success: boolean; error?: string }>(
      `/api/profiles/${id}`,
      { method: 'DELETE' }
    );
    if (res.ok && res.data?.success) {
      setBannerNotice({ type: 'success', message: 'Monitored profile removed.' });
      await fetchProfiles();
    } else {
      setBannerNotice({
        type: 'error',
        message: res.error || res.data?.error || 'Failed to remove profile.',
      });
    }
  };

  if (loading) {
    return <PageLoadingSkeleton label="Loading Public Profile Manager..." />;
  }

  if (loadError && profiles.length === 0) {
    return <PageErrorBanner message={loadError} onRetry={fetchProfiles} retrying={retrying} />;
  }

  return (
    <div className="p-4 sm:p-8 space-y-6 max-w-7xl w-full mx-auto">
      {/* Banner Notice */}
      {bannerNotice && (
        <InlineNoticeBanner
          type={bannerNotice.type}
          message={bannerNotice.message}
          onDismiss={() => setBannerNotice(null)}
        />
      )}

      {loadError && (
        <InlineNoticeBanner
          type="warning"
          message={`Refresh warning: ${loadError}`}
          onDismiss={() => setLoadError(null)}
        />
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
            Register public Instagram profile URLs for HTTP accessibility probes. Direct Reel video ingestion requires an authorized creator media source or direct submission.
          </p>
        </div>

        <button
          type="button"
          onClick={() => setIsAddModalOpen(true)}
          className="flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl font-bold text-xs bg-rose-600 hover:bg-rose-500 text-white transition-all shadow-md shadow-rose-600/30 shrink-0"
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
            <strong>Zero Login & Anti-Bypass Policy:</strong> Registering a URL verifies public HTTP reachability only—it does not bypass login walls or imply automatic media extraction. Use <strong className="text-white">Submit Reel</strong> with creator-authorized media URLs when Instagram restricts unauthenticated access.
          </span>
        </div>
        <span className="text-[11px] text-emerald-400 font-semibold shrink-0">Unauthenticated Public Mode</span>
      </div>

      {/* Profiles Grid */}
      {profiles.length === 0 ? (
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
