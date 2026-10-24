import type { Particle } from './Particle';
import type { PhysicsEngine } from './PhysicsEngine';

const INK = '#111111';
const TAU = Math.PI * 2;
/** Must match SandSimulation.TONE_LEVELS: opacity is quantized so grains batch by level. */
const LEVELS = 24;
const level = (tone: number) => Math.max(1, Math.round(tone * LEVELS));

/**
 * Canvas 2D renderer.
 * Deposited grains are baked into an offscreen "sediment" canvas once, so a
 * frame only redraws: one image blit + the few falling grains + overlays.
 */
export class ParticleRenderer {
  private ctx: CanvasRenderingContext2D;
  private sediment: HTMLCanvasElement;
  private sctx: CanvasRenderingContext2D;
  private fading: Particle[] = [];
  private w = 0;
  private h = 0;
  /** Re-bakes performed (for diagnostics). */
  bakes = 0;

  constructor(private canvas: HTMLCanvasElement) {
    this.ctx = canvas.getContext('2d', { alpha: true })!;
    this.sediment = document.createElement('canvas');
    this.sctx = this.sediment.getContext('2d', { alpha: true })!;
  }

  resize(w: number, h: number, dpr: number): void {
    this.w = w;
    this.h = h;
    for (const c of [this.canvas, this.sediment]) {
      c.width = Math.round(w * dpr);
      c.height = Math.round(h * dpr);
    }
    this.canvas.style.width = `${w}px`;
    this.canvas.style.height = `${h}px`;
    this.ctx.imageSmoothingQuality = 'high';
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.sctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  private bakeAll(engine: PhysicsEngine): void {
    const c = this.sctx;
    c.clearRect(0, 0, this.w, this.h);
    c.fillStyle = INK;
    const fadingSet = new Set(this.fading);
    // One path per age level: older news is lighter. Lighter levels first, so fresh
    // (dark) grains stay crisp where they overlap old ones.
    const byLevel = new Map<number, Particle[]>();
    engine.forEachStatic((s) => {
      if (fadingSet.has(s)) return;
      const l = level(s.tone);
      let list = byLevel.get(l);
      if (!list) byLevel.set(l, (list = []));
      list.push(s);
    });
    for (const l of [...byLevel.keys()].sort((a, b) => a - b)) {
      c.globalAlpha = l / LEVELS;
      c.beginPath();
      for (const s of byLevel.get(l)!) {
        c.moveTo(s.x + s.r, s.y);
        c.arc(s.x, s.y, s.r, 0, TAU);
      }
      c.fill();
    }
    c.globalAlpha = 1;
    this.bakes++;
  }

  private bakeOne(s: Particle): void {
    const c = this.sctx;
    c.globalAlpha = level(s.tone) / LEVELS;
    c.fillStyle = INK;
    c.beginPath();
    c.arc(s.x, s.y, s.r, 0, TAU);
    c.fill();
    c.globalAlpha = 1;
  }

  render(
    engine: PhysicsEngine,
    opts: { time: number; dt: number; selectedEventId?: string | null; hoverId?: number | null; critical: Particle[]; reducedMotion: boolean },
  ): void {
    // Incremental bake of grains deposited since the last frame.
    if (engine.newlyDeposited.length) {
      for (const p of engine.newlyDeposited) {
        if (p.alpha < 1) this.fading.push(p);
        else if (!engine.dirty) this.bakeOne(p);
      }
      engine.newlyDeposited.length = 0;
    }
    if (this.fading.length) {
      const still: Particle[] = [];
      for (const p of this.fading) {
        p.alpha = Math.min(1, p.alpha + opts.dt * 1.6);
        if (p.state !== 'deposited' || !engine.statics.has(p)) continue;
        if (p.alpha >= 1) {
          if (!engine.dirty) this.bakeOne(p);
        } else still.push(p);
      }
      this.fading = still;
    }
    if (engine.dirty) {
      this.bakeAll(engine);
      engine.dirty = false;
    }

    const c = this.ctx;
    c.clearRect(0, 0, this.w, this.h);
    c.drawImage(this.sediment, 0, 0, this.w, this.h);

    // Fading-in deposits (reduced-motion placement).
    for (const p of this.fading) {
      c.globalAlpha = p.alpha * (level(p.tone) / LEVELS);
      c.fillStyle = INK;
      c.beginPath();
      c.arc(p.x, p.y, p.r, 0, TAU);
      c.fill();
    }
    c.globalAlpha = 1;

    // Falling grains (few): each with its fade-in and age tone.
    c.fillStyle = INK;
    for (const p of engine.actives) {
      p.alpha = Math.min(1, p.alpha + opts.dt * 2.5);
      c.globalAlpha = p.alpha * (level(p.tone) / LEVELS);
      c.beginPath();
      c.arc(p.x, p.y, p.r, 0, TAU);
      c.fill();
    }
    c.globalAlpha = 1;

    // Critical grains: a slow, faint halo — never a flash.
    if (opts.critical.length) {
      c.lineWidth = 1;
      for (const p of opts.critical) {
        if (!p.eventId) continue;
        const pulse = opts.reducedMotion ? 0.5 : 0.5 + 0.5 * Math.sin(opts.time * 0.8 + p.phase);
        c.strokeStyle = `rgba(17,17,17,${0.1 + 0.12 * pulse})`;
        c.beginPath();
        c.arc(p.x, p.y, p.r + 3 + 2 * pulse, 0, TAU);
        c.stroke();
      }
    }

    // Selection / hover rings.
    if (opts.selectedEventId || opts.hoverId != null) {
      c.lineWidth = 1.25;
      const ring = (p: Particle, alpha: number, gap: number) => {
        c.strokeStyle = `rgba(17,17,17,${alpha})`;
        c.beginPath();
        c.arc(p.x, p.y, p.r + gap, 0, TAU);
        c.stroke();
      };
      const visit = (p: Particle) => {
        if (opts.selectedEventId && p.eventId === opts.selectedEventId) ring(p, 0.75, 5);
        else if (opts.hoverId === p.id) ring(p, 0.35, 4);
      };
      engine.forEachStatic(visit);
      engine.actives.forEach(visit);
    }
  }
}
