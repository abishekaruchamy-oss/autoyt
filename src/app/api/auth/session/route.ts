import { NextRequest, NextResponse } from 'next/server';
import {
  appendClearSessionCookies,
  appendSessionCookies,
  constantTimeEqual,
  createSessionToken,
  CSRF_COOKIE_NAME,
  CSRF_HEADER_NAME,
  isAdminAuthConfigured,
  parseCookiesFromRequest,
  SESSION_COOKIE_NAME,
  verifyAdminCredentials,
  verifySameOriginRequest,
  verifySessionToken,
} from '@/lib/auth';
import { NO_STORE_HEADERS, sanitizeErrorMessage } from '@/lib/security';

const loginAttempts = new Map<string, { count: number; resetAt: number }>();

function checkLoginRateLimit(ip: string, limit = 15, windowMs = 60_000): boolean {
  const now = Date.now();
  if (loginAttempts.size > 500) {
    for (const [key, entry] of loginAttempts.entries()) {
      if (now > entry.resetAt) {
        loginAttempts.delete(key);
      }
    }
  }

  const current = loginAttempts.get(ip);
  if (!current || now > current.resetAt) {
    loginAttempts.set(ip, { count: 1, resetAt: now + windowMs });
    return true;
  }

  if (current.count >= limit) {
    return false;
  }

  current.count += 1;
  return true;
}

function getClientIp(request: Request): string {
  const cfIp = request.headers.get('cf-connecting-ip');
  if (cfIp) return cfIp.trim();
  const forwarded = request.headers.get('x-forwarded-for');
  if (forwarded) return forwarded.split(',')[0].trim();
  return '127.0.0.1';
}

export async function GET(request: NextRequest) {
  const configured = isAdminAuthConfigured();
  const cookies = parseCookiesFromRequest(request);
  const session = configured ? verifySessionToken(cookies[SESSION_COOKIE_NAME]) : null;

  return NextResponse.json(
    {
      authenticated: Boolean(session),
      configured,
    },
    { status: 200, headers: NO_STORE_HEADERS }
  );
}

export async function POST(request: NextRequest) {
  const clientIp = getClientIp(request);
  if (!checkLoginRateLimit(clientIp)) {
    return NextResponse.json(
      { success: false, error: 'Too many authentication attempts. Please try again shortly.' },
      {
        status: 429,
        headers: {
          ...NO_STORE_HEADERS,
          'Retry-After': '60',
        },
      }
    );
  }

  if (!verifySameOriginRequest(request)) {
    return NextResponse.json(
      { success: false, error: 'Cross-origin sign-in request rejected.' },
      { status: 403, headers: NO_STORE_HEADERS }
    );
  }

  if (!isAdminAuthConfigured()) {
    return NextResponse.json(
      { success: false, error: 'Server authentication is not configured.' },
      { status: 503, headers: NO_STORE_HEADERS }
    );
  }

  try {
    const body = (await request.json()) as { accessKey?: unknown };
    const verified = verifyAdminCredentials(body?.accessKey);
    if (!verified.ok) {
      return NextResponse.json(
        { success: false, error: verified.error },
        { status: verified.status, headers: NO_STORE_HEADERS }
      );
    }

    const { token, payload } = createSessionToken();
    const response = NextResponse.json(
      { success: true, authenticated: true },
      { status: 200, headers: NO_STORE_HEADERS }
    );
    appendSessionCookies(response.headers, token, payload.csrf, request);
    return response;
  } catch (err) {
    return NextResponse.json(
      { success: false, error: sanitizeErrorMessage(err, 'Invalid sign-in payload.') },
      { status: 400, headers: NO_STORE_HEADERS }
    );
  }
}

export async function DELETE(request: NextRequest) {
  if (!verifySameOriginRequest(request)) {
    return NextResponse.json(
      { success: false, error: 'Cross-origin logout request rejected.' },
      { status: 403, headers: NO_STORE_HEADERS }
    );
  }

  const cookies = parseCookiesFromRequest(request);
  const existingSession = verifySessionToken(cookies[SESSION_COOKIE_NAME]);
  if (existingSession) {
    const headerCsrf = request.headers.get(CSRF_HEADER_NAME)?.trim();
    const cookieCsrf = cookies[CSRF_COOKIE_NAME]?.trim();
    if (
      !headerCsrf ||
      !cookieCsrf ||
      !constantTimeEqual(headerCsrf, cookieCsrf) ||
      !constantTimeEqual(headerCsrf, existingSession.csrf)
    ) {
      return NextResponse.json(
        { success: false, error: 'Invalid or missing CSRF token.' },
        { status: 403, headers: NO_STORE_HEADERS }
      );
    }
  }

  const response = NextResponse.json(
    { success: true, authenticated: false },
    { status: 200, headers: NO_STORE_HEADERS }
  );
  appendClearSessionCookies(response.headers, request);
  return response;
}
