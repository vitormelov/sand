# Arquitetura

```
             ┌───────────────────────── servidor Node (um processo) ─────────────────────────┐
 fontes      │ sources/        normalization/   analysis/        clustering/      persistence/ │
 RSS ───────►│ conectores ───► modelo único ──► regras (+IA) ──► agrupamento ───► SQLite        │
 USGS/GDACS  │ (timeout,       (URL canônica,   (canais, local,  + relações       (eventos,     │
 INMET/GDELT │  ETag, backoff) texto puro,      severidade,      causais          artigos,      │
 NewsAPI     │                 datas)           escopo)                           estado)       │
             │       ingestion/scheduler (cada fonte falha sozinha)   streaming/sse ───────────────┼──► SSE
             └────────────────────────────────────────────────────────────────────────────────────┘
                                                                                                  │
             ┌───────────────────────────── navegador ──────────────────────────────────────────┐ │
             │ services/stream ──► state/store ──► Personal Impact Engine (shared/impact)  ◄────┘ │
             │  (reconexão,          (eventos,        perfil local: cidade + interesses           │
             │   Last-Event-ID)       impactos)              │                                    │
             │                           │ enqueue/update    ▼                                    │
             │                    simulation/SandSimulation (rAF próprio) ─► PhysicsEngine         │
             │                           │                                  ParticleRenderer       │
             │ React: TopBar · StatusBar · EventDetails · Settings · RecentList · Onboarding      │
             └────────────────────────────────────────────────────────────────────────────────────┘
```

## Responsabilidades

| Camada | Pasta | Notas |
|---|---|---|
| Conectores | `server/sources/` | `SourceConnector` com `fetch(ctx)`. HTTP com timeout, `If-None-Match`/`If-Modified-Since`, limite de tamanho, `Retry-After`. |
| Normalização | `server/normalization/` | URL canônica (remove rastreadores, `www.`, `m.`, `/amp`), HTML → texto puro, datas (RFC 822, ISO, GDELT) com rejeição de datas futuras. Distingue `occurredAt`, `publishedAt`, `fetchedAt`/`firstSeenAt`, `updatedAt`. |
| Análise | `server/analysis/` | Regras determinísticas pt/en/es: categorias, canais de consequência, locais (gazetteer com correspondência sensível a maiúsculas), severidade, urgência, escopo afetado. IA opcional (`llm.ts`) só para itens de baixa confiança; saída validada por schema e mesclada de forma conservadora. |
| Deduplicação e agrupamento | `server/clustering/` | Mesma URL → duplicado. Mesmo evento → identidade da fonte, manchete idêntica, pegada de risco (tipo + ponto + tempo, ou tipo + áreas), ou semelhança forte de manchete. Desdobramento material (mais mortes, gravidade maior, alerta elevado) → grão adicional menor. |
| Persistência | `server/persistence/store.ts` | `node:sqlite` (embutido no Node ≥ 22.13). Retenção: eventos expiram em `RETENTION_HOURS`; impressões digitais de artigos em 2×. |
| Distribuição | `server/streaming/sse.ts` | SSE: `snapshot`, `event` (com `id = seq`), `status`, `expire`; heartbeat 25 s; retomada por `Last-Event-ID`/`?since=`; limites globais e por IP. |
| Motor de impacto | `shared/impact/` | Puro, compartilhado; roda no navegador. |
| Simulação | `src/simulation/` | Independente do React. Ver [PERFORMANCE.md](PERFORMANCE.md). |
| Interface | `src/components/`, `src/App.tsx` | Estado por `useSyncExternalStore`, atualizações agrupadas; nada re-renderiza por quadro. |

## Modelo de dados

`NewsEvent` (`shared/types.ts`) é o evento consolidado; `Particle` (`src/simulation/Particle.ts`) é só a representação visual e carrega apenas `eventId`. Estados da partícula: `falling → deposited → removed` (afundou abaixo da borda). Quando um evento expira, seus grãos continuam como areia anônima (não clicáveis).

## Decisões

- **SSE em vez de WebSocket**: o fluxo é unidirecional; SSE reconecta sozinho e retoma com `Last-Event-ID`.
- **Impacto no cliente**: privacidade (a cidade não sai do navegador) e recálculo instantâneo ao trocar de cidade.
- **SQLite embutido**: zero dependência nativa; adequado a um único processo. Para vários servidores, trocar `Store` por PostgreSQL e o hub SSE por pub/sub.
- **Canvas 2D**: medido e suficiente (ver PERFORMANCE.md); WebGL não se justificou.
- **Regras antes de IA**: o produto funciona sem chave de API; a IA só complementa itens ambíguos e nunca recebe dados do usuário.

## Segurança

- Texto de fontes é sempre tratado como dado: nunca é inserido como HTML (React renderiza texto; `toPlainText` remove marcação no servidor), nunca é obedecido (prompt da IA delimita o artigo e a saída é restrita por schema).
- Apenas links `http(s)` chegam ao navegador; abrem com `rel="noopener noreferrer"`.
- CSP restritiva, `X-Frame-Options: DENY`, `nosniff`, `Referrer-Policy: no-referrer`, `Permissions-Policy` sem geolocalização.
- Limites de requisição por IP em `/api/*`, geocodificação e feedback; corpo de POST limitado a 2 KB; proteção contra path traversal nos estáticos.
- Chaves (NewsAPI, Anthropic) só no servidor, via variáveis de ambiente.
