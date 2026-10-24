import { CATEGORIES, type Category, type UserLocation, type UserProfile } from './types';

/**
 * Answers from the first-login questionnaire. Everything except the location is
 * optional; unanswered fields simply leave the engine at its defaults.
 */

/** −2 "não quero", −1 "pouco", 0 "normal", 1 "importante", 2 "muito importante". */
export type Importance = -2 | -1 | 0 | 1 | 2;

export const TRANSPORT = ['car', 'motorcycle', 'public', 'app', 'bike_walk'] as const;
export type Transport = (typeof TRANSPORT)[number];

export const OCCUPATIONS = ['clt', 'public_servant', 'self_employed', 'student', 'retired', 'job_seeking', 'other'] as const;
export type Occupation = (typeof OCCUPATIONS)[number];

export const AVOID_TOPICS = ['violence', 'party_politics', 'celebrities'] as const;
export type AvoidTopic = (typeof AVOID_TOPICS)[number];

export type FootballInterest = 'no' | 'some' | 'yes';

export interface ProfileAnswers {
  locationSource?: 'gps' | 'manual';
  categoryImportance?: Partial<Record<Category, Importance>>;
  football?: { interest: FootballInterest; club?: string };
  routine?: { transport?: Transport[]; rents?: boolean; schoolKids?: boolean };
  work?: { occupation?: Occupation; hasDebt?: boolean; invests?: boolean; socialBenefit?: boolean };
  /** Up to 3 other places that matter (family, work, study). */
  places?: UserLocation[];
  avoidTopics?: AvoidTopic[];
  /** News sources (connector ids) the user switched off. */
  hiddenSources?: string[];
}

export interface StoredProfile extends UserProfile, ProfileAnswers {
  /** Questionnaire completed at least once. */
  onboarded?: boolean;
}

export const TRANSPORT_LABEL: Record<Transport, string> = {
  car: 'Carro',
  motorcycle: 'Moto',
  public: 'Ônibus / metrô',
  app: 'Aplicativo / táxi',
  bike_walk: 'Bicicleta / a pé',
};

export const OCCUPATION_LABEL: Record<Occupation, string> = {
  clt: 'Empregado(a) com carteira',
  public_servant: 'Servidor(a) público(a)',
  self_employed: 'Autônomo(a) / MEI / empresário(a)',
  student: 'Estudante',
  retired: 'Aposentado(a) / pensionista',
  job_seeking: 'Procurando emprego',
  other: 'Outro',
};

export const AVOID_LABEL: Record<AvoidTopic, string> = {
  violence: 'Violência e crimes',
  party_politics: 'Política partidária e eleições',
  celebrities: 'Celebridades e entretenimento',
};

export const IMPORTANCE_LABEL: Record<Importance, string> = {
  [-2]: 'Não quero',
  [-1]: 'Pouco',
  0: 'Normal',
  1: 'Importante',
  2: 'Muito',
};

/** A news item the user saved. A copy of the essentials, so it outlives the 48 h retention. */
export interface SavedItem {
  id: string;
  title: string;
  url: string;
  sourceName: string;
  publishedAt?: string;
  summary?: string;
  savedAt: string;
}

export const EVENT_ID_RE = /^ev_[a-z0-9]{1,40}$/;

export function sanitizeSaved(raw: unknown): SavedItem | undefined {
  const r = raw as Record<string, unknown> | null;
  if (!r || typeof r !== 'object') return undefined;
  const id = str(r.id, 48);
  const title = str(r.title, 300);
  const url = str(r.url, 2000);
  if (!id || !EVENT_ID_RE.test(id) || !title || !url || !/^https?:\/\//i.test(url)) return undefined;
  const date = (v: unknown) => (typeof v === 'string' && !Number.isNaN(Date.parse(v)) ? new Date(v).toISOString() : undefined);
  return {
    id,
    title,
    url,
    sourceName: str(r.sourceName, 80) ?? '',
    publishedAt: date(r.publishedAt),
    summary: str(r.summary, 420) || undefined,
    savedAt: date(r.savedAt) ?? new Date().toISOString(),
  };
}

// ---------------------------------------------------------------- validation

const str = (v: unknown, max = 80) => (typeof v === 'string' ? v.trim().slice(0, max) : undefined);
const bool = (v: unknown) => (typeof v === 'boolean' ? v : undefined);
const round1 = (n: unknown) => (typeof n === 'number' && Number.isFinite(n) ? Math.round(n * 10) / 10 : undefined);

export function sanitizeLocation(raw: unknown): UserLocation | undefined {
  const l = raw as Record<string, unknown> | null;
  if (!l || typeof l !== 'object') return undefined;
  const name = str(l.name);
  const cc = str(l.countryCode, 2)?.toUpperCase();
  if (!name || !cc || !/^[A-Z]{2}$/.test(cc)) return undefined;
  const lat = round1(l.lat);
  const lon = round1(l.lon);
  return {
    name,
    admin1: str(l.admin1, 10),
    admin1Name: str(l.admin1Name),
    countryCode: cc,
    countryName: str(l.countryName) ?? cc,
    // Never more precise than ~11 km.
    lat: lat != null && Math.abs(lat) <= 90 ? lat : undefined,
    lon: lon != null && Math.abs(lon) <= 180 ? lon : undefined,
  };
}

const oneOf = <T extends string>(v: unknown, list: readonly T[]): T | undefined => (list.includes(v as T) ? (v as T) : undefined);

/** Validates untrusted input (request bodies, storage) into a clean profile. */
export function sanitizeProfile(raw: unknown): StoredProfile {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, any>;
  const importance: Partial<Record<Category, Importance>> = {};
  for (const c of CATEGORIES) {
    const v = r.categoryImportance?.[c];
    if ([-2, -1, 0, 1, 2].includes(v)) importance[c] = v as Importance;
  }
  const affinity: Partial<Record<Category, number>> = {};
  for (const c of CATEGORIES) {
    const v = r.affinity?.[c];
    if (typeof v === 'number' && Number.isFinite(v)) affinity[c] = Math.max(-10, Math.min(10, v));
  }
  const football = r.football && oneOf(r.football.interest, ['no', 'some', 'yes'] as const)
    ? { interest: r.football.interest as FootballInterest, club: str(r.football.club, 40) || undefined }
    : undefined;
  const transport = Array.isArray(r.routine?.transport) ? [...new Set(r.routine.transport.filter((t: unknown) => oneOf(t, TRANSPORT)))] as Transport[] : undefined;
  return {
    onboarded: r.onboarded === true,
    location: sanitizeLocation(r.location),
    locationSource: oneOf(r.locationSource, ['gps', 'manual'] as const),
    interests: Array.isArray(r.interests) ? r.interests.filter((c: unknown): c is Category => CATEGORIES.includes(c as Category)) : [],
    affinity,
    categoryImportance: Object.keys(importance).length ? importance : undefined,
    football,
    routine: r.routine ? { transport, rents: bool(r.routine.rents), schoolKids: bool(r.routine.schoolKids) } : undefined,
    work: r.work
      ? { occupation: oneOf(r.work.occupation, OCCUPATIONS), hasDebt: bool(r.work.hasDebt), invests: bool(r.work.invests), socialBenefit: bool(r.work.socialBenefit) }
      : undefined,
    places: Array.isArray(r.places) ? r.places.map(sanitizeLocation).filter((x): x is UserLocation => !!x).slice(0, 3) : undefined,
    hiddenSources: Array.isArray(r.hiddenSources)
      ? [...new Set(r.hiddenSources.filter((s: unknown): s is string => typeof s === 'string' && /^[a-z0-9-]{1,40}$/.test(s)))].slice(0, 50)
      : undefined,
    avoidTopics: Array.isArray(r.avoidTopics) ? [...new Set(r.avoidTopics.filter((t: unknown) => oneOf(t, AVOID_TOPICS)))] as AvoidTopic[] : undefined,
  };
}
