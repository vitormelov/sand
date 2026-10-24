import type { RawItem } from '../types';
import { httpGet } from './http';
import { HttpError, type FetchContext, type FetchResult, type SourceConnector } from './types';

/**
 * NewsAPI.org (optional, requires NEWSAPI_KEY). The key is sent as a header,
 * server-side only. Check your plan's terms: the free Developer plan is meant for
 * development and has request limits and delayed articles.
 */
export function newsApiConnector(apiKey: string | undefined, params: string): SourceConnector {
  return {
    id: 'newsapi',
    name: 'NewsAPI',
    kind: 'aggregator',
    group: 'aggregators',
    reliability: 0.65,
    homepage: 'https://newsapi.org/',
    intervalMs: 30 * 60_000,
    enabled: !!apiKey,
    disabledReason: apiKey ? undefined : 'NEWSAPI_KEY não configurada',
    async fetch(ctx: FetchContext): Promise<FetchResult> {
      if (!apiKey) return { items: [] };
      const path = params.startsWith('everything') || params.startsWith('top-headlines') ? params : `top-headlines?${params}`;
      const res = await httpGet(`https://newsapi.org/v2/${path}`, { signal: ctx.signal, headers: { 'X-Api-Key': apiKey } });
      const data = JSON.parse(res.text) as {
        status: string;
        message?: string;
        articles?: { title?: string; url?: string; description?: string; publishedAt?: string; source?: { name?: string } }[];
      };
      if (data.status !== 'ok') throw new HttpError(200, `NewsAPI: ${data.message ?? data.status}`);
      const items: RawItem[] = (data.articles ?? [])
        .filter((a) => a.title && a.title !== '[Removed]')
        .map((a) => ({ title: a.title, url: a.url, summary: a.description, publishedAt: a.publishedAt, sourceName: a.source?.name }));
      return { items };
    },
  };
}
