/**
 * Live check against the real sources (no mocks):
 *   npm run verify:sources            all enabled sources
 *   npm run verify:sources -- usgs g1 only these ids
 *
 * For each source: fetch once, normalize, analyze, and score for a sample profile
 * (Fortaleza, CE) so the impact distribution can be inspected by eye.
 */
import { buildConnectors } from '../server/config';
import { normalizeItem } from '../server/normalization/normalize';
import { analyzeArticle } from '../server/analysis/rules';
import { computeImpact } from '../shared/impact/engine';
import type { UserProfile } from '../shared/types';

const only = new Set(process.argv.slice(2));
const profile: UserProfile = {
  location: { name: 'Fortaleza', admin1: 'CE', admin1Name: 'Ceará', countryCode: 'BR', countryName: 'Brasil', lat: -3.7, lon: -38.5 },
  interests: [],
  affinity: {},
};

const results: { id: string; ok: boolean; items: number; note: string }[] = [];
for (const c of buildConnectors()) {
  if (only.size && !only.has(c.id)) continue;
  if (!c.enabled) {
    results.push({ id: c.id, ok: false, items: 0, note: `desativada: ${c.disabledReason}` });
    continue;
  }
  const t0 = Date.now();
  try {
    const res = await c.fetch({ signal: AbortSignal.timeout(60_000), state: {}, now: Date.now() });
    const fetchedAt = new Date().toISOString();
    const arts = res.items.map((i) => normalizeItem(i, c, fetchedAt)).filter((x) => !!x);
    const scored = arts.map((a) => {
      const analysis = analyzeArticle(a);
      const impact = computeImpact({ ...a, analysis, articleCount: 1, verification: a.sourceKind === 'official' ? 'official' : 'single_source', firstSeenAt: fetchedAt }, profile);
      return { a, analysis, impact };
    });
    scored.sort((x, y) => y.impact.score - x.impact.score);
    const withDate = arts.filter((a) => a.publishedAt || a.occurredAt).length;
    const withLoc = scored.filter((s) => s.analysis.locations.length).length;
    console.log(`\n■ ${c.name} [${c.id}] — ${arts.length}/${res.items.length} válidos em ${Date.now() - t0} ms · com data: ${withDate} · com local: ${withLoc}`);
    for (const s of [...scored.slice(0, 4), ...scored.slice(-2)]) {
      const locs = s.analysis.locations.map((l) => `${l.name}(${l.level})`).join(', ') || '—';
      console.log(`  ${String(s.impact.score).padStart(3)} conf ${s.impact.confidence.toFixed(2)} | ${s.analysis.categories.join('/')} | ${locs} | ${s.a.title.slice(0, 90)}`);
    }
    results.push({ id: c.id, ok: true, items: arts.length, note: '' });
  } catch (err) {
    console.log(`\n■ ${c.name} [${c.id}] — FALHOU: ${(err as Error).message.slice(0, 200)}`);
    results.push({ id: c.id, ok: false, items: 0, note: (err as Error).message.slice(0, 120) });
  }
}
console.log('\nResumo:');
for (const r of results) console.log(`  ${r.ok ? '✓' : '✗'} ${r.id.padEnd(16)} ${r.ok ? `${r.items} itens` : r.note}`);
