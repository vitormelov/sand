import { countryInfo } from '../../shared/geo/gazetteer';
import type { RawItem } from '../types';
import { httpGet } from './http';
import { HttpError, type FetchContext, type FetchResult, type SourceConnector } from './types';

/**
 * GDELT DOC 2.0 API (no key). Provider rule observed in practice:
 * "Please limit requests to one every 5 seconds" — enforced via minSpacingMs
 * and sequential queries. Returns title/url/time/language/source country, no summary.
 */

const ENDPOINT = 'https://api.gdeltproject.org/api/v2/doc/doc';

// GDELT uses FIPS-style country names in `sourcecountry`; map the ones we care about.
const GDELT_COUNTRY: Record<string, string> = {
  Brazil: 'BR', 'United States': 'US', Portugal: 'PT', Argentina: 'AR', 'United Kingdom': 'GB', Mexico: 'MX', Spain: 'ES',
  France: 'FR', Germany: 'DE', Italy: 'IT', Chile: 'CL', Colombia: 'CO', Peru: 'PE', Canada: 'CA', Japan: 'JP', China: 'CN',
  India: 'IN', Australia: 'AU', Russia: 'RU', Ukraine: 'UA', Israel: 'IL', 'South Africa': 'ZA', Nigeria: 'NG', Angola: 'AO',
  Mozambique: 'MZ',
};

const LANG: Record<string, string> = { Portuguese: 'pt', English: 'en', Spanish: 'es', French: 'fr', German: 'de', Italian: 'it' };

interface GdeltArticle {
  url: string;
  title: string;
  seendate: string;
  domain: string;
  language: string;
  sourcecountry: string;
}

export function mapGdeltArticles(json: string): RawItem[] {
  if (!json.trim().startsWith('{')) throw new HttpError(200, `unexpected GDELT response: ${json.slice(0, 120)}`);
  const data = JSON.parse(json) as { articles?: GdeltArticle[] };
  return (data.articles ?? []).map((a) => {
    const cc = GDELT_COUNTRY[a.sourcecountry];
    return {
      title: a.title,
      url: a.url,
      publishedAt: a.seendate, // GDELT "seen" time — closest available proxy for publication
      language: LANG[a.language] ?? a.language?.slice(0, 2).toLowerCase(),
      sourceName: a.domain,
      sourceCountry: cc && countryInfo(cc) ? cc : undefined,
    };
  });
}

export function gdeltConnector(queries: string[], timespan = '30min', maxRecords = 60): SourceConnector {
  return {
    id: 'gdelt',
    name: 'GDELT Project',
    kind: 'aggregator',
    group: 'aggregators',
    reliability: 0.55,
    homepage: 'https://www.gdeltproject.org/',
    intervalMs: 15 * 60_000,
    minSpacingMs: 6_000,
    enabled: queries.length > 0,
    disabledReason: queries.length ? undefined : 'nenhuma consulta configurada (GDELT_QUERIES)',
    async fetch(ctx: FetchContext): Promise<FetchResult> {
      const items: RawItem[] = [];
      for (let i = 0; i < queries.length; i++) {
        if (i > 0) await new Promise((r) => setTimeout(r, 6_000)); // provider asks for ≥5 s between requests
        const url = `${ENDPOINT}?${new URLSearchParams({
          query: queries[i],
          mode: 'artlist',
          format: 'json',
          sort: 'datedesc',
          maxrecords: String(maxRecords),
          timespan,
        })}`;
        const res = await httpGet(url, { signal: ctx.signal, timeoutMs: 30_000 });
        items.push(...mapGdeltArticles(res.text));
      }
      return { items };
    },
  };
}
