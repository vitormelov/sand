import { useEffect, useRef } from 'react';
import { SandSimulation } from '../simulation/SandSimulation';
import type { Prefs } from '../services/storage';
import type { Theme } from '../services/theme';
import { WorldMap } from './WorldMap';

const HOUR = 3_600_000;
const FIRST_POUR = 160;
const TRICKLE_MS = 1_300;

/** Mostly small grains, a few big ones (≈10% with radius over 20 px) — like a real day of news. */
const decorativeImpact = () => Math.round(100 * Math.pow(Math.random(), 4.5));

/**
 * The login screen's background: the same sand, map and physics as the site, falling on its
 * own. Purely decorative — the grains carry no news (they have no title, link or source and
 * cannot be hovered or opened); real news only appears after signing in.
 */
export function SandBackdrop({ theme, prefs, reducedMotion }: { theme: Theme; prefs: Prefs; reducedMotion: boolean }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const sim = useRef<SandSimulation | null>(null);

  useEffect(() => {
    const s = new SandSimulation(canvasRef.current!, {
      gravity: prefs.gravity,
      speed: prefs.speed,
      sizeScale: prefs.sizeScale,
      density: prefs.density,
      reducedMotion,
      sound: false,
      theme,
      terrain: prefs.showMap,
    });
    sim.current = s;
    let n = 0;
    const drop = (ageH: number, backlog: boolean) => {
      const newsAt = Date.now() - ageH * HOUR;
      s.enqueue({ eventId: `decor-${n++}`, impact: decorativeImpact(), critical: false, newsAt, fadeAt: newsAt + 48 * HOUR }, backlog);
    };
    // A bed that is already there (older grains first, so they end up at the bottom)...
    for (let i = 0; i < FIRST_POUR; i++) drop(46 - (44 * i) / FIRST_POUR, true);
    // ...and a gentle rain of fresh grains on top. (Over an hour old: no "new" ring.)
    const timer = setInterval(() => drop(1.1, false), TRICKLE_MS);
    s.start();
    return () => {
      clearInterval(timer);
      s.stop();
      sim.current = null;
    };
    // The backdrop is built once; theme and motion changes are applied below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    sim.current?.setSettings({ theme, reducedMotion });
  }, [theme, reducedMotion]);

  return (
    <div className="auth-backdrop" aria-hidden="true">
      {prefs.showMap && <WorldMap theme={theme} intensity={prefs.mapIntensity} />}
      <div className="canvas-host">
        <canvas ref={canvasRef} className="sand-canvas" />
      </div>
    </div>
  );
}
