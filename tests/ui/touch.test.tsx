// @vitest-environment jsdom
import { cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ParticleCanvas } from '../../src/components/ParticleCanvas';
import type { SandSimulation } from '../../src/simulation/SandSimulation';
import { SandStore } from '../../src/state/store';
import { FORTALEZA } from '../helpers';
import { installDomStubs } from './setup-dom';

beforeEach(() => installDomStubs());
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const settings = { gravity: 1, speed: 1, sizeScale: 1, density: 'normal' as const, reducedMotion: true, sound: false };

describe('touch on the sand', () => {
  it('sliding a finger previews titles like a mouse hover; the slide does not pin', () => {
    const onHover = vi.fn();
    const onSelect = vi.fn();
    const simRef = { current: null as SandSimulation | null };
    const { container } = render(<ParticleCanvas store={new SandStore(FORTALEZA)} settings={settings} selectedEventId={null} onSelect={onSelect} onHover={onHover} simRef={simRef} />);
    const sim = simRef.current!;
    const grains: Record<number, { id: number; eventId: string } | undefined> = { 50: { id: 1, eventId: 'ev_a' }, 120: { id: 2, eventId: 'ev_b' } };
    vi.spyOn(sim, 'hover').mockImplementation(((x: number | null) => (x == null ? undefined : grains[x])) as never);
    vi.spyOn(sim, 'hitTest').mockImplementation(((x: number) => grains[x]) as never);
    const canvas = container.querySelector('canvas')!;
    const touch = { pointerType: 'touch', pointerId: 7, isPrimary: true };

    fireEvent.pointerDown(canvas, { ...touch, clientX: 50, clientY: 10 });
    expect(onHover).toHaveBeenLastCalledWith({ eventId: 'ev_a', particleId: 1 });
    fireEvent.pointerMove(canvas, { ...touch, clientX: 120, clientY: 10 });
    expect(onHover).toHaveBeenLastCalledWith({ eventId: 'ev_b', particleId: 2 });
    fireEvent.pointerUp(canvas, { ...touch, clientX: 120, clientY: 10 });
    expect(onHover).toHaveBeenLastCalledWith(null);
    fireEvent.click(canvas, { clientX: 120, clientY: 10 });
    expect(onSelect).not.toHaveBeenCalled();

    // A plain tap still opens the news.
    fireEvent.pointerDown(canvas, { ...touch, clientX: 50, clientY: 10 });
    fireEvent.pointerUp(canvas, { ...touch, clientX: 50, clientY: 10 });
    fireEvent.click(canvas, { clientX: 50, clientY: 10 });
    expect(onSelect).toHaveBeenCalledWith({ eventId: 'ev_a', particleId: 1 });
  });
});
