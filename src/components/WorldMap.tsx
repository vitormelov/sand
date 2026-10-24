import { useEffect, useRef } from 'react';
import type { GeometryCollection, Topology } from 'topojson-specification';

/**
 * Minimal world map behind the sand: coastlines and country borders as hairlines.
 * Natural Earth 1:110m (public domain) via the world-atlas package, loaded lazily so
 * it never delays the first frame. Static: redrawn only on resize.
 */

/** Natural Earth I projection (Šavrič et al.), in radians → unit coordinates. */
function naturalEarth(lon: number, lat: number): [number, number] {
  const l = (lon * Math.PI) / 180;
  const p = (lat * Math.PI) / 180;
  const p2 = p * p;
  const p4 = p2 * p2;
  return [
    l * (0.8707 - 0.131979 * p2 + p4 * (-0.013791 + p4 * (0.003971 * p2 - 0.001529 * p4))),
    p * (1.007226 + p2 * (0.015085 + p4 * (-0.044475 + 0.028874 * p2 - 0.005916 * p4))),
  ];
}

type Lines = number[][][]; // list of polylines of [lon, lat]

async function loadLines(): Promise<{ coast: Lines; borders: Lines }> {
  const [{ mesh }, data] = await Promise.all([import('topojson-client'), import('world-atlas/countries-110m.json')]);
  const world = (data as { default?: unknown }).default ?? data;
  const topo = world as unknown as Topology<{ countries: GeometryCollection }>;
  // Antarctica would sit under the sand anyway; leaving it out keeps the map compact.
  const countries: GeometryCollection = {
    ...topo.objects.countries,
    geometries: topo.objects.countries.geometries.filter((g) => g.id !== '010'),
  };
  const coast = mesh(topo, countries, (a, b) => a === b).coordinates as Lines;
  const borders = mesh(topo, countries, (a, b) => a !== b).coordinates as Lines;
  return { coast, borders };
}

let cached: Promise<{ coast: Lines; borders: Lines }> | null = null;

export function WorldMap() {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current!;
    let lines: { coast: Lines; borders: Lines } | null = null;
    let disposed = false;

    const draw = () => {
      if (!lines || disposed) return;
      const rect = canvas.parentElement!.getBoundingClientRect();
      const w = Math.max(1, Math.round(rect.width));
      const h = Math.max(1, Math.round(rect.height));
      const dpr = Math.min(3, Math.max(2, window.devicePixelRatio || 1)); // supersampled hairlines
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);

      // Fit: unit extents of Natural Earth without Antarctica (≈ ±2.73 × −1.0..1.45).
      const ux = 2.74;
      const uyTop = 1.45;
      const uyBottom = -1.0;
      const scale = Math.min((w * 0.94) / (2 * ux), (h * 0.8) / (uyTop - uyBottom));
      const cx = w / 2;
      const cy = h * 0.44 + ((uyTop + uyBottom) / 2) * scale;
      const stroke = (polys: Lines, style: string, width: number) => {
        ctx.strokeStyle = style;
        ctx.lineWidth = width;
        ctx.lineJoin = 'round';
        ctx.beginPath();
        for (const line of polys) {
          let prevLon: number | null = null;
          for (const [lon, lat] of line) {
            const [x, y] = naturalEarth(lon, lat);
            const px = cx + x * scale;
            const py = cy - y * scale;
            // Never draw across the antimeridian (Russia, Fiji): start a new segment instead.
            if (prevLon == null || Math.abs(lon - prevLon) > 180) ctx.moveTo(px, py);
            else ctx.lineTo(px, py);
            prevLon = lon;
          }
        }
        ctx.stroke();
      };
      stroke(lines.borders, 'rgba(17,17,17,0.08)', 0.5);
      stroke(lines.coast, 'rgba(17,17,17,0.15)', 0.7);
    };

    (cached ??= loadLines())
      .then((l) => {
        lines = l;
        draw();
      })
      .catch(() => {
        /* the map is decoration: if it fails to load, the white page remains */
      });
    const ro = new ResizeObserver(draw);
    ro.observe(canvas.parentElement!);
    return () => {
      disposed = true;
      ro.disconnect();
    };
  }, []);

  return (
    <div className="map-host" aria-hidden="true">
      <canvas ref={ref} className="map-canvas" />
    </div>
  );
}
