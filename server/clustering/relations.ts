import { normalizeForMatch } from '../../shared/text';
import type { Channel, EventRelation, NewsEvent, RelationKind } from '../../shared/types';

/**
 * Initial causal-link model between consolidated events.
 *
 * The link table only says which transmissions are economically/physically
 * plausible. Whether a specific pair is linked depends on textual evidence:
 *  - documented: the later story explicitly attributes itself to the earlier driver
 *                ("alta da gasolina após disparada do petróleo");
 *  - probable:   the later story mentions the driver, without a causal connector;
 *  - possible:   only the link table + geographic compatibility.
 * Nothing weaker than "possible" is stored; nothing is ever presented as fact.
 */

export const CAUSAL_LINKS: [from: Channel, to: Channel, explanation: string][] = [
  ['energy_fuel', 'cost_of_living', 'preços de energia e combustíveis costumam se refletir no custo de vida'],
  ['energy_fuel', 'mobility', 'combustível mais caro pressiona custos de transporte'],
  ['interest_credit', 'cost_of_living', 'juros e câmbio afetam preços e crédito ao consumidor'],
  ['interest_credit', 'employment', 'juros altos tendem a desacelerar contratações'],
  ['employment', 'cost_of_living', 'renda e emprego afetam o orçamento das famílias'],
  ['natural_hazard', 'infrastructure', 'eventos extremos podem interromper energia, água e serviços'],
  ['natural_hazard', 'mobility', 'eventos extremos podem bloquear vias e transporte'],
  ['natural_hazard', 'public_health', 'desastres podem gerar riscos sanitários'],
  ['physical_safety', 'mobility', 'violência pode interromper circulação e transporte'],
  ['public_health', 'employment', 'surtos podem afetar trabalho e renda'],
];

const CAUSAL_CONNECTORS = /\b(por causa d|devido a|devido ao|em razao d|em decorrencia d|reflexo d|impulsionad|apos (a |o )?(alta|queda|disparada|aumento|crise)|com a (alta|disparada|crise)|due to|because of|driven by|amid|following|after (the )?(surge|spike|rise|crisis))/;

const MAX_RELATIONS = 4;
const WINDOW_MS = 72 * 3_600_000;

function geoCompatible(cause: NewsEvent, effect: NewsEvent): boolean {
  if (cause.analysis.affectedScope === 'global') return true;
  const causeCountries = new Set(cause.analysis.locations.map((l) => l.countryCode).filter(Boolean));
  if (causeCountries.size === 0 && cause.sourceCountry) causeCountries.add(cause.sourceCountry);
  const effectCountries = effect.analysis.locations.map((l) => l.countryCode).filter(Boolean);
  if (effectCountries.length === 0 && effect.sourceCountry) effectCountries.push(effect.sourceCountry);
  if (cause.analysis.affectedScope === 'national') return effectCountries.some((c) => causeCountries.has(c!));
  // Local causes: need the same state/city.
  const admins = new Set(cause.analysis.locations.map((l) => l.admin1).filter(Boolean));
  return effect.analysis.locations.some((l) => l.admin1 && admins.has(l.admin1));
}

export function findRelations(effect: NewsEvent, candidates: Iterable<NewsEvent>): EventRelation[] {
  const out: (EventRelation & { rank: number })[] = [];
  const effectText = normalizeForMatch(`${effect.title} ${effect.summary ?? ''}`);
  const tEffect = Date.parse(effect.publishedAt ?? effect.firstSeenAt);
  for (const cause of candidates) {
    if (cause.id === effect.id) continue;
    const tCause = Date.parse(cause.publishedAt ?? cause.firstSeenAt);
    if (!(tCause <= tEffect) || tEffect - tCause > WINDOW_MS) continue;
    for (const [from, to, explanation] of CAUSAL_LINKS) {
      const c = cause.analysis.channels.find((x) => x.channel === from && x.strength >= 0.6);
      const e = effect.analysis.channels.find((x) => x.channel === to && x.strength >= 0.5);
      if (!c || !e) continue;
      const mentionsDriver = c.evidence.some((ev) => effectText.includes(` ${normalizeForMatch(ev).trim()}`));
      let kind: RelationKind;
      if (mentionsDriver && CAUSAL_CONNECTORS.test(effectText)) kind = 'documented';
      else if (mentionsDriver) kind = 'probable';
      else if (geoCompatible(cause, effect)) kind = 'possible';
      else continue;
      const rank = kind === 'documented' ? 3 : kind === 'probable' ? 2 : 1;
      out.push({ eventId: cause.id, kind, link: `${from} → ${to}`, explanation, rank });
    }
  }
  const best = new Map<string, EventRelation & { rank: number }>();
  for (const r of out) {
    const prev = best.get(r.eventId);
    if (!prev || prev.rank < r.rank) best.set(r.eventId, r);
  }
  return [...best.values()]
    .sort((a, b) => b.rank - a.rank)
    .slice(0, MAX_RELATIONS)
    .map(({ rank: _rank, ...r }) => r);
}
