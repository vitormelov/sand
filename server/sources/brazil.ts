import { findPlaces } from '../../shared/geo/gazetteer';
import type { GeoRef } from '../../shared/types';
import type { RawItem } from '../types';
import { httpGet } from './http';
import type { FetchContext, FetchResult, SourceConnector } from './types';

/**
 * Brazilian official data services (JSON/CSV APIs, not RSS). Items built from data say which
 * body published it and link to the official page; nothing is written as if it were reporting.
 */

const BRASIL: GeoRef = { name: 'Brasil', level: 'country', countryCode: 'BR', regions: ['south_america'], confidence: 0.9, via: 'official-feed' };

/** "23/10/2026 02:30:54" (Brasília time) → ISO. */
export function brDateTime(s: unknown): string | undefined {
  const m = /^(\d{2})\/(\d{2})\/(\d{4})(?:\s+(\d{2}):(\d{2})(?::(\d{2}))?)?$/.exec(String(s ?? '').trim());
  if (!m) return undefined;
  const t = Date.parse(`${m[3]}-${m[2]}-${m[1]}T${m[4] ?? '12'}:${m[5] ?? '00'}:${m[6] ?? '00'}-03:00`);
  return Number.isFinite(t) ? new Date(t).toISOString() : undefined;
}

const sleep = (ms: number, signal: AbortSignal) =>
  new Promise<void>((resolve) => {
    const t = setTimeout(resolve, ms);
    signal.addEventListener('abort', () => (clearTimeout(t), resolve()), { once: true });
  });

// ---------------------------------------------------------------------------
// IBGE — Agência de Notícias, through the official open API (servicodados.ibge.gov.br).
// The agency's RSS page sits behind a bot challenge; the API is the documented route.

const IBGE_URL = 'https://servicodados.ibge.gov.br/api/v3/noticias/?qtd=30';

interface IbgeItem {
  id: number;
  tipo?: string;
  titulo?: string;
  introducao?: string;
  data_publicacao?: string;
  link?: string;
}

export function parseIbge(json: string): RawItem[] {
  const data = JSON.parse(json) as { items?: IbgeItem[] };
  return (data.items ?? []).map((it) => ({
    title: it.titulo,
    url: it.link?.replace(/^http:/, 'https:'),
    summary: it.introducao,
    publishedAt: brDateTime(it.data_publicacao),
    language: 'pt',
    hints: { eventKey: `ibge:${it.id}`, locations: [BRASIL] },
  }));
}

export function ibgeConnector(): SourceConnector {
  return {
    id: 'ibge',
    name: 'IBGE — Agência de Notícias',
    kind: 'official',
    group: 'official',
    reliability: 0.95,
    country: 'BR',
    language: 'pt',
    homepage: 'https://agenciadenoticias.ibge.gov.br/',
    intervalMs: 30 * 60_000,
    enabled: true,
    async fetch(ctx: FetchContext): Promise<FetchResult> {
      const res = await httpGet(IBGE_URL, { signal: ctx.signal, state: ctx.state, headers: { Accept: 'application/json' } });
      if (res.status === 304) return { items: [], notModified: true, state: res.state };
      return { items: parseIbge(res.text), state: res.state };
    },
  };
}

// ---------------------------------------------------------------------------
// ANEEL — bandeira tarifária (the monthly surcharge on every electricity bill).
// Open data portal (CKAN datastore), licence ODbL.

const ANEEL_URL =
  'https://dadosabertos.aneel.gov.br/api/3/action/datastore_search?resource_id=0591b8f6-fe54-437b-b72b-1aa2efd46e42&sort=DatCompetencia%20desc&limit=3';
const ANEEL_PAGE = 'https://www.gov.br/aneel/pt-br/assuntos/tarifas/bandeiras-tarifarias';
const MONTHS = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];

interface AneelRecord {
  DatCompetencia?: string;
  NomBandeiraAcionada?: string;
  VlrAdicionalBandeira?: string;
}

function flagSeverity(flag: string): number {
  if (/escassez/i.test(flag)) return 0.7;
  if (/vermelha.*2|patamar 2/i.test(flag)) return 0.6;
  if (/vermelha/i.test(flag)) return 0.5;
  if (/amarela/i.test(flag)) return 0.35;
  return 0.12;
}

/**
 * Current and upcoming months only (a past month's flag no longer changes anyone's bill), and only
 * when it means a change: a costlier flag, or the return to green after one.
 */
export function parseAneelFlags(json: string, now = Date.now()): RawItem[] {
  const data = JSON.parse(json) as { result?: { records?: AneelRecord[] } };
  const nowBr = new Date(now - 3 * 3_600_000);
  const thisMonth = `${nowBr.getUTCFullYear()}-${String(nowBr.getUTCMonth() + 1).padStart(2, '0')}`;
  const records = [...(data.result?.records ?? [])].sort((a, b) => String(a.DatCompetencia).localeCompare(String(b.DatCompetencia)));
  const out: RawItem[] = [];
  for (const [i, r] of records.entries()) {
    const month = r.DatCompetencia?.slice(0, 7);
    const flag = r.NomBandeiraAcionada?.trim();
    if (!month || !flag || month < thisMonth) continue;
    const previous = records[i - 1]?.NomBandeiraAcionada?.trim();
    const green = /verde/i.test(flag);
    if (green && (!previous || /verde/i.test(previous))) continue;
    const perMwh = Number((r.VlrAdicionalBandeira ?? '').replace(/\./g, '').replace(',', '.'));
    const per100kWh = Number.isFinite(perMwh) ? perMwh / 10 : 0;
    const [y, m] = month.split('-').map(Number);
    const label = `${MONTHS[m - 1]} de ${y}`;
    const extra = per100kWh > 0
      ? `Adicional de R$ ${per100kWh.toFixed(2).replace('.', ',')} a cada 100 kWh consumidos.`
      : `Sem cobrança adicional na conta de luz (no mês anterior a bandeira era ${previous?.toLowerCase()}).`;
    const severity = flagSeverity(flag);
    out.push({
      title: green ? `ANEEL: bandeira tarifária volta a verde em ${label}` : `ANEEL: bandeira tarifária ${flag.toLowerCase()} em ${label}`,
      url: `${ANEEL_PAGE}?competencia=${month}`,
      summary: `Bandeira ${flag.toLowerCase()} vale para as contas de luz de ${label} em todo o sistema interligado. ${extra} Dado oficial da ANEEL (dados abertos).`,
      language: 'pt',
      hints: {
        eventKey: `aneel-bandeira:${month}`,
        revision: flag,
        severity,
        severityEvidence: [`bandeira ${flag.toLowerCase()}`],
        urgency: 0.3,
        locations: [BRASIL],
        channels: [
          { channel: 'energy_fuel', strength: severity >= 0.3 ? 0.9 : 0.4, evidence: ['bandeira tarifária'] },
          { channel: 'cost_of_living', strength: severity >= 0.3 ? 0.8 : 0.3, evidence: ['conta de luz'] },
        ],
        categories: ['economy'],
        affectedScope: 'national',
      },
    });
  }
  return out;
}

export function aneelFlagConnector(): SourceConnector {
  return {
    id: 'aneel-bandeira',
    name: 'ANEEL — Bandeira tarifária',
    kind: 'official',
    group: 'official',
    reliability: 0.95,
    country: 'BR',
    language: 'pt',
    homepage: ANEEL_PAGE,
    intervalMs: 6 * 60 * 60_000,
    enabled: true,
    async fetch(ctx: FetchContext): Promise<FetchResult> {
      const res = await httpGet(ANEEL_URL, { signal: ctx.signal, state: ctx.state, timeoutMs: 30_000, headers: { Accept: 'application/json' } });
      if (res.status === 304) return { items: [], notModified: true, state: res.state };
      return { items: parseAneelFlags(res.text, ctx.now), state: res.state };
    },
  };
}

// ---------------------------------------------------------------------------
// InfoDengue (Fiocruz / FGV) — weekly dengue alert level per municipality, public API.
// Covers the 27 state capitals; only orange (3) and red (4) levels become items.

export const CAPITALS: [geocode: number, name: string, uf: string][] = [
  [1200401, 'Rio Branco', 'AC'], [2704302, 'Maceió', 'AL'], [1600303, 'Macapá', 'AP'], [1302603, 'Manaus', 'AM'],
  [2927408, 'Salvador', 'BA'], [2304400, 'Fortaleza', 'CE'], [5300108, 'Brasília', 'DF'], [3205309, 'Vitória', 'ES'],
  [5208707, 'Goiânia', 'GO'], [2111300, 'São Luís', 'MA'], [5103403, 'Cuiabá', 'MT'], [5002704, 'Campo Grande', 'MS'],
  [3106200, 'Belo Horizonte', 'MG'], [1501402, 'Belém', 'PA'], [2507507, 'João Pessoa', 'PB'], [4106902, 'Curitiba', 'PR'],
  [2611606, 'Recife', 'PE'], [2211001, 'Teresina', 'PI'], [3304557, 'Rio de Janeiro', 'RJ'], [2408102, 'Natal', 'RN'],
  [4314902, 'Porto Alegre', 'RS'], [1100205, 'Porto Velho', 'RO'], [1400100, 'Boa Vista', 'RR'], [4205407, 'Florianópolis', 'SC'],
  [3550308, 'São Paulo', 'SP'], [2800308, 'Aracaju', 'SE'], [1721000, 'Palmas', 'TO'],
];

interface DengueWeek {
  SE: number;
  nivel: number;
  casos_est?: number;
  p_inc100k?: number;
  municipio_nome?: string;
  versao_modelo?: string;
}

const DENGUE_LEVEL: Record<number, { label: string; severity: number }> = {
  3: { label: 'laranja', severity: 0.5 },
  4: { label: 'vermelho', severity: 0.68 },
};

export function parseInfoDengue(json: string, city: { geocode: number; name: string; uf: string }): RawItem[] {
  const weeks = JSON.parse(json) as DengueWeek[];
  if (!Array.isArray(weeks) || weeks.length === 0) return [];
  const latest = weeks.reduce((a, b) => (b.SE > a.SE ? b : a));
  const level = DENGUE_LEVEL[latest.nivel];
  if (!level) return [];
  const week = String(latest.SE).slice(4);
  const place = findPlaces(city.name).find((p) => p.level === 'city' && p.admin1 === city.uf);
  const loc: GeoRef = place
    ? { ...place, confidence: 0.9, via: 'official-feed' }
    : { name: city.name, level: 'city', countryCode: 'BR', admin1: city.uf, regions: ['south_america'], confidence: 0.85, via: 'official-feed' };
  const inc = latest.p_inc100k != null ? ` Incidência estimada: ${latest.p_inc100k.toFixed(1).replace('.', ',')} casos por 100 mil habitantes.` : '';
  return [{
    title: `InfoDengue: alerta ${level.label} de dengue em ${city.name} (${city.uf}), semana ${week}`,
    url: `https://info.dengue.mat.br/alerta/${city.geocode}/dengue?se=${latest.SE}`,
    summary: `O sistema InfoDengue (Fiocruz/FGV) classificou ${city.name} no nível ${level.label} de alerta para dengue na semana epidemiológica ${week}.${inc} Dado de vigilância, atualizado semanalmente.`,
    publishedAt: latest.versao_modelo ? `${latest.versao_modelo}T12:00:00-03:00` : undefined,
    language: 'pt',
    hints: {
      eventKey: `infodengue:${city.geocode}:${latest.SE}`,
      revision: String(latest.nivel),
      hazard: latest.nivel >= 4,
      severity: level.severity,
      severityEvidence: [`alerta ${level.label} InfoDengue`],
      urgency: latest.nivel >= 4 ? 0.6 : 0.4,
      locations: [loc],
      channels: [{ channel: 'public_health', strength: 0.9, evidence: ['dengue'] }],
      categories: ['health'],
      affectedScope: 'local',
    },
  }];
}

/** Epidemiological week (Sunday-start, CDC/MMWR style), good enough to bound the query. */
function epiWeek(t: number): { year: number; week: number } {
  const d = new Date(t);
  const year = d.getUTCFullYear();
  const jan1 = Date.UTC(year, 0, 1);
  const firstSunday = jan1 - new Date(jan1).getUTCDay() * 86_400_000 + (new Date(jan1).getUTCDay() > 3 ? 7 * 86_400_000 : 0);
  const week = Math.floor((t - firstSunday) / (7 * 86_400_000)) + 1;
  return week < 1 ? { year: year - 1, week: 52 } : { year, week: Math.min(week, 53) };
}

export function infoDengueConnector(): SourceConnector {
  return {
    id: 'infodengue',
    name: 'InfoDengue (Fiocruz) — capitais',
    kind: 'official',
    group: 'alerts',
    reliability: 0.9,
    country: 'BR',
    language: 'pt',
    homepage: 'https://info.dengue.mat.br/',
    intervalMs: 12 * 60 * 60_000,
    enabled: true,
    async fetch(ctx: FetchContext): Promise<FetchResult> {
      const end = epiWeek(ctx.now);
      const start = epiWeek(ctx.now - 21 * 86_400_000);
      const items: RawItem[] = [];
      let failures = 0;
      for (const [geocode, name, uf] of CAPITALS) {
        if (ctx.signal.aborted) break;
        const url = `https://info.dengue.mat.br/api/alertcity?geocode=${geocode}&disease=dengue&format=json&ew_start=${start.week}&ew_end=${end.week}&ey_start=${start.year}&ey_end=${end.year}`;
        try {
          const res = await httpGet(url, { signal: ctx.signal, timeoutMs: 30_000, headers: { Accept: 'application/json' } });
          items.push(...parseInfoDengue(res.text, { geocode, name, uf }));
        } catch (err) {
          failures++;
          if (failures >= 5) throw err; // the service is down: let the scheduler back off
        }
        await sleep(1_500, ctx.signal); // one capital at a time, gently
      }
      return { items };
    },
  };
}

// ---------------------------------------------------------------------------
// Centro de Sismologia da USP (RSBR) — tremors inside Brazil, FDSN event web service.

const RSBR_MIN_MAG = 2.5;

export function parseRsbr(text: string): RawItem[] {
  const out: RawItem[] = [];
  for (const line of text.split('\n')) {
    if (!line || line.startsWith('#')) continue;
    const [id, time, lat, lon, depth, , , , , , mag, , place, type] = line.split('|');
    const m = Number(mag);
    const where = /^(.+)\/([A-Z]{2})$/.exec(place?.trim() ?? '');
    if (!id || !where || !Number.isFinite(m) || m < RSBR_MIN_MAG || (type && type !== 'earthquake')) continue;
    const [, city, uf] = where;
    const offshore = /plataforma continental/i.test(city);
    const severity = m >= 5 ? 0.55 : m >= 4 ? 0.35 : m >= 3.5 ? 0.25 : 0.15;
    out.push({
      title: `Tremor de magnitude ${m.toFixed(1).replace('.', ',')} ${offshore ? `na plataforma continental (${uf})` : `em ${city} (${uf})`}`,
      url: `https://moho.iag.usp.br/eq/event/${id}`,
      summary: `Registrado pela Rede Sismográfica Brasileira (Centro de Sismologia da USP) a ${Number(depth).toFixed(0)} km de profundidade. Tremores desse porte no Brasil costumam ser leves; podem ser sentidos perto do epicentro.`,
      occurredAt: `${time}Z`,
      publishedAt: `${time}Z`,
      language: 'pt',
      hints: {
        eventKey: `rsbr:${id}`,
        hazardType: 'EQ',
        hazard: m >= 4,
        severity,
        severityEvidence: [`magnitude ${m.toFixed(1)}`],
        urgency: m >= 4 ? 0.5 : 0.2,
        locations: [{ name: offshore ? `Plataforma continental (${uf})` : `${city} (${uf})`, level: 'city', countryCode: 'BR', admin1: uf, regions: ['south_america'], lat: Number(lat), lon: Number(lon), confidence: 0.95, via: 'official-feed' }],
        channels: [{ channel: 'natural_hazard', strength: m >= 4 ? 0.9 : 0.5, evidence: ['tremor de terra'] }],
        categories: ['climate'],
        affectedScope: 'local',
      },
    });
  }
  return out;
}

export function rsbrConnector(): SourceConnector {
  return {
    id: 'rsbr-usp',
    name: 'Sismologia USP (RSBR)',
    kind: 'official',
    group: 'alerts',
    reliability: 0.93,
    country: 'BR',
    language: 'pt',
    homepage: 'https://www.sismo.iag.usp.br/',
    intervalMs: 30 * 60_000,
    enabled: true,
    async fetch(ctx: FetchContext): Promise<FetchResult> {
      const since = new Date(ctx.now - 3 * 86_400_000).toISOString().slice(0, 19);
      const url = `https://moho.iag.usp.br/fdsnws/event/1/query?format=text&starttime=${since}&minlatitude=-34&maxlatitude=6&minlongitude=-74&maxlongitude=-28&minmagnitude=${RSBR_MIN_MAG}`;
      const res = await httpGet(url, { signal: ctx.signal, state: ctx.state, timeoutMs: 30_000 });
      if (res.status === 304) return { items: [], notModified: true, state: res.state };
      return { items: parseRsbr(res.text), state: res.state };
    },
  };
}
