import { describe, expect, it } from 'vitest';
import { scoreToRadius } from '../../shared/impact/radius';
import { createParticle, type Particle } from '../../src/simulation/Particle';
import { DEFAULT_PHYSICS, PhysicsEngine } from '../../src/simulation/PhysicsEngine';

const W = 400;
const H = 300;
const dt = 1 / 60;

function engine(over: Partial<typeof DEFAULT_PHYSICS> = {}) {
  const e = new PhysicsEngine(W, H, { ...DEFAULT_PHYSICS, ...over });
  e.setMaxRadius(scoreToRadius(100));
  return e;
}

function grain(e: PhysicsEngine, x: number, y: number, score = 30, id = 'ev'): Particle {
  const r = scoreToRadius(score);
  const p = createParticle({ eventId: id, x, y, r, impact: score, critical: false, bornAt: e.time });
  e.add(p);
  return p;
}

const run = (e: PhysicsEngine, seconds: number) => {
  for (let i = 0; i < seconds * 60; i++) e.step(dt);
};

describe('physics engine', () => {
  it('grains fall, land on the floor and are deposited', () => {
    const e = engine();
    const p = grain(e, 200, -5);
    run(e, 8);
    expect(e.actives).toHaveLength(0);
    expect(e.statics.has(p)).toBe(true);
    expect(p.y + p.r).toBeCloseTo(H, 0);
  });

  it('respects the walls and floor', () => {
    const e = engine();
    for (let i = 0; i < 60; i++) {
      const p = grain(e, Math.random() * W, -Math.random() * 100, Math.random() * 100);
      p.vx = (Math.random() - 0.5) * 400;
    }
    for (let i = 0; i < 600; i++) {
      e.step(dt);
      for (const p of e.actives) {
        expect(p.x).toBeGreaterThanOrEqual(p.r - 0.01);
        expect(p.x).toBeLessThanOrEqual(W - p.r + 0.01);
        expect(p.y).toBeLessThanOrEqual(H - p.r + 0.01);
      }
    }
  });

  it('collides: a grain dropped on another rests on top instead of overlapping', () => {
    const e = engine({ ambientMotion: false });
    const a = grain(e, 200, H - 10, 90);
    run(e, 3);
    const b = grain(e, 200.2, 0, 90);
    run(e, 10);
    const d = Math.hypot(a.x - b.x, a.y - b.y);
    expect(d).toBeGreaterThan((a.r + b.r) * 0.9);
  });

  it('builds a pile (grains stack) and nothing overlaps badly', () => {
    const e = engine({ ambientMotion: false });
    for (let i = 0; i < 300; i++) grain(e, 180 + Math.random() * 40, -i * 4, 40);
    run(e, 30);
    const statics = [...e.statics];
    const top = Math.min(...statics.map((s) => s.y - s.r));
    expect(H - top).toBeGreaterThan(15); // a mound, not a single layer
    let bad = 0;
    for (let i = 0; i < statics.length; i++)
      for (let j = i + 1; j < statics.length; j++) {
        const a = statics[i];
        const b = statics[j];
        if (Math.hypot(a.x - b.x, a.y - b.y) < (a.r + b.r) * 0.6) bad++;
      }
    expect(bad / statics.length).toBeLessThan(0.02);
  });

  it('limits active grains and caps deposited grains by sinking the bed', () => {
    const e = engine({ maxActive: 50, maxStatic: 200 });
    let added = 0;
    for (let i = 0; i < 60 * 120; i++) {
      if (e.canAcceptActive() && i % 4 === 0) {
        grain(e, Math.random() * W, -5, Math.random() * 60);
        added++;
      }
      e.step(dt);
      expect(e.actives.length).toBeLessThanOrEqual(50);
    }
    expect(added).toBeGreaterThan(400);
    expect(e.staticCount).toBeLessThanOrEqual(200 * 1.25);
    expect(e.removedCount).toBeGreaterThan(0);
  });

  it('heavy impacts wake surface grains (small craters / slides)', () => {
    const e = engine({ ambientMotion: false });
    for (let i = 0; i < 200; i++) grain(e, 150 + Math.random() * 100, -i * 3, 10);
    run(e, 25);
    const before = e.staticCount;
    const big = grain(e, 200, -10, 100);
    big.vy = 400;
    let woke = 0;
    for (let i = 0; i < 120; i++) {
      e.step(dt);
      woke = Math.max(woke, e.actives.length - (e.statics.has(big) ? 0 : 1));
    }
    expect(woke).toBeGreaterThan(0);
    run(e, 32); // every grain is guaranteed to rest within MAX_ACTIVE_AGE (30 s)
    expect(before).toBeGreaterThan(150);
    expect(e.actives).toHaveLength(0);
    expect(e.staticCount).toBe(201); // everything settles again, nothing lost
  });

  it('recovers after a pause: a large dt does not explode the simulation', () => {
    const e = engine();
    for (let i = 0; i < 40; i++) grain(e, Math.random() * W, -i * 5);
    run(e, 2);
    e.step(0.05); // SandSimulation clamps frame time to 50 ms after the tab returns
    run(e, 15);
    for (const p of [...e.statics, ...e.actives]) {
      expect(Number.isFinite(p.x) && Number.isFinite(p.y)).toBe(true);
      expect(p.y - p.r).toBeLessThanOrEqual(H);
    }
  });

  it('reduced motion: dropInstant places a grain at rest immediately', () => {
    const e = engine();
    const p = createParticle({ eventId: 'x', x: 100, y: -5, r: 3, impact: 50, critical: false, bornAt: 0 });
    e.dropInstant(p);
    expect(e.statics.has(p)).toBe(true);
    expect(e.actives).toHaveLength(0);
  });

  it('hit-testing finds the grain under the pointer, with a minimum touch radius', () => {
    const e = engine();
    const p = grain(e, 100, H - 2, 0, 'tiny');
    run(e, 3);
    expect(e.hitTest(p.x + 5, p.y)?.eventId).toBe('tiny');
    expect(e.hitTest(p.x + 40, p.y)).toBeUndefined();
  });

  it('resizing keeps the bed anchored to the bottom edge', () => {
    const e = engine();
    const p = grain(e, 100, 0);
    run(e, 6);
    e.resize(300, 500);
    expect(p.y + p.r).toBeCloseTo(500, 0);
  });

  it('a long session stays bounded (headless, ~20 simulated minutes)', () => {
    const e = engine({ maxStatic: 600 });
    let acc = 0;
    for (let i = 0; i < 60 * 60 * 20; i++) {
      acc += 2 * dt;
      while (acc >= 1 && e.canAcceptActive()) {
        acc--;
        grain(e, Math.random() * W, -5, Math.random() * 100);
      }
      e.step(dt);
    }
    expect(e.staticCount).toBeLessThanOrEqual(600 * 1.25);
    expect(e.actives.length).toBeLessThan(100);
  }, 60_000);
});
