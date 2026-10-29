import { vi } from 'vitest';
import { FEED_META_ID, groupByBucket } from '../../shared/feed';
import type { NewsEvent, StreamStatus } from '../../shared/types';
import type { FeedDoc, FeedSource } from '../../src/services/stream';

/** Browser APIs jsdom lacks. The canvas is stubbed: these tests cover the UI, not pixels. */
export function installDomStubs() {
  const ctx = new Proxy({}, { get: (_t, k) => (k === 'canvas' ? undefined : () => undefined), set: () => true });
  HTMLCanvasElement.prototype.getContext = vi.fn(() => ctx) as never;
  (globalThis as any).ResizeObserver = class {
    observe() {}
    disconnect() {}
  };
  window.matchMedia = vi.fn((q: string) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {} })) as never;
  let raf = 0;
  window.requestAnimationFrame = ((cb: FrameRequestCallback) => setTimeout(() => cb(performance.now()), 16) as unknown as number) as never;
  window.cancelAnimationFrame = ((id: number) => clearTimeout(id)) as never;
  void raf;
  localStorage.clear();
}

/** Controllable news feed (what Firestore delivers in the app). */
export class FakeFeed implements FeedSource {
  static instances: FakeFeed[] = [];
  private onDocs?: (docs: FeedDoc[], fromCache: boolean) => void;
  private onError?: (err: unknown) => void;
  constructor() {
    FakeFeed.instances.push(this);
  }
  subscribe(onDocs: (docs: FeedDoc[], fromCache: boolean) => void, onError: (err: unknown) => void) {
    this.onDocs = onDocs;
    this.onError = onError;
    return () => {
      this.onDocs = undefined;
    };
  }
  /** The whole feed as it is now: these events (bucketed by hour) and this status. */
  emit(events: NewsEvent[], status?: StreamStatus) {
    const docs: FeedDoc[] = [...groupByBucket(events)].map(([id, evs]) => ({ id, data: { events: JSON.stringify(evs), updatedAt: '' } }));
    if (status) docs.push({ id: FEED_META_ID, data: { status: JSON.stringify(status), updatedAt: '' } });
    this.onDocs?.(docs, false);
  }
  fail() {
    this.onError?.(new Error('unavailable'));
  }
  static latest() {
    return FakeFeed.instances[FakeFeed.instances.length - 1];
  }
}
