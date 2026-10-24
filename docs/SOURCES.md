# Fontes do SAND

O SAND é focado no Brasil. Toda fonte abaixo marcada como **integrada** foi verificada com
requisições reais em **24/10/2026** (`npm run verify:sources`). Uma fonte só entra na lista de
integradas quando a coleta de verdade funciona; as demais ficam em **pendentes**, com o motivo e a
alternativa viável.

Regras seguidas em todas:

- Só RSS público, API oficial ou outro método documentado. Nada de raspar páginas.
- Nenhum login, paywall ou proteção anti-robô é contornado. Se a fonte pede login ou mostra um
  desafio (Cloudflare "Just a moment…"), ela fica pendente.
- O SAND guarda e mostra só título, resumo curto e link para o original.
- Requisições condicionais (`ETag` / `Last-Modified`), respeito a `Retry-After`, recuo exponencial
  em falhas e intervalos de coleta longos para fontes que mudam pouco.
- Itens criados a partir de **dados** (bandeira tarifária, InfoDengue, tremores) dizem qual órgão
  publicou o dado e apontam para a página oficial. Não são escritos como se fossem uma reportagem.

Cada pessoa pode ligar ou desligar fontes em **Configurações → Fontes de notícias**.

## Integradas

### Nacionais (RSS)

| Fonte | id | Observação |
|---|---|---|
| Agência Brasil (EBC) | `agencia-brasil` | Reprodução livre citando a fonte |
| g1 | `g1` | |
| Folha de S.Paulo | `folha` | Paywall (só o link é mostrado). Feed em ISO-8859-1, decodificado corretamente |
| Estadão | `estadao` | Paywall. Feed da editoria Brasil |
| O Globo | `oglobo` | Paywall |
| UOL Notícias | `uol` | Feed em ISO-8859-1 sem declarar; detectado automaticamente |
| CNN Brasil | `cnn-brasil` | |
| Poder360 | `poder360` | |
| BBC News Brasil | `bbc-brasil` | |
| DW Brasil | `dw-brasil` | |

### Regionais (RSS)

| Fonte | id | Observação |
|---|---|---|
| g1 — 27 estados | `g1-ac` … `g1-to` | Um feed por UF, coletado a cada 15 min. O caminho da URL indica o estado |
| Gazeta do Povo (PR) | `gazeta-do-povo` | Paywall parcial |
| Estado de Minas (MG) | `estado-de-minas` | |
| A Tarde (BA) | `a-tarde` | |

### Economia (RSS)

| Fonte | id |
|---|---|
| g1 Economia | `g1-economia` |
| InfoMoney | `infomoney` |

### Órgãos oficiais

| Fonte | id | Método |
|---|---|---|
| Banco Central — comunicados do Copom | `bcb-copom` | RSS oficial (`bcb.gov.br/api/feed/…/comunicadoscopom`) |
| Banco Central — notícias | `bcb-noticias` | RSS oficial |
| IBGE — Agência de Notícias | `ibge` | API oficial `servicodados.ibge.gov.br/api/v3/noticias` (o RSS do site fica atrás de desafio anti-robô) |
| ANEEL — bandeira tarifária | `aneel-bandeira` | API de dados abertos (CKAN, licença ODbL). Vira item só quando a bandeira do mês fica mais cara, ou volta a verde depois de uma mais cara |
| Agência Senado | `agencia-senado` | RSS oficial |
| Agência Câmara | `agencia-camara` | RSS oficial |
| Receita Federal | `receita-federal` | RSS do gov.br |
| CERT.br | `cert-br` | RSS oficial (avisos de segurança e golpes) |

### Alertas e monitoramento

| Fonte | id | Método |
|---|---|---|
| INMET — avisos meteorológicos | `inmet` | RSS oficial (CAP) |
| InfoDengue (Fiocruz/FGV) | `infodengue` | API pública `info.dengue.mat.br/api/alertcity`. Cobre as 27 capitais, a cada 12 h, uma capital por vez. Vira item só nos níveis laranja e vermelho |
| Sismologia USP (RSBR) | `rsbr-usp` | Serviço FDSN oficial `moho.iag.usp.br/fdsnws/event/1`. Tremores dentro do Brasil com magnitude ≥ 2,5. Na verificação não houve nenhum nos últimos 3 dias; o formato foi conferido com o catálogo do ano |
| USGS (terremotos M4,5+) | `usgs` | GeoJSON oficial |
| GDACS (ONU/Comissão Europeia) | `gdacs` | RSS oficial |

### Clima e meio ambiente (RSS)

| Fonte | id |
|---|---|
| MetSul Meteorologia | `metsul` |
| ClimaInfo | `climainfo` |
| ((o))eco | `oeco` |
| Mongabay Brasil | `mongabay-brasil` (datas com mês em português, tratadas) |

### Esporte (RSS)

| Fonte | id |
|---|---|
| ge (globo esporte) | `ge` |

### Desligadas por padrão

| Fonte | id | Como ligar |
|---|---|---|
| BBC News — World, The Guardian — World | `bbc-world`, `guardian-world` | `ENABLE_INTERNATIONAL=1` (em inglês; o SAND agora é só Brasil) |
| GDELT | `gdelt` | `GDELT_ENABLED=1` (falhou repetidamente daqui com HTTP 429 e duplica os feeds) |
| NewsAPI | `newsapi` | `NEWSAPI_KEY` |

## Pendentes

Fontes sugeridas que **não** foram integradas. Nenhuma aparece no site como se estivesse funcionando.

| Fonte | Motivo (verificado em 24/10/2026) | Alternativa viável |
|---|---|---|
| IDAP / Defesa Civil Alerta | Sem feed ou API pública documentada. Os alertas saem por SMS, cell broadcast, WhatsApp, Telegram e Google Alertas Públicos | Pedir acesso ao feed CAP à Secretaria Nacional de Defesa Civil (MIDR). Enquanto isso, o INMET cobre os avisos meteorológicos |
| Cemaden | Sem API pública documentada; o RSS de notícias do gov.br redireciona para login | Mapa Interativo (só visualização). Pedir acesso via Lei de Acesso à Informação ou parceria |
| Ministério da Saúde | RSS do gov.br redireciona para login | InfoDengue já cobre dengue. Para InfoGripe, avaliar a API do projeto Mosqlimate (Fiocruz) |
| Anvisa (recolhimentos e alertas) | O novo portal gov.br não publica RSS (`/RSS` responde 404) | Pedir RSS ao órgão, ou acompanhar o Portal de Dados Abertos se publicarem os alertas |
| ANEEL — notícias | Sem RSS no novo portal | Já integrado o dado mais útil (bandeira tarifária, API oficial) |
| ONS (risco de apagão, reservatórios) | Não verificado a tempo | Portal de dados abertos do ONS (`dados.ons.org.br`, CKAN): reservatórios e carga |
| ANP (combustíveis) | RSS 404 | Série histórica de preços na API de dados abertos da ANP (semanal) |
| PRF (rodovias) | RSS 404 no novo portal | Dados abertos da PRF são de acidentes (atrasados); bloqueios em tempo real não têm API pública |
| INSS, INEP / MEC | RSS 404 | Agência Brasil e g1 noticiam calendários de pagamento, ENEM e Sisu |
| MDR (Defesa Civil — notícias), ANA | RSS do gov.br redireciona para login | ANA tem dados hidrológicos abertos (HidroWeb / Sistema de Acompanhamento de Reservatórios), a avaliar |
| SGB / CPRM (cheias de rios) | Site responde 403 a requisições automáticas | Boletins do SACE são publicados em página; pedir feed ao SGB |
| Marinha — avisos de mau tempo | Protegido por desafio anti-robô (Cloudflare) | Não contornar. Pedir feed oficial à DHN/CHM |
| CPTEC/INPE | Sem RSS público | API de previsão do CPTEC (XML) é documentada, mas é previsão, não notícia |
| INPE — notícias | O RSS do gov.br mistura imagens e notícias antigas | Reavaliar se o feed for corrigido |
| INPE Queimadas, DETER | São dados (CSV diário de focos), não notícias | Agregar focos por município e gerar aviso quando houver pico. Precisa de regra própria |
| Qualidade do ar (CETESB, INEA, Copernicus/CAMS) | Dados por estação ou grade, não notícias | API do Open-Meteo (CAMS) por cidade, como aviso quando o índice ficar ruim |
| Climatempo | Sem RSS (a URL redireciona para a home) | MetSul e INMET já cobrem |
| Observatório do Clima | Feed responde 403 | ClimaInfo e ((o))eco já cobrem o tema |
| Valor Econômico | Não integrado: paywall forte e sem RSS público verificado | InfoMoney e g1 Economia |
| GZH (RS), Diário do Nordeste e O Povo (CE), Jornal do Commercio (PE) | Sem RSS público encontrado nas URLs usuais | g1 do estado cobre cada um desses estados |
| Correio Braziliense | O feed público parou em 2024 | g1 Distrito Federal |
| Senacon (recalls), Procons, Febraban | Sem RSS ou API verificados | CERT.br cobre golpes digitais. Avaliar o portal de recalls do gov.br |
| Caixa (FGTS, Bolsa Família) | Sem RSS público | Agência Brasil noticia os calendários |

Para adicionar ou trocar feeds sem mexer no código, use `RSS_FEEDS_JSON`. Para desligar uma fonte
no servidor inteiro, use `DISABLED_SOURCES` (ids separados por vírgula).
