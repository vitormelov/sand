import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { categoryLabel, confidenceLabel, type ImpactResult } from '../../shared/impact/engine';
import type { NewsEvent, RelationKind } from '../../shared/types';
import { safeExternalUrl } from '../services/api';
import type { FeedbackValue } from '../services/storage';
import { formatWhen, hostOf } from '../utils/format';
import { IconClose, IconExternal } from './icons';

interface Props {
  event: NewsEvent;
  impact: ImpactResult;
  anchor?: { x: number; y: number; r: number };
  feedback?: FeedbackValue;
  relatedTitle: (id: string) => string | undefined;
  onFeedback: (v: FeedbackValue) => void;
  onClose: () => void;
  onOpenRelated: (id: string) => void;
}

const RELATION_LABEL: Record<RelationKind, string> = {
  documented: 'relação documentada',
  probable: 'relação provável',
  possible: 'relação possível (não confirmada)',
  unconfirmed: 'relação não confirmada',
};

const VERIFICATION_LABEL = {
  official: 'fonte oficial',
  corroborated: 'mais de uma fonte',
  single_source: 'uma fonte',
} as const;

const PANEL_W = 340;

/**
 * Discreet panel next to the clicked grain (bottom sheet on narrow screens).
 * All text from sources is rendered as plain text — never as HTML.
 */
export function EventDetails({ event, impact, anchor, feedback, relatedTitle, onFeedback, onClose, onOpenRelated }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const titleRef = useRef<HTMLHeadingElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  const [showFactors, setShowFactors] = useState(false);

  useLayoutEffect(() => {
    if (!ref.current) return;
    if (window.innerWidth < 640 || !anchor) {
      setPos(null);
      return;
    }
    const h = ref.current.offsetHeight;
    const gap = 18 + anchor.r;
    let left = anchor.x + gap;
    if (left + PANEL_W > window.innerWidth - 16) left = anchor.x - gap - PANEL_W;
    left = Math.max(16, Math.min(left, window.innerWidth - PANEL_W - 16));
    const top = Math.max(56, Math.min(anchor.y - h / 2, window.innerHeight - h - 40));
    setPos({ left, top });
  }, [anchor, event.id, showFactors]);

  useEffect(() => {
    titleRef.current?.focus();
  }, [event.id]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const url = safeExternalUrl(event.url);
  const place = event.analysis.locations[0];
  const placeText = place ? place.name : 'local não identificado';
  const sheet = pos == null;

  return (
    <aside
      ref={ref}
      className={`details ${sheet ? 'details--sheet' : ''}`}
      style={pos ? { left: pos.left, top: pos.top, width: PANEL_W } : undefined}
      role="dialog"
      aria-modal="false"
      aria-labelledby="details-title"
    >
      <div className="details__head">
        <span className="details__source">
          {event.sourceName}
          {event.sources.length > 1 ? ` +${event.sources.length - 1}` : ''}
          {event.demo ? ' · DEMO (fictício)' : ''}
        </span>
        <button className="icon-btn" onClick={onClose} aria-label="Fechar detalhes">
          <IconClose />
        </button>
      </div>

      <h2 id="details-title" ref={titleRef} tabIndex={-1} className="details__title">
        {event.title}
      </h2>
      {event.summary && <p className="details__summary">{event.summary}</p>}

      <dl className="details__meta">
        <div>
          <dt>Local</dt>
          <dd>{placeText}</dd>
        </div>
        {event.occurredAt && (
          <div>
            <dt>Ocorreu</dt>
            <dd>{formatWhen(event.occurredAt)}</dd>
          </div>
        )}
        <div>
          <dt>Publicado</dt>
          <dd>{formatWhen(event.publishedAt)}</dd>
        </div>
        <div>
          <dt>Recebido</dt>
          <dd>{formatWhen(event.firstSeenAt)}</dd>
        </div>
        {event.updatedAt !== event.firstSeenAt && (
          <div>
            <dt>Atualizado</dt>
            <dd>{formatWhen(event.updatedAt)}</dd>
          </div>
        )}
        <div>
          <dt>Verificação</dt>
          <dd>{VERIFICATION_LABEL[event.verification]}</dd>
        </div>
      </dl>

      <div className="details__impact">
        <div className="impact-score" aria-label={`Impacto estimado ${impact.score} de 100, ${impact.bandLabel}`}>
          <span className="impact-score__n">{impact.score}</span>
          <span className="impact-score__l">
            impacto estimado · {impact.bandLabel}
            <br />
            confiança {confidenceLabel(impact.confidence)} ({Math.round(impact.confidence * 100)}%)
          </span>
        </div>
        <p className="details__why">{impact.explanation}</p>
        <button className="link-btn" onClick={() => setShowFactors((v) => !v)} aria-expanded={showFactors}>
          {showFactors ? 'Ocultar fatores' : 'Ver fatores'}
        </button>
        {showFactors && (
          <ul className="factors">
            {impact.factors.map((f) => (
              <li key={f.key}>
                <span className="factors__label">{f.label}</span>
                <span className="factors__bar" aria-hidden="true">
                  <span style={{ width: `${Math.round(f.value * 100)}%` }} />
                </span>
                <span className="factors__pts">{f.points.toFixed(0)}</span>
                <span className="factors__detail">{f.detail}</span>
              </li>
            ))}
            {impact.rules.map((r) => (
              <li key={r} className="factors__rule">
                {r}
              </li>
            ))}
            <li className="factors__rule">Categorias: {event.analysis.categories.map(categoryLabel).join(', ')}</li>
          </ul>
        )}
      </div>

      {event.developments.length > 0 && (
        <div className="details__section">
          <h3>Desdobramentos</h3>
          <ul className="plain-list">
            {event.developments.slice(-3).map((d) => (
              <li key={d.id}>
                <a href={safeExternalUrl(d.url)} target="_blank" rel="noopener noreferrer">
                  {d.title}
                </a>{' '}
                <span className="muted">— {d.reason}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {event.relations.length > 0 && (
        <div className="details__section">
          <h3>Possíveis conexões</h3>
          <ul className="plain-list">
            {event.relations.map((r) => {
              const t = relatedTitle(r.eventId);
              if (!t) return null;
              return (
                <li key={r.eventId}>
                  <button className="link-btn link-btn--inline" onClick={() => onOpenRelated(r.eventId)}>
                    {t}
                  </button>
                  <span className="muted"> — {RELATION_LABEL[r.kind]}: {r.explanation}</span>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      <div className="details__actions">
        {url ? (
          <a className="btn" href={url} target="_blank" rel="noopener noreferrer">
            Abrir matéria original <IconExternal />
            <span className="sr-only"> (abre em nova aba, {hostOf(url)})</span>
          </a>
        ) : (
          <span className="muted">Link indisponível</span>
        )}
        <div className="feedback" role="group" aria-label="Esta notícia foi relevante para você?">
          <button className={`chip ${feedback === 'relevant' ? 'chip--on' : ''}`} aria-pressed={feedback === 'relevant'} onClick={() => onFeedback('relevant')}>
            Relevante
          </button>
          <button className={`chip ${feedback === 'not_relevant' ? 'chip--on' : ''}`} aria-pressed={feedback === 'not_relevant'} onClick={() => onFeedback('not_relevant')}>
            Não relevante
          </button>
        </div>
      </div>
    </aside>
  );
}
