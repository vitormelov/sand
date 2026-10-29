/**
 * One ingestion pass: Firestore state in → poll due sources → Firestore state out.
 * Run every ~5 minutes by .github/workflows/ingest.yml (`npm run ingest`).
 */
import '../server/env';
import { buildConnectors, config } from '../server/config';
import { adminDb } from '../server/firebase/admin';
import { loadState, saveState } from '../server/firebase/feedStore';
import { runIngestPass } from '../server/ingestion/runOnce';

const started = Date.now();
const db = adminDb();
const prev = await loadState(db);
console.log(`estado anterior: ${prev.events.length} eventos em ${prev.bucketIds.length} hora(s), ${prev.articles.length} artigos conhecidos`);

const result = await runIngestPass(prev, buildConnectors(), {
  retentionHours: config.retentionHours,
  llm: config.llm,
  budgetMs: Number(process.env.INGEST_BUDGET_MS ?? 4 * 60_000),
});

await saveState(db, { ...result, previousArticleChunks: prev.articleChunks });
const ok = result.status.sources.filter((s) => s.health === 'ok').length;
console.log(
  `${result.polled} fonte(s) consultada(s), ${result.changed} mudança(s), ${result.expiredIds.length} expirado(s); ` +
    `${result.status.eventCount} eventos no ar; ${result.plan.set.size} hora(s) gravada(s), ${result.plan.remove.length} removida(s); ` +
    `${ok}/${result.status.sources.filter((s) => s.health !== 'disabled').length} fontes ok; ${((Date.now() - started) / 1000).toFixed(1)} s`,
);
process.exit(0);
