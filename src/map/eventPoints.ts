import { brStateByUf } from '../../shared/geo/gazetteer';
import type { NewsEvent, WorldRegion } from '../../shared/types';

export interface MapPoint {
  lon: number;
  lat: number;
  label: string;
}

/** Rough visual centre of each world region, for stories located only at that level. */
const REGION_POINTS: Record<WorldRegion, [number, number]> = {
  south_america: [-60, -15],
  central_america_caribbean: [-80, 15],
  north_america: [-100, 45],
  europe: [15, 50],
  africa: [20, 5],
  middle_east: [45, 29],
  south_asia: [78, 22],
  east_asia: [110, 35],
  southeast_asia: [110, 5],
  central_asia: [65, 42],
  oceania: [140, -25],
};

const MAX_POINTS = 3;

/**
 * Where to mark a story on the map, most precise first. Locations the analysis
 * did not identify are never guessed: an event without them gets no marker.
 */
export function eventPoints(e: NewsEvent, centroids: Map<string, [number, number]>): MapPoint[] {
  const out: MapPoint[] = [];
  const push = (lon: number, lat: number, label: string) => {
    if (!Number.isFinite(lon) || !Number.isFinite(lat)) return;
    if (out.some((p) => Math.abs(p.lon - lon) < 3 && Math.abs(p.lat - lat) < 3)) return; // same spot
    out.push({ lon, lat, label });
  };
  // A country already pinned by a more precise point (epicentre, city, state) is not marked twice.
  const precise = new Set(
    e.analysis.locations.filter((l) => (l.lat != null && l.lon != null) || (l.countryCode === 'BR' && l.admin1)).map((l) => l.countryCode),
  );
  for (const l of e.analysis.locations) {
    if (out.length >= MAX_POINTS) break;
    if (l.lat != null && l.lon != null) push(l.lon, l.lat, l.name);
    else if (l.countryCode === 'BR' && l.admin1 && brStateByUf(l.admin1)) {
      const s = brStateByUf(l.admin1)!;
      push(s.lon, s.lat, l.name);
    } else if (l.countryCode && centroids.has(l.countryCode) && !(l.level === 'country' && precise.has(l.countryCode))) {
      const [lon, lat] = centroids.get(l.countryCode)!;
      push(lon, lat, l.name);
    } else if (l.level === 'world_region' && l.regions?.[0]) {
      const [lon, lat] = REGION_POINTS[l.regions[0]];
      push(lon, lat, l.name);
    }
  }
  return out;
}
