import { useEffect, useRef, useState } from 'react';
import type { MapPoint } from '../map/eventPoints';
import { fitWorld } from '../map/projection';
import { loadWorld, type Lines } from '../map/worldData';

/**
 * Minimal world map behind the sand: coastlines and country borders as hairlines.
 * Static: redrawn only on resize. On top of it, an optional tiny red marker shows
 * where the hovered/pinned story happened.
 */
export function WorldMap({ markers = [], theme = 'light', intensity = 1 }: { markers?: MapPoint[]; theme?: 'light' | 'dark'; intensity?: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const [size, setSize] = useState<{ w: number; h: number } | null>(null);

  useEffect(() => {
    const canvas = ref.current!;
    let lines: { coast: Lines; borders: Lines } | null = null;
    let disposed = false;

    const draw = () => {
      const rect = canvas.parentElement!.getBoundingClientRect();
      const w = Math.max(1, Math.round(rect.width));
      const h = Math.max(1, Math.round(rect.height));
      setSize((s) => (s && s.w === w && s.h === h ? s : { w, h }));
      if (!lines || disposed) return;
      const dpr = Math.min(3, Math.max(2, window.devicePixelRatio || 1)); // supersampled hairlines
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);
      const project = fitWorld(w, h);
      const stroke = (polys: Lines, style: string, width: number) => {
        ctx.strokeStyle = style;
        ctx.lineWidth = width;
        ctx.lineJoin = 'round';
        ctx.beginPath();
        for (const line of polys) {
          let prevLon: number | null = null;
          for (const [lon, lat] of line) {
            const [px, py] = project(lon, lat);
            // Never draw across the antimeridian (Russia, Fiji): start a new segment instead.
            if (prevLon == null || Math.abs(lon - prevLon) > 180) ctx.moveTo(px, py);
            else ctx.lineTo(px, py);
            prevLon = lon;
          }
        }
        ctx.stroke();
      };
      const rgb = theme === 'dark' ? '233,233,230' : '17,17,17';
      // Base strength per theme, scaled by the user's "map intensity" setting.
      const a = (base: number) => Math.min(1, base * intensity).toFixed(3);
      stroke(lines.borders, `rgba(${rgb},${a(0.18)})`, 0.5);
      stroke(lines.coast, `rgba(${rgb},${a(theme === 'dark' ? 0.345 : 0.36)})`, 0.7);
    };

    loadWorld()
      .then((d) => {
        lines = d;
        draw();
      })
      .catch(() => {
        /* the map is decoration: if it fails to load, the white page remains */
      });
    const ro = new ResizeObserver(draw);
    ro.observe(canvas.parentElement!);
    draw();
    return () => {
      disposed = true;
      ro.disconnect();
    };
  }, [theme, intensity]);

  const project = size ? fitWorld(size.w, size.h) : null;
  return (
    <div className="map-host" aria-hidden="true">
      <canvas ref={ref} className="map-canvas" />
      {project && markers.length > 0 && (
        <svg className="map-markers">
          {markers.map((m) => {
            const [x, y] = project(m.lon, m.lat);
            return (
              <g key={`${m.lon},${m.lat}`} transform={`translate(${x} ${y})`}>
                <circle className="map-marker__pulse" r="3" />
                <circle className="map-marker__dot" r="2.25" />
              </g>
            );
          })}
        </svg>
      )}
    </div>
  );
}
