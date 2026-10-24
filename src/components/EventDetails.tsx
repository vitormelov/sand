import { useEffect, useRef, useState } from 'react';
import { categoryLabel, confidenceLabel, type ImpactResult } from '../../shared/impact/engine';
import type { NewsEvent, RelationKind } from '../../shared/types';
import { safeExternalUrl } from '../services/api';
import type { FeedbackValue } from '../services/storage';
import { formatWhen, hostOf } from '../utils/format';
import { IconBookmark, IconClose, IconExternal } from './icons';

interface Props {
  event: NewsEvent;
  impact: ImpactResult;
  feedback?: FeedbackValue;
  saved?: boolean;
  onToggleSave?: () => void;
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

/** Hover preview: source and headline only. Shares the fixed central slot with the full panel. */
export function EventPreview({ event, impact, seen }: { event: NewsEvent; impact?: ImpactResult; seen?: boolean }) {
  const fresh = !seen && Date.now() - Date.parse(event.publishedAt ?? event.firstSeenAt) < 60 * 60_000;
  return (
    <div className="details details--preview" aria-hidden="true">
      <span className="details__source">
        {event.sourceName}
        {impact ? ` · impacto ${impact.score}` : ''}
        {seen ? ' · vista' : fresh ? ' · nova' : ''}
        {event.demo ? ' · DEMO (fictício)' : ''}
      </span>
      <p className="details__title">{event.title}</p>
      <span className="details__hint">clique no grão para abrir</span>
    </div>
  );
}

/**
 * Pinned panel in a fixed central slot, always fully on screen (bottom sheet on
 * narrow screens). A thin leader line connects it to its grain.
 * All text from sources is rendered as plain text — never as HTML.
 */
export function EventDetails({ event, impact, feedback, saved, onToggleSave, relatedTitle, onFeedback, onClose, onOpenRelated }: Props) {
  const titleRef = useRef<HTMLHeadingElement>(null);
  const [showFactors, setShowFactors] = useState(false);

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

  return (
    <aside
      className="details details--full"
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
          {onToggleSave && (
            <button className={`chip chip--save ${saved ? 'chip--on' : ''}`} aria-pressed={!!saved} onClick={onToggleSave}>
              <IconBookmark filled={!!saved} /> {saved ? 'Salva' : 'Salvar'}
            </button>
          )}
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
