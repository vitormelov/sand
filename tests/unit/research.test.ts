import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { researchImpact, researchVisible, SCIENTIFIC_SHARE } from '../../shared/impact/research';
import { sanitizeProfile } from '../../shared/profile';
import { researchBucketId, themeOf, type ResearchPrefs } from '../../shared/research';
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
    expect(e.research).toMatchObject({ provider: 'OpenAlex', workId: 'W4417175683', citations: 27, journalImpact: 21.9, weight: 1, field: 'Medicina', fieldId: 27, type: 'article' });
    expect(researchBucketId(e)).toBe('d-20261022');
  });

  it('rejects works without a usable title, link or date', () => {
    expect(mapWork({ ...science, title: '' }, new Map(), NOW)).toBeUndefined();
    expect(mapWork({ ...science, publication_date: undefined }, new Map(), NOW)).toBeUndefined();
  });
});

describe('research grain size and filters (questionnaire answers)', () => {
  const paper = mapWork(science, new Map([['S3880285', 21.9]]), NOW)!; // Science, US authors, English, health
  const withPrefs = (research: ResearchPrefs) => ({ ...FORTALEZA, research });

  it('mixes the personal part with the scientific weight, in the chosen proportion', () => {
    const balanced = researchImpact(paper, withPrefs({}), NOW);
    const personal = balanced.factors.filter((f) => f.key !== 'severity').reduce((x, f) => x + f.points, 0);
    expect(balanced.score).toBe(Math.round(personal + SCIENTIFIC_SHARE * 100));
    expect(balanced.rules[0]).toMatch(/60% o quanto tem a ver com você, 40% peso científico/);
    const science = researchImpact(paper, withPrefs({ sizeBasis: 'science' }), NOW);
    const mine = researchImpact(paper, withPrefs({ sizeBasis: 'personal' }), NOW);
    expect(science.score).toBeGreaterThan(mine.score); // a top paper, little to do with this person
    expect(balanced.urgent).toBe(false);
  });

  it('grows with the theme, the countries and the language the person chose', () => {
    const base = researchImpact(paper, withPrefs({ countries: ['BR'], languages: ['pt'] }), NOW).score;
    expect(researchImpact(paper, withPrefs({ countries: ['BR'], languages: ['pt'], themes: { health: 2 } }), NOW).score).toBeGreaterThan(base);
    expect(researchImpact(paper, withPrefs({ countries: ['US'], languages: ['pt'] }), NOW).score).toBeGreaterThan(base);
    expect(researchImpact(paper, withPrefs({ countries: ['BR'], languages: ['en'] }), NOW).score).toBeGreaterThan(base);
    expect(researchImpact(paper, withPrefs({ countries: ['BR'], languages: ['pt'], themes: { health: -1 } }), NOW).score).toBeLessThan(base);
  });

  it('without chosen countries, research from the country you live in counts as yours', () => {
    const brazilian = { ...paper, research: { ...paper.research!, countries: ['BR'] } };
    expect(researchImpact(brazilian, withPrefs({}), NOW).score).toBeGreaterThan(researchImpact(paper, withPrefs({}), NOW).score);
  });

  it('"não quero" and "só esses" take grains out; "dar preferência" never does', () => {
    expect(researchVisible(paper, withPrefs({ themes: { health: -2 } }))).toBe(false);
    expect(researchVisible(paper, withPrefs({ countries: ['BR'], countryMode: 'only' }))).toBe(false);
    expect(researchVisible(paper, withPrefs({ countries: ['BR', 'US'], countryMode: 'only' }))).toBe(true);
    expect(researchVisible(paper, withPrefs({ languages: ['pt'], languageMode: 'only' }))).toBe(false);
    expect(researchVisible(paper, withPrefs({ countries: ['BR'], countryMode: 'prefer', languages: ['pt'] }))).toBe(true);
    expect(researchVisible({ ...paper, research: { ...paper.research!, openAccess: false } }, withPrefs({ openAccess: 'only' }))).toBe(false);
  });

  it('maps fields to themes, also for works stored with only the field name', () => {
    expect(themeOf({ fieldId: 17 })).toBe('computing');
    expect(themeOf({ field: 'Medicina' })).toBe('health');
    expect(themeOf(undefined)).toBeUndefined();
  });

  it('keeps only valid answers when reading a stored profile', () => {
    const p = sanitizeProfile({ research: { onboarded: true, themes: { health: 2, nope: 1, mind: 9 }, countries: ['BR', 'xx', 'US'], languages: ['pt', 'PT'], sizeBasis: 'huge', openAccess: 'only', likesReviews: true } });
    expect(p.research).toEqual({ onboarded: true, themes: { health: 2 }, countries: ['BR', 'US'], languages: ['pt'], countryMode: undefined, languageMode: undefined, sizeBasis: undefined, openAccess: 'only', likesReviews: true });
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
