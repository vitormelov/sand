import { scoreToRadius } from '../../shared/impact/radius';
import { createParticle, type Particle } from './Particle';
import { DEFAULT_PHYSICS, PhysicsEngine } from './PhysicsEngine';
import { BALLOON_TOP, ParticleRenderer, type Balloon } from './ParticleRenderer';
import { GrainSound } from './sound';
import { CEILING_BIN, mapCeiling } from '../map/terrain';
import { loadWorld, type Lines } from '../map/worldData';

export interface SimSettings {
  gravity: number;
  speed: number;
  sizeScale: number;
  density: 'low' | 'normal' | 'high';
  reducedMotion: boolean;
  sound: boolean;
  theme?: 'light' | 'dark';
  /** Keep the sand under the background map's bottom edge (on when the map is shown). */
  terrain?: boolean;
  /** Show the news title in a balloon beside grains while they fall. */
  titles?: boolean;
  /** 'organized': each grain falls at a column set by its impact, lowest on the left, highest on the right. */
  layout?: 'natural' | 'organized';
}

export interface SpawnRequest {
  eventId: string;
  developmentId?: string;
  impact: number;
  critical: boolean;
  /** Drop position as a fraction of the width (lab/testing); random when omitted. */
  x?: number;
  /** Wall-clock ms of the news and of its complete fade-out (age shading). */
  newsAt?: number;
  fadeAt?: number;
}

/** Opacity levels used for age shading (quantized so the sediment is re-baked rarely). */
export const TONE_LEVELS = 24;
/** News published within this window, not yet opened, gets a thin "new" ring. */
export const FRESH_MS = 60 * 60_000;
const TONE_REFRESH_S = 15;

/** 1 = just published (solid ink), 0 = reached the end of its life (gone). */
export function toneFor(newsAt: number | undefined, fadeAt: number | undefined, now = Date.now()): number {
  if (newsAt == null || fadeAt == null || fadeAt <= newsAt) return 1;
  const life = Math.min(1, Math.max(0, (now - newsAt) / (fadeAt - newsAt)));
  // Ease: stays dark for a while, then lightens steadily and vanishes at the end.
  return Math.pow(1 - life, 0.8);
}

export interface SimStats {
  fps: number;
  frameMs: number;
  actives: number;
  statics: number;
  queued: number;
  bakes: number;
}

// Caps sized for desktop-scale grains (7–50 px); the bed-height limit usually binds first.
const DENSITY_STATICS = { low: 800, normal: 1500, high: 3000 } as const;
/**
 * Grains scale with the window width (reference 1920 px = 1×), so shrinking or enlarging
 * the window scales the whole landscape instead of squeezing it. Limited so grains stay
 * tappable on phones and don't get huge on ultrawide screens.
 */
const REFERENCE_WIDTH = 1920;
const VIEW_SCALE_MIN = 0.4;
const VIEW_SCALE_MAX = 1.25;

export function viewScale(width: number): number {
  return Math.min(VIEW_SCALE_MAX, Math.max(VIEW_SCALE_MIN, width / REFERENCE_WIDTH));
}
const DEVELOPMENT_SCALE = 0.62;
const MAX_QUEUE = 600;
const MAX_BALLOONS = 3;
const BALLOON_FADE_OUT_S = 1.2;
/** A balloon never lasts longer than this (s), and leaves once its grain is this still. */
const BALLOON_MAX_S = 8;
const BALLOON_STILL_SPEED = 20; // px/s
const BALLOON_STILL_S = 0.4;

/**
 * Orchestrates the canvas, the physics and the spawn queue. Runs its own
 * requestAnimationFrame loop — React never re-renders per frame.
 */
export class SandSimulation {
  readonly engine: PhysicsEngine;
  private renderer: ParticleRenderer;
  private queue: (SpawnRequest & { backlog: boolean })[] = [];
  private spawned = new Set<string>();
  private byEvent = new Map<string, Particle[]>();
  private critical: Particle[] = [];
  private raf = 0;
  private last: number | null = null;
  private spawnTimer = 0;
  private sourceDrift = Math.random() * 1000;
  private frameMsAvg = 16;
  private selected: string | null = null;
  private hoverId: number | null = null;
  private sound = new GrainSound();
  private ro?: ResizeObserver;
  private dpr = 1;
  private running = false;
  private pruneTimer = 5;
  private paused = false;
  private toneTimer = 0;
  private viewed = new Set<string>();
  /** Grains of news from the last hour that the user hasn't opened yet. */
  private fresh: Particle[] = [];
  private relayoutTimer?: ReturnType<typeof setTimeout>;
  private layoutDirty = false;
  private lastRelayout = 0;
  private world: Lines[] | null = null;
  private balloons: Balloon[] = [];
  private labelFor?: (eventId: string) => string | undefined;

  constructor(
    private canvas: HTMLCanvasElement,
    private settings: SimSettings,
  ) {
    const { width, height } = this.measure();
    this.engine = new PhysicsEngine(width, height, { ...DEFAULT_PHYSICS });
    this.renderer = new ParticleRenderer(canvas);
    this.applySettings();
    this.renderer.setTheme(settings.theme ?? 'light');
    this.renderer.resize(width, height, this.dpr);
    this.updateCeiling();
    this.engine.onDeposit = (p) => {
      if (this.settings.sound && p.r >= 2.4 && !this.settings.reducedMotion) this.sound.tick(p.r);
    };
  }

  private measure() {
    const rect = this.canvas.parentElement?.getBoundingClientRect() ?? { width: innerWidth, height: innerHeight };
    // Supersample: never below 2× the CSS size, so circle edges come out smooth after the
    // browser downscales (on a 1× monitor a 1:1 canvas looks stair-stepped).
    this.dpr = Math.min(3, Math.max(2, window.devicePixelRatio || 1));
    return { width: Math.max(1, Math.round(rect.width)), height: Math.max(1, Math.round(rect.height)) };
  }

  private applySettings(): void {
    const mobile = this.engine.width < 700;
    const c = this.engine.config;
    c.gravity = this.settings.gravity;
    c.maxStatic = Math.round(DENSITY_STATICS[this.settings.density] * (mobile ? 0.5 : 1));
    c.maxActive = mobile ? 200 : 400;
    c.maxPileFraction = mobile ? 0.34 : 0.4;
    c.ambientMotion = !this.settings.reducedMotion;
    this.engine.setMaxRadius(scoreToRadius(100, this.effectiveScale()));
  }

  setSettings(next: Partial<SimSettings>): void {
    const prevScale = this.settings.sizeScale;
    const prevTheme = this.settings.theme;
    const prevLayout = this.settings.layout ?? 'natural';
    this.settings = { ...this.settings, ...next };
    if (next.theme && next.theme !== prevTheme) {
      this.renderer.setTheme(next.theme);
      this.engine.dirty = true; // re-draw the settled sand in the new colours
    }
    this.applySettings();
    if (next.sizeScale != null && next.sizeScale !== prevScale) this.rescaleAll();
    if (next.terrain !== undefined) this.updateCeiling();
    if ((this.settings.layout ?? 'natural') !== prevLayout) this.rearrange();
  }

  private get organized(): boolean {
    return this.settings.layout === 'organized';
  }

  /** Organized mode: impact 0 at the left edge, 100 at the right, with a little jitter so columns stay sand-like. */
  private organizedX(impact: number, r: number): number {
    const w = this.engine.width;
    const t = Math.min(100, Math.max(0, impact)) / 100;
    const jitter = (Math.random() - 0.5) * Math.min(r, w * 0.01);
    return Math.min(w - r, Math.max(r, r + t * (w - 2 * r) + jitter));
  }

  /** Layout changed: move every grain to its new column and re-pour the sand (old news stays below). */
  private rearrange(): void {
    const w = this.engine.width;
    for (const list of this.byEvent.values()) {
      for (const p of list) {
        p.x = this.organized ? this.organizedX(p.impact, p.r) : p.r + Math.random() * (w - 2 * p.r);
        p.vx = 0;
      }
    }
    this.engine.relayout();
  }

  /** The line the sand keeps under follows the map, so it is recomputed with the viewport. */
  private updateCeiling(): void {
    if (!this.settings.terrain) {
      this.engine.setCeiling(null, CEILING_BIN);
      return;
    }
    if (!this.world) {
      loadWorld().then(
        (d) => {
          this.world = [d.coast, d.borders];
          this.updateCeiling();
        },
        () => undefined, // no map, no line: the default pile height applies
      );
      return;
    }
    this.engine.setCeiling(mapCeiling(this.world, this.engine.width, this.engine.height), CEILING_BIN);
  }

  /** Grains ease to the size their impact implies at the current scale. */
  private rescaleAll(): void {
    for (const list of this.byEvent.values()) for (const p of list) p.targetR = this.radiusFor(p.impact, !!p.developmentId);
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.ro = new ResizeObserver(() => this.onResize());
    if (this.canvas.parentElement) this.ro.observe(this.canvas.parentElement);
    document.addEventListener('visibilitychange', this.onVisibility);
    this.last = null;
    this.raf = requestAnimationFrame(this.frame);
  }

  stop(): void {
    this.running = false;
    cancelAnimationFrame(this.raf);
    this.ro?.disconnect();
    clearTimeout(this.relayoutTimer);
    document.removeEventListener('visibilitychange', this.onVisibility);
    this.sound.close();
  }

  private onVisibility = () => {
    if (document.hidden) {
      // Pause entirely while hidden; on return we continue from where we were
      // instead of simulating every missed frame.
      cancelAnimationFrame(this.raf);
    } else if (this.running) {
      this.last = null;
      this.raf = requestAnimationFrame(this.frame);
    }
  };

  private onResize(): void {
    const { width, height } = this.measure();
    if (width === this.engine.width && height === this.engine.height) return;
    const kx = width / this.engine.width;
    const k = viewScale(width) / viewScale(this.engine.width);
    // The landscape scales as a whole: positions, depth and grain sizes together.
    this.engine.resize(width, height, k);
    this.renderer.resize(width, height, this.dpr);
    this.applySettings();
    this.updateCeiling();
    // Only when the size limits kick in (k ≠ width ratio) does the shape change; then
    // re-pour the sand once the user stops resizing, so nothing overlaps.
    if (Math.abs(k - kx) > 0.01) this.layoutDirty = true;
    clearTimeout(this.relayoutTimer);
    if (this.layoutDirty) {
      // Keep it clean while dragging too (≈20–40 ms per re-pour), and once more at the end.
      const now = performance.now();
      if (now - this.lastRelayout > 300) {
        this.lastRelayout = now;
        this.engine.relayout();
      }
      this.relayoutTimer = setTimeout(() => {
        this.layoutDirty = false;
        this.lastRelayout = performance.now();
        this.engine.relayout();
      }, 250);
    }
  }

  private effectiveScale(): number {
    return this.settings.sizeScale * viewScale(this.engine.width);
  }

  private radiusFor(impact: number, development: boolean): number {
    const r = scoreToRadius(impact, this.effectiveScale());
    return development ? r * DEVELOPMENT_SCALE : r;
  }

  /** Queue a grain. Backlog grains (initial snapshot) are paced faster. */
  enqueue(req: SpawnRequest, backlog = false): void {
    const key = req.developmentId ?? req.eventId;
    if (this.spawned.has(key)) return;
    this.spawned.add(key);
    this.queue.push({ ...req, backlog });
    if (this.queue.length > MAX_QUEUE) {
      // After long absences, the least impactful backlog is shown only in the list, not as
      // grains. The rest keeps its order (oldest first), so newer news still lands on top.
      const cut = [...this.queue].sort((a, b) => b.impact - a.impact)[MAX_QUEUE - 1].impact;
      let keepAtCut = MAX_QUEUE - this.queue.filter((q) => q.impact > cut).length;
      this.queue = this.queue.filter((q) => q.impact > cut || (q.impact === cut && keepAtCut-- > 0));
    }
  }

  /** Impact recomputed (city/interest change): grains ease to their new size. */
  updateImpact(eventId: string, impact: number, critical: boolean): void {
    for (const q of this.queue) if (q.eventId === eventId) {
      q.impact = impact;
      q.critical = critical;
    }
    const list = this.byEvent.get(eventId);
    if (!list) return;
    for (const p of list) {
      p.impact = impact;
      p.targetR = this.radiusFor(impact, !!p.developmentId);
      const wasCritical = p.critical;
      p.critical = critical && !p.developmentId;
      if (p.critical && !wasCritical) this.critical.push(p);
    }
    this.critical = this.critical.filter((p) => p.critical);
  }

  /** The time window changed: the grain keeps its place and fades out at `fadeAt` instead. */
  retime(eventId: string, developmentId: string | undefined, fadeAt: number): void {
    for (const q of this.queue) if (q.eventId === eventId && q.developmentId === developmentId) q.fadeAt = fadeAt;
    const list = this.byEvent.get(eventId);
    if (list) for (const p of list) if (p.developmentId === developmentId) p.fadeAt = fadeAt;
    this.toneTimer = 0;
  }

  /** Event expired or hidden: its grains leave the sand (and may be poured again later). */
  forgetEvent(eventId: string): void {
    const list = this.byEvent.get(eventId);
    if (list) for (const p of list) {
      this.engine.release(p);
      if (p.developmentId) this.spawned.delete(p.developmentId);
    }
    this.byEvent.delete(eventId);
    this.spawned.delete(eventId);
    this.queue = this.queue.filter((q) => {
      if (q.eventId !== eventId) return true;
      this.spawned.delete(q.developmentId ?? q.eventId);
      return false;
    });
    this.critical = this.critical.filter((p) => p.eventId !== eventId);
  }

  select(eventId: string | null): void {
    this.selected = eventId;
  }

  hasGrain(eventId: string): boolean {
    return !!this.byEvent.get(eventId)?.length;
  }

  /** Screen position of an event's main grain (for anchoring the details panel). */
  grainPosition(eventId: string): { x: number; y: number; r: number } | undefined {
    const p = this.byEvent.get(eventId)?.find((x) => !x.developmentId) ?? this.byEvent.get(eventId)?.[0];
    return p ? { x: p.x, y: p.y, r: p.r } : undefined;
  }

  /** Live position of a specific grain (the one the user hovered or clicked). */
  particlePosition(particleId: number): { x: number; y: number; r: number } | undefined {
    for (const list of this.byEvent.values()) {
      const p = list.find((x) => x.id === particleId);
      if (p) return p.state === 'removed' ? undefined : { x: p.x, y: p.y, r: p.r };
    }
    return undefined;
  }

  hitTest(x: number, y: number): Particle | undefined {
    return this.engine.hitTest(x, y);
  }

  hover(x: number | null, y: number | null): Particle | undefined {
    const p = x == null || y == null ? undefined : this.engine.hitTest(x, y);
    this.hoverId = p?.id ?? null;
    return p;
  }

  stats(): SimStats {
    return {
      fps: Math.round(1000 / this.frameMsAvg),
      frameMs: Math.round(this.frameMsAvg * 10) / 10,
      actives: this.engine.actives.length,
      statics: this.engine.staticCount,
      queued: this.queue.length,
      bakes: this.renderer.bakes,
    };
  }

  private spawnNext(): void {
    const req = this.queue.shift();
    if (!req) return;
    const r = this.radiusFor(req.impact, !!req.developmentId);
    const w = this.engine.width;
    // Mix uniform rain with a slowly wandering source: produces dunes rather than a flat bed.
    this.sourceDrift += 0.013;
    const wander = 0.5 + 0.42 * Math.sin(this.sourceDrift) * Math.cos(this.sourceDrift * 0.37);
    const x =
      req.x != null
        ? req.x * w
        : this.organized
          ? this.organizedX(req.impact, r)
          : (this.roomyX(r, wander) ??
          (Math.random() < 0.55 ? wander * w + (Math.random() - 0.5) * w * 0.18 : Math.random() * w));
    const p = createParticle({
      eventId: req.eventId,
      developmentId: req.developmentId,
      x: Math.min(w - r, Math.max(r, x)),
      y: -r - Math.random() * 30,
      r,
      impact: req.impact,
      critical: req.critical && !req.developmentId,
      bornAt: this.engine.time,
      newsAt: req.newsAt,
      fadeAt: req.fadeAt,
      vx: req.x != null || this.organized ? 0 : (Math.random() - 0.5) * 10,
      vy: 20 + Math.random() * 20,
    });
    p.tone = toneFor(p.newsAt, p.fadeAt);
    p.viewed = this.viewed.has(p.eventId);
    if (this.isFresh(p, Date.now())) this.fresh.push(p);
    if (!this.byEvent.has(p.eventId)) this.byEvent.set(p.eventId, []);
    this.byEvent.get(p.eventId)!.push(p);
    if (p.critical) this.critical.push(p);
    if (this.settings.reducedMotion) this.engine.dropInstant(p);
    else this.engine.add(p);
  }

  /**
   * With a ceiling (the map's bottom edge), drop the grain where the sand still has room under
   * it: the open middle first, then the oceans and the sides as the bed fills up. Layers grow
   * evenly, so newer news ends up above older news. Undefined when there is no ceiling.
   */
  private roomyX(r: number, wander: number): number | undefined {
    const e = this.engine;
    const c = e.ceiling;
    const bin = e.ceilingBin;
    if (!c || c.length !== e.surface.length) return undefined;
    const room = Float32Array.from(e.surface, (t, i) => t - c[i]);
    // Grains still in the air will take their share where they are heading (a grain of radius r
    // spread over ~3r of width raises the surface by about r).
    for (const a of e.actives) {
      const from = Math.max(0, Math.floor((a.x - a.r * 1.5) / bin));
      const to = Math.min(room.length - 1, Math.floor((a.x + a.r * 1.5) / bin));
      for (let i = from; i <= to; i++) room[i] -= a.r;
    }
    const half = Math.max(0, Math.ceil((r * 0.7) / bin));
    const w = e.width;
    const weights = new Float32Array(room.length);
    let total = 0;
    let best = 0;
    let bestRoom = -Infinity;
    for (let i = 0; i < room.length; i++) {
      const x = (i + 0.5) * bin;
      if (x < r || x > w - r) continue;
      let m = Infinity;
      for (let j = Math.max(0, i - half); j <= Math.min(room.length - 1, i + half); j++) m = Math.min(m, room[j]);
      if (m > bestRoom) {
        bestRoom = m;
        best = i;
      }
      if (m <= r) continue;
      // Prefer emptier columns, with a slow wandering bias so the surface forms soft dunes.
      const dune = 0.75 + 0.25 * Math.cos(((x / w - wander) * Math.PI * 2) / 0.6);
      weights[i] = Math.pow(m, 1.5) * dune;
      total += weights[i];
    }
    let pick = best;
    if (total > 0) {
      let t = Math.random() * total;
      for (let i = 0; i < weights.length; i++) {
        t -= weights[i];
        if (t <= 0 && weights[i] > 0) {
          pick = i;
          break;
        }
      }
    }
    return (pick + 0.5) * bin + (Math.random() - 0.5) * bin;
  }

  /** Where titles come from (the store). Without it, no balloons (e.g. the login backdrop). */
  setLabelSource(fn: ((eventId: string) => string | undefined) | undefined): void {
    this.labelFor = fn;
  }

  /**
   * A few falling grains (the most impactful first) carry their title beside them; when the
   * grain lands, its balloon fades out where it is. Capped so the initial pour stays readable.
   */
  private updateBalloons(dt: number): void {
    if (!this.settings.titles || !this.labelFor || this.settings.reducedMotion) {
      this.balloons.length = 0;
      return;
    }
    const still: Balloon[] = [];
    for (const b of this.balloons) {
      // Landed when the physics deposits the grain, when it has been almost still for a moment
      // (grains settling on the pile can stay "falling" for long), or after a few seconds anyway.
      b.age = (b.age ?? 0) + dt;
      b.still = Math.hypot(b.p.vx, b.p.vy) < BALLOON_STILL_SPEED ? (b.still ?? 0) + dt : 0;
      if (b.p.state !== 'falling' || b.still > BALLOON_STILL_S || b.age > BALLOON_MAX_S) b.landed = true;
      b.alpha = b.landed ? b.alpha - dt / BALLOON_FADE_OUT_S : Math.min(1, b.alpha + dt * 4);
      if (b.alpha > 0 && b.p.state !== 'removed') still.push(b);
    }
    this.balloons = still;
    // Room for one balloon on a phone, two on a tablet, three on a desktop.
    const max = this.engine.width < 700 ? 1 : this.engine.width < 1200 ? 2 : MAX_BALLOONS;
    let flying = still.filter((b) => !b.landed && !b.hidden).length;
    if (flying >= max) return;
    const taken = new Set(still.map((b) => b.p));
    const candidates = this.engine.actives
      .filter((p) => p.eventId && !p.developmentId && !taken.has(p) && p.y > BALLOON_TOP + 70 && p.y < this.engine.height * 0.7)
      .sort((a, b) => b.impact - a.impact);
    for (const p of candidates) {
      if (flying >= max) break;
      const text = this.labelFor(p.eventId);
      if (!text) continue;
      this.balloons.push({ p, text, alpha: 0, landed: false });
      flying++;
    }
  }

  private isFresh(p: Particle, now: number): boolean {
    return !p.viewed && !!p.eventId && p.newsAt != null && now - p.newsAt < FRESH_MS && p.state !== 'removed';
  }

  /** Ids the user already opened (from the account). */
  setViewed(ids: Iterable<string>): void {
    this.viewed = new Set(ids);
    for (const [id, list] of this.byEvent) for (const p of list) p.viewed = this.viewed.has(id);
    this.fresh = this.fresh.filter((p) => !p.viewed);
    this.engine.dirty = true;
  }

  /** The user opened this news: it loses the "new" ring and gets the "seen" mark. */
  markViewed(eventId: string): void {
    if (this.viewed.has(eventId)) return;
    this.viewed.add(eventId);
    const list = this.byEvent.get(eventId);
    if (list) for (const p of list) p.viewed = true;
    this.fresh = this.fresh.filter((p) => p.eventId !== eventId);
    this.engine.dirty = true;
  }

  /**
   * Age shading: news lightens as it gets older and disappears at the end of its
   * life. Fully faded grains leave the simulation; what rested on them slides down.
   */
  refreshTones(now = Date.now()): void {
    this.toneTimer = TONE_REFRESH_S;
    let changed = false;
    for (const [id, list] of this.byEvent) {
      for (const p of list) {
        const t = toneFor(p.newsAt, p.fadeAt, now);
        if (Math.round(t * TONE_LEVELS) !== Math.round(p.tone * TONE_LEVELS)) changed = true;
        p.tone = t;
        if (t <= 0.5 / TONE_LEVELS) this.engine.release(p);
      }
      const alive = list.filter((p) => p.state !== 'removed');
      if (alive.length) this.byEvent.set(id, alive);
      else this.byEvent.delete(id);
    }
    this.critical = this.critical.filter((p) => p.state !== 'removed');
    this.fresh = this.fresh.filter((p) => this.isFresh(p, now));
    if (changed) this.engine.dirty = true;
  }

  /** Drop references to grains that sank out of the world, so memory stays flat. */
  private prune(): void {
    this.pruneTimer = 5;
    for (const [id, list] of this.byEvent) {
      const alive = list.filter((p) => p.state !== 'removed');
      if (alive.length) this.byEvent.set(id, alive);
      else this.byEvent.delete(id);
    }
    this.critical = this.critical.filter((p) => p.state !== 'removed');
  }

  /** Freeze the physics (rendering continues so selection still works). */
  setPaused(paused: boolean): void {
    this.paused = paused;
  }

  /** Remove every grain and pending spawn (lab/testing). */
  clear(): void {
    this.queue = [];
    this.spawned.clear();
    this.byEvent.clear();
    this.critical = [];
    this.engine.clear();
  }

  private frame = (now: number) => {
    if (!this.running) return;
    const raw = this.last == null ? 16 : now - this.last;
    this.last = now;
    this.frameMsAvg += (raw - this.frameMsAvg) * 0.05;
    const dt = Math.min(raw, 50) / 1000; // never try to catch up on missed time
    const simDt = dt * this.settings.speed;

    // Spawn pacing: calm for live news, brisker while the backlog settles.
    this.spawnTimer -= dt * 1000;
    if (!this.paused && this.spawnTimer <= 0 && this.queue.length && this.engine.canAcceptActive()) {
      this.spawnNext();
      const backlog = this.queue[0]?.backlog;
      const base = backlog ? 140 : 1600;
      this.spawnTimer = Math.max(backlog ? 40 : 90, base / (1 + this.queue.length / (backlog ? 30 : 8))) * (0.7 + Math.random() * 0.6);
    }

    if (!this.paused) this.engine.step(simDt);
    this.updateBalloons(dt);
    this.pruneTimer -= dt;
    if (this.pruneTimer <= 0) this.prune();
    this.toneTimer -= dt;
    if (this.toneTimer <= 0) this.refreshTones();
    this.renderer.render(this.engine, {
      time: this.engine.time,
      dt,
      selectedEventId: this.selected,
      hoverId: this.hoverId,
      critical: this.critical,
      fresh: this.fresh,
      reducedMotion: this.settings.reducedMotion,
      balloons: this.balloons,
    });
    this.raf = requestAnimationFrame(this.frame);
  };
}
