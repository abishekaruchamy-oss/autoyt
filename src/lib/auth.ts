import crypto from 'crypto';
import { NextResponse } from 'next/server';
import { NO_STORE_HEADERS } from '@/lib/security';

export const SESSION_COOKIE_NAME = 'autoshorts_session';
export const CSRF_COOKIE_NAME = 'autoshorts_csrf';
export const OAUTH_STATE_COOKIE_NAME = 'autoshorts_oauth_state';
export const CSRF_HEADER_NAME = 'x-csrf-token';

export const SESSION_TTL_SECONDS = 12 * 60 * 60; // 12 hours
export const OAUTH_STATE_TTL_SECONDS = 10 * 60; // 10 minutes

export interface SessionPayload {
  v: 1;
  sub: 'admin';
  iat: number;
  exp: number;
  jti: string;
  csrf: string;
}

export type AuthFailureResult = {
  ok: false;
  status: 401 | 403 | 503;
  error: string;
};

export type AdminAuthResult =
  | {
      ok: true;
      session: SessionPayload;
    }
  | AuthFailureResult;

/**
 * Returns true if both operator login key and session signing secret are configured.
 * Failing closed relies on explicit non-empty values for both secrets.
 */
export function isAdminAuthConfigured(): boolean {
  const accessKey = process.env.ADMIN_ACCESS_KEY?.trim();
  const sessionSecret = process.env.ADMIN_SESSION_SECRET?.trim();
  return Boolean(accessKey && sessionSecret);
}

/**
 * Returns true if the n8n machine-to-machine webhook secret is configured.
 */
export function isWebhookAuthConfigured(): boolean {
  return Boolean(process.env.N8N_WEBHOOK_SECRET?.trim());
}

/**
 * Constant-time equality over SHA-256 digests to prevent length and timing leaks.
 */
export function constantTimeEqual(a: string, b: string): boolean {
  const digestA = crypto.createHash('sha256').update(a, 'utf8').digest();
  const digestB = crypto.createHash('sha256').update(b, 'utf8').digest();
  return crypto.timingSafeEqual(digestA, digestB);
}

function getSessionSigningKey(): Buffer | null {
  const sessionSecret = process.env.ADMIN_SESSION_SECRET?.trim();
  if (!sessionSecret) {
    return null;
  }
  return crypto.createHmac('sha256', sessionSecret).update('autoshorts:session:v1').digest();
}

function toBase64Url(input: Buffer | string): string {
  return Buffer.from(input)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

function fromBase64Url(input: string): Buffer {
  const pad = input.length % 4 === 0 ? '' : '='.repeat(4 - (input.length % 4));
  const base64 = input.replace(/-/g, '+').replace(/_/g, '/') + pad;
  return Buffer.from(base64, 'base64');
}

function signPayload(encodedPayload: string, key: Buffer): string {
  return toBase64Url(crypto.createHmac('sha256', key).update(encodedPayload).digest());
}

/**
 * Verifies the operator access key in constant time.
 */
export function verifyAdminCredentials(
  candidateKey: unknown
): { ok: true } | { ok: false; status: 401 | 503; error: string } {
  if (!isAdminAuthConfigured()) {
    return {
      ok: false,
      status: 503,
      error: 'Authentication is not configured on the server.',
    };
  }

  if (typeof candidateKey !== 'string' || candidateKey.trim().length === 0) {
    return { ok: false, status: 401, error: 'Invalid access key.' };
  }

  const configuredKey = process.env.ADMIN_ACCESS_KEY!.trim();
  if (!constantTimeEqual(candidateKey.trim(), configuredKey)) {
    return { ok: false, status: 401, error: 'Invalid access key.' };
  }

  return { ok: true };
}

/**
 * Mints a signed stateless session token containing a session ID and bound CSRF secret.
 */
export function createSessionToken(ttlSeconds: number = SESSION_TTL_SECONDS): {
  token: string;
  payload: SessionPayload;
} {
  const signingKey = getSessionSigningKey();
  if (!signingKey) {
    throw new Error('ADMIN_SESSION_SECRET is required to issue session tokens.');
  }

  const now = Math.floor(Date.now() / 1000);
  const payload: SessionPayload = {
    v: 1,
    sub: 'admin',
    iat: now,
    exp: now + ttlSeconds,
    jti: crypto.randomBytes(16).toString('hex'),
    csrf: crypto.randomBytes(24).toString('hex'),
  };

  const encodedPayload = toBase64Url(JSON.stringify(payload));
  const signature = signPayload(encodedPayload, signingKey);
  return {
    token: `${encodedPayload}.${signature}`,
    payload,
  };
}

/**
 * Verifies a stateless session token's HMAC-SHA256 signature and expiration.
 */
export function verifySessionToken(token: string | undefined | null): SessionPayload | null {
  if (!token || typeof token !== 'string') return null;

  const signingKey = getSessionSigningKey();
  if (!signingKey) return null;

  const parts = token.split('.');
  if (parts.length !== 2) return null;

  const [encodedPayload, providedSig] = parts;
  if (!encodedPayload || !providedSig) return null;

  const expectedSig = signPayload(encodedPayload, signingKey);
  if (!constantTimeEqual(providedSig, expectedSig)) {
    return null;
  }

  try {
    const parsed = JSON.parse(fromBase64Url(encodedPayload).toString('utf8')) as Partial<SessionPayload>;
    if (
      parsed.v !== 1 ||
      parsed.sub !== 'admin' ||
      typeof parsed.iat !== 'number' ||
      typeof parsed.exp !== 'number' ||
      typeof parsed.jti !== 'string' ||
      !parsed.jti ||
      typeof parsed.csrf !== 'string' ||
      !parsed.csrf
    ) {
      return null;
    }

    const now = Math.floor(Date.now() / 1000);
    if (now >= parsed.exp) {
      return null;
    }

    return parsed as SessionPayload;
  } catch {
    return null;
  }
}

/**
 * Signs an OAuth CSRF state nonce to bind it cryptographically to the active admin session.
 */
export function signOAuthStateCookieValue(state: string, sessionJti: string): string {
  const signingKey = getSessionSigningKey();
  if (!signingKey) {
    throw new Error('ADMIN_SESSION_SECRET is required to bind OAuth CSRF state.');
  }

  const mac = toBase64Url(
    crypto.createHmac('sha256', signingKey).update(`oauth-state:${sessionJti}:${state}`).digest()
  );
  return `${state}.${mac}`;
}

/**
 * Verifies that the OAuth state cookie matches the callback query state and current admin session.
 */
export function verifyOAuthStateCookieValue(
  cookieValue: string | undefined | null,
  queryState: string | undefined | null,
  sessionJti: string
): boolean {
  if (!cookieValue || !queryState) return false;
  const parts = cookieValue.split('.');
  if (parts.length !== 2) return false;

  const [cookieState] = parts;
  if (!constantTimeEqual(cookieState, queryState)) {
    return false;
  }

  const expectedCookieValue = signOAuthStateCookieValue(queryState, sessionJti);
  return constantTimeEqual(cookieValue, expectedCookieValue);
}

/**
 * Parses HTTP Cookie header safely without framework-specific helpers.
 */
export function parseCookiesFromRequest(request: Request): Record<string, string> {
  const header = request.headers.get('cookie');
  if (!header) return {};

  const cookies: Record<string, string> = {};
  for (const segment of header.split(';')) {
    const idx = segment.indexOf('=');
    if (idx <= 0) continue;
    const key = segment.slice(0, idx).trim();
    const rawVal = segment.slice(idx + 1).trim();
    if (!key) continue;
    try {
      cookies[key] = decodeURIComponent(rawVal);
    } catch {
      cookies[key] = rawVal;
    }
  }
  return cookies;
}

function shouldUseSecureCookies(request?: Request): boolean {
  if (process.env.NODE_ENV === 'production') {
    if (request) {
      try {
        const parsed = new URL(request.url);
        const forwardedProto = request.headers.get('x-forwarded-proto');
        const proto = forwardedProto ? forwardedProto.split(',')[0].trim() : parsed.protocol.replace(':', '');
        if (proto === 'http' && (parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1')) {
          return false;
        }
      } catch {
        // fallback to secure=true in production
      }
    }
    return true;
  }
  if (!request) return false;
  try {
    const parsed = new URL(request.url);
    const forwardedProto = request.headers.get('x-forwarded-proto');
    return parsed.protocol === 'https:' || forwardedProto === 'https';
  } catch {
    return false;
  }
}

function formatCookie(
  name: string,
  value: string,
  options: {
    httpOnly?: boolean;
    secure?: boolean;
    sameSite?: 'Lax' | 'Strict';
    path?: string;
    maxAge?: number;
  }
): string {
  const parts = [`${name}=${encodeURIComponent(value)}`];
  parts.push(`Path=${options.path ?? '/'}`);
  if (options.maxAge !== undefined) {
    parts.push(`Max-Age=${options.maxAge}`);
  }
  if (options.httpOnly) {
    parts.push('HttpOnly');
  }
  if (options.secure) {
    parts.push('Secure');
  }
  parts.push(`SameSite=${options.sameSite ?? 'Lax'}`);
  return parts.join('; ');
}

export function appendSessionCookies(headers: Headers, token: string, csrf: string, request?: Request): void {
  const secure = shouldUseSecureCookies(request);
  headers.append(
    'Set-Cookie',
    formatCookie(SESSION_COOKIE_NAME, token, {
      httpOnly: true,
      secure,
      sameSite: 'Lax',
      path: '/',
      maxAge: SESSION_TTL_SECONDS,
    })
  );
  headers.append(
    'Set-Cookie',
    formatCookie(CSRF_COOKIE_NAME, csrf, {
      httpOnly: false,
      secure,
      sameSite: 'Lax',
      path: '/',
      maxAge: SESSION_TTL_SECONDS,
    })
  );
}

export function appendClearSessionCookies(headers: Headers, request?: Request): void {
  const secure = shouldUseSecureCookies(request);
  headers.append(
    'Set-Cookie',
    formatCookie(SESSION_COOKIE_NAME, '', {
      httpOnly: true,
      secure,
      sameSite: 'Lax',
      path: '/',
      maxAge: 0,
    })
  );
  headers.append(
    'Set-Cookie',
    formatCookie(CSRF_COOKIE_NAME, '', {
      httpOnly: false,
      secure,
      sameSite: 'Lax',
      path: '/',
      maxAge: 0,
    })
  );
  headers.append(
    'Set-Cookie',
    formatCookie(OAUTH_STATE_COOKIE_NAME, '', {
      httpOnly: true,
      secure,
      sameSite: 'Lax',
      path: '/api/auth/google',
      maxAge: 0,
    })
  );
}

export function appendOAuthStateCookie(headers: Headers, signedValue: string, request?: Request): void {
  const secure = shouldUseSecureCookies(request);
  headers.append(
    'Set-Cookie',
    formatCookie(OAUTH_STATE_COOKIE_NAME, signedValue, {
      httpOnly: true,
      secure,
      sameSite: 'Lax',
      path: '/api/auth/google',
      maxAge: OAUTH_STATE_TTL_SECONDS,
    })
  );
}

export function appendClearOAuthStateCookie(headers: Headers, request?: Request): void {
  const secure = shouldUseSecureCookies(request);
  headers.append(
    'Set-Cookie',
    formatCookie(OAUTH_STATE_COOKIE_NAME, '', {
      httpOnly: true,
      secure,
      sameSite: 'Lax',
      path: '/api/auth/google',
      maxAge: 0,
    })
  );
}

/**
 * Checks whether a request's Origin / Referer / Sec-Fetch-Site headers match
 * the expected application host origin to block cross-origin CSRF.
 */
export function verifySameOriginRequest(request: Request): boolean {
  const fetchSite = request.headers.get('sec-fetch-site')?.toLowerCase();
  if (fetchSite && fetchSite !== 'same-origin' && fetchSite !== 'same-site' && fetchSite !== 'none') {
    return false;
  }

  const originHeader = request.headers.get('origin');
  const refererHeader = request.headers.get('referer');

  let candidateOrigin: string | null = null;
  if (originHeader) {
    if (originHeader === 'null') return false;
    try {
      candidateOrigin = new URL(originHeader).origin;
    } catch {
      return false;
    }
  } else if (refererHeader) {
    try {
      candidateOrigin = new URL(refererHeader).origin;
    } catch {
      return false;
    }
  }

  if (!candidateOrigin) {
    // Allow non-browser / same-origin clients that omit Origin and Referer;
    // authenticated mutating routes still require CSRF header + HttpOnly session cookie.
    return true;
  }

  const allowedOrigins = new Set<string>();
  try {
    allowedOrigins.add(new URL(request.url).origin);
  } catch {
    // ignore malformed URL
  }

  const hostHeader = request.headers.get('x-forwarded-host') || request.headers.get('host');
  if (hostHeader) {
    const cleanHost = hostHeader.split(',')[0].trim();
    const protoHeader = request.headers.get('x-forwarded-proto');
    if (protoHeader) {
      allowedOrigins.add(`${protoHeader.split(',')[0].trim()}://${cleanHost}`);
    }
    allowedOrigins.add(`https://${cleanHost}`);
    allowedOrigins.add(`http://${cleanHost}`);
  }

  const appUrl = process.env.NEXT_PUBLIC_APP_URL?.trim();
  if (appUrl) {
    try {
      allowedOrigins.add(new URL(appUrl).origin);
    } catch {
      // ignore invalid URL
    }
  }

  return allowedOrigins.has(candidateOrigin);
}

const MUTATING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/**
 * Authorizes an administrative request via stateless signed session cookie and,
 * for state-changing HTTP methods, origin + double-submit CSRF validation.
 */
export function authorizeAdminRequest(
  request: Request,
  options?: { requireCsrf?: boolean }
): AdminAuthResult {
  if (!isAdminAuthConfigured()) {
    return {
      ok: false,
      status: 503,
      error: 'Authentication is not configured on the server.',
    };
  }

  const cookies = parseCookiesFromRequest(request);
  const session = verifySessionToken(cookies[SESSION_COOKIE_NAME]);
  if (!session) {
    return {
      ok: false,
      status: 401,
      error: 'Authentication required.',
    };
  }

  const shouldCheckCsrf = options?.requireCsrf ?? MUTATING_METHODS.has(request.method.toUpperCase());
  if (shouldCheckCsrf) {
    if (!verifySameOriginRequest(request)) {
      return {
        ok: false,
        status: 403,
        error: 'Cross-origin request rejected.',
      };
    }

    const headerCsrf = request.headers.get(CSRF_HEADER_NAME)?.trim();
    const cookieCsrf = cookies[CSRF_COOKIE_NAME]?.trim();

    if (
      !headerCsrf ||
      !cookieCsrf ||
      !constantTimeEqual(headerCsrf, cookieCsrf) ||
      !constantTimeEqual(headerCsrf, session.csrf)
    ) {
      return {
        ok: false,
        status: 403,
        error: 'Invalid or missing CSRF token.',
      };
    }
  }

  return { ok: true, session };
}

/**
 * Route guard returning a fail-closed NextResponse on auth/CSRF error or null when authorized.
 */
export function requireAdminApi(
  request: Request,
  options?: { requireCsrf?: boolean }
): NextResponse | null {
  const result = authorizeAdminRequest(request, options);
  if (result.ok) {
    return null;
  }

  return NextResponse.json(
    { success: false, error: result.error },
    { status: result.status, headers: NO_STORE_HEADERS }
  );
}

/**
 * Machine-to-machine or authenticated admin guard for `/api/n8n/*` routes.
 * Fails closed whenever `N8N_WEBHOOK_SECRET` and admin auth are missing or invalid.
 */
export function authorizeWebhookOrAdminRequest(
  request: Request
): { ok: true; via: 'webhook' | 'admin' } | AuthFailureResult {
  const authHeader = request.headers.get('authorization');
  if (authHeader !== null) {
    if (!isWebhookAuthConfigured()) {
      return {
        ok: false,
        status: 503,
        error: 'Webhook authentication is not configured on the server.',
      };
    }

    const match = authHeader.match(/^Bearer\s+(.+)$/i);
    const token = match?.[1]?.trim();
    const expectedSecret = process.env.N8N_WEBHOOK_SECRET!.trim();
    if (!token || !constantTimeEqual(token, expectedSecret)) {
      return {
        ok: false,
        status: 401,
        error: 'Invalid webhook bearer token.',
      };
    }

    return { ok: true, via: 'webhook' };
  }

  const adminResult = authorizeAdminRequest(request);
  if (adminResult.ok) {
    return { ok: true, via: 'admin' };
  }

  if (!isWebhookAuthConfigured() && adminResult.status === 503) {
    return {
      ok: false,
      status: 503,
      error: 'Authentication is not configured on the server.',
    };
  }

  if (adminResult.status === 403) {
    return adminResult;
  }

  return {
    ok: false,
    status: 401,
    error: 'Authentication required for n8n integration endpoint.',
  };
}

/**
 * Route guard for `/api/n8n/*` endpoints.
 */
export function requireWebhookOrAdminApi(request: Request): NextResponse | null {
  const result = authorizeWebhookOrAdminRequest(request);
  if (result.ok) {
    return null;
  }

  return NextResponse.json(
    { success: false, error: result.error },
    { status: result.status, headers: NO_STORE_HEADERS }
  );
}
