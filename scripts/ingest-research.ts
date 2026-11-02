/**
 * SAND Conhecimento: one pass over OpenAlex → Firestore (`research/*`).
 * Run every 6 hours by .github/workflows/research.yml (`npm run ingest:research`).
 * Optional OPENALEX_API_KEY (free at https://openalex.org/settings/api): without it, requests
 * share OpenAlex's free daily budget with everyone on the same IP address.
 */
import '../server/env';
import { adminDb } from '../server/firebase/admin';
import { fetchRecentResearch } from '../server/research/openalex';
import { saveResearch } from '../server/research/researchStore';

const started = Date.now();
const pass = await fetchRecentResearch({ apiKey: process.env.OPENALEX_API_KEY || undefined, signal: AbortSignal.timeout(8 * 60_000) });
const { written, removed } = await saveResearch(adminDb(), pass);
console.log(
  `${pass.events.length} pesquisa(s) em ${pass.requests} requisição(ões); ${written} dia(s) gravado(s), ${removed} removido(s); ` +
    `${pass.failedFields.length ? `áreas sem resposta: ${pass.failedFields.join(', ')}; ` : ''}${pass.lastError ? `último erro: ${pass.lastError}; ` : ''}` +
    `${((Date.now() - started) / 1000).toFixed(1)} s`,
);
process.exit(pass.events.length ? 0 : 1);
