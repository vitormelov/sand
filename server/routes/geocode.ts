import { BR_STATES, PLACES, countryInfo } from '../../shared/geo/gazetteer';
import { normalizeForMatch } from '../../shared/text';
import type { UserLocation } from '../../shared/types';
import { httpGet } from '../sources/http';

/**
 * City search without GPS. Proxies Open-Meteo's free geocoding API (no key) so
 * the browser never talks to third parties, and falls back to the built-in
 * gazetteer when the API is unreachable. Coordinates are rounded to 0.1° (~11 km).
 */

const cache = new Map<string, { at: number; results: UserLocation[] }>();
const TTL = 24 * 3_600_000;
const MAX_CACHE = 500;

const round1 = (n: number) => Math.round(n * 10) / 10;

interface OpenMeteoResult {
  name: string;
  latitude: number;
  longitude: number;
  country_code?: string;
  country?: string;
  admin1?: string;
  feature_code?: string;
  population?: number;
}

function offline(q: string): UserLocation[] {
  const nq = normalizeForMatch(q).trim();
  return PLACES.filter((p) => p.level === 'city' && p.countryCode === 'BR' && !p.name.includes('(') && normalizeForMatch(p.name).trim().startsWith(nq))
    .slice(0, 8)
    .map((p) => ({
      name: p.name,
      admin1: p.admin1,
      admin1Name: BR_STATES.find((s) => s.uf === p.admin1)?.name,
      countryCode: 'BR',
      countryName: 'Brasil',
      lat: p.lat != null ? round1(p.lat) : undefined,
      lon: p.lon != null ? round1(p.lon) : undefined,
    }));
}

// ---------------------------------------------------------------- reverse (GPS)

const reverseCache = new Map<string, { at: number; result: UserLocation | null }>();
let lastNominatim = 0;

/** Nearest known Brazilian city/capital within 120 km (offline fallback). */
function nearestKnown(lat: number, lon: number): UserLocation | null {
  let best: { p: (typeof PLACES)[number]; d: number } | null = null;
  for (const p of PLACES) {
    if (p.level !== 'city' || p.lat == null || p.lon == null || p.name.includes('(')) continue;
    const d = Math.hypot((p.lat - lat) * 111, (p.lon - lon) * 111 * Math.cos((lat * Math.PI) / 180));
    if (!best || d < best.d) best = { p, d };
  }
  if (!best || best.d > 120) return null;
  return {
    name: best.p.name,
    admin1: best.p.admin1,
    admin1Name: BR_STATES.find((s) => s.uf === best!.p.admin1)?.name,
    countryCode: 'BR',
    countryName: 'Brasil',
    lat: round1(best.p.lat!),
    lon: round1(best.p.lon!),
  };
}

/**
 * GPS position → city. Coordinates are rounded to 0.1° (~11 km) BEFORE any lookup,
 * so the precise position never leaves this server. Uses OpenStreetMap Nominatim
 * (usage policy: identify the app, ≤ 1 request/s, cache results).
 */
export async function reverseGeocode(latIn: number, lonIn: number): Promise<{ result: UserLocation | null; source: 'nominatim' | 'offline' }> {
  const lat = round1(latIn);
  const lon = round1(lonIn);
  const key = `${lat},${lon}`;
  const hit = reverseCache.get(key);
  if (hit && Date.now() - hit.at < TTL) return { result: hit.result, source: 'nominatim' };
  try {
    const wait = 1100 - (Date.now() - lastNominatim);
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    lastNominatim = Date.now();
    const url = `https://nominatim.openstreetmap.org/reverse?${new URLSearchParams({ format: 'jsonv2', lat: String(lat), lon: String(lon), zoom: '10', 'accept-language': 'pt-BR' })}`;
    const res = await httpGet(url, { signal: AbortSignal.timeout(8_000), timeoutMs: 8_000 });
    const data = JSON.parse(res.text) as { address?: Record<string, string> };
    const a = data.address ?? {};
    const name = a.city ?? a.town ?? a.municipality ?? a.village ?? a.county;
    const cc = (a.country_code ?? '').toUpperCase();
    const result: UserLocation | null =
      name && cc
        ? {
            name,
            admin1: cc === 'BR' ? BR_STATES.find((s) => normalizeForMatch(s.name) === normalizeForMatch(a.state ?? ''))?.uf : undefined,
            admin1Name: a.state,
            countryCode: cc,
            countryName: a.country ?? countryInfo(cc)?.name ?? cc,
            lat,
            lon,
          }
        : nearestKnown(lat, lon);
    if (reverseCache.size > MAX_CACHE) reverseCache.delete(reverseCache.keys().next().value!);
    reverseCache.set(key, { at: Date.now(), result });
    return { result, source: 'nominatim' };
  } catch {
    return { result: nearestKnown(lat, lon), source: 'offline' };
  }
}

export async function searchCities(q: string, lang = 'pt'): Promise<{ results: UserLocation[]; source: 'open-meteo' | 'offline' }> {
  const query = q.trim().slice(0, 80);
  if (query.length < 2) return { results: [], source: 'offline' };
  const key = `${lang}:${normalizeForMatch(query)}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL) return { results: hit.results, source: 'open-meteo' };
  try {
    const url = `https://geocoding-api.open-meteo.com/v1/search?${new URLSearchParams({ name: query, count: '8', language: lang, format: 'json' })}`;
    const res = await httpGet(url, { signal: AbortSignal.timeout(8_000), timeoutMs: 8_000 });
    const data = JSON.parse(res.text) as { results?: OpenMeteoResult[] };
    const results: UserLocation[] = (data.results ?? [])
      .filter((r) => r.feature_code?.startsWith('PPL') ?? true)
      .map((r) => {
        const cc = (r.country_code ?? '').toUpperCase();
        const uf = cc === 'BR' ? BR_STATES.find((s) => normalizeForMatch(s.name) === normalizeForMatch(r.admin1 ?? ''))?.uf : undefined;
        return {
          name: r.name,
          admin1: uf,
          admin1Name: r.admin1,
          countryCode: cc,
          countryName: r.country ?? countryInfo(cc)?.name ?? cc,
          lat: round1(r.latitude),
          lon: round1(r.longitude),
        };
      });
    if (cache.size > MAX_CACHE) cache.delete(cache.keys().next().value!);
    cache.set(key, { at: Date.now(), results });
    return { results, source: 'open-meteo' };
  } catch {
    return { results: offline(query), source: 'offline' };
  }
}
