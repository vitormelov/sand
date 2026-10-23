import { readFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { analyzeArticle } from '../../server/analysis/rules';
import { Scheduler } from '../../server/ingestion/scheduler';
import { normalizeItem } from '../../server/normalization/normalize';
import { Store } from '../../server/persistence/store';
import { mapGdeltArticles } from '../../server/sources/gdelt';
import { httpGet } from '../../server/sources/http';
import { mapUsgsFeature, parseGdacs, parseInmet } from '../../server/sources/official';
import { parseFeed } from '../../server/sources/rss';
import { HttpError, type SourceConnector } from '../../server/sources/types';
import type { NormalizedArticle } from '../../server/types';

/**
 * Fixtures in tests/fixtures were captured from the real feeds on 2026-10-23
 * and trimmed to a few items. GDELT's sample is synthetic (the API returned
 * HTTP 429 from the development machine) and follows its documented format.
 */
const fx = (name: string) => readFileSync(new URL(`../fixtures/${name}`, import.meta.url), 'utf8');
const CAPTURED_AT = Date.parse('2026-10-23T21:10:00Z');
const meta = { id: 't', name: 'T', kind: 'outlet' as const, reliability: 0.8, country: 'BR', language: 'pt' };

describe('connectors parse real responses', () => {
  it('RSS (Agência Brasil): titles, links, dates and plain-text summaries', () => {
    const { rawItems } = parseFeed(fx('agencia-brasil.rss.xml'));
    expect(rawItems.length).toBe(3);
    const n = rawItems.map((r) => normalizeItem(r, meta, new Date(CAPTURED_AT).toISOString(), CAPTURED_AT)).filter(Boolean);
    expect(n).toHaveLength(3);
    for (const a of n) {
      expect(a!.url).toMatch(/^https:\/\/agenciabrasil\.ebc\.com\.br\//);
      expect(a!.publishedAt).toBeTruthy();
      expect(a!.summary ?? '').not.toMatch(/[<>]/);
    }
  });

  it('RSS (g1 Ceará): regional URL becomes a location hint', () => {
    const { rawItems } = parseFeed(fx('g1-ce.rss.xml'));
    const a = normalizeItem(rawItems[0], meta, new Date(CAPTURED_AT).toISOString(), CAPTURED_AT)!;
    const analysis = analyzeArticle(a);
    expect(analysis.locations.some((l) => l.admin1 === 'CE')).toBe(true);
  });

  it('USGS GeoJSON: occurrence time, coordinates and magnitude-based severity', () => {
    const data = JSON.parse(fx('usgs.geojson'));
    const items = data.features.map(mapUsgsFeature);
    expect(items.length).toBeGreaterThan(0);
    const it0 = items[0]!;
    expect(it0.occurredAt).toBe(data.features[0].properties.time);
    expect(it0.hints?.eventKey).toBe(`usgs:${data.features[0].id}`);
    expect(it0.hints?.locations?.[0].lat).toBeCloseTo(data.features[0].geometry.coordinates[1]);
    expect(it0.hints?.severity).toBeGreaterThan(0);
  });

  it('GDACS RSS: keeps orange/red alerts, drops minor green wildfire notices', () => {
    const items = parseGdacs(fx('gdacs.rss.xml'), CAPTURED_AT);
    expect(items.every((i) => !/Green forest fire/i.test(i.title ?? ''))).toBe(true);
    for (const i of items) {
      expect(i.hints?.hazard).toBe(true);
      expect(i.hints?.locations?.length).toBeGreaterThan(0);
    }
  });

  it('INMET RSS: warning level, states and validity window', () => {
    const items = parseInmet(fx('inmet.rss.xml'), CAPTURED_AT);
    expect(items.length).toBeGreaterThan(0);
    for (const i of items) {
      expect(i.title).toMatch(/^INMET: /);
      expect(i.hints?.areaKeys?.length).toBeGreaterThan(0);
      expect(i.hints?.locations?.some((l) => l.countryCode === 'BR')).toBe(true);
    }
    // Expired warnings are dropped.
    expect(parseInmet(fx('inmet.rss.xml'), CAPTURED_AT + 10 * 86_400_000)).toEqual([]);
  });

  it('GDELT JSON (synthetic sample of the documented format)', () => {
    const json = JSON.stringify({ articles: [{ url: 'https://exemplo.com.br/x', title: 'Título de teste', seendate: '20261023T201500Z', domain: 'exemplo.com.br', language: 'Portuguese', sourcecountry: 'Brazil' }] });
    const [it0] = mapGdeltArticles(json);
    expect(it0).toMatchObject({ language: 'pt', sourceCountry: 'BR', sourceName: 'exemplo.com.br' });
    expect(() => mapGdeltArticles('Please limit requests to one every 5 seconds')).toThrow(HttpError);
  });

  it('malformed feeds do not crash the parser', () => {
    expect(parseFeed('<rss><channel><item><title>sem link</title></item></channel></rss>').rawItems[0].url).toBeUndefined();
    expect(() => parseFeed('isto não é xml')).not.toThrow();
    expect(parseGdacs('<rss></rss>', CAPTURED_AT)).toEqual([]);
  });
});

describe('HTTP client', () => {
  let server: Server;
  let base: string;
  beforeAll(async () => {
    server = createServer((req, res) => {
      if (req.url === '/slow') return void setTimeout(() => res.end('late'), 2_000);
      if (req.url === '/etag') {
        if (req.headers['if-none-match'] === '"v1"') return void res.writeHead(304).end();
        return void res.writeHead(200, { ETag: '"v1"' }).end('body');
      }
      if (req.url === '/429') return void res.writeHead(429, { 'Retry-After': '120' }).end('slow down');
      res.writeHead(500).end('boom');
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  afterAll(() => new Promise<void>((r) => server.close(() => r())));

  it('times out', async () => {
    await expect(httpGet(`${base}/slow`, { signal: new AbortController().signal, timeoutMs: 200 })).rejects.toThrow(/timeout/);
  });
  it('uses conditional requests (ETag → 304)', async () => {
    const first = await httpGet(`${base}/etag`, { signal: new AbortController().signal });
    const second = await httpGet(`${base}/etag`, { signal: new AbortController().signal, state: first.state });
    expect(second.status).toBe(304);
  });
  it('surfaces rate limits with Retry-After', async () => {
    const err = await httpGet(`${base}/429`, { signal: new AbortController().signal }).catch((e) => e);
    expect(err).toBeInstanceOf(HttpError);
    expect(err.status).toBe(429);
    expect(err.retryAfterMs).toBe(120_000);
  });
});

describe('scheduler: one failing provider does not stop the others', () => {
  const ok: SourceConnector = {
    id: 'ok', name: 'OK', kind: 'outlet', reliability: 0.8, intervalMs: 60_000, enabled: true,
    fetch: async () => ({ items: [{ title: 'Notícia válida de uma fonte saudável', url: 'https://ok.example/1', publishedAt: new Date().toISOString() }, { title: 'x' }] }),
  };
  const broken: SourceConnector = {
    id: 'broken', name: 'Broken', kind: 'outlet', reliability: 0.8, intervalMs: 60_000, enabled: true,
    fetch: async () => {
      throw new HttpError(503, 'HTTP 503: unavailable');
    },
  };
  const limited: SourceConnector = {
    id: 'limited', name: 'Limited', kind: 'aggregator', reliability: 0.5, intervalMs: 60_000, enabled: true,
    fetch: async () => {
      throw new HttpError(429, 'HTTP 429: limit', 30_000);
    },
  };
  const disabled: SourceConnector = { ...ok, id: 'off', enabled: false, disabledReason: 'sem chave' };

  it('isolates failures and reports health per source', async () => {
    const got: NormalizedArticle[] = [];
    const s = new Scheduler([ok, broken, limited, disabled], new Store(':memory:'), async (a) => void got.push(...a), () => {}, () => {});
    const st = await Promise.all(['broken', 'ok', 'limited'].map((id) => s.runOnce(id)));
    expect(st[0]).toMatchObject({ health: 'degraded', lastError: expect.stringContaining('503') });
    expect(st[1]).toMatchObject({ health: 'ok', itemsLastFetch: 1, note: expect.stringContaining('malformado') });
    expect(st[2]?.health).toBe('degraded');
    expect(got).toHaveLength(1);
    expect(s.statuses().find((x) => x.id === 'off')).toMatchObject({ health: 'disabled', note: 'sem chave' });
    await s.runOnce('broken');
    await s.runOnce('broken');
    expect(s.statuses().find((x) => x.id === 'broken')?.health).toBe('down');
    s.stop();
  });
});
