import type { Particle } from './Particle';
import type { PhysicsEngine } from './PhysicsEngine';

export type RenderTheme = 'light' | 'dark';

/** Canvas colours per theme (the canvas can't read CSS variables). */
const PALETTES = {
  light: { ink: '#111111', rgb: '17,17,17', paper: '#ffffff', paperRgb: '255,255,255', text: '#4a4a4a', line: '#dedede' },
  dark: { ink: '#e9e9e6', rgb: '233,233,230', paper: '#0f0f10', paperRgb: '15,15,16', text: '#c2c2be', line: '#333335' },
} as const;
let pal: (typeof PALETTES)[RenderTheme] = PALETTES.light;
const TAU = Math.PI * 2;
/** Must match SandSimulation.TONE_LEVELS: opacity is quantized so grains batch by level. */
const LEVELS = 24;
const level = (tone: number) => Math.max(1, Math.round(tone * LEVELS));
/** Must match SandSimulation.FRESH_MS. */
const FRESH_MS = 60 * 60_000;
/** Same rhythm as the red map marker. */
const FRESH_PULSE_MS = 1600;

/** A title balloon that rides beside a falling grain (see SandSimulation.updateBalloons). */
export interface Balloon {
  p: Particle;
  text: string;
  alpha: number;
  /** The grain has landed: the balloon stays where it is and fades out. */
  landed: boolean;
  /** Wrapped lines and box width, measured once. */
  lines?: string[];
  width?: number;
  /** Which side of the grain the balloon sits on, decided when it first appears. */
  right?: boolean;
  /** No free spot when it appeared (it would cover another balloon): never drawn. */
  hidden?: boolean;
  /** Seconds since it appeared, and seconds its grain has been almost still. */
  age?: number;
  still?: number;
}

/** Balloons never rise into the top bar (logo, clock, icons). */
export const BALLOON_TOP = 64;

const BALLOON_FONT = "11.5px 'Inter Variable', Inter, ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif";
const BALLOON_MAX_W = 220;
const BALLOON_PAD_X = 8;
const BALLOON_PAD_Y = 6;
const BALLOON_LINE_H = 15;

/** Up to two lines within the max width; the second ends in "…" when the title is longer. */
export function wrapTitle(measure: (s: string) => number, text: string): string[] {
  const max = BALLOON_MAX_W - 2 * BALLOON_PAD_X;
  const words = text.trim().split(/\s+/);
  const lines: string[] = [];
  let line = '';
  for (let i = 0; i < words.length; i++) {
    const next = line ? `${line} ${words[i]}` : words[i];
    if (measure(next) <= max) {
      line = next;
      continue;
    }
    if (lines.length === 1 || !line) {
      // Last line (or a single word wider than the box): cut it to fit, with an ellipsis.
      let rest = line ? `${line} ${words.slice(i).join(' ')}` : words.slice(i).join(' ');
      while (rest.length > 1 && measure(`${rest}…`) > max) rest = rest.slice(0, -1);
      lines.push(`${rest.trimEnd()}…`);
      return lines.slice(0, 2);
    }
    lines.push(line);
    line = words[i];
  }
  if (line) lines.push(line);
  return lines;
}

/**
 * "Already opened": a small dot at the centre of the grain, always in contrast with it.
 * A grain still strong in colour gets a dot in the background colour; one that has faded
 * with age (and looks almost like the background) gets a dot in the ink colour instead.
 * `fade` is the grain's own fade-in, so the dot appears together with it.
 */
export function seenDotStyle(tone: number): { ink: boolean; alpha: number } {
  const a = level(tone) / LEVELS; // the grain's opacity
  return a >= 0.5 ? { ink: false, alpha: 0.92 } : { ink: true, alpha: Math.min(1, a + 0.5) };
}

function seenDot(c: CanvasRenderingContext2D, p: Particle, fade = 1): void {
  const prev = c.globalAlpha;
  const style = seenDotStyle(p.tone);
  c.fillStyle = style.ink ? pal.ink : pal.paper;
  c.globalAlpha = style.alpha * fade;
  c.beginPath();
  c.arc(p.x, p.y, Math.max(1.2, p.r * 0.26), 0, TAU);
  c.fill();
  c.fillStyle = pal.ink;
  c.globalAlpha = prev;
}

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
    c.fillStyle = pal.ink;
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
    engine.forEachStatic((s) => {
      if (s.viewed && !fadingSet.has(s)) seenDot(c, s);
    });
    this.bakes++;
  }

  private bakeOne(s: Particle): void {
    const c = this.sctx;
    c.globalAlpha = level(s.tone) / LEVELS;
    c.fillStyle = pal.ink;
    c.beginPath();
    c.arc(s.x, s.y, s.r, 0, TAU);
    c.fill();
    c.globalAlpha = 1;
    if (s.viewed) seenDot(c, s);
  }

  /** Switch palette; the caller marks the sediment dirty so settled grains are re-drawn. */
  setTheme(theme: RenderTheme): void {
    pal = PALETTES[theme];
  }

  render(
    engine: PhysicsEngine,
    opts: {
      time: number;
      dt: number;
      selectedEventId?: string | null;
      hoverId?: number | null;
      critical: Particle[];
      /** News from the last hour not yet opened. */
      fresh?: Particle[];
      reducedMotion: boolean;
      balloons?: Balloon[];
    },
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
      c.fillStyle = pal.ink;
      c.beginPath();
      c.arc(p.x, p.y, p.r, 0, TAU);
      c.fill();
      if (p.viewed) seenDot(c, p, p.alpha);
    }
    c.globalAlpha = 1;

    // Falling grains (few): each with its fade-in and age tone.
    c.fillStyle = pal.ink;
    for (const p of engine.actives) {
      p.alpha = Math.min(1, p.alpha + opts.dt * 2.5);
      c.globalAlpha = p.alpha * (level(p.tone) / LEVELS);
      c.beginPath();
      c.arc(p.x, p.y, p.r, 0, TAU);
      c.fill();
      if (p.viewed) seenDot(c, p, p.alpha);
    }
    c.globalAlpha = 1;

    // New in the last hour and not opened yet: a ring that breathes outward like the map
    // marker (each grain on its own rhythm), softer as the hour passes. Static with reduced motion.
    if (opts.fresh?.length) {
      const now = Date.now();
      c.lineWidth = 1.25;
      for (const p of opts.fresh) {
        if (!p.eventId || p.viewed || p.critical || p.newsAt == null) continue;
        const weight = 0.45 + 0.55 * (1 - Math.min(1, (now - p.newsAt) / FRESH_MS));
        if (opts.reducedMotion) {
          c.strokeStyle = `rgba(${pal.rgb},${0.45 * weight})`;
          c.beginPath();
          c.arc(p.x, p.y, p.r + 3, 0, TAU);
          c.stroke();
          continue;
        }
        const t = (now / FRESH_PULSE_MS + p.phase / TAU) % 1;
        c.strokeStyle = `rgba(${pal.rgb},${0.6 * (1 - t) * weight})`;
        c.beginPath();
        c.arc(p.x, p.y, p.r + 2 + t * (p.r * 0.9 + 9), 0, TAU);
        c.stroke();
      }
    }

    // Critical grains: a slow, faint halo — never a flash.
    if (opts.critical.length) {
      c.lineWidth = 1;
      for (const p of opts.critical) {
        if (!p.eventId) continue;
        const pulse = opts.reducedMotion ? 0.5 : 0.5 + 0.5 * Math.sin(opts.time * 0.8 + p.phase);
        c.strokeStyle = `rgba(${pal.rgb},${0.1 + 0.12 * pulse})`;
        c.beginPath();
        c.arc(p.x, p.y, p.r + 3 + 2 * pulse, 0, TAU);
        c.stroke();
      }
    }

    // Selection / hover rings.
    if (opts.selectedEventId || opts.hoverId != null) {
      c.lineWidth = 1.25;
      const ring = (p: Particle, alpha: number, gap: number) => {
        c.strokeStyle = `rgba(${pal.rgb},${alpha})`;
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

    if (opts.balloons?.length) this.drawBalloons(opts.balloons);
  }

  /** Title balloons: up and to the side of the grain, joined to it by a short diagonal. */
  private drawBalloons(balloons: Balloon[]): void {
    const c = this.ctx;
    c.font = BALLOON_FONT;
    c.textBaseline = 'top';
    c.lineWidth = 1;
    const placed: { x: number; y: number; w: number; h: number }[] = [];
    const boxAt = (p: Particle, right: boolean, bw: number, bh: number) => {
      const d = p.r * Math.SQRT1_2;
      const ax = right ? p.x + d : p.x - d;
      const ay = p.y - d;
      return { ax, ay, x: right ? ax + 12 : ax - 12 - bw, y: Math.max(BALLOON_TOP, ay - 12 - bh), w: bw, h: bh };
    };
    const hits = (r: { x: number; y: number; w: number; h: number }) =>
      r.x < 6 || r.x + r.w > this.w - 6 || placed.some((o) => r.x < o.x + o.w + 6 && o.x < r.x + r.w + 6 && r.y < o.y + o.h + 6 && o.y < r.y + r.h + 6);
    for (const b of balloons) {
      if (b.alpha <= 0.01) continue;
      if (!b.lines) {
        b.lines = wrapTitle((s) => c.measureText(s).width, b.text);
        b.width = Math.ceil(Math.max(...b.lines.map((l) => c.measureText(l).width))) + 2 * BALLOON_PAD_X;
      }
      const { p } = b;
      const bw = b.width!;
      const bh = b.lines.length * BALLOON_LINE_H + 2 * BALLOON_PAD_Y - 3;
      // The side is chosen once (no flipping mid-fall): the right, unless it leaves the
      // screen or covers another balloon. With no free side at all, this one is skipped.
      if (b.right === undefined) {
        const rightFree = !hits(boxAt(p, true, bw, bh));
        const leftFree = !hits(boxAt(p, false, bw, bh));
        if (!rightFree && !leftFree && placed.length) b.hidden = true;
        b.right = rightFree || !leftFree;
      }
      if (b.hidden) continue;
      const right = b.right;
      const { ax, ay, x: bx, y: by } = boxAt(p, right, bw, bh);
      placed.push({ x: bx, y: by, w: bw, h: bh });
      c.globalAlpha = b.alpha;
      c.strokeStyle = pal.line;
      c.beginPath();
      c.moveTo(ax, ay);
      c.lineTo(right ? bx : bx + bw, Math.min(by + bh, ay));
      c.stroke();
      c.fillStyle = `rgba(${pal.paperRgb},0.92)`;
      c.beginPath();
      c.roundRect(bx, by, bw, bh, 6);
      c.fill();
      c.stroke();
      c.fillStyle = pal.text;
      b.lines.forEach((l, i) => c.fillText(l, bx + BALLOON_PAD_X, by + BALLOON_PAD_Y + i * BALLOON_LINE_H));
    }
    c.globalAlpha = 1;
    c.fillStyle = pal.ink;
  }
}
