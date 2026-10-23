import { ServiceError } from './auth';
import { withSecurityHeaders } from './security';

export function json(data: unknown, status = 200, headers?: HeadersInit): Response {
  return Response.json(data, { status, headers });
}

export function readCookie(request: Request, name: string): string | null {
  const header = request.headers.get('cookie') ?? '';
  for (const part of header.split(';')) {
    const [key, ...rest] = part.trim().split('=');
    if (key === name) return decodeURIComponent(rest.join('='));
  }
  return null;
}

export function bearer(request: Request): string | null {
  const header = request.headers.get('authorization') ?? '';
  return header.startsWith('Bearer ') ? header.slice(7).trim() : null;
}

export function sessionCookie(token: string): string {
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : '';
  const sameSite = process.env.NODE_ENV === 'production' ? 'Strict' : 'Lax';
  return `ns_session=${encodeURIComponent(token)}; HttpOnly; Path=/; SameSite=${sameSite}; Max-Age=${14 * 24 * 60 * 60}${secure}`;
}

export function clearSessionCookie(): string {
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : '';
  return `ns_session=; HttpOnly; Path=/; SameSite=Lax; Max-Age=0${secure}`;
}

export async function body(request: Request, maxBytes = 64 * 1024): Promise<Record<string, unknown>> {
  const length = request.headers.get('content-length');
  if (length && Number(length) > maxBytes) throw new ServiceError(413, 'Request body is too large.');
  const parsed = await request.json().catch(() => null);
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new ServiceError(400, 'Send a JSON object.');
  return parsed as Record<string, unknown>;
}

export function text(value: unknown, max = 200): string {
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

export function appUrl(): string {
  return (process.env.APP_URL ?? 'http://127.0.0.1:3000').replace(/\/$/, '');
}

export async function endpoint(run: () => Promise<Response>): Promise<Response> {
  try {
    return withSecurityHeaders(await run());
  } catch (error) {
    if (error instanceof ServiceError) return withSecurityHeaders(json({ error: error.message }, error.status));
    if (error instanceof Error && 'status' in error && typeof error.status === 'number') return withSecurityHeaders(json({ error: error.message }, error.status));
    console.error(error);
    return withSecurityHeaders(json({ error: 'Something went wrong.' }, 500));
  }
}
