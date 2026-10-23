import type { Particle } from './Particle';
import { SpatialIndex } from './SpatialIndex';

/**
 * Granular-looking physics, tuned for beauty and stability rather than accuracy.
 *
 * Hybrid model:
 *  - "falling" grains are simulated: gravity, quadratic drag (terminal velocity),
 *    collisions with walls/floor/other grains, friction and rolling;
 *  - once a grain is slow and supported (on the floor, in a pocket between two
 *    grains, or sitting almost on top of one) it is *deposited*: it stops being
 *    integrated, joins a static spatial index and is baked into an image by the
 *    renderer. The per-frame cost therefore depends on falling grains only.
 *  - impacts of heavy grains, removed support and slow "ambient accommodation"
 *    can wake deposited grains, producing small slides and avalanches;
 *  - when the bed gets too tall or too dense, it slowly sinks below the bottom
 *    edge, so memory and CPU stay bounded for sessions of any length.
 */

export interface PhysicsConfig {
  /** Gravity multiplier (1 = default). */
  gravity: number;
  maxActive: number;
  maxStatic: number;
  /** Sinking starts when the bed is taller than this fraction of the height. */
  maxPileFraction: number;
  /** Gentle flutter + occasional accommodation of surface grains. Off for reduced motion. */
  ambientMotion: boolean;
}

export const DEFAULT_PHYSICS: PhysicsConfig = {
  gravity: 1,
  maxActive: 400,
  maxStatic: 3000,
  maxPileFraction: 0.4,
  ambientMotion: true,
};

const BASE_G = 300; // px/s²
const RESTITUTION = 0.05;
const FRICTION = 0.14; // share of tangential velocity removed per contact
const SLEEP_SPEED = 7; // px/s
const SLEEP_TIME = 0.28; // s
const MAX_ACTIVE_AGE = 30; // s
const SUBSTEPS = 2;
const ITERATIONS = 2;
const WAKE_MIN_RADIUS = 3.4;
const WAKE_MOMENTUM = 900; // mass(px²) × px/s
const MAX_WAKE_PER_STEP = 40;
const SINK_SPEED = 3; // px/s
const SUPPORT_SLOP = 0.75;

export class PhysicsEngine {
  actives: Particle[] = [];
  readonly statics = new Set<Particle>();
  private staticGrid: SpatialIndex;
  private activeGrid: SpatialIndex;
  time = 0;
  /** Statics changed in a way that requires the renderer to re-bake everything. */
  dirty = true;
  /** Deposited since the renderer last drained them (incremental bake). */
  newlyDeposited: Particle[] = [];
  /** Grains that left the simulation entirely (sunk below the edge). */
  removedCount = 0;
  onDeposit?: (p: Particle) => void;

  private maxR = 10;
  private sinkAccum = 0;
  private accomTimer = 3;
  private bedTimer = 0;
  private bedHeight = 0;
  private pendingWake: { q: Particle; x: number; y: number; speed: number }[] = [];

  constructor(
    public width: number,
    public height: number,
    public config: PhysicsConfig = { ...DEFAULT_PHYSICS },
  ) {
    this.staticGrid = new SpatialIndex(24);
    this.activeGrid = new SpatialIndex(24);
  }

  get staticCount(): number {
    return this.statics.size;
  }

  get bedHeightPx(): number {
    return this.bedHeight;
  }

  setMaxRadius(r: number): void {
    this.maxR = Math.max(4, r);
    const cell = Math.max(16, Math.ceil(this.maxR * 2.4));
    if (cell !== this.staticGrid.cellSize) {
      this.staticGrid = new SpatialIndex(cell);
      this.activeGrid = new SpatialIndex(cell);
      for (const s of this.statics) this.staticGrid.insert(s);
    }
  }

  /** Keep the bed anchored to the bottom edge when the viewport changes. */
  resize(width: number, height: number): void {
    const dy = height - this.height;
    this.width = width;
    this.height = height;
    for (const s of [...this.statics]) {
      s.y += dy;
      if (s.x - s.r > width) this.removeStatic(s);
      else if (s.x + s.r > width) s.x = width - s.r;
    }
    for (const p of this.actives) {
      p.y += Math.max(0, dy);
      p.x = Math.min(p.x, width - p.r);
    }
    this.rebuildStaticGrid();
    this.dirty = true;
  }

  add(p: Particle): void {
    p.state = 'falling';
    this.actives.push(p);
  }

  canAcceptActive(): boolean {
    return this.actives.length < this.config.maxActive;
  }

  step(dt: number): void {
    if (dt <= 0) return;
    this.time += dt;
    const h = dt / SUBSTEPS;
    for (let s = 0; s < SUBSTEPS; s++) this.substep(h);
    this.settle(dt);
    this.processWakes();
    this.easeRadii(dt);
    this.compact(dt);
    if (this.config.ambientMotion) this.accommodate(dt);
  }

  // ---------------------------------------------------------------- dynamics

  private substep(h: number): void {
    const g = BASE_G * this.config.gravity;
    const flutter = this.config.ambientMotion;
    for (const p of this.actives) {
      const vt = 55 + 20 * p.r; // terminal speed: light grains drift, heavy ones fall decisively
      p.vy += g * h;
      const sp = Math.hypot(p.vx, p.vy);
      if (sp > 0) {
        const drag = g * (sp / vt) ** 2 * h;
        const k = Math.min(drag, sp) / sp;
        p.vx -= p.vx * k;
        p.vy -= p.vy * k;
      }
      if (flutter && p.r < 3) p.vx += Math.sin(this.time * 1.6 + p.phase) * (16 / p.r) * h;
      p.x += p.vx * h;
      p.y += p.vy * h;
      p.onFloor = p.supportL = p.supportR = p.supportUnder = false;
    }
    this.activeGrid.clear();
    for (const p of this.actives) this.activeGrid.insert(p);

    for (let it = 0; it < ITERATIONS; it++) {
      for (const p of this.actives) {
        this.collideBounds(p);
        const reach = p.r + this.maxR;
        this.staticGrid.query(p.x, p.y, reach, (q) => this.resolveStatic(p, q, it === 0));
        this.activeGrid.query(p.x, p.y, reach, (q) => {
          if (q.id > p.id) this.resolvePair(p, q);
        });
      }
    }
    // Neighbour pushes can nudge a grain past an edge; the bounds always win.
    for (const p of this.actives) {
      if (p.x < p.r) p.x = p.r;
      else if (p.x > this.width - p.r) p.x = this.width - p.r;
      if (p.y > this.height - p.r) p.y = this.height - p.r;
    }
  }

  private collideBounds(p: Particle): void {
    if (p.x <= p.r) {
      p.x = p.r;
      if (p.vx < 0) p.vx = -p.vx * RESTITUTION;
      p.supportL = true; // walls hold grains like neighbours do
    } else if (p.x >= this.width - p.r) {
      p.x = this.width - p.r;
      if (p.vx > 0) p.vx = -p.vx * RESTITUTION;
      p.supportR = true;
    }
    const floor = this.height - p.r;
    if (p.y >= floor) {
      p.y = floor;
      if (p.vy > 0) p.vy = -p.vy * RESTITUTION;
      p.vx *= 1 - FRICTION * 2;
      p.onFloor = true;
    }
  }

  private markSupport(p: Particle, nx: number, ny: number): void {
    if (ny > -0.35) return; // the other grain is not below
    if (Math.abs(nx) < 0.2) p.supportUnder = true;
    else if (nx > 0) p.supportL = true;
    else p.supportR = true;
  }

  private resolveStatic(p: Particle, q: Particle, allowWake: boolean): void {
    const dx = p.x - q.x;
    const dy = p.y - q.y;
    const rr = p.r + q.r;
    const d2 = dx * dx + dy * dy;
    if (d2 >= rr * rr) return;
    let d = Math.sqrt(d2);
    let nx: number;
    let ny: number;
    if (d < 1e-6) {
      nx = Math.random() < 0.5 ? -1 : 1;
      ny = 0;
      d = 0;
    } else {
      nx = dx / d;
      ny = dy / d;
    }
    const overlap = rr - d;
    p.x += nx * overlap;
    p.y += ny * overlap;
    const vn = p.vx * nx + p.vy * ny;
    if (vn < 0) {
      if (allowWake && p.r >= WAKE_MIN_RADIUS && -vn * p.mass > WAKE_MOMENTUM) {
        this.pendingWake.push({ q, x: p.x, y: p.y, speed: -vn });
      }
      p.vx -= (1 + RESTITUTION) * vn * nx;
      p.vy -= (1 + RESTITUTION) * vn * ny;
      const vnn = p.vx * nx + p.vy * ny;
      p.vx -= (p.vx - vnn * nx) * FRICTION;
      p.vy -= (p.vy - vnn * ny) * FRICTION;
    }
    this.markSupport(p, nx, ny);
  }

  private resolvePair(p: Particle, q: Particle): void {
    const dx = p.x - q.x;
    const dy = p.y - q.y;
    const rr = p.r + q.r;
    const d2 = dx * dx + dy * dy;
    if (d2 >= rr * rr) return;
    const d = Math.sqrt(d2) || 1e-6;
    const nx = dx / d;
    const ny = dy / d;
    const overlap = rr - d;
    const tm = p.mass + q.mass;
    const wp = q.mass / tm;
    const wq = p.mass / tm;
    p.x += nx * overlap * wp;
    p.y += ny * overlap * wp;
    q.x -= nx * overlap * wq;
    q.y -= ny * overlap * wq;
    const rvx = p.vx - q.vx;
    const rvy = p.vy - q.vy;
    const vn = rvx * nx + rvy * ny;
    if (vn < 0) {
      const j = (-(1 + RESTITUTION) * vn) / (1 / p.mass + 1 / q.mass);
      p.vx += (j / p.mass) * nx;
      p.vy += (j / p.mass) * ny;
      q.vx -= (j / q.mass) * nx;
      q.vy -= (j / q.mass) * ny;
      // Friction on relative tangential motion.
      const tx = rvx - vn * nx;
      const ty = rvy - vn * ny;
      p.vx -= tx * FRICTION * wp;
      p.vy -= ty * FRICTION * wp;
      q.vx += tx * FRICTION * wq;
      q.vy += ty * FRICTION * wq;
    }
    // A slow neighbour below counts as support (grains settle on settling grains).
    if (Math.hypot(q.vx, q.vy) < SLEEP_SPEED * 2) this.markSupport(p, nx, ny);
    if (Math.hypot(p.vx, p.vy) < SLEEP_SPEED * 2) this.markSupport(q, -nx, -ny);
  }

  // ------------------------------------------------------------- deposition

  private settle(dt: number): void {
    const keep: Particle[] = [];
    for (const p of this.actives) {
      if (!Number.isFinite(p.x) || !Number.isFinite(p.y) || p.y > this.height + 60) {
        p.state = 'removed';
        this.removedCount++;
        continue;
      }
      const sp = Math.hypot(p.vx, p.vy);
      const stable = p.onFloor || (p.supportL && p.supportR) || p.supportUnder;
      const leaning = p.supportL || p.supportR;
      // Fully supported grains rest quickly; grains leaning on one neighbour rest
      // only once nearly motionless (static friction on a slope).
      // Granular contacts dissipate energy: supported grains lose their jitter quickly.
      if (stable || leaning) {
        const k = Math.pow(0.02, dt); // ~ -98% per second
        p.vx *= k;
        p.vy *= stable ? k : 1;
      }
      if (stable && sp < SLEEP_SPEED * 1.6) p.restTimer += dt;
      else if (leaning && sp < SLEEP_SPEED * 0.5) p.restTimer += dt * 0.4;
      else p.restTimer = Math.max(0, p.restTimer - dt * 2);
      const age = this.time - p.bornAt;
      if (p.restTimer > SLEEP_TIME || (age > MAX_ACTIVE_AGE && sp < 25)) {
        this.deposit(p);
      } else {
        keep.push(p);
      }
    }
    this.actives = keep;
  }

  private deposit(p: Particle): void {
    p.state = 'deposited';
    p.vx = p.vy = 0;
    p.restTimer = 0;
    this.statics.add(p);
    this.staticGrid.insert(p);
    this.newlyDeposited.push(p);
    this.onDeposit?.(p);
  }

  private removeStatic(s: Particle, released = true): void {
    if (released) s.state = 'removed';
    this.statics.delete(s);
    this.staticGrid.remove(s);
  }

  private wake(s: Particle, vx: number, vy: number): void {
    if (!this.statics.has(s)) return;
    this.removeStatic(s, false);
    s.state = 'falling';
    s.vx = vx;
    s.vy = vy;
    s.restTimer = 0;
    s.bornAt = this.time;
    this.actives.push(s);
    this.dirty = true;
  }

  /** Is a deposited grain still resting on something? */
  hasSupport(s: Particle): boolean {
    if (s.y + s.r >= this.height - SUPPORT_SLOP) return true;
    let L = false;
    let R = false;
    let U = false;
    this.staticGrid.query(s.x, s.y, s.r + this.maxR, (q) => {
      if (q === s) return;
      const dx = s.x - q.x;
      const dy = s.y - q.y;
      const rr = s.r + q.r + SUPPORT_SLOP;
      const d2 = dx * dx + dy * dy;
      if (d2 >= rr * rr || d2 === 0) return;
      const d = Math.sqrt(d2);
      const nx = dx / d;
      const ny = dy / d;
      if (ny > -0.35) return;
      if (Math.abs(nx) < 0.2) U = true;
      else if (nx > 0) L = true;
      else R = true;
    });
    return U || (L && R);
  }

  private processWakes(): void {
    if (this.pendingWake.length === 0) return;
    // Woken grains count against the active-grain limit.
    let budget = Math.min(MAX_WAKE_PER_STEP, this.config.maxActive - this.actives.length);
    if (budget <= 0) {
      this.pendingWake.length = 0;
      return;
    }
    const woken: Particle[] = [];
    for (const w of this.pendingWake) {
      // Displace a small crater around the impact point.
      const radius = Math.min(16, 3 + w.speed * 0.05);
      this.staticGrid.query(w.x, w.y, radius + this.maxR, (s) => {
        if (budget <= 0 || !this.statics.has(s)) return;
        const dx = s.x - w.x;
        const dy = s.y - w.y;
        const dist = Math.hypot(dx, dy) || 1;
        if (dist > radius + s.r) return;
        const kick = w.speed * 0.12 * (1 - dist / (radius + s.r + 1));
        woken.push(s);
        this.wake(s, (dx / dist) * kick, Math.min(0, (dy / dist) * kick) - kick * 0.4);
        budget--;
      });
    }
    this.pendingWake.length = 0;
    this.cascade(woken, budget);
  }

  /** Grains that lost their support start to slide: small avalanches. */
  private cascade(woken: Particle[], budget: number): void {
    let frontier = woken;
    while (frontier.length && budget > 0) {
      const next: Particle[] = [];
      for (const w of frontier) {
        this.staticGrid.query(w.x, w.y - this.maxR, this.maxR * 2.2, (s) => {
          if (budget <= 0 || s.y > w.y || !this.statics.has(s)) return;
          if (!this.hasSupport(s)) {
            this.wake(s, (Math.random() - 0.5) * 6, 0);
            next.push(s);
            budget--;
          }
        });
      }
      frontier = next;
    }
  }

  /** Occasionally nudge one exposed surface grain so the bed keeps settling. */
  private accommodate(dt: number): void {
    this.accomTimer -= dt;
    if (this.accomTimer > 0 || this.statics.size < 30 || this.actives.length >= this.config.maxActive) return;
    this.accomTimer = 2.5 + Math.random() * 3;
    const arr = [...this.statics];
    let top: Particle | undefined;
    for (let i = 0; i < 16; i++) {
      const s = arr[(Math.random() * arr.length) | 0];
      if (!top || s.y < top.y) top = s;
    }
    if (!top) return;
    if (!this.hasSupport(top)) this.wake(top, 0, 0);
    else if (Math.random() < 0.5) this.wake(top, (Math.random() < 0.5 ? -1 : 1) * (6 + Math.random() * 8), -4);
  }

  private easeRadii(dt: number): void {
    const k = Math.min(1, dt * 1.5);
    for (const p of this.actives) {
      if (p.r !== p.targetR) {
        p.r += (p.targetR - p.r) * k;
        if (Math.abs(p.targetR - p.r) < 0.01) p.r = p.targetR;
        p.mass = p.r * p.r;
      }
    }
    let changed = false;
    for (const s of this.statics) {
      if (s.r !== s.targetR) {
        s.r += (s.targetR - s.r) * k;
        if (Math.abs(s.targetR - s.r) < 0.01) s.r = s.targetR;
        s.mass = s.r * s.r;
        changed = true;
      }
    }
    if (changed) this.dirty = true;
  }

  // -------------------------------------------------------------- compaction

  private measureBed(): void {
    const bin = 24;
    const bins = Math.max(1, Math.ceil(this.width / bin));
    const tops = new Float32Array(bins).fill(this.height);
    for (const s of this.statics) {
      const i = Math.min(bins - 1, Math.max(0, (s.x / bin) | 0));
      if (s.y - s.r < tops[i]) tops[i] = s.y - s.r;
    }
    const heights = Array.from(tops, (t) => this.height - t).sort((a, b) => a - b);
    this.bedHeight = heights[Math.floor(heights.length * 0.8)] ?? 0;
  }

  private compact(dt: number): void {
    this.bedTimer -= dt;
    if (this.bedTimer <= 0) {
      this.bedTimer = 0.5;
      this.measureBed();
    }
    const tooTall = this.bedHeight > this.config.maxPileFraction * this.height;
    const tooMany = this.statics.size > this.config.maxStatic;
    if (tooTall || tooMany) {
      const urgency = tooMany ? Math.min(4, this.statics.size / this.config.maxStatic) : 1;
      this.sinkAccum += SINK_SPEED * urgency * dt;
    }
    if (this.sinkAccum >= 1) {
      const d = Math.floor(this.sinkAccum);
      this.sinkAccum -= d;
      this.sink(d);
    }
    // Hard ceiling, in case sinking cannot keep up (e.g. very wide screens).
    const hardMax = Math.floor(this.config.maxStatic * 1.25);
    if (this.statics.size > hardMax) {
      const byDepth = [...this.statics].sort((a, b) => b.y - a.y);
      for (let i = 0; i < this.statics.size - hardMax; i++) this.removeStatic(byDepth[i]);
      this.dirty = true;
    }
  }

  /** The whole bed descends by d px; grains fully below the edge are released. */
  private sink(d: number): void {
    for (const s of [...this.statics]) {
      s.y += d;
      if (s.y - s.r > this.height) {
        s.state = 'removed';
        this.statics.delete(s);
        this.removedCount++;
      }
    }
    this.rebuildStaticGrid();
    this.dirty = true;
  }

  private rebuildStaticGrid(): void {
    this.staticGrid.clear();
    for (const s of this.statics) this.staticGrid.insert(s);
  }

  // ------------------------------------------------------------------ queries

  /** Closest grain under a point, with a minimum touch radius for tiny grains. */
  hitTest(x: number, y: number, minRadius = 7): Particle | undefined {
    let best: Particle | undefined;
    let bestD = Infinity;
    const test = (p: Particle) => {
      const d = Math.hypot(p.x - x, p.y - y);
      const reach = Math.max(p.r + 2, minRadius);
      if (d <= reach && d < bestD && p.eventId) {
        best = p;
        bestD = d;
      }
    };
    this.staticGrid.query(x, y, minRadius + this.maxR, test);
    for (const p of this.actives) test(p);
    return best;
  }

  /** Reduced-motion placement: run this grain's fall to completion off-screen. */
  dropInstant(p: Particle): void {
    const saved = this.actives;
    this.actives = [p];
    const ambient = this.config.ambientMotion;
    this.config.ambientMotion = false;
    for (let i = 0; i < 1200 && this.actives.length; i++) {
      this.substep(1 / 60);
      this.settle(1 / 60);
    }
    this.config.ambientMotion = ambient;
    if (this.actives.length) this.deposit(p); // safety net
    this.actives = saved;
  }

  forEachStatic(fn: (p: Particle) => void): void {
    for (const s of this.statics) fn(s);
  }
}
