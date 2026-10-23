import { hashString } from '../../shared/text';
import type { Analysis, NewsEvent, StreamEventMessage } from '../../shared/types';
import { analyzeArticle } from '../analysis/rules';
import type { Enricher } from '../analysis/llm';
import { ClusterIndex, decideUpdate } from '../clustering/cluster';
import { findRelations } from '../clustering/relations';
import type { Store } from '../persistence/store';
import type { NormalizedArticle } from '../types';

export interface IngestStats {
  received: number;
  created: number;
  updated: number;
  developments: number;
  duplicates: number;
  skippedOld: number;
}

/**
 * Turns normalized articles into consolidated events and emits stream changes.
 * Independent from any connector and from the browser simulation.
 */
export class Pipeline {
  readonly index = new ClusterIndex();
  /** Live events kept in memory for clustering and relation lookups. */
  private live = new Map<string, NewsEvent>();

  constructor(
    private store: Store,
    private opts: { retentionHours: number; enricher?: Enricher; emit: (m: StreamEventMessage) => void; now?: () => number },
  ) {}

  private now(): number {
    return this.opts.now ? this.opts.now() : Date.now();
  }

  /** Rebuild the in-memory index from persisted events after a restart. */
  warmUp(): void {
    const events = this.store.recentEvents(2000, new Date(this.now()).toISOString());
    for (const e of events.reverse()) {
      this.live.set(e.id, e);
      this.index.add(e, { title: e.title, hints: {}, language: e.language });
    }
  }

  liveEvents(): NewsEvent[] {
    return [...this.live.values()];
  }

  forget(ids: string[]): void {
    for (const id of ids) {
      this.live.delete(id);
      this.index.remove(id);
    }
  }

  async ingest(articles: NormalizedArticle[]): Promise<IngestStats> {
    const stats: IngestStats = { received: articles.length, created: 0, updated: 0, developments: 0, duplicates: 0, skippedOld: 0 };
    const now = this.now();
    const retentionMs = this.opts.retentionHours * 3_600_000;
    // Oldest first, so clusters form in publication order.
    const sorted = [...articles].sort((a, b) => Date.parse(a.publishedAt ?? a.fetchedAt) - Date.parse(b.publishedAt ?? b.fetchedAt));

    for (const art of sorted) {
      const known = this.store.getArticle(art.id);
      const revisionChanged = !!known && !!art.hints.revision && known.revision !== art.hints.revision;
      if (known && !revisionChanged) {
        stats.duplicates++;
        continue;
      }
      const when = Date.parse(art.occurredAt ?? art.publishedAt ?? art.fetchedAt);
      if (Number.isFinite(when) && now - when > retentionMs) {
        // Old news found late is not presented as a new happening.
        stats.skippedOld++;
        continue;
      }

      let analysis: Analysis = analyzeArticle(art);
      const needsHelp = art.sourceKind !== 'official' && (analysis.classificationConfidence < 0.5 || analysis.locations.length === 0);
      if (this.opts.enricher && needsHelp) analysis = await this.opts.enricher.enrich(art, analysis);

      const match = known ? { eventId: known.eventId, reason: 'event-key' as const } : this.index.find(art, analysis, now);
      const existing = match && (this.live.get(match.eventId) ?? this.store.getEvent(match.eventId));
      if (existing) {
        this.mergeInto(existing, art, analysis, revisionChanged, now, stats);
      } else {
        this.create(art, analysis, now);
        stats.created++;
      }
    }
    this.index.prune(now);
    return stats;
  }

  private create(art: NormalizedArticle, analysis: Analysis, now: number): NewsEvent {
    const nowIso = new Date(now).toISOString();
    const base = Date.parse(art.occurredAt ?? art.publishedAt ?? nowIso);
    const event: NewsEvent = {
      id: `ev_${hashString(art.hints.eventKey ?? art.canonicalUrl)}`,
      seq: this.store.nextSeq(),
      title: art.title,
      summary: art.summary,
      url: art.url,
      sourceName: art.sourceName,
      sourceUrl: art.sourceUrl,
      sourceKind: art.sourceKind,
      sourceReliability: art.sourceReliability,
      sourceCountry: art.sourceCountry,
      language: art.language,
      occurredAt: art.occurredAt,
      publishedAt: art.publishedAt,
      firstSeenAt: nowIso,
      updatedAt: nowIso,
      expiresAt: new Date(Math.min(base, now) + this.opts.retentionHours * 3_600_000).toISOString(),
      articleCount: 1,
      sources: [art.sourceName],
      analysis,
      verification: art.sourceKind === 'official' ? 'official' : 'single_source',
      relations: [],
      developments: [],
    };
    event.relations = findRelations(event, this.live.values());
    this.live.set(event.id, event);
    this.index.add(event, art);
    this.store.putEvent(event);
    this.store.putArticle(art, event.id);
    this.opts.emit({ change: 'new', event });
    // Link back from causes, so both grains can explain the relation.
    for (const r of event.relations) {
      const cause = this.live.get(r.eventId);
      if (!cause || cause.relations.some((x) => x.eventId === event.id)) continue;
      cause.relations = [...cause.relations, { ...r, eventId: event.id }].slice(-6);
      cause.seq = this.store.nextSeq();
      this.store.putEvent(cause);
      this.opts.emit({ change: 'update', event: cause });
    }
    return event;
  }

  private mergeInto(event: NewsEvent, art: NormalizedArticle, analysis: Analysis, revisionChanged: boolean, now: number, stats: IngestStats): void {
    const entry = this.index.get(event.id) ?? this.index.add(event, art);
    const decision = decideUpdate(entry, art, analysis, now, revisionChanged);
    this.index.absorb(event.id, art);
    const nowIso = new Date(now).toISOString();

    const newSource = !event.sources.includes(art.sourceName);
    event.articleCount += revisionChanged ? 0 : 1;
    if (newSource) event.sources = [...event.sources, art.sourceName].slice(0, 12);
    if (event.verification === 'single_source' && newSource) event.verification = 'corroborated';
    event.updatedAt = nowIso;

    // Keep the strongest evidence; official structured data always wins for the same record.
    const a = event.analysis;
    // A revised official record replaces the old one; a sibling official record (e.g. a second
    // warning for the same storm) only takes over when it is at least as severe.
    if (revisionChanged || (art.sourceKind === 'official' && analysis.severity >= a.severity)) {
      event.analysis = analysis;
      event.title = art.title;
      event.summary = art.summary ?? event.summary;
    } else {
      event.analysis = {
        ...a,
        severity: Math.max(a.severity, analysis.severity),
        urgency: Math.max(a.urgency, analysis.urgency),
        hazard: a.hazard || analysis.hazard,
        channels: mergeChannels(a, analysis),
        locations: a.locations.length ? a.locations : analysis.locations,
        categories: a.categories[0] === 'other' ? analysis.categories : a.categories,
        severityEvidence: [...new Set([...a.severityEvidence, ...analysis.severityEvidence])].slice(0, 6),
        classificationConfidence: Math.max(a.classificationConfidence, analysis.classificationConfidence),
      };
      if (!event.summary && art.summary) event.summary = art.summary;
    }

    let developmentId: string | undefined;
    if (decision.kind === 'development') {
      developmentId = `dv_${hashString(art.canonicalUrl + nowIso)}`;
      event.developments = [
        ...event.developments,
        { id: developmentId, at: nowIso, title: art.title, url: art.url, sourceName: art.sourceName, reason: decision.reason },
      ];
      stats.developments++;
    } else {
      stats.updated++;
    }
    event.seq = this.store.nextSeq();
    this.live.set(event.id, event);
    this.store.putEvent(event);
    this.store.putArticle(art, event.id);
    this.opts.emit({ change: decision.kind, event, developmentId });
  }
}

function mergeChannels(a: Analysis, b: Analysis) {
  const out = a.channels.map((c) => ({ ...c }));
  for (const c of b.channels) {
    const ex = out.find((x) => x.channel === c.channel);
    if (ex) ex.strength = Math.max(ex.strength, c.strength);
    else out.push(c);
  }
  return out.sort((x, y) => y.strength - x.strength);
}
