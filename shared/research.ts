import type { NewsEvent } from './types';

/**
 * SAND Conhecimento: research works live in their own Firestore collection, with the same
 * document format as the news feed (JSON of NewsEvent[] per document, plus `_meta` with the
 * sources' status), so the browser reads both with the same code.
 * Documents are grouped by publication day: `d-YYYYMMDD`.
 */
export const RESEARCH_COLLECTION = 'research';

/** Research stays in the sand this long after publication (and fades over it). */
export const RESEARCH_WINDOW_DAYS = 30;
export const RESEARCH_WINDOW_HOURS = RESEARCH_WINDOW_DAYS * 24;

export function researchBucketId(e: Pick<NewsEvent, 'publishedAt' | 'firstSeenAt'>): string {
  const d = new Date(e.publishedAt ?? e.firstSeenAt);
  const t = Number.isFinite(d.getTime()) ? d : new Date(0);
  const p = (n: number) => String(n).padStart(2, '0');
  return `d-${t.getUTCFullYear()}${p(t.getUTCMonth() + 1)}${p(t.getUTCDate())}`;
}
