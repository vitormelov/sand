import type { AffectedScope, Category, ChannelSignal, GeoRef, SourceKind } from '../shared/types';

/** Source-provided structured hints (official feeds know magnitude, coordinates, alert level...). */
export interface ArticleHints {
  locations?: GeoRef[];
  severity?: number;
  severityEvidence?: string[];
  hazard?: boolean;
  channels?: ChannelSignal[];
  categories?: Category[];
  urgency?: number;
  affectedScope?: AffectedScope;
  /** Stable identity of the underlying happening when the source provides one (e.g. USGS event id). */
  eventKey?: string;
  /** For geo-temporal clustering of hazards across sources (e.g. "EQ", "FL", "TC"). */
  hazardType?: string;
  /** Areas covered (e.g. UFs of a weather warning) — overlapping areas + same hazard = same event. */
  areaKeys?: string[];
  /** Source-side revision marker: a change means the record was materially updated. */
  revision?: string;
}

/** Unified internal record produced by every connector after normalization. */
export interface NormalizedArticle {
  id: string;
  canonicalUrl: string;
  url: string;
  title: string;
  summary?: string;
  sourceId: string;
  sourceName: string;
  sourceUrl?: string;
  sourceKind: SourceKind;
  sourceReliability: number;
  sourceCountry?: string;
  language?: string;
  occurredAt?: string;
  publishedAt?: string;
  fetchedAt: string;
  hints: ArticleHints;
}

/** What a connector returns before normalization (loosely typed on purpose). */
export interface RawItem {
  title?: string;
  url?: string;
  summary?: string;
  publishedAt?: string | number | Date;
  occurredAt?: string | number | Date;
  language?: string;
  sourceName?: string;
  sourceCountry?: string;
  hints?: ArticleHints;
}
