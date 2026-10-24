# Simulação e desempenho

## Tamanho dos grãos

Raio de 7 px (impacto 0) a 50 px (impacto 100) no desktop (7 · 10 · 14 · 20 · 30 · 50 px para 0 · 20 · 40 · 60 · 80 · 100), curva em `RADIUS_CURVE` (`shared/impact/config.ts`); no celular (largura < 700 px) tudo é desenhado a 60%. Configurações → "Tamanho dos grãos" multiplica a curva. Crateras acontecem quando um grão ≥ 2× maior atinge outros a mais de 60 px/s.

## Aparência

Grãos são círculos pretos (#111) cuja **opacidade acompanha a idade da notícia**: sólidos ao serem publicados, clareando até sumir no fim da retenção (48 h; curva `(1 − vida)^0,8`, 24 níveis). A cada 15 s os tons são recalculados; grãos que somem saem da física e os que estavam apoiados neles escorregam. Os grãos depositados são desenhados uma vez num canvas de sedimento, agrupados por nível de tom. Os canvases são renderizados a no mínimo 2× o tamanho CSS (até 3×) e reduzidos pelo navegador, para bordas lisas em monitores 1×; rebake de 1.500 grãos a 2×: ~0,8 ms. Atrás da areia, um mapa-múndi em traço fino (Natural Earth 1:110m, domínio público, via `world-atlas`), desenhado uma vez num canvas próprio e redesenhado só ao redimensionar; pode ser desligado em Configurações.

## Como a física funciona

[`src/simulation/PhysicsEngine.ts`](../src/simulation/PhysicsEngine.ts) — aproximação visual de areia, não física granular exata.

- **Grãos em queda** (ativos): gravidade, arrasto quadrático (velocidade terminal 70 + 2,2 × impacto px/s — depende do impacto, não do tamanho em pixels: notícias leves flutuam, pesadas caem decididas), leve oscilação lateral em grãos de impacto < 40, colisões círculo–círculo com correção de posição ponderada por massa (∝ área), restituição baixa, atrito tangencial (rolagem/deslizamento), paredes e chão. 2 subpassos × 2 iterações por quadro.
- **Repouso como areia**: um grão só para no chão ou num "bolso" — apoiado por baixo e preso dos dois lados (vizinhos ou parede) — ou soterrado (apoiado por baixo e pressionado por cima por areia já assentada; um grão ainda rolando por cima não conta). Sobre um único grão ele **sempre rola para o lado** (empurrão constante quebra o equilíbrio perfeito), então não se formam torres. Uma varredura periódica acorda grãos depositados que perderam apoio.
- **Deposição**: um grão lento e apoiado (no chão, num "bolso" entre dois grãos, ou quase em cima de um) por ~0,3 s vira **estático**: sai da integração, entra num índice espacial estático e é desenhado uma única vez num canvas offscreen ("sedimento"). Grãos inclinados sobre um só vizinho só repousam quase parados (atrito estático). Contatos dissipam energia rapidamente, e um grão lento que ainda esteja ativo após 30 s é depositado de qualquer forma (evita tremulação eterna).
- **Acomodação**: impactos de grãos grandes acordam grãos da superfície (pequenas crateras); grãos que perdem apoio deslizam em cascata (avalanches). No modo normal, a cada 2,5–5,5 s um grão exposto da superfície é cutucado e se reacomoda — a paisagem "respira" sem inventar notícias.
- **Compactação**: quando o leito passa de 40% da altura (34% no celular) ou do limite de grãos (densidade: 800 / 1.500 / 3.000; metade no celular), o leito inteiro **afunda** devagar (3 px/s, acelerando proporcionalmente ao excesso, até 24 px/s) e os grãos que saem pela borda inferior são liberados. Há um teto rígido de 125% do limite.
- **Índice espacial**: grade uniforme (célula ≈ 2,4 × raio máximo) para ativos e estáticos; consultas tocam só células vizinhas.

O laço de animação ([`SandSimulation.ts`](../src/simulation/SandSimulation.ts)) é próprio (`requestAnimationFrame`), fora do React. Quadros longos são limitados a 50 ms (não tenta recuperar tempo perdido). Com a aba oculta o laço é **pausado**; ao voltar, continua de onde parou. Novas notícias chegam a uma fila e caem em ritmo calmo (≈1,6 s entre grãos ao vivo; mais rápido para o lote inicial); após longas ausências a fila é limitada a 600 grãos (os de menor impacto ficam só na lista).

Movimento reduzido (preferência do sistema ou configuração): cada grão é simulado instantaneamente até o repouso e aparece com fade, sem oscilação, sem acomodações e com halo estático.

## Medições

### Física sem navegador — `npm run bench:sim`

Medição com grãos de 11–33 px, 1920×1080, 20 min: passo médio **0,029 ms**, p99 0,071 ms, leito estável em ~40% da altura. 390×844: média 0,063 ms, p99 0,145 ms. A tabela abaixo é a medição anterior, com grãos de 1,2–9 px:

Taxa de chegada agressiva de **3 grãos/s** (o fluxo real é de algumas centenas por hora, ~0,1/s). Node 24.11, Windows 11, desktop.

| Tela | Tempo simulado | Passo médio | p95 | p99 | Ativos | Depositados (estável) | Removidos | Violações de limites |
|---|---|---:|---:|---:|---:|---:|---:|---:|
| 1920×1080 | 60 min | 0,056 ms | 0,110 ms | 0,179 ms | ~40–46 | ~2.960 (limite 3.000) | 5.997 | 0 |
| 390×844 | 60 min | 0,045 ms | 0,089 ms | 0,151 ms | ~26–36 | ~2.995 | 5.976 | 0 |
| 3440×1440 | 30 min | 0,051 ms | 0,104 ms | 0,174 ms | ~53–55 | ~2.850 | 700+ | 0 |

O custo por passo não cresce com o tempo: a quantidade de grãos ativos é constante e os estáticos são limitados. (O "heap" reportado pelo script inclui o vetor de amostras do próprio benchmark.)

### No navegador

Chromium embutido no app de desenvolvimento, monitor de 180 Hz, build de desenvolvimento, ~240–300 grãos reais na tela:

- **180 fps** (limitado pela taxa da tela), pior quadro em 5 s: **6 ms**;
- heap JS da página: **~12 MB**;
- re-bakes do sedimento: só quando grãos estáticos mudam (acomodação, afundamento, mudança de cidade); grãos novos são desenhados incrementalmente.

Não medido: GPUs integradas antigas e celulares reais. Os limites de partículas por densidade e a redução no celular existem para isso; ajuste em `DENSITY_STATICS` e `DEFAULT_PHYSICS` se necessário.

## Memória ao longo de horas

- Partículas: limitadas (ativos ≤ 400/200; estáticos ≤ 1,25 × limite). Referências a grãos que saíram da tela são podadas a cada 5 s.
- Eventos no navegador: removidos quando o servidor os expira (`expire`), ou seja, limitados pela retenção (48 h).
- Servidor: eventos e artigos expiram no SQLite (tarefa a cada 10 min); o índice de agrupamento em memória é podado.
