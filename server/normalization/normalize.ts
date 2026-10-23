import { hashString } from '../../shared/text';
import type { SourceKind } from '../../shared/types';
import type { NormalizedArticle, RawItem } from '../types';

const TRACKING_PARAMS = /^(utm_.*|fbclid|gclid|mc_cid|mc_eid|cmpid|ref|ref_src|at_.*|ito|ns_.*|xtor|origin|ocid|_ga)$/i;

/** Canonical form of a URL for de-duplication. Returns undefined for non-http(s) URLs. */
export function canonicalUrl(input: string): string | undefined {
  let u: URL;
  try {
    u = new URL(input.trim());
  } catch {
    return undefined;
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return undefined;
  u.protocol = 'https:';
  u.hash = '';
  u.hostname = u.hostname.toLowerCase().replace(/^(www|m|amp|mobile)\./, '');
  const keep = [...u.searchParams.entries()].filter(([k]) => !TRACKING_PARAMS.test(k)).sort(([a], [b]) => a.localeCompare(b));
  u.search = '';
  for (const [k, v] of keep) u.searchParams.append(k, v);
  if (u.pathname !== '/') u.pathname = u.pathname.replace(/\/amp\/?$/, '').replace(/\/+$/, '') || '/';
  return u.toString();
}

/** Only http(s) links are ever handed to the browser. */
export function safeHttpUrl(input?: string): string | undefined {
  if (!input) return undefined;
  try {
    const u = new URL(input.trim());
    return u.protocol === 'http:' || u.protocol === 'https:' ? u.toString() : undefined;
  } catch {
    return undefined;
  }
}

const ENTITIES: Record<string, string> = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', ndash: '–', mdash: '—', hellip: '…',
  lsquo: '‘', rsquo: '’', ldquo: '“', rdquo: '”', laquo: '«', raquo: '»', middot: '·', bull: '•',
  aacute: 'á', eacute: 'é', iacute: 'í', oacute: 'ó', uacute: 'ú', atilde: 'ã', otilde: 'õ', ccedil: 'ç',
  acirc: 'â', ecirc: 'ê', ocirc: 'ô', agrave: 'à', Aacute: 'Á', Eacute: 'É', Iacute: 'Í', Oacute: 'Ó',
  Uacute: 'Ú', Atilde: 'Ã', Otilde: 'Õ', Ccedil: 'Ç', Acirc: 'Â', Ecirc: 'Ê', Ocirc: 'Ô', uuml: 'ü',
};

export function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
    if (e[0] === '#') {
      const code = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code < 0x110000 ? String.fromCodePoint(code) : '';
    }
    return ENTITIES[e] ?? m;
  });
}

/** HTML → plain text. Feeds may contain markup; SAND never renders it. */
export function toPlainText(input: unknown, maxLen = 0): string {
  if (input == null) return '';
  let s = typeof input === 'string' ? input : typeof input === 'object' && '#text' in (input as object) ? String((input as { '#text': unknown })['#text']) : String(input);
  // Entities first: some feeds double-encode markup (&lt;p&gt;).
  if (/&lt;\/?[a-z]/i.test(s)) s = decodeEntities(s);
  s = s
    .replace(/<(script|style|iframe|noscript)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<\/(p|div|li|h\d)>/gi, ' ')
    .replace(/<[^>]*>/g, ' ');
  s = decodeEntities(s)
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '')
    .replace(/📲.*$/u, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (maxLen > 0 && s.length > maxLen) {
    const cut = s.slice(0, maxLen);
    const at = cut.lastIndexOf(' ');
    s = `${cut.slice(0, at > maxLen * 0.6 ? at : maxLen).trim()}…`;
  }
  return s;
}

/** Parse feed dates (RFC 822, ISO 8601, GDELT "20261023T201500Z", epoch ms). Rejects implausible values. */
export function parseDate(v: unknown, now = Date.now()): string | undefined {
  if (v == null || v === '') return undefined;
  let t: number;
  if (typeof v === 'number') t = v;
  else if (v instanceof Date) t = v.getTime();
  else {
    const s = String(v).trim();
    const g = /^(\d{4})(\d{2})(\d{2})T?(\d{2})(\d{2})(\d{2})Z?$/.exec(s);
    t = g ? Date.UTC(+g[1], +g[2] - 1, +g[3], +g[4], +g[5], +g[6]) : Date.parse(s);
  }
  if (!Number.isFinite(t)) return undefined;
  if (t > now + 10 * 60_000) return undefined; // future-dated: not trustworthy
  if (t < Date.UTC(2000, 0, 1)) return undefined;
  return new Date(t).toISOString();
}

export interface SourceMeta {
  id: string;
  name: string;
  kind: SourceKind;
  reliability: number;
  country?: string;
  language?: string;
  homepage?: string;
}

export function normalizeItem(raw: RawItem, source: SourceMeta, fetchedAt: string, now = Date.now()): NormalizedArticle | null {
  const url = safeHttpUrl(raw.url);
  const canonical = url && canonicalUrl(url);
  const title = toPlainText(raw.title, 300);
  if (!url || !canonical || title.length < 8) return null;
  let summary = toPlainText(raw.summary, 420) || undefined;
  if (summary && summary.toLowerCase() === title.toLowerCase()) summary = undefined;
  return {
    id: hashString(canonical),
    canonicalUrl: canonical,
    url,
    title,
    summary,
    sourceId: source.id,
    sourceName: toPlainText(raw.sourceName, 80) || source.name,
    sourceUrl: source.homepage,
    sourceKind: source.kind,
    sourceReliability: source.reliability,
    sourceCountry: raw.sourceCountry ?? source.country,
    language: (raw.language ?? source.language)?.toLowerCase().slice(0, 5),
    publishedAt: parseDate(raw.publishedAt, now),
    occurredAt: parseDate(raw.occurredAt, now),
    fetchedAt,
    hints: raw.hints ?? {},
  };
}
