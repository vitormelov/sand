import { describe, expect, it } from 'vitest';
import { seenDotStyle } from '../../src/simulation/ParticleRenderer';

describe('seen dot', () => {
  it('stands out from its grain at every age, from fresh to almost faded', () => {
    for (let tone = 0; tone <= 1.0001; tone += 0.01) {
      const grain = Math.max(1, Math.round(tone * 24)) / 24; // share of ink in the grain
      const { ink, alpha } = seenDotStyle(tone);
      const dot = ink ? alpha + (1 - alpha) * grain : (1 - alpha) * grain; // share of ink in the dot
      expect(Math.abs(dot - grain)).toBeGreaterThanOrEqual(0.4);
    }
  });

  it('uses the background colour on strong grains and the ink colour on faded ones', () => {
    expect(seenDotStyle(1).ink).toBe(false);
    expect(seenDotStyle(0.1).ink).toBe(true);
  });
});
