import { useEffect, useRef } from 'react';
import { SandSimulation, type SimSettings } from '../simulation/SandSimulation';
import type { SandStore } from '../state/store';

interface Props {
  store: SandStore;
  settings: SimSettings;
  selectedEventId: string | null;
  onSelect: (eventId: string | null, anchor?: { x: number; y: number; r: number }) => void;
  simRef?: React.MutableRefObject<SandSimulation | null>;
}

/**
 * Hosts the canvas. The simulation owns its animation loop; this component only
 * forwards settings, selection and pointer input — it does not re-render per frame.
 */
export function ParticleCanvas({ store, settings, selectedEventId, onSelect, simRef }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const sim = useRef<SandSimulation | null>(null);

  useEffect(() => {
    const s = new SandSimulation(canvasRef.current!, settings);
    sim.current = s;
    if (simRef) simRef.current = s;
    store.attachSink(s);
    s.start();
    if (import.meta.env.DEV) (window as unknown as { __sand?: SandSimulation }).__sand = s;
    return () => {
      store.attachSink(undefined);
      s.stop();
      sim.current = null;
      if (simRef) simRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [store]);

  useEffect(() => {
    sim.current?.setSettings(settings);
  }, [settings]);

  useEffect(() => {
    sim.current?.select(selectedEventId);
  }, [selectedEventId]);

  const pos = (e: React.PointerEvent | React.MouseEvent) => {
    const rect = canvasRef.current!.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  };

  return (
    <div className="canvas-host">
      <canvas
        ref={canvasRef}
        className="sand-canvas"
        role="img"
        aria-label="Paisagem de areia: cada grão é uma notícia real; o tamanho estima o impacto na sua vida. Use a lista de notícias recentes para navegar pelo teclado."
        onPointerMove={(e) => {
          if (e.pointerType !== 'mouse') return;
          const { x, y } = pos(e);
          const hit = sim.current?.hover(x, y);
          e.currentTarget.style.cursor = hit ? 'pointer' : 'default';
        }}
        onPointerLeave={() => sim.current?.hover(null, null)}
        onClick={(e) => {
          const { x, y } = pos(e);
          const hit = sim.current?.hitTest(x, y);
          if (hit?.eventId) onSelect(hit.eventId, { x: hit.x, y: hit.y, r: hit.r });
          else onSelect(null);
        }}
      />
    </div>
  );
}
