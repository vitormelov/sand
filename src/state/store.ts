import { useSyncExternalStore } from 'react';
import { IMPACT_BANDS } from '../../shared/impact/config';
import { computeImpact, type ImpactResult } from '../../shared/impact/engine';
import type { Category, NewsEvent, StreamEventMessage, StreamStatus, UserProfile } from '../../shared/types';

export type Connection = 'connecting' | 'open' | 'reconnecting' | 'offline';

export interface SpawnSink {
  enqueue(
    req: { eventId: string; developmentId?: string; impact: number; critical: boolean; x?: number; newsAt?: number; fadeAt?: number },
    backlog?: boolean,
  ): void;
  updateImpact(eventId: string, impact: number, critical: boolean): void;
  forgetEvent(eventId: string): void;
  /** The time window changed: a grain already poured now fades out at `fadeAt`. */
  retime?(eventId: string, developmentId: string | undefined, fadeAt: number): void;
}

/** How far back the user can choose to see news (hours). */
export const MIN_WINDOW_HOURS = 12;
export const MAX_WINDOW_HOURS = 48;
const HOUR = 3_600_000;

export interface UiState {
  version: number;
  connection: Connection;
  status?: StreamStatus;
  snapshotLoaded: boolean;
  /** Events that arrived live during this session (not the initial snapshot). */
  sessionCount: number;
  lastReceivedAt?: string;
  demo: boolean;
}

/**
 * Event data + per-user impact, decoupled from React and from the canvas.
 * React subscribes to coarse changes; the simulation is fed through a sink.
 */
export class SandStore {
  /** Events shown to this user (every known event minus those from switched-off sources). */
  readonly events = new Map<string, NewsEvent>();
  private all = new Map<string, NewsEvent>();
  private hiddenSources = new Set<string>();
  /** Categories the user chose not to see (by the news' main category). */
  private hiddenCategories = new Set<Category>();
  /** Only news from the last `windowMs` is shown (user-chosen, 12–48 h). */
  private windowMs = MAX_WINDOW_HOURS * HOUR;
  /** Source name → id, for events stored before they carried `sourceIds`. */
  private sourceIdByName = new Map<string, string>();
  readonly impacts = new Map<string, ImpactResult>();
  private listeners = new Set<() => void>();
  private state: UiState;
  private sink?: SpawnSink;
  private notifyScheduled = false;

  constructor(
    private profile: UserProfile,
    demo = false,
  ) {
    this.state = { version: 0, connection: demo ? 'open' : 'connecting', snapshotLoaded: false, sessionCount: 0, demo };
  }

  // --- subscription -------------------------------------------------------
  subscribe = (fn: () => void) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };
  getState = () => this.state;

  private set(patch: Partial<UiState>): void {
    this.state = { ...this.state, ...patch, version: this.state.version + 1 };
    if (this.notifyScheduled) return;
    this.notifyScheduled = true;
    // Coalesce bursts (a snapshot of hundreds of events = one React update).
    queueMicrotask(() => {
      this.notifyScheduled = false;
      for (const l of this.listeners) l();
    });
  }

  /** A (new) simulation attached: hydrate it with every known event, oldest first. */
  attachSink(sink: SpawnSink | undefined): void {
    this.sink = sink;
    if (!sink) return;
    this.pour([...this.events.values()]);
  }

  private spawn(...args: Parameters<SpawnSink['enqueue']>): void {
    this.sink?.enqueue(...args);
  }

  /**
   * Queue the grains of many events at once (snapshot, new sink, source switched back on).
   * Every grain — events and their developments — is ordered by when its news happened,
   * oldest first, so the first fall builds the bed with old news below and new on top.
   */
  private pour(events: NewsEvent[]): void {
    const reqs: Parameters<SpawnSink['enqueue']>[0][] = [];
    for (const e of events) {
      const r = this.impacts.get(e.id) ?? this.score(e);
      reqs.push({ eventId: e.id, impact: r.score, critical: isCritical(r), ...timing(e, undefined, this.windowMs) });
      for (const d of e.developments) reqs.push({ eventId: e.id, developmentId: d.id, impact: r.score, critical: false, ...timing(e, d.at, this.windowMs) });
    }
    reqs.sort((a, b) => (a.newsAt ?? 0) - (b.newsAt ?? 0));
    for (const req of reqs) this.spawn(req, true);
  }

  // --- source, category and time filter ---------------------------------------------
  /**
   * Hidden when it is older than the time window, its main category is switched off,
   * or every source that covered it is switched off.
   */
  isHidden(e: NewsEvent): boolean {
    if (!this.inWindow(e)) return true;
    if (this.hiddenCategories.has(mainCategory(e))) return true;
    if (!this.hiddenSources.size) return false;
    const ids = e.sourceIds?.length ? e.sourceIds : e.sources.map((n) => this.sourceIdByName.get(n)).filter((x): x is string => !!x);
    return ids.length > 0 && ids.every((id) => this.hiddenSources.has(id));
  }

  setHiddenSources(ids: Iterable<string>): void {
    const next = new Set(ids);
    if (next.size === this.hiddenSources.size && [...next].every((id) => this.hiddenSources.has(id))) return;
    this.hiddenSources = next;
    this.refilter();
  }

  setHiddenCategories(cats: Iterable<Category>): void {
    const next = new Set(cats);
    if (next.size === this.hiddenCategories.size && [...next].every((c) => this.hiddenCategories.has(c))) return;
    this.hiddenCategories = next;
    this.refilter();
  }

  /** At least one of its grains (the news or a development) is newer than the window. */
  private inWindow(e: NewsEvent, now = Date.now()): boolean {
    // The full window is the server's retention: it expires events itself, as before.
    if (this.windowMs >= MAX_WINDOW_HOURS * HOUR) return true;
    if (timing(e, undefined, this.windowMs).fadeAt > now) return true;
    return e.developments.some((d) => timing(e, d.at, this.windowMs).fadeAt > now);
  }

  getWindowHours(): number {
    return this.windowMs / HOUR;
  }

  /** Show only news from the last `hours` (12–48). Older grains leave; grains back in range pour again. */
  setWindowHours(hours: number): void {
    const ms = Math.min(MAX_WINDOW_HOURS, Math.max(MIN_WINDOW_HOURS, hours)) * HOUR;
    if (ms === this.windowMs) return;
    this.windowMs = ms;
    // Grains that stay keep their place and only change how fast they fade.
    for (const e of this.events.values()) {
      if (this.isHidden(e)) continue;
      this.sink?.retime?.(e.id, undefined, timing(e, undefined, ms).fadeAt);
      for (const d of e.developments) this.sink?.retime?.(e.id, d.id, timing(e, d.at, ms).fadeAt);
    }
    this.refilter();
  }

  /** News that just aged out of the window leaves the list (its grain has already faded). */
  pruneWindow(): void {
    if ([...this.events.values()].some((e) => !this.inWindow(e))) this.refilter();
  }

  private refilter(): void {
    const back: NewsEvent[] = [];
    for (const e of this.all.values()) {
      const shown = this.events.has(e.id);
      if (this.isHidden(e)) {
        if (shown) {
          this.events.delete(e.id);
          this.sink?.forgetEvent(e.id);
        }
      } else if (!shown) {
        this.events.set(e.id, e);
        back.push(e);
      }
    }
    this.pour(back);
    this.set({});
  }

  private learnSources(status: StreamStatus): void {
    for (const s of status.sources) this.sourceIdByName.set(s.name, s.id);
  }

  // --- impact ---------------------------------------------------------------
  private score(e: NewsEvent): ImpactResult {
    const r = computeImpact(e, this.profile);
    this.impacts.set(e.id, r);
    return r;
  }

  setProfile(profile: UserProfile): void {
    this.profile = profile;
    for (const e of this.all.values()) {
      const r = this.score(e);
      this.sink?.updateImpact(e.id, r.score, r.urgent || r.band === 'critical');
    }
    this.set({});
  }

  getProfile(): UserProfile {
    return this.profile;
  }

  /** Feedback-learned bias: affects estimates computed from now on only. */
  setAffinity(affinity: UserProfile['affinity']): void {
    this.profile = { ...this.profile, affinity };
  }

  // --- stream input -----------------------------------------------------------
  setConnection(connection: Connection): void {
    if (connection !== this.state.connection) this.set({ connection });
  }

  applySnapshot(events: NewsEvent[], status: StreamStatus): void {
    // Oldest first, so the newest grains land on top of the bed.
    this.learnSources(status);
    const fresh: NewsEvent[] = [];
    for (const e of events) {
      this.all.set(e.id, e);
      this.score(e);
      if (this.isHidden(e)) continue;
      if (!this.events.has(e.id)) fresh.push(e);
      this.events.set(e.id, e);
    }
    this.pour(fresh);
    this.set({ status, snapshotLoaded: true, connection: 'open' });
  }

  applyEvent(msg: StreamEventMessage): void {
    const e = msg.event;
    this.all.set(e.id, e);
    const r = this.score(e);
    if (this.isHidden(e)) {
      if (this.events.delete(e.id)) this.sink?.forgetEvent(e.id);
      this.set({});
      return;
    }
    const known = this.events.has(e.id);
    this.events.set(e.id, e);
    const now = new Date().toISOString();
    if (!known) {
      this.spawn({ eventId: e.id, impact: r.score, critical: isCritical(r), ...timing(e, undefined, this.windowMs) });
      this.set({ sessionCount: this.state.sessionCount + 1, lastReceivedAt: now });
      return;
    }
    this.sink?.updateImpact(e.id, r.score, isCritical(r));
    if (msg.change === 'development' && msg.developmentId) {
      this.spawn({ eventId: e.id, developmentId: msg.developmentId, impact: r.score, critical: false, ...timing(e, e.developments.find((d) => d.id === msg.developmentId)?.at, this.windowMs) });
      this.set({ sessionCount: this.state.sessionCount + 1, lastReceivedAt: now });
      return;
    }
    this.set({});
  }

  /**
   * Lab only: add a fictitious (demo) event. With `forcedScore` the engine's
   * estimate is replaced, and the panel says so explicitly.
   */
  injectLab(e: NewsEvent, opts: { forcedScore?: number; x?: number } = {}): ImpactResult {
    this.all.set(e.id, e);
    this.events.set(e.id, e);
    let r = this.score(e);
    if (opts.forcedScore != null) {
      const score = Math.round(Math.min(100, Math.max(0, opts.forcedScore)));
      const band = IMPACT_BANDS.find((b) => score < b.max) ?? IMPACT_BANDS[IMPACT_BANDS.length - 1];
      r = { ...r, score, band: band.id, bandLabel: band.label, rules: [...r.rules, `valor forçado no laboratório (motor calculou ${r.score})`] };
      this.impacts.set(e.id, r);
    }
    this.spawn({ eventId: e.id, impact: r.score, critical: isCritical(r), x: opts.x, ...timing(e, undefined, this.windowMs) }, true);
    this.set({ lastReceivedAt: new Date().toISOString() });
    return r;
  }

  /** Lab only: forget every event. */
  clearAll(): void {
    this.all.clear();
    this.events.clear();
    this.impacts.clear();
    this.set({});
  }

  applyStatus(status: StreamStatus): void {
    const before = this.sourceIdByName.size;
    this.learnSources(status);
    if (this.hiddenSources.size && this.sourceIdByName.size !== before) this.refilter();
    this.set({ status });
  }

  expire(ids: string[]): void {
    for (const id of ids) {
      this.all.delete(id);
      this.events.delete(id);
      this.impacts.delete(id);
      this.sink?.forgetEvent(id);
    }
    this.set({});
  }
}

/**
 * When the news happened/was published, and when its grain should have faded away
 * completely (the event's expiry, or the end of the user's time window if sooner).
 * Drives the age shading of each grain.
 */
export function timing(e: NewsEvent, at?: string, windowMs = MAX_WINDOW_HOURS * HOUR): { newsAt: number; fadeAt: number } {
  const now = Date.now();
  let newsAt = Date.parse(at ?? e.publishedAt ?? e.firstSeenAt);
  if (!Number.isFinite(newsAt) || newsAt > now) newsAt = Math.min(now, Date.parse(e.firstSeenAt) || now);
  let fadeAt = Date.parse(e.expiresAt);
  if (!Number.isFinite(fadeAt) || fadeAt <= newsAt) fadeAt = newsAt + MAX_WINDOW_HOURS * HOUR;
  fadeAt = Math.min(fadeAt, newsAt + windowMs);
  return { newsAt, fadeAt };
}

/** The news' main category (the analyzer lists the strongest first): what the category filter goes by. */
export function mainCategory(e: NewsEvent): Category {
  return e.analysis.categories[0] ?? 'other';
}

export function isCritical(r: ImpactResult): boolean {
  return r.urgent || r.band === 'critical';
}

export function useStoreState(store: SandStore): UiState {
  return useSyncExternalStore(store.subscribe, store.getState);
}
