import type { SourceStatus } from '../../shared/types';
import { normalizeItem } from '../normalization/normalize';
import type { Store } from '../persistence/store';
import { HttpError, type SourceConnector } from '../sources/types';
import type { NormalizedArticle } from '../types';

const MAX_BACKOFF_MS = 60 * 60_000;

interface Runtime {
  connector: SourceConnector;
  status: SourceStatus;
  failures: number;
  timer?: NodeJS.Timeout;
  running: boolean;
  retryAfterMs?: number;
}

/**
 * Polls every connector on its own schedule. Each source fails independently:
 * timeouts, malformed data or rate limits only back that source off
 * (exponential, with jitter, honouring Retry-After) — the others keep flowing.
 */
export class Scheduler {
  private runtimes: Runtime[];
  private stopped = false;
  private abort = new AbortController();

  constructor(
    connectors: SourceConnector[],
    private store: Store,
    private onArticles: (articles: NormalizedArticle[], source: SourceConnector) => Promise<void>,
    private onStatus: () => void,
    private log: (msg: string) => void = (m) => console.log(m),
  ) {
    this.runtimes = connectors.map((c) => ({
      connector: c,
      failures: 0,
      running: false,
      status: {
        id: c.id,
        name: c.name,
        kind: c.kind,
        group: c.group,
        paywall: c.paywall,
        health: c.enabled ? 'pending' : 'disabled',
        note: c.enabled ? undefined : c.disabledReason,
      },
    }));
  }

  statuses(): SourceStatus[] {
    return this.runtimes.map((r) => ({ ...r.status }));
  }

  start(): void {
    this.runtimes
      .filter((r) => r.connector.enabled)
      .forEach((r, i) => this.schedule(r, 1_500 + i * 2_500)); // stagger first polls
  }

  stop(): void {
    this.stopped = true;
    this.abort.abort();
    for (const r of this.runtimes) clearTimeout(r.timer);
  }

  /** Run one connector immediately (used by tests and the verify script). */
  async runOnce(id: string): Promise<SourceStatus | undefined> {
    const r = this.runtimes.find((x) => x.connector.id === id);
    if (!r) return undefined;
    await this.poll(r);
    return { ...r.status };
  }

  private schedule(r: Runtime, delayMs: number): void {
    if (this.stopped) return;
    clearTimeout(r.timer);
    r.status.nextAttemptAt = new Date(Date.now() + delayMs).toISOString();
    r.timer = setTimeout(() => {
      void this.poll(r).finally(() => {
        const base = r.connector.intervalMs;
        const next =
          r.failures === 0
            ? base
            : Math.min(MAX_BACKOFF_MS, Math.max(r.connector.minSpacingMs ?? 0, base * 2 ** Math.min(r.failures - 1, 6)));
        const retryAfter = r.retryAfterMs ?? 0;
        const jitter = 0.85 + Math.random() * 0.3;
        this.schedule(r, Math.max(next * jitter, retryAfter));
      });
    }, delayMs);
    r.timer.unref?.();
  }

  private async poll(r: Runtime): Promise<void> {
    if (r.running || this.stopped) return;
    r.running = true;
    const c = r.connector;
    const startedAt = Date.now();
    r.status.lastAttemptAt = new Date(startedAt).toISOString();
    r.retryAfterMs = undefined;
    try {
      const res = await c.fetch({ signal: this.abort.signal, state: this.store.getSourceState(c.id), now: startedAt });
      if (res.state) this.store.setSourceState(c.id, res.state);
      const fetchedAt = new Date().toISOString();
      const normalized: NormalizedArticle[] = [];
      let rejected = 0;
      for (const item of res.items) {
        const n = normalizeItem(item, c, fetchedAt);
        if (n) normalized.push(n);
        else rejected++;
      }
      await this.onArticles(normalized, c);
      r.failures = 0;
      r.status.health = 'ok';
      r.status.lastSuccessAt = fetchedAt;
      r.status.lastError = undefined;
      r.status.itemsLastFetch = res.notModified ? 0 : normalized.length;
      r.status.note = res.notModified ? 'sem alterações (304)' : rejected ? `${rejected} item(ns) malformado(s) ignorado(s)` : undefined;
    } catch (err) {
      r.failures++;
      const e = err as Error;
      const msg = e instanceof HttpError ? e.message : `${e.name}: ${e.message}`;
      if (e instanceof HttpError && e.retryAfterMs) r.retryAfterMs = e.retryAfterMs;
      if (e instanceof HttpError && e.status === 429) {
        r.retryAfterMs = Math.max(e.retryAfterMs ?? 0, 10 * 60_000);
      }
      r.status.health = r.failures >= 3 ? 'down' : 'degraded';
      r.status.lastError = msg.slice(0, 200);
      this.log(`[source:${c.id}] falha #${r.failures}: ${msg.slice(0, 200)}`);
    } finally {
      r.running = false;
      this.onStatus();
    }
  }
}
