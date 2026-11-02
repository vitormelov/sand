import { useState } from 'react';
import { IMPORTANCE_LABEL, type Importance, type StoredProfile } from '../../shared/profile';
import { RESEARCH_COUNTRIES, RESEARCH_LANGUAGES, THEMES, type ResearchPrefs, type SizeBasis } from '../../shared/research';

interface Props {
  initial: StoredProfile;
  onDone: (p: StoredProfile) => void;
  onCancel?: () => void;
}

const LEVELS: Importance[] = [-2, -1, 0, 1, 2];
const STEPS = ['Áreas', 'Países', 'Idiomas', 'Tamanho dos grãos', 'Acesso e formato'] as const;

const SIZE_OPTIONS: [SizeBasis, string, string][] = [
  ['personal', 'O quanto tem a ver comigo', 'Grandes são as pesquisas dos temas, países e idiomas que você escolheu.'],
  ['balanced', 'Equilíbrio', 'Metade conta o que você escolheu, metade o destaque científico.'],
  ['science', 'Destaque científico', 'Grandes são as pesquisas de revistas de peso e muito citadas.'],
];

function Mode({ value, onChange, label }: { value?: 'prefer' | 'only'; onChange: (v: 'prefer' | 'only') => void; label: string }) {
  return (
    <div className="segmented segmented--small" role="radiogroup" aria-label={label}>
      {(
        [
          ['prefer', 'Dar preferência'],
          ['only', 'Mostrar só esses'],
        ] as const
      ).map(([v, text]) => (
        <button key={v} type="button" role="radio" aria-checked={(value ?? 'prefer') === v} className={(value ?? 'prefer') === v ? 'is-on' : ''} onClick={() => onChange(v)}>
          {text}
        </button>
      ))}
    </div>
  );
}

function Chips({ options, selected, onToggle }: { options: [string, string][]; selected: string[]; onToggle: (code: string) => void }) {
  return (
    <div className="chips">
      {options.map(([code, name]) => {
        const on = selected.includes(code);
        return (
          <button key={code} type="button" className={`chip ${on ? 'chip--on' : ''}`} aria-pressed={on} onClick={() => onToggle(code)}>
            {name}
          </button>
        );
      })}
    </div>
  );
}

/**
 * SAND Conhecimento's first-use questions: which areas of science, from which countries,
 * in which languages, what makes a grain big, and open access / reviews. Everything is
 * optional and can be redone in the settings.
 */
export function ResearchQuestionnaire({ initial, onDone, onCancel }: Props) {
  const [step, setStep] = useState(0);
  const homeCountry = initial.location?.countryCode;
  // Starting point: your own country and Portuguese, which most people here will want.
  const [r, setR] = useState<ResearchPrefs>(() => ({
    countries: homeCountry ? [homeCountry] : [],
    languages: ['pt'],
    sizeBasis: 'balanced',
    openAccess: 'any',
    ...initial.research,
  }));
  const patch = (x: Partial<ResearchPrefs>) => setR((cur) => ({ ...cur, ...x }));
  const toggle = (list: string[] | undefined, code: string) => (list?.includes(code) ? list.filter((c) => c !== code) : [...(list ?? []), code]);
  const last = step === STEPS.length - 1;
  const finish = () => onDone({ ...initial, research: { ...r, onboarded: true } });
  const countries = r.countries ?? [];
  const languages = r.languages ?? [];

  return (
    <div className="questionnaire" role="dialog" aria-modal="true" aria-labelledby="rq-title">
      <div className="questionnaire__inner">
        <p className="onboarding__brand">SAND · CONHECIMENTO</p>
        <p className="q-progress">
          Passo {step + 1} de {STEPS.length} · {STEPS[step]}
        </p>

        {step === 0 && (
          <section>
            <h1 id="rq-title" className="onboarding__title">
              Que áreas da ciência te interessam?
            </h1>
            <p className="onboarding__text">Cada grão é uma pesquisa publicada no último mês. Áreas marcadas com "não quero" saem da areia.</p>
            <div className="q-legend" aria-hidden="true">
              {LEVELS.map((lv) => (
                <span key={lv}>{IMPORTANCE_LABEL[lv]}</span>
              ))}
            </div>
            <ul className="q-list">
              {THEMES.map((t) => (
                <li key={t.id} className="q-row q-row--dots">
                  <span>{t.label}</span>
                  <div className="q-dots" role="radiogroup" aria-label={t.label}>
                    {LEVELS.map((lv) => {
                      const cur = r.themes?.[t.id] ?? 0;
                      return (
                        <button
                          key={lv}
                          type="button"
                          role="radio"
                          aria-checked={cur === lv}
                          aria-label={IMPORTANCE_LABEL[lv]}
                          title={IMPORTANCE_LABEL[lv]}
                          className={`q-dot q-dot--${lv + 2} ${cur === lv ? 'is-on' : ''}`}
                          onClick={() => patch({ themes: { ...r.themes, [t.id]: lv } })}
                        >
                          <span />
                        </button>
                      );
                    })}
                  </div>
                </li>
              ))}
            </ul>
          </section>
        )}

        {step === 1 && (
          <section>
            <h1 id="rq-title" className="onboarding__title">
              Pesquisas de quais países?
            </h1>
            <p className="onboarding__text">Pelo país das instituições dos autores. Sem nenhum marcado, vale o país onde você mora.</p>
            <Chips options={RESEARCH_COUNTRIES} selected={countries} onToggle={(c) => patch({ countries: toggle(countries, c) })} />
            {countries.length > 0 && <Mode label="Como usar os países" value={r.countryMode} onChange={(v) => patch({ countryMode: v })} />}
            <p className="hint">
              "Dar preferência" deixa as pesquisas desses países maiores. "Mostrar só esses" tira as outras da areia, e a areia pode ficar bem mais vazia.
            </p>
          </section>
        )}

        {step === 2 && (
          <section>
            <h1 id="rq-title" className="onboarding__title">
              Em que idiomas você lê?
            </h1>
            <p className="onboarding__text">O título e o resumo aparecem no idioma original da pesquisa.</p>
            <Chips options={RESEARCH_LANGUAGES} selected={languages} onToggle={(c) => patch({ languages: toggle(languages, c) })} />
            {languages.length > 0 && <Mode label="Como usar os idiomas" value={r.languageMode} onChange={(v) => patch({ languageMode: v })} />}
            <p className="hint">A maior parte da ciência sai em inglês: "mostrar só português" deixa poucas pesquisas na areia.</p>
          </section>
        )}

        {step === 3 && (
          <section>
            <h1 id="rq-title" className="onboarding__title">
              O que deve deixar um grão grande?
            </h1>
            <div className="q-options" role="radiogroup" aria-label="O que deixa um grão grande">
              {SIZE_OPTIONS.map(([v, label, hint]) => (
                <button key={v} type="button" role="radio" aria-checked={r.sizeBasis === v} className={`q-option ${r.sizeBasis === v ? 'is-on' : ''}`} onClick={() => patch({ sizeBasis: v })}>
                  <strong>{label}</strong>
                  <span>{hint}</span>
                </button>
              ))}
            </div>
          </section>
        )}

        {step === 4 && (
          <section>
            <h1 id="rq-title" className="onboarding__title">
              Acesso e formato
            </h1>
            <p className="onboarding__text">Pesquisas de acesso aberto podem ser lidas de graça; as outras podem pedir assinatura da revista.</p>
            <div className="segmented" role="radiogroup" aria-label="Acesso aberto">
              {(
                [
                  ['any', 'Tanto faz'],
                  ['prefer', 'Prefiro aberto'],
                  ['only', 'Só aberto'],
                ] as const
              ).map(([v, label]) => (
                <button key={v} type="button" role="radio" aria-checked={r.openAccess === v} className={r.openAccess === v ? 'is-on' : ''} onClick={() => patch({ openAccess: v })}>
                  {label}
                </button>
              ))}
            </div>
            <div className="q-row">
              <span>Gosta de revisões (artigos que resumem o que já se sabe sobre um tema)?</span>
              <div className="segmented segmented--small" role="radiogroup" aria-label="Revisões">
                {[true, false].map((v) => (
                  <button key={String(v)} type="button" role="radio" aria-checked={r.likesReviews === v} className={r.likesReviews === v ? 'is-on' : ''} onClick={() => patch({ likesReviews: v })}>
                    {v ? 'Sim' : 'Não'}
                  </button>
                ))}
              </div>
            </div>
          </section>
        )}

        <div className="q-nav">
          {step > 0 ? (
            <button type="button" className="link-btn" onClick={() => setStep(step - 1)}>
              Voltar
            </button>
          ) : onCancel ? (
            <button type="button" className="link-btn" onClick={onCancel}>
              Agora não
            </button>
          ) : (
            <span />
          )}
          <div className="q-nav__right">
            {!last && (
              <button type="button" className="link-btn" onClick={() => setStep(step + 1)}>
                Pular
              </button>
            )}
            <button type="button" className="btn" onClick={() => (last ? finish() : setStep(step + 1))}>
              {last ? 'Concluir' : 'Continuar'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
