import { fitWorld } from './projection';
import type { Lines } from './worldData';

/** Width of each column of the ceiling profile, in CSS px. */
export const CEILING_BIN = 12;

export interface CeilingOptions {
  /** How far the sand may rise over the lowest map line (a bit of a grain may cover it). */
  tolerance?: number;
  /** Around each column, the line that counts is the lowest one within this distance. */
  window?: number;
  /** Beside the map (left/right of it) the pile may reach this fraction of the height. */
  sideFraction?: number;
  /** Steepest slope the profile may have (sand cannot stand on a cliff). */
  maxSlope?: number;
  /** There is always at least this much room above the floor. */
  minRoom?: number;
}

/**
 * Map parts the sand may cover: lines lying entirely inside one of these [lon0, lon1, lat0, lat1]
 * boxes are drawn but ignored for the ceiling. The French Southern and Antarctic Lands
 * (Kerguelen), alone far south of Africa, would otherwise keep the whole Indian Ocean shallow.
 */
export const COVERABLE_AREAS: [number, number, number, number][] = [[60, 80, -56, -40]];

const coverable = (line: number[][]) =>
  COVERABLE_AREAS.some(([lon0, lon1, lat0, lat1]) => line.every(([lon, lat]) => lon >= lon0 && lon <= lon1 && lat >= lat0 && lat <= lat1));

/**
 * The "imaginary line" the sand should stay under: for each column of the screen, the y
 * (CSS px, top = 0) of the lowest coastline/border drawn near it, minus a small tolerance.
 * Over the oceans this is higher (more room), beside the map it is higher still.
 */
export function mapCeiling(lineSets: Lines[], w: number, h: number, opts: CeilingOptions = {}): Float32Array {
  const { tolerance = 8, window = 40, sideFraction = 0.5, maxSlope = 0.8, minRoom = 36 } = opts;
  const bins = Math.max(1, Math.ceil(w / CEILING_BIN));
  const low = new Float32Array(bins).fill(Number.NaN);
  const project = fitWorld(w, h);
  let minX = Infinity;
  let maxX = -Infinity;
  const mark = (x: number, y: number) => {
    const i = Math.floor(x / CEILING_BIN);
    if (i < 0 || i >= bins) return;
    if (!(low[i] >= y)) low[i] = y;
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
  };
  for (const lines of lineSets) {
    for (const line of lines) {
      if (coverable(line)) continue;
      let prev: [number, number] | null = null;
      let prevLon: number | null = null;
      for (const [lon, lat] of line) {
        const p = project(lon, lat);
        if (prev && prevLon != null && Math.abs(lon - prevLon) <= 180) {
          // Sample the segment densely enough that no column is skipped.
          const steps = Math.max(1, Math.ceil(Math.abs(p[0] - prev[0]) / (CEILING_BIN / 2)));
          for (let s = 1; s <= steps; s++) mark(prev[0] + ((p[0] - prev[0]) * s) / steps, prev[1] + ((p[1] - prev[1]) * s) / steps);
        } else mark(p[0], p[1]);
        prev = p;
        prevLon = lon;
      }
    }
  }

  const ceiling = new Float32Array(bins);
  const side = h * (1 - sideFraction);
  if (!Number.isFinite(minX)) return ceiling.fill(side);
  const lowestOver = (i: number, radius: number) => {
    let y = Number.NaN;
    for (let j = Math.max(0, i - radius); j <= Math.min(bins - 1, i + radius); j++) {
      if (!Number.isNaN(low[j]) && !(y >= low[j])) y = low[j];
    }
    return y;
  };
  const near = Math.ceil(window / CEILING_BIN);
  const far = Math.ceil((window * 6) / CEILING_BIN);
  let mapBottom = 0;
  for (const v of low) if (v > mapBottom) mapBottom = v;
  for (let i = 0; i < bins; i++) {
    const x = (i + 0.5) * CEILING_BIN;
    if (x < minX - window || x > maxX + window) {
      ceiling[i] = side;
      continue;
    }
    let y = lowestOver(i, near);
    if (Number.isNaN(y)) y = lowestOver(i, far); // open ocean: the nearest land further away
    if (Number.isNaN(y)) y = mapBottom;
    ceiling[i] = Math.min(y - tolerance, h - minRoom);
  }
  // Limit the slope by lowering peaks only (never covers more of the map).
  const step = maxSlope * CEILING_BIN;
  for (let i = 1; i < bins; i++) ceiling[i] = Math.max(ceiling[i], ceiling[i - 1] - step);
  for (let i = bins - 2; i >= 0; i--) ceiling[i] = Math.max(ceiling[i], ceiling[i + 1] - step);
  return ceiling;
}
