import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize, resolve } from 'node:path';
import type { StreamStatus } from '../shared/types';
import { createEnricher } from './analysis/llm';
import { Pipeline } from './ingestion/pipeline';
import { Scheduler } from './ingestion/scheduler';
import { Store } from './persistence/store';
import { createAuthLimiters, handleAuth, currentUserId } from './routes/auth';
import { reverseGeocode, searchCities } from './routes/geocode';
import { RateLimiter } from './routes/rateLimit';
import type { SourceConnector } from './sources/types';
import { SseHub } from './streaming/sse';

export interface AppOptions {
  databasePath: string;
  retentionHours: number;
  snapshotLimit: number;
  connectors: SourceConnector[];
  ingestion: boolean;
  staticDir?: string;
  maxSseClients?: number;
  maxSsePerIp?: number;
  corsOrigin?: string;
  llm?: { anthropicKey?: string; model: string; maxCallsPerHour: number };
  /** News, stream and geocoding require a logged-in session (default true). */
  requireAuth?: boolean;
  /** Mark the session cookie Secure (default: production). */
  secureCookies?: boolean;
  log?: (msg: string) => void;
}

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2',
  '.json': 'application/json',
  '.map': 'application/json',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

const SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'X-Frame-Options': 'DENY',
  'Permissions-Policy': 'geolocation=(self), camera=(), microphone=()',
  'Content-Security-Policy':
    "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'",
};

function clientIp(req: IncomingMessage): string {
  return req.socket.remoteAddress ?? 'unknown';
}

function json(res: ServerResponse, status: number, body: unknown, extra: Record<string, string> = {}): void {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...extra });
  res.end(JSON.stringify(body));
}

async function readBody(req: IncomingMessage, max = 2048): Promise<string> {
  let size = 0;
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > max) throw new Error('body too large');
    chunks.push(chunk as Buffer);
  }
  return Buffer.concat(chunks).toString('utf8');
}

export function createApp(opts: AppOptions) {
  const log = opts.log ?? ((m: string) => console.log(m));
  const store = new Store(opts.databasePath);
  const hub = new SseHub({ max: opts.maxSseClients ?? 500, perIp: opts.maxSsePerIp ?? 6 });
  let lastEventAt: string | undefined;

  const pipeline = new Pipeline(store, {
    retentionHours: opts.retentionHours,
    enricher: opts.llm ? createEnricher(opts.llm) : undefined,
    emit: (m) => {
      lastEventAt = new Date().toISOString();
      hub.sendEvent(m);
    },
  });
  pipeline.warmUp();

  let statusTimer: NodeJS.Timeout | undefined;
  const status = (): StreamStatus => ({
    sources: scheduler.statuses(),
    serverTime: new Date().toISOString(),
    lastEventAt,
    eventCount: store.countEvents(),
  });
  const scheduler = new Scheduler(
    opts.connectors,
    store,
    async (articles, source) => {
      const s = await pipeline.ingest(articles);
      if (s.created || s.updated || s.developments) {
        log(`[ingest:${source.id}] +${s.created} novos, ${s.updated} atualizações, ${s.developments} desdobramentos, ${s.duplicates} duplicados, ${s.skippedOld} antigos`);
      }
    },
    () => {
      // Throttle status broadcasts.
      if (statusTimer) return;
      statusTimer = setTimeout(() => {
        statusTimer = undefined;
        hub.sendStatus(status());
      }, 1_000);
    },
    log,
  );

  const retention = setInterval(() => {
    const now = Date.now();
    store.purgeSessions(new Date(now).toISOString());
    store.purgeViewed(new Date(now - opts.retentionHours * 2 * 3_600_000).toISOString());
    const ids = store.purge(new Date(now).toISOString(), new Date(now - opts.retentionHours * 2 * 3_600_000).toISOString());
    if (ids.length) {
      pipeline.forget(ids);
      hub.sendExpire(ids);
      log(`[retention] ${ids.length} evento(s) expirado(s)`);
    }
  }, 10 * 60_000);
  retention.unref();

  const authLimiters = createAuthLimiters();
  const geoLimiter = new RateLimiter(20, 0.5);
  const feedbackLimiter = new RateLimiter(30, 0.2);
  const apiLimiter = new RateLimiter(60, 2);
  const staticRoot = opts.staticDir ? resolve(opts.staticDir) : undefined;

  async function serveStatic(req: IncomingMessage, res: ServerResponse, pathname: string): Promise<void> {
    if (!staticRoot) {
      res.writeHead(404).end();
      return;
    }
    let file = normalize(join(staticRoot, decodeURIComponent(pathname)));
    if (!file.startsWith(staticRoot)) {
      res.writeHead(403).end();
      return;
    }
    try {
      const st = await stat(file);
      if (st.isDirectory()) file = join(file, 'index.html');
    } catch {
      file = join(staticRoot, 'index.html'); // SPA fallback
    }
    try {
      const data = await readFile(file);
      const immutable = file.includes(`${join(staticRoot, 'assets')}`);
      res.writeHead(200, {
        'Content-Type': MIME[extname(file)] ?? 'application/octet-stream',
        'Cache-Control': immutable ? 'public, max-age=31536000, immutable' : 'no-cache',
        ...SECURITY_HEADERS,
      });
      res.end(req.method === 'HEAD' ? undefined : data);
    } catch {
      res.writeHead(404).end();
    }
  }

  const server: Server = createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    const ip = clientIp(req);
    if (opts.corsOrigin) {
      res.setHeader('Access-Control-Allow-Origin', opts.corsOrigin);
      res.setHeader('Vary', 'Origin');
    }
    try {
      if (!url.pathname.startsWith('/api/')) return await serveStatic(req, res, url.pathname);
      for (const [k, v] of Object.entries(SECURITY_HEADERS)) res.setHeader(k, v);

      // CSRF: state-changing requests must carry a custom header, which browsers only
      // allow same-origin (no CORS is granted for it).
      if (req.method !== 'GET' && req.method !== 'HEAD' && req.headers['x-sand'] !== '1') {
        return json(res, 403, { error: 'csrf' });
      }
      const authCtx = { store, secureCookies: opts.secureCookies ?? false, json, readBody, limiters: authLimiters };
      if (url.pathname.startsWith('/api/auth/') || url.pathname.startsWith('/api/me')) {
        if (await handleAuth(req, res, url, ip, authCtx)) return;
      }
      const needsUser = (opts.requireAuth ?? true) && !['/api/health', '/api/sources'].includes(url.pathname);
      if (needsUser && !currentUserId(req, store)) return json(res, 401, { error: 'unauthenticated' });

      if (url.pathname === '/api/stream' && req.method === 'GET') {
        const lastId = Number(req.headers['last-event-id'] ?? url.searchParams.get('since') ?? NaN);
        hub.open(req, res, ip, {
          resumeFrom: Number.isFinite(lastId) ? lastId : undefined,
          snapshot: () => ({ events: store.recentEvents(opts.snapshotLimit), status: status(), seq: store.currentSeq() }),
          since: (seq) => store.eventsAfterSeq(seq, 500),
        });
        return;
      }
      if (!apiLimiter.take(ip)) return json(res, 429, { error: 'rate_limited' }, { 'Retry-After': '10' });

      if (url.pathname === '/api/health') {
        return json(res, 200, { ok: true, ...status(), streams: hub.size, ingestion: opts.ingestion });
      }
      if (url.pathname === '/api/sources') return json(res, 200, status());
      if (url.pathname === '/api/events') {
        const since = Number(url.searchParams.get('since') ?? 0);
        const events = since > 0 ? store.eventsAfterSeq(since, 500) : store.recentEvents(opts.snapshotLimit);
        return json(res, 200, { events, seq: store.currentSeq() });
      }
      if (url.pathname === '/api/geocode/reverse') {
        if (!geoLimiter.take(ip)) return json(res, 429, { error: 'rate_limited' }, { 'Retry-After': '10' });
        const lat = Number(url.searchParams.get('lat'));
        const lon = Number(url.searchParams.get('lon'));
        if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) return json(res, 400, { error: 'invalid_coordinates' });
        return json(res, 200, await reverseGeocode(lat, lon));
      }
      if (url.pathname === '/api/geocode') {
        if (!geoLimiter.take(ip)) return json(res, 429, { error: 'rate_limited' }, { 'Retry-After': '10' });
        const q = url.searchParams.get('q') ?? '';
        const lang = /^[a-z]{2}$/.test(url.searchParams.get('lang') ?? '') ? url.searchParams.get('lang')! : 'pt';
        return json(res, 200, await searchCities(q, lang));
      }
      if (url.pathname === '/api/feedback' && req.method === 'POST') {
        if (!feedbackLimiter.take(ip)) return json(res, 429, { error: 'rate_limited' });
        let body: { eventId?: unknown; value?: unknown };
        try {
          body = JSON.parse(await readBody(req));
        } catch {
          return json(res, 400, { error: 'invalid_json' });
        }
        const eventId = typeof body.eventId === 'string' && /^ev_[a-z0-9]{1,24}$/.test(body.eventId) ? body.eventId : undefined;
        const value = body.value === 'relevant' || body.value === 'not_relevant' ? body.value : undefined;
        if (!eventId || !value || !store.getEvent(eventId)) return json(res, 400, { error: 'invalid_feedback' });
        store.addFeedback(eventId, value); // anonymous aggregate only
        return json(res, 200, { ok: true });
      }
      return json(res, 404, { error: 'not_found' });
    } catch (err) {
      log(`[http] erro em ${url.pathname}: ${(err as Error).message}`);
      if (!res.headersSent) json(res, 500, { error: 'internal_error' });
      else res.end();
    }
  });

  return {
    server,
    store,
    pipeline,
    scheduler,
    hub,
    start(port: number, host = '0.0.0.0'): Promise<void> {
      if (opts.ingestion) scheduler.start();
      return new Promise((r) => server.listen(port, host, r));
    },
    async stop(): Promise<void> {
      scheduler.stop();
      clearInterval(retention);
      clearTimeout(statusTimer);
      hub.close();
      await new Promise<void>((r) => server.close(() => r()));
      server.closeAllConnections?.();
      store.close();
    },
  };
}
