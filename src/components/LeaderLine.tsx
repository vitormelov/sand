import { useEffect, useRef } from 'react';
import type { SandSimulation } from '../simulation/SandSimulation';

interface Props {
  simRef: React.MutableRefObject<SandSimulation | null>;
  eventId: string;
  /** The exact grain hovered/clicked; falls back to the event's main grain. */
  particleId?: number;
  /** CSS selector of the panel the line points to. */
  target: string;
}

/**
 * A single thin line from a grain to the news panel. Grains keep moving
 * (falling, settling, sinking), so the line follows them in its own
 * animation loop, writing SVG attributes directly — no React re-render per frame.
 */
export function LeaderLine({ simRef, eventId, particleId, target }: Props) {
  const lineRef = useRef<SVGLineElement>(null);
  const dotRef = useRef<SVGCircleElement>(null);

  useEffect(() => {
    let raf = 0;
    const tick = () => {
      const line = lineRef.current;
      const dot = dotRef.current;
      const sim = simRef.current;
      const panel = document.querySelector(target);
      const g = sim && ((particleId != null && sim.particlePosition(particleId)) || sim.grainPosition(eventId));
      if (line && dot) {
        if (!g || !panel) {
          line.setAttribute('visibility', 'hidden');
          dot.setAttribute('visibility', 'hidden');
        } else {
          const r = panel.getBoundingClientRect();
          // Nearest point of the panel's border to the grain.
          const px = Math.min(Math.max(g.x, r.left), r.right);
          const py = Math.min(Math.max(g.y, r.top), r.bottom);
          const dx = px - g.x;
          const dy = py - g.y;
          const len = Math.hypot(dx, dy);
          const inside = len < g.r + 6;
          const gap = g.r + 4;
          line.setAttribute('x1', String(g.x + (dx / (len || 1)) * gap));
          line.setAttribute('y1', String(g.y + (dy / (len || 1)) * gap));
          line.setAttribute('x2', String(px));
          line.setAttribute('y2', String(py));
          line.setAttribute('visibility', inside ? 'hidden' : 'visible');
          dot.setAttribute('cx', String(px));
          dot.setAttribute('cy', String(py));
          dot.setAttribute('visibility', inside ? 'hidden' : 'visible');
        }
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [simRef, eventId, particleId, target]);

  return (
    <svg className="leader" aria-hidden="true">
      <line ref={lineRef} visibility="hidden" />
      <circle ref={dotRef} r="1.75" visibility="hidden" />
    </svg>
  );
}
