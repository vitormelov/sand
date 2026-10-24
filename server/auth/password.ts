import { createHash, randomBytes, scrypt, timingSafeEqual } from 'node:crypto';

/**
 * Passwords are never stored: only a salted scrypt hash.
 * Format: scrypt$N$r$p$saltB64$hashB64
 */
const N = 16384;
const R = 8;
const P = 1;
const KEYLEN = 64;

function scryptAsync(password: string, salt: Buffer, n = N, r = R, p = P): Promise<Buffer> {
  return new Promise((resolve, reject) =>
    scrypt(password.normalize('NFKC'), salt, KEYLEN, { N: n, r, p, maxmem: 64 * 1024 * 1024 }, (err, key) => (err ? reject(err) : resolve(key))),
  );
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await scryptAsync(password, salt);
  return `scrypt$${N}$${R}$${P}$${salt.toString('base64')}$${key.toString('base64')}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [alg, n, r, p, salt, hash] = stored.split('$');
  if (alg !== 'scrypt' || !salt || !hash) return false;
  const expected = Buffer.from(hash, 'base64');
  const key = await scryptAsync(password, Buffer.from(salt, 'base64'), Number(n), Number(r), Number(p));
  return key.length === expected.length && timingSafeEqual(key, expected);
}

/** Random, URL-safe session token; only its SHA-256 is stored server-side. */
export function newSessionToken(): string {
  return randomBytes(32).toString('base64url');
}

export function tokenDigest(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export const PASSWORD_MIN = 8;
export const PASSWORD_MAX = 200;

export function validEmail(email: unknown): string | undefined {
  if (typeof email !== 'string') return undefined;
  const e = email.trim().toLowerCase();
  return e.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(e) ? e : undefined;
}

export function validPassword(pw: unknown): pw is string {
  return typeof pw === 'string' && pw.length >= PASSWORD_MIN && pw.length <= PASSWORD_MAX;
}
