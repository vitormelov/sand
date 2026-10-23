import { XMLParser } from 'fast-xml-parser';
import type { RawItem } from '../types';
import { httpGet } from './http';
import type { FetchContext, FetchResult, SourceConnector } from './types';
import type { SourceKind } from '../../shared/types';

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  textNodeName: '#text',
  processEntities: false, // decoded later by toPlainText; avoids entity-expansion abuse
  htmlEntities: false,
  trimValues: true,
});

function asArray<T>(v: T | T[] | undefined): T[] {
  return v == null ? [] : Array.isArray(v) ? v : [v];
}

function text(v: unknown): string | undefined {
  if (v == null) return undefined;
  if (typeof v === 'string' || typeof v === 'number') return String(v);
  if (typeof v === 'object' && '#text' in (v as object)) return String((v as Record<string, unknown>)['#text']);
  return undefined;
}

function atomLink(v: unknown): string | undefined {
  for (const l of asArray(v as Record<string, string> | Record<string, string>[])) {
    if (typeof l === 'string') return l;
    if (l && (!l['@_rel'] || l['@_rel'] === 'alternate') && l['@_href']) return l['@_href'];
  }
  return undefined;
}

/** Parse RSS 2.0, RSS 1.0 (RDF) and Atom into raw items. Tolerates partial/malformed entries. */
export function parseFeed(xml: string): { items: Array<Record<string, unknown>>; rawItems: RawItem[] } {
  const doc = parser.parse(xml) as Record<string, any>;
  const channel = doc?.rss?.channel ?? doc?.['rdf:RDF'] ?? doc?.feed ?? {};
  const items: Array<Record<string, unknown>> = asArray(channel.item ?? doc?.['rdf:RDF']?.item ?? channel.entry);
  const rawItems: RawItem[] = [];
  for (const it of items) {
    if (!it || typeof it !== 'object') continue;
    const title = text(it.title);
    const url = text(it.link) && !String(text(it.link)).startsWith('[object') ? text(it.link) : atomLink(it.link) ?? text(it.guid);
    const summary = text(it['atom:subtitle']) ?? text(it.description) ?? text(it.summary) ?? text(it['content:encoded']) ?? text(it.content);
    const publishedAt = text(it.pubDate) ?? text(it['dc:date']) ?? text(it.published) ?? text(it.updated);
    rawItems.push({ title, url, summary, publishedAt });
  }
  return { items, rawItems };
}

export interface RssFeedConfig {
  id: string;
  name: string;
  url: string;
  kind: SourceKind;
  reliability: number;
  country?: string;
  language?: string;
  homepage?: string;
  intervalMs?: number;
}

export function rssConnector(cfg: RssFeedConfig): SourceConnector {
  return {
    ...cfg,
    intervalMs: cfg.intervalMs ?? 5 * 60_000,
    enabled: true,
    async fetch(ctx: FetchContext): Promise<FetchResult> {
      const res = await httpGet(cfg.url, {
        signal: ctx.signal,
        state: ctx.state,
        headers: { Accept: 'application/rss+xml, application/atom+xml, application/xml;q=0.9, text/xml;q=0.8' },
      });
      if (res.status === 304) return { items: [], notModified: true, state: res.state };
      const { rawItems } = parseFeed(res.text);
      return { items: rawItems.slice(0, 80), state: res.state };
    },
  };
}
