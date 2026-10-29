// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Root } from '../../src/Root';
import { accountModule, fakeAccount, fakeFirestore } from './fakeFirebase';
import { installDomStubs } from './setup-dom';

vi.mock('../../src/services/account', async () => (await import('./fakeFirebase')).accountModule);
vi.mock('../../src/services/firebase', async () => (await import('./fakeFirebase')).firebaseModule);
vi.mock('firebase/firestore', async () => (await import('./fakeFirebase')).firestoreModule);

type Handler = (url: string, init?: RequestInit) => { status?: number; body: unknown } | undefined;

/** Routes fetch calls (city search) to small handlers; records every call. */
function mockApi(handler: Handler) {
  const calls: { url: string; init?: RequestInit }[] = [];
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const url = String(input);
    calls.push({ url, init });
    const r = handler(url, init) ?? { status: 404, body: { error: 'not_found' } };
    return new Response(JSON.stringify(r.body), { status: r.status ?? 200 });
  });
  return calls;
}

const FORTALEZA = { name: 'Fortaleza', admin1: 'CE', admin1Name: 'Ceará', countryCode: 'BR', countryName: 'Brasil', lat: -3.7, lon: -38.5 };

beforeEach(() => {
  installDomStubs();
  fakeAccount.reset();
  fakeFirestore.subscriptions = 0;
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('login and first-login questionnaire', () => {
  it('requires login; wrong password shows a clear error', async () => {
    fakeAccount.loginError = 'invalid_credentials';
    render(<Root />);
    expect(await screen.findByRole('heading', { name: 'Entrar' })).toBeInTheDocument();
    expect(fakeFirestore.subscriptions).toBe(0); // no news before login
    // Behind the form: decorative sand only (hidden from screen readers, carries no news).
    const backdrop = document.querySelector('.auth-backdrop')!;
    expect(backdrop.getAttribute('aria-hidden')).toBe('true');
    expect(backdrop.querySelector('canvas.sand-canvas')).not.toBeNull();
    expect(screen.getByText('SAND')).toHaveClass('auth__brand');
    await userEvent.type(screen.getByLabelText('E-mail'), 'eu@example.com');
    await userEvent.type(screen.getByLabelText(/^Senha/), 'errada-123');
    await userEvent.click(screen.getByRole('button', { name: 'Entrar' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('E-mail ou senha incorretos.');
  });

  it('new account → questionnaire (manual city, preferences) → saved → sand', async () => {
    const calls = mockApi((url) => {
      if (url.startsWith('/api/geocode?')) return { body: { results: [FORTALEZA], source: 'open-meteo' } };
    });
    render(<Root />);
    await userEvent.click(await screen.findByRole('button', { name: 'Criar conta' }));
    await userEvent.type(screen.getByLabelText('E-mail'), 'eu@example.com');
    await userEvent.type(screen.getByLabelText(/^Senha/), 'senha-boa-123');
    await userEvent.click(screen.getAllByRole('button', { name: 'Criar conta' })[0]);

    // 1. Location
    expect(await screen.findByRole('heading', { name: 'Onde você mora?' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Continuar' })).toBeDisabled(); // city is required
    await userEvent.click(screen.getByRole('button', { name: 'Digitar minha cidade' }));
    await userEvent.type(screen.getByRole('combobox', { name: 'Buscar cidade' }), 'Fortal');
    await userEvent.click(await screen.findByRole('button', { name: 'Fortaleza, Ceará, Brasil' }));
    await userEvent.click(screen.getByRole('button', { name: 'Continuar' }));

    // 2. Categories
    expect(screen.getByRole('heading', { name: 'O que é importante para você?' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('radiogroup', { name: 'Economia' }).querySelectorAll('button')[4] as HTMLElement); // "Muito"
    await userEvent.click(screen.getByRole('button', { name: 'Continuar' }));

    // 3. Football
    await userEvent.click(screen.getByRole('radio', { name: 'Sim, sou torcedor(a)' }));
    await userEvent.type(screen.getByLabelText('Seu time (opcional)'), 'Fortaleza');
    await userEvent.click(screen.getByRole('button', { name: 'Continuar' }));

    // 4. Routine
    await userEvent.click(screen.getByRole('button', { name: 'Ônibus / metrô' }));
    await userEvent.click(screen.getByRole('button', { name: 'Continuar' }));

    // 5–7: skip / continue to the end
    await userEvent.click(screen.getByRole('button', { name: 'Pular' }));
    await userEvent.click(screen.getByRole('button', { name: 'Pular' }));
    await userEvent.click(screen.getByRole('button', { name: 'Violência e crimes' }));
    await userEvent.click(screen.getByRole('button', { name: 'Concluir' }));

    await waitFor(() => expect(fakeAccount.savedProfile).toBeTruthy());
    expect(fakeAccount.savedProfile).toMatchObject({
      onboarded: true,
      location: { name: 'Fortaleza', admin1: 'CE' },
      locationSource: 'manual',
      categoryImportance: { economy: 2 },
      football: { interest: 'yes', club: 'Fortaleza' },
      routine: { transport: ['public'] },
      avoidTopics: ['violence'],
    });
    // City search goes to SAND's API with the user's ID token.
    expect(calls.find((c) => c.url.startsWith('/api/geocode?'))!.init!.headers).toMatchObject({ Authorization: 'Bearer test-token' });
    await waitFor(() => expect(screen.queryByRole('heading', { name: 'Onde você mora?' })).toBeNull());
    expect(fakeFirestore.subscriptions).toBeGreaterThan(0); // news feed starts
  });

  it('GPS: the position is rounded (~11 km) before it leaves the browser', async () => {
    fakeAccount.me = { email: 'eu@example.com', profile: null, viewed: [], saved: [] };
    fakeAccount.reverseResult = FORTALEZA;
    Object.defineProperty(navigator, 'geolocation', {
      configurable: true,
      value: { getCurrentPosition: (ok: PositionCallback) => ok({ coords: { latitude: -3.731862, longitude: -38.526669 } } as GeolocationPosition) },
    });
    render(<Root />);
    await userEvent.click(await screen.findByRole('button', { name: 'Usar minha localização (GPS)' }));
    expect(await screen.findByText(/Você está em/)).toHaveTextContent('Fortaleza, Ceará, Brasil');
    expect(fakeAccount.reverseCalls).toEqual([[-3.7, -38.5]]);
    await userEvent.click(screen.getByRole('button', { name: 'Sim, usar esta cidade' }));
    expect(screen.getByRole('button', { name: 'Continuar' })).toBeEnabled();
  });

  it('denied GPS permission falls back to typing the city', async () => {
    fakeAccount.me = { email: 'eu@example.com', profile: null, viewed: [], saved: [] };
    Object.defineProperty(navigator, 'geolocation', {
      configurable: true,
      value: { getCurrentPosition: (_ok: PositionCallback, err: PositionErrorCallback) => err({ code: 1, PERMISSION_DENIED: 1 } as GeolocationPositionError) },
    });
    render(<Root />);
    await userEvent.click(await screen.findByRole('button', { name: 'Usar minha localização (GPS)' }));
    expect(await screen.findByText(/Permissão de localização negada/)).toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: 'Buscar cidade' })).toBeInTheDocument();
  });

  it('a returning user who already answered goes straight to the sand', async () => {
    fakeAccount.me = { email: 'eu@example.com', profile: { onboarded: true, location: FORTALEZA, interests: [], affinity: {} } as any, viewed: [], saved: [] };
    render(<Root />);
    await waitFor(() => expect(fakeFirestore.subscriptions).toBeGreaterThan(0));
    expect(screen.queryByRole('heading', { name: 'Onde você mora?' })).toBeNull();
    expect(screen.queryByRole('heading', { name: 'Entrar' })).toBeNull();
  });

  it('forgot password: asks for the e-mail, then confirms the link was sent', async () => {
    render(<Root />);
    await userEvent.click(await screen.findByRole('button', { name: 'Esqueci a senha' }));
    expect(screen.getByRole('alert')).toHaveTextContent('Digite seu e-mail');
    await userEvent.type(screen.getByLabelText('E-mail'), 'eu@example.com');
    await userEvent.click(screen.getByRole('button', { name: 'Esqueci a senha' }));
    expect(await screen.findByRole('status')).toHaveTextContent('enviamos um link');
    expect(accountModule.resetPassword).toHaveBeenCalledWith('eu@example.com');
  });
});
