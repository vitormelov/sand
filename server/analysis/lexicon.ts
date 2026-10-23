import type { Category, Channel } from '../../shared/types';

/**
 * Multilingual (pt / en / es) cue lists, matched on accent-free lowercase text.
 * A trailing "*" means prefix match ("inflac*" matches "inflacao", "inflacionaria").
 * Weights are 0..1 and express how strongly the cue indicates the channel.
 */
export type Cue = [cue: string, weight: number];

export const CHANNEL_CUES: Record<Channel, Cue[]> = {
  energy_fuel: [
    ['petroleo', 0.9], ['oil price*', 0.9], ['crude', 0.8], ['brent', 0.9], ['opep', 0.9], ['opec', 0.9],
    ['gasolina', 0.9], ['diesel', 0.9], ['combustive*', 0.9], ['fuel', 0.8], ['gas natural', 0.7], ['natural gas', 0.7],
    ['petrobras', 0.35], ['refinaria', 0.6], ['refinery', 0.6], ['gasoline', 0.9], ['botijao', 0.8], ['glp', 0.6],
    ['tarifa de energia', 0.8], ['bandeira tarifaria', 0.9], ['conta de luz', 0.9],
  ],
  cost_of_living: [
    ['inflac*', 0.9], ['inflation', 0.9], ['ipca', 0.9], ['custo de vida', 1], ['cost of living', 1], ['cesta basica', 0.9],
    ['preco dos alimentos', 0.9], ['food price*', 0.9], ['alta dos precos', 0.8], ['reajuste', 0.6], ['aluguel', 0.6],
    ['imposto*', 0.6], ['tribut*', 0.5], ['icms', 0.7], ['tarifa*', 0.5], ['tariff*', 0.6], ['price*', 0.3], ['preco*', 0.4],
    ['conta de agua', 0.8], ['plano de saude', 0.6], ['mensalidade', 0.5],
  ],
  interest_credit: [
    ['selic', 1], ['juros', 0.8], ['interest rate*', 0.9], ['banco central', 0.7], ['central bank', 0.7], ['copom', 0.9],
    ['federal reserve', 0.8], ['fed ', 0.6], ['cambio', 0.7], ['dolar', 0.6], ['exchange rate', 0.7], ['credito', 0.5],
    ['emprestimo*', 0.5], ['financiamento*', 0.5], ['endividamento', 0.6], ['recess*', 0.8], ['recession', 0.8],
  ],
  employment: [
    ['desemprego', 0.9], ['unemployment', 0.9], ['demiss*', 0.8], ['layoff*', 0.8], ['salario minimo', 1], ['minimum wage', 1],
    ['emprego*', 0.6], ['jobs', 0.5], ['greve', 0.6], ['strike', 0.5], ['inss', 0.8], ['previdencia', 0.7], ['fgts', 0.8],
    ['aposentadoria', 0.7], ['pension*', 0.6], ['trabalhador*', 0.5], ['clt', 0.6], ['bolsa familia', 0.8], ['auxilio', 0.6],
  ],
  public_health: [
    ['surto', 0.9], ['outbreak', 0.9], ['epidemi*', 0.9], ['pandemi*', 1], ['dengue', 0.9], ['chikungunya', 0.9], ['zika', 0.8],
    ['covid', 0.8], ['gripe', 0.6], ['influenza', 0.7], ['gripe aviaria', 0.9], ['bird flu', 0.9], ['h5n1', 0.9], ['vacina*', 0.6],
    ['vaccin*', 0.6], ['sarampo', 0.9], ['measles', 0.9], ['mpox', 0.9], ['ebola', 1], ['colera', 0.9], ['cholera', 0.9],
    ['contamina*', 0.6], ['intoxica*', 0.6], ['anvisa', 0.6], ['ministerio da saude', 0.6], ['oms', 0.6], ['who', 0.3],
    ['hospita*', 0.4], ['sus', 0.5], ['virus', 0.6], ['infecc*', 0.6], ['infection*', 0.6],
  ],
  physical_safety: [
    ['tiroteio', 1], ['shooting', 0.9], ['ataque', 0.7], ['attack*', 0.7], ['explos*', 0.8], ['homicid*', 0.8], ['assassin*', 0.7],
    ['violencia', 0.7], ['violence', 0.7], ['sequestr*', 0.7], ['terror*', 0.9], ['guerra', 0.8], ['war', 0.7], ['missil', 0.9],
    ['missile*', 0.9], ['bombardei*', 0.9], ['airstrike*', 0.9], ['chacina', 1], ['faccao', 0.8], ['facc*', 0.6], ['assalto', 0.6],
    ['arrastao', 0.8], ['bala perdida', 1], ['toque de recolher', 0.9], ['curfew', 0.9], ['conflito armado', 0.9], ['drone*', 0.5],
    ['invasao', 0.6], ['invasion', 0.7], ['killed', 0.6], ['mortos', 0.6], ['feridos', 0.5], ['injured', 0.5],
  ],
  natural_hazard: [
    ['terremoto', 1], ['earthquake', 1], ['sismo', 1], ['tremor', 0.8], ['tsunami', 1], ['enchente*', 1], ['inundac*', 1],
    ['flood*', 1], ['alagamento*', 0.9], ['deslizamento*', 1], ['landslide*', 1], ['furacao', 1], ['hurricane', 1],
    ['ciclone', 1], ['cyclone', 1], ['tufao', 1], ['typhoon', 1], ['tempestade*', 0.8], ['storm*', 0.7], ['temporal', 0.8],
    ['temporais', 0.8], ['seca', 0.7], ['estiagem', 0.8], ['drought', 0.8], ['onda de calor', 0.9], ['heatwave', 0.9],
    ['heat wave', 0.9], ['incendio florestal', 0.9], ['wildfire*', 0.9], ['queimada*', 0.7], ['vulcao', 0.9], ['volcan*', 0.9],
    ['erupc*', 0.8], ['eruption', 0.8], ['tornado*', 1], ['chuva forte', 0.8], ['chuvas fortes', 0.8], ['defesa civil', 0.7],
    ['granizo', 0.7], ['ressaca', 0.6], ['alerta laranja', 0.8], ['alerta vermelho', 0.9], ['alerta amarelo', 0.6],
  ],
  infrastructure: [
    ['apagao', 1], ['blackout', 0.9], ['falta de energia', 0.9], ['power outage', 0.9], ['falta d agua', 0.9],
    ['falta de agua', 0.9], ['abastecimento', 0.6], ['water supply', 0.8], ['racionamento', 0.9], ['barragem', 0.7], ['dam', 0.4],
    ['desabamento', 0.8], ['colapso', 0.5], ['collapse*', 0.5], ['saneamento', 0.5], ['interrupc*', 0.5], ['outage*', 0.7],
  ],
  mobility: [
    ['transito', 0.6], ['traffic', 0.5], ['transporte publico', 0.8], ['onibus', 0.6], ['metro', 0.5], ['metrô', 0.5],
    ['aeroporto*', 0.5], ['airport*', 0.5], ['voo*', 0.4], ['flight*', 0.4], ['rodovia*', 0.5], ['highway', 0.5], ['br ', 0.3],
    ['interdit*', 0.6], ['bloqueio', 0.4], ['passagem', 0.4], ['tarifa do onibus', 0.9], ['brt', 0.6], ['vlt', 0.6],
    ['porto', 0.3], ['greve de onibus', 1], ['uber', 0.4],
  ],
  rights_governance: [
    ['lei', 0.5], ['law', 0.4], ['decreto', 0.6], ['stf', 0.6], ['supremo', 0.6], ['congresso', 0.5], ['senado', 0.5],
    ['camara', 0.4], ['eleic*', 0.6], ['election*', 0.6], ['votac*', 0.5], ['reforma', 0.6], ['regulament*', 0.6],
    ['regulation*', 0.6], ['sancion*', 0.6], ['medida provisoria', 0.7], ['pec', 0.6], ['projeto de lei', 0.7], ['tse', 0.6],
    ['governo federal', 0.5], ['prefeitura', 0.4], ['governador*', 0.4], ['presidente', 0.3], ['sanc*', 0.4], ['sanction*', 0.5],
  ],
  digital_services: [
    ['pix', 0.8], ['ciberataque', 0.9], ['cyberattack*', 0.9], ['hacker*', 0.7], ['vazamento de dados', 0.9], ['data breach', 0.9],
    ['golpe', 0.6], ['scam*', 0.6], ['fora do ar', 0.8], ['instabilidade', 0.5], ['whatsapp', 0.4], ['internet', 0.4],
    ['inteligencia artificial', 0.4], ['artificial intelligence', 0.4], ['ransomware', 0.9], ['lgpd', 0.6],
  ],
  education_access: [
    ['enem', 0.9], ['escola*', 0.6], ['school*', 0.5], ['universidade*', 0.5], ['university', 0.4], ['vestibular', 0.8],
    ['sisu', 0.9], ['fies', 0.9], ['prouni', 0.9], ['aulas suspensas', 1], ['matricula*', 0.6], ['professor*', 0.4],
  ],
  environment: [
    ['desmatamento', 0.8], ['deforestation', 0.8], ['mudanca* climatica*', 0.8], ['climate change', 0.8], ['emisso*', 0.6],
    ['emission*', 0.6], ['cop3*', 0.7], ['poluic*', 0.7], ['pollution', 0.7], ['aquecimento global', 0.8], ['global warming', 0.8],
    ['qualidade do ar', 0.8], ['air quality', 0.8], ['oleo no mar', 0.9], ['oil spill', 0.9], ['derramamento', 0.7],
  ],
};

export const CATEGORY_CUES: Record<Category, Cue[]> = {
  economy: [
    ['economi*', 0.8], ['mercado*', 0.5], ['bolsa', 0.5], ['ibovespa', 0.9], ['pib', 0.9], ['gdp', 0.9], ['exportac*', 0.6],
    ['importac*', 0.6], ['comercio', 0.4], ['trade', 0.4], ['empresa*', 0.3], ['banco*', 0.4], ['investimento*', 0.5], ['economy', 0.8],
    ['market*', 0.5], ['stocks', 0.6], ['receita federal', 0.7], ['orcamento', 0.6], ['budget', 0.5], ['fiscal', 0.6],
  ],
  work: [['carreira', 0.8], ['concurso*', 0.8], ['vagas', 0.7], ['trabalho', 0.5], ['career', 0.8], ['workers', 0.6]],
  technology: [
    ['tecnologi*', 0.8], ['technolog*', 0.8], ['startup*', 0.7], ['software', 0.7], ['apple', 0.6], ['google', 0.6], ['microsoft', 0.6],
    ['meta', 0.3], ['openai', 0.7], ['anthropic', 0.7], ['chip*', 0.5], ['semicondut*', 0.8], ['semiconductor*', 0.8], ['celular*', 0.5],
    ['smartphone*', 0.6], [' ia ', 0.6], [' ai ', 0.6], ['robo*', 0.4], ['satelite*', 0.5], ['5g', 0.6], ['app', 0.4], ['aplicativo*', 0.5],
  ],
  health: [['saude', 0.8], ['health', 0.8], ['medic*', 0.5], ['doenca*', 0.7], ['disease*', 0.7], ['cancer', 0.7], ['tratamento', 0.4]],
  security: [['policia*', 0.7], ['police', 0.7], ['crime*', 0.7], ['preso*', 0.6], ['prisao', 0.6], ['arrest*', 0.6], ['seguranca publica', 0.9], ['militar*', 0.5], ['military', 0.5], ['exercito', 0.5]],
  politics: [
    ['politic*', 0.8], ['partido*', 0.6], ['candidat*', 0.7], ['ministro*', 0.5], ['minister', 0.5], ['governo', 0.5], ['government', 0.5],
    ['deputad*', 0.7], ['senador*', 0.7], ['parlament*', 0.6], ['diplomac*', 0.6], ['diplomat*', 0.6], ['cupula', 0.5], ['summit', 0.5],
  ],
  climate: [['clima', 0.7], ['climate', 0.7], ['previsao do tempo', 0.9], ['meteorolog*', 0.8], ['inmet', 0.9], ['chuva*', 0.6], ['temperatura*', 0.5], ['weather', 0.7], ['calor', 0.5]],
  education: [['educac*', 0.9], ['education', 0.9], ['ensino', 0.8], ['estudante*', 0.6], ['students', 0.6], ['alunos', 0.6]],
  sports: [
    ['futebol', 0.9], ['football', 0.6], ['soccer', 0.9], ['campeonato', 0.8], ['brasileirao', 1], ['libertadores', 1], ['copa do mundo', 0.8],
    ['copa do brasil', 1], ['gol', 0.6], ['gols', 0.7], ['partida', 0.6], ['tecnico', 0.4], ['tecnico do', 0.6], ['atleta*', 0.6],
    ['olimpi*', 0.8], ['olympic*', 0.8], ['nba', 1], ['nfl', 1], ['formula 1', 1], ['f1', 0.8], ['tenis', 0.6], ['tennis', 0.8],
    ['flamengo', 1], ['corinthians', 1], ['palmeiras', 1], ['sao paulo fc', 1], ['vasco', 1], ['fortaleza ec', 1], ['ceara sc', 1],
    ['gremio', 1], ['internacional', 0.4], ['cruzeiro', 0.9], ['botafogo', 1], ['fluminense', 1], ['santos fc', 1], ['selecao', 0.7],
    ['premier league', 1], ['champions league', 1], ['la liga', 1], ['jogador*', 0.7], ['player*', 0.4], ['match', 0.4], ['torcida', 0.8],
    ['classificac*', 0.4], ['rodada', 0.7], ['estadio', 0.6], ['ufc', 1], ['volei', 0.9], ['basquete', 0.9],
  ],
  culture: [
    ['filme*', 0.7], ['film*', 0.6], ['cinema', 0.8], ['musica*', 0.7], ['music*', 0.6], ['show*', 0.5], ['festival*', 0.7], ['livro*', 0.6],
    ['book*', 0.4], ['artista*', 0.7], ['artist*', 0.6], ['novela*', 0.9], ['serie*', 0.5], ['exposic*', 0.5], ['museu', 0.7], ['museum', 0.7],
    ['carnaval', 0.8], ['celebridade*', 0.8], ['famoso*', 0.6], ['cantor*', 0.8], ['singer', 0.8], ['ator', 0.7], ['atriz', 0.7], ['actor', 0.7],
    ['bbb', 1], ['reality', 0.7], ['oscar', 0.9], ['grammy', 0.9], ['streaming', 0.4], ['netflix', 0.6], ['album', 0.7], ['turne', 0.7],
  ],
  mobility: [],
  other: [],
};

/** Channels imply categories. */
export const CHANNEL_TO_CATEGORY: Record<Channel, Category> = {
  energy_fuel: 'economy',
  cost_of_living: 'economy',
  interest_credit: 'economy',
  employment: 'work',
  public_health: 'health',
  physical_safety: 'security',
  natural_hazard: 'climate',
  infrastructure: 'mobility',
  mobility: 'mobility',
  rights_governance: 'politics',
  digital_services: 'technology',
  education_access: 'education',
  environment: 'climate',
};

export const HAZARD_CHANNELS: Channel[] = ['natural_hazard', 'physical_safety', 'public_health'];

/** Incident already resolved / in the courts: no ongoing risk to the public. */
export const RESOLVED_CUES: Cue[] = [
  ['preso*', 0.8], ['presa*', 0.8], ['apreendid*', 0.8], ['condenad*', 0.9], ['julgad*', 0.7], ['sentenc*', 0.7],
  ['detido*', 0.8], ['arrested', 0.8], ['convicted', 0.9], ['sentenced', 0.9], ['indiciad*', 0.7], ['denunciad*', 0.6],
  ['inquerito', 0.5], ['investiga*', 0.4], ['charged', 0.6], ['absolvid*', 0.8],
];

/** Signs that violence is ongoing or widespread, not an isolated incident. */
export const ONGOING_RISK_CUES: Cue[] = [
  ['tiroteio', 0.9], ['toque de recolher', 1], ['onda de', 0.6], ['serie de', 0.6], ['arrastao', 0.8], ['confronto*', 0.7],
  ['guerra', 0.9], ['war', 0.8], ['bombardei*', 0.9], ['airstrike*', 0.9], ['missil', 0.9], ['missile*', 0.9], ['terror*', 0.9],
  ['chacina', 0.9], ['massacre', 0.9], ['ataques', 0.7], ['attacks', 0.7], ['clashes', 0.8], ['curfew', 1], ['shooting', 0.6],
  ['bala perdida', 0.8], ['faccao', 0.5], ['invasion', 0.8], ['invasao', 0.6],
];

/** Lowercase demonyms that reliably indicate a country. */
export const DEMONYMS: [RegExp, string][] = [
  [/brasileir[oa]s?/i, 'BR'], [/argentin[oa]s?/i, 'AR'], [/chines(?:a|es|as)?/i, 'CN'], [/israelenses?/i, 'IL'],
  [/iranian[oa]s?/i, 'IR'], [/ucranian[oa]s?/i, 'UA'], [/venezuelan[oa]s?/i, 'VE'], [/portugues(?:a|es|as)?/i, 'PT'],
  [/norte-american[oa]s?/i, 'US'], [/estadunidenses?/i, 'US'],
];

export const URGENCY_CUES: Cue[] = [
  ['urgente', 1], ['breaking', 1], ['agora', 0.6], ['alerta', 0.6], ['alert', 0.6], ['warning', 0.6], ['evacu*', 1],
  ['imediat*', 0.7], ['ao vivo', 0.6], ['live', 0.3], ['nas proximas horas', 0.9], ['proximas horas', 0.8], ['hoje', 0.3],
  ['emergencia', 0.8], ['emergency', 0.8], ['aviso', 0.5], ['ultima hora', 0.8],
];

export const SEVERITY_UP_CUES: Cue[] = [
  ['recorde', 0.12], ['record', 0.1], ['historic*', 0.12], ['maior da historia', 0.2], ['colapso', 0.15], ['crise', 0.12],
  ['crisis', 0.12], ['emergencia', 0.15], ['emergency', 0.15], ['calamidade', 0.25], ['estado de calamidade', 0.3],
  ['catastrof*', 0.25], ['catastroph*', 0.25], ['devasta*', 0.2], ['massive', 0.12], ['grave', 0.1], ['severe', 0.12],
  ['massacre', 0.25], ['genocid*', 0.3], ['desabrigad*', 0.2], ['desalojad*', 0.15], ['displaced', 0.2], ['evacu*', 0.15],
  ['alerta vermelho', 0.3], ['alerta laranja', 0.18], ['pandemi*', 0.25], ['guerra', 0.2], ['war', 0.15], ['nuclear', 0.2],
  ['default', 0.15], ['falencia', 0.12], ['bankrupt*', 0.12], ['disparada', 0.12], ['dispara', 0.1], ['surge*', 0.08], ['soar*', 0.1],
];

export const SEVERITY_DOWN_CUES: Cue[] = [
  ['leve', 0.1], ['minor', 0.1], ['pequeno', 0.05], ['small', 0.05], ['sem feridos', 0.15], ['no injuries', 0.15],
  ['estavel', 0.08], ['stable', 0.08], ['controlad*', 0.1], ['contained', 0.1],
];

export const NATIONAL_SCOPE_CUES: Cue[] = [
  ['nacional', 0.6], ['todo o pais', 1], ['em todo o brasil', 1], ['nationwide', 1], ['todos os estados', 0.9],
  ['governo federal', 0.7], ['brasileiros', 0.5], ['congresso', 0.6], ['stf', 0.6], ['senado', 0.6], ['banco central', 0.8],
  ['selic', 1], ['copom', 1], ['receita federal', 0.7], ['inss', 0.8], ['salario minimo', 1], ['ipca', 0.9], ['federal', 0.4],
  ['petrobras', 0.7], ['anvisa', 0.7], ['enem', 0.9], ['pix', 0.8], ['bolsa familia', 0.9],
];

export const GLOBAL_SCOPE_CUES: Cue[] = [
  ['mundial', 0.6], ['global', 0.7], ['worldwide', 1], ['mundo todo', 1], ['around the world', 0.9], ['pandemi*', 0.9],
  ['opep', 0.9], ['opec', 0.9], ['brent', 0.9], ['petroleo', 0.6], ['oil price*', 0.9], ['federal reserve', 0.8], ['oms', 0.6],
  ['world health organization', 0.8], ['fmi', 0.7], ['imf', 0.7], ['onu', 0.4], ['united nations', 0.4], ['cadeia* de suprimento*', 0.8],
  ['supply chain*', 0.8], ['estreito de ormuz', 1], ['strait of hormuz', 1], ['canal de suez', 0.9], ['suez canal', 0.9],
  ['tarifas de trump', 0.7], ['guerra comercial', 0.9], ['trade war', 0.9],
];
