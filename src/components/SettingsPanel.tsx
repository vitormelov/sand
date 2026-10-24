import { useEffect, useRef, useState } from 'react';
import type { StoredProfile } from '../../shared/profile';
import type { AccountProps } from '../App';
import { ApiError, changePassword, deleteAccount, ERROR_TEXT } from '../services/account';
import type { Prefs } from '../services/storage';
import { CitySearch } from './CitySearch';
import { IconClose } from './icons';

interface Props {
  prefs: Prefs;
  profile: StoredProfile;
  account?: AccountProps;
  onProfileChange: (p: StoredProfile) => void;
  onEditAnswers: () => void;
  onChange: (patch: Partial<Prefs>) => void;
  onClearAll: () => void;
  onClose: () => void;
  onPrivacy: () => void;
}

function Range(props: { label: string; value: number; min: number; max: number; step: number; onChange: (v: number) => void; format?: (v: number) => string }) {
  return (
    <label className="range">
      <span>{props.label}</span>
      <input type="range" min={props.min} max={props.max} step={props.step} value={props.value} onChange={(e) => props.onChange(Number(e.target.value))} />
      <output>{props.format ? props.format(props.value) : props.value}</output>
    </label>
  );
}

function Toggle(props: { label: string; hint?: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="toggle">
      <span>
        {props.label}
        {props.hint && <small>{props.hint}</small>}
      </span>
      <input type="checkbox" role="switch" checked={props.checked} onChange={(e) => props.onChange(e.target.checked)} />
    </label>
  );
}

/** Change password / delete account. Both ask for the current password. */
function AccountSection({ account }: { account: AccountProps }) {
  const [mode, setMode] = useState<'none' | 'password' | 'delete'>('none');
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const fail = (e: unknown) => setMsg(e instanceof ApiError ? (ERROR_TEXT[e.code] ?? 'Não foi possível concluir.') : 'Sem conexão com o servidor.');
  const reset = () => {
    setMode('none');
    setCurrent('');
    setNext('');
  };
  const open = (m: 'password' | 'delete') => {
    setMode(m);
    setMsg(null);
  };
  return (
    <section className="sheet__section">
      <h3>Conta</h3>
      <div className="row">
        <span>{account.email}</span>
        <span className="row__actions">
          <button className="link-btn" onClick={account.onLogout}>
            Sair
          </button>
        </span>
      </div>
      {mode === 'none' && (
        <div className="row__actions account-actions">
          <button className="link-btn" onClick={() => open('password')}>
            Alterar senha
          </button>
          <button className="link-btn" onClick={() => open('delete')}>
            Excluir conta
          </button>
        </div>
      )}
      {mode !== 'none' && (
        <form
          className="account-form"
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            setMsg(null);
            try {
              if (mode === 'password') {
                if (next.length < 8) throw new ApiError(400, 'weak_password');
                await changePassword(current, next);
                reset();
                setMsg('Senha alterada. Outros dispositivos precisarão entrar de novo.');
              } else {
                await deleteAccount(current);
                account.onDeleted();
              }
            } catch (err) {
              fail(err);
            } finally {
              setBusy(false);
            }
          }}
        >
          {mode === 'delete' && <p className="hint">Isto apaga sua conta e todas as suas respostas, sem volta.</p>}
          <label className="field">
            <span>Senha atual</span>
            <input className="input" type="password" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} required />
          </label>
          {mode === 'password' && (
            <label className="field">
              <span>Nova senha (mínimo 8 caracteres)</span>
              <input className="input" type="password" autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} required />
            </label>
          )}
          <div className="row__actions">
            <button className="btn" type="submit" disabled={busy}>
              {mode === 'password' ? 'Salvar nova senha' : 'Excluir minha conta'}
            </button>
            <button className="link-btn" type="button" onClick={reset}>
              Cancelar
            </button>
          </div>
        </form>
      )}
      {msg && <p className="hint">{msg}</p>}
    </section>
  );
}

export function SettingsPanel({ prefs, profile, account, onProfileChange, onEditAnswers, onChange, onClearAll, onClose, onPrivacy }: Props) {
  const [editingCity, setEditingCity] = useState(!profile.location);
  const [confirmClear, setConfirmClear] = useState(false);
  const headRef = useRef<HTMLHeadingElement>(null);

  useEffect(() => headRef.current?.focus(), []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const x = (v: number) => `${v.toFixed(2).replace(/\.?0+$/, '')}×`;

  return (
    <aside className="sheet" role="dialog" aria-modal="false" aria-labelledby="settings-title">
      <div className="sheet__head">
        <h2 id="settings-title" ref={headRef} tabIndex={-1}>
          Configurações
        </h2>
        <button className="icon-btn" onClick={onClose} aria-label="Fechar configurações">
          <IconClose />
        </button>
      </div>

      <section className="sheet__section">
        <h3>Seu perfil</h3>
        {profile.location && !editingCity ? (
          <div className="row">
            <span>
              {profile.location.name}
              {profile.location.admin1Name ? `, ${profile.location.admin1Name}` : ''} — {profile.location.countryName}
            </span>
            <span className="row__actions">
              <button className="link-btn" onClick={() => setEditingCity(true)}>
                Alterar cidade
              </button>
            </span>
          </div>
        ) : (
          <CitySearch
            onPick={(loc) => {
              onProfileChange({ ...profile, location: loc, locationSource: 'manual' });
              setEditingCity(false);
            }}
          />
        )}
        {account && (
          <button className="link-btn" onClick={onEditAnswers}>
            Refazer as perguntas (interesses, futebol, rotina, trabalho, lugares)
          </button>
        )}
        <p className="hint">
          {account
            ? 'Suas respostas ficam na sua conta e servem só para estimar o impacto; o cálculo acontece neste navegador.'
            : 'Modo de teste: perfil guardado só neste navegador.'}
        </p>
      </section>

      <section className="sheet__section">
        <h3>Areia</h3>
        <div className="segmented" role="radiogroup" aria-label="Densidade visual">
          {(['low', 'normal', 'high'] as const).map((d) => (
            <button key={d} role="radio" aria-checked={prefs.density === d} className={prefs.density === d ? 'is-on' : ''} onClick={() => onChange({ density: d })}>
              {d === 'low' ? 'Leve' : d === 'normal' ? 'Normal' : 'Densa'}
            </button>
          ))}
        </div>
        <Range label="Velocidade" value={prefs.speed} min={0.25} max={2} step={0.05} onChange={(v) => onChange({ speed: v })} format={x} />
        <Range label="Gravidade" value={prefs.gravity} min={0.4} max={2} step={0.05} onChange={(v) => onChange({ gravity: v })} format={x} />
        <Range label="Tamanho dos grãos" value={prefs.sizeScale} min={0.6} max={1.6} step={0.05} onChange={(v) => onChange({ sizeScale: v })} format={x} />
      </section>

      <section className="sheet__section">
        <h3>Movimento e interface</h3>
        <div className="segmented" role="radiogroup" aria-label="Tema">
          {(['auto', 'light', 'dark'] as const).map((t) => (
            <button key={t} role="radio" aria-checked={prefs.theme === t} className={prefs.theme === t ? 'is-on' : ''} onClick={() => onChange({ theme: t })}>
              {t === 'auto' ? 'Tema: sistema' : t === 'light' ? 'Claro' : 'Escuro'}
            </button>
          ))}
        </div>
        <div className="segmented" role="radiogroup" aria-label="Reduzir movimento">
          {(['auto', 'on', 'off'] as const).map((m) => (
            <button key={m} role="radio" aria-checked={prefs.reducedMotion === m} className={prefs.reducedMotion === m ? 'is-on' : ''} onClick={() => onChange({ reducedMotion: m })}>
              {m === 'auto' ? 'Movimento: sistema' : m === 'on' ? 'Reduzido' : 'Completo'}
            </button>
          ))}
        </div>
        <Toggle label="Modo ambiente" hint="Os controles somem após alguns segundos sem uso." checked={prefs.ambient} onChange={(v) => onChange({ ambient: v })} />
        <Toggle label="Mapa ao fundo" hint="Silhueta do mundo, em traço fino, atrás da areia." checked={prefs.showMap} onChange={(v) => onChange({ showMap: v })} />
        <Toggle label="Mostrar indicadores" checked={prefs.showIndicators} onChange={(v) => onChange({ showIndicators: v })} />
        <Toggle label="Avisos de situações críticas" hint="Uma linha discreta no topo quando houver risco imediato perto de você." checked={prefs.criticalAlerts} onChange={(v) => onChange({ criticalAlerts: v })} />
        <Toggle label="Som" hint="Um toque quase inaudível quando grãos maiores assentam." checked={prefs.sound} onChange={(v) => onChange({ sound: v })} />
      </section>

      {account && <AccountSection account={account} />}

      <section className="sheet__section">
        <h3>Privacidade</h3>
        <button className="link-btn" onClick={onPrivacy}>
          Como o SAND usa seus dados
        </button>
        {confirmClear ? (
          <div className="row">
            <span>Apagar cidade, interesses e preferências deste navegador?</span>
            <span className="row__actions">
              <button className="link-btn" onClick={onClearAll}>
                Apagar
              </button>
              <button className="link-btn" onClick={() => setConfirmClear(false)}>
                Cancelar
              </button>
            </span>
          </div>
        ) : (
          <button className="link-btn" onClick={() => setConfirmClear(true)}>
            Limpar preferências locais
          </button>
        )}
      </section>
    </aside>
  );
}
