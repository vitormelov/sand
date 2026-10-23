import type { NewsEvent, StreamEventMessage, StreamStatus } from '../../shared/types';
import type { SandStore } from '../state/store';

/**
 * SSE client. EventSource reconnects by itself and sends Last-Event-ID, so the
 * server replays only what changed. If the browser gives up (non-200, e.g. the
 * server was restarting), we reconnect manually with exponential backoff and
 * `?since=<last seq>`.
 */
export class StreamClient {
  private es?: EventSource;
  private lastSeq = 0;
  private retryMs = 3_000;
  private timer?: ReturnType<typeof setTimeout>;
  private closed = false;

  constructor(
    private store: SandStore,
    private url = '/api/stream',
  ) {}

  start(): void {
    this.closed = false;
    this.connect();
    window.addEventListener('online', this.onOnline);
    window.addEventListener('offline', this.onOffline);
  }

  stop(): void {
    this.closed = true;
    clearTimeout(this.timer);
    this.es?.close();
    window.removeEventListener('online', this.onOnline);
    window.removeEventListener('offline', this.onOffline);
  }

  private onOnline = () => {
    if (this.es?.readyState !== EventSource.OPEN) {
      this.retryMs = 3_000;
      this.reconnectSoon(200);
    }
  };

  private onOffline = () => this.store.setConnection('offline');

  private connect(): void {
    if (this.closed) return;
    this.es?.close();
    const url = this.lastSeq > 0 ? `${this.url}?since=${this.lastSeq}` : this.url;
    const es = new EventSource(url);
    this.es = es;

    es.onopen = () => {
      this.retryMs = 3_000;
      this.store.setConnection('open');
    };
    es.onerror = () => {
      if (es.readyState === EventSource.CLOSED) {
        this.store.setConnection(navigator.onLine === false ? 'offline' : 'reconnecting');
        this.reconnectSoon(this.retryMs);
        this.retryMs = Math.min(60_000, this.retryMs * 2);
      } else {
        this.store.setConnection(navigator.onLine === false ? 'offline' : 'reconnecting');
      }
    };
    es.addEventListener('snapshot', (ev) => {
      const data = safeParse<{ events: NewsEvent[]; status: StreamStatus }>((ev as MessageEvent).data);
      if (!data) return;
      this.trackSeq(ev as MessageEvent);
      this.store.applySnapshot(data.events, data.status);
    });
    es.addEventListener('event', (ev) => {
      const msg = safeParse<StreamEventMessage>((ev as MessageEvent).data);
      if (!msg?.event?.id) return;
      this.trackSeq(ev as MessageEvent);
      this.store.applyEvent(msg);
    });
    es.addEventListener('status', (ev) => {
      const s = safeParse<StreamStatus>((ev as MessageEvent).data);
      if (s) this.store.applyStatus(s);
    });
    es.addEventListener('expire', (ev) => {
      const d = safeParse<{ ids: string[] }>((ev as MessageEvent).data);
      if (d?.ids) this.store.expire(d.ids);
    });
  }

  private trackSeq(ev: MessageEvent): void {
    const id = Number(ev.lastEventId);
    if (Number.isFinite(id) && id > this.lastSeq) this.lastSeq = id;
  }

  private reconnectSoon(ms: number): void {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.connect(), ms);
  }
}

function safeParse<T>(s: string): T | undefined {
  try {
    return JSON.parse(s) as T;
  } catch {
    return undefined;
  }
}
