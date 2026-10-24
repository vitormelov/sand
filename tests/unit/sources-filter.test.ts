import { describe, expect, it } from 'vitest';
import { sanitizeProfile } from '../../shared/profile';
import type { StreamStatus } from '../../shared/types';
import { SandStore, type SpawnSink } from '../../src/state/store';
import { FORTALEZA, event } from '../helpers';

const status: StreamStatus = {
  serverTime: new Date().toISOString(),
  eventCount: 0,
  sources: [
    { id: 'g1', name: 'g1', kind: 'outlet', health: 'ok' },
    { id: 'bbc-brasil', name: 'BBC News Brasil', kind: 'outlet', health: 'ok' },
  ],
};

function sink() {
  const spawned: string[] = [];
  const forgotten: string[] = [];
  const s: SpawnSink = {
    enqueue: (req) => void spawned.push(req.developmentId ?? req.eventId),
    updateImpact: () => {},
    forgetEvent: (id) => void forgotten.push(id),
  };
  return { s, spawned, forgotten };
}

describe('per-user source filter', () => {
  it('hides events whose every source is off and pours them again when switched back on', () => {
    const store = new SandStore(FORTALEZA);
    const k = sink();
    store.attachSink(k.s);
    const a = event({ sourceName: 'g1', sources: ['g1'], sourceIds: ['g1'] });
    const b = event({ sourceName: 'BBC News Brasil', sources: ['BBC News Brasil'], sourceIds: ['bbc-brasil'] });
    const both = event({ sources: ['g1', 'BBC News Brasil'], sourceIds: ['g1', 'bbc-brasil'] });
    store.applySnapshot([a, b, both], status);
    expect(store.events.size).toBe(3);

    store.setHiddenSources(['g1']);
    expect([...store.events.keys()].sort()).toEqual([b.id, both.id].sort());
    expect(k.forgotten).toEqual([a.id]);

    store.setHiddenSources([]);
    expect(store.events.size).toBe(3);
    expect(k.spawned.filter((id) => id === a.id)).toHaveLength(2);
  });

  it('falls back to source names for events without ids, and filters live events', () => {
    const store = new SandStore(FORTALEZA);
    store.setHiddenSources(['bbc-brasil']);
    const old = event({ sources: ['BBC News Brasil'] });
    store.applySnapshot([old], status);
    expect(store.events.has(old.id)).toBe(false);

    const live = event({ sources: ['BBC News Brasil'], sourceIds: ['bbc-brasil'] });
    store.applyEvent({ change: 'new', event: live });
    expect(store.events.has(live.id)).toBe(false);
    expect(store.getState().sessionCount).toBe(0);

    // A second source picks the story up: it becomes visible.
    store.applyEvent({ change: 'update', event: { ...live, sources: ['BBC News Brasil', 'g1'], sourceIds: ['bbc-brasil', 'g1'] } });
    expect(store.events.has(live.id)).toBe(true);
  });

  it('never hides events with unknown sources (lab / demo)', () => {
    const store = new SandStore(FORTALEZA);
    store.setHiddenSources(['g1', 'bbc-brasil']);
    const e = event({ sources: ['Desconhecida'] });
    store.applySnapshot([e], status);
    expect(store.events.has(e.id)).toBe(true);
  });

  it('sanitizes the stored list', () => {
    const p = sanitizeProfile({ hiddenSources: ['g1', 'g1', 'BAD ID', 42, 'usgs'] });
    expect(p.hiddenSources).toEqual(['g1', 'usgs']);
    expect(sanitizeProfile({}).hiddenSources).toBeUndefined();
  });
});
