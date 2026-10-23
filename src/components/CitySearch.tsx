import { useEffect, useId, useRef, useState } from 'react';
import type { UserLocation } from '../../shared/types';
import { searchCities } from '../services/api';

interface Props {
  onPick: (loc: UserLocation) => void;
  autoFocus?: boolean;
}

/** City search (no GPS). Queries go to SAND's own server, which proxies the geocoder. */
export function CitySearch({ onPick, autoFocus }: Props) {
  const [q, setQ] = useState('');
  const [found, setFound] = useState<{ q: string; results: UserLocation[] }>({ q: '', results: [] });
  const [state, setState] = useState<'idle' | 'loading' | 'error' | 'empty'>('idle');
  const [active, setActive] = useState(0);
  const listId = useId();
  const abort = useRef<AbortController>();

  useEffect(() => {
    const query = q.trim();
    if (query.length < 2) {
      setFound({ q: '', results: [] });
      setState('idle');
      return;
    }
    const t = setTimeout(async () => {
      abort.current?.abort();
      const ac = new AbortController();
      abort.current = ac;
      setState('loading');
      try {
        const r = await searchCities(query, ac.signal);
        setFound({ q: query, results: r.results });
        setActive(0);
        setState(r.results.length ? 'idle' : 'empty');
      } catch (err) {
        if ((err as Error).name !== 'AbortError') setState('error');
      }
    }, 250);
    return () => clearTimeout(t);
  }, [q]);

  // Only results for the text currently typed are shown or selectable (never a stale list).
  const results = found.q === q.trim() ? found.results : [];

  const label = (r: UserLocation) => [r.name, r.admin1Name, r.countryName].filter(Boolean).join(', ');

  return (
    <div className="city-search">
      <input
        className="input"
        type="search"
        value={q}
        placeholder="Buscar cidade…"
        aria-label="Buscar cidade"
        role="combobox"
        aria-expanded={results.length > 0}
        aria-controls={listId}
        aria-autocomplete="list"
        autoFocus={autoFocus}
        autoComplete="off"
        onChange={(e) => setQ(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') {
            e.preventDefault();
            setActive((a) => Math.min(results.length - 1, a + 1));
          } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            setActive((a) => Math.max(0, a - 1));
          } else if (e.key === 'Enter' && results[active]) {
            e.preventDefault();
            onPick(results[active]);
          }
        }}
      />
      <div className="city-search__state" aria-live="polite">
        {(state === 'loading' || (q.trim().length >= 2 && found.q !== q.trim() && state !== 'error')) && 'Buscando…'}
        {state === 'empty' && 'Nenhuma cidade encontrada.'}
        {state === 'error' && 'Não foi possível buscar agora. Tente novamente.'}
      </div>
      {results.length > 0 && (
        <ul id={listId} className="city-search__list" role="listbox">
          {results.map((r, i) => (
            <li key={`${r.name}-${r.admin1Name}-${r.countryCode}-${i}`} role="option" aria-selected={i === active}>
              <button className={i === active ? 'is-active' : ''} onClick={() => onPick(r)} onMouseEnter={() => setActive(i)}>
                {label(r)}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
