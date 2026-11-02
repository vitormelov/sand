import type { ProfileAnswers } from '../profile';
import type { NewsEvent, UserProfile } from '../types';
import { IMPACT_BANDS } from './config';
import { computeImpact, type ImpactResult } from './engine';

/** Share of a research grain's size that comes from its scientific weight (the rest is personal). */
export const SCIENTIFIC_SHARE = 0.4;

/**
 * SAND Conhecimento: a paper's grain mixes how much it concerns *you* (the same Personal
 * Impact Engine as the news: your interests, your country, practical consequences) with its
 * scientific weight (journal impact and citations, computed at collection time).
 */
export function researchImpact(e: NewsEvent, profile: UserProfile & ProfileAnswers, now = Date.now()): ImpactResult {
  const personal = computeImpact(e, profile, now);
  const weight = e.research?.weight ?? 0;
  const score = Math.round(Math.min(100, Math.max(0, (1 - SCIENTIFIC_SHARE) * personal.score + SCIENTIFIC_SHARE * weight * 100)));
  const band = IMPACT_BANDS.find((b) => score < b.max) ?? IMPACT_BANDS[IMPACT_BANDS.length - 1];
  const r = e.research;
  const why = r
    ? [
        `${r.citations} citação(ões)`,
        r.fwci ? `impacto normalizado ${r.fwci.toFixed(1)} (1 = média da área)` : undefined,
        r.journalImpact != null ? `revista com ${r.journalImpact} citações por artigo em média` : undefined,
      ]
        .filter(Boolean)
        .join(', ')
    : 'sem dados de citação';
  return {
    ...personal,
    score,
    band: band.id,
    bandLabel: band.label,
    // A paper never triggers the "imminent risk" treatment of the news.
    urgent: false,
    rules: [
      `relevância para você: ${personal.score}/100 (${Math.round((1 - SCIENTIFIC_SHARE) * 100)}% do tamanho)`,
      `peso científico: ${Math.round(weight * 100)}/100 — ${why} (${Math.round(SCIENTIFIC_SHARE * 100)}% do tamanho)`,
      ...personal.rules,
    ],
  };
}
