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
            <strong>Conta:</strong> o login é feito pelo Firebase Authentication (Google), que guarda seu e-mail e um <em>hash</em> da senha (a senha em si nunca é armazenada). Suas respostas, notícias salvas e vistas ficam no Firestore, acessíveis só pela sua conta.
          </li>
          <li>
            <strong>Suas respostas</strong> (cidade, interesses, futebol, rotina, trabalho e finanças, outros lugares, temas a evitar) ficam na sua conta e servem só para estimar o impacto das notícias para você. Todas são opcionais, exceto a cidade.
          </li>
          <li>
            <strong>O cálculo de impacto acontece no seu navegador.</strong> O servidor envia as mesmas notícias para todos e não usa suas respostas para nada além de devolvê-las a você.
          </li>
          <li>
            <strong>Localização:</strong> guardamos só a cidade e o centro aproximado dela (precisão de ~11 km). Se você usar o GPS, a posição é arredondada no seu navegador antes de sair dele; o servidor consulta o OpenStreetMap (Nominatim) para descobrir a cidade. A busca por nome usa o Open-Meteo.
          </li>
          <li>
            <strong>Notícias vistas e salvas:</strong> ficam na sua conta. As marcas de “vista” somem junto com as notícias (~96 h); as salvas guardam título, fonte, link e data até você removê-las.
          </li>
          <li>
            <strong>Feedback “relevante / não relevante”:</strong> ajusta suas estimativas futuras; ao servidor de notícias vai só uma contagem anônima por notícia.
          </li>
          <li>
            <strong>Sem anúncios, analytics ou rastreadores.</strong> Links para matérias abrem o site original, que tem sua própria política.
          </li>
          <li>
            <strong>Retenção:</strong> notícias ficam ~48 horas no servidor. Sua conta fica até você excluí-la em Configurações → Conta → Excluir conta, o que apaga tudo imediatamente.
          </li>
        </ul>
        <p className="hint">Preferências visuais (velocidade, mapa, som etc.) ficam só neste navegador e podem ser apagadas em Configurações → Limpar preferências locais.</p>
      </div>
    </div>
  );
}
