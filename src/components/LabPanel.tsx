import { useEffect, useRef, useState } from 'react';
import { IMPACT_BANDS } from '../../shared/impact/config';
import { scoreToRadius } from '../../shared/impact/radius';
import type { Analysis, GeoRef, NewsEvent, SourceKind } from '../../shared/types';
import type { SandSimulation, SimStats } from '../simulation/SandSimulation';
import type { SandStore } from '../state/store';

/**
 * Developer lab (/?lab). Everything created here is fictitious, flagged `demo`,
 * titled "[LAB]" and never mixed with the real stream (which is not connected).
 */

interface Props {
  store: SandStore;
  simRef: React.MutableRefObject<SandSimulation | null>;
  sizeScale: number;
}

let n = 0;
function labEvent(title: string, analysis: Partial<Analysis>, over: Partial<NewsEvent> = {}): NewsEvent {
  n++;
  const iso = new Date().toISOString();
  return {
    id: `ev_lab${Date.now().toString(36)}${n}`,
    seq: 0,
    title: `[LAB] ${title}`,
    summary: 'Evento fictício criado no laboratório de testes. Não é uma notícia real.',
    url: 'https://example.com/',
    sourceName: 'Laboratório',
    sourceKind: 'outlet',
    sourceReliability: 0.8,
    sourceCountry: 'BR',
    publishedAt: iso,
    firstSeenAt: iso,
    updatedAt: iso,
    expiresAt: new Date(Date.now() + 6 * 3_600_000).toISOString(),
    articleCount: 1,
    sources: ['Laboratório'],
    verification: 'single_source',
    relations: [],
    developments: [],
    demo: true,
    ...over,
    analysis: {
      categories: ['other'],
      channels: [],
      locations: [],
      affectedScope: 'local',
      severity: 0.15,
      severityEvidence: [],
      urgency: 0,
      hazard: false,
      entities: [],
      analyzer: 'rules',
      classificationConfidence: 0.7,
      ...analysis,
    },
  };
}

interface Scenario {
  label: string;
  build: (home: GeoRef) => { title: string; analysis: Partial<Analysis>; kind?: SourceKind };
}

/** Realistic scenarios scored by the real Personal Impact Engine with the current profile. */
const SCENARIOS: Scenario[] = [
  {
    label: 'Notícia leve (futebol local)',
    build: (home) => ({ title: `Time da cidade vence clássico em ${home.name}`, analysis: { categories: ['sports'], locations: [home], severity: 0.08 } }),
  },
  {
    label: 'Cultura no exterior',
    build: () => ({ title: 'Museu europeu reabre ala de pinturas', analysis: { categories: ['culture'], locations: [{ name: 'França', level: 'country', countryCode: 'FR', regions: ['europe'], confidence: 0.8, via: 'lab' }], severity: 0.05 } }),
  },
  {
    label: 'Trânsito na sua cidade',
    build: (home) => ({ title: `Obra interdita avenida central de ${home.name} por duas semanas`, analysis: { categories: ['mobility'], channels: [{ channel: 'mobility', strength: 0.75, evidence: ['interdita'] }], locations: [home], severity: 0.25 } }),
  },
  {
    label: 'Juros sobem no país (Selic)',
    build: () => ({ title: 'Banco Central eleva a taxa Selic em 1 ponto', analysis: { categories: ['economy'], channels: [{ channel: 'interest_credit', strength: 0.95, evidence: ['selic'] }, { channel: 'cost_of_living', strength: 0.6, evidence: ['juros'] }], locations: [{ name: 'Brasil', level: 'country', countryCode: 'BR', regions: ['south_america'], confidence: 0.8, via: 'lab' }], affectedScope: 'national', severity: 0.45 } }),
  },
  {
    label: 'Choque global do petróleo',
    build: () => ({ title: 'Petróleo dispara após bloqueio de rota marítima no Golfo', analysis: { categories: ['economy'], channels: [{ channel: 'energy_fuel', strength: 0.95, evidence: ['petroleo'] }, { channel: 'cost_of_living', strength: 0.6, evidence: [] }], locations: [{ name: 'Oriente Médio', level: 'world_region', regions: ['middle_east'], confidence: 0.7, via: 'lab' }], affectedScope: 'global', severity: 0.65, urgency: 0.6 } }),
  },
  {
    label: 'Terremoto forte no Japão',
    build: () => ({ title: 'Terremoto de magnitude 7,4 atinge o norte do Japão', analysis: { categories: ['climate'], channels: [{ channel: 'natural_hazard', strength: 1, evidence: ['terremoto'] }], locations: [{ name: 'Japão', level: 'country', countryCode: 'JP', regions: ['east_asia'], confidence: 0.9, via: 'lab' }], hazard: true, severity: 0.75, urgency: 0.7 }, kind: 'official' }),
  },
  {
    label: 'Alerta no seu estado',
    build: (home) => ({ title: `Alerta de tempestade para o interior do estado`, analysis: { categories: ['climate'], channels: [{ channel: 'natural_hazard', strength: 0.9, evidence: ['tempestade'] }], locations: [{ name: home.admin1 ?? 'estado', level: 'state', countryCode: home.countryCode, admin1: home.admin1, confidence: 0.8, via: 'lab' }], affectedScope: 'state', hazard: true, severity: 0.65, urgency: 0.7 }, kind: 'official' }),
  },
  {
    label: 'Emergência na sua cidade',
    build: (home) => ({ title: `Enchente atinge bairros de ${home.name}; Defesa Civil pede evacuação`, analysis: { categories: ['climate'], channels: [{ channel: 'natural_hazard', strength: 1, evidence: ['enchente'] }, { channel: 'infrastructure', strength: 0.7, evidence: [] }], locations: [home], hazard: true, severity: 0.9, urgency: 1, severityEvidence: ['evacuação'] }, kind: 'official' }),
  },
];

const RULER = [0, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100];
const skewedScore = () => Math.min(100, Math.round(-Math.log(1 - Math.random()) * 22));

export function LabPanel({ store, simRef, sizeScale }: Props) {
  const [open, setOpen] = useState(true);
  const [score, setScore] = useState(85);
  const [count, setCount] = useState(1);
  const [paused, setPaused] = useState(false);
  const [rain, setRain] = useState(false);
  const [stats, setStats] = useState<SimStats | null>(null);
  const [log, setLog] = useState<{ label: string; score: number; band: string }[]>([]);
  const rainTimer = useRef<ReturnType<typeof setInterval>>();

  const loc = store.getProfile().location;
  const home: GeoRef = loc
    ? { name: loc.name, level: 'city', countryCode: loc.countryCode, admin1: loc.admin1, lat: loc.lat, lon: loc.lon, confidence: 0.9, via: 'lab' }
    : { name: 'Fortaleza', level: 'city', countryCode: 'BR', admin1: 'CE', lat: -3.73, lon: -38.53, confidence: 0.9, via: 'lab' };

  useEffect(() => {
    const t = setInterval(() => setStats(simRef.current?.stats() ?? null), 500);
    return () => clearInterval(t);
  }, [simRef]);

  useEffect(() => {
    clearInterval(rainTimer.current);
    if (rain) rainTimer.current = setInterval(() => store.injectLab(labEvent(`Grão aleatório`, {}), { forcedScore: skewedScore() }), 450);
    return () => clearInterval(rainTimer.current);
  }, [rain, store]);

  const drop = (s: number, x?: number) => store.injectLab(labEvent(`Grão de impacto ${s}`, {}), { forcedScore: s, x });

  if (!open) {
    return (
      <button className="lab-toggle" onClick={() => setOpen(true)}>
        LAB
      </button>
    );
  }

  return (
    <aside className="lab" aria-label="Laboratório de testes">
      <div className="lab__head">
        <strong>Laboratório</strong>
        <span className="lab__warn">dados fictícios · fontes reais desconectadas</span>
        <button className="link-btn" onClick={() => setOpen(false)}>
          recolher
        </button>
      </div>

      <section>
        <h3>Régua de tamanhos</h3>
        <div className="lab-ruler" aria-hidden="true">
          {RULER.map((s) => {
            const r = scoreToRadius(s, sizeScale);
            return (
              <div key={s} className="lab-ruler__item">
                <span className="lab-ruler__dot" style={{ width: r * 2, height: r * 2 }} />
                <span>{s}</span>
                <small>{r.toFixed(1)}px</small>
              </div>
            );
          })}
        </div>
        <p className="lab__bands">
          {IMPACT_BANDS.map((b, i) => `${i ? IMPACT_BANDS[i - 1].max : 0}–${Math.min(100, b.max - 1)} ${b.label}`).join(' · ')}
        </p>
        <button
          className="chip"
          onClick={() => {
            // Spread across the visible sand, to the right of this panel on wide screens.
            const start = window.innerWidth > 700 ? (340 + 24) / window.innerWidth : 0.06;
            RULER.forEach((s, i) => drop(s, start + (i / (RULER.length - 1)) * (0.94 - start)));
          }}
        >
          Soltar a régua na areia
        </button>
      </section>

      <section>
        <h3>Idade das notícias</h3>
        <p className="hint">Mais novas em preto; com o tempo clareiam até sumir ao fim das 48 h.</p>
        <button
          className="chip"
          onClick={() => {
            const start = window.innerWidth > 700 ? (340 + 24) / window.innerWidth : 0.06;
            const ages = [0, 6, 12, 18, 24, 30, 36, 42];
            ages.forEach((h, i) => {
              const published = Date.now() - h * 3_600_000;
              store.injectLab(
                labEvent(`Notícia de ${h} h atrás`, {}, {
                  publishedAt: new Date(published).toISOString(),
                  firstSeenAt: new Date(published).toISOString(),
                  expiresAt: new Date(published + 48 * 3_600_000).toISOString(),
                }),
                { forcedScore: 60, x: start + (i / (ages.length - 1)) * (0.94 - start) },
              );
            });
          }}
        >
          Soltar grãos de 0 a 42 h
        </button>
      </section>

      <section>
        <h3>Grão com impacto escolhido</h3>
        <label className="range">
          <span>Impacto</span>
          <input type="range" min={0} max={100} value={score} onChange={(e) => setScore(Number(e.target.value))} />
          <output>{score}</output>
        </label>
        <label className="range">
          <span>Quantidade</span>
          <input type="range" min={1} max={50} value={count} onChange={(e) => setCount(Number(e.target.value))} />
          <output>{count}</output>
        </label>
        <button className="chip" onClick={() => Array.from({ length: count }, () => drop(score))}>
          Soltar {count > 1 ? `${count} grãos` : 'grão'} ({score >= 80 ? 'crítico, com halo' : `raio ${scoreToRadius(score, sizeScale).toFixed(1)}px`})
        </button>
      </section>

      <section>
        <h3>Cenários (motor de impacto real)</h3>
        <p className="hint">Calculados com o seu perfil ({home.name}). Clique no grão para ver os fatores.</p>
        <div className="chips">
          {SCENARIOS.map((sc) => (
            <button
              key={sc.label}
              className="chip"
              onClick={() => {
                const b = sc.build(home);
                const r = store.injectLab(labEvent(b.title, b.analysis, b.kind ? { sourceKind: b.kind, verification: b.kind === 'official' ? 'official' : 'single_source', sourceReliability: 0.92 } : {}));
                setLog((l) => [{ label: sc.label, score: r.score, band: r.bandLabel }, ...l].slice(0, 8));
              }}
            >
              {sc.label}
            </button>
          ))}
        </div>
        {log.length > 0 && (
          <ul className="lab__log">
            {log.map((l, i) => (
              <li key={i}>
                <span>{l.label}</span>
                <strong>{l.score}</strong> <small>{l.band}</small>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <h3>Chuva e simulação</h3>
        <div className="chips">
          <button className="chip" onClick={() => Array.from({ length: 40 }, () => drop(skewedScore()))}>
            Rajada de 40
          </button>
          <button className={`chip ${rain ? 'chip--on' : ''}`} aria-pressed={rain} onClick={() => setRain((v) => !v)}>
            Chuva contínua
          </button>
          <button
            className={`chip ${paused ? 'chip--on' : ''}`}
            aria-pressed={paused}
            onClick={() => {
              simRef.current?.setPaused(!paused);
              setPaused(!paused);
            }}
          >
            {paused ? 'Retomar física' : 'Pausar física'}
          </button>
          <button
            className="chip"
            onClick={() => {
              setRain(false);
              simRef.current?.clear();
              store.clearAll();
              setLog([]);
            }}
          >
            Limpar areia
          </button>
        </div>
        <p className="hint">Velocidade, gravidade, tamanho geral e movimento reduzido ficam em Configurações.</p>
        {stats && (
          <dl className="lab__stats">
            <div>
              <dt>fps</dt>
              <dd>{stats.fps}</dd>
            </div>
            <div>
              <dt>quadro</dt>
              <dd>{stats.frameMs} ms</dd>
            </div>
            <div>
              <dt>caindo</dt>
              <dd>{stats.actives}</dd>
            </div>
            <div>
              <dt>depositados</dt>
              <dd>{stats.statics}</dd>
            </div>
            <div>
              <dt>na fila</dt>
              <dd>{stats.queued}</dd>
            </div>
          </dl>
        )}
      </section>
    </aside>
  );
}
