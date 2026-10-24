import type { AddressInfo } from 'node:net';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../../server/app';
import { hashPassword, verifyPassword } from '../../server/auth/password';

let app: ReturnType<typeof createApp>;
let base: string;

beforeEach(async () => {
  app = createApp({ databasePath: ':memory:', retentionHours: 48, snapshotLimit: 10, connectors: [], ingestion: false, log: () => {} });
  await app.start(0, '127.0.0.1');
  base = `http://127.0.0.1:${(app.server.address() as AddressInfo).port}`;
});
afterEach(async () => {
  await app.stop();
});

/** Minimal cookie-keeping client. */
function client() {
  let cookie = '';
  const req = async (path: string, init: RequestInit & { csrf?: boolean } = {}) => {
    const headers: Record<string, string> = { 'Content-Type': 'application/json', ...(init.headers as Record<string, string>) };
    if (init.csrf !== false && init.method && init.method !== 'GET') headers['X-Sand'] = '1';
    if (cookie) headers.cookie = cookie;
    const res = await fetch(base + path, { ...init, headers });
    const set = res.headers.get('set-cookie');
    if (set) cookie = set.split(';')[0].endsWith('=') ? '' : set.split(';')[0];
    return res;
  };
  return { req, setCookieHeader: () => cookie };
}

const creds = { email: 'Pessoa@Example.com ', password: 'senha-forte-123' };

describe('accounts', () => {
  it('stores only a salted hash of the password', async () => {
    const h = await hashPassword('segredo-123');
    expect(h).not.toContain('segredo');
    expect(await verifyPassword('segredo-123', h)).toBe(true);
    expect(await verifyPassword('outra-senha', h)).toBe(false);
    expect(await hashPassword('segredo-123')).not.toBe(h); // random salt
  });

  it('register → session cookie (HttpOnly, SameSite) → /api/me', async () => {
    const c = client();
    const r = await c.req('/api/auth/register', { method: 'POST', body: JSON.stringify(creds) });
    expect(r.status).toBe(201);
    const setCookie = r.headers.get('set-cookie')!;
    expect(setCookie).toMatch(/sand_session=/);
    expect(setCookie).toMatch(/HttpOnly/);
    expect(setCookie).toMatch(/SameSite=Lax/);
    const me = await (await c.req('/api/me')).json();
    expect(me).toEqual({ user: { email: 'pessoa@example.com' }, profile: null, viewed: [], saved: [] });
  });

  it('rejects duplicate e-mails, invalid e-mails and short passwords', async () => {
    const c = client();
    await c.req('/api/auth/register', { method: 'POST', body: JSON.stringify(creds) });
    expect((await client().req('/api/auth/register', { method: 'POST', body: JSON.stringify(creds) })).status).toBe(409);
    expect((await client().req('/api/auth/register', { method: 'POST', body: JSON.stringify({ email: 'nope', password: 'x'.repeat(10) }) })).status).toBe(400);
    expect((await client().req('/api/auth/register', { method: 'POST', body: JSON.stringify({ email: 'a@b.com', password: 'curta' }) })).status).toBe(400);
  });

  it('login gives the same answer for wrong password and unknown e-mail', async () => {
    await client().req('/api/auth/register', { method: 'POST', body: JSON.stringify(creds) });
    const wrong = await client().req('/api/auth/login', { method: 'POST', body: JSON.stringify({ email: creds.email, password: 'errada-123' }) });
    const unknown = await client().req('/api/auth/login', { method: 'POST', body: JSON.stringify({ email: 'ninguem@example.com', password: 'errada-123' }) });
    expect(wrong.status).toBe(401);
    expect(await wrong.json()).toEqual(await unknown.json());
    const ok = await client().req('/api/auth/login', { method: 'POST', body: JSON.stringify(creds) });
    expect(ok.status).toBe(200);
  });

  it('news, stream and geocoding require login; health stays public', async () => {
    expect((await fetch(`${base}/api/events`)).status).toBe(401);
    expect((await fetch(`${base}/api/stream`)).status).toBe(401);
    expect((await fetch(`${base}/api/geocode?q=Fortaleza`)).status).toBe(401);
    expect((await fetch(`${base}/api/health`)).status).toBe(200);
    const c = client();
    await c.req('/api/auth/register', { method: 'POST', body: JSON.stringify(creds) });
    expect((await c.req('/api/events')).status).toBe(200);
  });

  it('blocks state-changing requests without the CSRF header', async () => {
    const r = await client().req('/api/auth/register', { method: 'POST', body: JSON.stringify(creds), csrf: false });
    expect(r.status).toBe(403);
  });

  it('saves and returns a validated profile (hostile fields dropped, location coarsened)', async () => {
    const c = client();
    await c.req('/api/auth/register', { method: 'POST', body: JSON.stringify(creds) });
    const r = await c.req('/api/me/profile', {
      method: 'PUT',
      body: JSON.stringify({
        onboarded: true,
        location: { name: 'Fortaleza', countryCode: 'br', lat: -3.731234, lon: -38.526789 },
        categoryImportance: { economy: 2, sports: 9, hacked: 1 },
        football: { interest: 'yes', club: 'Fortaleza' },
        routine: { transport: ['public', 'rocket'], rents: true },
        work: { occupation: 'retired', hasDebt: true },
        places: [{ name: 'Sobral', countryCode: 'BR' }, {}, {}, {}, {}],
        avoidTopics: ['violence', 'nonsense'],
        isAdmin: true,
      }),
    });
    expect(r.status).toBe(200);
    const { profile } = await (await c.req('/api/me')).json();
    expect(profile.location).toMatchObject({ countryCode: 'BR', lat: -3.7, lon: -38.5 });
    expect(profile.categoryImportance).toEqual({ economy: 2 });
    expect(profile.routine.transport).toEqual(['public']);
    expect(profile.places).toHaveLength(1);
    expect(profile.avoidTopics).toEqual(['violence']);
    expect(profile.isAdmin).toBeUndefined();
  });

  it('changing the password logs out other sessions; deleting the account erases everything', async () => {
    const a = client();
    await a.req('/api/auth/register', { method: 'POST', body: JSON.stringify(creds) });
    const b = client();
    await b.req('/api/auth/login', { method: 'POST', body: JSON.stringify(creds) });
    expect((await a.req('/api/me/password', { method: 'POST', body: JSON.stringify({ current: 'errada', next: 'nova-senha-456' }) })).status).toBe(401);
    expect((await a.req('/api/me/password', { method: 'POST', body: JSON.stringify({ current: creds.password, next: 'nova-senha-456' }) })).status).toBe(200);
    expect((await b.req('/api/me')).status).toBe(401); // other device logged out
    expect((await a.req('/api/me')).status).toBe(200); // this one stays

    expect((await a.req('/api/me', { method: 'DELETE', body: JSON.stringify({ password: 'errada' }) })).status).toBe(401);
    expect((await a.req('/api/me', { method: 'DELETE', body: JSON.stringify({ password: 'nova-senha-456' }) })).status).toBe(200);
    expect((await a.req('/api/me')).status).toBe(401);
    expect(app.store.userByEmail('pessoa@example.com')).toBeUndefined();
  });

  it('logout invalidates the session', async () => {
    const c = client();
    await c.req('/api/auth/register', { method: 'POST', body: JSON.stringify(creds) });
    const cookieBefore = c.setCookieHeader();
    await c.req('/api/auth/logout', { method: 'POST', body: '{}' });
    const replay = await fetch(`${base}/api/me`, { headers: { cookie: cookieBefore } });
    expect(replay.status).toBe(401);
  });

  it('seen and saved news: stored per account, validated, deleted with the account', async () => {
    const c = client();
    await c.req('/api/auth/register', { method: 'POST', body: JSON.stringify(creds) });
    expect((await c.req('/api/me/viewed', { method: 'POST', body: JSON.stringify({ ids: ['ev_abc', 'not-an-id', 'ev_def'] }) })).status).toBe(200);
    const item = { title: 'Notícia salva', url: 'https://example.com/n', sourceName: 'Fonte', publishedAt: '2026-10-24T10:00:00Z' };
    expect((await c.req('/api/me/saved/ev_abc', { method: 'PUT', body: JSON.stringify(item) })).status).toBe(200);
    expect((await c.req('/api/me/saved/ev_bad', { method: 'PUT', body: JSON.stringify({ ...item, url: 'javascript:alert(1)' }) })).status).toBe(400);
    let me = await (await c.req('/api/me')).json();
    expect(me.viewed.sort()).toEqual(['ev_abc', 'ev_def']);
    expect(me.saved).toHaveLength(1);
    expect(me.saved[0]).toMatchObject({ id: 'ev_abc', title: 'Notícia salva', url: 'https://example.com/n' });

    // Another account sees nothing of this one.
    const other = client();
    await other.req('/api/auth/register', { method: 'POST', body: JSON.stringify({ email: 'outra@example.com', password: 'senha-outra-123' }) });
    me = await (await other.req('/api/me')).json();
    expect(me.viewed).toEqual([]);
    expect(me.saved).toEqual([]);

    expect((await c.req('/api/me/saved/ev_abc', { method: 'DELETE', body: '{}' })).status).toBe(200);
    expect((await (await c.req('/api/me')).json()).saved).toEqual([]);

    await c.req('/api/me', { method: 'DELETE', body: JSON.stringify({ password: creds.password }) });
    const user = app.store.userByEmail('pessoa@example.com');
    expect(user).toBeUndefined();
  });
});
