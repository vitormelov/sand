import { scoreToRadius } from '../../shared/impact/radius';
import { createParticle, type Particle } from './Particle';
import { DEFAULT_PHYSICS, PhysicsEngine } from './PhysicsEngine';
import { ParticleRenderer } from './ParticleRenderer';
import { GrainSound } from './sound';

export interface SimSettings {
  gravity: number;
  speed: number;
  sizeScale: number;
  density: 'low' | 'normal' | 'high';
  reducedMotion: boolean;
  sound: boolean;
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
/** Grains are rendered smaller on phones so the landscape keeps its proportions. */
const MOBILE_SIZE = 0.6;
const DEVELOPMENT_SCALE = 0.62;
const MAX_QUEUE = 600;

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

  constructor(
    private canvas: HTMLCanvasElement,
    private settings: SimSettings,
  ) {
    const { width, height } = this.measure();
    this.engine = new PhysicsEngine(width, height, { ...DEFAULT_PHYSICS });
    this.renderer = new ParticleRenderer(canvas);
    this.applySettings();
    this.renderer.resize(width, height, this.dpr);
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
    this.settings = { ...this.settings, ...next };
    this.applySettings();
    if (next.sizeScale != null && next.sizeScale !== prevScale) this.rescaleAll();
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
    const wasScale = this.effectiveScale();
    this.engine.resize(width, height);
    this.renderer.resize(width, height, this.dpr);
    this.applySettings();
    if (this.effectiveScale() !== wasScale) this.rescaleAll(); // crossed the phone/desktop threshold
  }

  private effectiveScale(): number {
    return this.settings.sizeScale * (this.engine.width < 700 ? MOBILE_SIZE : 1);
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
      // After long absences, the least impactful backlog is shown only in the list, not as grains.
      this.queue.sort((a, b) => b.impact - a.impact);
      this.queue.length = MAX_QUEUE;
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

  /** Event expired: its grains (already faded by age) leave the sand. */
  forgetEvent(eventId: string): void {
    const list = this.byEvent.get(eventId);
    if (list) for (const p of list) this.engine.release(p);
    this.byEvent.delete(eventId);
    this.critical = this.critical.filter((p) => p.eventId);
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
        : Math.random() < 0.55
          ? wander * w + (Math.random() - 0.5) * w * 0.18
          : Math.random() * w;
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
      vx: req.x != null ? 0 : (Math.random() - 0.5) * 10,
      vy: 20 + Math.random() * 20,
    });
    p.tone = toneFor(p.newsAt, p.fadeAt);
    if (!this.byEvent.has(p.eventId)) this.byEvent.set(p.eventId, []);
    this.byEvent.get(p.eventId)!.push(p);
    if (p.critical) this.critical.push(p);
    if (this.settings.reducedMotion) this.engine.dropInstant(p);
    else this.engine.add(p);
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
      reducedMotion: this.settings.reducedMotion,
    });
    this.raf = requestAnimationFrame(this.frame);
  };
}
