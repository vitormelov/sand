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
}

export interface SimStats {
  fps: number;
  frameMs: number;
  actives: number;
  statics: number;
  queued: number;
  bakes: number;
}

const DENSITY_STATICS = { low: 2500, normal: 5000, high: 9000 } as const;
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
    this.dpr = Math.min(2, window.devicePixelRatio || 1);
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
    this.engine.setMaxRadius(scoreToRadius(100, this.settings.sizeScale));
  }

  setSettings(next: Partial<SimSettings>): void {
    const prevScale = this.settings.sizeScale;
    this.settings = { ...this.settings, ...next };
    this.applySettings();
    if (next.sizeScale != null && next.sizeScale !== prevScale) {
      for (const list of this.byEvent.values()) for (const p of list) p.targetR = this.radiusFor(p.impact, !!p.developmentId);
    }
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
    this.engine.resize(width, height);
    this.renderer.resize(width, height, this.dpr);
    this.applySettings();
  }

  private radiusFor(impact: number, development: boolean): number {
    const r = scoreToRadius(impact, this.settings.sizeScale);
    return development ? Math.max(1.2 * this.settings.sizeScale, r * DEVELOPMENT_SCALE) : r;
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

  /** Event expired: its grains stay as anonymous sand (continuity), no longer clickable. */
  forgetEvent(eventId: string): void {
    const list = this.byEvent.get(eventId);
    if (list) for (const p of list) {
      p.eventId = '';
      p.critical = false;
    }
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
    const x = Math.random() < 0.55 ? wander * w + (Math.random() - 0.5) * w * 0.18 : Math.random() * w;
    const p = createParticle({
      eventId: req.eventId,
      developmentId: req.developmentId,
      x: Math.min(w - r, Math.max(r, x)),
      y: -r - Math.random() * 30,
      r,
      impact: req.impact,
      critical: req.critical && !req.developmentId,
      bornAt: this.engine.time,
      vx: (Math.random() - 0.5) * 10,
      vy: 20 + Math.random() * 20,
    });
    if (!this.byEvent.has(p.eventId)) this.byEvent.set(p.eventId, []);
    this.byEvent.get(p.eventId)!.push(p);
    if (p.critical) this.critical.push(p);
    if (this.settings.reducedMotion) this.engine.dropInstant(p);
    else this.engine.add(p);
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

  private frame = (now: number) => {
    if (!this.running) return;
    const raw = this.last == null ? 16 : now - this.last;
    this.last = now;
    this.frameMsAvg += (raw - this.frameMsAvg) * 0.05;
    const dt = Math.min(raw, 50) / 1000; // never try to catch up on missed time
    const simDt = dt * this.settings.speed;

    // Spawn pacing: calm for live news, brisker while the backlog settles.
    this.spawnTimer -= dt * 1000;
    if (this.spawnTimer <= 0 && this.queue.length && this.engine.canAcceptActive()) {
      this.spawnNext();
      const backlog = this.queue[0]?.backlog;
      const base = backlog ? 140 : 1600;
      this.spawnTimer = Math.max(backlog ? 40 : 90, base / (1 + this.queue.length / (backlog ? 30 : 8))) * (0.7 + Math.random() * 0.6);
    }

    this.engine.step(simDt);
    this.pruneTimer -= dt;
    if (this.pruneTimer <= 0) this.prune();
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
