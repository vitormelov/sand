import { useSyncExternalStore } from 'react';
import { IMPACT_BANDS } from '../../shared/impact/config';
import { computeImpact, type ImpactResult } from '../../shared/impact/engine';
import type { NewsEvent, StreamEventMessage, StreamStatus, UserProfile } from '../../shared/types';

export type Connection = 'connecting' | 'open' | 'reconnecting' | 'offline';

export interface SpawnSink {
  enqueue(
    req: { eventId: string; developmentId?: string; impact: number; critical: boolean; x?: number; newsAt?: number; fadeAt?: number },
    backlog?: boolean,
  ): void;
  updateImpact(eventId: string, impact: number, critical: boolean): void;
  forgetEvent(eventId: string): void;
}

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
  readonly events = new Map<string, NewsEvent>();
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
    const sorted = [...this.events.values()].sort((a, b) => Date.parse(a.firstSeenAt) - Date.parse(b.firstSeenAt));
    for (const e of sorted) {
      const r = this.impacts.get(e.id) ?? this.score(e);
      sink.enqueue({ eventId: e.id, impact: r.score, critical: isCritical(r), ...timing(e) }, true);
      for (const d of e.developments) sink.enqueue({ eventId: e.id, developmentId: d.id, impact: r.score, critical: false, ...timing(e, d.at) }, true);
    }
  }

  private spawn(...args: Parameters<SpawnSink['enqueue']>): void {
    this.sink?.enqueue(...args);
  }

  // --- impact ---------------------------------------------------------------
  private score(e: NewsEvent): ImpactResult {
    const r = computeImpact(e, this.profile);
    this.impacts.set(e.id, r);
    return r;
  }

  setProfile(profile: UserProfile): void {
    this.profile = profile;
    for (const e of this.events.values()) {
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
    const sorted = [...events].sort((a, b) => Date.parse(a.firstSeenAt) - Date.parse(b.firstSeenAt));
    for (const e of sorted) {
      const known = this.events.has(e.id);
      this.events.set(e.id, e);
      const r = this.score(e);
      if (!known) {
        this.spawn({ eventId: e.id, impact: r.score, critical: isCritical(r), ...timing(e) }, true);
        for (const d of e.developments) this.spawn({ eventId: e.id, developmentId: d.id, impact: r.score, critical: false, ...timing(e, d.at) }, true);
      }
    }
    this.set({ status, snapshotLoaded: true, connection: 'open' });
  }

  applyEvent(msg: StreamEventMessage): void {
    const e = msg.event;
    const known = this.events.has(e.id);
    this.events.set(e.id, e);
    const r = this.score(e);
    const now = new Date().toISOString();
    if (!known) {
      this.spawn({ eventId: e.id, impact: r.score, critical: isCritical(r), ...timing(e) });
      this.set({ sessionCount: this.state.sessionCount + 1, lastReceivedAt: now });
      return;
    }
    this.sink?.updateImpact(e.id, r.score, isCritical(r));
    if (msg.change === 'development' && msg.developmentId) {
      this.spawn({ eventId: e.id, developmentId: msg.developmentId, impact: r.score, critical: false, ...timing(e, e.developments.find((d) => d.id === msg.developmentId)?.at) });
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
    this.events.set(e.id, e);
    let r = this.score(e);
    if (opts.forcedScore != null) {
      const score = Math.round(Math.min(100, Math.max(0, opts.forcedScore)));
      const band = IMPACT_BANDS.find((b) => score < b.max) ?? IMPACT_BANDS[IMPACT_BANDS.length - 1];
      r = { ...r, score, band: band.id, bandLabel: band.label, rules: [...r.rules, `valor forçado no laboratório (motor calculou ${r.score})`] };
      this.impacts.set(e.id, r);
    }
    this.spawn({ eventId: e.id, impact: r.score, critical: isCritical(r), x: opts.x, ...timing(e) }, true);
    this.set({ lastReceivedAt: new Date().toISOString() });
    return r;
  }

  /** Lab only: forget every event. */
  clearAll(): void {
    this.events.clear();
    this.impacts.clear();
    this.set({});
  }

  applyStatus(status: StreamStatus): void {
    this.set({ status });
  }

  expire(ids: string[]): void {
    for (const id of ids) {
      this.events.delete(id);
      this.impacts.delete(id);
      this.sink?.forgetEvent(id);
    }
    this.set({});
  }
}

/**
 * When the news happened/was published, and when its grain should have faded away
 * completely (the event's expiry). Drives the age shading of each grain.
 */
export function timing(e: NewsEvent, at?: string): { newsAt: number; fadeAt: number } {
  const now = Date.now();
  let newsAt = Date.parse(at ?? e.publishedAt ?? e.firstSeenAt);
  if (!Number.isFinite(newsAt) || newsAt > now) newsAt = Math.min(now, Date.parse(e.firstSeenAt) || now);
  let fadeAt = Date.parse(e.expiresAt);
  if (!Number.isFinite(fadeAt) || fadeAt <= newsAt) fadeAt = newsAt + 48 * 3_600_000;
  return { newsAt, fadeAt };
}

export function isCritical(r: ImpactResult): boolean {
  return r.urgent || r.band === 'critical';
}

export function useStoreState(store: SandStore): UiState {
  return useSyncExternalStore(store.subscribe, store.getState);
}
