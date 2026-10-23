# Personal Impact Engine

Código: [`shared/impact/engine.ts`](../shared/impact/engine.ts) · parâmetros: [`shared/impact/config.ts`](../shared/impact/config.ts) (único lugar com números ajustáveis).

O motor é uma função pura `computeImpact(evento, perfil, agora) → { score, confidence, band, urgent, factors, rules, explanation }`.
Ele roda **no navegador**: o servidor envia a mesma análise (independente de perfil) para todos, e a cidade do usuário nunca sai do dispositivo.

## Duas dimensões separadas

| | O que mede | Afeta o tamanho do grão? |
|---|---|---|
| **score** (0–100) | Impacto potencial na vida da pessoa, *se* o acontecimento for relevante para ela | Sim |
| **confidence** (0–1) | Qualidade das evidências: confiabilidade da fonte, clareza da classificação, certeza do local, corroboração | Não — só **limita** extremos quando a evidência é fraca |

Confiança alta nunca infla um grão. Teste: `tests/unit/impact.test.ts › keeps impact and confidence separate`.

## Fatores (pesos configuráveis)

| Fator | Peso | Como é calculado |
|---|---:|---|
| Consequência prática | 30% | maior `peso_do_canal × força × alcance`, onde alcance = exposição (canais sistêmicos: preços, juros, emprego) ou exposição^1,5 (canais de efeito local: riscos naturais, violência, infraestrutura, mobilidade) |
| Proximidade e exposição | 25% | `max(proximidade_da_origem, transmissão_pelo_escopo_afetado)` |
| Alcance e gravidade | 20% | severidade do próprio acontecimento (mortes relatadas, magnitude, nível de alerta oficial, termos como "calamidade") |
| Interesses do usuário | 15% | 1,0 se combina; 0,5 se nenhum interesse foi escolhido; 0,25 se não combina (nunca zero — sem bolha) |
| Urgência e atualidade | 10% | 0,6 × recência (meia-vida 8 h, pela data do acontecimento/publicação) + 0,4 × linguagem de urgência |

`score = Σ peso × fator × 100 + ajuste_de_feedback` (±10 pts no máximo), limitado a 0–100.

### Canais de consequência

Cada notícia pode "chegar" à vida das pessoas por canais: custo de vida, energia/combustíveis, juros/crédito/câmbio, trabalho e renda, saúde pública, segurança física, riscos naturais, infraestrutura, mobilidade, leis e decisões públicas, serviços digitais, educação, meio ambiente. Cada canal tem um peso prático (`CHANNEL_PRACTICAL_WEIGHT`).

### Hierarquia geográfica (proximidade)

| Relação | Valor |
|---|---:|
| Mesma cidade (nome ou < 15 km) | 1,00 |
| < 60 km (região metropolitana) | 0,92 |
| < 200 km | 0,78 |
| Mesmo estado | 0,75 |
| Mesma macrorregião (ex.: Nordeste) | 0,62 |
| < 800 km | 0,60 |
| Mesmo país | 0,55 (0,35 se for um risco localizado em outro ponto do país) |
| Mesma região do mundo | 0,30 |
| Outro lugar | 0,12 |
| Local desconhecido | 0,25 (0,45 se o veículo é do país do usuário) |

Distâncias só são usadas para pontos (cidades, epicentros), nunca para centróides de estados/países.

### Escopo afetado (transmissão)

Além de *onde aconteceu*, o servidor estima *até onde as consequências se espalham* (`affectedScope`): `local`, `state`, `national`, `world_region`, `global`. Ex.: alta do Brent com termos como "Opep", "oferta global", "Estreito de Ormuz" → `global`. A transmissão para o usuário é 0,70 (global), 0,72 (nacional, mesmo país), 0,82 (estadual, mesmo estado), 0,50 (região do mundo), multiplicada por `0,5 + 0,5 × força_do_canal`.

É assim que um choque do petróleo no Oriente Médio vira um grão perceptível em Fortaleza sem mencionar a cidade, enquanto um terremoto M4,5 na Bolívia fica pequeno.

## Regras especiais (documentadas)

| Regra | Condição | Efeito | Por quê |
|---|---|---|---|
| Emergência próxima | risco físico (`hazard`) + severidade ≥ 0,5 + proximidade ≥ 0,78 (mesma cidade ou < 200 km) + até 24 h | piso de 80 + 15 × severidade; `urgent = true` → aviso discreto no topo | A média ponderada pode diluir um risco imediato. Um alerta em outra parte de um estado grande é "alto", não "emergência". |
| Catástrofe global | severidade ≥ 0,9 e escopo global | piso de 60 | Pandemias, guerras com efeito sistêmico. |
| Evidência fraca | confiança < 0,35 (e não é emergência) | teto de 70 | "Evite score extremo sem justificativa." |
| Notícia leve | só esportes/cultura/outros, sem canal de consequência | teto de 35 | Popularidade ≠ impacto. |
| Feedback | cliques "relevante / não relevante" | ±2 pts por categoria, limitado a ±10; vale para estimativas futuras | Ajuste controlado, sem reescrever o passado. |

Ajustes de análise no servidor que também afetam o tamanho:
- **Crime resolvido** ("preso", "condenado", "apreendido"): o canal de segurança física cai 55% — é notícia de justiça, não risco em andamento.
- **Incidente isolado** (sem vítimas contadas e sem sinais de violência contínua): canal de segurança × 0,7.

## Relações entre eventos

[`server/clustering/relations.ts`](../server/clustering/relations.ts). Uma tabela de transmissões plausíveis (ex.: `energy_fuel → cost_of_living`) é cruzada com evidência textual:

- **documentada**: a matéria posterior atribui explicitamente a causa ("gasolina sobe *após disparada do petróleo*");
- **provável**: menciona o fator sem conector causal;
- **possível**: só a tabela + compatibilidade geográfica (exibida como "possível (não confirmada)").

Sem evidência e sem compatibilidade, nada é ligado. Um efeito nunca é ligado a uma causa posterior.

## Exemplos medidos (perfil: Fortaleza, CE; fontes reais, 23/10/2026)

| Notícia | Score |
|---|---:|
| Mutirão com 30 vagas de emprego na Grande Fortaleza (g1 CE) | 58 |
| Assalto com facada em Fortaleza (g1 CE) | 54 |
| INMET: baixa umidade, perigo potencial (CE e vizinhos) | 54 |
| "Oil price rises above $117 a barrel…" (The Guardian) | 52 |
| IPCA-15 sobe 0,32% (g1 Economia) | 50 |
| INMET: tempestade, grande perigo (PR/SC/RS) | 49 |
| Terremoto M7 na China, alerta vermelho GDACS | 33 |
| Terremoto M4,5 na Bolívia (USGS) | 30 |
| Museu, cultura, política estrangeira sem canal | 12–15 |

Os números são estimativas automáticas por regras e foram calibrados olhando dados reais; ajuste `config.ts` e rode `npm run verify:sources` para ver o efeito.
