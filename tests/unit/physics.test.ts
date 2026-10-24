import { describe, expect, it } from 'vitest';
import { makeRadiusFn, scoreToRadius as productionRadius } from '../../shared/impact/radius';

// The engine is size-agnostic. Most tests use a fine-grained curve in a small box so piles form
// quickly; one test below runs at the production sizes.
const scoreToRadius = makeRadiusFn([
  [0, 1.2],
  [20, 1.8],
  [40, 2.5],
  [60, 3.5],
  [80, 5.5],
  [100, 9],
]);
import { createParticle, type Particle } from '../../src/simulation/Particle';
import { DEFAULT_PHYSICS, PhysicsEngine } from '../../src/simulation/PhysicsEngine';
import { toneFor, viewScale } from '../../src/simulation/SandSimulation';

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
    run(e, 50); // every grain rests within 30 s, or 45 s if wedged/pinned by neighbours
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
    expect(e.hitTest(p.x + p.r + 10, p.y)?.eventId).toBe('tiny'); // forgiving target
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

  it('works at production grain sizes (7–50 px) on a desktop-sized box', () => {
    const e = new PhysicsEngine(1280, 800, { ...DEFAULT_PHYSICS, maxStatic: 1500 });
    e.setMaxRadius(productionRadius(100));
    for (let i = 0; i < 400; i++) {
      const s = Math.random() * 100;
      e.add(createParticle({ eventId: 'p' + i, x: 40 + Math.random() * 1200, y: -i * 6, r: productionRadius(s), impact: s, critical: false, bornAt: 0 }));
    }
    for (let i = 0; i < 60 * 60; i++) e.step(dt);
    expect(e.actives.length).toBeLessThan(10);
    expect(e.bedHeightPx).toBeLessThanOrEqual(800 * 0.45);
    // No grain may ever rest inside another one.
    const st = [...e.statics];
    for (let i = 0; i < st.length; i++)
      for (let j = i + 1; j < st.length; j++) {
        const g = st[i];
        const h = st[j];
        expect(Math.hypot(g.x - h.x, g.y - h.y)).toBeGreaterThan((g.r + h.r) * 0.9);
      }
    for (const p of e.statics) {
      expect(p.x).toBeGreaterThanOrEqual(p.r - 0.5);
      expect(p.x).toBeLessThanOrEqual(1280 - p.r + 0.5);
    }
  }, 60_000);

  it('sand does not stack into towers: a grain dropped dead-centre on another rolls off', () => {
    const e = new PhysicsEngine(800, 400, { ...DEFAULT_PHYSICS, ambientMotion: false });
    e.setMaxRadius(productionRadius(100));
    const r = productionRadius(50);
    const base = createParticle({ eventId: 'a', x: 400, y: 400 - r, r, impact: 50, critical: false, bornAt: 0 });
    e.add(base);
    for (let i = 0; i < 120; i++) e.step(dt);
    const top = createParticle({ eventId: 'b', x: 400, y: -r, r, impact: 50, critical: false, bornAt: e.time });
    e.add(top);
    for (let i = 0; i < 60 * 40; i++) e.step(dt);
    expect(e.actives).toHaveLength(0);
    expect(top.y + top.r).toBeCloseTo(400, 0); // ended on the floor, beside the other grain
  });

  it('a column of grains dropped at the same spot spreads into a mound, not a tower', () => {
    const e = new PhysicsEngine(800, 600, { ...DEFAULT_PHYSICS, ambientMotion: false });
    e.setMaxRadius(productionRadius(100));
    const r = productionRadius(30);
    for (let i = 0; i < 12; i++) e.add(createParticle({ eventId: 'c' + i, x: 400, y: -r - i * 70, r, impact: 30, critical: false, bornAt: 0 }));
    for (let i = 0; i < 60 * 60; i++) e.step(dt);
    const all = [...e.statics];
    expect(all).toHaveLength(12);
    const height = 600 - Math.min(...all.map((p) => p.y - p.r));
    const width = Math.max(...all.map((p) => p.x + p.r)) - Math.min(...all.map((p) => p.x - p.r));
    expect(width).toBeGreaterThan(height * 1.5); // a mound, never a column
    expect(height).toBeLessThan(r * 2 * 4); // at most ~4 grains high
  });

  it('age shading: fresh news is solid, older news lighter, gone at the end of its life', () => {
    const now = Date.now();
    const life = 48 * 3_600_000;
    const at = (hoursAgo: number) => toneFor(now - hoursAgo * 3_600_000, now - hoursAgo * 3_600_000 + life, now);
    expect(at(0)).toBe(1);
    expect(at(12)).toBeGreaterThan(at(24));
    expect(at(24)).toBeGreaterThan(at(42));
    expect(at(48)).toBe(0);
    expect(toneFor(undefined, undefined, now)).toBe(1); // no timing → no shading
  });

  it('a released (faded) grain leaves the sand and what rested on it slides down', () => {
    const e = new PhysicsEngine(400, 300, { ...DEFAULT_PHYSICS, ambientMotion: false });
    e.setMaxRadius(productionRadius(100));
    const r = productionRadius(40);
    const left = createParticle({ eventId: 'l', x: 200 - r, y: 300 - r, r, impact: 40, critical: false, bornAt: 0 });
    const right = createParticle({ eventId: 'r', x: 200 + r, y: 300 - r, r, impact: 40, critical: false, bornAt: 0 });
    e.add(left);
    e.add(right);
    for (let i = 0; i < 120; i++) e.step(dt);
    const top = createParticle({ eventId: 't', x: 200, y: -r, r, impact: 40, critical: false, bornAt: e.time });
    e.add(top);
    for (let i = 0; i < 60 * 8; i++) e.step(dt);
    expect(e.statics.has(top)).toBe(true); // resting in the pocket
    e.release(right);
    for (let i = 0; i < 60 * 10; i++) e.step(dt);
    expect(right.state).toBe('removed');
    expect(top.y + top.r).toBeCloseTo(300, 0); // slid down to the floor
  });

  it('resizing the window: shrink then grow back re-pours the sand cleanly (no merged or stuck grains)', () => {
    const e = new PhysicsEngine(1600, 800, { ...DEFAULT_PHYSICS, ambientMotion: false, maxStatic: 5000, maxPileFraction: 0.9 });
    e.setMaxRadius(productionRadius(100));
    for (let i = 0; i < 300; i++) {
      const sc = Math.random() * 70;
      e.add(createParticle({ eventId: 'g' + i, x: 30 + Math.random() * 1540, y: -i * 8, r: productionRadius(sc), impact: sc, critical: false, bornAt: 0 }));
    }
    for (let i = 0; i < 60 * 60; i++) e.step(dt);
    const n = e.staticCount;

    const overlapRatio = () => {
      const all = [...e.statics];
      let bad = 0;
      for (let i = 0; i < all.length; i++)
        for (let j = i + 1; j < all.length; j++) {
          const a = all[i];
          const b = all[j];
          if (Math.hypot(a.x - b.x, a.y - b.y) < (a.r + b.r) * 0.8) bad++;
        }
      return bad / all.length;
    };
    const inBounds = () => [...e.statics].every((g) => g.x >= g.r - 0.5 && g.x <= e.width - g.r + 0.5 && g.y <= e.height - g.r + 0.5);

    e.resize(700, 800);
    const t0 = performance.now();
    e.relayout();
    const ms = performance.now() - t0;
    expect(e.staticCount).toBe(n); // nothing lost
    expect(inBounds()).toBe(true);
    expect(overlapRatio()).toBeLessThan(0.02);

    e.resize(1600, 800);
    e.relayout();
    expect(e.staticCount).toBe(n);
    expect(inBounds()).toBe(true);
    expect(overlapRatio()).toBeLessThan(0.02);
    const xs = [...e.statics].map((g) => g.x);
    expect(Math.max(...xs) - Math.min(...xs)).toBeGreaterThan(1600 * 0.85); // spread out again, no column
    expect(ms).toBeLessThan(1500);
  }, 60_000);

  it('grains scale with the window width (both ways), within limits', () => {
    expect(viewScale(1920)).toBe(1);
    expect(viewScale(960)).toBe(0.5);
    expect(viewScale(390)).toBe(0.4); // still tappable on phones
    expect(viewScale(5000)).toBe(1.25);
  });

  it('a proportional resize scales the landscape as a whole: same shape, no overlaps, reversible', () => {
    const e = new PhysicsEngine(1600, 800, { ...DEFAULT_PHYSICS, ambientMotion: false, maxStatic: 5000, maxPileFraction: 0.9 });
    e.setMaxRadius(productionRadius(100));
    for (let i = 0; i < 200; i++) {
      const sc = Math.random() * 70;
      e.add(createParticle({ eventId: 'g' + i, x: 30 + Math.random() * 1540, y: -i * 8, r: productionRadius(sc), impact: sc, critical: false, bornAt: 0 }));
    }
    for (let i = 0; i < 60 * 50; i++) e.step(dt);
    const before = [...e.statics].map((g) => ({ g, x: g.x, y: g.y, r: g.r }));
    e.resize(800, 800, 0.5); // half the width → grains half the size
    for (const b of before) {
      expect(b.g.r).toBeCloseTo(b.r * 0.5, 6);
      expect(b.g.x).toBeCloseTo(b.x * 0.5, 6);
      expect(800 - b.g.y).toBeCloseTo((800 - b.y) * 0.5, 6);
    }
    e.resize(1600, 800, 2); // and back
    for (const b of before) {
      expect(b.g.r).toBeCloseTo(b.r, 6);
      expect(b.g.x).toBeCloseTo(b.x, 6);
      expect(b.g.y).toBeCloseTo(b.y, 6);
    }
  }, 60_000);
});
