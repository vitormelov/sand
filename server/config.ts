import { aneelFlagConnector, ibgeConnector, infoDengueConnector, rsbrConnector } from './sources/brazil';
import { gdeltConnector } from './sources/gdelt';
import { newsApiConnector } from './sources/newsapi';
import { gdacsConnector, inmetConnector, usgsConnector } from './sources/official';
import { rssConnector, type RssFeedConfig } from './sources/rss';
import type { SourceConnector } from './sources/types';

function num(name: string, def: number): number {
  const v = Number(process.env[name]);
  return Number.isFinite(v) && v > 0 ? v : def;
}
function bool(name: string, def: boolean): boolean {
  const v = process.env[name];
  return v == null || v === '' ? def : /^(1|true|yes|on)$/i.test(v);
}
function list(name: string): string[] | undefined {
  const v = process.env[name];
  if (v == null) return undefined;
  return v.split(/\s*\|\|\s*|\n/).map((s) => s.trim()).filter(Boolean);
}

/**
 * Default public feeds — Brazil-focused. All are free, keyless and published by their outlets or
 * agencies for syndication; each was checked with real requests (see README → Fontes).
 * SAND only stores/displays title, a short summary and a link to the original.
 */
const BR = { country: 'BR', language: 'pt' } as const;

/** g1 publishes one feed per state; the URL path also tells the analyzer where the news is. */
export const G1_STATES: [uf: string, slug: string, name: string][] = [
  ['ac', 'acre', 'Acre'], ['al', 'alagoas', 'Alagoas'], ['ap', 'amapa', 'Amapá'], ['am', 'amazonas', 'Amazonas'],
  ['ba', 'bahia', 'Bahia'], ['ce', 'ceara', 'Ceará'], ['df', 'distrito-federal', 'Distrito Federal'], ['es', 'espirito-santo', 'Espírito Santo'],
  ['go', 'goias', 'Goiás'], ['ma', 'maranhao', 'Maranhão'], ['mt', 'mato-grosso', 'Mato Grosso'], ['ms', 'mato-grosso-do-sul', 'Mato Grosso do Sul'],
  ['mg', 'minas-gerais', 'Minas Gerais'], ['pa', 'para', 'Pará'], ['pb', 'paraiba', 'Paraíba'], ['pr', 'parana', 'Paraná'],
  ['pe', 'pernambuco', 'Pernambuco'], ['pi', 'piaui', 'Piauí'], ['rj', 'rio-de-janeiro', 'Rio de Janeiro'], ['rn', 'rio-grande-do-norte', 'Rio Grande do Norte'],
  ['rs', 'rio-grande-do-sul', 'Rio Grande do Sul'], ['ro', 'rondonia', 'Rondônia'], ['rr', 'roraima', 'Roraima'], ['sc', 'santa-catarina', 'Santa Catarina'],
  ['sp', 'sao-paulo', 'São Paulo'], ['se', 'sergipe', 'Sergipe'], ['to', 'tocantins', 'Tocantins'],
];

export const DEFAULT_RSS_FEEDS: RssFeedConfig[] = [
  // National
  { id: 'agencia-brasil', name: 'Agência Brasil', url: 'https://agenciabrasil.ebc.com.br/rss/ultimasnoticias/feed.xml', kind: 'agency', reliability: 0.85, ...BR, group: 'national', homepage: 'https://agenciabrasil.ebc.com.br/' },
  { id: 'g1', name: 'g1', url: 'https://g1.globo.com/rss/g1/', kind: 'outlet', reliability: 0.8, ...BR, group: 'national', homepage: 'https://g1.globo.com/' },
  { id: 'folha', name: 'Folha de S.Paulo', url: 'https://feeds.folha.uol.com.br/emcimadahora/rss091.xml', kind: 'outlet', reliability: 0.82, ...BR, group: 'national', paywall: true, homepage: 'https://www.folha.uol.com.br/' },
  { id: 'estadao', name: 'Estadão', url: 'https://www.estadao.com.br/arc/outboundfeeds/feeds/rss/sections/brasil/', kind: 'outlet', reliability: 0.82, ...BR, group: 'national', paywall: true, homepage: 'https://www.estadao.com.br/' },
  { id: 'oglobo', name: 'O Globo', url: 'https://oglobo.globo.com/rss/oglobo', kind: 'outlet', reliability: 0.8, ...BR, group: 'national', paywall: true, homepage: 'https://oglobo.globo.com/' },
  { id: 'uol', name: 'UOL Notícias', url: 'https://rss.uol.com.br/feed/noticias.xml', kind: 'outlet', reliability: 0.75, ...BR, group: 'national', homepage: 'https://noticias.uol.com.br/' },
  { id: 'cnn-brasil', name: 'CNN Brasil', url: 'https://www.cnnbrasil.com.br/feed/', kind: 'outlet', reliability: 0.75, ...BR, group: 'national', homepage: 'https://www.cnnbrasil.com.br/' },
  { id: 'poder360', name: 'Poder360', url: 'https://www.poder360.com.br/feed/', kind: 'outlet', reliability: 0.78, ...BR, group: 'national', homepage: 'https://www.poder360.com.br/' },
  { id: 'bbc-brasil', name: 'BBC News Brasil', url: 'https://feeds.bbci.co.uk/portuguese/rss.xml', kind: 'outlet', reliability: 0.85, country: 'GB', language: 'pt', group: 'national', homepage: 'https://www.bbc.com/portuguese' },
  { id: 'dw-brasil', name: 'DW Brasil', url: 'https://rss.dw.com/rdf/rss-br-all', kind: 'outlet', reliability: 0.8, country: 'DE', language: 'pt', group: 'national', homepage: 'https://www.dw.com/pt-br/' },
  // Economy
  { id: 'g1-economia', name: 'g1 Economia', url: 'https://g1.globo.com/rss/g1/economia/', kind: 'outlet', reliability: 0.8, ...BR, group: 'economy', homepage: 'https://g1.globo.com/economia/' },
  { id: 'infomoney', name: 'InfoMoney', url: 'https://www.infomoney.com.br/feed/', kind: 'outlet', reliability: 0.75, ...BR, group: 'economy', homepage: 'https://www.infomoney.com.br/' },
  // Official (news published by public bodies)
  { id: 'bcb-copom', name: 'Banco Central — Copom', url: 'https://www.bcb.gov.br/api/feed/sitebcb/sitefeeds/comunicadoscopom', kind: 'official', reliability: 0.95, ...BR, group: 'official', national: true, intervalMs: 30 * 60_000, homepage: 'https://www.bcb.gov.br/' },
  { id: 'bcb-noticias', name: 'Banco Central — Notícias', url: 'https://www.bcb.gov.br/api/feed/sitebcb/sitefeeds/noticias', kind: 'official', reliability: 0.95, ...BR, group: 'official', national: true, intervalMs: 30 * 60_000, homepage: 'https://www.bcb.gov.br/' },
  { id: 'agencia-senado', name: 'Agência Senado', url: 'https://www12.senado.leg.br/noticias/rss', kind: 'official', reliability: 0.88, ...BR, group: 'official', national: true, intervalMs: 15 * 60_000, homepage: 'https://www12.senado.leg.br/noticias' },
  { id: 'agencia-camara', name: 'Agência Câmara', url: 'https://www.camara.leg.br/noticias/rss/ultimas-noticias', kind: 'official', reliability: 0.88, ...BR, group: 'official', national: true, intervalMs: 15 * 60_000, homepage: 'https://www.camara.leg.br/noticias' },
  { id: 'receita-federal', name: 'Receita Federal', url: 'https://www.gov.br/receitafederal/pt-br/assuntos/noticias/RSS', kind: 'official', reliability: 0.92, ...BR, group: 'official', national: true, intervalMs: 60 * 60_000, homepage: 'https://www.gov.br/receitafederal/' },
  { id: 'cert-br', name: 'CERT.br — Segurança na internet', url: 'https://cert.br/rss/certbr-rss.xml', kind: 'official', reliability: 0.9, ...BR, group: 'official', intervalMs: 6 * 60 * 60_000, homepage: 'https://cert.br/' },
  // Climate and environment
  { id: 'metsul', name: 'MetSul Meteorologia', url: 'https://metsul.com/feed/', kind: 'outlet', reliability: 0.8, ...BR, group: 'climate', intervalMs: 15 * 60_000, homepage: 'https://metsul.com/' },
  { id: 'climainfo', name: 'ClimaInfo', url: 'https://climainfo.org.br/feed/', kind: 'outlet', reliability: 0.75, ...BR, group: 'climate', intervalMs: 30 * 60_000, homepage: 'https://climainfo.org.br/' },
  { id: 'oeco', name: '((o))eco', url: 'https://oeco.org.br/feed/', kind: 'outlet', reliability: 0.78, ...BR, group: 'climate', intervalMs: 30 * 60_000, homepage: 'https://oeco.org.br/' },
  { id: 'mongabay-brasil', name: 'Mongabay Brasil', url: 'https://brasil.mongabay.com/feed/', kind: 'outlet', reliability: 0.78, ...BR, group: 'climate', intervalMs: 30 * 60_000, homepage: 'https://brasil.mongabay.com/' },
  // Sports
  { id: 'ge', name: 'ge (globo esporte)', url: 'https://ge.globo.com/rss/ge/', kind: 'outlet', reliability: 0.8, ...BR, group: 'sports', homepage: 'https://ge.globo.com/' },
  // Regional ('g1-ce' keeps its original id, so users who switched it off keep their choice)
  ...G1_STATES.map(([uf, slug, name]): RssFeedConfig => ({
    id: `g1-${uf}`,
    name: `g1 ${name}`,
    url: `https://g1.globo.com/rss/g1/${uf}/${slug}/`,
    kind: 'outlet',
    reliability: 0.8,
    ...BR,
    group: 'regional',
    intervalMs: 15 * 60_000,
    homepage: `https://g1.globo.com/${uf}/${slug}/`,
  })),
  { id: 'gazeta-do-povo', name: 'Gazeta do Povo (PR)', url: 'https://www.gazetadopovo.com.br/feed/rss/ultimas-noticias.xml', kind: 'outlet', reliability: 0.75, ...BR, group: 'regional', paywall: true, homepage: 'https://www.gazetadopovo.com.br/' },
  { id: 'estado-de-minas', name: 'Estado de Minas (MG)', url: 'https://www.em.com.br/feed/', kind: 'outlet', reliability: 0.75, ...BR, group: 'regional', homepage: 'https://www.em.com.br/' },
  { id: 'a-tarde', name: 'A Tarde (BA)', url: 'https://atarde.com.br/rss', kind: 'outlet', reliability: 0.72, ...BR, group: 'regional', homepage: 'https://atarde.com.br/' },
];

/** English-language feeds: off by default now that SAND is Brazil-only (ENABLE_INTERNATIONAL=1 turns them on). */
export const INTERNATIONAL_RSS_FEEDS: RssFeedConfig[] = [
  { id: 'bbc-world', name: 'BBC News — World', url: 'https://feeds.bbci.co.uk/news/world/rss.xml', kind: 'outlet', reliability: 0.85, country: 'GB', language: 'en', group: 'international', homepage: 'https://www.bbc.com/news/world' },
  { id: 'guardian-world', name: 'The Guardian — World', url: 'https://www.theguardian.com/world/rss', kind: 'outlet', reliability: 0.8, country: 'GB', language: 'en', group: 'international', homepage: 'https://www.theguardian.com/world' },
];

export const DEFAULT_GDELT_QUERIES = [
  'sourcecountry:brazil sourcelang:portuguese',
  '(inflation OR "oil prices" OR earthquake OR outbreak OR "interest rates" OR hurricane) sourcelang:english',
];

function parseFeedsEnv(): RssFeedConfig[] | undefined {
  const raw = process.env.RSS_FEEDS_JSON;
  if (!raw) return undefined;
  try {
    const arr = JSON.parse(raw) as RssFeedConfig[];
    return arr.filter((f) => f && f.id && f.url && /^https?:\/\//.test(f.url));
  } catch {
    console.warn('[config] RSS_FEEDS_JSON inválido — usando feeds padrão');
    return undefined;
  }
}

const production = process.env.NODE_ENV === 'production';

export const config = {
  // In production PORT is the platform's convention. In development the API has its own
  // variable, so a PORT meant for the web dev server never collides with it.
  port: production ? num('PORT', 8787) : num('SAND_API_PORT', 8787),
  host: process.env.HOST ?? '0.0.0.0',
  production,
  databasePath: process.env.DATABASE_PATH ?? 'data/sand.db',
  retentionHours: num('RETENTION_HOURS', 48),
  snapshotLimit: num('SNAPSHOT_LIMIT', 400),
  ingestion: bool('INGESTION_ENABLED', true),
  maxSseClients: num('MAX_SSE_CLIENTS', 500),
  maxSsePerIp: num('MAX_SSE_PER_IP', 6),
  corsOrigin: process.env.CORS_ORIGIN,
  llm: {
    // Off unless explicitly enabled: a key that merely exists in the host environment
    // never turns AI on (and never spends tokens) by accident.
    enabled: bool('LLM_ENABLED', false),
    anthropicKey: bool('LLM_ENABLED', false) ? process.env.ANTHROPIC_API_KEY || undefined : undefined,
    model: process.env.LLM_MODEL ?? 'claude-opus-5-5',
    maxCallsPerHour: num('LLM_MAX_CALLS_PER_HOUR', 120),
  },
};

export function buildConnectors(): SourceConnector[] {
  const disabled = new Set((process.env.DISABLED_SOURCES ?? '').split(',').map((s) => s.trim()).filter(Boolean));
  const feeds = parseFeedsEnv() ?? [...DEFAULT_RSS_FEEDS, ...(bool('ENABLE_INTERNATIONAL', false) ? INTERNATIONAL_RSS_FEEDS : [])];
  const gdelt = gdeltConnector(list('GDELT_QUERIES') ?? DEFAULT_GDELT_QUERIES, process.env.GDELT_TIMESPAN ?? '30min');
  if (!bool('GDELT_ENABLED', false)) {
    // Repeatedly unreachable/rate-limited here, and it mostly duplicates the RSS feeds.
    gdelt.enabled = false;
    gdelt.disabledReason = 'desligada por padrão (GDELT_ENABLED=1 para ligar)';
  }
  const connectors: SourceConnector[] = [
    ...feeds.map((f) => rssConnector({ ...f, intervalMs: f.intervalMs ?? num('RSS_INTERVAL_MS', 5 * 60_000) })),
    inmetConnector(),
    ibgeConnector(),
    aneelFlagConnector(),
    infoDengueConnector(),
    rsbrConnector(),
    usgsConnector(),
    gdacsConnector(),
    gdelt,
    newsApiConnector(process.env.NEWSAPI_KEY || undefined, process.env.NEWSAPI_PARAMS ?? 'everything?q=Brasil&language=pt&sortBy=publishedAt&pageSize=50'),
  ];
  for (const c of connectors) {
    if (disabled.has(c.id)) {
      c.enabled = false;
      c.disabledReason = 'desativada via DISABLED_SOURCES';
    }
  }
  return connectors;
}
