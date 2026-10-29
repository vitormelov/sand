import type { NewsEvent, StreamStatus } from './types';

/**
 * Firestore layout of the public news feed, shared by the ingestion job (writes) and
 * the browser (reads). Events are grouped in one document per hour of first sighting, so
 * a realtime update only re-sends the hours that changed. Payloads are JSON strings:
 * Firestore can't store nested arrays or `undefined`, and nobody queries inside them.
 */
export const FEED_COLLECTION = 'feed';
export const FEED_META_ID = '_meta';

export interface FeedBucketDoc {
  /** JSON of NewsEvent[]. */
  events: string;
  updatedAt: string;
}

export interface FeedMetaDoc {
  /** JSON of StreamStatus. */
  status: string;
  updatedAt: string;
}

/** `h-YYYYMMDDHH` (UTC) of when the event was first seen. */
export function bucketId(e: Pick<NewsEvent, 'firstSeenAt'>): string {
  const d = new Date(e.firstSeenAt);
  const t = Number.isFinite(d.getTime()) ? d : new Date(0);
  const p = (n: number) => String(n).padStart(2, '0');
  return `h-${t.getUTCFullYear()}${p(t.getUTCMonth() + 1)}${p(t.getUTCDate())}${p(t.getUTCHours())}`;
}

export function groupByBucket(events: Iterable<NewsEvent>): Map<string, NewsEvent[]> {
  const out = new Map<string, NewsEvent[]>();
  for (const e of events) {
    const id = bucketId(e);
    let list = out.get(id);
    if (!list) out.set(id, (list = []));
    list.push(e);
  }
  return out;
}

export function parseBucket(doc: Partial<FeedBucketDoc> | undefined): NewsEvent[] {
  try {
    const v = JSON.parse(doc?.events ?? '[]') as unknown;
    return Array.isArray(v) ? (v.filter((e) => e && typeof e === 'object' && typeof (e as NewsEvent).id === 'string') as NewsEvent[]) : [];
  } catch {
    return [];
  }
}

export function parseMeta(doc: Partial<FeedMetaDoc> | undefined): StreamStatus | undefined {
  try {
    const v = JSON.parse(doc?.status ?? 'null') as StreamStatus | null;
    return v && Array.isArray(v.sources) ? v : undefined;
  } catch {
    return undefined;
  }
}
