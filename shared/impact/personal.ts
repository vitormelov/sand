import { mentionsName } from '../geo/gazetteer';
import type { ProfileAnswers, Importance } from '../profile';
import { normalizeForMatch } from '../text';
import type { Analysis, Category, Channel } from '../types';

/**
 * How the questionnaire answers change the estimate. Every number lives here,
 * with the reason shown to the user in the details panel.
 */

type Mult = { channel: Channel; k: number; why: string };

/** Channel weight multipliers from daily routine, work and finances. */
export function contextMultipliers(p: ProfileAnswers): Mult[] {
  const out: Mult[] = [];
  const add = (channel: Channel, k: number, why: string) => out.push({ channel, k, why });
  const t = p.routine?.transport ?? [];
  if (t.includes('car')) add('energy_fuel', 1.3, 'você anda de carro');
  if (t.includes('motorcycle')) add('energy_fuel', 1.25, 'você anda de moto');
  if (t.includes('public')) {
    add('mobility', 1.4, 'você usa transporte público');
    add('infrastructure', 1.1, 'você usa transporte público');
  }
  if (t.includes('app')) {
    add('mobility', 1.15, 'você usa aplicativo/táxi');
    add('energy_fuel', 1.1, 'você usa aplicativo/táxi');
  }
  if (t.includes('bike_walk')) {
    add('mobility', 1.1, 'você anda de bicicleta ou a pé');
    add('environment', 1.15, 'você anda de bicicleta ou a pé');
  }
  if (p.routine?.rents) add('cost_of_living', 1.15, 'você mora de aluguel');
  if (p.routine?.schoolKids) {
    add('education_access', 1.6, 'você tem filhos em idade escolar');
    add('public_health', 1.1, 'você tem filhos em idade escolar');
  }
  switch (p.work?.occupation) {
    case 'clt':
      add('employment', 1.25, 'você é empregado(a) com carteira');
      break;
    case 'public_servant':
      add('rights_governance', 1.25, 'você é servidor(a) público(a)');
      add('employment', 1.1, 'você é servidor(a) público(a)');
      break;
    case 'self_employed':
      add('cost_of_living', 1.1, 'você é autônomo(a)/empreendedor(a)');
      add('interest_credit', 1.15, 'você é autônomo(a)/empreendedor(a)');
      add('rights_governance', 1.1, 'você é autônomo(a)/empreendedor(a)');
      break;
    case 'student':
      add('education_access', 1.5, 'você é estudante');
      break;
    case 'retired':
      add('employment', 1.3, 'você é aposentado(a)/pensionista');
      add('public_health', 1.2, 'você é aposentado(a)/pensionista');
      break;
    case 'job_seeking':
      add('employment', 1.45, 'você está procurando emprego');
      break;
  }
  if (p.work?.hasDebt) add('interest_credit', 1.4, 'você tem financiamento ou dívidas');
  if (p.work?.invests) add('interest_credit', 1.2, 'você investe');
  if (p.work?.socialBenefit) {
    add('employment', 1.3, 'você recebe benefício social');
    add('cost_of_living', 1.15, 'você recebe benefício social');
  }
  return out;
}

export const MULTIPLIER_RANGE = [0.7, 1.6] as const;

/** Combined multiplier and reasons for one channel. */
export function channelBoost(mults: Mult[], channel: Channel): { k: number; why: string[] } {
  let k = 1;
  const why: string[] = [];
  for (const m of mults) {
    if (m.channel !== channel) continue;
    k *= m.k;
    if (!why.includes(m.why)) why.push(m.why);
  }
  return { k: Math.min(MULTIPLIER_RANGE[1], Math.max(MULTIPLIER_RANGE[0], k)), why };
}

/** Interest factor value for each importance level. */
export const IMPORTANCE_VALUE: Record<Importance, number> = { [-2]: 0, [-1]: 0.15, 0: 0.5, 1: 0.8, 2: 1 };

const FOOTBALL_IMPORTANCE = { no: -2, some: 0, yes: 1 } as const;

function importanceOf(p: ProfileAnswers, c: Category): Importance {
  if (c === 'sports' && p.football) return FOOTBALL_IMPORTANCE[p.football.interest];
  return p.categoryImportance?.[c] ?? 0;
}

/** Interest from the answers; undefined when the user never answered (legacy rule applies). */
export function answeredInterest(p: ProfileAnswers, cats: Category[]): { value: number; detail: string } | undefined {
  if (!p.categoryImportance && !p.football) return undefined;
  const top = cats.slice(0, 2);
  let best = -3 as number;
  let bestCat: Category = top[0] ?? 'other';
  for (const c of top) {
    const i = importanceOf(p, c);
    if (i > best) {
      best = i;
      bestCat = c;
    }
  }
  const imp = Math.max(-2, Math.min(2, best)) as Importance;
  const word = { [-2]: 'tema que você não quer ver', [-1]: 'pouco importante para você', 0: 'importância normal para você', 1: 'importante para você', 2: 'muito importante para você' }[imp];
  return { value: IMPORTANCE_VALUE[imp], detail: `${word} (${bestCat === 'sports' ? 'esportes' : bestCat})` };
}

/** "Your club" in the headline/summary. */
export function clubMentioned(p: ProfileAnswers, text: string): string | undefined {
  const club = p.football?.club?.trim();
  if (!club || club.length < 3 || p.football?.interest === 'no') return undefined;
  return mentionsName(text, club) ? club : undefined;
}

const ELECTORAL = /\b(eleic|eleit|candidat|partid|campanha|turno|urna|pesquisa eleitoral|votac|voto|election|campaign)/;

/** Is this a story the user asked to see less of? Returns the reason, if so. */
export function avoidedReason(p: ProfileAnswers, a: Analysis, text: string): string | undefined {
  const top = a.categories[0];
  if (top && importanceOf(p, top) === -2) return top === 'sports' ? 'você não acompanha esportes' : 'categoria que você prefere não ver';
  const avoid = p.avoidTopics ?? [];
  const strongest = a.channels[0]?.channel;
  if (avoid.includes('violence') && (top === 'security' || strongest === 'physical_safety')) return 'você prefere ver menos violência';
  if (avoid.includes('party_politics') && a.categories.includes('politics') && ELECTORAL.test(normalizeForMatch(text))) return 'você prefere ver menos política partidária';
  if (avoid.includes('celebrities') && top === 'culture' && a.channels.length === 0) return 'você prefere ver menos celebridades';
  return undefined;
}
