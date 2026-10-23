import type { UserLocation } from '../../shared/types';
import { CitySearch } from './CitySearch';

interface Props {
  onPick: (loc: UserLocation) => void;
  onSkip: () => void;
}

/** First visit: only the city is asked for. Everything else is optional. */
export function Onboarding({ onPick, onSkip }: Props) {
  return (
    <div className="onboarding" role="dialog" aria-modal="true" aria-labelledby="onb-title">
      <div className="onboarding__inner">
        <p className="onboarding__brand">SAND</p>
        <h1 id="onb-title" className="onboarding__title">
          Notícias reais caem como areia.
        </h1>
        <p className="onboarding__text">O tamanho de cada grão estima o impacto potencial do acontecimento na sua vida. Para isso, diga apenas onde você mora.</p>
        <CitySearch onPick={onPick} autoFocus />
        <p className="hint">Sem GPS. A cidade fica só neste navegador e pode ser apagada a qualquer momento.</p>
        <button className="link-btn" onClick={onSkip}>
          Continuar sem localização
        </button>
      </div>
    </div>
  );
}
