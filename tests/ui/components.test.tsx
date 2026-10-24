// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { computeImpact } from '../../shared/impact/engine';
import { Clock } from '../../src/components/Clock';
import { EventDetails, EventPreview } from '../../src/components/EventDetails';
import { SettingsPanel } from '../../src/components/SettingsPanel';
import { connectionText } from '../../src/components/StatusBar';
import { DEFAULT_PREFS } from '../../src/services/storage';
import { sanitizePrefs } from '../../src/services/storage';
import { FORTALEZA, event } from '../helpers';
import { installDomStubs } from './setup-dom';

beforeEach(() => installDomStubs());
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('EventDetails', () => {
  const ev = event({
    title: 'Chuva forte <img src=x onerror=alert(1)> em Fortaleza',
    summary: 'Resumo da matéria original.',
    url: 'https://g1.globo.com/ce/ceara/noticia/x.ghtml',
    sourceName: 'g1 Ceará',
    publishedAt: '2026-10-23T18:00:00Z',
  });
  const impact = computeImpact(ev, FORTALEZA);

  it('shows the source, times, estimate, confidence and a safe link to the original', () => {
    render(<EventDetails event={ev} impact={impact} relatedTitle={() => undefined} onFeedback={() => {}} onClose={() => {}} onOpenRelated={() => {}} />);
    expect(screen.getByText('g1 Ceará')).toBeInTheDocument();
    expect(screen.getByText('Publicado')).toBeInTheDocument();
    expect(screen.getByText('Recebido')).toBeInTheDocument();
    expect(screen.getByLabelText(/Impacto estimado \d+ de 100/)).toBeInTheDocument();
    expect(screen.getAllByText(/confiança (alta|moderada|baixa)/).length).toBeGreaterThan(0);
    const link = screen.getByRole('link', { name: /Abrir matéria original/ });
    expect(link).toHaveAttribute('href', 'https://g1.globo.com/ce/ceara/noticia/x.ghtml');
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', 'noopener noreferrer');
  });

  it('renders source text as text, never as HTML', () => {
    const { container } = render(<EventDetails event={ev} impact={impact} relatedTitle={() => undefined} onFeedback={() => {}} onClose={() => {}} onOpenRelated={() => {}} />);
    expect(container.querySelector('img')).toBeNull();
    expect(screen.getByRole('heading', { level: 2 }).textContent).toContain('<img');
  });

  it('does not render non-http links', () => {
    render(<EventDetails event={{ ...ev, url: 'javascript:alert(1)' }} impact={impact} relatedTitle={() => undefined} onFeedback={() => {}} onClose={() => {}} onOpenRelated={() => {}} />);
    expect(screen.queryByRole('link', { name: /Abrir matéria original/ })).toBeNull();
    expect(screen.getByText('Link indisponível')).toBeInTheDocument();
  });

  it('closes with Escape and with the close button; records feedback', async () => {
    const onClose = vi.fn();
    const onFeedback = vi.fn();
    render(<EventDetails event={ev} impact={impact} relatedTitle={() => undefined} onFeedback={onFeedback} onClose={onClose} onOpenRelated={() => {}} />);
    fireEvent.keyDown(window, { key: 'Escape' });
    await userEvent.click(screen.getByRole('button', { name: 'Fechar detalhes' }));
    expect(onClose).toHaveBeenCalledTimes(2);
    await userEvent.click(screen.getByRole('button', { name: 'Relevante' }));
    expect(onFeedback).toHaveBeenCalledWith('relevant');
  });

  it('expands the factors behind the estimate', async () => {
    render(<EventDetails event={ev} impact={impact} relatedTitle={() => undefined} onFeedback={() => {}} onClose={() => {}} onOpenRelated={() => {}} />);
    await userEvent.click(screen.getByRole('button', { name: 'Ver fatores' }));
    expect(screen.getByText('Proximidade e exposição')).toBeInTheDocument();
    expect(screen.getByText('Consequência prática')).toBeInTheDocument();
  });
});

describe('hover preview and clock', () => {
  it('the preview shows source and headline only, and does not capture the pointer', () => {
    const ev = event({ title: 'Manchete em pré-visualização', sourceName: 'BBC News Brasil' });
    const { container } = render(<EventPreview event={ev} impact={computeImpact(ev, FORTALEZA)} />);
    expect(screen.getByText('Manchete em pré-visualização')).toBeInTheDocument();
    expect(screen.getByText(/BBC News Brasil · impacto \d+/)).toBeInTheDocument();
    expect(screen.queryByRole('link')).toBeNull();
    expect(container.querySelector('.details--preview')).toHaveAttribute('aria-hidden', 'true');
  });

  it('the clock shows the current local time (HH:MM)', () => {
    render(<Clock />);
    expect(screen.getByText(/^\d{2}:\d{2}$/)).toBeInTheDocument();
  });
});

describe('SettingsPanel', () => {
  it('searches and selects a city (no GPS)', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ results: [{ name: 'Fortaleza', admin1: 'CE', admin1Name: 'Ceará', countryCode: 'BR', countryName: 'Brasil', lat: -3.7, lon: -38.5 }], source: 'open-meteo' })),
    );
    const onChange = vi.fn();
    render(<SettingsPanel prefs={{ ...DEFAULT_PREFS }} onChange={onChange} onClose={() => {}} onClearAll={() => {}} onPrivacy={() => {}} />);
    await userEvent.type(screen.getByRole('combobox', { name: 'Buscar cidade' }), 'Fortal');
    const option = await screen.findByRole('button', { name: 'Fortaleza, Ceará, Brasil' });
    expect(fetchMock.mock.calls[0][0]).toMatch(/^\/api\/geocode\?q=Fortal/);
    await userEvent.click(option);
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ location: expect.objectContaining({ name: 'Fortaleza', admin1: 'CE' }) }));
  });

  it('adjusts preferences: reduced motion, interests, density, indicators', async () => {
    const onChange = vi.fn();
    render(<SettingsPanel prefs={{ ...DEFAULT_PREFS, location: FORTALEZA.location }} onChange={onChange} onClose={() => {}} onClearAll={() => {}} onPrivacy={() => {}} />);
    await userEvent.click(screen.getByRole('radio', { name: 'Reduzido' }));
    expect(onChange).toHaveBeenLastCalledWith({ reducedMotion: 'on' });
    await userEvent.click(screen.getByRole('button', { name: 'Economia' }));
    expect(onChange).toHaveBeenLastCalledWith({ interests: ['economy'] });
    await userEvent.click(screen.getByRole('radio', { name: 'Densa' }));
    expect(onChange).toHaveBeenLastCalledWith({ density: 'high' });
    await userEvent.click(screen.getByRole('switch', { name: /Mostrar indicadores/ }));
    expect(onChange).toHaveBeenLastCalledWith({ showIndicators: false });
  });

  it('lets the user delete the location and clear local preferences (with confirmation)', async () => {
    const onChange = vi.fn();
    const onClearAll = vi.fn();
    render(<SettingsPanel prefs={{ ...DEFAULT_PREFS, location: FORTALEZA.location }} onChange={onChange} onClose={() => {}} onClearAll={onClearAll} onPrivacy={() => {}} />);
    await userEvent.click(screen.getByRole('button', { name: 'Apagar' }));
    expect(onChange).toHaveBeenCalledWith({ location: undefined });
    await userEvent.click(screen.getByRole('button', { name: 'Limpar preferências locais' }));
    expect(onClearAll).not.toHaveBeenCalled();
    await userEvent.click(screen.getAllByRole('button', { name: 'Apagar' }).at(-1)!);
    expect(onClearAll).toHaveBeenCalled();
  });
});

describe('preferences storage', () => {
  it('sanitizes corrupted or hostile stored values', () => {
    const p = sanitizePrefs({ speed: 99, gravity: 'x', interests: ['economy', 'hack'], location: { name: 'X', countryCode: 'br', lat: -3.731234 }, affinity: { economy: 500 } });
    expect(p.speed).toBe(2);
    expect(p.gravity).toBe(1);
    expect(p.interests).toEqual(['economy']);
    expect(p.location).toMatchObject({ countryCode: 'BR', lat: -3.7 });
    expect(p.affinity.economy).toBe(10);
  });
});

describe('connection status text', () => {
  const base = { version: 1, snapshotLoaded: true, sessionCount: 0, demo: false } as const;
  it('reports loading, reconnecting, offline and stale states', () => {
    expect(connectionText({ ...base, connection: 'connecting', snapshotLoaded: false }).label).toBe('conectando');
    expect(connectionText({ ...base, connection: 'reconnecting' }).label).toBe('reconectando');
    expect(connectionText({ ...base, connection: 'offline' }).label).toBe('sem internet');
    const old = new Date(Date.now() - 3 * 3_600_000).toISOString();
    expect(connectionText({ ...base, connection: 'open', status: { serverTime: '', eventCount: 1, sources: [{ id: 'a', name: 'A', kind: 'outlet', health: 'ok', lastSuccessAt: old }] } }).label).toBe('dados desatualizados');
    expect(connectionText({ ...base, connection: 'open', status: { serverTime: '', eventCount: 1, sources: [{ id: 'a', name: 'A', kind: 'outlet', health: 'down' }] } }).label).toBe('fontes indisponíveis');
  });
});

void waitFor;
