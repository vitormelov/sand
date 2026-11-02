import { countryInfo } from '../../shared/geo/gazetteer';
import { RESEARCH_WINDOW_DAYS } from '../../shared/research';
import type { Category, GeoRef, NewsEvent, ResearchInfo } from '../../shared/types';
import { analyzeArticle } from '../analysis/rules';
import { safeHttpUrl, toPlainText } from '../normalization/normalize';
import { httpGet } from '../sources/http';

/**
 * SAND Conhecimento — recent research from OpenAlex (https://openalex.org, data under CC0).
 *
 * One pass: for each of OpenAlex's 26 research fields, the most cited works of the last
 * 30 days (articles and reviews with an abstract), minus re-dated old papers; then the
 * journals' impact in one batch. Each work becomes a NewsEvent with `research` set, so the
 * browser handles it like news; the grain size mixes personal relevance (computed in the
 * browser) with the scientific weight computed here.
 */

const API = 'https://api.openalex.org';
const PER_FIELD_FETCH = 40;
const PER_FIELD_KEEP = 18;
const SUMMARY_MAX = 420;

/** OpenAlex fields → SAND categories (what the interest questions and filters use). */
export const FIELDS: { id: number; name: string; categories: Category[] }[] = [
  { id: 11, name: 'Ciências agrárias e biológicas', categories: ['climate'] },
  { id: 12, name: 'Artes e humanidades', categories: ['culture'] },
  { id: 13, name: 'Bioquímica, genética e biologia molecular', categories: ['health'] },
  { id: 14, name: 'Administração e negócios', categories: ['economy', 'work'] },
  { id: 15, name: 'Engenharia química', categories: ['technology'] },
  { id: 16, name: 'Química', categories: ['technology'] },
  { id: 17, name: 'Ciência da computação', categories: ['technology'] },
  { id: 18, name: 'Ciências da decisão', categories: ['economy'] },
  { id: 19, name: 'Ciências da Terra e planetárias', categories: ['climate'] },
  { id: 20, name: 'Economia e finanças', categories: ['economy'] },
  { id: 21, name: 'Energia', categories: ['technology', 'climate'] },
  { id: 22, name: 'Engenharia', categories: ['technology'] },
  { id: 23, name: 'Ciências ambientais', categories: ['climate'] },
  { id: 24, name: 'Imunologia e microbiologia', categories: ['health'] },
  { id: 25, name: 'Ciência dos materiais', categories: ['technology'] },
  { id: 26, name: 'Matemática', categories: ['technology'] },
  { id: 27, name: 'Medicina', categories: ['health'] },
  { id: 28, name: 'Neurociência', categories: ['health'] },
  { id: 29, name: 'Enfermagem', categories: ['health'] },
  { id: 30, name: 'Farmacologia e toxicologia', categories: ['health'] },
  { id: 31, name: 'Física e astronomia', categories: ['technology'] },
  { id: 32, name: 'Psicologia', categories: ['health'] },
  { id: 33, name: 'Ciências sociais', categories: ['education'] },
  { id: 34, name: 'Veterinária', categories: ['health'] },
  { id: 35, name: 'Odontologia', categories: ['health'] },
  { id: 36, name: 'Profissões da saúde', categories: ['health'] },
];

/** Social sciences are broad: the subfield says more (politics, transport, work...). */
function subfieldCategories(subfield: string | undefined, base: Category[]): Category[] {
  const s = subfield ?? '';
  if (/politic|law|public administration/i.test(s)) return ['politics'];
  if (/transport|urban/i.test(s)) return ['mobility'];
  if (/labor|industrial relations/i.test(s)) return ['work'];
  if (/safety|risk|criminolog/i.test(s)) return ['security'];
  if (/education/i.test(s)) return ['education'];
  return base;
}

interface OpenAlexWork {
  id: string;
  doi?: string | null;
  title?: string | null;
  publication_date?: string;
  publication_year?: number;
  language?: string | null;
  cited_by_count?: number;
  fwci?: number | null;
  counts_by_year?: { year: number; cited_by_count: number }[];
  abstract_inverted_index?: Record<string, number[]> | null;
  primary_location?: { landing_page_url?: string | null; source?: { id?: string; display_name?: string; is_core?: boolean } | null } | null;
  primary_topic?: { display_name?: string; field?: { id?: string; display_name?: string }; subfield?: { display_name?: string } } | null;
  authorships?: { author?: { display_name?: string }; countries?: string[] }[];
  open_access?: { is_oa?: boolean } | null;
}

const SELECT = [
  'id', 'doi', 'title', 'publication_date', 'publication_year', 'language', 'cited_by_count', 'fwci', 'counts_by_year',
  'abstract_inverted_index', 'primary_location', 'primary_topic', 'authorships', 'open_access',
].join(',');

export interface OpenAlexOptions {
  /** Free key from https://openalex.org/settings/api: its own daily budget instead of a shared one. */
  apiKey?: string;
  now?: number;
  signal?: AbortSignal;
  /** Pause between requests (OpenAlex asks for at most ~10/s). */
  gapMs?: number;
}

function withAuth(url: string, opts: OpenAlexOptions): string {
  return opts.apiKey ? `${url}&api_key=${encodeURIComponent(opts.apiKey)}` : url;
}

const day = (t: number) => new Date(t).toISOString().slice(0, 10);

/** Abstracts come as an inverted index (word → positions); this puts the words back in order. */
export function rebuildAbstract(index: Record<string, number[]> | null | undefined): string {
  if (!index) return '';
  const words: string[] = [];
  for (const [w, positions] of Object.entries(index)) for (const p of positions) if (p >= 0 && p < 5000) words[p] = w;
  return words.filter(Boolean).join(' ');
}

function shorten(text: string, max = SUMMARY_MAX): string {
  if (text.length <= max) return text;
  const cut = text.slice(0, max - 1);
  return `${cut.slice(0, Math.max(cut.lastIndexOf(' '), max * 0.6)).trimEnd()}…`;
}

/**
 * OpenAlex sometimes re-dates old papers (a new edition, a reindexed journal) to this month.
 * A work already cited two or more years before its publication year is one of those: it
 * isn't new. (Citations from the year before are allowed: a preprint often gets cited
 * before the journal version comes out.)
 */
export function isRedated(w: OpenAlexWork): boolean {
  const year = w.publication_year ?? Number(w.publication_date?.slice(0, 4));
  return !!w.counts_by_year?.some((c) => c.year <= year - 2 && c.cited_by_count > 0);
}

/** 0..1 — journal impact and citations, each on a log scale. */
export function scientificWeight(citations: number, fwci: number | undefined, journalImpact: number | undefined): number {
  const journal = journalImpact != null ? Math.min(1, Math.log1p(journalImpact) / Math.log1p(20)) : 0.25;
  const byFwci = fwci && fwci > 0 ? Math.min(1, Math.log1p(fwci) / Math.log1p(10)) : 0;
  const byCount = Math.min(1, Math.log1p(citations) / Math.log1p(30));
  return Math.round((0.5 * journal + 0.5 * Math.max(byFwci, byCount)) * 100) / 100;
}

function authorsLabel(w: OpenAlexWork): string | undefined {
  const names = (w.authorships ?? []).map((a) => a.author?.display_name).filter((n): n is string => !!n);
  if (!names.length) return undefined;
  return names.length === 1 ? names[0] : `${names[0]} et al.`;
}

/** One OpenAlex work → a SAND event. Undefined when it lacks what the sand needs. */
export function mapWork(w: OpenAlexWork, journalImpact: Map<string, number>, now = Date.now()): NewsEvent | undefined {
  const workId = w.id?.split('/').pop();
  const title = toPlainText(w.title, 300);
  const url = safeHttpUrl(w.doi ?? undefined) ?? safeHttpUrl(w.primary_location?.landing_page_url ?? undefined) ?? safeHttpUrl(w.id);
  const published = w.publication_date ? Date.parse(`${w.publication_date}T12:00:00Z`) : NaN;
  if (!workId || !/^W\d+$/.test(workId) || title.length < 8 || !url || !Number.isFinite(published)) return undefined;
  const publishedAt = new Date(Math.min(published, now)).toISOString();
  const fieldId = Number(w.primary_topic?.field?.id?.split('/').pop());
  const field = FIELDS.find((f) => f.id === fieldId);
  const categories = subfieldCategories(w.primary_topic?.subfield?.display_name, field?.categories ?? ['other']);
  const countries = [...new Set((w.authorships ?? []).flatMap((a) => a.countries ?? []))].filter((c) => /^[A-Z]{2}$/.test(c)).slice(0, 4);
  // Where the research was done: the authors' countries (a proxy for "near you" in the engine).
  const locations: GeoRef[] = countries.map((cc) => {
    const info = countryInfo(cc);
    return { name: info?.name ?? cc, level: 'country', countryCode: cc, regions: info ? [info.region] : undefined, confidence: 0.55, via: 'source-metadata' };
  });
  const summary = shorten(toPlainText(rebuildAbstract(w.abstract_inverted_index), 4000));
  const sourceId = w.primary_location?.source?.id?.split('/').pop();
  const journal = toPlainText(w.primary_location?.source?.display_name, 80) || 'Publicação científica';
  const citations = Math.max(0, w.cited_by_count ?? 0);
  const fwci = typeof w.fwci === 'number' && w.fwci > 0 ? Math.round(w.fwci * 100) / 100 : undefined;
  const jImpact = sourceId ? journalImpact.get(sourceId) : undefined;
  const research: ResearchInfo = {
    provider: 'OpenAlex',
    workId,
    citations,
    fwci,
    journalImpact: jImpact != null ? Math.round(jImpact * 10) / 10 : undefined,
    weight: scientificWeight(citations, fwci, jImpact),
    field: field?.name,
    topic: toPlainText(w.primary_topic?.display_name, 120) || undefined,
    authors: authorsLabel(w),
    openAccess: w.open_access?.is_oa ?? undefined,
    countries,
  };
  const analysis = analyzeArticle({ title, summary, url, sourceCountry: undefined, hints: { categories, locations } });
  // A paper is knowledge, not a happening: no hazard or urgency from words like "deaths".
  // Its reach is the scientific weight (the browser mixes it with personal relevance).
  analysis.hazard = false;
  analysis.urgency = 0.05;
  analysis.severity = Math.round((0.2 + 0.5 * research.weight) * 100) / 100;
  analysis.severityEvidence = [
    `${citations} citação(ões)${fwci ? `, impacto normalizado ${fwci.toFixed(1)}` : ''}`,
    ...(research.journalImpact != null ? [`revista com média de ${research.journalImpact} citações por artigo`] : []),
  ];
  analysis.categories = [...new Set([...categories, ...analysis.categories.filter((c) => c !== 'other')])].slice(0, 3);
  return {
    id: `ev_${workId.toLowerCase()}`,
    seq: citations,
    title,
    summary: summary || undefined,
    url,
    sourceName: journal,
    sourceUrl: sourceId ? `https://openalex.org/${sourceId}` : 'https://openalex.org/',
    sourceKind: 'journal',
    sourceReliability: w.primary_location?.source?.is_core ? 0.9 : 0.8,
    language: w.language ?? undefined,
    publishedAt,
    firstSeenAt: publishedAt,
    updatedAt: publishedAt,
    expiresAt: new Date(Date.parse(publishedAt) + RESEARCH_WINDOW_DAYS * 86_400_000).toISOString(),
    articleCount: 1,
    sources: [journal],
    sourceIds: ['openalex'],
    analysis,
    verification: 'single_source',
    relations: [],
    developments: [],
    research,
  };
}

export interface ResearchPass {
  events: NewsEvent[];
  requests: number;
  failedFields: number[];
  lastError?: string;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** The whole pass: 26 field queries + one journal query per 50 journals. */
export async function fetchRecentResearch(opts: OpenAlexOptions = {}): Promise<ResearchPass> {
  const now = opts.now ?? Date.now();
  const signal = opts.signal ?? new AbortController().signal;
  const from = day(now - RESEARCH_WINDOW_DAYS * 86_400_000);
  const to = day(now);
  const works: OpenAlexWork[] = [];
  const failedFields: number[] = [];
  let lastError: string | undefined;
  let requests = 0;
  let consecutiveFailures = 0;
  for (const f of FIELDS) {
    if (signal.aborted || consecutiveFailures >= 3) {
      failedFields.push(f.id);
      continue;
    }
    const url = withAuth(
      `${API}/works?filter=from_publication_date:${from},to_publication_date:${to},type:article|review,has_abstract:true,is_retracted:false,primary_topic.field.id:${f.id}` +
        `&sort=cited_by_count:desc&per_page=${PER_FIELD_FETCH}&select=${SELECT}`,
      opts,
    );
    try {
      requests++;
      const res = await httpGet(url, { signal, timeoutMs: 30_000, headers: { Accept: 'application/json' } });
      const list = ((JSON.parse(res.text) as { results?: OpenAlexWork[] }).results ?? []).filter((w) => !isRedated(w));
      works.push(...list.slice(0, PER_FIELD_KEEP));
      consecutiveFailures = 0;
    } catch (err) {
      failedFields.push(f.id);
      lastError = (err as Error).message.slice(0, 200);
      consecutiveFailures++;
    }
    await sleep(opts.gapMs ?? 150);
  }

  // Journal impact (2-year mean citedness), 50 journals per request.
  const journalImpact = new Map<string, number>();
  const sourceIds = [...new Set(works.map((w) => w.primary_location?.source?.id?.split('/').pop()).filter((s): s is string => !!s && /^S\d+$/.test(s)))];
  for (let i = 0; i < sourceIds.length && !signal.aborted; i += 50) {
    const batch = sourceIds.slice(i, i + 50);
    try {
      requests++;
      const res = await httpGet(withAuth(`${API}/sources?filter=openalex:${batch.join('|')}&per_page=50&select=id,summary_stats`, opts), {
        signal,
        timeoutMs: 30_000,
        headers: { Accept: 'application/json' },
      });
      for (const s of (JSON.parse(res.text) as { results?: { id: string; summary_stats?: { '2yr_mean_citedness'?: number } }[] }).results ?? []) {
        const v = s.summary_stats?.['2yr_mean_citedness'];
        if (typeof v === 'number' && Number.isFinite(v)) journalImpact.set(s.id.split('/').pop()!, v);
      }
    } catch (err) {
      lastError = (err as Error).message.slice(0, 200); // journals unknown: weight falls back to citations
    }
    await sleep(opts.gapMs ?? 150);
  }

  const byId = new Map<string, NewsEvent>();
  for (const w of works) {
    const e = mapWork(w, journalImpact, now);
    if (e && !byId.has(e.id)) byId.set(e.id, e);
  }
  return { events: [...byId.values()], requests, failedFields, lastError };
}
