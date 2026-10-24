import { useEffect, useRef } from 'react';
import type { SavedItem } from '../../shared/profile';
import { safeExternalUrl } from '../services/api';
import { formatWhen } from '../utils/format';
import { IconClose, IconExternal } from './icons';

interface Props {
  items: SavedItem[];
  isLive: (id: string) => boolean;
  onOpen: (id: string) => void;
  onRemove: (id: string) => void;
  onClose: () => void;
}

/** The user's saved news. Items outlive the sand: older ones open the original article. */
export function SavedList({ items, isLive, onOpen, onRemove, onClose }: Props) {
  const headRef = useRef<HTMLHeadingElement>(null);
  useEffect(() => headRef.current?.focus(), []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  const sorted = [...items].sort((a, b) => Date.parse(b.savedAt) - Date.parse(a.savedAt));

  return (
    <aside className="sheet" role="dialog" aria-modal="false" aria-labelledby="saved-title">
      <div className="sheet__head">
        <h2 id="saved-title" ref={headRef} tabIndex={-1}>
          Notícias salvas
        </h2>
        <button className="icon-btn" onClick={onClose} aria-label="Fechar notícias salvas">
          <IconClose />
        </button>
      </div>
      {sorted.length === 0 ? (
        <p className="hint">Nenhuma notícia salva ainda. Abra um grão e use “Salvar”.</p>
      ) : (
        <ul className="recent saved">
          {sorted.map((s) => {
            const live = isLive(s.id);
            const url = safeExternalUrl(s.url);
            return (
              <li key={s.id} className="saved__item">
                {live ? (
                  <button className="saved__open" onClick={() => onOpen(s.id)}>
                    <span className="recent__title">{s.title}</span>
                  </button>
                ) : (
                  <a className="saved__open" href={url} target="_blank" rel="noopener noreferrer">
                    <span className="recent__title">
                      {s.title} <IconExternal />
                    </span>
                  </a>
                )}
                <span className="recent__meta">
                  {s.sourceName} · salva {formatWhen(s.savedAt)}
                  {live ? '' : ' · já saiu da areia'}
                </span>
                <button className="link-btn saved__remove" onClick={() => onRemove(s.id)} aria-label={`Remover dos salvos: ${s.title}`}>
                  Remover
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </aside>
  );
}
