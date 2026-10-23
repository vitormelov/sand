import { XMLParser } from 'fast-xml-parser';
import { brStateByUf, findPlaces } from '../../shared/geo/gazetteer';
import type { GeoRef } from '../../shared/types';
import type { RawItem } from '../types';
import { httpGet } from './http';
import type { FetchContext, FetchResult, SourceConnector } from './types';

/**
 * Official, structured hazard feeds. They carry coordinates, magnitudes and
 * alert levels, which let the impact engine reason about real geography.
 */

const xmlParser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '@_', processEntities: false, trimValues: true });

const USGS_URL = 'https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/4.5_day.geojson';

interface UsgsFeature {
  id: string;
  properties: {
    mag: number | null;
    place: string | null;
    time: number;
    updated: number;
    url: string;
    title: string;
    alert: 'green' | 'yellow' | 'orange' | 'red' | null;
    tsunami: number;
    status: string;
    felt: number | null;
  };
  geometry: { coordinates: [number, number, number] };
}

const PAGER: Record<string, number> = { green: 0.3, yellow: 0.55, orange: 0.75, red: 0.92 };

export function usgsSeverity(mag: number, alert: string | null, tsunami: boolean): number {
  // Magnitude alone is a weak proxy for harm; PAGER alert (estimated losses) takes precedence when present.
  const byMag = mag >= 8 ? 0.85 : mag >= 7 ? 0.7 : mag >= 6.5 ? 0.6 : mag >= 6 ? 0.5 : mag >= 5.5 ? 0.38 : mag >= 5 ? 0.28 : 0.18;
  let s = alert ? Math.max(PAGER[alert] ?? 0, byMag * 0.8) : byMag;
  if (tsunami) s = Math.max(s, 0.6);
  return s;
}

export function mapUsgsFeature(f: UsgsFeature): RawItem | null {
  const p = f.properties;
  if (!p || p.mag == null || !p.url) return null;
  const [lon, lat] = f.geometry.coordinates;
  const placeText = p.place ?? '';
  const named = findPlaces(placeText).map((l) => ({ ...l, via: 'official-feed', confidence: 0.8 }));
  const point: GeoRef = { name: placeText || `${lat.toFixed(1)}, ${lon.toFixed(1)}`, level: 'city', countryCode: named.find((n) => n.countryCode)?.countryCode, lat, lon, confidence: 0.95, via: 'official-feed' };
  const severity = usgsSeverity(p.mag, p.alert, p.tsunami === 1);
  const evidence = [`magnitude ${p.mag.toFixed(1)}`];
  if (p.alert) evidence.push(`alerta PAGER ${p.alert}`);
  if (p.tsunami === 1) evidence.push('aviso de tsunami emitido');
  return {
    title: p.title,
    url: p.url,
    summary: `Terremoto de magnitude ${p.mag.toFixed(1)} registrado ${placeText ? `(${placeText})` : ''} pelo USGS. Status: ${p.status}.`,
    occurredAt: p.time,
    publishedAt: p.time,
    language: 'en',
    hints: {
      eventKey: `usgs:${f.id}`,
      hazardType: 'EQ',
      revision: String(p.updated),
      hazard: true,
      severity,
      severityEvidence: evidence,
      urgency: p.tsunami === 1 ? 0.9 : 0.4,
      locations: [point, ...named.filter((n) => n.level === 'country')],
      channels: [{ channel: 'natural_hazard', strength: 1, evidence: ['terremoto'] }],
      categories: ['climate'],
      affectedScope: p.tsunami === 1 ? 'world_region' : 'local',
    },
  };
}

export function usgsConnector(): SourceConnector {
  return {
    id: 'usgs',
    name: 'USGS Earthquake Hazards',
    kind: 'official',
    reliability: 0.95,
    language: 'en',
    homepage: 'https://earthquake.usgs.gov/',
    intervalMs: 5 * 60_000,
    enabled: true,
    async fetch(ctx: FetchContext): Promise<FetchResult> {
      const res = await httpGet(USGS_URL, { signal: ctx.signal, state: ctx.state, headers: { Accept: 'application/geo+json, application/json' } });
      if (res.status === 304) return { items: [], notModified: true, state: res.state };
      const data = JSON.parse(res.text) as { features?: UsgsFeature[] };
      const items = (data.features ?? []).map(mapUsgsFeature).filter((x): x is RawItem => !!x);
      return { items, state: res.state };
    },
  };
}

// ---------------------------------------------------------------------------
// INMET — Instituto Nacional de Meteorologia (Brazil) weather warnings.

const INMET_URL = 'https://apiprevmet3.inmet.gov.br/avisos/rss';
const INMET_LEVEL: [RegExp, number, string][] = [
  [/grande perigo/i, 0.85, 'grande perigo'],
  [/perigo potencial/i, 0.4, 'perigo potencial'],
  [/perigo/i, 0.65, 'perigo'],
];

// Mesoregion adjectives → UF. ("Oeste Catarinense" → SC)
const MESO_SUFFIX: [RegExp, string][] = [
  [/sul-mato-grossense/i, 'MS'], [/mato-grossense/i, 'MT'], [/rio-grandense/i, 'RS'], [/paranaense/i, 'PR'], [/catarinense/i, 'SC'],
  [/paulista/i, 'SP'], [/fluminense/i, 'RJ'], [/mineir[oa]/i, 'MG'], [/esp[ií]rito-santense/i, 'ES'], [/goian[oa]/i, 'GO'],
  [/baian[oa]/i, 'BA'], [/sergipan[oa]/i, 'SE'], [/alagoan[oa]/i, 'AL'], [/pernambucan[oa]/i, 'PE'], [/paraiban[oa]/i, 'PB'],
  [/potiguar/i, 'RN'], [/cearense/i, 'CE'], [/piauiense/i, 'PI'], [/maranhense/i, 'MA'], [/paraense/i, 'PA'], [/amazonense/i, 'AM'],
  [/tocantins/i, 'TO'], [/acre(?:ano)?/i, 'AC'], [/rond[oô]n/i, 'RO'], [/roraima/i, 'RR'], [/amap[aá]/i, 'AP'], [/distrito federal/i, 'DF'],
];

function inmetField(html: string, label: string): string | undefined {
  const m = new RegExp(`<th[^>]*>${label}</th>\\s*<td>([\\s\\S]*?)</td>`, 'i').exec(html);
  return m ? m[1].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim() : undefined;
}

export function parseInmet(xml: string, now = Date.now()): RawItem[] {
  const doc = xmlParser.parse(xml) as any;
  const items: any[] = [].concat(doc?.rss?.channel?.item ?? []);
  const out: RawItem[] = [];
  for (const it of items) {
    const html = String(txt(it.description) ?? it.description ?? '');
    const title = txt(it.title) ?? '';
    const evento = inmetField(html, 'Evento') ?? title;
    const inicio = inmetField(html, 'In[ií]cio');
    const fim = inmetField(html, 'Fim');
    const areas = (inmetField(html, '[ÁA]rea') ?? '').replace(/^Aviso para as [ÁA]reas:\s*/i, '');
    const end = fim ? Date.parse(fim.replace(' ', 'T').replace(/\.0$/, '') + '-03:00') : NaN;
    if (Number.isFinite(end) && end < now) continue; // expired warning
    const start = inicio ? Date.parse(inicio.replace(' ', 'T').replace(/\.0$/, '') + '-03:00') : NaN;
    if (Number.isFinite(start) && start - now > 72 * 3_600_000) continue; // too far ahead
    const [, severity, levelLabel] = INMET_LEVEL.find(([re]) => re.test(title)) ?? [null, 0.4, 'aviso'];

    const ufs = new Set<string>();
    const locs: GeoRef[] = [];
    for (const area of areas.split(',').map((s) => s.trim()).filter(Boolean)) {
      const metro = /^Metropolitana de (.+)$/i.exec(area);
      if (metro) {
        const city = findPlaces(metro[1]).find((p) => p.level === 'city');
        if (city) {
          locs.push({ ...city, name: `Região metropolitana de ${city.name}`, confidence: 0.85, via: 'official-feed' });
          if (city.admin1) ufs.add(city.admin1);
          continue;
        }
      }
      const uf = MESO_SUFFIX.find(([re]) => re.test(area))?.[1];
      if (uf) ufs.add(uf);
    }
    for (const uf of ufs) {
      const st = brStateByUf(uf);
      locs.push({ name: st?.name ?? uf, level: 'state', countryCode: 'BR', admin1: uf, regions: ['south_america'], confidence: 0.75, via: 'official-feed' });
    }
    if (locs.length === 0) locs.push({ name: 'Brasil', level: 'country', countryCode: 'BR', regions: ['south_america'], confidence: 0.5, via: 'official-feed' });
    const window = inicio && fim ? ` Válido de ${inicio.slice(0, 16)} a ${fim.slice(0, 16)} (BRT).` : '';
    out.push({
      title: `INMET: ${evento} — ${levelLabel}${ufs.size ? ` (${[...ufs].join(', ')})` : ''}`,
      url: txt(it.link) ?? txt(it.guid),
      summary: `${inmetField(html, 'Descri[çc][ãa]o') ?? ''}${window} Áreas: ${areas}`.slice(0, 600),
      language: 'pt',
      hints: {
        eventKey: `inmet:${txt(it.guid) ?? txt(it.link)}`,
        hazardType: `INMET-${evento}`,
        areaKeys: [...ufs].sort(),
        revision: `${levelLabel}:${fim}`,
        hazard: severity >= 0.6,
        severity,
        severityEvidence: [`aviso INMET: ${levelLabel}`],
        urgency: severity >= 0.8 ? 0.85 : severity >= 0.6 ? 0.6 : 0.35,
        locations: locs,
        channels: [{ channel: 'natural_hazard', strength: severity >= 0.6 ? 0.9 : 0.6, evidence: [evento.toLowerCase()] }],
        categories: ['climate'],
        affectedScope: 'state',
      },
    });
  }
  return out;
}

export function inmetConnector(): SourceConnector {
  return {
    id: 'inmet',
    name: 'INMET — Avisos meteorológicos',
    kind: 'official',
    reliability: 0.92,
    country: 'BR',
    language: 'pt',
    homepage: 'https://alertas2.inmet.gov.br/',
    intervalMs: 15 * 60_000,
    enabled: true,
    async fetch(ctx: FetchContext): Promise<FetchResult> {
      const res = await httpGet(INMET_URL, { signal: ctx.signal, state: ctx.state, timeoutMs: 30_000 });
      if (res.status === 304) return { items: [], notModified: true, state: res.state };
      return { items: parseInmet(res.text, ctx.now), state: res.state };
    },
  };
}

// ---------------------------------------------------------------------------

const GDACS_URL = 'https://www.gdacs.org/xml/rss.xml';

const GDACS_TYPES: Record<string, { pt: string; channel: 'natural_hazard' }> = {
  EQ: { pt: 'Terremoto', channel: 'natural_hazard' },
  TC: { pt: 'Ciclone tropical', channel: 'natural_hazard' },
  FL: { pt: 'Inundação', channel: 'natural_hazard' },
  VO: { pt: 'Erupção vulcânica', channel: 'natural_hazard' },
  DR: { pt: 'Seca', channel: 'natural_hazard' },
  WF: { pt: 'Incêndio florestal', channel: 'natural_hazard' },
  TS: { pt: 'Tsunami', channel: 'natural_hazard' },
};
const GDACS_GREEN_KEEP = new Set(['TC', 'FL', 'VO', 'TS']);
const GDACS_LEVEL: Record<string, number> = { green: 0.3, orange: 0.65, red: 0.9 };
const GDACS_MAX_AGE_MS = 72 * 3_600_000;

function txt(v: unknown): string | undefined {
  if (v == null) return undefined;
  if (typeof v === 'object') return (v as Record<string, unknown>)['#text'] != null ? String((v as Record<string, unknown>)['#text']) : undefined;
  return String(v);
}

export function parseGdacs(xml: string, now = Date.now()): RawItem[] {
  const doc = xmlParser.parse(xml) as any;
  const items: any[] = [].concat(doc?.rss?.channel?.item ?? []);
  const out: RawItem[] = [];
  for (const it of items) {
    const modified = Date.parse(txt(it['gdacs:datemodified']) ?? txt(it.pubDate) ?? '');
    if (!Number.isFinite(modified) || now - modified > GDACS_MAX_AGE_MS) continue;
    if (txt(it['gdacs:iscurrent']) === 'false') continue;
    const type = txt(it['gdacs:eventtype']) ?? '';
    const level = (txt(it['gdacs:alertlevel']) ?? 'green').toLowerCase();
    // Green wildfire/drought/earthquake notices are numerous and minor (earthquakes come from USGS).
    if (level === 'green' && !GDACS_GREEN_KEEP.has(type)) continue;
    const lat = Number(txt(it['geo:Point']?.['geo:lat']));
    const lon = Number(txt(it['geo:Point']?.['geo:long']));
    const countryText = txt(it['gdacs:country']) ?? '';
    const named = findPlaces(countryText).map((l) => ({ ...l, via: 'official-feed', confidence: 0.8 }));
    const locs: GeoRef[] = [];
    if (Number.isFinite(lat) && Number.isFinite(lon)) {
      locs.push({ name: countryText ? `${countryText} (área do evento)` : 'área do evento', level: 'city', countryCode: named[0]?.countryCode, lat, lon, confidence: 0.85, via: 'official-feed' });
    }
    locs.push(...named);
    const severityText = txt(it['gdacs:severity']);
    const population = txt(it['gdacs:population']);
    const t = GDACS_TYPES[type];
    out.push({
      title: txt(it.title),
      url: txt(it.link),
      summary: [txt(it.description), severityText, population].filter(Boolean).join(' · '),
      occurredAt: txt(it['gdacs:fromdate']),
      publishedAt: txt(it.pubDate),
      language: 'en',
      hints: {
        eventKey: `gdacs:${txt(it.guid) ?? `${type}${txt(it['gdacs:eventid'])}`}`,
        hazardType: type,
        revision: `${txt(it['gdacs:version'])}:${level}`,
        hazard: true,
        severity: GDACS_LEVEL[level] ?? 0.3,
        severityEvidence: [`alerta GDACS ${level}`, ...(severityText ? [severityText] : [])],
        urgency: level === 'red' ? 0.8 : level === 'orange' ? 0.6 : 0.3,
        locations: locs,
        channels: t ? [{ channel: t.channel, strength: 1, evidence: [t.pt.toLowerCase()] }] : [],
        categories: ['climate'],
        affectedScope: type === 'DR' ? 'state' : 'local',
      },
    });
  }
  return out;
}

export function gdacsConnector(): SourceConnector {
  return {
    id: 'gdacs',
    name: 'GDACS (UN / European Commission)',
    kind: 'official',
    reliability: 0.9,
    language: 'en',
    homepage: 'https://www.gdacs.org/',
    intervalMs: 10 * 60_000,
    enabled: true,
    async fetch(ctx: FetchContext): Promise<FetchResult> {
      const res = await httpGet(GDACS_URL, { signal: ctx.signal, state: ctx.state, timeoutMs: 30_000 });
      if (res.status === 304) return { items: [], notModified: true, state: res.state };
      return { items: parseGdacs(res.text, ctx.now), state: res.state };
    },
  };
}
