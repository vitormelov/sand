import { collection, onSnapshot } from 'firebase/firestore';
import { FEED_COLLECTION, FEED_META_ID, parseBucket, parseMeta, type FeedBucketDoc, type FeedMetaDoc } from '../../shared/feed';
import type { NewsEvent, StreamEventMessage } from '../../shared/types';
import type { SandStore } from '../state/store';
import { db } from './firebase';

/** One document of the `feed` collection: an hour of events, or `_meta` (sources' status). */
export interface FeedDoc {
  id: string;
  data: Partial<FeedBucketDoc & FeedMetaDoc>;
}

/** Where the feed comes from: Firestore in the app, a fake in tests. */
export interface FeedSource {
  subscribe(onDocs: (docs: FeedDoc[], fromCache: boolean) => void, onError: (err: unknown) => void): () => void;
}

export const firestoreFeed: FeedSource = {
  subscribe(onDocs, onError) {
    return onSnapshot(
      collection(db(), FEED_COLLECTION),
      { includeMetadataChanges: true },
      (snap) => onDocs(snap.docs.map((d) => ({ id: d.id, data: d.data() as FeedDoc['data'] })), snap.metadata.fromCache),
      onError,
    );
  },
};

/** What changed between two versions of the feed, in the stream's terms. */
export function diffFeed(prev: Map<string, NewsEvent>, next: Map<string, NewsEvent>): { messages: StreamEventMessage[]; expired: string[] } {
  const messages: StreamEventMessage[] = [];
  for (const [id, e] of next) {
    const old = prev.get(id);
    if (!old) {
      messages.push({ change: 'new', event: e });
      continue;
    }
    const known = new Set(old.developments.map((d) => d.id));
    const fresh = e.developments.filter((d) => !known.has(d.id));
    for (const d of fresh) messages.push({ change: 'development', event: e, developmentId: d.id });
    if (!fresh.length && (e.seq !== old.seq || e.updatedAt !== old.updatedAt)) messages.push({ change: 'update', event: e });
  }
  const expired = [...prev.keys()].filter((id) => !next.has(id));
  return { messages, expired };
}

/**
 * Realtime news from Firestore. The first snapshot fills the sand; later snapshots
 * (each ingestion pass) are diffed into new events, developments, updates and expiries.
 */
export class StreamClient {
  private events = new Map<string, NewsEvent>();
  private loaded = false;
  private unsubscribe?: () => void;

  constructor(
    private store: SandStore,
    private source: FeedSource = firestoreFeed,
  ) {}

  start(): void {
    window.addEventListener('online', this.onOnline);
    window.addEventListener('offline', this.onOffline);
    this.unsubscribe = this.source.subscribe(
      (docs, fromCache) => this.apply(docs, fromCache),
      () => this.store.setConnection(navigator.onLine === false ? 'offline' : 'reconnecting'),
    );
  }

  stop(): void {
    this.unsubscribe?.();
    window.removeEventListener('online', this.onOnline);
    window.removeEventListener('offline', this.onOffline);
  }

  private onOnline = () => this.store.setConnection(this.loaded ? 'open' : 'connecting');
  private onOffline = () => this.store.setConnection('offline');

  private apply(docs: FeedDoc[], fromCache: boolean): void {
    const next = new Map<string, NewsEvent>();
    let status;
    for (const d of docs) {
      if (d.id === FEED_META_ID) status = parseMeta(d.data);
      else for (const e of parseBucket(d.data)) next.set(e.id, e);
    }
    if (!this.loaded) {
      // The local cache may answer first with nothing; wait for the server's view.
      if (fromCache && !next.size) return;
      this.loaded = true;
      this.events = next;
      this.store.applySnapshot([...next.values()].sort((a, b) => a.seq - b.seq), status ?? { sources: [], serverTime: new Date().toISOString(), eventCount: next.size });
      return;
    }
    const { messages, expired } = diffFeed(this.events, next);
    this.events = next;
    for (const m of messages) this.store.applyEvent(m);
    if (expired.length) this.store.expire(expired);
    if (status) this.store.applyStatus(status);
    this.store.setConnection(fromCache && navigator.onLine === false ? 'offline' : 'open');
  }
}
