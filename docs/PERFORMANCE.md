# Simulação e desempenho

## Como a física funciona

[`src/simulation/PhysicsEngine.ts`](../src/simulation/PhysicsEngine.ts) — aproximação visual de areia, não física granular exata.

- **Grãos em queda** (ativos): gravidade, arrasto quadrático (velocidade terminal ~55 + 20·r px/s: grãos leves flutuam, pesados caem decididos), leve oscilação lateral em grãos pequenos, colisões círculo–círculo com correção de posição ponderada por massa (∝ área), restituição baixa, atrito tangencial (rolagem/deslizamento), paredes e chão. 2 subpassos × 2 iterações por quadro.
- **Deposição**: um grão lento e apoiado (no chão, num "bolso" entre dois grãos, ou quase em cima de um) por ~0,3 s vira **estático**: sai da integração, entra num índice espacial estático e é desenhado uma única vez num canvas offscreen ("sedimento"). Grãos inclinados sobre um só vizinho só repousam quase parados (atrito estático). Contatos dissipam energia rapidamente, e um grão lento que ainda esteja ativo após 30 s é depositado de qualquer forma (evita tremulação eterna).
- **Acomodação**: impactos de grãos grandes acordam grãos da superfície (pequenas crateras); grãos que perdem apoio deslizam em cascata (avalanches). No modo normal, a cada 2,5–5,5 s um grão exposto da superfície é cutucado e se reacomoda — a paisagem "respira" sem inventar notícias.
- **Compactação**: quando o leito passa de 40% da altura (34% no celular) ou do limite de grãos (densidade: 2.500 / 5.000 / 9.000; metade no celular), o leito inteiro **afunda** devagar (3 px/s) e os grãos que saem pela borda inferior são liberados. Há um teto rígido de 125% do limite.
- **Índice espacial**: grade uniforme (célula ≈ 2,4 × raio máximo) para ativos e estáticos; consultas tocam só células vizinhas.

O laço de animação ([`SandSimulation.ts`](../src/simulation/SandSimulation.ts)) é próprio (`requestAnimationFrame`), fora do React. Quadros longos são limitados a 50 ms (não tenta recuperar tempo perdido). Com a aba oculta o laço é **pausado**; ao voltar, continua de onde parou. Novas notícias chegam a uma fila e caem em ritmo calmo (≈1,6 s entre grãos ao vivo; mais rápido para o lote inicial); após longas ausências a fila é limitada a 600 grãos (os de menor impacto ficam só na lista).

Movimento reduzido (preferência do sistema ou configuração): cada grão é simulado instantaneamente até o repouso e aparece com fade, sem oscilação, sem acomodações e com halo estático.

## Medições

### Física sem navegador — `npm run bench:sim`

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
