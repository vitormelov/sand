import { describe, expect, it } from 'vitest';
import { diffFeed } from '../../src/services/stream';
import { event } from '../helpers';

const map = (...evs: ReturnType<typeof event>[]) => new Map(evs.map((e) => [e.id, e]));

describe('feed diff (Firestore snapshot → stream changes)', () => {
  it('reports new events, new developments, updates and expiries', () => {
    const a = event({ id: 'ev_a', seq: 1 });
    const b = event({ id: 'ev_b', seq: 2 });
    const c = event({ id: 'ev_c', seq: 3 });
    const dev = { id: 'dv_1', at: new Date().toISOString(), title: 'Desdobramento', url: 'https://x.example/1', sourceName: 'g1' };
    const next = map({ ...a, seq: 4, developments: [dev as never] }, { ...b, seq: 5, updatedAt: '2030-01-01T00:00:00Z' }, event({ id: 'ev_d', seq: 6 }));
    const { messages, expired } = diffFeed(map(a, b, c), next);
    expect(messages.map((m) => [m.change, m.event.id, m.developmentId])).toEqual([
      ['development', 'ev_a', 'dv_1'],
      ['update', 'ev_b', undefined],
      ['new', 'ev_d', undefined],
    ]);
    expect(expired).toEqual(['ev_c']);
  });

  it('says nothing when the feed did not change', () => {
    const a = event({ id: 'ev_a' });
    expect(diffFeed(map(a), map(a))).toEqual({ messages: [], expired: [] });
  });
});
