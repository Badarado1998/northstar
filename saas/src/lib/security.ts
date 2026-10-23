import { timingSafeEqual } from 'node:crypto';
import { ServiceError } from './auth';

function bearerToken(request: Request): string | null {
  const header = request.headers.get('authorization') ?? '';
  return header.startsWith('Bearer ') ? header.slice(7).trim() : null;
}

function appOrigin(): string {
  return new URL((process.env.APP_URL ?? 'http://127.0.0.1:3000').replace(/\/$/, '')).origin;
}

/** Compare shared secrets without leaking length or content through timing. */
export function secretsEqual(left: string, right: string): boolean {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export function clientIp(request: Request): string {
  const forwarded = request.headers.get('x-forwarded-for');
  if (forwarded) {
    const first = forwarded.split(',')[0]?.trim();
    if (first) return first.slice(0, 64);
  }
  const real = request.headers.get('x-real-ip')?.trim();
  if (real) return real.slice(0, 64);
  return 'unknown';
}

/** Block cross-site POSTs that rely on the browser session cookie (CSRF). Desktop bearer auth is exempt. */
export function assertSameOrigin(request: Request): void {
  if (bearerToken(request)) return;
  const expected = appOrigin();
  const origin = request.headers.get('origin');
  if (origin) {
    if (origin !== expected) throw new ServiceError(403, 'Cross-site request blocked.');
    return;
  }
  const referer = request.headers.get('referer');
  if (!referer) throw new ServiceError(403, 'Missing request origin.');
  let parsed: URL;
  try { parsed = new URL(referer); } catch { throw new ServiceError(403, 'Invalid request origin.'); }
  if (parsed.origin !== expected) throw new ServiceError(403, 'Cross-site request blocked.');
}

export const MAX_JSON_BODY = 64 * 1024;
export const MAX_WEBHOOK_BODY = 256 * 1024;

export async function readBody(request: Request, maxBytes: number): Promise<string> {
  const length = request.headers.get('content-length');
  if (length && Number(length) > maxBytes) throw new ServiceError(413, 'Request body is too large.');
  const raw = await request.text();
  if (raw.length > maxBytes) throw new ServiceError(413, 'Request body is too large.');
  return raw;
}

export function paymentReference(reference: string): boolean {
  return /^ns_[0-9a-f]{32}$/i.test(reference);
}

export const SECURITY_HEADERS: Record<string, string> = {
  'Cache-Control': 'no-store',
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'X-Frame-Options': 'DENY',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=()',
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Resource-Policy': 'same-site',
};

export function withSecurityHeaders(response: Response): Response {
  const headers = new Headers(response.headers);
  for (const [key, value] of Object.entries(SECURITY_HEADERS)) headers.set(key, value);
  if (process.env.NODE_ENV === 'production') {
    headers.set('Strict-Transport-Security', 'max-age=63072000; includeSubDomains; preload');
  }
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}
