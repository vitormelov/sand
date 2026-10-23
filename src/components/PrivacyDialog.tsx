import { useEffect, useRef } from 'react';
import { IconClose } from './icons';

export function PrivacyDialog({ onClose }: { onClose: () => void }) {
  const ref = useRef<HTMLHeadingElement>(null);
  useEffect(() => ref.current?.focus(), []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div className="modal" role="dialog" aria-modal="true" aria-labelledby="privacy-title" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal__inner">
        <div className="sheet__head">
          <h2 id="privacy-title" ref={ref} tabIndex={-1}>
            Privacidade
          </h2>
          <button className="icon-btn" onClick={onClose} aria-label="Fechar">
            <IconClose />
          </button>
        </div>
        <ul className="plain-list privacy">
          <li>
            <strong>Sua cidade e seus interesses ficam neste navegador</strong> (localStorage). O cálculo de impacto acontece aqui, no seu dispositivo; o servidor envia as mesmas notícias para todos.
          </li>
          <li>
            <strong>Sem GPS.</strong> Guardamos só o nome da cidade e o centro aproximado dela (precisão de ~11 km).
          </li>
          <li>
            <strong>Busca de cidade:</strong> o texto digitado é enviado ao servidor do SAND, que consulta o serviço de geocodificação Open-Meteo. Nada mais é enviado.
          </li>
          <li>
            <strong>Feedback “relevante / não relevante”:</strong> fica salvo neste navegador para ajustar estimativas futuras. Ao servidor vai apenas a contagem anônima por notícia.
          </li>
          <li>
            <strong>Sem contas, anúncios, analytics ou rastreadores.</strong> Links para matérias abrem o site original, que tem sua própria política.
          </li>
          <li>
            <strong>Retenção:</strong> notícias são mantidas no servidor por cerca de 48 horas e depois apagadas.
          </li>
          <li>
            <strong>Fontes:</strong> feeds públicos (Agência Brasil, g1, BBC, DW, The Guardian), dados oficiais (USGS, GDACS, INMET) e, se configurados, GDELT/NewsAPI. Estimativas de impacto são automáticas e podem errar.
          </li>
        </ul>
        <p className="hint">Você pode apagar tudo em Configurações → Limpar preferências locais.</p>
      </div>
    </div>
  );
}
