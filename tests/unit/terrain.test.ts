import { describe, expect, it } from 'vitest';
import { scoreToRadius } from '../../shared/impact/radius';
import { CEILING_BIN, mapCeiling } from '../../src/map/terrain';
import { fitWorld } from '../../src/map/projection';
import { createParticle } from '../../src/simulation/Particle';
import { DEFAULT_PHYSICS, PhysicsEngine } from '../../src/simulation/PhysicsEngine';
import { SandStore, type SpawnSink } from '../../src/state/store';
import { FORTALEZA, event } from '../helpers';

const W = 1440;
const H = 810;

describe('map ceiling (the line the sand stays under)', () => {
  // A coastline running along 30°S from 60°W to 30°E, and one dipping to 55°S at 70°W.
  const lines = [[[[-60, -30], [-20, -30], [30, -30]], [[-70, -10], [-70, -55]]]];
  const c = mapCeiling(lines, W, H);
  const project = fitWorld(W, H);
  const at = (lon: number, lat: number) => {
    const [x] = project(lon, lat);
    return c[Math.floor(x / CEILING_BIN)];
  };

  it('sits just above the lowest map line of each column, never below the floor room', () => {
    const [, y30] = project(-20, -30);
    expect(at(20, -30)).toBeLessThanOrEqual(y30);
    expect(at(20, -30)).toBeGreaterThan(y30 - 20);
    const [, y55] = project(-70, -55);
    expect(at(-70, -55)).toBeGreaterThan(y30); // lower where the map reaches lower
    expect(at(-70, -55)).toBeLessThanOrEqual(Math.min(y55, H - 36));
  });

  it('ignores the Kerguelen islands: the sand may cover them', () => {
    const kerguelen = [[69, -48.7], [70.5, -49.2], [69.2, -49.7], [69, -48.7]];
    const without = mapCeiling(lines, W, H);
    const withIsland = mapCeiling([[...lines[0], kerguelen]], W, H);
    expect(Array.from(withIsland)).toEqual(Array.from(without));
  });

  it('leaves more room beside the map, with no cliffs in between', () => {
    expect(c[0]).toBeCloseTo(H * 0.5, 0);
    for (let i = 1; i < c.length; i++) expect(Math.abs(c[i] - c[i - 1])).toBeLessThanOrEqual(0.8 * CEILING_BIN + 0.01);
  });
});

describe('physics with a ceiling', () => {
  it('sinks the oldest sand once the bed rises over the line', () => {
    const e = new PhysicsEngine(400, 300, { ...DEFAULT_PHYSICS, ambientMotion: false });
    e.setMaxRadius(scoreToRadius(100));
    e.setCeiling(new Float32Array(Math.ceil(400 / 12)).fill(260), 12);
    const r = scoreToRadius(60);
    for (let i = 0; i < 160; i++) {
      const p = createParticle({ eventId: `ev${i}`, x: 10 + ((i * 37) % 380), y: -r - (i % 7) * 20, r, impact: 60, critical: false, bornAt: 0 });
      e.dropInstant(p);
    }
    for (let i = 0; i < 60 * 40; i++) e.step(1 / 60);
    e.measureBed();
    const over = Array.from(e.surface).filter((t) => 260 - t > 12).length;
    expect(e.removedCount).toBeGreaterThan(0);
    expect(over / e.surface.length).toBeLessThan(0.2);
  });
});

describe('first fall order', () => {
  it('queues every grain (events and developments) by when its news happened, oldest first', () => {
    const order: string[] = [];
    const sink: SpawnSink = { enqueue: (req) => void order.push(req.developmentId ?? req.eventId), updateImpact: () => {}, forgetEvent: () => {} };
    const now = Date.now();
    const iso = (h: number) => new Date(now - h * 3_600_000).toISOString();
    // Ingested in the "wrong" order: firstSeenAt says nothing about how old the news is.
    const newer = event({ id: 'ev_newer', publishedAt: iso(1), firstSeenAt: iso(0.1) });
    const older = event({
      id: 'ev_older',
      publishedAt: iso(20),
      firstSeenAt: iso(0.05),
      developments: [{ id: 'dv_mid', at: iso(5), title: 'Desdobramento', url: 'https://example.com/d', sourceName: 'Teste', reason: 'novo dado' }],
    });
    const store = new SandStore(FORTALEZA);
    store.attachSink(sink);
    store.applySnapshot([newer, older], { sources: [], serverTime: iso(0), eventCount: 2 });
    expect(order).toEqual(['ev_older', 'dv_mid', 'ev_newer']);
  });
});
