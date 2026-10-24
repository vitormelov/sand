// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '../../src/App';
import { event } from '../helpers';
import { FakeEventSource, installDomStubs } from './setup-dom';

const status = { sources: [{ id: 'g1', name: 'g1', kind: 'outlet', health: 'ok', lastSuccessAt: new Date().toISOString() }], serverTime: new Date().toISOString(), eventCount: 1 };

beforeEach(() => {
  installDomStubs();
  FakeEventSource.instances = [];
  (globalThis as any).EventSource = FakeEventSource;
  localStorage.setItem('sand:prefs:v1', JSON.stringify({ onboarded: true, location: { name: 'Fortaleza', admin1: 'CE', admin1Name: 'Ceará', countryCode: 'BR', countryName: 'Brasil' } }));
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('App', () => {
  it('shows loading, empty, error and offline states without inventing news', async () => {
    render(<App demo={false} />);
    expect(screen.getByText('Conectando às fontes de notícias…')).toBeInTheDocument();
    const es = FakeEventSource.latest();
    act(() => {
      es.open();
      es.emit('snapshot', { events: [], status }, 1);
    });
    await screen.findByText(/Aguardando as primeiras notícias reais/);
    act(() => es.fail(false));
    await waitFor(() => expect(screen.getByText('reconectando')).toBeInTheDocument());
    act(() => window.dispatchEvent(new Event('offline')));
    await screen.findByText(/Sem internet/);
  });

  it('lists recent news and opens the details of a grain, which closes with Escape', async () => {
    render(<App demo={false} />);
    const es = FakeEventSource.latest();
    const ev = event({ id: 'ev_abc', title: 'Banco Central eleva a taxa Selic', sourceName: 'Agência Brasil', url: 'https://agenciabrasil.ebc.com.br/x' });
    act(() => {
      es.open();
      es.emit('snapshot', { events: [ev], status }, 5);
    });
    await userEvent.click(screen.getByRole('button', { name: 'Notícias recentes' }));
    await userEvent.click(await screen.findByRole('button', { name: /Banco Central eleva a taxa Selic/ }));
    const dialog = await screen.findByRole('dialog', { name: 'Banco Central eleva a taxa Selic' });
    expect(dialog).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Abrir matéria original/ })).toHaveAttribute('href', 'https://agenciabrasil.ebc.com.br/x');
    fireEvent.keyDown(window, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Banco Central eleva a taxa Selic' })).toBeNull());
  });

  it('opening a news item marks it as seen; it can be saved and found in "Notícias salvas"', async () => {
    render(<App demo={false} />);
    const es = FakeEventSource.latest();
    const ev = event({ id: 'ev_save1', title: 'Notícia para salvar', sourceName: 'g1', url: 'https://g1.globo.com/x' }, Date.now());
    act(() => {
      es.open();
      es.emit('snapshot', { events: [ev], status }, 5);
    });
    await userEvent.click(screen.getByRole('button', { name: 'Notícias recentes' }));
    expect(screen.getByText(/nova ·/)).toBeInTheDocument(); // published 30 min ago, not opened yet
    await userEvent.click(screen.getByRole('button', { name: /Notícia para salvar/ }));
    await userEvent.click(await screen.findByRole('button', { name: /Salvar/ }));
    expect(screen.getByRole('button', { name: /Salva/ })).toHaveAttribute('aria-pressed', 'true');
    expect(JSON.parse(localStorage.getItem('sand:viewed:v1')!)).toContain('ev_save1');
    expect(JSON.parse(localStorage.getItem('sand:saved:v1')!)[0]).toMatchObject({ id: 'ev_save1', title: 'Notícia para salvar' });

    await userEvent.click(screen.getByRole('button', { name: 'Notícias salvas' }));
    expect(screen.getByRole('heading', { name: 'Notícias salvas' })).toBeInTheDocument();
    expect(screen.getByText('Notícia para salvar')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /Remover dos salvos/ }));
    expect(screen.getByText(/Nenhuma notícia salva ainda/)).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Notícias recentes' }));
    expect(screen.getByText(/· vista/)).toBeInTheDocument();
    expect(screen.queryByText(/nova ·/)).toBeNull();
  });

  it('counts live events separately from the initial snapshot', async () => {
    render(<App demo={false} />);
    const es = FakeEventSource.latest();
    act(() => {
      es.open();
      es.emit('snapshot', { events: [event({ id: 'ev_a' })], status }, 1);
      es.emit('event', { change: 'new', event: event({ id: 'ev_b' }) }, 2);
    });
    await screen.findByText(/1 evento nesta sessão · 2 nas últimas horas/);
  });

  it('labels DEMO mode permanently and never connects to the real stream', () => {
    render(<App demo />);
    expect(screen.getByText('DEMO — dados fictícios')).toBeInTheDocument();
    expect(FakeEventSource.instances).toHaveLength(0);
  });

  it('lab mode: fictitious, labelled, offline from the real stream; scenarios use the real engine', async () => {
    render(<App lab />);
    expect(screen.getByText('LAB — dados fictícios')).toBeInTheDocument();
    expect(FakeEventSource.instances).toHaveLength(0);
    await userEvent.click(screen.getByRole('button', { name: 'Emergência na sua cidade' }));
    await userEvent.click(screen.getByRole('button', { name: 'Cultura no exterior' }));
    const rows = [...document.querySelectorAll('.lab__log li')].map((li) => li.textContent ?? '');
    const scoreOf = (label: string) => Number(rows.find((r) => r.startsWith(label))!.slice(label.length).match(/\d+/)![0]);
    expect(scoreOf('Emergência na sua cidade')).toBeGreaterThanOrEqual(80);
    expect(scoreOf('Cultura no exterior')).toBeLessThan(30);
    await userEvent.click(screen.getByRole('button', { name: 'Notícias recentes' }));
    // Once in the recent list, once in the critical-alert line (the emergency rule fired).
    expect(await screen.findAllByRole('button', { name: /\[LAB\] Enchente atinge bairros/ })).toHaveLength(2);
    expect(document.querySelector('.critical')).toHaveTextContent('[LAB] Enchente atinge bairros');
  });

  it('dark mode: the theme setting switches the whole page and is remembered', async () => {
    render(<App demo={false} />);
    await userEvent.click(screen.getByRole('button', { name: 'Configurações' }));
    await userEvent.click(screen.getByRole('radio', { name: 'Escuro' }));
    expect(document.documentElement.dataset.theme).toBe('dark');
    expect(JSON.parse(localStorage.getItem('sand:prefs:v1')!).theme).toBe('dark');
    await userEvent.click(screen.getByRole('radio', { name: 'Claro' }));
    expect(document.documentElement.dataset.theme).toBe('light');
  });

  it('respects the reduced-motion preference in settings', async () => {
    render(<App demo={false} />);
    await userEvent.click(screen.getByRole('button', { name: 'Configurações' }));
    await userEvent.click(screen.getByRole('radio', { name: 'Reduzido' }));
    expect(JSON.parse(localStorage.getItem('sand:prefs:v1')!).reducedMotion).toBe('on');
  });
});
