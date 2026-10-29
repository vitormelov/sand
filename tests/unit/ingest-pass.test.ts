import { describe, expect, it } from 'vitest';
import { bucketId, groupByBucket, parseBucket } from '../../shared/feed';
import type { IngestState } from '../../server/firebase/feedStore';
import { planBuckets } from '../../server/firebase/feedStore';
import { runIngestPass, type PassResult } from '../../server/ingestion/runOnce';
import type { SourceConnector } from '../../server/sources/types';
import type { RawItem } from '../../server/types';
import { event } from '../helpers';

const HEADLINES = [
  'Prefeitura anuncia novo horário para coleta de lixo',
  'Universidade federal abre inscrições para mestrado em física',
  'Hospital inaugura ala pediátrica com quarenta leitos',
  'Aeroporto ganha nova rota internacional para Lisboa',
];
const item = (n: number): RawItem => ({ title: `${HEADLINES[n % HEADLINES.length]} (número ${n})`, url: `https://fonte.example/${n}`, publishedAt: new Date().toISOString() });

function fakeSource(items: RawItem[], over: Partial<SourceConnector> = {}) {
  let calls = 0;
  const c: SourceConnector = {
    id: 'fake', name: 'Fonte de teste', kind: 'outlet', reliability: 0.8, country: 'BR', language: 'pt', intervalMs: 5 * 60_000, enabled: true,
    fetch: async () => {
      calls++;
      return { items, state: { etag: `"v${calls}"` } };
    },
    ...over,
  };
  return { c, calls: () => calls };
}

const empty: IngestState = { events: [], bucketIds: [], articles: [], articleChunks: 0, sourceState: {}, runtime: {}, seq: 0 };

/** What the next pass would load back from Firestore after this one was saved. */
function carry(prev: IngestState, r: PassResult): IngestState {
  const kept = prev.bucketIds.filter((id) => !r.plan.remove.includes(id));
  const buckets = new Map(groupByBucket(prev.events));
  for (const id of r.plan.remove) buckets.delete(id);
  for (const [id, evs] of r.plan.set) buckets.set(id, evs);
  return {
    events: [...buckets.values()].flat(),
    bucketIds: [...new Set([...kept, ...r.plan.set.keys()])],
    articles: r.articles,
    articleChunks: 1,
    sourceState: r.sourceState,
    runtime: r.runtime,
    seq: r.seq,
    lastEventAt: r.lastEventAt,
  };
}

const opts = { retentionHours: 48, log: () => {} };

describe('run-once ingestion pass', () => {
  it('creates events, then on the next pass skips sources not yet due and dedupes known articles', async () => {
    const src = fakeSource([item(1), item(2)]);
    const first = await runIngestPass(empty, [src.c], opts);
    expect(first.polled).toBe(1);
    expect(first.status.eventCount).toBe(2);
    expect([...first.plan.set.values()].flat()).toHaveLength(2);
    expect(first.sourceState.fake).toEqual({ etag: '"v1"' });
    expect(first.runtime.fake.status.health).toBe('ok');

    // Right after: the source is not due yet (interval 5 min), nothing is written but the meta.
    const state = carry(empty, first);
    const second = await runIngestPass(state, [src.c], opts);
    expect(second.polled).toBe(0);
    expect(second.plan.set.size).toBe(0);
    expect(second.status.eventCount).toBe(2);

    // Five minutes later it is polled again; the same articles are duplicates, not new events.
    const third = await runIngestPass(state, [src.c], { ...opts, now: Date.now() + 5 * 60_000 });
    expect(third.polled).toBe(1);
    expect(third.changed).toBe(0);
    expect(third.status.eventCount).toBe(2);
    expect(src.calls()).toBe(2);
  });

  it('backs a failing source off and keeps its failure count between passes', async () => {
    const bad = fakeSource([], {
      fetch: async () => {
        throw new Error('fora do ar');
      },
    });
    const first = await runIngestPass(empty, [bad.c], opts);
    expect(first.runtime.fake.failures).toBe(1);
    expect(first.runtime.fake.status.health).toBe('degraded');
    const second = await runIngestPass(carry(empty, first), [bad.c], { ...opts, now: Date.now() + 60 * 60_000 });
    expect(second.runtime.fake.failures).toBe(2);
  });

  it('removes expired events and the hour buckets left empty', async () => {
    const old = event({ firstSeenAt: '2020-01-01T10:15:00Z', expiresAt: '2020-01-03T10:15:00Z' });
    const state: IngestState = { ...empty, events: [old], bucketIds: [bucketId(old)] };
    const r = await runIngestPass(state, [], opts);
    expect(r.expiredIds).toEqual([old.id]);
    expect(r.plan.remove).toEqual(['h-2020010110']);
  });
});

describe('feed buckets', () => {
  it('groups by UTC hour of first sighting and writes only touched or new hours', () => {
    const a = event({ firstSeenAt: '2026-10-28T13:05:00Z' });
    const b = event({ firstSeenAt: '2026-10-28T13:55:00Z' });
    const c = event({ firstSeenAt: '2026-10-28T14:01:00Z' });
    expect(bucketId(a)).toBe('h-2026102813');
    const plan = planBuckets([a, b, c], ['h-2026102813-0', 'h-2026102812-0'], new Set());
    expect([...plan.set.keys()]).toEqual(['h-2026102814-0']);
    expect(plan.remove).toEqual(['h-2026102812-0']);
    expect(planBuckets([a, b, c], ['h-2026102813-0', 'h-2026102814-0'], new Set(['h-2026102813'])).set.get('h-2026102813-0')).toHaveLength(2);
  });

  it('splits a crowded hour into documents under the size limit, and drops parts left over', () => {
    const evs = Array.from({ length: 10 }, (_, i) => event({ firstSeenAt: `2026-10-28T13:${String(i).padStart(2, '0')}:00Z` }));
    const one = JSON.stringify(evs[0]).length;
    const plan = planBuckets(evs, [], new Set(), one * 3 + 10);
    expect([...plan.set.keys()]).toEqual(['h-2026102813-0', 'h-2026102813-1', 'h-2026102813-2', 'h-2026102813-3']);
    expect([...plan.set.values()].flat()).toHaveLength(10);
    // Later the hour shrinks to fit one document: the extra parts are removed.
    const later = planBuckets(evs.slice(0, 2), [...plan.set.keys()], new Set(['h-2026102813']), one * 3 + 10);
    expect([...later.set.keys()]).toEqual(['h-2026102813-0']);
    expect(later.remove).toEqual(['h-2026102813-1', 'h-2026102813-2', 'h-2026102813-3']);
  });

  it('parses bucket docs defensively', () => {
    expect(parseBucket({ events: JSON.stringify([event()]) })).toHaveLength(1);
    expect(parseBucket({ events: 'not json' })).toEqual([]);
    expect(parseBucket(undefined)).toEqual([]);
  });
});
