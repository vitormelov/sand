import { describe, expect, it } from 'vitest';
import { RADIUS_CURVE } from '../../shared/impact/config';
import { makeRadiusFn, scoreToRadius } from '../../shared/impact/radius';

describe('score → radius', () => {
  it('passes through the configured control points', () => {
    for (const [s, r] of RADIUS_CURVE) expect(scoreToRadius(s)).toBeCloseTo(r, 6);
  });

  it('is monotonic and smooth (no jumps between consecutive scores)', () => {
    let prev = scoreToRadius(0);
    for (let s = 0.5; s <= 100; s += 0.5) {
      const r = scoreToRadius(s);
      expect(r).toBeGreaterThanOrEqual(prev);
      expect(r - prev).toBeLessThan(0.15);
      prev = r;
    }
  });

  it('clamps out-of-range scores and keeps extremes elegant', () => {
    expect(scoreToRadius(-50)).toBe(scoreToRadius(0));
    expect(scoreToRadius(500)).toBe(scoreToRadius(100));
    expect(scoreToRadius(100)).toBeLessThanOrEqual(9);
    expect(scoreToRadius(0)).toBeGreaterThanOrEqual(1.2);
  });

  it('is non-linear: large grains are rare (half the range below 3.5 px)', () => {
    expect(scoreToRadius(60)).toBeLessThanOrEqual(3.5);
    expect(scoreToRadius(90) - scoreToRadius(80)).toBeGreaterThan(scoreToRadius(30) - scoreToRadius(20));
  });

  it('applies the user size multiplier and supports custom curves', () => {
    expect(scoreToRadius(50, 1.5)).toBeCloseTo(scoreToRadius(50) * 1.5, 6);
    const f = makeRadiusFn([
      [0, 1],
      [100, 2],
    ]);
    expect(f(50)).toBeCloseTo(1.5, 6);
  });
});
