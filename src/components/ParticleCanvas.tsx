import { useEffect, useRef } from 'react';
import { SandSimulation, type SimSettings } from '../simulation/SandSimulation';
import type { SandStore } from '../state/store';

export interface GrainRef {
  eventId: string;
  particleId: number;
}

interface Props {
  store: SandStore;
  settings: SimSettings;
  selectedEventId: string | null;
  onSelect: (grain: GrainRef | null) => void;
  onHover: (grain: GrainRef | null) => void;
  simRef?: React.MutableRefObject<SandSimulation | null>;
}

/**
 * Hosts the canvas. The simulation owns its animation loop; this component only
 * forwards settings, selection and pointer input — it does not re-render per frame.
 */
export function ParticleCanvas({ store, settings, selectedEventId, onSelect, onHover, simRef }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const sim = useRef<SandSimulation | null>(null);
  const hovered = useRef<number | null>(null);
  const setHover = (p: { id: number; eventId: string } | undefined) => {
    const id = p?.eventId ? p.id : null;
    if (id === hovered.current) return; // only notify React on change
    hovered.current = id;
    onHover(p?.eventId ? { eventId: p.eventId, particleId: p.id } : null);
  };

  useEffect(() => {
    const s = new SandSimulation(canvasRef.current!, settings);
    sim.current = s;
    if (simRef) simRef.current = s;
    store.attachSink(s);
    s.setLabelSource((id) => store.events.get(id)?.title);
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

  /** A finger on the sand: sliding it previews titles like a mouse hover; a tap still pins. */
  const touch = useRef<{ id: number; x: number; y: number; dragged: boolean } | null>(null);
  const suppressClick = useRef(false);
  const endTouch = (e: React.PointerEvent) => {
    if (touch.current?.id !== e.pointerId) return;
    suppressClick.current = touch.current.dragged; // a slide is a preview, not a tap
    touch.current = null;
    sim.current?.hover(null, null);
    setHover(undefined);
  };

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
        onPointerDown={(e) => {
          if (e.pointerType === 'mouse' || !e.isPrimary) return;
          const { x, y } = pos(e);
          touch.current = { id: e.pointerId, x, y, dragged: false };
          suppressClick.current = false;
          e.currentTarget.setPointerCapture?.(e.pointerId);
          setHover(sim.current?.hover(x, y));
        }}
        onPointerMove={(e) => {
          const { x, y } = pos(e);
          if (e.pointerType !== 'mouse') {
            const t = touch.current;
            if (!t || t.id !== e.pointerId) return;
            if (Math.hypot(x - t.x, y - t.y) > 10) t.dragged = true;
            setHover(sim.current?.hover(x, y));
            return;
          }
          const hit = sim.current?.hover(x, y);
          e.currentTarget.style.cursor = hit ? 'pointer' : 'default';
          setHover(hit);
        }}
        onPointerUp={endTouch}
        onPointerCancel={endTouch}
        onPointerLeave={(e) => {
          if (e.pointerType !== 'mouse') return;
          sim.current?.hover(null, null);
          setHover(undefined);
        }}
        onClick={(e) => {
          if (suppressClick.current) {
            suppressClick.current = false;
            return;
          }
          const { x, y } = pos(e);
          const hit = sim.current?.hitTest(x, y);
          onSelect(hit?.eventId ? { eventId: hit.eventId, particleId: hit.id } : null);
        }}
      />
    </div>
  );
}
