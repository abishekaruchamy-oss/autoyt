'use client';

const CSRF_COOKIE_NAME = 'autoshorts_csrf';
const MUTATING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

function readCookieValue(name: string): string | null {
  if (typeof document === 'undefined' || !document.cookie) return null;
  const targetPrefix = `${name}=`;
  for (const part of document.cookie.split(';')) {
    const trimmed = part.trim();
    if (trimmed.startsWith(targetPrefix)) {
      try {
        return decodeURIComponent(trimmed.slice(targetPrefix.length));
      } catch {
        return trimmed.slice(targetPrefix.length);
      }
    }
  }
  return null;
}

export function sanitizeNextPath(raw: string | null | undefined): string {
  if (!raw || !raw.startsWith('/') || raw.startsWith('//') || raw.includes('\\')) {
    return '/';
  }
  return raw;
}

export function redirectToPath(
  target: string,
  locationLike: Pick<Location, 'replace'> | undefined = typeof globalThis !== 'undefined'
    ? globalThis.location
    : undefined
): void {
  if (locationLike && typeof locationLike.replace === 'function') {
    locationLike.replace(sanitizeNextPath(target));
  }
}

export type OperatorLoginResult =
  | { ok: true; nextPath: string }
  | { ok: false; status?: number; error: string };

/**
 * Submits operator credentials to `POST /api/auth/session` and performs a full
 * top-level navigation on success so stale unauthenticated Router Cache state
 * cannot bounce the user back to `/login`.
 */
export async function submitOperatorLogin(options: {
  accessKey: string;
  nextPath?: string | null;
  fetchImpl?: typeof fetch;
  navigate?: (target: string) => void;
}): Promise<OperatorLoginResult> {
  const safeNext = sanitizeNextPath(options.nextPath);
  if (!options.accessKey.trim()) {
    return { ok: false, error: 'Enter the operator access key.' };
  }

  const fetchFn = options.fetchImpl ?? fetch;
  const navigateFn = options.navigate ?? ((target: string) => redirectToPath(target));

  try {
    const res = await fetchFn('/api/auth/session', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify({ accessKey: options.accessKey }),
    });

    let data: { success?: boolean; error?: string } = {};
    try {
      data = (await res.json()) as { success?: boolean; error?: string };
    } catch {
      data = {};
    }

    if (!res.ok || !data.success) {
      return {
        ok: false,
        status: res.status,
        error:
          data.error ||
          (res.status >= 500
            ? 'Authentication service unavailable. Please try again.'
            : 'Authentication failed.'),
      };
    }

    navigateFn(safeNext);
    return { ok: true, nextPath: safeNext };
  } catch {
    return {
      ok: false,
      error: 'Unable to verify credentials. Please try again.',
    };
  }
}

/**
 * Authenticated browser fetch wrapper: attaches `X-CSRF-Token` on state-changing
 * requests and redirects interactive sessions to `/login` on HTTP 401.
 */
export async function authFetch(input: RequestInfo | URL, init: RequestInit = {}): Promise<Response> {
  const method = (init.method || 'GET').toUpperCase();
  const headers = new Headers(init.headers);

  if (MUTATING_METHODS.has(method)) {
    const csrfToken = readCookieValue(CSRF_COOKIE_NAME);
    if (csrfToken && !headers.has('X-CSRF-Token')) {
      headers.set('X-CSRF-Token', csrfToken);
    }
  }

  const response = await fetch(input, {
    ...init,
    headers,
    credentials: 'same-origin',
  });

  if (response.status === 401 && typeof window !== 'undefined') {
    const currentPath = window.location.pathname;
    if (currentPath !== '/login') {
      const nextTarget = `${window.location.pathname}${window.location.search}`;
      globalThis.location.replace(`/login?next=${encodeURIComponent(nextTarget)}`);
    }
  }

  return response;
}
