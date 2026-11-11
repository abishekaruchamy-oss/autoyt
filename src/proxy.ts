import { NextRequest, NextResponse } from 'next/server';
import {
  isAdminAuthConfigured,
  SESSION_COOKIE_NAME,
  verifySessionToken,
} from '@/lib/auth';

const PUBLIC_PAGE_PATHS = new Set(['/login']);

/**
 * Optimistic Next.js 16 session gate for UI page routes.
 * Note: Authoritative authentication and CSRF validation always execute
 * inside each API route handler (`requireAdminApi` / `requireWebhookOrAdminApi`).
 */
export function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;

  if (pathname.startsWith('/api/')) {
    return NextResponse.next();
  }

  const applySecurityHeaders = (response: NextResponse) => {
    response.headers.set('X-Content-Type-Options', 'nosniff');
    response.headers.set('X-Frame-Options', 'DENY');
    response.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
    return response;
  };

  if (PUBLIC_PAGE_PATHS.has(pathname)) {
    return applySecurityHeaders(NextResponse.next());
  }

  const sessionToken = request.cookies.get(SESSION_COOKIE_NAME)?.value;
  const session = isAdminAuthConfigured() ? verifySessionToken(sessionToken) : null;

  if (!session) {
    const loginUrl = new URL('/login', request.url);
    const nextPath = `${pathname}${search}`;
    if (nextPath && nextPath !== '/') {
      loginUrl.searchParams.set('next', nextPath);
    }
    return applySecurityHeaders(NextResponse.redirect(loginUrl));
  }

  return applySecurityHeaders(NextResponse.next());
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)',
  ],
};
