/**
 * Visual state of one grain. The news event it represents lives elsewhere
 * (src/state/store.ts); a grain only carries the event's id.
 */
export type ParticleState = 'falling' | 'deposited' | 'removed';

export interface Particle {
  id: number;
  /** '' once the event expired: the grain stays as anonymous sand. */
  eventId: string;
  developmentId?: string;
  x: number;
  y: number;
  vx: number;
  vy: number;
  r: number;
  /** Radius the grain is easing towards (impact can be recomputed, e.g. after a city change). */
  targetR: number;
  /** Visual mass ∝ area. */
  mass: number;
  state: ParticleState;
  /** Simulation time (s) of creation. */
  bornAt: number;
  /** Seconds spent slow and supported — deposits when it passes a threshold. */
  restTimer: number;
  impact: number;
  critical: boolean;
  /** Wall-clock ms of the news and of its complete fade-out (age shading). */
  newsAt?: number;
  fadeAt?: number;
  /** 0..1 opacity from age: 1 = just published, 0 = gone. */
  tone: number;
  /** 0..1 fade-in. */
  alpha: number;
  /** Phase for the gentle sideways flutter of light grains. */
  phase: number;
  // Per-step contact bookkeeping (not meaningful outside a step)
  onFloor: boolean;
  supportL: boolean;
  supportR: boolean;
  supportUnder: boolean;
  /** Another grain presses on it from above (buried). */
  supportAbove: boolean;
  /** Spatial-grid bookkeeping. */
  cellKey: number;
}

let nextId = 1;

export function createParticle(init: {
  eventId: string;
  developmentId?: string;
  x: number;
  y: number;
  r: number;
  impact: number;
  critical: boolean;
  bornAt: number;
  newsAt?: number;
  fadeAt?: number;
  vx?: number;
  vy?: number;
}): Particle {
  return {
    id: nextId++,
    eventId: init.eventId,
    developmentId: init.developmentId,
    x: init.x,
    y: init.y,
    vx: init.vx ?? 0,
    vy: init.vy ?? 0,
    r: init.r,
    targetR: init.r,
    mass: init.r * init.r,
    state: 'falling',
    bornAt: init.bornAt,
    restTimer: 0,
    impact: init.impact,
    critical: init.critical,
    newsAt: init.newsAt,
    fadeAt: init.fadeAt,
    tone: 1,
    alpha: 0,
    phase: Math.random() * Math.PI * 2,
    onFloor: false,
    supportL: false,
    supportR: false,
    supportUnder: false,
    supportAbove: false,
    cellKey: Number.NaN,
  };
}
