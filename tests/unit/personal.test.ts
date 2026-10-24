import { describe, expect, it } from 'vitest';
import { analyzeArticle } from '../../server/analysis/rules';
import { computeImpact } from '../../shared/impact/engine';
import { sanitizeProfile, type StoredProfile } from '../../shared/profile';
import { FORTALEZA, NOW, article, event } from '../helpers';

const fromText = (title: string, summary?: string) => {
  const a = article({ title, summary });
  return event({ title, summary, analysis: analyzeArticle(a) }, NOW);
};
const base: StoredProfile = { ...FORTALEZA, onboarded: true };
const score = (e: ReturnType<typeof event>, p: StoredProfile = base) => computeImpact(e, p, NOW);

describe('personal answers in the impact engine', () => {
  it('bus users feel transport strikes more; car drivers feel fuel prices more', () => {
    const strike = fromText('Greve de ônibus paralisa o transporte público em Fortaleza nesta segunda');
    const fuel = fromText('Petrobras anuncia alta de 8% no preço da gasolina nas refinarias', 'Reajuste vale em todo o país.');
    const bus = { ...base, routine: { transport: ['public' as const] } };
    const car = { ...base, routine: { transport: ['car' as const] } };
    expect(score(strike, bus).score).toBeGreaterThan(score(strike, car).score);
    expect(score(fuel, car).score).toBeGreaterThan(score(fuel, bus).score);
    expect(score(fuel, car).factors.find((f) => f.key === 'practical')!.detail).toMatch(/pesa mais porque você anda de carro/);
  });

  it('debt and retirement make interest rates and pensions weigh more', () => {
    const selic = fromText('Banco Central eleva a taxa Selic para 15% ao ano', 'Copom decide alta dos juros em todo o país.');
    const inss = fromText('INSS anuncia novo calendário de pagamento das aposentadorias', 'Mudança vale em todo o país.');
    expect(score(selic, { ...base, work: { hasDebt: true } }).score).toBeGreaterThan(score(selic).score);
    expect(score(inss, { ...base, work: { occupation: 'retired' } }).score).toBeGreaterThan(score(inss).score);
  });

  it('category importance raises or lowers interest, never below the "no bubble" rules', () => {
    const tech = fromText('Nova regra para aplicativos de celular entra em vigor no Brasil');
    const loves = score(tech, { ...base, categoryImportance: { technology: 2 } }).score;
    const neutral = score(tech).score;
    const little = score(tech, { ...base, categoryImportance: { technology: -1 } }).score;
    expect(loves).toBeGreaterThan(neutral);
    expect(neutral).toBeGreaterThan(little);
  });

  it('football: no interest → tiny grain; your club in the headline → bigger', () => {
    const match = fromText('Fortaleza vence o Ceará no Castelão e assume a liderança do Brasileirão', 'Gols no segundo tempo decidiram a partida.');
    const noFootball = score(match, { ...base, football: { interest: 'no' } }).score;
    const fan = score(match, { ...base, football: { interest: 'yes', club: 'Fortaleza' } });
    const casual = score(match, { ...base, football: { interest: 'some' } }).score;
    expect(fan.score).toBeGreaterThan(casual);
    expect(casual).toBeGreaterThan(noFootball);
    expect(fan.rules.join(' ')).toMatch(/seu time/);
  });

  it('topics to see less shrink — but an emergency near the user is never reduced', () => {
    const crime = fromText('Tiroteio em bairro de São Paulo deixa dois feridos');
    const avoidViolence = { ...base, avoidTopics: ['violence' as const] };
    const normal = score(crime).score;
    const avoided = score(crime, avoidViolence);
    expect(avoided.score).toBeLessThan(normal);
    expect(avoided.rules.join(' ')).toMatch(/ver menos violência/);

    const emergency = event({
      analysis: {
        categories: ['security'],
        channels: [{ channel: 'physical_safety', strength: 1, evidence: [] }],
        locations: [{ name: 'Fortaleza', level: 'city', countryCode: 'BR', admin1: 'CE', lat: -3.73, lon: -38.53, confidence: 0.9, via: 't' }],
        affectedScope: 'local',
        severity: 0.85,
        severityEvidence: [],
        urgency: 1,
        hazard: true,
        entities: [],
        analyzer: 'rules',
        classificationConfidence: 0.8,
      },
    }, NOW);
    expect(score(emergency, avoidViolence).urgent).toBe(true);
    expect(score(emergency, avoidViolence).score).toBe(score(emergency).score);
  });

  it('important places count as nearby (a bit less than home)', () => {
    const flood = fromText('Enchente atinge bairros de Juazeiro do Norte e desaloja famílias');
    const withFamily = { ...base, places: [{ name: 'Juazeiro do Norte', admin1: 'CE', countryCode: 'BR', countryName: 'Brasil', lat: -7.2, lon: -39.3 }] };
    const r = score(flood, withFamily);
    expect(r.score).toBeGreaterThan(score(flood).score);
    expect(r.proximityLabel).toMatch(/lugar importante para você/);
  });

  it('profile validation keeps only known answers', () => {
    const p = sanitizeProfile({ routine: { transport: ['car', 'teleport'] }, work: { occupation: 'astronaut', hasDebt: 'yes' }, football: { interest: 'maybe' } });
    expect(p.routine?.transport).toEqual(['car']);
    expect(p.work?.occupation).toBeUndefined();
    expect(p.work?.hasDebt).toBeUndefined();
    expect(p.football).toBeUndefined();
  });
});
