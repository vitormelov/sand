import type { AddressInfo } from 'node:net';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../../server/app';
import type { SourceConnector } from '../../server/sources/types';
import type { RawItem } from '../../server/types';

/** A controllable connector: the test decides what the "provider" returns. */
function fakeSource() {
  let items: RawItem[] = [];
  const c: SourceConnector = {
    id: 'fake', name: 'Fonte de teste', kind: 'outlet', reliability: 0.8, country: 'BR', language: 'pt', intervalMs: 60_000, enabled: true,
    fetch: async () => ({ items }),
  };
  return { c, set: (x: RawItem[]) => (items = x) };
}

const HEADLINES = [
  'Prefeitura anuncia novo horário para coleta de lixo',
  'Universidade federal abre inscrições para mestrado em física',
  'Porto registra recorde na movimentação de contêineres',
  'Hospital inaugura ala pediátrica com quarenta leitos',
  'Orquestra sinfônica apresenta concerto gratuito no domingo',
  'Feira agrícola reúne produtores familiares do sertão',
  'Biblioteca municipal amplia acervo de livros digitais',
  'Aeroporto ganha nova rota internacional para Lisboa',
];
const item = (n: number, title?: string): RawItem => ({
  title: title ?? `${HEADLINES[n % HEADLINES.length]} (número ${n})`,
  url: `https://fonte.example/${n}`,
  publishedAt: new Date().toISOString(),
});

interface SseMsg {
  event: string;
  id?: string;
  data: any;
}

/** Minimal SSE reader on top of fetch streaming. */
async function openStream(url: string, headers: Record<string, string> = {}) {
  const ac = new AbortController();
  const res = await fetch(url, { headers, signal: ac.signal });
  const reader = res.body!.getReader();
  const dec = new TextDecoder();
  let buf = '';
  const queue: SseMsg[] = [];
  const pump = (async () => {
    try {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        let i;
        while ((i = buf.indexOf('\n\n')) >= 0) {
          const block = buf.slice(0, i);
          buf = buf.slice(i + 2);
          const msg: SseMsg = { event: 'message', data: undefined };
          for (const line of block.split('\n')) {
            if (line.startsWith('event: ')) msg.event = line.slice(7);
            else if (line.startsWith('id: ')) msg.id = line.slice(4);
            else if (line.startsWith('data: ')) msg.data = JSON.parse(line.slice(6));
          }
          if (msg.data !== undefined) queue.push(msg);
        }
      }
    } catch {
      /* aborted */
    }
  })();
  const next = async (type: string, timeout = 3000): Promise<SseMsg> => {
    const t0 = Date.now();
    for (;;) {
      const i = queue.findIndex((m) => m.event === type);
      if (i >= 0) return queue.splice(i, 1)[0];
      if (Date.now() - t0 > timeout) throw new Error(`timeout waiting for ${type}`);
      await new Promise((r) => setTimeout(r, 20));
    }
  };
  return { status: res.status, next, queue, close: () => (ac.abort(), pump) };
}

let app: ReturnType<typeof createApp>;
let base: string;
let src: ReturnType<typeof fakeSource>;

beforeEach(async () => {
  src = fakeSource();
  app = createApp({ databasePath: ':memory:', retentionHours: 48, snapshotLimit: 100, connectors: [src.c], ingestion: false, maxSsePerIp: 3, log: () => {} });
  await app.start(0, '127.0.0.1');
  base = `http://127.0.0.1:${(app.server.address() as AddressInfo).port}`;
});
afterEach(async () => {
  await app.stop();
});

describe('server: ingestion → persistence → SSE', () => {
  it('sends a snapshot, then streams new events as they are ingested', async () => {
    src.set([item(1), item(2)]);
    await app.scheduler.runOnce('fake');
    const s = await openStream(`${base}/api/stream`);
    expect(s.status).toBe(200);
    const snap = await s.next('snapshot');
    expect(snap.data.events).toHaveLength(2);
    expect(snap.data.status.sources[0]).toMatchObject({ id: 'fake', health: 'ok' });

    src.set([item(1), item(2), item(3)]);
    await app.scheduler.runOnce('fake');
    const ev = await s.next('event');
    expect(ev.data.change).toBe('new');
    expect(ev.data.event.title).toContain('número 3');
    expect(Number(ev.id)).toBeGreaterThan(Number(snap.id));
    await s.close();
  });

  it('resumes after a disconnect with Last-Event-ID (only what changed is replayed)', async () => {
    src.set([item(1)]);
    await app.scheduler.runOnce('fake');
    const a = await openStream(`${base}/api/stream`);
    const snap = await a.next('snapshot');
    await a.close();

    src.set([item(1), item(4), item(5)]);
    await app.scheduler.runOnce('fake');

    const b = await openStream(`${base}/api/stream`, { 'Last-Event-ID': snap.id! });
    const e1 = await b.next('event');
    const e2 = await b.next('event');
    expect([e1.data.event.title, e2.data.event.title].join(' ')).toMatch(/número 4.*número 5|número 5.*número 4/);
    expect(b.queue.find((m) => m.event === 'snapshot')).toBeUndefined();
    await b.close();
  });

  it('keeps serving the existing landscape when the provider fails', async () => {
    src.set([item(1)]);
    await app.scheduler.runOnce('fake');
    src.c.fetch = async () => {
      throw new Error('provider down');
    };
    await app.scheduler.runOnce('fake');
    const res = await (await fetch(`${base}/api/events`)).json();
    expect(res.events).toHaveLength(1);
    const health = await (await fetch(`${base}/api/health`)).json();
    expect(health.sources[0]).toMatchObject({ health: 'degraded', lastError: expect.stringContaining('provider down') });
  });

  it('limits concurrent streams per address', async () => {
    const streams = await Promise.all([1, 2, 3].map(() => openStream(`${base}/api/stream`)));
    const fourth = await fetch(`${base}/api/stream`);
    expect(fourth.status).toBe(429);
    await Promise.all(streams.map((s) => s.close()));
  });

  it('validates feedback and stores only an anonymous count', async () => {
    src.set([item(7)]);
    await app.scheduler.runOnce('fake');
    const id = app.store.recentEvents(1)[0].id;
    const post = (body: unknown) => fetch(`${base}/api/feedback`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    expect((await post({ eventId: id, value: 'relevant' })).status).toBe(200);
    expect((await post({ eventId: id, value: 'maybe' })).status).toBe(400);
    expect((await post({ eventId: 'ev_<script>', value: 'relevant' })).status).toBe(400);
    expect(app.store.feedbackCounts(id)).toEqual({ relevant: 1 });
  });

  it('sets security headers and does not expose secrets', async () => {
    const res = await fetch(`${base}/api/health`);
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
    expect(res.headers.get('content-security-policy')).toMatch(/default-src 'self'/);
    const body = await res.text();
    expect(body).not.toMatch(/api[_-]?key|sk-ant/i);
  });
});
