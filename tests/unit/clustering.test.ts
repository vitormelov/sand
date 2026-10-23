import { beforeEach, describe, expect, it } from 'vitest';
import { Pipeline } from '../../server/ingestion/pipeline';
import { Store } from '../../server/persistence/store';
import { findRelations } from '../../server/clustering/relations';
import type { StreamEventMessage } from '../../shared/types';
import { NOW, analysis, article, event } from '../helpers';

let store: Store;
let emitted: StreamEventMessage[];
let now: number;
let pipeline: Pipeline;

beforeEach(() => {
  store = new Store(':memory:');
  emitted = [];
  now = NOW;
  pipeline = new Pipeline(store, { retentionHours: 48, emit: (m) => emitted.push(m), now: () => now });
});

describe('deduplication', () => {
  it('ignores the same URL seen again (even with tracking params)', async () => {
    const a = article({ title: 'Governo anuncia reajuste do salário mínimo para 2027', url: 'https://ex.com/a' });
    await pipeline.ingest([a]);
    const s = await pipeline.ingest([{ ...a, fetchedAt: new Date(NOW + 60_000).toISOString() }]);
    expect(s.duplicates).toBe(1);
    expect(emitted.filter((m) => m.change === 'new')).toHaveLength(1);
  });

  it('treats a revised official record as an update, not a new grain', async () => {
    const a = article({ title: 'M 5.9 - 30 km S of Somewhere, Chile', url: 'https://usgs.example/ev1', sourceKind: 'official', hints: { eventKey: 'usgs:ev1', revision: '1', hazard: true, severity: 0.4 } });
    await pipeline.ingest([a]);
    await pipeline.ingest([{ ...a, title: 'M 6.1 - 30 km S of Somewhere, Chile', hints: { ...a.hints, revision: '2', severity: 0.5 } }]);
    expect(emitted.map((m) => m.change)).toEqual(['new', 'update']);
    expect(store.getEvent(emitted[0].event.id)?.title).toContain('6.1');
  });
});

describe('clustering', () => {
  it('merges different outlets covering the same happening into one event', async () => {
    await pipeline.ingest([article({ title: 'Banco Central eleva taxa Selic para 15% ao ano', url: 'https://a.com/1', sourceName: 'A' })]);
    now += 20 * 60_000;
    await pipeline.ingest([article({ title: 'Selic sobe para 15% ao ano, decide Banco Central', url: 'https://b.com/2', sourceName: 'B' }, now)]);
    const news = emitted.filter((m) => m.change === 'new');
    expect(news).toHaveLength(1);
    const ev = store.getEvent(news[0].event.id)!;
    expect(ev.articleCount).toBe(2);
    expect(ev.verification).toBe('corroborated');
  });

  it('does not merge distinct events that only share an entity', async () => {
    await pipeline.ingest([
      article({ title: 'Petrobras anuncia redução no preço do diesel', url: 'https://a.com/p1' }),
      article({ title: 'Petrobras registra lucro recorde no terceiro trimestre', url: 'https://a.com/p2' }),
    ]);
    expect(emitted.filter((m) => m.change === 'new')).toHaveLength(2);
  });

  it('merges hazard reports from different agencies by place and time', async () => {
    const loc = (lat: number, lon: number) => [{ name: 'p', level: 'city' as const, lat, lon, confidence: 0.9, via: 'official-feed' }];
    await pipeline.ingest([article({ title: 'M 6.4 - 50 km E of Town, Japan', url: 'https://usgs/x', sourceKind: 'official', hints: { eventKey: 'usgs:x', hazardType: 'EQ', locations: loc(35, 140) } })]);
    await pipeline.ingest([article({ title: 'Orange earthquake alert in Japan', url: 'https://gdacs/y', sourceKind: 'official', hints: { eventKey: 'gdacs:y', hazardType: 'EQ', locations: loc(35.3, 140.4) } })]);
    expect(emitted.filter((m) => m.change === 'new')).toHaveLength(1);
  });

  it('merges overlapping area warnings of the same hazard', async () => {
    const w = (id: string, ufs: string[]) =>
      article({ title: `INMET: Baixa Umidade — perigo potencial (${ufs.join(', ')})`, url: `https://inmet/${id}`, sourceKind: 'official', hints: { eventKey: `inmet:${id}`, hazardType: 'INMET-Baixa Umidade', areaKeys: ufs } });
    await pipeline.ingest([w('1', ['CE', 'PI', 'PE', 'RN'])]);
    await pipeline.ingest([w('2', ['CE', 'PI', 'PE', 'RN', 'PB'])]);
    await pipeline.ingest([w('3', ['SC', 'RS'])]);
    expect(emitted.filter((m) => m.change === 'new')).toHaveLength(2);
  });

  it('a materially new development produces a smaller extra grain; plain coverage does not', async () => {
    await pipeline.ingest([article({ title: 'Deslizamento em Petrópolis deixa 4 mortos', url: 'https://a.com/d1' })]);
    now += 3 * 3_600_000;
    await pipeline.ingest([article({ title: 'Deslizamento em Petrópolis: mortos chegam a 4, diz Defesa Civil', url: 'https://b.com/d2' }, now)]);
    now += 3 * 3_600_000;
    await pipeline.ingest([article({ title: 'Deslizamento em Petrópolis: número de mortos sobe para 19', url: 'https://c.com/d3' }, now)]);
    expect(emitted.map((m) => m.change)).toEqual(['new', 'update', 'development']);
    expect(emitted[2].developmentId).toBeTruthy();
  });
});

describe('retention and old news', () => {
  it('does not present old news discovered late as a new happening', async () => {
    const old = article({ title: 'Notícia antiga encontrada só agora no feed', publishedAt: new Date(NOW - 72 * 3_600_000).toISOString() });
    const s = await pipeline.ingest([old]);
    expect(s.skippedOld).toBe(1);
    expect(emitted).toHaveLength(0);
  });

  it('expires events after the retention window', async () => {
    await pipeline.ingest([article({ title: 'Acontecimento que vai expirar depois de dois dias' })]);
    expect(store.countEvents(new Date(NOW).toISOString())).toBe(1);
    const later = new Date(NOW + 49 * 3_600_000).toISOString();
    const ids = store.purge(later, later);
    expect(ids).toHaveLength(1);
    expect(store.countEvents(later)).toBe(0);
  });
});

describe('causal relations', () => {
  const oil = event({
    title: 'Petróleo Brent dispara após ataques no Golfo',
    publishedAt: new Date(NOW - 10 * 3_600_000).toISOString(),
    analysis: analysis({ affectedScope: 'global', channels: [{ channel: 'energy_fuel', strength: 0.95, evidence: ['petroleo', 'brent'] }] }),
  });

  it('labels an explicit attribution as documented', () => {
    const fuel = event({
      title: 'Gasolina sobe nos postos de Fortaleza após disparada do petróleo',
      analysis: analysis({ channels: [{ channel: 'cost_of_living', strength: 0.8, evidence: [] }] }),
    });
    expect(findRelations(fuel, [oil])[0]).toMatchObject({ eventId: oil.id, kind: 'documented' });
  });

  it('labels a mention without causal language as probable', () => {
    const fuel = event({ title: 'Preço da gasolina e petróleo em foco nesta semana', analysis: analysis({ channels: [{ channel: 'cost_of_living', strength: 0.8, evidence: [] }] }) });
    expect(findRelations(fuel, [oil])[0]?.kind).toBe('probable');
  });

  it('only "possible" when there is no textual evidence, and nothing when geography is incompatible', () => {
    const fuel = event({ title: 'Inflação de alimentos acelera em outubro', analysis: analysis({ channels: [{ channel: 'cost_of_living', strength: 0.8, evidence: [] }] }) });
    expect(findRelations(fuel, [oil])[0]?.kind).toBe('possible');
    const localFire = event({
      title: 'Incêndio atinge mata em Santa Catarina',
      publishedAt: new Date(NOW - 5 * 3_600_000).toISOString(),
      analysis: analysis({ affectedScope: 'local', locations: [{ name: 'SC', level: 'state', admin1: 'SC', countryCode: 'BR', confidence: 0.8, via: 't' }], channels: [{ channel: 'natural_hazard', strength: 0.9, evidence: ['incendio'] }] }),
    });
    const traffic = event({ title: 'Trânsito lento na capital cearense', analysis: analysis({ locations: [{ name: 'Fortaleza', level: 'city', admin1: 'CE', countryCode: 'BR', confidence: 0.8, via: 't' }], channels: [{ channel: 'mobility', strength: 0.7, evidence: [] }] }) });
    expect(findRelations(traffic, [localFire])).toEqual([]);
  });

  it('never links an effect to a later cause', () => {
    const earlier = event({ title: 'Gasolina sobe após alta do petróleo', publishedAt: new Date(NOW - 20 * 3_600_000).toISOString(), analysis: analysis({ channels: [{ channel: 'cost_of_living', strength: 0.8, evidence: [] }] }) });
    expect(findRelations(earlier, [oil])).toEqual([]);
  });
});
