import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';

function scryptKey(password: string, salt: Buffer, length: number, options: { N: number; r: number; p: number; maxmem: number }): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(password, salt, length, options, (error, key) => error ? reject(error) : resolve(key));
  });
}

const N = 16384;
const r = 8;
const p = 1;

export function passwordError(password: string, email: string): string | null {
  if (password.length < 10 || password.length > 128) return 'Use a password between 10 and 128 characters.';
  if (password.toLowerCase() === email.toLowerCase()) return 'Use a password that is not your email address.';
  return null;
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await scryptKey(password, salt, 64, { N, r, p, maxmem: 64 * 1024 * 1024 });
  return `scrypt$${N}$${r}$${p}$${salt.toString('base64url')}$${key.toString('base64url')}`;
}

/** Precomputed scrypt hash so missing users still pay verification cost (login timing). */
export const DUMMY_PASSWORD_HASH = 'scrypt$16384$8$1$DKNiOh5oq1_OtFHd1G3IDw$d76m2WvhtzLy1MSTkYIt6TvKTFjUmBl7ZqcsYYDx9rPjzCRA2UdrWEcGOnCyg7IXEUaQd5aipZQsXZYsja1vsg';

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = stored.split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false;
  const [, nRaw, rRaw, pRaw, saltRaw, keyRaw] = parts;
  const n = Number(nRaw);
  const rounds = Number(rRaw);
  const parallel = Number(pRaw);
  if (!Number.isInteger(n) || !Number.isInteger(rounds) || !Number.isInteger(parallel)) return false;
  let salt: Buffer;
  let expected: Buffer;
  try {
    salt = Buffer.from(saltRaw, 'base64url');
    expected = Buffer.from(keyRaw, 'base64url');
  } catch {
    return false;
  }
  if (salt.length < 8 || expected.length < 16) return false;
  const actual = await scryptKey(password, salt, expected.length, { N: n, r: rounds, p: parallel, maxmem: 64 * 1024 * 1024 });
  if (actual.length !== expected.length) return false;
  return timingSafeEqual(actual, expected);
}
