// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ResearchQuestionnaire } from '../../src/components/ResearchQuestionnaire';
import { FORTALEZA } from '../helpers';
import { installDomStubs } from './setup-dom';

beforeEach(() => installDomStubs());
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('SAND Conhecimento questionnaire', () => {
  it('asks areas, countries, languages, grain size and access, and saves them in the profile', async () => {
    const onDone = vi.fn();
    render(<ResearchQuestionnaire initial={{ ...FORTALEZA, onboarded: true }} onDone={onDone} onCancel={() => {}} />);

    expect(screen.getByRole('heading', { name: 'Que áreas da ciência te interessam?' })).toBeInTheDocument();
    await userEvent.click(screen.getAllByRole('radio', { name: 'Muito' })[0]); // Saúde e medicina
    await userEvent.click(screen.getAllByRole('radio', { name: 'Não quero' })[10]); // Artes e humanidades
    await userEvent.click(screen.getByRole('button', { name: 'Continuar' }));

    // Your country comes pre-selected.
    expect(screen.getByRole('button', { name: 'Brasil' })).toHaveAttribute('aria-pressed', 'true');
    await userEvent.click(screen.getByRole('button', { name: 'Portugal' }));
    await userEvent.click(screen.getByRole('radio', { name: 'Mostrar só esses' }));
    await userEvent.click(screen.getByRole('button', { name: 'Continuar' }));

    expect(screen.getByRole('button', { name: 'Português' })).toHaveAttribute('aria-pressed', 'true');
    await userEvent.click(screen.getByRole('button', { name: 'Inglês' }));
    await userEvent.click(screen.getByRole('button', { name: 'Continuar' }));

    await userEvent.click(screen.getByRole('radio', { name: /Destaque científico/ }));
    await userEvent.click(screen.getByRole('button', { name: 'Continuar' }));

    await userEvent.click(screen.getByRole('radio', { name: 'Prefiro aberto' }));
    await userEvent.click(screen.getByRole('radio', { name: 'Sim' }));
    await userEvent.click(screen.getByRole('button', { name: 'Concluir' }));

    expect(onDone).toHaveBeenCalledWith(
      expect.objectContaining({
        location: FORTALEZA.location,
        research: {
          onboarded: true,
          themes: { health: 2, culture: -2 },
          countries: ['BR', 'PT'],
          countryMode: 'only',
          languages: ['pt', 'en'],
          sizeBasis: 'science',
          openAccess: 'prefer',
          likesReviews: true,
        },
      }),
    );
  });

  it('can be left for later', async () => {
    const onCancel = vi.fn();
    render(<ResearchQuestionnaire initial={{ ...FORTALEZA, onboarded: true }} onDone={() => {}} onCancel={onCancel} />);
    await userEvent.click(screen.getByRole('button', { name: 'Agora não' }));
    expect(onCancel).toHaveBeenCalled();
  });
});
