import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { computeImpact } from '../../shared/impact/engine';
import { researchImpact, SCIENTIFIC_SHARE } from '../../shared/impact/research';
import { researchBucketId } from '../../shared/research';
import { isRedated, mapWork, rebuildAbstract, scientificWeight } from '../../server/research/openalex';
import { researchStatus } from '../../server/research/researchStore';
import { FORTALEZA } from '../helpers';

/** Three real OpenAlex works captured on 2026-10-31 (authorships trimmed). */
const works = (JSON.parse(readFileSync(new URL('../fixtures/openalex-works.json', import.meta.url), 'utf8')) as { results: any[] }).results;
const science = works.find((w) => w.id.endsWith('W4417175683'))!;
const NOW = Date.parse('2026-10-31T12:00:00Z');

describe('OpenAlex works → research grains', () => {
  it('puts abstracts back in order from the inverted index', () => {
    expect(rebuildAbstract({ world: [1], hello: [0], again: [2, 4], and: [3] })).toBe('hello world again and again');
    expect(rebuildAbstract(null)).toBe('');
  });

  it('drops old papers re-dated to this month, keeps a new paper cited as a preprint last year', () => {
    expect(works.filter(isRedated).map((w) => w.id.split('/').pop())).toEqual(['W2471708756', 'W2466828890']);
    expect(isRedated(science)).toBe(false);
  });

  it('weighs journal impact and citations on a log scale', () => {
    expect(scientificWeight(0, undefined, undefined)).toBeLessThan(0.2);
    expect(scientificWeight(27, 41, 21.9)).toBe(1);
    expect(scientificWeight(3, undefined, 2)).toBeGreaterThan(scientificWeight(0, undefined, 2));
  });

  it('maps a work to an event the browser can show like a news item', () => {
    const e = mapWork(science, new Map([['S3880285', 21.9]]), NOW)!;
    expect(e.id).toBe('ev_w4417175683');
    expect(e.url).toBe('https://doi.org/10.1126/science.aeh7930');
    expect(e.sourceName).toBe('Science');
    expect(e.sourceKind).toBe('journal');
    expect(e.publishedAt).toBe('2026-10-22T12:00:00.000Z');
    expect(Date.parse(e.expiresAt) - Date.parse(e.publishedAt!)).toBe(30 * 86_400_000);
    expect(e.summary!.length).toBeLessThanOrEqual(420);
    expect(e.analysis.categories[0]).toBe('health');
    expect(e.analysis.hazard).toBe(false);
    expect(e.analysis.locations[0]).toMatchObject({ level: 'country', countryCode: 'US' });
    expect(e.research).toMatchObject({ provider: 'OpenAlex', workId: 'W4417175683', citations: 27, journalImpact: 21.9, weight: 1, field: 'Medicina' });
    expect(researchBucketId(e)).toBe('d-20261022');
  });

  it('rejects works without a usable title, link or date', () => {
    expect(mapWork({ ...science, title: '' }, new Map(), NOW)).toBeUndefined();
    expect(mapWork({ ...science, publication_date: undefined }, new Map(), NOW)).toBeUndefined();
  });
});

describe('research grain size', () => {
  it('mixes personal relevance with scientific weight', () => {
    const e = mapWork(science, new Map([['S3880285', 21.9]]), NOW)!;
    const personal = computeImpact(e, FORTALEZA, NOW).score;
    const strong = researchImpact(e, FORTALEZA, NOW);
    const weak = researchImpact({ ...e, research: { ...e.research!, weight: 0 } }, FORTALEZA, NOW);
    expect(strong.score).toBe(Math.round((1 - SCIENTIFIC_SHARE) * personal + SCIENTIFIC_SHARE * 100));
    expect(weak.score).toBe(Math.round((1 - SCIENTIFIC_SHARE) * personal));
    expect(strong.rules[0]).toMatch(/relevância para você/);
    expect(strong.rules[1]).toMatch(/peso científico: 100\/100/);
    expect(strong.urgent).toBe(false);
  });
});

describe('research status', () => {
  it('reports OpenAlex as down (keeping the last success) when a pass brings nothing', () => {
    const ok = researchStatus({ events: [{} as never], requests: 27, failedFields: [] }, undefined, NOW);
    expect(ok).toMatchObject({ id: 'openalex', health: 'ok', group: 'research', itemsLastFetch: 1 });
    const down = researchStatus({ events: [], requests: 3, failedFields: [11, 12, 13], lastError: 'HTTP 429' }, ok, NOW + 1000);
    expect(down).toMatchObject({ health: 'down', lastSuccessAt: ok.lastSuccessAt, lastError: 'HTTP 429' });
  });
});
