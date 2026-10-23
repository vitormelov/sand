import type { NewsEvent } from '../../shared/types';
import type { SandStore } from '../state/store';

/**
 * DEMO mode (?demo in the URL): fictitious events for visual testing only.
 * Every event has demo: true and a "[DEMO]" title; the UI shows a permanent
 * DEMO label. The real stream is not connected in this mode, so fictitious and
 * real events are never mixed.
 */
const PLACES = [
  { name: 'Fortaleza', level: 'city' as const, countryCode: 'BR', admin1: 'CE', lat: -3.73, lon: -38.53 },
  { name: 'Ceará', level: 'state' as const, countryCode: 'BR', admin1: 'CE' },
  { name: 'São Paulo', level: 'state' as const, countryCode: 'BR', admin1: 'SP' },
  { name: 'Brasil', level: 'country' as const, countryCode: 'BR' },
  { name: 'Japão', level: 'country' as const, countryCode: 'JP' },
  { name: 'Alemanha', level: 'country' as const, countryCode: 'DE' },
];
const TOPICS = [
  { t: 'Evento fictício de economia', ch: 'cost_of_living' as const, cat: 'economy' as const },
  { t: 'Evento fictício de clima', ch: 'natural_hazard' as const, cat: 'climate' as const },
  { t: 'Evento fictício de cultura', ch: null, cat: 'culture' as const },
  { t: 'Evento fictício de saúde', ch: 'public_health' as const, cat: 'health' as const },
  { t: 'Evento fictício de esportes', ch: null, cat: 'sports' as const },
  { t: 'Evento fictício de mobilidade', ch: 'mobility' as const, cat: 'mobility' as const },
];

let n = 0;
function makeEvent(now: number): NewsEvent {
  n++;
  const place = PLACES[Math.floor(Math.random() * PLACES.length)];
  const topic = TOPICS[Math.floor(Math.random() * TOPICS.length)];
  const severity = Math.round(Math.pow(Math.random(), 2.2) * 100) / 100;
  const iso = new Date(now).toISOString();
  return {
    id: `ev_demo${n}`,
    seq: n,
    title: `[DEMO] ${topic.t} #${n} — ${place.name}`,
    summary: 'Conteúdo fictício gerado localmente para demonstração visual. Não é uma notícia real.',
    url: 'https://example.com/',
    sourceName: 'DEMO',
    sourceKind: 'outlet',
    sourceReliability: 0.5,
    publishedAt: iso,
    firstSeenAt: iso,
    updatedAt: iso,
    expiresAt: new Date(now + 3_600_000).toISOString(),
    articleCount: 1,
    sources: ['DEMO'],
    analysis: {
      categories: [topic.cat],
      channels: topic.ch ? [{ channel: topic.ch, strength: 0.4 + Math.random() * 0.6, evidence: ['demo'] }] : [],
      locations: [{ ...place, confidence: 0.8, via: 'demo' }],
      affectedScope: Math.random() < 0.1 ? 'global' : 'local',
      severity,
      severityEvidence: [],
      urgency: Math.random() * 0.5,
      hazard: topic.ch === 'natural_hazard' && severity > 0.5,
      entities: [],
      analyzer: 'rules',
      classificationConfidence: 0.6,
    },
    verification: 'single_source',
    relations: [],
    developments: [],
    demo: true,
  };
}

export function startDemo(store: SandStore): () => void {
  const now = Date.now();
  const initial = Array.from({ length: 120 }, (_, i) => makeEvent(now - (120 - i) * 30_000));
  store.applySnapshot(initial, { sources: [], serverTime: new Date().toISOString(), eventCount: initial.length });
  let timer: ReturnType<typeof setTimeout>;
  const tick = () => {
    store.applyEvent({ change: 'new', event: makeEvent(Date.now()) });
    timer = setTimeout(tick, 1500 + Math.random() * 3500);
  };
  timer = setTimeout(tick, 2000);
  return () => clearTimeout(timer);
}
