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
