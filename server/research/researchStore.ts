import type { Firestore } from 'firebase-admin/firestore';
import { FEED_META_ID, type FeedBucketDoc, type FeedMetaDoc } from '../../shared/feed';
import { RESEARCH_COLLECTION, researchBucketId } from '../../shared/research';
import type { NewsEvent, SourceStatus, StreamStatus } from '../../shared/types';
import type { ResearchPass } from './openalex';

/**
 * Writes a research pass to Firestore (`research/d-YYYYMMDD` + `research/_meta`).
 * Each pass is a full picture of the last 30 days, so documents are simply replaced and
 * days that left the window are deleted. A pass that brought nothing keeps the old data
 * and only reports the source as down.
 */
export function researchStatus(pass: ResearchPass, previous: SourceStatus | undefined, now = Date.now()): SourceStatus {
  const nowIso = new Date(now).toISOString();
  const ok = pass.events.length > 0;
  return {
    id: 'openalex',
    name: 'OpenAlex',
    kind: 'journal',
    group: 'research',
    health: ok ? (pass.failedFields.length ? 'degraded' : 'ok') : 'down',
    lastAttemptAt: nowIso,
    lastSuccessAt: ok ? nowIso : previous?.lastSuccessAt,
    lastError: pass.lastError,
    itemsLastFetch: pass.events.length,
    note: pass.failedFields.length ? `${pass.failedFields.length} área(s) sem resposta nesta passada` : undefined,
  };
}

export async function saveResearch(db: Firestore, pass: ResearchPass, now = Date.now()): Promise<{ written: number; removed: number }> {
  const col = db.collection(RESEARCH_COLLECTION);
  const existing = await col.get();
  const prevMeta = existing.docs.find((d) => d.id === FEED_META_ID)?.data() as FeedMetaDoc | undefined;
  let previous: SourceStatus | undefined;
  try {
    previous = (JSON.parse(prevMeta?.status ?? 'null') as StreamStatus | null)?.sources?.[0];
  } catch {
    previous = undefined;
  }
  const updatedAt = new Date(now).toISOString();
  const source = researchStatus(pass, previous, now);
  const batch = db.batch();
  let written = 0;
  let removed = 0;
  if (pass.events.length) {
    const byDay = new Map<string, NewsEvent[]>();
    for (const e of pass.events) {
      const id = researchBucketId(e);
      byDay.set(id, [...(byDay.get(id) ?? []), e]);
    }
    for (const [id, events] of byDay) {
      batch.set(col.doc(id), { events: JSON.stringify(events), updatedAt } satisfies FeedBucketDoc);
      written++;
    }
    for (const d of existing.docs) {
      if (d.id !== FEED_META_ID && !byDay.has(d.id)) {
        batch.delete(d.ref);
        removed++;
      }
    }
  }
  const count = pass.events.length || existing.docs.filter((d) => d.id !== FEED_META_ID).length;
  const status: StreamStatus = { sources: [source], serverTime: updatedAt, eventCount: count, lastEventAt: pass.events.length ? updatedAt : undefined };
  batch.set(col.doc(FEED_META_ID), { status: JSON.stringify(status), updatedAt } satisfies FeedMetaDoc);
  await batch.commit();
  return { written, removed };
}
