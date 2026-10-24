import { useEffect, useRef, useState } from 'react';
import type { StoredProfile } from '../../shared/profile';
import { SOURCE_GROUPS, type SourceGroup, type SourceKind, type SourceStatus } from '../../shared/types';
import type { AccountProps } from '../App';
import { ApiError, changePassword, deleteAccount, ERROR_TEXT } from '../services/account';
import type { Prefs } from '../services/storage';
import { CitySearch } from './CitySearch';
import { IconClose } from './icons';

interface Props {
  prefs: Prefs;
  profile: StoredProfile;
  /** Every source the server knows, with its current health. */
  sources?: SourceStatus[];
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

function Toggle(props: { label: string; hint?: string; checked: boolean; disabled?: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className={props.disabled ? 'toggle is-disabled' : 'toggle'}>
      <span>
        {props.label}
        {props.hint && <small>{props.hint}</small>}
      </span>
      <input type="checkbox" role="switch" checked={props.checked} disabled={props.disabled} onChange={(e) => props.onChange(e.target.checked)} />
    </label>
  );
}

const KIND_LABEL: Record<SourceKind, string> = {
  official: 'Órgão oficial',
  agency: 'Agência de notícias',
  outlet: 'Veículo de imprensa',
  aggregator: 'Agregador',
};

const GROUP_LABEL: Record<SourceGroup, string> = {
  national: 'Nacionais',
  regional: 'Regionais (por estado)',
  official: 'Órgãos oficiais',
  alerts: 'Alertas e monitoramento',
  climate: 'Clima e meio ambiente',
  economy: 'Economia',
  sports: 'Esporte',
  international: 'Internacionais',
  aggregators: 'Agregadores',
};

function sourceHint(s: SourceStatus): string {
  const kind = `${KIND_LABEL[s.kind]}${s.paywall ? ' · pode exigir assinatura' : ''}`;
  if (s.health === 'disabled') return `${kind} · desativada no servidor${s.note ? ` (${s.note})` : ''}`;
  if (s.health === 'down') return `${kind} · fora do ar no momento`;
  if (s.health === 'degraded') return `${kind} · instável`;
  if (s.health === 'pending') return `${kind} · aguardando a primeira leitura`;
  return kind;
}

/** Per-user on/off switch for each news source. */
function SourcesSection({ sources, hidden, onChange }: { sources?: SourceStatus[]; hidden: string[]; onChange: (hidden: string[]) => void }) {
  if (!sources?.length) {
    return (
      <section className="sheet__section">
        <h3>Fontes de notícias</h3>
        <p className="hint">A lista de fontes aparece quando a conexão com o servidor estiver aberta.</p>
      </section>
    );
  }
  const off = new Set(hidden);
  const usable = sources.filter((s) => s.health !== 'disabled');
  const allOff = usable.length > 0 && usable.every((s) => off.has(s.id));
  const groups = [...SOURCE_GROUPS, undefined]
    .map((g) => ({ group: g, list: sources.filter((s) => (s.group && SOURCE_GROUPS.includes(s.group) ? s.group : undefined) === g) }))
    .filter((g) => g.list.length > 0);
  const setGroup = (list: SourceStatus[], on: boolean) => {
    const ids = new Set(list.filter((s) => s.health !== 'disabled').map((s) => s.id));
    onChange(on ? hidden.filter((id) => !ids.has(id)) : [...new Set([...hidden, ...ids])]);
  };
  return (
    <section className="sheet__section">
      <h3>Fontes de notícias</h3>
      {groups.map(({ group, list }) => {
        const live = list.filter((s) => s.health !== 'disabled');
        const onCount = live.filter((s) => !off.has(s.id)).length;
        return (
          <details key={group ?? 'other'} className="source-group">
            <summary>
              <span>{group ? GROUP_LABEL[group] : 'Outras'}</span>
              <small>{live.length ? `${onCount} de ${live.length} ligada${live.length === 1 ? '' : 's'}` : 'desativadas no servidor'}</small>
            </summary>
            {live.length > 1 && (
              <div className="row__actions source-group__actions">
                <button className="link-btn" onClick={() => setGroup(list, true)} disabled={onCount === live.length}>
                  Ligar todas
                </button>
                <button className="link-btn" onClick={() => setGroup(list, false)} disabled={onCount === 0}>
                  Desligar todas
                </button>
              </div>
            )}
            {list.map((s) => (
              <Toggle
                key={s.id}
                label={s.name}
                hint={sourceHint(s)}
                checked={s.health !== 'disabled' && !off.has(s.id)}
                disabled={s.health === 'disabled'}
                onChange={(on) => onChange(on ? hidden.filter((id) => id !== s.id) : [...hidden, s.id])}
              />
            ))}
          </details>
        );
      })}
      {hidden.length > 0 && (
        <button className="link-btn" onClick={() => onChange([])}>
          Ligar todas as fontes
        </button>
      )}
      <p className="hint">
        {allOff
          ? 'Todas as fontes estão desligadas: nenhuma notícia nova vai cair.'
          : 'Uma notícia coberta por várias fontes continua aparecendo enquanto ao menos uma delas estiver ligada.'}
      </p>
    </section>
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

export function SettingsPanel({ prefs, profile, sources, account, onProfileChange, onEditAnswers, onChange, onClearAll, onClose, onPrivacy }: Props) {
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

      <SourcesSection sources={sources} hidden={profile.hiddenSources ?? []} onChange={(hiddenSources) => onProfileChange({ ...profile, hiddenSources })} />

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
