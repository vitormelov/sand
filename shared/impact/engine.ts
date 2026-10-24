import { countryInfo, mentionsName, brUfFromName, regionOfCountry } from '../geo/gazetteer';
import { clamp, haversineKm, normalizeForMatch } from '../text';
import type { ProfileAnswers } from '../profile';
import type { Category, GeoRef, NewsEvent, UserLocation, UserProfile } from '../types';
import { answeredInterest, avoidedReason, channelBoost, clubMentioned, contextMultipliers } from './personal';
import {
  CHANNEL_PRACTICAL_WEIGHT,
  IMPACT_BANDS,
  IMPACT_WEIGHTS,
  INTEREST,
  LOCAL_ACTING_CHANNELS,
  LOCAL_ACTING_EXPONENT,
  NO_CHANNEL_PRACTICAL,
  PERSONAL,
  PROXIMITY,
  RECENCY_HALF_LIFE_HOURS,
  RULES,
  SCOPE_TRANSMISSION,
  type FactorKey,
  type ImpactBand,
} from './config';

/**
 * Personal Impact Engine.
 *
 * Pure function: (event analysis, user profile, now) → impact estimate.
 * It runs in the browser, so the user's location never leaves the device.
 *
 * Two dimensions are kept apart on purpose:
 *  - score:      potential impact on this person's life if the event is relevant to them;
 *  - confidence: quality of the evidence that the event and its relation to the
 *                person were identified correctly.
 * Confidence never inflates the score. It only *caps* extremes when evidence is thin.
 */

export type ImpactInput = Pick<
  NewsEvent,
  | 'title'
  | 'summary'
  | 'analysis'
  | 'sourceReliability'
  | 'sourceKind'
  | 'sourceCountry'
  | 'articleCount'
  | 'verification'
  | 'occurredAt'
  | 'publishedAt'
  | 'firstSeenAt'
>;

export interface ImpactFactor {
  key: FactorKey;
  label: string;
  /** 0..1 */
  value: number;
  weight: number;
  /** Contribution to the score, in points. */
  points: number;
  detail: string;
}

export interface ImpactResult {
  score: number;
  confidence: number;
  band: ImpactBand;
  bandLabel: string;
  urgent: boolean;
  factors: ImpactFactor[];
  /** Special rules that changed the weighted sum, with reasons. */
  rules: string[];
  explanation: string;
  proximityLabel: string;
}

const FACTOR_LABEL: Record<FactorKey, string> = {
  practical: 'Consequência prática',
  exposure: 'Proximidade e exposição',
  severity: 'Alcance e gravidade',
  interest: 'Seus interesses',
  urgency: 'Urgência e atualidade',
};

const CHANNEL_LABEL: Record<string, string> = {
  cost_of_living: 'custo de vida',
  energy_fuel: 'energia e combustíveis',
  interest_credit: 'juros, crédito e câmbio',
  employment: 'trabalho e renda',
  public_health: 'saúde pública',
  physical_safety: 'segurança física',
  natural_hazard: 'riscos naturais',
  infrastructure: 'serviços básicos e infraestrutura',
  mobility: 'mobilidade e transporte',
  rights_governance: 'leis e decisões públicas',
  digital_services: 'serviços digitais',
  education_access: 'educação',
  environment: 'meio ambiente',
};

interface Proximity {
  value: number;
  label: string;
  place?: GeoRef;
}

function userAdmin1(user: UserLocation): string | undefined {
  if (user.admin1) return user.admin1;
  if (user.countryCode === 'BR') return brUfFromName(user.admin1Name);
  return user.admin1Name ? normalizeForMatch(user.admin1Name).trim() : undefined;
}

export function proximityTo(user: UserLocation | undefined, loc: GeoRef, localHazard = false): Proximity {
  if (loc.level === 'global') return { value: PROXIMITY.sameWorldRegion, label: 'alcance global', place: loc };
  if (!user) return { value: PROXIMITY.unknown, label: 'sem localização configurada', place: loc };

  const uAdmin1 = userAdmin1(user);
  const uRegion = regionOfCountry(user.countryCode);
  let best: Proximity = { value: PROXIMITY.elsewhere, label: `em ${loc.name}`, place: loc };
  const consider = (value: number, label: string) => {
    if (value > best.value) best = { value, label, place: loc };
  };

  if (loc.lat != null && loc.lon != null && user.lat != null && user.lon != null && loc.level !== 'country' && loc.level !== 'world_region') {
    const km = haversineKm(user.lat, user.lon, loc.lat, loc.lon);
    // A state centroid is not a point: only use distance for cities and point events.
    if (loc.level === 'city') {
      if (km < 15) consider(PROXIMITY.sameCity, `na sua cidade (${loc.name})`);
      else if (km < 60) consider(PROXIMITY.within60km, `a ~${Math.round(km)} km de você (${loc.name})`);
      else if (km < 200) consider(PROXIMITY.within200km, `a ~${Math.round(km)} km de você (${loc.name})`);
      else if (km < 800) consider(PROXIMITY.within800km, `a ~${Math.round(km)} km de você (${loc.name})`);
    }
  }
  const sameCountry = loc.countryCode && loc.countryCode === user.countryCode;
  if (loc.level === 'city' && sameCountry && normalizeForMatch(loc.name) === normalizeForMatch(user.name)) {
    consider(PROXIMITY.sameCity, `na sua cidade (${user.name})`);
  }
  if (sameCountry && loc.admin1 && uAdmin1 && loc.admin1 === uAdmin1 && (loc.level === 'city' || loc.level === 'state')) {
    consider(PROXIMITY.sameState, `no seu estado (${user.admin1Name ?? uAdmin1})`);
  }
  if (sameCountry && loc.level === 'macroregion' && uAdmin1 && loc.admin1List?.includes(uAdmin1)) {
    consider(PROXIMITY.sameMacroregion, `na sua região (${loc.name})`);
  }
  if (sameCountry) consider(localHazard ? PROXIMITY.sameCountryLocalHazard : PROXIMITY.sameCountry, `no seu país (${user.countryName}), longe de você`);
  if (uRegion && loc.regions?.includes(uRegion)) consider(PROXIMITY.sameWorldRegion, `na sua região do mundo (${loc.name})`);
  return best;
}

/** Locations as seen from this user: server analysis + mentions of the user's own city. */
function personalLocations(input: ImpactInput, user?: UserLocation): GeoRef[] {
  const locs = [...input.analysis.locations];
  if (!user) return locs;
  const text = `${input.title}\n${input.summary ?? ''}`;
  const already = locs.some((l) => l.level === 'city' && normalizeForMatch(l.name) === normalizeForMatch(user.name));
  if (!already && mentionsName(text, user.name)) {
    locs.push({
      name: user.name,
      level: 'city',
      countryCode: user.countryCode,
      admin1: userAdmin1(user),
      confidence: 0.65,
      via: 'user-city-mention',
    });
  }
  return locs;
}

function ageHours(input: ImpactInput, now: number): number {
  const ref = input.occurredAt ?? input.publishedAt ?? input.firstSeenAt;
  const t = Date.parse(ref);
  if (Number.isNaN(t)) return 24;
  return Math.max(0, (now - t) / 3_600_000);
}

function bandOf(score: number) {
  return IMPACT_BANDS.find((b) => score < b.max) ?? IMPACT_BANDS[IMPACT_BANDS.length - 1];
}

export function computeImpact(input: ImpactInput, profile: UserProfile & ProfileAnswers, now = Date.now()): ImpactResult {
  const a = input.analysis;
  const user = profile.location;
  const rules: string[] = [];
  const text = `${input.title}
${input.summary ?? ''}`;

  // --- Exposure -----------------------------------------------------------
  const locs = personalLocations(input, user);
  let origin: Proximity;
  const domesticSource = !!user && !!input.sourceCountry && input.sourceCountry === user.countryCode;
  if (locs.length === 0) {
    origin = domesticSource
      ? { value: PROXIMITY.unknownDomesticSource, label: 'local não identificado (veículo do seu país)' }
      : { value: PROXIMITY.unknown, label: 'local não identificado' };
  } else {
    const localHazard = a.hazard && (a.affectedScope === 'local' || a.affectedScope === 'state');
    origin = locs.map((l) => proximityTo(user, l, localHazard)).reduce((b, p) => (p.value > b.value ? p : b));
  }
  // Other places the user cares about (family, work, study) count as nearby too, a bit less.
  for (const place of profile.places ?? []) {
    const pl = personalLocations(input, place);
    if (pl.length === 0) continue;
    const localHazard = a.hazard && (a.affectedScope === 'local' || a.affectedScope === 'state');
    const best = pl.map((l) => proximityTo(place, l, localHazard)).reduce((b, p) => (p.value > b.value ? p : b));
    const value = best.value * PERSONAL.placeWeight;
    if (value > origin.value && best.value > PROXIMITY.sameWorldRegion) {
      origin = { value, label: `perto de ${place.name}, um lugar importante para você`, place: best.place };
    }
  }

  const maxStrength = a.channels.reduce((m, c) => Math.max(m, c.strength), 0);
  const scopeStrength = 0.5 + 0.5 * maxStrength;
  let transmission = 0;
  let transmissionLabel = '';
  if (user) {
    const uRegion = regionOfCountry(user.countryCode);
    const uAdmin1 = userAdmin1(user);
    const inCountry = locs.some((l) => l.countryCode === user.countryCode) || (locs.length === 0 && domesticSource);
    switch (a.affectedScope) {
      case 'global':
        transmission = SCOPE_TRANSMISSION.global;
        transmissionLabel = 'efeitos de alcance global';
        break;
      case 'world_region':
        if (uRegion && locs.some((l) => l.regions?.includes(uRegion) || regionOfCountry(l.countryCode) === uRegion)) {
          transmission = SCOPE_TRANSMISSION.sameWorldRegion;
          transmissionLabel = 'efeitos na sua região do mundo';
        }
        break;
      case 'national':
        if (inCountry) {
          transmission = SCOPE_TRANSMISSION.sameCountryNational;
          transmissionLabel = 'efeitos em todo o seu país';
        }
        break;
      case 'state':
        if (uAdmin1 && locs.some((l) => l.admin1 === uAdmin1 || l.admin1List?.includes(uAdmin1))) {
          transmission = SCOPE_TRANSMISSION.sameStateWide;
          transmissionLabel = 'efeitos em todo o seu estado';
        }
        break;
      case 'local':
        break;
    }
    transmission *= scopeStrength;
  } else if (a.affectedScope === 'global') {
    transmission = SCOPE_TRANSMISSION.global * scopeStrength;
    transmissionLabel = 'efeitos de alcance global';
  }
  const exposure = Math.max(origin.value, transmission);
  const exposureLabel = transmission > origin.value ? `${transmissionLabel}; origem ${origin.label}` : origin.label;

  // --- Practical consequence ---------------------------------------------
  // Local-acting channels (storms, violence...) decay faster with distance than systemic ones (prices, rates).
  // Daily routine, work and finances make some channels matter more to this person.
  const mults = contextMultipliers(profile);
  let practical = NO_CHANNEL_PRACTICAL * exposure;
  let topChannel: string | undefined;
  let topWhy: string[] = [];
  for (const c of a.channels) {
    const reach = LOCAL_ACTING_CHANNELS.includes(c.channel) ? Math.pow(exposure, LOCAL_ACTING_EXPONENT) : exposure;
    const boost = channelBoost(mults, c.channel);
    const v = Math.min(1, CHANNEL_PRACTICAL_WEIGHT[c.channel] * boost.k) * c.strength * reach;
    if (v > practical) {
      practical = v;
      topChannel = c.channel;
      topWhy = boost.k > 1 ? boost.why : [];
    }
  }
  practical = clamp(practical, 0, 1);

  // --- Interest -----------------------------------------------------------
  const interests = profile.interests ?? [];
  const matched = a.categories.filter((c) => interests.includes(c));
  const answered = answeredInterest(profile, a.categories);
  const club = clubMentioned(profile, text);
  const interest = club ? 1 : answered ? answered.value : interests.length === 0 ? INTEREST.neutralNoInterests : matched.length ? INTEREST.matched : INTEREST.unmatched;
  const affinityPoints = clamp(
    a.categories.slice(0, 2).reduce((s, c) => s + (profile.affinity?.[c] ?? 0), 0),
    -INTEREST.maxAffinityPoints,
    INTEREST.maxAffinityPoints,
  );

  // --- Urgency ------------------------------------------------------------
  const age = ageHours(input, now);
  const recency = Math.pow(0.5, age / RECENCY_HALF_LIFE_HOURS);
  const urgency = clamp(0.6 * recency + 0.4 * a.urgency, 0, 1);

  const values: Record<FactorKey, number> = {
    practical,
    exposure,
    severity: clamp(a.severity, 0, 1),
    interest,
    urgency,
  };
  const details: Record<FactorKey, string> = {
    practical: topChannel
      ? `pode afetar ${CHANNEL_LABEL[topChannel]}${topWhy.length ? ` (pesa mais porque ${topWhy.join(' e ')})` : ''}`
      : 'nenhuma consequência prática identificada',
    exposure: exposureLabel,
    severity: a.severityEvidence.length ? a.severityEvidence.slice(0, 3).join(', ') : 'sem indícios de gravidade elevada',
    interest: club
      ? `menciona o seu time (${club})`
      : answered
        ? answered.detail
        : interests.length === 0
          ? 'nenhum interesse selecionado'
          : matched.length
            ? `combina com: ${matched.map(categoryLabel).join(', ')}`
            : 'fora dos seus interesses',
    urgency: age < 1 ? 'muito recente' : age < 24 ? `há ~${Math.round(age)} h` : `há ~${Math.round(age / 24)} dia(s)`,
  };

  const factors: ImpactFactor[] = (Object.keys(IMPACT_WEIGHTS) as FactorKey[]).map((key) => ({
    key,
    label: FACTOR_LABEL[key],
    value: values[key],
    weight: IMPACT_WEIGHTS[key],
    points: values[key] * IMPACT_WEIGHTS[key] * 100,
    detail: details[key],
  }));

  let score = factors.reduce((s, f) => s + f.points, 0) + affinityPoints;
  if (affinityPoints !== 0) rules.push(`ajuste pelo seu feedback: ${affinityPoints > 0 ? '+' : ''}${affinityPoints.toFixed(0)} pts`);

  // --- Confidence (separate dimension) -------------------------------------
  const bestLocConf = origin.place ? origin.place.confidence : domesticSource ? 0.35 : 0.2;
  const corroboration = input.verification === 'official' ? 1 : input.articleCount >= 3 ? 1 : input.articleCount === 2 ? 0.7 : 0.4;
  const confidence = clamp(
    0.35 * input.sourceReliability + 0.25 * a.classificationConfidence + 0.25 * bestLocConf + 0.15 * corroboration,
    0,
    1,
  );

  // --- Special rules --------------------------------------------------------
  let urgent = false;
  const soft = a.channels.length === 0 && a.categories.every((c) => c === 'sports' || c === 'culture' || c === 'other');
  if (club) {
    score += PERSONAL.clubBonus;
    rules.push(`notícia sobre o seu time (${club})`);
  }
  const softCap = club ? PERSONAL.clubSoftCap : RULES.softNews.cap;
  if (soft && score > softCap) {
    score = softCap;
    rules.push('notícia sem consequência prática identificada: tamanho limitado');
  }
  const em = RULES.emergency;
  if (a.hazard && a.severity >= em.minSeverity && origin.value >= em.minProximity && age <= em.maxAgeHours) {
    const floor = em.floorBase + em.floorPerSeverity * a.severity;
    if (score < floor) score = floor;
    urgent = true;
    rules.push('risco imediato perto de você: prioridade de emergência');
  }
  if (a.severity >= RULES.globalCatastrophe.minSeverity && a.affectedScope === 'global' && score < RULES.globalCatastrophe.floor) {
    score = RULES.globalCatastrophe.floor;
    rules.push('acontecimento de gravidade extrema com alcance global');
  }
  // Topics the user prefers to see less of shrink — but never an emergency near them.
  const avoided = avoidedReason(profile, a, text);
  if (avoided && !urgent) {
    score *= PERSONAL.avoidFactor;
    rules.push(`${avoided}: grão menor`);
  }
  if (!urgent && confidence < RULES.lowConfidence.maxConfidence && score > RULES.lowConfidence.cap) {
    score = RULES.lowConfidence.cap;
    rules.push('evidências limitadas: score extremo evitado');
  }

  score = Math.round(clamp(score, 0, 100));
  const band = bandOf(score);
  return {
    score,
    confidence: Math.round(confidence * 100) / 100,
    band: band.id,
    bandLabel: band.label,
    urgent,
    factors,
    rules,
    explanation: explain(factors, rules, confidence, a.analyzer),
    proximityLabel: exposureLabel,
  };
}

const CATEGORY_LABEL: Record<Category, string> = {
  economy: 'Economia',
  work: 'Trabalho e carreira',
  technology: 'Tecnologia',
  health: 'Saúde',
  security: 'Segurança',
  politics: 'Política',
  climate: 'Clima',
  education: 'Educação',
  sports: 'Esportes',
  culture: 'Cultura',
  mobility: 'Mobilidade',
  other: 'Outros',
};

export function categoryLabel(c: Category): string {
  return CATEGORY_LABEL[c];
}

export function confidenceLabel(c: number): string {
  return c >= 0.7 ? 'alta' : c >= 0.45 ? 'moderada' : 'baixa';
}

function explain(factors: ImpactFactor[], rules: string[], confidence: number, analyzer: string): string {
  const byKey = Object.fromEntries(factors.map((f) => [f.key, f])) as Record<FactorKey, ImpactFactor>;
  const parts: string[] = [];
  const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
  parts.push(`${cap(byKey.exposure.detail)}.`);
  if (byKey.practical.value > 0.05) parts.push(`${cap(byKey.practical.detail)}.`);
  if (byKey.severity.value >= 0.5) parts.push(`Gravidade elevada (${byKey.severity.detail}).`);
  if (rules.length) parts.push(`${cap(rules.join('; '))}.`);
  parts.push(
    `Estimativa automática (${analyzer === 'rules' ? 'regras' : 'regras + IA'}), confiança ${confidenceLabel(confidence)}.`,
  );
  return parts.join(' ');
}

export function countryName(code?: string): string | undefined {
  return countryInfo(code)?.name;
}
