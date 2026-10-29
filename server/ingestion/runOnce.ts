import { bucketId } from '../../shared/feed';
import type { StreamStatus } from '../../shared/types';
import { createEnricher } from '../analysis/llm';
import type { IngestState, SavePlan } from '../firebase/feedStore';
import { planBuckets } from '../firebase/feedStore';
import { Store } from '../persistence/store';
import type { SourceConnector } from '../sources/types';
import { Pipeline } from './pipeline';
import { Scheduler } from './scheduler';

export interface PassOptions {
  retentionHours: number;
  llm?: { anthropicKey?: string; model: string; maxCallsPerHour: number };
  /** Sources polled at the same time. */
  concurrency?: number;
  /** Time budget for polling (ms); slow sources are aborted after it. */
  budgetMs?: number;
  now?: number;
  log?: (msg: string) => void;
}

export interface PassResult {
  plan: SavePlan;
  status: StreamStatus;
  articles: ReturnType<Store['exportArticles']>;
  sourceState: IngestState['sourceState'];
  runtime: IngestState['runtime'];
  seq: number;
  lastEventAt?: string;
  expiredIds: string[];
  polled: number;
  changed: number;
}

/**
 * One ingestion pass for a scheduled job: restores the previous pass's state into an
 * in-memory store, polls the sources that are due, runs the usual pipeline (clustering,
 * analysis, relations) and returns what must be written back. No Firestore here.
 */
export async function runIngestPass(prev: IngestState, connectors: SourceConnector[], opts: PassOptions): Promise<PassResult> {
  const log = opts.log ?? ((m: string) => console.log(m));
  const now = opts.now ?? Date.now();
  const store = new Store(':memory:');
  store.setSeq(prev.seq);
  store.importArticles(prev.articles);
  for (const e of prev.events) store.putEvent(e);
  for (const [id, s] of Object.entries(prev.sourceState)) store.setSourceState(id, s);

  const touched = new Set<string>();
  let lastEventAt = prev.lastEventAt;
  let changed = 0;
  const pipeline = new Pipeline(store, {
    retentionHours: opts.retentionHours,
    enricher: opts.llm?.anthropicKey ? createEnricher(opts.llm) : undefined,
    emit: (m) => {
      touched.add(bucketId(m.event));
      lastEventAt = new Date().toISOString();
      changed++;
    },
  });
  pipeline.warmUp();

  const scheduler = new Scheduler(
    connectors,
    store,
    async (articles, source) => {
      const s = await pipeline.ingest(articles);
      if (s.created || s.updated || s.developments) {
        log(`[ingest:${source.id}] +${s.created} novos, ${s.updated} atualizações, ${s.developments} desdobramentos, ${s.duplicates} duplicados, ${s.skippedOld} antigos`);
      }
    },
    () => undefined,
    log,
  );
  scheduler.importRuntime(prev.runtime);
  const polled = await scheduler.runDue(now, opts.concurrency ?? 6, now + (opts.budgetMs ?? 4 * 60_000));
  scheduler.stop();

  // Retention: expired events leave the feed; their buckets are rewritten (or removed).
  const endIso = new Date().toISOString();
  const byId = new Map(prev.events.map((e) => [e.id, e]));
  const expiredIds = store.purge(endIso, new Date(Date.parse(endIso) - opts.retentionHours * 2 * 3_600_000).toISOString());
  for (const id of expiredIds) {
    const e = byId.get(id) ?? store.getEvent(id);
    if (e) touched.add(bucketId(e));
  }
  pipeline.forget(expiredIds);

  const live = store.recentEvents(100_000, endIso);
  const status: StreamStatus = { sources: scheduler.statuses(), serverTime: endIso, lastEventAt, eventCount: live.length };
  const sourceState: IngestState['sourceState'] = {};
  for (const c of connectors) {
    const s = store.getSourceState(c.id);
    if (Object.keys(s).length) sourceState[c.id] = s;
  }
  const result: PassResult = {
    plan: planBuckets(live, prev.bucketIds, touched),
    status,
    articles: store.exportArticles(),
    sourceState,
    runtime: scheduler.exportRuntime(),
    seq: store.currentSeq(),
    lastEventAt,
    expiredIds,
    polled,
    changed,
  };
  store.close();
  return result;
}
