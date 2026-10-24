import { describe, expect, it } from 'vitest';
import { BALLOON_MAX_W, seenDotStyle, wrapTitle } from '../../src/simulation/ParticleRenderer';

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

describe('falling title balloon', () => {
  // 6 px per character: easy to reason about.
  const measure = (s: string) => s.length * 6;

  it('keeps short titles on one line', () => {
    expect(wrapTitle(measure, 'Chuva forte em Fortaleza')).toEqual(['Chuva forte em Fortaleza']);
  });

  it('shows the whole title, wrapped to the balloon width, never cut', () => {
    const title = 'Copom reduz a taxa Selic para 13,75% ao ano e indica novos cortes nas próximas reuniões do comitê';
    const lines = wrapTitle(measure, title);
    expect(lines.length).toBeGreaterThan(2);
    for (const l of lines) expect(measure(l)).toBeLessThanOrEqual(BALLOON_MAX_W - 16);
    expect(lines.join(' ')).toBe(title);
    expect(lines.join('')).not.toContain('…');
  });

  it('splits a word wider than the balloon instead of cutting it', () => {
    const word = 'x'.repeat(100);
    expect(wrapTitle(measure, word).join('')).toBe(word);
  });
});
