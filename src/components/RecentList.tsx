import { useEffect, useMemo, useRef, useState } from 'react';
import { scoreToRadius } from '../../shared/impact/radius';
import type { SandStore, UiState } from '../state/store';
import { formatRelative } from '../utils/format';
import { IconClose } from './icons';

interface Props {
  store: SandStore;
  ui: UiState;
  viewed?: Set<string>;
  savedIds?: Set<string>;
  onOpen: (eventId: string) => void;
  onClose: () => void;
}

/** On-demand list: the keyboard-accessible way to reach every grain. */
export function RecentList({ store, ui, viewed, savedIds, onOpen, onClose }: Props) {
  const [order, setOrder] = useState<'time' | 'impact'>('time');
  const headRef = useRef<HTMLHeadingElement>(null);
  useEffect(() => headRef.current?.focus(), []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const items = useMemo(() => {
    const arr = [...store.events.values()].map((e) => ({ e, i: store.impacts.get(e.id)! })).filter((x) => x.i);
    arr.sort((a, b) => (order === 'time' ? Date.parse(b.e.publishedAt ?? b.e.firstSeenAt) - Date.parse(a.e.publishedAt ?? a.e.firstSeenAt) : b.i.score - a.i.score));
    return arr.slice(0, 150);
    // ui.version: recompute when the store changes
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [store, order, ui.version]);

  return (
    <aside className="sheet" role="dialog" aria-modal="false" aria-labelledby="recent-title">
      <div className="sheet__head">
        <h2 id="recent-title" ref={headRef} tabIndex={-1}>
          Notícias recentes
        </h2>
        <button className="icon-btn" onClick={onClose} aria-label="Fechar lista">
          <IconClose />
        </button>
      </div>
      <div className="segmented segmented--small" role="radiogroup" aria-label="Ordenar">
        <button role="radio" aria-checked={order === 'time'} className={order === 'time' ? 'is-on' : ''} onClick={() => setOrder('time')}>
          Mais recentes
        </button>
        <button role="radio" aria-checked={order === 'impact'} className={order === 'impact' ? 'is-on' : ''} onClick={() => setOrder('impact')}>
          Maior impacto
        </button>
      </div>
      {items.length === 0 ? (
        <p className="hint">Nenhuma notícia recebida ainda.</p>
      ) : (
        <ul className="recent">
          {items.map(({ e, i }) => {
            const r = Math.max(1.5, scoreToRadius(i.score) / 5);
            const seen = viewed?.has(e.id) ?? false;
            const fresh = !seen && Date.now() - Date.parse(e.publishedAt ?? e.firstSeenAt) < 60 * 60_000;
            return (
              <li key={e.id} className={seen ? 'is-seen' : fresh ? 'is-fresh' : ''}>
                <button onClick={() => onOpen(e.id)}>
                  <span className="recent__dot" aria-hidden="true">
                    <span style={{ width: r * 2, height: r * 2 }} />
                  </span>
                  <span className="recent__text">
                    <span className="recent__title">{e.title}</span>
                    <span className="recent__meta">
                      {fresh ? 'nova · ' : ''}
                      {e.sourceName} · {formatRelative(e.publishedAt ?? e.firstSeenAt)} · impacto {i.score}
                      {seen ? ' · vista' : ''}
                      {savedIds?.has(e.id) ? ' · salva' : ''}
                      {e.demo ? ' · DEMO' : ''}
                    </span>
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </aside>
  );
}
