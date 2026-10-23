import { contentTokens, hashString, haversineKm, jaccard, normalizeForMatch } from '../../shared/text';
import type { Analysis, NewsEvent } from '../../shared/types';
import type { NormalizedArticle } from '../types';
import { casualtyCount } from '../analysis/rules';

/**
 * Grouping of articles that describe the same happening.
 *
 * Deliberately conservative: two stories are merged only when they share a
 * source-provided identity, an identical headline, a hazard footprint (type +
 * place + time), or a large fraction of their headline vocabulary. Sharing a
 * single company/country/person name is never enough.
 */

export interface ClusterIndexEntry {
  eventId: string;
  tokens: Set<string>;
  titleHashes: Set<string>;
  eventKeys: Set<string>;
  hazardType?: string;
  areaKeys?: Set<string>;
  lat?: number;
  lon?: number;
  /** ms */
  firstSeen: number;
  lastDevelopment: number;
  developments: number;
  maxDead: number;
  severity: number;
  language?: string;
}

export const CLUSTER_WINDOW_MS = 36 * 3_600_000;
const HAZARD_WINDOW_MS = 6 * 3_600_000;
const HAZARD_RADIUS_KM = 150;
const JACCARD_STRONG = 0.5;
const JACCARD_WEAK = 0.34;
const MIN_SHARED_WEAK = 4;
/** Share of the shorter headline's words found in the other one. */
const OVERLAP_STRONG = 0.7;
const MIN_SHARED_OVERLAP = 3;

export function titleHash(title: string): string {
  return hashString(normalizeForMatch(title));
}

function pointOf(a: Analysis): { lat: number; lon: number } | undefined {
  const p = a.locations.find((l) => l.via === 'official-feed' && l.lat != null && l.lon != null);
  return p ? { lat: p.lat!, lon: p.lon! } : undefined;
}

export type MatchReason = 'event-key' | 'same-headline' | 'hazard-footprint' | 'headline-similarity';

export class ClusterIndex {
  private entries = new Map<string, ClusterIndexEntry>();

  get size(): number {
    return this.entries.size;
  }

  add(event: NewsEvent, article: Pick<NormalizedArticle, 'title' | 'hints' | 'language'>): ClusterIndexEntry {
    const pt = pointOf(event.analysis);
    const entry: ClusterIndexEntry = {
      eventId: event.id,
      tokens: new Set(contentTokens(event.title)),
      titleHashes: new Set([titleHash(event.title)]),
      eventKeys: new Set(article.hints.eventKey ? [article.hints.eventKey] : []),
      hazardType: article.hints.hazardType,
      areaKeys: article.hints.areaKeys?.length ? new Set(article.hints.areaKeys) : undefined,
      lat: pt?.lat,
      lon: pt?.lon,
      firstSeen: Date.parse(event.firstSeenAt),
      lastDevelopment: Date.parse(event.firstSeenAt),
      developments: event.developments.length,
      maxDead: casualtyCount(`${event.title}. ${event.summary ?? ''}`).dead,
      severity: event.analysis.severity,
      language: article.language,
    };
    this.entries.set(event.id, entry);
    return entry;
  }

  get(eventId: string): ClusterIndexEntry | undefined {
    return this.entries.get(eventId);
  }

  /** Attach another article's identity to an existing entry. */
  absorb(eventId: string, article: Pick<NormalizedArticle, 'title' | 'hints'>): void {
    const e = this.entries.get(eventId);
    if (!e) return;
    e.titleHashes.add(titleHash(article.title));
    if (article.hints.eventKey) e.eventKeys.add(article.hints.eventKey);
  }

  remove(eventId: string): void {
    this.entries.delete(eventId);
  }

  prune(now: number): void {
    for (const [id, e] of this.entries) if (now - e.firstSeen > CLUSTER_WINDOW_MS * 2) this.entries.delete(id);
  }

  find(article: Pick<NormalizedArticle, 'title' | 'hints' | 'language'>, analysis: Analysis, now: number): { eventId: string; reason: MatchReason } | null {
    const key = article.hints.eventKey;
    const th = titleHash(article.title);
    const pt = pointOf(analysis);
    const toks = new Set(contentTokens(article.title));
    let best: { eventId: string; score: number } | null = null;

    for (const e of this.entries.values()) {
      if (key && e.eventKeys.has(key)) return { eventId: e.eventId, reason: 'event-key' };
      if (e.titleHashes.has(th)) return { eventId: e.eventId, reason: 'same-headline' };
      const age = now - e.firstSeen;
      if (
        article.hints.hazardType &&
        e.hazardType &&
        sameHazard(article.hints.hazardType, e.hazardType) &&
        pt && e.lat != null && e.lon != null &&
        age < HAZARD_WINDOW_MS &&
        haversineKm(pt.lat, pt.lon, e.lat, e.lon) < HAZARD_RADIUS_KM
      ) {
        return { eventId: e.eventId, reason: 'hazard-footprint' };
      }
      // Area-based warnings (no single point): same hazard type over largely the same areas.
      if (
        article.hints.hazardType &&
        article.hints.hazardType === e.hazardType &&
        article.hints.areaKeys?.length &&
        e.areaKeys &&
        age < 24 * 3_600_000 &&
        jaccard(new Set(article.hints.areaKeys), e.areaKeys) >= 0.6
      ) {
        return { eventId: e.eventId, reason: 'hazard-footprint' };
      }
      if (age > CLUSTER_WINDOW_MS || toks.size < 3) continue;
      // Structured official records with their own identity are never merged by wording.
      if (key && e.eventKeys.size > 0) continue;
      const j = jaccard(toks, e.tokens);
      let shared = 0;
      for (const t of toks) if (e.tokens.has(t)) shared++;
      const overlap = shared / Math.min(toks.size, e.tokens.size);
      const ok =
        j >= JACCARD_STRONG ||
        (j >= JACCARD_WEAK && shared >= MIN_SHARED_WEAK) ||
        (overlap >= OVERLAP_STRONG && shared >= MIN_SHARED_OVERLAP);
      if (ok && (!best || j > best.score)) best = { eventId: e.eventId, score: j };
    }
    return best ? { eventId: best.eventId, reason: 'headline-similarity' } : null;
  }
}

function sameHazard(a: string, b: string): boolean {
  const norm = (s: string) => (s.startsWith('INMET-') ? s : s.toUpperCase().slice(0, 2));
  return norm(a) === norm(b);
}

export interface UpdateDecision {
  kind: 'update' | 'development';
  reason: string;
}

const DEV_MIN_INTERVAL_MS = 2 * 3_600_000;
const DEV_MAX = 5;

/**
 * Should a newly merged article produce a new (smaller) grain?
 * Only for material changes: higher casualty figures, a jump in severity
 * or an official revision that raised the alert level.
 */
export function decideUpdate(entry: ClusterIndexEntry, article: NormalizedArticle, analysis: Analysis, now: number, revisionChanged: boolean): UpdateDecision {
  const dead = casualtyCount(`${article.title}. ${article.summary ?? ''}`).dead;
  const canDevelop = entry.developments < DEV_MAX && now - entry.lastDevelopment >= DEV_MIN_INTERVAL_MS;
  let reason: string | undefined;
  if (dead > entry.maxDead && dead >= Math.max(entry.maxDead * 1.5, entry.maxDead + 3)) {
    reason = `número de mortes relatadas subiu de ${entry.maxDead} para ${dead}`;
  } else if (analysis.severity - entry.severity >= 0.15) {
    reason = 'gravidade aumentou de forma relevante';
  } else if (revisionChanged && analysis.severity > entry.severity) {
    reason = 'fonte oficial elevou o nível de alerta';
  }
  entry.maxDead = Math.max(entry.maxDead, dead);
  if (reason && canDevelop) {
    entry.developments++;
    entry.lastDevelopment = now;
    entry.severity = Math.max(entry.severity, analysis.severity);
    return { kind: 'development', reason };
  }
  entry.severity = Math.max(entry.severity, analysis.severity);
  return { kind: 'update', reason: reason ?? 'nova cobertura do mesmo acontecimento' };
}
