/**
 * Map geometry shared by the background map and the location markers, so a marker
 * always lands exactly on the country it refers to.
 */

/** Natural Earth I projection (Šavrič et al.): degrees → unit coordinates. */
export function naturalEarth(lon: number, lat: number): [number, number] {
  const l = (lon * Math.PI) / 180;
  const p = (lat * Math.PI) / 180;
  const p2 = p * p;
  const p4 = p2 * p2;
  return [
    l * (0.8707 - 0.131979 * p2 + p4 * (-0.013791 + p4 * (0.003971 * p2 - 0.001529 * p4))),
    p * (1.007226 + p2 * (0.015085 + p4 * (-0.044475 + 0.028874 * p2 - 0.005916 * p4))),
  ];
}

/** Screen projection that fits the world (without Antarctica) into a w×h viewport. */
export function fitWorld(w: number, h: number): (lon: number, lat: number) => [number, number] {
  // Unit extents of Natural Earth without Antarctica (≈ ±2.73 × −1.0..1.45).
  const ux = 2.74;
  const uyTop = 1.45;
  const uyBottom = -1.0;
  const scale = Math.min((w * 0.94) / (2 * ux), (h * 0.8) / (uyTop - uyBottom));
  const cx = w / 2;
  const cy = h * 0.44 + ((uyTop + uyBottom) / 2) * scale;
  return (lon, lat) => {
    const [x, y] = naturalEarth(lon, lat);
    return [cx + x * scale, cy - y * scale];
  };
}

type Ring = number[][];

/** Representative point of a country: centroid of its largest polygon (so France ≠ French Guiana). */
export function largestPolygonCentroid(polygons: Ring[][]): [number, number] | undefined {
  let best: { area: number; c: [number, number] } | undefined;
  for (const poly of polygons) {
    let ring = poly[0];
    if (!ring || ring.length < 3) continue;
    // Rings crossing the antimeridian (eastern Russia, Fiji): unwrap longitudes first.
    const lons = ring.map((p) => p[0]);
    if (Math.max(...lons) - Math.min(...lons) > 180) ring = ring.map(([x, y]) => [x < 0 ? x + 360 : x, y]);
    let a = 0;
    let cx = 0;
    let cy = 0;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const [x0, y0] = ring[j];
      const [x1, y1] = ring[i];
      const f = x0 * y1 - x1 * y0;
      a += f;
      cx += (x0 + x1) * f;
      cy += (y0 + y1) * f;
    }
    if (a === 0) continue;
    let lon = cx / (3 * a);
    if (lon > 180) lon -= 360;
    const c: [number, number] = [lon, cy / (3 * a)];
    if (!best || Math.abs(a) > best.area) best = { area: Math.abs(a), c };
  }
  return best?.c;
}
