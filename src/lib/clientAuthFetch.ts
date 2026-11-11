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
