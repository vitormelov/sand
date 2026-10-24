import type { Channel } from '../types';

/**
 * Single source of truth for every tunable number of the Personal Impact Engine.
 * See docs/IMPACT_ENGINE.md for the rationale behind each value.
 */
export const IMPACT_WEIGHTS = {
  /** Practical consequence for the user's life (channel weight × exposure). */
  practical: 0.3,
  /** Geographic proximity and exposure (origin + affected scope). */
  exposure: 0.25,
  /** Reach and gravity of the event itself. */
  severity: 0.2,
  /** Connection with the user's optional interests. */
  interest: 0.15,
  /** Urgency and recency. */
  urgency: 0.1,
} as const;

export type FactorKey = keyof typeof IMPACT_WEIGHTS;

/** How directly each channel touches day-to-day life (0..1). */
export const CHANNEL_PRACTICAL_WEIGHT: Record<Channel, number> = {
  physical_safety: 0.9,
  natural_hazard: 1,
  public_health: 0.85,
  cost_of_living: 0.8,
  energy_fuel: 0.75,
  employment: 0.75,
  interest_credit: 0.7,
  infrastructure: 0.7,
  mobility: 0.6,
  rights_governance: 0.5,
  education_access: 0.5,
  digital_services: 0.45,
  environment: 0.4,
};

/**
 * Channels whose effects stay where they happen (a storm, a fire, a shooting).
 * Their practical value decays faster with distance: weight × exposure^1.5.
 */
export const LOCAL_ACTING_CHANNELS: Channel[] = ['natural_hazard', 'physical_safety', 'infrastructure', 'mobility'];
export const LOCAL_ACTING_EXPONENT = 1.5;

/** Practical value when no consequence channel was identified. */
export const NO_CHANNEL_PRACTICAL = 0.1;

/** Proximity of an event's place to the user, by relationship. */
export const PROXIMITY = {
  sameCity: 1,
  within60km: 0.92,
  within200km: 0.78,
  sameState: 0.75,
  sameMacroregion: 0.62,
  within800km: 0.6,
  sameCountry: 0.55,
  sameWorldRegion: 0.3,
  elsewhere: 0.12,
  /** Same country, but a localized hazard (storm, fire, crime) elsewhere in it. */
  sameCountryLocalHazard: 0.35,
  /** Location unknown and no hint from the source. */
  unknown: 0.25,
  /** Location unknown but the source is a national outlet of the user's country. */
  unknownDomesticSource: 0.45,
} as const;

/** How strongly an event "travels" to the user given its affected scope. */
export const SCOPE_TRANSMISSION = {
  global: 0.7,
  sameWorldRegion: 0.5,
  sameCountryNational: 0.72,
  sameStateWide: 0.82,
} as const;

export const INTEREST = {
  matched: 1,
  neutralNoInterests: 0.5,
  unmatched: 0.25,
  /** Max absolute affinity bias (score points) from explicit feedback. */
  maxAffinityPoints: 10,
  /** Points added per feedback click. */
  feedbackStep: 2,
} as const;

/** Recency half-life used inside the urgency factor. */
export const RECENCY_HALF_LIFE_HOURS = 8;

/**
 * Special rules (documented in docs/IMPACT_ENGINE.md).
 */
export const RULES = {
  /** Immediate risk near the user: hazard + severity + proximity + fresh. */
  // minProximity 0.78 = same city or within ~200 km. A warning somewhere else in a
  // large state is "high", not "emergency".
  emergency: { minSeverity: 0.5, minProximity: 0.78, maxAgeHours: 24, floorBase: 80, floorPerSeverity: 15 },
  /** Catastrophic events with global reach get a floor even when far away. */
  globalCatastrophe: { minSeverity: 0.9, floor: 60 },
  /** Low-evidence events cannot reach extreme sizes without justification. */
  lowConfidence: { maxConfidence: 0.35, cap: 70 },
  /** Soft news (sports/culture with no consequence channel) stays small. */
  softNews: { cap: 35 },
} as const;

/** Personal-answer rules (see shared/impact/personal.ts). */
export const PERSONAL = {
  /** A place the user marked as important counts as this fraction of their own city. */
  placeWeight: 0.85,
  /** Topics the user wants to see less of are scaled down (never emergencies near them). */
  avoidFactor: 0.6,
  /** Headline mentions the user's football club. */
  clubBonus: 8,
  clubSoftCap: 50,
} as const;

export const IMPACT_BANDS = [
  { max: 20, id: 'very_low', label: 'muito baixo' },
  { max: 40, id: 'low', label: 'baixo' },
  { max: 60, id: 'moderate', label: 'moderado' },
  { max: 80, id: 'high', label: 'alto' },
  { max: 101, id: 'critical', label: 'muito alto' },
] as const;
export type ImpactBand = (typeof IMPACT_BANDS)[number]['id'];

/**
 * Score → radius control points (px, before the user's size multiplier).
 * Interpolated with a monotone cubic so the curve is smooth and never overshoots.
 * Large grains are deliberately rare: the curve stays flat until ~60.
 */
export const RADIUS_CURVE: [score: number, radius: number][] = [
  // Desktop-first: even the least impactful grain is clearly visible and easy to click.
  // (Phones render at 60% — see SandSimulation.)
  // Wide spread so impact levels are told apart at a glance.
  [0, 7],
  [20, 10],
  [40, 14],
  [60, 20],
  [80, 30],
  [100, 50],
];
