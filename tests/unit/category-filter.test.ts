import { describe, expect, it } from 'vitest';
import type { StreamStatus } from '../../shared/types';
import { mainCategory, SandStore, type SpawnSink } from '../../src/state/store';
import { analysis, event, FORTALEZA } from '../helpers';

const status: StreamStatus = { serverTime: new Date().toISOString(), eventCount: 0, sources: [] };

describe('categories', () => {
  it('uses the first (strongest) category as the main one', () => {
    expect(mainCategory(event({ analysis: analysis({ categories: ['health', 'economy'] }) }))).toBe('health');
    expect(mainCategory(event({ analysis: analysis({ categories: [] }) }))).toBe('other');
  });

  it('hides news by main category and pours it again when switched back on', () => {
    const store = new SandStore(FORTALEZA);
    const spawned: string[] = [];
    const forgotten: string[] = [];
    const sink: SpawnSink = {
      enqueue: (req) => void spawned.push(req.eventId),
      updateImpact: () => {},
      forgetEvent: (id) => void forgotten.push(id),
    };
    store.attachSink(sink);
    const sport = event({ analysis: analysis({ categories: ['sports', 'economy'] }) });
    const money = event({ analysis: analysis({ categories: ['economy', 'sports'] }) });
    store.applySnapshot([sport, money], status);
    expect(spawned).toContain(sport.id);

    store.setHiddenCategories(['sports']);
    expect([...store.events.keys()]).toEqual([money.id]);
    expect(forgotten).toEqual([sport.id]);

    store.applyEvent({ change: 'new', event: event({ analysis: analysis({ categories: ['sports'] }) }) });
    expect(store.events.size).toBe(1);

    store.setHiddenCategories([]);
    expect(store.events.size).toBe(3);
  });
});
