import { useState } from 'react';
import { categoryLabel } from '../../shared/impact/engine';
import {
  AVOID_LABEL,
  AVOID_TOPICS,
  IMPORTANCE_LABEL,
  OCCUPATION_LABEL,
  OCCUPATIONS,
  TRANSPORT,
  TRANSPORT_LABEL,
  type FootballInterest,
  type Importance,
  type StoredProfile,
} from '../../shared/profile';
import type { Category, UserLocation } from '../../shared/types';
import { reverseGeocode } from '../services/account';
import { CitySearch } from './CitySearch';

interface Props {
  initial: StoredProfile;
  onDone: (p: StoredProfile) => void;
  onCancel?: () => void;
}

/** Categories asked about directly (sports has its own question; "other" isn't meaningful). */
const ASKED: Category[] = ['economy', 'work', 'health', 'security', 'politics', 'climate', 'technology', 'education', 'mobility', 'culture'];
const LEVELS: Importance[] = [-2, -1, 0, 1, 2];

const STEPS = ['Localização', 'O que importa', 'Futebol', 'Rotina', 'Trabalho e finanças', 'Outros lugares', 'Ver menos'] as const;

const placeLabel = (l: UserLocation) => [l.name, l.admin1Name, l.countryName].filter(Boolean).join(', ');

function YesNo({ value, onChange, label }: { value?: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <div className="q-row">
      <span>{label}</span>
      <div className="segmented segmented--small" role="radiogroup" aria-label={label}>
        {[true, false].map((v) => (
          <button key={String(v)} type="button" role="radio" aria-checked={value === v} className={value === v ? 'is-on' : ''} onClick={() => onChange(v)}>
            {v ? 'Sim' : 'Não'}
          </button>
        ))}
      </div>
    </div>
  );
}

export function Questionnaire({ initial, onDone, onCancel }: Props) {
  const [step, setStep] = useState(0);
  const [p, setP] = useState<StoredProfile>(initial);
  const [gps, setGps] = useState<{ state: 'idle' | 'locating' | 'found' | 'error'; place?: UserLocation | null; msg?: string }>({ state: 'idle' });
  const [manual, setManual] = useState(false);
  const patch = (x: Partial<StoredProfile>) => setP((cur) => ({ ...cur, ...x }));
  const last = step === STEPS.length - 1;

  const useGps = () => {
    if (!('geolocation' in navigator)) return setGps({ state: 'error', msg: 'Este navegador não oferece localização.' });
    setGps({ state: 'locating' });
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        try {
          // Rounded to ~11 km here; the precise position never leaves the browser.
          const place = await reverseGeocode(Math.round(pos.coords.latitude * 10) / 10, Math.round(pos.coords.longitude * 10) / 10);
          setGps(place ? { state: 'found', place } : { state: 'error', msg: 'Não encontramos uma cidade para esta posição. Escolha manualmente.' });
        } catch {
          setGps({ state: 'error', msg: 'Não foi possível identificar a cidade agora. Escolha manualmente.' });
        }
      },
      (err) =>
        setGps({
          state: 'error',
          msg: err.code === err.PERMISSION_DENIED ? 'Permissão de localização negada. Escolha a cidade manualmente.' : 'Não foi possível obter sua localização. Escolha manualmente.',
        }),
      { enableHighAccuracy: false, timeout: 12_000, maximumAge: 600_000 },
    );
  };

  const canContinue = step !== 0 || !!p.location;
  const next = () => (last ? onDone({ ...p, onboarded: true }) : setStep(step + 1));

  return (
    <div className="questionnaire" role="dialog" aria-modal="true" aria-labelledby="q-title">
      <div className="questionnaire__inner">
        <p className="onboarding__brand">SAND</p>
        <p className="q-progress">
          Passo {step + 1} de {STEPS.length} · {STEPS[step]}
        </p>

        {step === 0 && (
          <section>
            <h1 id="q-title" className="onboarding__title">
              Onde você mora?
            </h1>
            <p className="onboarding__text">Notícias perto de você pesam mais. Guardamos só a cidade (precisão de ~11 km), nunca sua posição exata.</p>
            {p.location && !manual && gps.state !== 'found' && (
              <p className="q-current">
                Cidade atual: <strong>{placeLabel(p.location)}</strong>
              </p>
            )}
            {gps.state === 'found' && gps.place ? (
              <div className="q-confirm">
                <p>
                  Você está em <strong>{placeLabel(gps.place)}</strong>?
                </p>
                <div className="chips">
                  <button
                    type="button"
                    className="chip chip--on"
                    onClick={() => {
                      patch({ location: gps.place!, locationSource: 'gps' });
                      setGps({ state: 'idle' });
                    }}
                  >
                    Sim, usar esta cidade
                  </button>
                  <button
                    type="button"
                    className="chip"
                    onClick={() => {
                      setGps({ state: 'idle' });
                      setManual(true);
                    }}
                  >
                    Não, escolher outra
                  </button>
                </div>
              </div>
            ) : (
              <div className="q-choice">
                <button type="button" className="btn" onClick={useGps} disabled={gps.state === 'locating'}>
                  {gps.state === 'locating' ? 'Localizando…' : 'Usar minha localização (GPS)'}
                </button>
                <button type="button" className="link-btn" onClick={() => setManual(true)}>
                  Digitar minha cidade
                </button>
              </div>
            )}
            {gps.state === 'error' && <p className="auth__error">{gps.msg}</p>}
            {(manual || gps.state === 'error') && (
              <CitySearch
                autoFocus
                onPick={(loc) => {
                  patch({ location: loc, locationSource: 'manual' });
                  setManual(false);
                  setGps({ state: 'idle' });
                }}
              />
            )}
          </section>
        )}

        {step === 1 && (
          <section>
            <h1 id="q-title" className="onboarding__title">
              O que é importante para você?
            </h1>
            <p className="onboarding__text">Define o tamanho dos grãos. Emergências perto de você aparecem sempre.</p>
            {/* Importance as grains of growing size: an empty ring = "não quero". */}
            <div className="q-legend" aria-hidden="true">
              {LEVELS.map((lv) => (
                <span key={lv}>{IMPORTANCE_LABEL[lv]}</span>
              ))}
            </div>
            <ul className="q-list">
              {ASKED.map((c) => (
                <li key={c} className="q-row q-row--dots">
                  <span>{categoryLabel(c)}</span>
                  <div className="q-dots" role="radiogroup" aria-label={categoryLabel(c)}>
                    {LEVELS.map((lv) => {
                      const cur = p.categoryImportance?.[c] ?? 0;
                      return (
                        <button
                          key={lv}
                          type="button"
                          role="radio"
                          aria-checked={cur === lv}
                          aria-label={IMPORTANCE_LABEL[lv]}
                          title={IMPORTANCE_LABEL[lv]}
                          className={`q-dot q-dot--${lv + 2} ${cur === lv ? 'is-on' : ''}`}
                          onClick={() => patch({ categoryImportance: { ...p.categoryImportance, [c]: lv } })}
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

        {step === 2 && (
          <section>
            <h1 id="q-title" className="onboarding__title">
              Você acompanha futebol?
            </h1>
            <div className="segmented" role="radiogroup" aria-label="Acompanha futebol">
              {(
                [
                  ['no', 'Não'],
                  ['some', 'Um pouco'],
                  ['yes', 'Sim, sou torcedor(a)'],
                ] as [FootballInterest, string][]
              ).map(([v, label]) => (
                <button
                  key={v}
                  type="button"
                  role="radio"
                  aria-checked={p.football?.interest === v}
                  className={p.football?.interest === v ? 'is-on' : ''}
                  onClick={() => patch({ football: { interest: v, club: v === 'no' ? undefined : p.football?.club } })}
                >
                  {label}
                </button>
              ))}
            </div>
            {p.football && p.football.interest !== 'no' && (
              <label className="field">
                <span>Seu time (opcional)</span>
                <input
                  className="input"
                  value={p.football.club ?? ''}
                  placeholder="Ex.: Fortaleza, Ceará, Flamengo…"
                  maxLength={40}
                  onChange={(e) => patch({ football: { interest: p.football!.interest, club: e.target.value } })}
                />
              </label>
            )}
            <p className="hint">Notícias que mencionam o seu time ficam maiores. Se você não acompanha, futebol vira um grão bem pequeno.</p>
          </section>
        )}

        {step === 3 && (
          <section>
            <h1 id="q-title" className="onboarding__title">
              Sua rotina
            </h1>
            <p className="onboarding__text">Como você se locomove? (pode marcar mais de um)</p>
            <div className="chips">
              {TRANSPORT.map((t) => {
                const on = p.routine?.transport?.includes(t) ?? false;
                return (
                  <button
                    key={t}
                    type="button"
                    className={`chip ${on ? 'chip--on' : ''}`}
                    aria-pressed={on}
                    onClick={() => {
                      const cur = p.routine?.transport ?? [];
                      patch({ routine: { ...p.routine, transport: on ? cur.filter((x) => x !== t) : [...cur, t] } });
                    }}
                  >
                    {TRANSPORT_LABEL[t]}
                  </button>
                );
              })}
            </div>
            <YesNo label="Mora de aluguel?" value={p.routine?.rents} onChange={(v) => patch({ routine: { ...p.routine, rents: v } })} />
            <YesNo label="Tem filhos em idade escolar?" value={p.routine?.schoolKids} onChange={(v) => patch({ routine: { ...p.routine, schoolKids: v } })} />
            <p className="hint">Ex.: quem usa ônibus vê greves de transporte com mais peso; quem anda de carro, o preço da gasolina.</p>
          </section>
        )}

        {step === 4 && (
          <section>
            <h1 id="q-title" className="onboarding__title">
              Trabalho e finanças
            </h1>
            <p className="onboarding__text">Opcional. Usado só para estimar o impacto das notícias para você.</p>
            <div className="chips">
              {OCCUPATIONS.map((o) => (
                <button
                  key={o}
                  type="button"
                  className={`chip ${p.work?.occupation === o ? 'chip--on' : ''}`}
                  aria-pressed={p.work?.occupation === o}
                  onClick={() => patch({ work: { ...p.work, occupation: p.work?.occupation === o ? undefined : o } })}
                >
                  {OCCUPATION_LABEL[o]}
                </button>
              ))}
            </div>
            <YesNo label="Tem financiamento ou dívidas?" value={p.work?.hasDebt} onChange={(v) => patch({ work: { ...p.work, hasDebt: v } })} />
            <YesNo label="Investe (poupança, renda fixa, ações…)?" value={p.work?.invests} onChange={(v) => patch({ work: { ...p.work, invests: v } })} />
            <YesNo label="Recebe algum benefício social?" value={p.work?.socialBenefit} onChange={(v) => patch({ work: { ...p.work, socialBenefit: v } })} />
          </section>
        )}

        {step === 5 && (
          <section>
            <h1 id="q-title" className="onboarding__title">
              Outros lugares importantes
            </h1>
            <p className="onboarding__text">Cidades onde você tem família, trabalho ou estudo (até 3). Notícias de lá também contam como próximas.</p>
            {(p.places ?? []).length > 0 && (
              <ul className="plain-list q-places">
                {(p.places ?? []).map((pl, i) => (
                  <li key={`${pl.name}-${i}`} className="row">
                    <span>{placeLabel(pl)}</span>
                    <button type="button" className="link-btn" onClick={() => patch({ places: (p.places ?? []).filter((_, j) => j !== i) })}>
                      Remover
                    </button>
                  </li>
                ))}
              </ul>
            )}
            {(p.places ?? []).length < 3 && <CitySearch onPick={(loc) => patch({ places: [...(p.places ?? []), loc].slice(0, 3) })} />}
          </section>
        )}

        {step === 6 && (
          <section>
            <h1 id="q-title" className="onboarding__title">
              Algo que prefere ver menos?
            </h1>
            <p className="onboarding__text">Esses grãos ficam menores. Emergências perto de você nunca são reduzidas.</p>
            <div className="chips">
              {AVOID_TOPICS.map((t) => {
                const on = p.avoidTopics?.includes(t) ?? false;
                return (
                  <button
                    key={t}
                    type="button"
                    className={`chip ${on ? 'chip--on' : ''}`}
                    aria-pressed={on}
                    onClick={() => {
                      const cur = p.avoidTopics ?? [];
                      patch({ avoidTopics: on ? cur.filter((x) => x !== t) : [...cur, t] });
                    }}
                  >
                    {AVOID_LABEL[t]}
                  </button>
                );
              })}
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
              Cancelar
            </button>
          ) : (
            <span />
          )}
          <div className="q-nav__right">
            {step > 0 && !last && (
              <button type="button" className="link-btn" onClick={() => setStep(step + 1)}>
                Pular
              </button>
            )}
            <button type="button" className="btn" disabled={!canContinue} onClick={next}>
              {last ? 'Concluir' : 'Continuar'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
