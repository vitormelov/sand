import type { Analysis, NewsEvent, UserProfile } from '../shared/types';
import type { NormalizedArticle } from '../server/types';
import { hashString } from '../shared/text';

export const NOW = Date.parse('2026-10-23T21:10:00Z');

export const FORTALEZA: UserProfile = {
  location: { name: 'Fortaleza', admin1: 'CE', admin1Name: 'Ceará', countryCode: 'BR', countryName: 'Brasil', lat: -3.7, lon: -38.5 },
  interests: [],
  affinity: {},
};

export const PORTO_ALEGRE: UserProfile = {
  location: { name: 'Porto Alegre', admin1: 'RS', admin1Name: 'Rio Grande do Sul', countryCode: 'BR', countryName: 'Brasil', lat: -30, lon: -51.2 },
  interests: [],
  affinity: {},
};

export function analysis(over: Partial<Analysis> = {}): Analysis {
  return {
    categories: ['other'],
    channels: [],
    locations: [],
    affectedScope: 'local',
    severity: 0.15,
    severityEvidence: [],
    urgency: 0,
    hazard: false,
    entities: [],
    analyzer: 'rules',
    classificationConfidence: 0.6,
    ...over,
  };
}

let n = 0;
export function event(over: Partial<NewsEvent> = {}, now = NOW): NewsEvent {
  n++;
  const iso = new Date(now - 30 * 60_000).toISOString();
  return {
    id: `ev_t${n}`,
    seq: n,
    title: `Evento de teste ${n}`,
    url: `https://example.com/${n}`,
    sourceName: 'Teste',
    sourceKind: 'outlet',
    sourceReliability: 0.8,
    sourceCountry: 'BR',
    publishedAt: iso,
    firstSeenAt: iso,
    updatedAt: iso,
    expiresAt: new Date(now + 48 * 3_600_000).toISOString(),
    articleCount: 1,
    sources: ['Teste'],
    analysis: analysis(),
    verification: 'single_source',
    relations: [],
    developments: [],
    ...over,
  };
}

export function article(over: Partial<NormalizedArticle> & { title: string }, now = NOW): NormalizedArticle {
  const url = over.url ?? `https://news.example.com/${hashString(over.title)}`;
  return {
    id: hashString(url),
    canonicalUrl: url,
    url,
    sourceId: 'test',
    sourceName: 'Teste',
    sourceKind: 'outlet',
    sourceReliability: 0.8,
    sourceCountry: 'BR',
    language: 'pt',
    publishedAt: new Date(now - 10 * 60_000).toISOString(),
    fetchedAt: new Date(now).toISOString(),
    hints: {},
    ...over,
  };
}
