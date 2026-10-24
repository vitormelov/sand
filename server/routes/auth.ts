import { randomUUID } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { EVENT_ID_RE, sanitizeProfile, sanitizeSaved } from '../../shared/profile';
import { hashPassword, newSessionToken, tokenDigest, validEmail, validPassword, verifyPassword } from '../auth/password';
import type { Store } from '../persistence/store';
import { RateLimiter } from './rateLimit';

export const SESSION_COOKIE = 'sand_session';
const SESSION_DAYS = 30;

export interface AuthContext {
  store: Store;
  secureCookies: boolean;
  json: (res: ServerResponse, status: number, body: unknown, extra?: Record<string, string>) => void;
  readBody: (req: IncomingMessage, max?: number) => Promise<string>;
  limiters: AuthLimiters;
}

export interface AuthLimiters {
  ip: RateLimiter;
  email: RateLimiter;
}

/** Login attempts: per address and per e-mail, so neither can be brute-forced quickly. */
export function createAuthLimiters(): AuthLimiters {
  return { ip: new RateLimiter(20, 20 / 600), email: new RateLimiter(6, 6 / 900) };
}

function parseCookies(req: IncomingMessage): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of (req.headers.cookie ?? '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

export function sessionDigest(req: IncomingMessage): string | undefined {
  const t = parseCookies(req)[SESSION_COOKIE];
  return t && /^[A-Za-z0-9_-]{20,100}$/.test(t) ? tokenDigest(t) : undefined;
}

/** The logged-in user id, if the request carries a valid session cookie. */
export function currentUserId(req: IncomingMessage, store: Store): string | undefined {
  const d = sessionDigest(req);
  return d ? store.sessionUser(d, new Date().toISOString()) : undefined;
}

function cookie(token: string, maxAge: number, secure: boolean): string {
  return `${SESSION_COOKIE}=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${maxAge}${secure ? '; Secure' : ''}`;
}

// A real hash to verify against when the e-mail doesn't exist (same timing either way).
let dummyHash: Promise<string> | null = null;

async function startSession(ctx: AuthContext, res: ServerResponse, userId: string): Promise<string> {
  const token = newSessionToken();
  const expires = new Date(Date.now() + SESSION_DAYS * 86_400_000);
  ctx.store.createSession(tokenDigest(token), userId, expires.toISOString());
  res.setHeader('Set-Cookie', cookie(token, SESSION_DAYS * 86_400, ctx.secureCookies));
  return token;
}

function publicProfile(store: Store, userId: string) {
  const raw = store.getProfile(userId);
  return raw ? sanitizeProfile(raw) : null;
}

const MAX_SAVED = 500;
const MAX_VIEWED = 2000;

/** Seen ids and saved news of the user, sent with /api/me. */
function userItems(store: Store, userId: string) {
  return {
    viewed: store.items(userId, 'viewed', MAX_VIEWED).map((r) => r.id),
    saved: store.items(userId, 'saved', MAX_SAVED).map((r) => sanitizeSaved(r.data)).filter(Boolean),
  };
}

/** Handles /api/auth/* and /api/me*. Returns false when the route is not an auth route. */
export async function handleAuth(req: IncomingMessage, res: ServerResponse, url: URL, ip: string, ctx: AuthContext): Promise<boolean> {
  const { store, json } = ctx;
  const ipLimiter = ctx.limiters.ip;
  const emailLimiter = ctx.limiters.email;
  const path = url.pathname;
  const method = req.method ?? 'GET';
  const body = async () => {
    try {
      return JSON.parse(await ctx.readBody(req, 16_384)) as Record<string, unknown>;
    } catch {
      return null;
    }
  };

  if (path === '/api/auth/register' && method === 'POST') {
    if (!ipLimiter.take(ip)) return json(res, 429, { error: 'rate_limited' }, { 'Retry-After': '60' }), true;
    const b = await body();
    const email = validEmail(b?.email);
    if (!email) return json(res, 400, { error: 'invalid_email' }), true;
    if (!validPassword(b?.password)) return json(res, 400, { error: 'weak_password' }), true;
    const id = randomUUID();
    if (!store.createUser(id, email, await hashPassword(b!.password as string), new Date().toISOString())) {
      return json(res, 409, { error: 'email_taken' }), true;
    }
    await startSession(ctx, res, id);
    return json(res, 201, { user: { email }, profile: null }), true;
  }

  if (path === '/api/auth/login' && method === 'POST') {
    const b = await body();
    const email = validEmail(b?.email);
    if (!ipLimiter.take(ip) || (email && !emailLimiter.take(email))) return json(res, 429, { error: 'rate_limited' }, { 'Retry-After': '60' }), true;
    const user = email ? store.userByEmail(email) : undefined;
    const pw = typeof b?.password === 'string' ? b.password : '';
    const ok = user ? await verifyPassword(pw, user.passwordHash) : (await verifyPassword(pw, await (dummyHash ??= hashPassword('x'.repeat(16)))), false);
    // Same answer whether the e-mail exists or not.
    if (!user || !ok) return json(res, 401, { error: 'invalid_credentials' }), true;
    await startSession(ctx, res, user.id);
    return json(res, 200, { user: { email: user.email }, profile: publicProfile(store, user.id), ...userItems(store, user.id) }), true;
  }

  if (path === '/api/auth/logout' && method === 'POST') {
    const d = sessionDigest(req);
    if (d) store.deleteSession(d);
    res.setHeader('Set-Cookie', cookie('', 0, ctx.secureCookies));
    return json(res, 200, { ok: true }), true;
  }

  if (!path.startsWith('/api/me')) return false;
  const userId = currentUserId(req, store);
  const user = userId ? store.userById(userId) : undefined;
  if (!user) return json(res, 401, { error: 'unauthenticated' }), true;

  if (path === '/api/me' && method === 'GET') {
    return json(res, 200, { user: { email: user.email }, profile: publicProfile(store, user.id), ...userItems(store, user.id) }), true;
  }
  if (path === '/api/me/viewed' && method === 'POST') {
    const b = await body();
    const raw = Array.isArray(b?.ids) ? (b!.ids as unknown[]) : [];
    const ids = raw.filter((x): x is string => typeof x === 'string' && EVENT_ID_RE.test(x)).slice(0, 100);
    const now = new Date().toISOString();
    for (const id of ids) store.addItem(user.id, 'viewed', id, null, now);
    return json(res, 200, { ok: true, count: ids.length }), true;
  }
  const savedMatch = /^\/api\/me\/saved\/(ev_[a-z0-9]{1,40})$/.exec(path);
  if (savedMatch && method === 'PUT') {
    const item = sanitizeSaved({ ...(await body()), id: savedMatch[1] });
    if (!item) return json(res, 400, { error: 'invalid_item' }), true;
    if (store.countItems(user.id, 'saved') >= MAX_SAVED) return json(res, 409, { error: 'too_many_saved' }), true;
    store.addItem(user.id, 'saved', item.id, item, item.savedAt);
    return json(res, 200, { item }), true;
  }
  if (savedMatch && method === 'DELETE') {
    store.removeItem(user.id, 'saved', savedMatch[1]);
    return json(res, 200, { ok: true }), true;
  }
  if (path === '/api/me/profile' && method === 'PUT') {
    const b = await body();
    if (!b) return json(res, 400, { error: 'invalid_json' }), true;
    const profile = sanitizeProfile(b);
    store.setProfile(user.id, profile, new Date().toISOString());
    return json(res, 200, { profile }), true;
  }
  if (path === '/api/me/password' && method === 'POST') {
    if (!ipLimiter.take(ip)) return json(res, 429, { error: 'rate_limited' }), true;
    const b = await body();
    if (typeof b?.current !== 'string' || !(await verifyPassword(b.current, user.passwordHash))) return json(res, 401, { error: 'invalid_credentials' }), true;
    if (!validPassword(b.next)) return json(res, 400, { error: 'weak_password' }), true;
    store.setPasswordHash(user.id, await hashPassword(b.next));
    store.deleteSessionsOf(user.id, sessionDigest(req)); // other devices must log in again
    return json(res, 200, { ok: true }), true;
  }
  if (path === '/api/me' && method === 'DELETE') {
    if (!ipLimiter.take(ip)) return json(res, 429, { error: 'rate_limited' }), true;
    const b = await body();
    if (typeof b?.password !== 'string' || !(await verifyPassword(b.password, user.passwordHash))) return json(res, 401, { error: 'invalid_credentials' }), true;
    store.deleteUser(user.id);
    res.setHeader('Set-Cookie', cookie('', 0, ctx.secureCookies));
    return json(res, 200, { ok: true }), true;
  }
  return json(res, 404, { error: 'not_found' }), true;
}
