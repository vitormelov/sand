import type { Firestore } from 'firebase-admin/firestore';
import { FEED_COLLECTION, FEED_META_ID, groupByBucket, parseBucket, type FeedBucketDoc, type FeedMetaDoc } from '../../shared/feed';
import type { NewsEvent, StreamStatus } from '../../shared/types';
import type { SourceRuntimeState } from '../ingestion/scheduler';
import type { ArticleRow } from '../persistence/store';
import type { ConnectorState } from '../sources/types';

/**
 * Everything a run-once ingestion pass needs from the previous one. Lives in `ingest/*`,
 * which the security rules keep away from browsers.
 */
export interface IngestState {
  events: NewsEvent[];
  /** Feed buckets that exist now (to delete the ones that end up empty). */
  bucketIds: string[];
  articles: ArticleRow[];
  articleChunks: number;
  sourceState: Record<string, ConnectorState>;
  runtime: Record<string, SourceRuntimeState>;
  seq: number;
  lastEventAt?: string;
}

const INGEST = 'ingest';
const ARTICLES_PER_DOC = 4000;

export async function loadState(db: Firestore): Promise<IngestState> {
  const [feed, meta, sources] = await Promise.all([
    db.collection(FEED_COLLECTION).get(),
    db.collection(INGEST).doc('meta').get(),
    db.collection(INGEST).doc('sources').get(),
  ]);
  const m = (meta.data() ?? {}) as { seq?: number; lastEventAt?: string | null; articleChunks?: number };
  const articleChunks = m.articleChunks ?? 0;
  const chunks = await Promise.all(Array.from({ length: articleChunks }, (_, i) => db.collection(INGEST).doc(`articles-${i}`).get()));
  const articles = chunks.flatMap((c) => parseJson<ArticleRow[]>((c.data() as { rows?: string } | undefined)?.rows, []));
  const s = (sources.data() ?? {}) as { state?: string; runtime?: string };
  const bucketDocs = feed.docs.filter((d) => d.id !== FEED_META_ID);
  return {
    events: bucketDocs.flatMap((d) => parseBucket(d.data() as FeedBucketDoc)),
    bucketIds: bucketDocs.map((d) => d.id),
    articles,
    articleChunks,
    sourceState: parseJson(s.state, {}),
    runtime: parseJson(s.runtime, {}),
    seq: m.seq ?? 0,
    lastEventAt: m.lastEventAt ?? undefined,
  };
}

export interface SavePlan {
  set: Map<string, NewsEvent[]>;
  remove: string[];
}

/** A Firestore document holds at most 1 MiB; feed documents stay well under it. */
const MAX_DOC_CHARS = 600_000;

/**
 * The documents of one hour: `h-YYYYMMDDHH-0`, `-1`… Usually one; a busy hour (or the very
 * first pass, when everything is "first seen" at once) is split so no document gets too big.
 */
export function splitHour(hour: string, events: NewsEvent[], maxChars = MAX_DOC_CHARS): Map<string, NewsEvent[]> {
  const sorted = [...events].sort((a, b) => a.firstSeenAt.localeCompare(b.firstSeenAt) || a.id.localeCompare(b.id));
  const out = new Map<string, NewsEvent[]>();
  let part: NewsEvent[] = [];
  let size = 0;
  for (const e of sorted) {
    const n = JSON.stringify(e).length + 1;
    if (part.length && size + n > maxChars) {
      out.set(`${hour}-${out.size}`, part);
      part = [];
      size = 0;
    }
    part.push(e);
    size += n;
  }
  if (part.length) out.set(`${hour}-${out.size}`, part);
  return out;
}

/** The hour a feed document belongs to (`h-2026102813-1` → `h-2026102813`). */
export const hourOfDoc = (docId: string) => docId.replace(/-\d+$/, '');

/**
 * Which feed documents to write: every part of an hour that holds an event that changed or
 * expired in this pass, plus documents that don't exist yet. Documents with nothing left are
 * removed; untouched hours are not written at all.
 */
export function planBuckets(live: NewsEvent[], previousDocIds: string[], touchedHours: Set<string>, maxChars = MAX_DOC_CHARS): SavePlan {
  const previous = new Set(previousDocIds);
  const docs = new Map<string, NewsEvent[]>();
  for (const [hour, events] of groupByBucket(live)) for (const [id, part] of splitHour(hour, events, maxChars)) docs.set(id, part);
  const set = new Map<string, NewsEvent[]>();
  for (const [id, events] of docs) if (touchedHours.has(hourOfDoc(id)) || !previous.has(id)) set.set(id, events);
  const remove = previousDocIds.filter((id) => !docs.has(id));
  return { set, remove };
}

export async function saveState(
  db: Firestore,
  out: {
    plan: SavePlan;
    status: StreamStatus;
    articles: ArticleRow[];
    previousArticleChunks: number;
    sourceState: Record<string, ConnectorState>;
    runtime: Record<string, SourceRuntimeState>;
    seq: number;
    lastEventAt?: string;
    expiredIds: string[];
  },
): Promise<void> {
  const now = new Date().toISOString();
  const writer = db.bulkWriter();
  // BulkWriter only retries and drops failures; collect them so a bad pass fails loudly.
  const failures: string[] = [];
  writer.onWriteError((err) => {
    if (err.failedAttempts < 3 && err.code !== 3 /* INVALID_ARGUMENT, e.g. too big */) return true;
    failures.push(`${err.documentRef.path}: ${err.message}`);
    return false;
  });
  const feed = db.collection(FEED_COLLECTION);
  for (const [id, events] of out.plan.set) void writer.set(feed.doc(id), { events: JSON.stringify(events), updatedAt: now } satisfies FeedBucketDoc);
  for (const id of out.plan.remove) void writer.delete(feed.doc(id));
  void writer.set(feed.doc(FEED_META_ID), { status: JSON.stringify(out.status), updatedAt: now } satisfies FeedMetaDoc);

  const ingest = db.collection(INGEST);
  const chunks = Math.ceil(out.articles.length / ARTICLES_PER_DOC);
  for (let i = 0; i < chunks; i++) {
    void writer.set(ingest.doc(`articles-${i}`), { rows: JSON.stringify(out.articles.slice(i * ARTICLES_PER_DOC, (i + 1) * ARTICLES_PER_DOC)) });
  }
  for (let i = chunks; i < out.previousArticleChunks; i++) void writer.delete(ingest.doc(`articles-${i}`));
  void writer.set(ingest.doc('sources'), { state: JSON.stringify(out.sourceState), runtime: JSON.stringify(out.runtime), updatedAt: now });
  void writer.set(ingest.doc('meta'), { seq: out.seq, lastEventAt: out.lastEventAt ?? null, articleChunks: chunks, updatedAt: now });
  // Feedback counters of news that left the sand.
  for (const id of out.expiredIds) void writer.delete(db.collection('feedback').doc(id));
  await writer.close();
  if (failures.length) throw new Error(`${failures.length} gravação(ões) falharam no Firestore:\n${failures.slice(0, 5).join('\n')}`);
}

function parseJson<T>(raw: string | undefined, fallback: T): T {
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}
