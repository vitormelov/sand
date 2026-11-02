import { regionOfCountry } from '../geo/gazetteer';
import { IMPORTANCE_LABEL, type Importance, type ProfileAnswers } from '../profile';
import { RESEARCH_COUNTRIES, RESEARCH_LANGUAGES, SIZE_BASIS, THEMES, themeOf, type ResearchPrefs } from '../research';
import type { NewsEvent, UserProfile } from '../types';
import { IMPACT_BANDS } from './config';
import { computeImpact, type ImpactFactor, type ImpactResult } from './engine';

/** Default share of a research grain's size that comes from its scientific weight. */
export const SCIENTIFIC_SHARE = SIZE_BASIS.balanced;

/** How much each answer weighs in the personal part (sums to 1). */
const PERSONAL_WEIGHTS = { theme: 0.45, country: 0.25, language: 0.15, practical: 0.15 } as const;
const THEME_VALUE: Record<Importance, number> = { [-2]: 0, [-1]: 0.15, 0: 0.4, 1: 0.75, 2: 1 };
const BONUS_POINTS = 8;

const countryName = (cc: string) => RESEARCH_COUNTRIES.find(([c]) => c === cc)?.[1] ?? cc;
const languageName = (l: string) => RESEARCH_LANGUAGES.find(([c]) => c === l)?.[1] ?? l;

/** The countries that count as "yours": the ones chosen, or else the country you live in. */
function preferredCountries(profile: UserProfile, prefs: ResearchPrefs | undefined): string[] {
  if (prefs?.countries?.length) return prefs.countries;
  return profile.location?.countryCode ? [profile.location.countryCode] : [];
}

/**
 * Whether a research grain stays in the sand for this person: themes marked "não quero",
 * and the "só esses" choices for countries, languages and open access, take it out.
 */
export function researchVisible(e: NewsEvent, profile: UserProfile & ProfileAnswers): boolean {
  const prefs = profile.research;
  if (!e.research || !prefs) return true;
  const theme = themeOf(e.research);
  if (theme && prefs.themes?.[theme] === -2) return false;
  const countries = preferredCountries(profile, prefs);
  if (prefs.countryMode === 'only' && countries.length && !e.research.countries?.some((c) => countries.includes(c))) return false;
  if (prefs.languageMode === 'only' && prefs.languages?.length && !(e.language && prefs.languages.includes(e.language))) return false;
  if (prefs.openAccess === 'only' && !e.research.openAccess) return false;
  return true;
}

/**
 * SAND Conhecimento: a paper's grain mixes how much it concerns *you* — the theme, the
 * authors' countries and the language you chose, plus practical consequences — with its
 * scientific weight (journal impact and citations). The share of each is your choice
 * ("o quanto tem a ver comigo" / equilíbrio / destaque científico).
 */
export function researchImpact(e: NewsEvent, profile: UserProfile & ProfileAnswers, now = Date.now()): ImpactResult {
  const news = computeImpact(e, profile, now);
  const prefs = profile.research;
  const r = e.research;
  const weight = r?.weight ?? 0;

  const theme = themeOf(r);
  const themeLabel = THEMES.find((t) => t.id === theme)?.label;
  const importance = theme ? prefs?.themes?.[theme] : undefined;
  const themeValue = importance != null ? THEME_VALUE[importance] : 0.4;
  const themeDetail = themeLabel ? `${themeLabel}${importance != null ? ` — ${IMPORTANCE_LABEL[importance].toLowerCase()}` : ' (sem resposta)'}` : 'área não identificada';

  const countries = preferredCountries(profile, prefs);
  const authorCountries = r?.countries ?? [];
  const match = authorCountries.find((c) => countries.includes(c));
  const regions = new Set(countries.map((c) => regionOfCountry(c)).filter(Boolean));
  const sameRegion = !match && authorCountries.some((c) => regions.has(regionOfCountry(c)));
  const countryValue = !countries.length ? 0.4 : match ? 1 : sameRegion ? 0.45 : 0.15;
  const countryDetail = !authorCountries.length
    ? 'países dos autores não informados'
    : match
      ? `autores de ${countryName(match)}`
      : `autores de ${authorCountries.map(countryName).join(', ')}${sameRegion ? ' (mesma região)' : ''}`;

  const languages = prefs?.languages ?? [];
  const langValue = !languages.length ? 0.5 : e.language && languages.includes(e.language) ? 1 : 0.2;
  const langDetail = e.language ? `em ${languageName(e.language).toLowerCase()}` : 'idioma não informado';

  const practical = news.factors.find((f) => f.key === 'practical');
  const practicalValue = practical?.value ?? 0;

  const share = SIZE_BASIS[prefs?.sizeBasis ?? 'balanced'];
  const personalShare = 1 - share;
  const W = PERSONAL_WEIGHTS;
  const factors: ImpactFactor[] = [
    { key: 'interest', label: 'Seu interesse no tema', value: themeValue, weight: W.theme * personalShare, points: 0, detail: themeDetail },
    { key: 'exposure', label: 'Países que você prefere', value: countryValue, weight: W.country * personalShare, points: 0, detail: countryDetail },
    { key: 'urgency', label: 'Idioma', value: langValue, weight: W.language * personalShare, points: 0, detail: langDetail },
    { key: 'practical', label: 'Consequência prática', value: practicalValue, weight: W.practical * personalShare, points: 0, detail: practical?.detail ?? '' },
    { key: 'severity', label: 'Peso científico', value: weight, weight: share, points: 0, detail: scientificDetail(e) },
  ];
  for (const f of factors) f.points = f.value * f.weight * 100;

  const rules: string[] = [];
  let bonus = 0;
  if (prefs?.openAccess === 'prefer' && r?.openAccess) {
    bonus += BONUS_POINTS * personalShare;
    rules.push('acesso aberto, como você prefere');
  }
  if (prefs?.likesReviews && r?.type === 'review') {
    bonus += BONUS_POINTS * personalShare;
    rules.push('revisão (resume o que se sabe sobre o tema), como você prefere');
  }
  const score = Math.round(Math.min(100, Math.max(0, factors.reduce((s, f) => s + f.points, 0) + bonus)));
  const band = IMPACT_BANDS.find((b) => score < b.max) ?? IMPACT_BANDS[IMPACT_BANDS.length - 1];
  return {
    ...news,
    score,
    band: band.id,
    bandLabel: band.label,
    // A paper never triggers the "imminent risk" treatment of the news.
    urgent: false,
    factors,
    rules: [
      `tamanho: ${Math.round(personalShare * 100)}% o quanto tem a ver com você, ${Math.round(share * 100)}% peso científico`,
      ...rules,
    ],
    explanation: themeLabel ? `Pesquisa de ${themeLabel.toLowerCase()}; ${countryDetail}.` : news.explanation,
  };
}

function scientificDetail(e: NewsEvent): string {
  const r = e.research;
  if (!r) return 'sem dados de citação';
  return [
    `${r.citations} citação(ões)`,
    r.fwci ? `impacto normalizado ${r.fwci.toFixed(1)} (1 = média da área)` : undefined,
    r.journalImpact != null ? `revista com ${r.journalImpact} citações por artigo em média` : undefined,
  ]
    .filter(Boolean)
    .join(', ');
}
