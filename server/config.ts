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
 * Default public feeds. All are free, keyless and published by their outlets for syndication.
 * SAND only stores/displays title, a short summary and a link to the original.
 */
export const DEFAULT_RSS_FEEDS: RssFeedConfig[] = [
  { id: 'agencia-brasil', name: 'Agência Brasil', url: 'https://agenciabrasil.ebc.com.br/rss/ultimasnoticias/feed.xml', kind: 'agency', reliability: 0.85, country: 'BR', language: 'pt', homepage: 'https://agenciabrasil.ebc.com.br/' },
  { id: 'g1', name: 'g1', url: 'https://g1.globo.com/rss/g1/', kind: 'outlet', reliability: 0.8, country: 'BR', language: 'pt', homepage: 'https://g1.globo.com/' },
  { id: 'g1-economia', name: 'g1 Economia', url: 'https://g1.globo.com/rss/g1/economia/', kind: 'outlet', reliability: 0.8, country: 'BR', language: 'pt', homepage: 'https://g1.globo.com/economia/' },
  { id: 'g1-ce', name: 'g1 Ceará', url: 'https://g1.globo.com/rss/g1/ce/ceara/', kind: 'outlet', reliability: 0.8, country: 'BR', language: 'pt', homepage: 'https://g1.globo.com/ce/ceara/' },
  { id: 'bbc-brasil', name: 'BBC News Brasil', url: 'https://feeds.bbci.co.uk/portuguese/rss.xml', kind: 'outlet', reliability: 0.85, country: 'GB', language: 'pt', homepage: 'https://www.bbc.com/portuguese' },
  { id: 'dw-brasil', name: 'DW Brasil', url: 'https://rss.dw.com/rdf/rss-br-all', kind: 'outlet', reliability: 0.8, country: 'DE', language: 'pt', homepage: 'https://www.dw.com/pt-br/' },
  { id: 'bbc-world', name: 'BBC News — World', url: 'https://feeds.bbci.co.uk/news/world/rss.xml', kind: 'outlet', reliability: 0.85, country: 'GB', language: 'en', homepage: 'https://www.bbc.com/news/world' },
  { id: 'guardian-world', name: 'The Guardian — World', url: 'https://www.theguardian.com/world/rss', kind: 'outlet', reliability: 0.8, country: 'GB', language: 'en', homepage: 'https://www.theguardian.com/world' },
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
    anthropicKey: process.env.ANTHROPIC_API_KEY || undefined,
    model: process.env.LLM_MODEL ?? 'claude-opus-5-5',
    maxCallsPerHour: num('LLM_MAX_CALLS_PER_HOUR', 120),
  },
};

export function buildConnectors(): SourceConnector[] {
  const disabled = new Set((process.env.DISABLED_SOURCES ?? '').split(',').map((s) => s.trim()).filter(Boolean));
  const feeds = parseFeedsEnv() ?? DEFAULT_RSS_FEEDS;
  const connectors: SourceConnector[] = [
    ...feeds.map((f) => rssConnector({ ...f, intervalMs: f.intervalMs ?? num('RSS_INTERVAL_MS', 5 * 60_000) })),
    usgsConnector(),
    gdacsConnector(),
    inmetConnector(),
    gdeltConnector(list('GDELT_QUERIES') ?? DEFAULT_GDELT_QUERIES, process.env.GDELT_TIMESPAN ?? '30min'),
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
