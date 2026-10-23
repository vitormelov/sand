import { describe, expect, it } from 'vitest';
import { computeImpact, proximityTo } from '../../shared/impact/engine';
import { IMPACT_WEIGHTS, RULES } from '../../shared/impact/config';
import { analyzeArticle } from '../../server/analysis/rules';
import { FORTALEZA, NOW, PORTO_ALEGRE, analysis, article, event } from '../helpers';

const fresh = (over: Parameters<typeof event>[0]) => event(over, NOW);
const score = (e: ReturnType<typeof event>, p = FORTALEZA) => computeImpact(e, p, NOW);
/** Real article text through the real rules analyzer. */
const fromText = (title: string, summary?: string, over: Partial<Parameters<typeof article>[0]> = {}) => {
  const a = article({ title, summary, ...over });
  return fresh({ title, summary, analysis: analyzeArticle(a), sourceKind: a.sourceKind, sourceReliability: a.sourceReliability, sourceCountry: a.sourceCountry });
};

describe('Personal Impact Engine', () => {
  it('weights are configured in one place and sum to 1', () => {
    const sum = Object.values(IMPACT_WEIGHTS).reduce((s, x) => s + x, 0);
    expect(sum).toBeCloseTo(1, 6);
  });

  it('always returns a score within 0..100 and confidence within 0..1', () => {
    for (const sev of [0, 0.5, 1]) {
      const r = score(fresh({ analysis: analysis({ severity: sev, hazard: true, channels: [{ channel: 'natural_hazard', strength: 1, evidence: [] }], locations: [{ name: 'Fortaleza', level: 'city', countryCode: 'BR', admin1: 'CE', lat: -3.73, lon: -38.53, confidence: 1, via: 'x' }] }) }));
      expect(r.score).toBeGreaterThanOrEqual(0);
      expect(r.score).toBeLessThanOrEqual(100);
      expect(r.confidence).toBeGreaterThanOrEqual(0);
      expect(r.confidence).toBeLessThanOrEqual(1);
    }
  });

  it('a low-impact local story does not automatically become a large grain', () => {
    const e = fromText('Festival de quadrilhas anima bairro de Fortaleza neste fim de semana', 'Evento cultural reúne grupos juninos e artistas locais.');
    const r = score(e);
    expect(r.score).toBeLessThan(40);
  });

  it('a global oil shock is relevant in Fortaleza even without mentioning the city', () => {
    const e = fromText('Oil prices jump to five-month high as attacks threaten global supply', 'Brent crude rose sharply as the Strait of Hormuz shipping was disrupted.', { sourceCountry: 'GB', language: 'en' });
    const r = score(e);
    expect(e.analysis.affectedScope).toBe('global');
    expect(r.score).toBeGreaterThanOrEqual(45);
    // and clearly bigger than an unrelated foreign story
    const other = fromText('Museu em Paris reabre ala de pinturas renascentistas', undefined, { sourceCountry: 'FR' });
    expect(r.score).toBeGreaterThan(score(other).score + 15);
  });

  it('the same event scores higher the closer it is to the user', () => {
    const at = (loc: Parameters<typeof proximityTo>[1]) =>
      score(fresh({ analysis: analysis({ severity: 0.6, hazard: true, channels: [{ channel: 'natural_hazard', strength: 1, evidence: [] }], locations: [loc] }) })).score;
    const city = at({ name: 'Fortaleza', level: 'city', countryCode: 'BR', admin1: 'CE', lat: -3.73, lon: -38.53, confidence: 0.9, via: 't' });
    const state = at({ name: 'Ceará', level: 'state', countryCode: 'BR', admin1: 'CE', confidence: 0.9, via: 't' });
    const country = at({ name: 'Paraná', level: 'state', countryCode: 'BR', admin1: 'PR', confidence: 0.9, via: 't' });
    const abroad = at({ name: 'Japão', level: 'country', countryCode: 'JP', regions: ['east_asia'], confidence: 0.9, via: 't' });
    expect(city).toBeGreaterThan(state);
    expect(state).toBeGreaterThan(country);
    expect(country).toBeGreaterThan(abroad);
  });

  it('is not purely distance-based: a far systemic event can outweigh a near trivial one', () => {
    const near = fromText('Prefeitura de Fortaleza inaugura nova praça no bairro Meireles');
    const far = fromText('Banco Central eleva a taxa Selic para 15% ao ano', 'Copom decide alta dos juros em todo o país.');
    expect(score(far).score).toBeGreaterThan(score(near).score);
  });

  it('applies the emergency rule for an immediate nearby hazard and flags it urgent', () => {
    const e = fresh({
      analysis: analysis({
        severity: 0.85,
        hazard: true,
        urgency: 0.9,
        channels: [{ channel: 'natural_hazard', strength: 1, evidence: ['enchente'] }],
        locations: [{ name: 'Fortaleza', level: 'city', countryCode: 'BR', admin1: 'CE', lat: -3.73, lon: -38.53, confidence: 0.9, via: 't' }],
      }),
      sourceKind: 'official',
      verification: 'official',
    });
    const r = score(e);
    expect(r.urgent).toBe(true);
    expect(r.score).toBeGreaterThanOrEqual(RULES.emergency.floorBase);
    expect(r.rules.join(' ')).toMatch(/emergência/);
    // The same warning seen from another state is not an emergency.
    const far = score(e, PORTO_ALEGRE);
    expect(far.urgent).toBe(false);
    expect(far.score).toBeLessThan(r.score - 20);
  });

  it('keeps impact and confidence separate: higher confidence does not inflate the score', () => {
    const base = analysis({ severity: 0.4, channels: [{ channel: 'cost_of_living', strength: 0.8, evidence: [] }], locations: [{ name: 'Brasil', level: 'country', countryCode: 'BR', confidence: 0.7, via: 't' }], affectedScope: 'national' });
    const lowConf = score(fresh({ analysis: { ...base, classificationConfidence: 0.2 }, sourceReliability: 0.3 }));
    const highConf = score(fresh({ analysis: { ...base, classificationConfidence: 0.95 }, sourceReliability: 0.95, articleCount: 4, verification: 'corroborated' }));
    expect(highConf.confidence).toBeGreaterThan(lowConf.confidence);
    expect(highConf.score).toBe(lowConf.score);
  });

  it('caps extreme scores when evidence is thin', () => {
    const e = fresh({
      sourceReliability: 0.2,
      analysis: analysis({ severity: 1, urgency: 1, classificationConfidence: 0.1, affectedScope: 'global', channels: [{ channel: 'energy_fuel', strength: 1, evidence: [] }] }),
    });
    const r = score(e);
    expect(r.confidence).toBeLessThan(RULES.lowConfidence.maxConfidence);
    expect(r.score).toBeLessThanOrEqual(RULES.lowConfidence.cap);
  });

  it('keeps soft news (sports/culture without consequences) small', () => {
    const e = fromText('Flamengo vence o Palmeiras e assume a liderança do Brasileirão', 'Gols no segundo tempo decidiram a partida no Maracanã.');
    expect(e.analysis.categories[0]).toBe('sports');
    expect(score(e).score).toBeLessThanOrEqual(RULES.softNews.cap);
  });

  it('interests refine but never hide high-impact events', () => {
    const e = fromText('Banco Central eleva a taxa Selic para 15% ao ano', 'Copom decide alta dos juros em todo o país.');
    const sportsFan = { ...FORTALEZA, interests: ['sports' as const] };
    const economyFan = { ...FORTALEZA, interests: ['economy' as const] };
    const unmatched = score(e, sportsFan).score;
    expect(score(e, economyFan).score).toBeGreaterThan(unmatched);
    expect(unmatched).toBeGreaterThanOrEqual(40);
  });

  it('feedback affinity is bounded', () => {
    const e = fromText('Banco Central eleva a taxa Selic para 15% ao ano');
    const a = score(e, { ...FORTALEZA, affinity: { economy: 999 } as never }).score;
    const b = score(e).score;
    expect(a - b).toBeLessThanOrEqual(10);
  });

  it('handles missing metadata without inventing location or extreme values', () => {
    const e = fresh({ title: 'Texto curto', publishedAt: undefined, summary: undefined, analysis: analysis({ categories: ['other'] }) });
    const r = score(e, { interests: [], affinity: {} });
    expect(r.score).toBeLessThan(40);
    expect(r.proximityLabel).toMatch(/não identificado|sem localização/);
  });

  it('detects the user’s own city in the text even if the server analysis missed it', () => {
    const e = fresh({ title: 'Obras interditam avenida em Itapipoca a partir de segunda', analysis: analysis({ channels: [{ channel: 'mobility', strength: 0.7, evidence: [] }] }) });
    const itapipoca = { ...FORTALEZA, location: { ...FORTALEZA.location!, name: 'Itapipoca', lat: -3.5, lon: -39.6 } };
    expect(score(e, itapipoca).score).toBeGreaterThan(score(e).score);
  });

  it('explains itself and lists the factors', () => {
    const r = score(fromText('Banco Central eleva a taxa Selic para 15% ao ano'));
    expect(r.factors.map((f) => f.key)).toEqual(['practical', 'exposure', 'severity', 'interest', 'urgency']);
    expect(r.explanation).toMatch(/confiança/);
  });
});
