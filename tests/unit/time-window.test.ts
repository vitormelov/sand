import { describe, expect, it } from 'vitest';
import type { StreamStatus } from '../../shared/types';
import { SandStore, timing, type SpawnSink } from '../../src/state/store';
import { FORTALEZA, event } from '../helpers';

const HOUR = 3_600_000;
const status: StreamStatus = { serverTime: new Date().toISOString(), eventCount: 0, sources: [] };

function aged(hours: number) {
  const at = Date.now() - hours * HOUR;
  const iso = new Date(at).toISOString();
  return event({ publishedAt: iso, firstSeenAt: iso, expiresAt: new Date(at + 48 * HOUR).toISOString() }, Date.now());
}

function sink() {
  const spawned: string[] = [];
  const forgotten: string[] = [];
  const retimed = new Map<string, number>();
  const s: SpawnSink = {
    enqueue: (req) => void spawned.push(req.developmentId ?? req.eventId),
    updateImpact: () => {},
    forgetEvent: (id) => void forgotten.push(id),
    retime: (id, dev, fadeAt) => void retimed.set(dev ?? id, fadeAt),
  };
  return { s, spawned, forgotten, retimed };
}

describe('user time window (12–48 h)', () => {
  it('fades grains at the end of the window when it is shorter than the expiry', () => {
    const e = aged(1);
    const { newsAt, fadeAt } = timing(e, undefined, 12 * HOUR);
    expect(fadeAt - newsAt).toBe(12 * HOUR);
    expect(timing(e).fadeAt).toBe(Date.parse(e.expiresAt));
  });

  it('hides older news when narrowed and pours it again when widened', () => {
    const store = new SandStore(FORTALEZA);
    const k = sink();
    store.attachSink(k.s);
    const recent = aged(2);
    const old = aged(20);
    store.applySnapshot([recent, old], status);
    expect(store.events.size).toBe(2);

    store.setWindowHours(12);
    expect([...store.events.keys()]).toEqual([recent.id]);
    expect(k.forgotten).toEqual([old.id]);
    expect(k.retimed.get(recent.id)).toBe(Date.parse(recent.publishedAt!) + 12 * HOUR);

    store.setWindowHours(48);
    expect(store.events.size).toBe(2);
    expect(k.spawned.filter((id) => id === old.id)).toHaveLength(2);
  });

  it('clamps to 12–48 h and filters live events outside the window', () => {
    const store = new SandStore(FORTALEZA);
    store.setWindowHours(3);
    expect(store.getWindowHours()).toBe(12);
    store.setWindowHours(100);
    expect(store.getWindowHours()).toBe(48);

    store.setWindowHours(12);
    store.applySnapshot([], status);
    store.applyEvent({ change: 'new', event: aged(15) });
    expect(store.events.size).toBe(0);
  });
});
