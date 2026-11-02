import type { Importance } from './profile';
import type { NewsEvent, ResearchInfo } from './types';

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

// ------------------------------------------------------------- fields and themes

/** OpenAlex's 26 research fields (id → Portuguese name), as stored in `ResearchInfo.field`. */
export const FIELDS: { id: number; name: string }[] = [
  { id: 11, name: 'Ciências agrárias e biológicas' },
  { id: 12, name: 'Artes e humanidades' },
  { id: 13, name: 'Bioquímica, genética e biologia molecular' },
  { id: 14, name: 'Administração e negócios' },
  { id: 15, name: 'Engenharia química' },
  { id: 16, name: 'Química' },
  { id: 17, name: 'Ciência da computação' },
  { id: 18, name: 'Ciências da decisão' },
  { id: 19, name: 'Ciências da Terra e planetárias' },
  { id: 20, name: 'Economia e finanças' },
  { id: 21, name: 'Energia' },
  { id: 22, name: 'Engenharia' },
  { id: 23, name: 'Ciências ambientais' },
  { id: 24, name: 'Imunologia e microbiologia' },
  { id: 25, name: 'Ciência dos materiais' },
  { id: 26, name: 'Matemática' },
  { id: 27, name: 'Medicina' },
  { id: 28, name: 'Neurociência' },
  { id: 29, name: 'Enfermagem' },
  { id: 30, name: 'Farmacologia e toxicologia' },
  { id: 31, name: 'Física e astronomia' },
  { id: 32, name: 'Psicologia' },
  { id: 33, name: 'Ciências sociais' },
  { id: 34, name: 'Veterinária' },
  { id: 35, name: 'Odontologia' },
  { id: 36, name: 'Profissões da saúde' },
];

/** The fields grouped into themes a person recognizes: what the questionnaire asks about. */
export const THEMES = [
  { id: 'health', label: 'Saúde e medicina', fields: [27, 29, 36, 35, 30, 24] },
  { id: 'mind', label: 'Mente e cérebro', fields: [28, 32] },
  { id: 'life', label: 'Biologia, genética e agricultura', fields: [13, 11, 34] },
  { id: 'planet', label: 'Clima, ambiente e planeta', fields: [23, 19] },
  { id: 'energy', label: 'Energia', fields: [21] },
  { id: 'computing', label: 'Computação e inteligência artificial', fields: [17] },
  { id: 'engineering', label: 'Engenharia, química e materiais', fields: [22, 25, 16, 15] },
  { id: 'exact', label: 'Física, astronomia e matemática', fields: [31, 26] },
  { id: 'economy', label: 'Economia e negócios', fields: [20, 14, 18] },
  { id: 'society', label: 'Sociedade, educação e política', fields: [33] },
  { id: 'culture', label: 'Artes e humanidades', fields: [12] },
] as const;
export type ThemeId = (typeof THEMES)[number]['id'];
export const THEME_IDS = THEMES.map((t) => t.id) as ThemeId[];

/** The theme of a work, from its field id (or, for works stored before ids, its field name). */
export function themeOf(info: Pick<ResearchInfo, 'fieldId' | 'field'> | undefined): ThemeId | undefined {
  if (!info) return undefined;
  const id = info.fieldId ?? FIELDS.find((f) => f.name === info.field)?.id;
  return id == null ? undefined : THEMES.find((t) => (t.fields as readonly number[]).includes(id))?.id;
}

// ------------------------------------------------------------- preferences

/** Countries offered as chips (anyone can be added by the list). ISO-2 → Portuguese name. */
export const RESEARCH_COUNTRIES: [string, string][] = [
  ['BR', 'Brasil'], ['PT', 'Portugal'], ['US', 'Estados Unidos'], ['GB', 'Reino Unido'], ['CA', 'Canadá'], ['DE', 'Alemanha'],
  ['FR', 'França'], ['ES', 'Espanha'], ['IT', 'Itália'], ['NL', 'Países Baixos'], ['CH', 'Suíça'], ['SE', 'Suécia'],
  ['CN', 'China'], ['JP', 'Japão'], ['KR', 'Coreia do Sul'], ['IN', 'Índia'], ['AU', 'Austrália'], ['ZA', 'África do Sul'],
  ['AR', 'Argentina'], ['MX', 'México'], ['CL', 'Chile'], ['CO', 'Colômbia'],
];

/** Languages offered (OpenAlex language codes) → Portuguese name. */
export const RESEARCH_LANGUAGES: [string, string][] = [
  ['pt', 'Português'], ['en', 'Inglês'], ['es', 'Espanhol'], ['fr', 'Francês'], ['de', 'Alemão'], ['it', 'Italiano'],
];

/** What makes a research grain big: share of the scientific weight in the size. */
export const SIZE_BASIS = { personal: 0.2, balanced: 0.4, science: 0.65 } as const;
export type SizeBasis = keyof typeof SIZE_BASIS;

/** Answers to the SAND Conhecimento questionnaire (inside the account's profile). */
export interface ResearchPrefs {
  onboarded?: boolean;
  /** −2 "não quero" … 2 "muito", per theme. */
  themes?: Partial<Record<ThemeId, Importance>>;
  countries?: string[];
  /** 'prefer': those countries weigh more; 'only': the others leave the sand. */
  countryMode?: 'prefer' | 'only';
  languages?: string[];
  languageMode?: 'prefer' | 'only';
  sizeBasis?: SizeBasis;
  openAccess?: 'any' | 'prefer' | 'only';
  /** Reviews (summaries of what is known on a subject) weigh a bit more. */
  likesReviews?: boolean;
}

const LEVELS = [-2, -1, 0, 1, 2];

export function sanitizeResearchPrefs(raw: unknown): ResearchPrefs | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const r = raw as Record<string, any>;
  const themes: Partial<Record<ThemeId, Importance>> = {};
  for (const t of THEME_IDS) if (LEVELS.includes(r.themes?.[t])) themes[t] = r.themes[t] as Importance;
  const codes = (v: unknown, re: RegExp, max: number) =>
    Array.isArray(v) ? [...new Set(v.filter((x): x is string => typeof x === 'string' && re.test(x)))].slice(0, max) : undefined;
  const mode = (v: unknown) => (v === 'only' ? 'only' : v === 'prefer' ? 'prefer' : undefined);
  return {
    onboarded: r.onboarded === true,
    themes: Object.keys(themes).length ? themes : undefined,
    countries: codes(r.countries, /^[A-Z]{2}$/, 12),
    countryMode: mode(r.countryMode),
    languages: codes(r.languages, /^[a-z]{2}$/, 8),
    languageMode: mode(r.languageMode),
    sizeBasis: r.sizeBasis in SIZE_BASIS ? (r.sizeBasis as SizeBasis) : undefined,
    openAccess: r.openAccess === 'only' || r.openAccess === 'prefer' || r.openAccess === 'any' ? r.openAccess : undefined,
    likesReviews: typeof r.likesReviews === 'boolean' ? r.likesReviews : undefined,
  };
}
