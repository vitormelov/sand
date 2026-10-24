import type { GeometryCollection, Topology } from 'topojson-specification';
import { COUNTRIES } from '../../shared/geo/gazetteer';
import { normalizeForMatch } from '../../shared/text';
import { largestPolygonCentroid } from './projection';

export type Lines = number[][][]; // polylines of [lon, lat]

export interface WorldData {
  coast: Lines;
  borders: Lines;
  /** ISO 3166-1 alpha-2 → [lon, lat] representative point. */
  centroids: Map<string, [number, number]>;
}

/** Names in Natural Earth that differ from every alias in our gazetteer. */
const NAME_OVERRIDES: Record<string, string> = {
  US: 'United States of America',
  CD: 'Dem. Rep. Congo',
  DO: 'Dominican Rep.',
  SS: 'S. Sudan',
};

/** Countries too small for the 1:110m dataset. */
const SMALL_COUNTRIES: Record<string, [number, number]> = {
  SG: [103.82, 1.35],
  HK: [114.17, 22.32],
  CV: [-23.6, 15.1],
};

let cached: Promise<WorldData> | null = null;

/** Natural Earth 1:110m (public domain) via world-atlas, loaded lazily once. */
export function loadWorld(): Promise<WorldData> {
  return (cached ??= (async () => {
    const [{ mesh, feature }, data] = await Promise.all([import('topojson-client'), import('world-atlas/countries-110m.json')]);
    const topo = ((data as { default?: unknown }).default ?? data) as unknown as Topology<{ countries: GeometryCollection }>;
    // Antarctica would sit under the sand anyway; leaving it out keeps the map compact.
    const countries: GeometryCollection = {
      ...topo.objects.countries,
      geometries: topo.objects.countries.geometries.filter((g) => g.id !== '010'),
    };
    const coast = mesh(topo, countries, (a, b) => a === b).coordinates as Lines;
    const borders = mesh(topo, countries, (a, b) => a !== b).coordinates as Lines;

    const byName = new Map<string, [number, number]>();
    for (const f of feature(topo, countries).features) {
      const name = (f.properties as { name?: string } | null)?.name;
      const g = f.geometry;
      if (!name || !g) continue;
      const polys = g.type === 'Polygon' ? [g.coordinates] : g.type === 'MultiPolygon' ? g.coordinates : [];
      const c = largestPolygonCentroid(polys as number[][][][]);
      if (c) byName.set(normalizeForMatch(name).trim(), c);
    }
    const centroids = new Map<string, [number, number]>(Object.entries(SMALL_COUNTRIES));
    for (const c of COUNTRIES) {
      const names = [NAME_OVERRIDES[c.code], ...c.aliases].filter(Boolean) as string[];
      const hit = names.map((n) => byName.get(normalizeForMatch(n).trim())).find(Boolean);
      if (hit) centroids.set(c.code, hit);
    }
    return { coast, borders, centroids };
  })());
}
