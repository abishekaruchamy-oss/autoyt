'use client';

import React, { Suspense, useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { AlertCircle, KeyRound, Lock, ShieldCheck } from 'lucide-react';
import { redirectToPath, sanitizeNextPath, submitOperatorLogin } from '@/lib/clientAuthFetch';

function LoginFormContent() {
  const searchParams = useSearchParams();
  const safeNext = sanitizeNextPath(searchParams.get('next'));
  const queryError = searchParams.get('error');

  const inputRef = useRef<HTMLInputElement | null>(null);
  const [accessKey, setAccessKey] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [checking, setChecking] = useState(true);
  const [configured, setConfigured] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(
    queryError === 'session_required'
      ? 'Sign in with your operator access key to continue.'
      : null
  );

  useEffect(() => {
    let active = true;
    fetch('/api/auth/session', { credentials: 'same-origin' })
      .then((res) => res.json() as Promise<{ authenticated?: boolean; configured?: boolean }>)
      .then((data) => {
        if (!active) return;
        setConfigured(Boolean(data.configured));
        if (data.authenticated) {
          redirectToPath(safeNext);
          return;
        }
        setChecking(false);
      })
      .catch(() => {
        if (active) setChecking(false);
      });

    return () => {
      active = false;
    };
  }, [safeNext]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const candidateKey = accessKey || inputRef.current?.value || '';
    if (!candidateKey.trim()) {
      setErrorMessage('Enter the operator access key.');
      return;
    }

    try {
      setSubmitting(true);
      setErrorMessage(null);
      const result = await submitOperatorLogin({
        accessKey: candidateKey,
        nextPath: safeNext,
      });

      if (!result.ok) {
        setErrorMessage(result.error);
        return;
      }

      setAccessKey('');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-[75vh] flex items-center justify-center p-6">
      <div className="w-full max-w-md bg-zinc-900/70 border border-zinc-800 rounded-3xl p-8 shadow-2xl space-y-6">
        <div className="flex items-center gap-3">
          <div className="w-11 h-11 rounded-2xl bg-rose-500/15 text-rose-400 flex items-center justify-center border border-rose-500/20">
            <Lock className="w-5 h-5" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-white tracking-tight">Operator Sign In</h1>
            <p className="text-xs text-zinc-400">Protected AutoShorts administrative console</p>
          </div>
        </div>

        {!checking && !configured && (
          <div className="p-4 rounded-2xl bg-amber-500/10 border border-amber-500/30 text-amber-200 text-xs flex items-start gap-2.5 leading-relaxed">
            <AlertCircle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
            <div>
              <p className="font-semibold text-amber-300">Authentication Not Configured</p>
              <p className="mt-1 text-amber-200/90">
                Protected routes are locked (fail-closed) until <code className="font-mono">ADMIN_ACCESS_KEY</code> and{' '}
                <code className="font-mono">ADMIN_SESSION_SECRET</code> are configured in the environment.
              </p>
            </div>
          </div>
        )}

        {errorMessage && (
          <div className="p-3.5 rounded-2xl bg-rose-500/10 border border-rose-500/30 text-rose-200 text-xs flex items-start gap-2">
            <AlertCircle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
            <span>{errorMessage}</span>
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label htmlFor="operator-access-key" className="block text-xs font-medium text-zinc-300 mb-1.5">
              Operator Access Key
            </label>
            <div className="relative">
              <KeyRound className="w-4 h-4 text-zinc-500 absolute left-3.5 top-1/2 -translate-y-1/2" />
              <input
                ref={inputRef}
                id="operator-access-key"
                type="password"
                value={accessKey}
                onChange={(e) => setAccessKey(e.target.value)}
                autoComplete="current-password"
                placeholder="Enter operator access key"
                disabled={checking || submitting || !configured}
                className="w-full bg-zinc-950 border border-zinc-800 rounded-xl pl-10 pr-4 py-2.5 text-sm text-white placeholder:text-zinc-600 focus:outline-none focus:border-rose-500 disabled:opacity-50"
              />
            </div>
          </div>

          <button
            type="submit"
            disabled={checking || submitting || !configured}
            className="w-full py-2.5 px-4 rounded-xl text-sm font-bold bg-rose-600 hover:bg-rose-500 text-white flex items-center justify-center gap-2 transition-all shadow-md shadow-rose-600/30 disabled:opacity-50"
          >
            <ShieldCheck className="w-4 h-4" />
            <span>{checking ? 'Checking session...' : submitting ? 'Verifying...' : 'Sign In'}</span>
          </button>
        </form>
      </div>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-[75vh] flex items-center justify-center text-sm text-zinc-400">
          Loading sign-in...
        </div>
      }
    >
      <LoginFormContent />
    </Suspense>
  );
}
