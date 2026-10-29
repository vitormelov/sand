# SAND

Notícias reais caem como areia. Cada grão é um acontecimento; o tamanho estima o **impacto potencial na vida de quem observa**, a partir da cidade que a pessoa informou.

Fundo branco (ou escuro: tema claro, escuro ou automático pelo sistema, em Configurações) com um mapa-múndi em traço fino, grãos pretos que clareiam com a idade da notícia até sumir, gravidade, colisões, acúmulo como areia. Sem feed, sem manchetes fixas, sem alarmes. Ao passar o mouse num grão, um pequeno sinal vermelho pulsa no mapa onde a notícia aconteceu (só quando o local foi identificado). Notícias da última hora ainda não abertas têm um anel fino ao redor; ao abrir uma notícia ela ganha um pequeno ponto claro no centro ("vista"). Notícias podem ser salvas e ficam em "Notícias salvas" (ícone de marcador), mesmo depois de saírem da areia. Clique num grão para ver a matéria original, por que ela tem aquele tamanho e com que confiança.

---

## Rodar localmente

Requisitos: **Node.js ≥ 22.13** (a coleta usa o SQLite embutido `node:sqlite` em memória; testado no Node 24) e um **projeto Firebase** (veja [Deploy](#deploy)).

```bash
npm install
```

Crie um `.env` a partir de [`.env.example`](.env.example) com a configuração web do Firebase (`VITE_FIREBASE_*`) e, para coletar notícias, o JSON da conta de serviço (`FIREBASE_SERVICE_ACCOUNT`).

```bash
npm run dev
```

Interface em http://localhost:5173. Ela lê as notícias do Firestore em tempo real e usa o Firebase Auth para login; a busca de cidade (`/api/geocode`) roda dentro do próprio Vite. Para colocar notícias no Firestore a partir do seu computador:

```bash
npm run ingest
```

O site exige **login com e-mail e senha** (com "Esqueci a senha" por e-mail). No primeiro acesso, um questionário curto refina as estimativas: cidade (GPS ou digitada — obrigatória), importância de cada categoria, futebol e time, rotina (transporte, aluguel, filhos em idade escolar), trabalho e finanças, até 3 outros lugares importantes e temas que prefere ver menos. Tudo pode ser refeito em Configurações. O laboratório (`/?lab`) e o DEMO (`/?demo`) não exigem login nem Firebase, pois usam só dados fictícios.

Laboratório do desenvolvedor, com dados **fictícios** e o rótulo "LAB" sempre visível, sem conexão com as fontes reais: http://localhost:5173/?lab. Ele tem uma régua de tamanhos (0–100), grãos com impacto escolhido, cenários calculados pelo motor real com o seu perfil (de "notícia leve" a "emergência na sua cidade"), rajada/chuva contínua, pausar física, limpar areia e métricas (fps, grãos caindo/depositados, fila).

Modo demonstração, com dados **fictícios** e o rótulo "DEMO — dados fictícios" sempre visível (não conecta às fontes reais): http://localhost:5173/?demo

### Scripts

| Comando | O que faz |
|---|---|
| `npm run dev` | interface (Vite) + `/api/geocode` local |
| `npm run dev:lan` | igual, mas acessível por outros aparelhos da rede (ex.: celular em `http://<IP-do-PC>:5173`) |
| `npm run ingest` | uma passada de coleta: lê o estado do Firestore, consulta as fontes vencidas, grava de volta (é o que o GitHub Actions roda a cada ~5 min) |
| `npm run build` | typecheck + bundle de produção em `dist/` |
| `npm run build:vercel` | build da Vercel (`.vercel/output`: site estático + função de busca de cidade) |
| `npm run deploy:rules` | publica `firestore.rules` no projeto Firebase |
| `npm test` | todos os testes (unitários, integração, interface) |
| `npm run typecheck` | TypeScript sem emitir arquivos |
| `npm run verify:sources` | consulta **as fontes reais** uma vez e mostra itens, locais e scores para um perfil de Fortaleza (`-- usgs g1` para filtrar) |
| `npm run bench:sim` | benchmark da física sem navegador (`W`, `H`, `MINUTES`, `RATE`) |

## Configuração

Veja [`.env.example`](.env.example). Copie para `.env` (carregado automaticamente) ou defina no ambiente de hospedagem (Vercel, secrets do GitHub). Só as variáveis do Firebase são obrigatórias.

- `NEWSAPI_KEY` — ativa a NewsAPI (opcional).
- **IA desligada por padrão**: o SAND funciona só com regras e não gasta tokens. Para ativar a classificação complementar por IA em itens ambíguos é preciso definir **as duas** variáveis, `LLM_ENABLED=true` e `ANTHROPIC_API_KEY` (modelo em `LLM_MODEL`, padrão `claude-opus-5-5`; limite em `LLM_MAX_CALLS_PER_HOUR`). Uma chave existente no ambiente, sozinha, não ativa nada. O custo depende do volume de notícias, não do número de usuários. Só título e resumo da notícia são enviados; nunca dados do usuário.
- `RSS_FEEDS_JSON`, `DISABLED_SOURCES`, `ENABLE_INTERNATIONAL`, `GDELT_ENABLED`, `GDELT_QUERIES` — ajustar fontes (veja [docs/SOURCES.md](docs/SOURCES.md)).
- `RETENTION_HOURS` (48) — por quanto tempo eventos ficam guardados e visíveis.

Sem nenhuma chave de fonte ou de IA, o SAND funciona com fontes públicas e classificação por regras.

## Fontes

O SAND é focado no Brasil. Verificação feita em 24/10/2026 com `npm run verify:sources` (requisições reais): **60 fontes integradas e funcionando**. A lista completa, com método de acesso de cada uma e as **fontes pendentes** (motivo e alternativa), está em [`docs/SOURCES.md`](docs/SOURCES.md).

| Grupo | Fontes |
|---|---|
| Nacionais | Agência Brasil, g1, Folha, Estadão, O Globo, UOL, CNN Brasil, Poder360, BBC News Brasil, DW Brasil |
| Regionais | g1 dos 27 estados, Gazeta do Povo, Estado de Minas, A Tarde |
| Economia | g1 Economia, InfoMoney |
| Órgãos oficiais | Banco Central (Copom e notícias), IBGE (API), ANEEL (bandeira tarifária, dados abertos), Agência Senado, Agência Câmara, Receita Federal, CERT.br |
| Alertas | INMET, InfoDengue (27 capitais), Sismologia USP (RSBR), USGS, GDACS |
| Clima e ambiente | MetSul, ClimaInfo, ((o))eco, Mongabay Brasil |
| Esporte | ge |
| Desligadas por padrão | BBC World e Guardian (`ENABLE_INTERNATIONAL=1`), GDELT (`GDELT_ENABLED=1`), NewsAPI (`NEWSAPI_KEY`) |

O SAND guarda e mostra apenas título, um resumo curto e o link para a matéria original. Não raspa páginas e não contorna login, paywall ou proteção anti-robô. Respeita `ETag`/`Last-Modified`, `Retry-After` e recua exponencialmente em falhas. Cada pessoa liga ou desliga fontes em Configurações → Fontes de notícias.

## Como funciona

- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) — módulos, fluxo de dados, decisões, segurança.
- [docs/IMPACT_ENGINE.md](docs/IMPACT_ENGINE.md) — fatores, pesos, regras especiais, relações causais, exemplos medidos.
- [docs/PERFORMANCE.md](docs/PERFORMANCE.md) — física, limites de memória e medições.

Resumo: a coleta (GitHub Actions, a cada ~5 min) normaliza, deduplica, agrupa e analisa cada notícia **sem saber quem vai vê-la** (categorias, canais de consequência, local, severidade, até onde os efeitos se espalham) e grava no Firestore, agrupada por hora (`feed/h-AAAAMMDDHH`). O navegador escuta essa coleção em tempo real e calcula o impacto com o perfil local (cidade + interesses opcionais). Impacto e confiança são dimensões separadas.

```
GitHub Actions (cron */5) ──► fontes ──► pipeline ──► Firestore ◄── navegador (Firebase SDK, tempo real)
                                                                    ▲
Vercel: site estático + /api/geocode, /api/geocode/reverse ─────────┘ (login pelo Firebase Auth)
```

## Contas e privacidade

- Login pelo **Firebase Auth** (e-mail e senha; o Google guarda só o hash da senha). Recuperação de senha por e-mail ("Esqueci a senha").
- Os dados da conta ficam no Firestore em `users/{uid}` (perfil, notícias salvas, ids de notícias vistas). As regras em [`firestore.rules`](firestore.rules) deixam cada pessoa ler e escrever **só os próprios documentos**; notícias exigem login; o estado da coleta (`ingest/*`) não é acessível pelo navegador.
- Trocar a senha e excluir a conta pedem a senha atual de novo. Excluir a conta (Configurações → Conta) apaga perfil, salvas, vistas e o login imediatamente.
- A busca de cidade (`/api/geocode`) só atende quem está logado (o token do Firebase é verificado com as chaves públicas do Google).

- As respostas do questionário ficam na conta do usuário; o **cálculo de impacto continua acontecendo no navegador** — o servidor envia as mesmas notícias para todos.
- GPS é opcional: a posição é arredondada para 0,1° (~11 km) no navegador antes de ser enviada; a função do SAND arredonda de novo e descobre a cidade via OpenStreetMap Nominatim (com cache e no máximo 1 consulta/s, conforme a política de uso). Guarda-se só a cidade e o centro aproximado.
- A busca de cidade passa pela função do SAND na Vercel, que consulta o Open-Meteo Geocoding (gratuito, sem chave, para uso não comercial; com fallback offline para cidades brasileiras).
- Feedback "relevante / não relevante" fica no navegador; o Firestore recebe só a contagem anônima por notícia (`feedback/{id}`; as regras só permitem somar 1).
- Sem analytics, anúncios ou rastreadores. Configurações → "Limpar preferências locais" apaga as preferências deste navegador.

## Testes

```bash
npm test
```


| Tipo | Arquivos | O que cobre | Dados |
|---|---|---|---|
| Unitários | `tests/unit/*` | passada de coleta (fontes vencidas, deduplicação entre passadas, recuo em falhas, expiração), agrupamento por hora, diferença entre snapshots do Firestore, API de cidades (login obrigatório), score → raio, normalização, URLs canônicas, datas, gazetteer, regras de análise (incl. texto com "instruções" injetadas), motor de impacto (proximidade, eventos globais, emergência, impacto ≠ confiança, notícia leve, interesses sem bolha, metadados ausentes), deduplicação, agrupamento, desdobramentos, retenção, relações causais, física (limites, colisões, pilha, limites de partículas, impacto/avalanche, pausa, movimento reduzido, sessão longa) | sintéticos |
| Integração | `tests/integration/*` | parsers com **respostas reais capturadas** (Agência Brasil, g1 CE, USGS, GDACS, INMET), HTTP (timeout, 304, 429/Retry-After), isolamento de falhas entre fontes | fixtures reais + conector controlável; amostra GDELT sintética (documentada) |
| Interface | `tests/ui/*` (jsdom) | onboarding, cidade, detalhes (abrir/fechar/Escape, link seguro, HTML não interpretado), preferências, movimento reduzido, estados de carregamento/vazio/erro/offline, DEMO rotulado | feed, conta Firebase e canvas simulados |

Verificações manuais feitas no navegador (Chromium do app, 401×682 e produção): onboarding com busca real de cidade, recálculo ao trocar de cidade, painel de detalhes, lista de recentes, modo ambiente, CSP sem erros, ~180 fps (taxa da tela) com pior quadro de 6 ms. Verificações contra fontes reais: `npm run verify:sources`.

## Deploy

**Vercel** (site + busca de cidade), **Firebase** (login e banco) e **GitHub Actions** (coleta a cada ~5 min). Planos gratuitos dão conta de um uso moderado.

1. **Firebase** ([console](https://console.firebase.google.com)): crie um projeto; em *Authentication → Sign-in method*, ative **E-mail/senha**; crie o **Firestore** (região `southamerica-east1`); em *Configurações do projeto → Seus apps*, registre um app Web e copie a configuração (`apiKey`, `authDomain`, `projectId`, `appId`); em *Contas de serviço*, gere uma **chave privada** (arquivo JSON).
2. **Regras do Firestore**: `npx firebase login`, `npx firebase use --add` (escolha o projeto) e `npm run deploy:rules`.
3. **GitHub** (Settings → Secrets and variables → Actions): secret `FIREBASE_SERVICE_ACCOUNT` com o conteúdo do JSON. Em *Actions → Ingest news → Run workflow* rode uma vez para preencher o Firestore; depois ele roda sozinho a cada ~5 min.
4. **Vercel**: importe o repositório (o build usa `vercel.json` → `npm run build:vercel`) e defina `VITE_FIREBASE_API_KEY`, `VITE_FIREBASE_AUTH_DOMAIN`, `VITE_FIREBASE_PROJECT_ID` e `VITE_FIREBASE_APP_ID`.
5. **Firebase → Authentication → Settings → Authorized domains**: adicione o domínio da Vercel (ex.: `sand.vercel.app`).

Observações:
- O GitHub pode atrasar execuções agendadas alguns minutos e **pausa agendamentos depois de 60 dias sem commits** no repositório (reative na aba Actions).
- A configuração web do Firebase (`VITE_FIREBASE_*`) é pública por natureza; quem protege os dados são o Firebase Auth e as `firestore.rules`. Já `FIREBASE_SERVICE_ACCOUNT` é segredo: só no GitHub (e no seu `.env` local), nunca no código.

## Limitações conhecidas

- **Classificação por regras** (pt/en/es): cobre bem economia, clima, segurança, saúde e localização no Brasil, mas erra casos ambíguos (ex.: nomes próprios iguais a lugares são evitados, então alguns lugares não são detectados; "Jordan", "Georgia" e "Natal" são ignorados de propósito). A IA opcional melhora isso, mas não foi exercitada contra a API real neste ambiente (sem chave).
- **Agrupamento entre idiomas**: matérias em inglês e português sobre o mesmo fato só se juntam quando há identidade estruturada (ex.: terremotos por local/tempo); por texto, não.
- **Gazetteer** detalhado só para o Brasil (estados, capitais, ~50 cidades) e ~110 países; cidades fora dele são reconhecidas para *a cidade do próprio usuário* (por nome) e via padrão "Cidade (UF)".
- **Feeds de veículos** priorizam o Brasil e o noticiário internacional em pt/en; a cobertura local fora do Ceará depende de configurar `RSS_FEEDS_JSON`.
- **GDELT e NewsAPI** não verificados (ver tabela).
- **Desempenho** medido em um desktop; dispositivos móveis reais não foram testados (o layout móvel foi verificado no navegador do app em 401×682).
- **Alertas críticos**: o aviso no topo é uma camada informativa, **não** substitui sistemas oficiais de alerta (Defesa Civil, SMS 40199).
- Estimativas de impacto são automáticas e podem errar; o painel sempre mostra fonte, horário, fatores e confiança.
