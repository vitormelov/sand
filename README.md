# SAND

Notícias reais caem como areia. Cada grão é um acontecimento; o tamanho estima o **impacto potencial na vida de quem observa**, a partir da cidade que a pessoa informou.

Fundo branco (ou escuro: tema claro, escuro ou automático pelo sistema, em Configurações) com um mapa-múndi em traço fino, grãos pretos que clareiam com a idade da notícia até sumir, gravidade, colisões, acúmulo como areia. Sem feed, sem manchetes fixas, sem alarmes. Ao passar o mouse num grão, um pequeno sinal vermelho pulsa no mapa onde a notícia aconteceu (só quando o local foi identificado). Notícias da última hora ainda não abertas têm um anel fino ao redor; ao abrir uma notícia ela ganha um pequeno ponto claro no centro ("vista"). Notícias podem ser salvas e ficam em "Notícias salvas" (ícone de marcador), mesmo depois de saírem da areia. Clique num grão para ver a matéria original, por que ela tem aquele tamanho e com que confiança.

---

## Rodar localmente

Requisitos: **Node.js ≥ 22.13** (usa o SQLite embutido `node:sqlite`; testado no Node 24.11, Windows 11).

```bash
npm install
```

```bash
npm run dev
```

- Interface: http://localhost:5173 (Vite; usa `PORT` se definido)
- API: http://localhost:8787 (`SAND_API_PORT`)

O site exige **login com e-mail e senha**. No primeiro acesso, um questionário curto refina as estimativas: cidade (GPS ou digitada — obrigatória), importância de cada categoria, futebol e time, rotina (transporte, aluguel, filhos em idade escolar), trabalho e finanças, até 3 outros lugares importantes e temas que prefere ver menos. Tudo pode ser refeito em Configurações. O laboratório (`/?lab`) e o DEMO (`/?demo`) não exigem login, pois usam só dados fictícios. As notícias começam a chegar em poucos segundos; as fontes são consultadas no servidor em intervalos de 5–15 minutos.

Produção (API + interface no mesmo processo, http://localhost:8787):

```bash
npm run build
```

```bash
npm start
```

Laboratório do desenvolvedor, com dados **fictícios** e o rótulo "LAB" sempre visível, sem conexão com as fontes reais: http://localhost:5173/?lab. Ele tem uma régua de tamanhos (0–100), grãos com impacto escolhido, cenários calculados pelo motor real com o seu perfil (de "notícia leve" a "emergência na sua cidade"), rajada/chuva contínua, pausar física, limpar areia e métricas (fps, grãos caindo/depositados, fila).

Modo demonstração, com dados **fictícios** e o rótulo "DEMO — dados fictícios" sempre visível (não conecta às fontes reais): http://localhost:5173/?demo

### Scripts

| Comando | O que faz |
|---|---|
| `npm run dev` | API (tsx watch) + interface (Vite) |
| `npm run dev:lan` | igual, mas acessível por outros aparelhos da rede (ex.: celular em `http://<IP-do-PC>:5173`) |
| `npm run build` | typecheck + bundle de produção em `dist/` |
| `npm start` | servidor de produção (serve `dist/` + API) |
| `npm test` | todos os testes (unitários, integração, interface) |
| `npm run typecheck` | TypeScript sem emitir arquivos |
| `npm run verify:sources` | consulta **as fontes reais** uma vez e mostra itens, locais e scores para um perfil de Fortaleza (`-- usgs g1` para filtrar) |
| `npm run bench:sim` | benchmark da física sem navegador (`W`, `H`, `MINUTES`, `RATE`) |

## Configuração

Tudo é opcional; veja [`.env.example`](.env.example). Copie para `.env` (carregado automaticamente) ou defina no ambiente de hospedagem.

- `NEWSAPI_KEY` — ativa a NewsAPI (opcional).
- **IA desligada por padrão**: o SAND funciona só com regras e não gasta tokens. Para ativar a classificação complementar por IA em itens ambíguos é preciso definir **as duas** variáveis, `LLM_ENABLED=true` e `ANTHROPIC_API_KEY` (modelo em `LLM_MODEL`, padrão `claude-opus-5-5`; limite em `LLM_MAX_CALLS_PER_HOUR`). Uma chave existente no ambiente, sozinha, não ativa nada. O custo depende do volume de notícias, não do número de usuários. Só título e resumo da notícia são enviados; nunca dados do usuário.
- `RSS_FEEDS_JSON`, `GDELT_QUERIES`, `DISABLED_SOURCES` — ajustar fontes.
- `RETENTION_HOURS` (48) — por quanto tempo eventos ficam guardados e visíveis.

Sem nenhuma chave, o SAND funciona com fontes públicas e classificação por regras.

## Fontes

Verificação feita em 23/10/2026 a partir da máquina de desenvolvimento com `npm run verify:sources` (requisições reais):

| Fonte | Tipo | Acesso | Status verificado |
|---|---|---|---|
| Agência Brasil (EBC) | RSS | livre; reprodução permitida citando a fonte | ✅ funcionando |
| g1, g1 Economia, g1 Ceará | RSS | público | ✅ funcionando |
| BBC News Brasil, BBC World | RSS | público | ✅ funcionando |
| DW Brasil | RSS (RDF) | público | ✅ funcionando |
| The Guardian — World | RSS | público | ✅ funcionando |
| USGS (terremotos M4,5+) | GeoJSON oficial | domínio público | ✅ funcionando |
| GDACS (ONU/Comissão Europeia) | RSS oficial | CC BY 4.0 | ✅ funcionando (alertas laranja/vermelho + inundações/ciclones/vulcões verdes) |
| INMET (avisos meteorológicos) | RSS oficial | livre citando a fonte | ✅ funcionando (exige User-Agent próprio, já enviado) |
| GDELT DOC 2.0 | JSON | sem chave; ≥ 5 s entre requisições | ⚠️ implementado, **não verificado**: respondeu HTTP 429 / falha de rede a partir desta máquina durante o desenvolvimento. O agendador recua (≥ 10 min) e as demais fontes seguem normalmente. |
| NewsAPI | JSON | exige `NEWSAPI_KEY`; plano gratuito é só para desenvolvimento | ⚠️ implementado, **não verificado** (sem chave) |

O SAND guarda e mostra apenas título, um resumo curto e o link para a matéria original. Não raspa páginas. Respeita `ETag`/`Last-Modified`, `Retry-After` e recua exponencialmente em falhas.

Para adicionar a editoria regional da sua cidade, use `RSS_FEEDS_JSON` (o g1 publica feeds por estado, ex. `https://g1.globo.com/rss/g1/sp/sao-paulo/`).

## Como funciona

- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) — módulos, fluxo de dados, decisões, segurança.
- [docs/IMPACT_ENGINE.md](docs/IMPACT_ENGINE.md) — fatores, pesos, regras especiais, relações causais, exemplos medidos.
- [docs/PERFORMANCE.md](docs/PERFORMANCE.md) — física, limites de memória e medições.

Resumo: o servidor coleta, normaliza, deduplica, agrupa e analisa cada notícia **sem saber quem vai vê-la** (categorias, canais de consequência, local, severidade, até onde os efeitos se espalham). O navegador recebe os eventos por SSE e calcula o impacto com o perfil local (cidade + interesses opcionais). Impacto e confiança são dimensões separadas.

## Contas e privacidade

- Senhas guardadas apenas como hash scrypt com sal; sessão em cookie `HttpOnly`, `SameSite=Lax` (e `Secure` em produção), válida por 30 dias.
- Login limitado por IP e por e-mail; resposta idêntica para e-mail inexistente e senha errada.
- Requisições que alteram dados exigem o cabeçalho `X-Sand: 1` (proteção CSRF).
- Notícias, stream e geocodificação exigem sessão; `/api/health` é público.
- Excluir a conta (Configurações → Conta) apaga e-mail, sessões e respostas imediatamente.
- Ainda **não há recuperação de senha** (precisa de um serviço de envio de e-mail).


- As respostas do questionário ficam na conta do usuário; o **cálculo de impacto continua acontecendo no navegador** — o servidor envia as mesmas notícias para todos.
- GPS é opcional: a posição é arredondada para 0,1° (~11 km) no navegador antes de ser enviada; o servidor arredonda de novo e descobre a cidade via OpenStreetMap Nominatim (com cache e no máximo 1 consulta/s, conforme a política de uso). Guarda-se só a cidade e o centro aproximado.
- A busca de cidade passa pelo servidor do SAND, que consulta o Open-Meteo Geocoding (gratuito, sem chave, para uso não comercial; com fallback offline para cidades brasileiras).
- Feedback "relevante / não relevante" fica no navegador; o servidor recebe só a contagem anônima por notícia.
- Sem contas, analytics, anúncios ou rastreadores. Configurações → "Limpar preferências locais" apaga tudo.

## Testes

```bash
npm test
```

99 testes em 10 arquivos (todos passando na última execução):

| Tipo | Arquivos | O que cobre | Dados |
|---|---|---|---|
| Unitários | `tests/unit/*` | score → raio, normalização, URLs canônicas, datas, gazetteer, regras de análise (incl. texto com "instruções" injetadas), motor de impacto (proximidade, eventos globais, emergência, impacto ≠ confiança, notícia leve, interesses sem bolha, metadados ausentes), deduplicação, agrupamento, desdobramentos, retenção, relações causais, física (limites, colisões, pilha, limites de partículas, impacto/avalanche, pausa, movimento reduzido, sessão longa) | sintéticos |
| Integração | `tests/integration/*` | parsers com **respostas reais capturadas** (Agência Brasil, g1 CE, USGS, GDACS, INMET), HTTP (timeout, 304, 429/Retry-After), isolamento de falhas entre fontes, servidor real: ingestão → SQLite → SSE, retomada com `Last-Event-ID`, limite de conexões, feedback, cabeçalhos de segurança | fixtures reais + conector controlável; amostra GDELT sintética (documentada) |
| Interface | `tests/ui/*` (jsdom) | onboarding, cidade, detalhes (abrir/fechar/Escape, link seguro, HTML não interpretado), preferências, movimento reduzido, estados de carregamento/vazio/erro/offline, DEMO rotulado | EventSource e canvas simulados |

Verificações manuais feitas no navegador (Chromium do app, 401×682 e produção): onboarding com busca real de cidade, recálculo ao trocar de cidade, painel de detalhes, lista de recentes, modo ambiente, CSP sem erros, ~180 fps (taxa da tela) com pior quadro de 6 ms. Verificações contra fontes reais: `npm run verify:sources`.

## Deploy

Um único processo Node serve a API, o SSE e a interface.

**Docker**

```bash
docker build -t sand .
```

```bash
docker run -p 8787:8787 -v sand-data:/app/data sand
```

**Use HTTPS em produção**: navegadores só liberam o GPS e cookies `Secure` em HTTPS (ou em `localhost`). Atrás de um proxy que já faz HTTPS, mantenha o padrão; para testar em HTTP puro, `COOKIE_SECURE=false`.

**Qualquer host Node (Render, Railway, Fly.io, VPS):** build `npm ci && npm run build`, start `npm start`, volume persistente em `data/` (ou `DATABASE_PATH`). O host define `PORT`.

Atrás de proxy reverso (nginx etc.), desative buffering e aumente o timeout em `/api/stream` (o servidor já envia `X-Accel-Buffering: no` e heartbeat a cada 25 s).

Escala: o desenho atual assume **uma instância** (SQLite, limitador de taxa e hub SSE em memória). Para várias instâncias, trocar `Store` por PostgreSQL e distribuir eventos por pub/sub (ex.: Redis).

## Limitações conhecidas

- **Classificação por regras** (pt/en/es): cobre bem economia, clima, segurança, saúde e localização no Brasil, mas erra casos ambíguos (ex.: nomes próprios iguais a lugares são evitados, então alguns lugares não são detectados; "Jordan", "Georgia" e "Natal" são ignorados de propósito). A IA opcional melhora isso, mas não foi exercitada contra a API real neste ambiente (sem chave).
- **Agrupamento entre idiomas**: matérias em inglês e português sobre o mesmo fato só se juntam quando há identidade estruturada (ex.: terremotos por local/tempo); por texto, não.
- **Gazetteer** detalhado só para o Brasil (estados, capitais, ~50 cidades) e ~110 países; cidades fora dele são reconhecidas para *a cidade do próprio usuário* (por nome) e via padrão "Cidade (UF)".
- **Feeds de veículos** priorizam o Brasil e o noticiário internacional em pt/en; a cobertura local fora do Ceará depende de configurar `RSS_FEEDS_JSON`.
- **GDELT e NewsAPI** não verificados (ver tabela).
- **Desempenho** medido em um desktop; dispositivos móveis reais não foram testados (o layout móvel foi verificado no navegador do app em 401×682).
- **Alertas críticos**: o aviso no topo é uma camada informativa, **não** substitui sistemas oficiais de alerta (Defesa Civil, SMS 40199).
- Estimativas de impacto são automáticas e podem errar; o painel sempre mostra fonte, horário, fatores e confiança.
