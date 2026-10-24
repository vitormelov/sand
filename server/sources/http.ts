import { HttpError, type ConnectorState } from './types';

export const USER_AGENT = 'SAND/0.1 (personal news visualization; respectful polling)';

export interface HttpResponse {
  status: number;
  text: string;
  state: ConnectorState;
}

const MAX_BYTES = 4 * 1024 * 1024;

/**
 * Decode using the declared charset (header, then XML declaration). Several Brazilian feeds
 * (Folha, UOL) send ISO-8859-1 without saying so: when the bytes are not valid UTF-8, fall back
 * to Windows-1252 (a superset of Latin-1).
 */
export function decodeBody(bytes: Uint8Array, contentType: string | null): string {
  const head = new TextDecoder('latin1').decode(bytes.subarray(0, 200));
  const declared = /charset=["']?([\w-]+)/i.exec(contentType ?? '')?.[1] ?? /<\?xml[^>]*encoding=["']([\w-]+)["']/i.exec(head)?.[1];
  if (declared && !/^utf-?8$/i.test(declared)) {
    try {
      return new TextDecoder(declared).decode(bytes);
    } catch {
      /* unknown label (e.g. "pt-br"): sniff below */
    }
  }
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return new TextDecoder('windows-1252').decode(bytes);
  }
}

/** GET with timeout, conditional headers and a response size limit. */
export async function httpGet(
  url: string,
  opts: { signal: AbortSignal; timeoutMs?: number; state?: ConnectorState; headers?: Record<string, string> },
): Promise<HttpResponse> {
  const timeout = AbortSignal.timeout(opts.timeoutMs ?? 20_000);
  const signal = AbortSignal.any([opts.signal, timeout]);
  const headers: Record<string, string> = { 'User-Agent': USER_AGENT, Accept: '*/*', ...opts.headers };
  if (opts.state?.etag) headers['If-None-Match'] = opts.state.etag;
  if (opts.state?.lastModified) headers['If-Modified-Since'] = opts.state.lastModified;

  let res: Response;
  try {
    res = await fetch(url, { headers, signal, redirect: 'follow' });
  } catch (err) {
    if (timeout.aborted) throw new HttpError(0, `timeout after ${opts.timeoutMs ?? 20_000} ms`);
    throw new HttpError(0, `network error: ${(err as Error).message}`);
  }
  const state: ConnectorState = {
    etag: res.headers.get('etag') ?? undefined,
    lastModified: res.headers.get('last-modified') ?? undefined,
  };
  if (res.status === 304) return { status: 304, text: '', state: opts.state ?? state };
  if (!res.ok) {
    const ra = res.headers.get('retry-after');
    const retryAfterMs = ra ? (Number.isFinite(Number(ra)) ? Number(ra) * 1000 : Math.max(0, Date.parse(ra) - Date.now())) : undefined;
    const body = (await res.text().catch(() => '')).slice(0, 160).replace(/\s+/g, ' ');
    throw new HttpError(res.status, `HTTP ${res.status}${body ? `: ${body}` : ''}`, retryAfterMs);
  }
  const len = Number(res.headers.get('content-length') ?? 0);
  if (len > MAX_BYTES) throw new HttpError(res.status, `response too large (${len} bytes)`);
  const bytes = new Uint8Array(await res.arrayBuffer());
  if (bytes.length > MAX_BYTES * 2) throw new HttpError(res.status, 'response too large');
  const text = decodeBody(bytes, res.headers.get('content-type'));
  return { status: res.status, text, state };
}
