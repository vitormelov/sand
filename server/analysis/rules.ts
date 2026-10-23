import { countryInfo, findPlaces, brStateByUf } from '../../shared/geo/gazetteer';
import { clamp, escapeRegex, normalizeForMatch, stripAccents } from '../../shared/text';
import type { AffectedScope, Analysis, Category, Channel, ChannelSignal, GeoRef } from '../../shared/types';
import type { NormalizedArticle } from '../types';
import {
  CATEGORY_CUES,
  CHANNEL_CUES,
  CHANNEL_TO_CATEGORY,
  GLOBAL_SCOPE_CUES,
  HAZARD_CHANNELS,
  NATIONAL_SCOPE_CUES,
  SEVERITY_DOWN_CUES,
  SEVERITY_UP_CUES,
  URGENCY_CUES,
  RESOLVED_CUES,
  ONGOING_RISK_CUES,
  DEMONYMS,
  type Cue,
} from './lexicon';

/**
 * Deterministic, profile-independent analysis of an article.
 * News text is treated purely as data: nothing in it is ever executed or obeyed.
 */

interface CompiledCue {
  cue: string;
  weight: number;
  re: RegExp;
}
const compiled = new WeakMap<Cue[], CompiledCue[]>();

function compile(cues: Cue[]): CompiledCue[] {
  let c = compiled.get(cues);
  if (!c) {
    c = cues.map(([cue, weight]) => {
      const body = normalizeForMatch(cue.replace(/\*/g, 'STAR'))
        .trim()
        .split(' ')
        .map((w) => escapeRegex(w).replace(/star/g, '[a-z0-9]*'))
        .join(' ');
      return { cue: cue.replace(/\*/g, '').trim(), weight, re: new RegExp(`(?<= )${body}(?= )`) };
    });
    compiled.set(cues, c);
  }
  return c;
}

interface CueHit {
  strength: number;
  evidence: string[];
}

/** Noisy-OR of matched cue weights; title matches count a bit more. */
function scoreCues(cues: Cue[], title: string, body: string): CueHit {
  let miss = 1;
  const evidence: string[] = [];
  for (const c of compile(cues)) {
    const inTitle = c.re.test(title);
    const inBody = !inTitle && c.re.test(body);
    if (!inTitle && !inBody) continue;
    const w = clamp(c.weight * (inTitle ? 1.15 : 0.85), 0, 0.97);
    miss *= 1 - w;
    evidence.push(c.cue);
  }
  return { strength: 1 - miss, evidence };
}

const WORD_NUMBERS: [RegExp, number][] = [
  [/\b(dezenas|dozens)\b/, 24],
  [/\b(centenas|hundreds)\b/, 200],
  [/\b(milhares|thousands)\b/, 2000],
];

/** Largest casualty figure mentioned ("12 mortos", "1.200 killed", "dezenas de mortos"). */
export function casualtyCount(rawText: string): { dead: number; injured: number } {
  const t = stripAccents(rawText).toLowerCase();
  let dead = 0;
  let injured = 0;
  const num = (s: string) => Number(s.replace(/[.,](?=\d{3}\b)/g, '').replace(',', '.'));
  for (const m of t.matchAll(/(\d[\d.,]*)\s+(?:pessoas\s+|people\s+)?(mortos|mortes|morreram|vitimas fatais|dead|killed|deaths|died|obitos)/g)) {
    dead = Math.max(dead, num(m[1]));
  }
  // Figure after the noun: "número de mortos sobe para 19", "death toll rises to 30".
  for (const m of t.matchAll(/(?:mortos|mortes|obitos|vitimas fatais|death toll|dead|deaths)\s(?:[a-z ,]{0,30}?\s)?(?:chega(?:m)? a|sobe(?:m)? para|vai a|passa(?:m)? de|rises to|climbs to|reaches|at least)\s(\d[\d.,]*)/g)) {
    dead = Math.max(dead, num(m[1]));
  }
  for (const m of t.matchAll(/(\d[\d.,]*)\s+(?:pessoas\s+|people\s+)?(feridos|feridas|injured|wounded)/g)) {
    injured = Math.max(injured, num(m[1]));
  }
  for (const [re, n] of WORD_NUMBERS) {
    if (new RegExp(`${re.source}\\s+(de\\s+)?(mortos|pessoas morreram|dead|killed|people killed)`).test(t)) dead = Math.max(dead, n);
  }
  return { dead: Number.isFinite(dead) ? dead : 0, injured: Number.isFinite(injured) ? injured : 0 };
}

export function severityFromCasualties(dead: number, injured: number): number {
  const eff = dead + injured / 4;
  if (eff < 1) return 0;
  return clamp(0.45 + 0.155 * Math.log10(eff), 0, 0.95);
}

/** g1 regional desks: https://g1.globo.com/ce/ceara/... → Ceará. */
function urlLocationHint(url: string): GeoRef | undefined {
  const m = /^https?:\/\/g1\.globo\.com\/([a-z]{2})\//.exec(url);
  if (!m) return undefined;
  const st = brStateByUf(m[1]);
  if (!st) return undefined;
  return {
    name: st.name,
    level: 'state',
    countryCode: 'BR',
    admin1: st.uf,
    regions: ['south_america'],
    lat: st.lat,
    lon: st.lon,
    confidence: 0.6,
    via: 'url-path',
  };
}

function extractEntities(title: string, places: GeoRef[]): string[] {
  const placeNames = new Set(places.map((p) => p.name));
  const out = new Set<string>();
  const re = /(?<![\p{L}])(\p{Lu}[\p{L}\-']+(?:\s+(?:de|da|do|dos|das|of|the)?\s*\p{Lu}[\p{L}\-']+)*)/gu;
  let first = true;
  for (const m of title.matchAll(re)) {
    const s = m[1].trim();
    const atStart = first && m.index === 0;
    first = false;
    if (atStart && !s.includes(' ')) continue; // sentence-initial capital is not evidence of a name
    if (s.length < 3 || placeNames.has(s)) continue;
    out.add(s);
    if (out.size >= 6) break;
  }
  return [...out];
}

function mergeLocations(list: GeoRef[]): GeoRef[] {
  const byKey = new Map<string, GeoRef>();
  for (const l of list) {
    const key = `${l.level}:${normalizeForMatch(l.name)}:${l.countryCode ?? ''}`;
    const prev = byKey.get(key);
    if (!prev || prev.confidence < l.confidence) byKey.set(key, l);
  }
  // A city implies its state; drop the state entry if the city is present with the same admin1.
  const out = [...byKey.values()];
  return out
    .filter((l) => !(l.level === 'state' && out.some((o) => o.level === 'city' && o.admin1 === l.admin1 && o.confidence >= l.confidence)))
    .sort((a, b) => b.confidence - a.confidence)
    .slice(0, 6);
}

export function analyzeArticle(a: Pick<NormalizedArticle, 'title' | 'summary' | 'url' | 'sourceCountry' | 'hints'>): Analysis {
  const title = normalizeForMatch(a.title);
  const body = normalizeForMatch(a.summary ?? '');
  const raw = `${a.title}. ${a.summary ?? ''}`;

  // Channels
  const channels: ChannelSignal[] = [];
  for (const ch of Object.keys(CHANNEL_CUES) as Channel[]) {
    const hit = scoreCues(CHANNEL_CUES[ch], title, body);
    if (hit.strength >= 0.35) channels.push({ channel: ch, strength: round2(hit.strength), evidence: hit.evidence.slice(0, 4) });
  }
  for (const h of a.hints.channels ?? []) {
    const ex = channels.find((c) => c.channel === h.channel);
    if (ex) ex.strength = Math.max(ex.strength, h.strength);
    else channels.push(h);
  }
  // A crime that ended in arrest/conviction is news about justice, not an ongoing risk.
  const resolved = scoreCues(RESOLVED_CUES, title, body).strength;
  if (resolved >= 0.6) {
    for (const c of channels) if (c.channel === 'physical_safety') c.strength = round2(c.strength * 0.45);
  }
  // An isolated incident (no casualty figures, no sign of ongoing violence) is a weaker safety signal.
  const { dead: d0, injured: i0 } = casualtyCount(`${a.title}. ${a.summary ?? ''}`);
  if (d0 + i0 < 3 && scoreCues(ONGOING_RISK_CUES, title, body).strength < 0.5) {
    for (const c of channels) if (c.channel === 'physical_safety') c.strength = round2(c.strength * 0.7);
  }
  channels.sort((x, y) => y.strength - x.strength);

  // Categories
  const catScore = new Map<Category, number>();
  const bump = (c: Category, s: number) => catScore.set(c, 1 - (1 - (catScore.get(c) ?? 0)) * (1 - s));
  for (const ch of channels) bump(CHANNEL_TO_CATEGORY[ch.channel], ch.strength * 0.9);
  let cueCount = channels.reduce((n, c) => n + c.evidence.length, 0);
  for (const cat of Object.keys(CATEGORY_CUES) as Category[]) {
    const hit = scoreCues(CATEGORY_CUES[cat], title, body);
    if (hit.strength > 0) {
      bump(cat, hit.strength);
      cueCount += hit.evidence.length;
    }
  }
  for (const c of a.hints.categories ?? []) bump(c, 0.9);
  let categories = [...catScore.entries()]
    .filter(([, s]) => s >= 0.4)
    .sort((x, y) => y[1] - x[1])
    .map(([c]) => c);
  // Sports/culture coverage often mentions "crise", "ataque", "guerra" metaphorically.
  const sportsScore = catScore.get('sports') ?? 0;
  if (sportsScore >= 0.85 && channels.every((c) => c.strength < 0.9 || c.channel === 'physical_safety')) {
    categories = ['sports', ...categories.filter((c) => c !== 'sports' && c !== 'security')];
    for (let i = channels.length - 1; i >= 0; i--) {
      if (channels[i].channel === 'physical_safety' || channels[i].channel === 'rights_governance') channels.splice(i, 1);
    }
  }
  if (categories.length === 0) categories = ['other'];
  const topStrength = Math.max(0, ...[...catScore.values()]);
  const classificationConfidence = round2(clamp(0.2 + 0.5 * topStrength + 0.04 * Math.min(cueCount, 5), 0, 0.95));

  // Locations
  const fromText = findPlaces(a.title).map((l) => ({ ...l, confidence: clamp(l.confidence + 0.1, 0, 0.95) }));
  const fromBody = a.summary ? findPlaces(a.summary) : [];
  const urlHint = urlLocationHint(a.url);
  const demonyms: GeoRef[] = [];
  for (const [re, cc] of DEMONYMS) {
    const info = countryInfo(cc);
    if (info && re.test(a.title)) demonyms.push({ name: info.name, level: 'country', countryCode: cc, regions: [info.region], confidence: 0.5, via: 'demonym' });
  }
  const locations = mergeLocations([...(a.hints.locations ?? []), ...fromText, ...fromBody, ...(urlHint ? [urlHint] : []), ...demonyms]);

  // Hazard
  const hazard =
    a.hints.hazard ??
    channels.some((c) => HAZARD_CHANNELS.includes(c.channel) && c.strength >= 0.6 && !(c.channel === 'public_health' && c.strength < 0.8));

  // Severity
  const severityEvidence: string[] = [...(a.hints.severityEvidence ?? [])];
  const isSoft = channels.length === 0 && categories.every((c) => c === 'sports' || c === 'culture' || c === 'other');
  let severity = hazard ? 0.35 : channels.length ? 0.25 : isSoft ? 0.08 : 0.15;
  const { dead, injured } = casualtyCount(raw);
  const casualtySev = severityFromCasualties(dead, injured);
  if (casualtySev > 0 && !isSoft) {
    severity = Math.max(severity, casualtySev);
    if (dead) severityEvidence.push(`${dead} morte(s) relatada(s)`);
    else if (injured) severityEvidence.push(`${injured} ferido(s) relatado(s)`);
  }
  const up = scoreCues(SEVERITY_UP_CUES, title, body);
  const down = scoreCues(SEVERITY_DOWN_CUES, title, body);
  if (!isSoft) {
    severity += clamp(up.strength, 0, 0.4) - clamp(down.strength, 0, 0.2);
    severityEvidence.push(...up.evidence.slice(0, 3).map((e) => `"${e}"`));
  }
  if (a.hints.severity != null) severity = Math.max(severity, a.hints.severity);
  severity = round2(clamp(severity, 0, 1));

  // Urgency
  let urgency = scoreCues(URGENCY_CUES, title, body).strength;
  if (resolved >= 0.6) urgency *= 0.5;
  if (a.hints.urgency != null) urgency = Math.max(urgency, a.hints.urgency);
  if (isSoft) urgency *= 0.3;

  // Affected scope
  const affectedScope = a.hints.affectedScope ?? inferScope(title, body, channels, locations, hazard, a.sourceCountry);

  return {
    categories,
    channels,
    locations,
    affectedScope,
    severity,
    severityEvidence: [...new Set(severityEvidence)].slice(0, 5),
    urgency: round2(clamp(urgency, 0, 1)),
    hazard,
    entities: extractEntities(a.title, locations),
    analyzer: 'rules',
    classificationConfidence,
  };
}

function inferScope(
  title: string,
  body: string,
  channels: ChannelSignal[],
  locations: GeoRef[],
  hazard: boolean,
  sourceCountry?: string,
): AffectedScope {
  const global = scoreCues(GLOBAL_SCOPE_CUES, title, body).strength;
  const national = scoreCues(NATIONAL_SCOPE_CUES, title, body).strength;
  const systemic = channels.some(
    (c) => ['energy_fuel', 'interest_credit', 'cost_of_living', 'employment', 'rights_governance', 'digital_services', 'education_access'].includes(c.channel) && c.strength >= 0.5,
  );
  if (global >= 0.8 && (systemic || channels.some((c) => c.channel === 'public_health'))) return 'global';
  if (national >= 0.7 && (systemic || hazard)) {
    const country = locations.find((l) => l.countryCode)?.countryCode ?? sourceCountry;
    if (country) return 'national';
  }
  if (locations.length === 0) return 'local';
  const levels = locations.map((l) => l.level);
  if (hazard) {
    if (levels.includes('city')) return 'local';
    if (levels.includes('state') || levels.includes('macroregion')) return 'state';
    if (levels.includes('world_region') && !levels.includes('country')) return 'world_region';
    return 'state';
  }
  if (levels.includes('city')) return systemic && levels.includes('country') ? 'national' : 'local';
  if (levels.includes('state') || levels.includes('macroregion')) return 'state';
  if (levels.includes('country')) return systemic ? 'national' : 'local';
  if (levels.includes('world_region')) return 'world_region';
  return 'local';
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
