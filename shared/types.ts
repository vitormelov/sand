/**
 * Domain model shared by server and browser.
 *
 * A NewsEvent is information. A Particle (src/simulation) is only its visual
 * representation — the two are intentionally separate.
 */

export const CATEGORIES = [
  'economy',
  'work',
  'technology',
  'health',
  'security',
  'politics',
  'climate',
  'education',
  'sports',
  'culture',
  'mobility',
  'other',
] as const;
export type Category = (typeof CATEGORIES)[number];

/**
 * Consequence channels: *how* an event can reach someone's daily life.
 * Each one carries a practical weight in the impact engine.
 */
export const CHANNELS = [
  'cost_of_living',
  'energy_fuel',
  'interest_credit',
  'employment',
  'public_health',
  'physical_safety',
  'natural_hazard',
  'infrastructure',
  'mobility',
  'rights_governance',
  'digital_services',
  'education_access',
  'environment',
] as const;
export type Channel = (typeof CHANNELS)[number];

export const WORLD_REGIONS = [
  'south_america',
  'central_america_caribbean',
  'north_america',
  'europe',
  'africa',
  'middle_east',
  'south_asia',
  'east_asia',
  'southeast_asia',
  'central_asia',
  'oceania',
] as const;
export type WorldRegion = (typeof WORLD_REGIONS)[number];

/** Geographic hierarchy, from the most local to the most global. */
export type GeoLevel = 'city' | 'state' | 'macroregion' | 'country' | 'world_region' | 'global';

/** How far the consequences of an event plausibly spread. */
export type AffectedScope = 'local' | 'state' | 'national' | 'world_region' | 'global';

export interface GeoRef {
  name: string;
  level: GeoLevel;
  countryCode?: string;
  /** State / province code (e.g. "CE") or normalized name when no code exists. */
  admin1?: string;
  /** For macro-regions (e.g. Brazilian "Nordeste") — the states it contains. */
  admin1List?: string[];
  regions?: WorldRegion[];
  lat?: number;
  lon?: number;
  /** 0..1 — how sure the extractor is that this place is where the event happened. */
  confidence: number;
  /** How it was found: "text", "url-path", "source-metadata", "official-feed", "llm"... */
  via: string;
}

export interface ChannelSignal {
  channel: Channel;
  /** 0..1 */
  strength: number;
  /** Matched cues, for transparency in the details panel. */
  evidence: string[];
}

/** Profile-independent analysis produced on the server. */
export interface Analysis {
  categories: Category[];
  channels: ChannelSignal[];
  locations: GeoRef[];
  affectedScope: AffectedScope;
  /** 0..1 — reach and gravity of the event itself. */
  severity: number;
  severityEvidence: string[];
  /** 0..1 — language/metadata indicating immediacy. */
  urgency: number;
  /** True for physical-risk events (disasters, violence, outbreaks). */
  hazard: boolean;
  entities: string[];
  analyzer: 'rules' | 'rules+llm';
  /** 0..1 — how well categories/channels were identified. */
  classificationConfidence: number;
}

export type SourceKind = 'official' | 'agency' | 'outlet' | 'aggregator';

/** How sources are grouped in the settings list. */
export const SOURCE_GROUPS = ['national', 'regional', 'official', 'alerts', 'climate', 'economy', 'sports', 'international', 'aggregators'] as const;
export type SourceGroup = (typeof SOURCE_GROUPS)[number];

export type RelationKind = 'documented' | 'probable' | 'possible' | 'unconfirmed';

export interface EventRelation {
  eventId: string;
  kind: RelationKind;
  /** e.g. "energy_fuel → cost_of_living" */
  link: string;
  explanation: string;
}

export interface Development {
  id: string;
  at: string;
  title: string;
  url: string;
  sourceName: string;
  reason: string;
}

export type Verification = 'official' | 'single_source' | 'corroborated';

/** A consolidated event (cluster of articles about the same happening). */
export interface NewsEvent {
  id: string;
  /** Monotonic stream sequence of the latest change — used for SSE resume. */
  seq: number;
  title: string;
  summary?: string;
  url: string;
  sourceName: string;
  sourceUrl?: string;
  sourceKind: SourceKind;
  /** 0..1 */
  sourceReliability: number;
  /** Country of the publishing outlet (not of the event). */
  sourceCountry?: string;
  language?: string;
  /** When the happening itself occurred (only when the source states it, e.g. USGS). */
  occurredAt?: string;
  /** When the (first) article was published. */
  publishedAt?: string;
  /** When SAND first received it. */
  firstSeenAt: string;
  /** Last time SAND processed new information about it. */
  updatedAt: string;
  expiresAt: string;
  articleCount: number;
  sources: string[];
  /** Ids of the connectors that covered it (for per-user source filters). */
  sourceIds?: string[];
  analysis: Analysis;
  verification: Verification;
  relations: EventRelation[];
  developments: Development[];
  /** Only ever true in explicit DEMO mode. Real events never set this. */
  demo?: boolean;
}

export type SourceHealth = 'ok' | 'degraded' | 'down' | 'disabled' | 'pending';

export interface SourceStatus {
  id: string;
  name: string;
  kind: SourceKind;
  group?: SourceGroup;
  /** The outlet may ask for a subscription to read the full article. */
  paywall?: boolean;
  health: SourceHealth;
  lastSuccessAt?: string;
  lastAttemptAt?: string;
  lastError?: string;
  nextAttemptAt?: string;
  itemsLastFetch?: number;
  note?: string;
}

export interface StreamStatus {
  sources: SourceStatus[];
  serverTime: string;
  lastEventAt?: string;
  eventCount: number;
}

export type StreamChange = 'new' | 'update' | 'development';

export interface StreamEventMessage {
  change: StreamChange;
  event: NewsEvent;
  developmentId?: string;
}

/** Minimal location profile — stays in the browser. */
export interface UserLocation {
  name: string;
  admin1?: string;
  admin1Name?: string;
  countryCode: string;
  countryName: string;
  /** City centroid rounded to 1 decimal (~11 km). Never GPS. */
  lat?: number;
  lon?: number;
}

export interface UserProfile {
  location?: UserLocation;
  interests: Category[];
  /** Bounded per-category bias (-10..+10 points) learned from explicit feedback. */
  affinity: Partial<Record<Category, number>>;
}
