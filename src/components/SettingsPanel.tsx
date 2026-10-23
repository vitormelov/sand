import { useEffect, useRef, useState } from 'react';
import { categoryLabel } from '../../shared/impact/engine';
import { CATEGORIES, type Category } from '../../shared/types';
import type { Prefs } from '../services/storage';
import { CitySearch } from './CitySearch';
import { IconClose } from './icons';

interface Props {
  prefs: Prefs;
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

export function SettingsPanel({ prefs, onChange, onClearAll, onClose, onPrivacy }: Props) {
  const [editingCity, setEditingCity] = useState(!prefs.location);
  const [confirmClear, setConfirmClear] = useState(false);
  const headRef = useRef<HTMLHeadingElement>(null);

  useEffect(() => headRef.current?.focus(), []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const toggleInterest = (c: Category) =>
    onChange({ interests: prefs.interests.includes(c) ? prefs.interests.filter((x) => x !== c) : [...prefs.interests, c] });
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
        <h3>Localização</h3>
        {prefs.location && !editingCity ? (
          <div className="row">
            <span>
              {prefs.location.name}
              {prefs.location.admin1Name ? `, ${prefs.location.admin1Name}` : ''} — {prefs.location.countryName}
            </span>
            <span className="row__actions">
              <button className="link-btn" onClick={() => setEditingCity(true)}>
                Alterar
              </button>
              <button className="link-btn" onClick={() => onChange({ location: undefined })}>
                Apagar
              </button>
            </span>
          </div>
        ) : (
          <CitySearch
            onPick={(loc) => {
              onChange({ location: loc, onboarded: true });
              setEditingCity(false);
            }}
          />
        )}
        <p className="hint">Usada só neste navegador para estimar o impacto. Não usamos GPS nem enviamos sua cidade ao servidor de notícias.</p>
      </section>

      <section className="sheet__section">
        <h3>Interesses (opcional)</h3>
        <div className="chips">
          {CATEGORIES.map((c) => (
            <button key={c} className={`chip ${prefs.interests.includes(c) ? 'chip--on' : ''}`} aria-pressed={prefs.interests.includes(c)} onClick={() => toggleInterest(c)}>
              {categoryLabel(c)}
            </button>
          ))}
        </div>
        <p className="hint">Interesses ajustam o tamanho, mas notícias de alto impacto continuam aparecendo mesmo fora deles.</p>
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
        <div className="segmented" role="radiogroup" aria-label="Reduzir movimento">
          {(['auto', 'on', 'off'] as const).map((m) => (
            <button key={m} role="radio" aria-checked={prefs.reducedMotion === m} className={prefs.reducedMotion === m ? 'is-on' : ''} onClick={() => onChange({ reducedMotion: m })}>
              {m === 'auto' ? 'Movimento: sistema' : m === 'on' ? 'Reduzido' : 'Completo'}
            </button>
          ))}
        </div>
        <Toggle label="Modo ambiente" hint="Os controles somem após alguns segundos sem uso." checked={prefs.ambient} onChange={(v) => onChange({ ambient: v })} />
        <Toggle label="Mostrar indicadores" checked={prefs.showIndicators} onChange={(v) => onChange({ showIndicators: v })} />
        <Toggle label="Avisos de situações críticas" hint="Uma linha discreta no topo quando houver risco imediato perto de você." checked={prefs.criticalAlerts} onChange={(v) => onChange({ criticalAlerts: v })} />
        <Toggle label="Som" hint="Um toque quase inaudível quando grãos maiores assentam." checked={prefs.sound} onChange={(v) => onChange({ sound: v })} />
      </section>

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
