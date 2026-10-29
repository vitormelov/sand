# Arquitetura

```
             ┌──────────── GitHub Actions (a cada ~5 min, scripts/ingest-once.ts) ────────────┐
 fontes      │ sources/        normalization/   analysis/        clustering/      persistence/ │
 RSS ───────►│ conectores ───► modelo único ──► regras (+IA) ──► agrupamento ───► SQLite em    │
 USGS/GDACS  │ (timeout,       (URL canônica,   (canais, local,  + relações       memória       │
 INMET/GDELT │  ETag, backoff) texto puro,      severidade,      causais          (restaurado   │
 NewsAPI     │                 datas)           escopo)                           a cada passada)│
             │   ingestion/scheduler.runDue (só fontes vencidas)   firebase/feedStore ────────────┼──► Firestore
             └────────────────────────────────────────────────────────────────────────────────────┘     │
                                                                                                         │
             ┌───────────────────────────── navegador ──────────────────────────────────────────┐       │
             │ services/stream (onSnapshot ──► diff) ──► state/store ──► Personal Impact Engine ◄┼───────┘
             │ services/account (Firebase Auth + users/{uid})   perfil: cidade + interesses       │
             │                           │ enqueue/update    ▼                                    │
             │                    simulation/SandSimulation (rAF próprio) ─► PhysicsEngine         │
             │                           │                                  ParticleRenderer       │
             │ React: TopBar · StatusBar · EventDetails · Settings · RecentList · Onboarding      │
             └────────────────────────────────────────────────────────────────────────────────────┘
             Vercel: site estático + /api/geocode e /api/geocode/reverse (server/http/geocodeApi.ts)
```

## Responsabilidades

| Camada | Pasta | Notas |
|---|---|---|
| Conectores | `server/sources/` | `SourceConnector` com `fetch(ctx)`. HTTP com timeout, `If-None-Match`/`If-Modified-Since`, limite de tamanho, `Retry-After`. |
| Normalização | `server/normalization/` | URL canônica (remove rastreadores, `www.`, `m.`, `/amp`), HTML → texto puro, datas (RFC 822, ISO, GDELT) com rejeição de datas futuras. Distingue `occurredAt`, `publishedAt`, `fetchedAt`/`firstSeenAt`, `updatedAt`. |
| Análise | `server/analysis/` | Regras determinísticas pt/en/es: categorias, canais de consequência, locais (gazetteer com correspondência sensível a maiúsculas), severidade, urgência, escopo afetado. IA opcional (`llm.ts`) só para itens de baixa confiança; saída validada por schema e mesclada de forma conservadora. |
| Deduplicação e agrupamento | `server/clustering/` | Mesma URL → duplicado. Mesmo evento → identidade da fonte, manchete idêntica, pegada de risco (tipo + ponto + tempo, ou tipo + áreas), ou semelhança forte de manchete. Desdobramento material (mais mortes, gravidade maior, alerta elevado) → grão adicional menor. |
| Coleta agendada | `server/ingestion/runOnce.ts`, `scripts/ingest-once.ts` | Uma passada: restaura o estado do Firestore num `Store` em memória (`node:sqlite`), consulta as fontes vencidas (`Scheduler.runDue`, com o mesmo recuo exponencial), roda o pipeline, expira o que passou de `RETENTION_HOURS` e grava de volta só o que mudou. |
| Persistência | `server/firebase/feedStore.ts`, `shared/feed.ts` | Firestore. `feed/h-AAAAMMDDHH`: eventos vistos pela primeira vez naquela hora (JSON); `feed/_meta`: saúde das fontes. `ingest/*`: impressões digitais de artigos, estado por fonte (ETag, falhas, próxima tentativa), sequência. |
| Distribuição | `src/services/stream.ts` | `onSnapshot` da coleção `feed`; cada snapshot é comparado ao anterior (`diffFeed`) e vira `new`/`development`/`update`/`expire`, como o SSE fazia. |
| Contas | `src/services/account.ts`, `firestore.rules` | Firebase Auth (e-mail/senha, recuperação por e-mail). `users/{uid}` (perfil), `saved/{eventId}`, `meta/viewed`. |
| Motor de impacto | `shared/impact/` | Puro, compartilhado; roda no navegador. |
| Simulação | `src/simulation/` | Independente do React. Ver [PERFORMANCE.md](PERFORMANCE.md). |
| Interface | `src/components/`, `src/App.tsx` | Estado por `useSyncExternalStore`, atualizações agrupadas; nada re-renderiza por quadro. |

## Modelo de dados

`NewsEvent` (`shared/types.ts`) é o evento consolidado; `Particle` (`src/simulation/Particle.ts`) é só a representação visual e carrega apenas `eventId`. Estados da partícula: `falling → deposited → removed` (afundou abaixo da borda). Quando um evento expira, seus grãos continuam como areia anônima (não clicáveis).

## Decisões

- **Coleta agendada em vez de processo contínuo**: a Vercel só roda funções curtas; o GitHub Actions (grátis em repositório público) faz uma passada a cada ~5 min. O estado entre passadas fica no Firestore.
- **Eventos agrupados por hora**: cada atualização em tempo real reenvia só as horas que mudaram (~45 KB), não o feed inteiro; o carregamento inicial são ~49 leituras pequenas.
- **Payload em JSON dentro do documento**: o Firestore não aceita listas aninhadas nem `undefined`, e ninguém consulta dentro dos eventos.
- **Impacto no cliente**: privacidade (a cidade não sai do navegador) e recálculo instantâneo ao trocar de cidade.
- **SQLite em memória na coleta**: reaproveita o pipeline inteiro sem reescrever; vive só durante a passada.
- **Canvas 2D**: medido e suficiente (ver PERFORMANCE.md); WebGL não se justificou.
- **Regras antes de IA**: o produto funciona sem chave de API; a IA só complementa itens ambíguos e nunca recebe dados do usuário.

## Segurança

- Texto de fontes é sempre tratado como dado: nunca é inserido como HTML (React renderiza texto; `toPlainText` remove marcação na coleta), nunca é obedecido (prompt da IA delimita o artigo e a saída é restrita por schema).
- Apenas links `http(s)` chegam ao navegador; abrem com `rel="noopener noreferrer"`.
- `firestore.rules`: notícias só para quem está logado; cada conta lê e escreve só os próprios documentos (com limites de tamanho); `ingest/*` fechado ao navegador; contadores de feedback só aceitam +1.
- CSP restritiva (aberta só para os domínios do Firebase), `X-Frame-Options: DENY`, `nosniff`, `Referrer-Policy: no-referrer` — definidos em `scripts/build-vercel.ts`.
- `/api/geocode*` exige um token do Firebase válido (verificado com as chaves públicas do Google) e limita requisições por usuário.
- Segredos (conta de serviço do Firebase, NewsAPI, Anthropic) só no GitHub Actions / `.env` local, nunca no código nem no navegador.
