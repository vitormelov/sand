import type { IncomingMessage, ServerResponse } from 'node:http';
import { createRemoteJWKSet, jwtVerify } from 'jose';
import { reverseGeocode, searchCities } from '../routes/geocode';
import { RateLimiter } from '../routes/rateLimit';

/**
 * City search and GPS → city, for signed-in users. Runs as a Vercel function in production
 * and as Vite middleware in development. The Firebase ID token is checked against Google's
 * public keys, so no service account is needed here — only the project id.
 */

const JWKS = createRemoteJWKSet(new URL('https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com'));
const limiter = new RateLimiter(20, 0.5);

export interface ApiResponse {
  status: number;
  body: unknown;
  headers?: Record<string, string>;
}

/** The uid in a valid Firebase ID token for this project, or undefined. */
export async function verifyIdToken(authorization: string | undefined, projectId = firebaseProjectId()): Promise<string | undefined> {
  const token = /^Bearer (.+)$/.exec(authorization ?? '')?.[1];
  if (!token || !projectId) return undefined;
  try {
    const { payload } = await jwtVerify(token, JWKS, { issuer: `https://securetoken.google.com/${projectId}`, audience: projectId, algorithms: ['RS256'] });
    return typeof payload.sub === 'string' && payload.sub ? payload.sub : undefined;
  } catch {
    return undefined;
  }
}

export function firebaseProjectId(): string | undefined {
  return process.env.FIREBASE_PROJECT_ID || process.env.VITE_FIREBASE_PROJECT_ID || undefined;
}

export async function handleGeocode(url: URL, authorization: string | undefined, verify = verifyIdToken): Promise<ApiResponse> {
  const uid = await verify(authorization);
  if (!uid) return { status: 401, body: { error: 'unauthorized' } };
  if (!limiter.take(uid)) return { status: 429, body: { error: 'rate_limited' }, headers: { 'Retry-After': '10' } };
  const cache = { 'Cache-Control': 'private, max-age=3600' };
  if (url.pathname === '/api/geocode/reverse') {
    const lat = Number(url.searchParams.get('lat'));
    const lon = Number(url.searchParams.get('lon'));
    if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) return { status: 400, body: { error: 'invalid_coordinates' } };
    return { status: 200, body: await reverseGeocode(lat, lon), headers: cache };
  }
  if (url.pathname === '/api/geocode') {
    const lang = /^[a-z]{2}$/.test(url.searchParams.get('lang') ?? '') ? url.searchParams.get('lang')! : 'pt';
    return { status: 200, body: await searchCities(url.searchParams.get('q') ?? '', lang), headers: cache };
  }
  return { status: 404, body: { error: 'not_found' } };
}

/** Node (req, res) adapter: the Vercel function and the Vite dev middleware. */
export async function geocodeNodeHandler(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const url = new URL(req.url ?? '/', 'http://localhost');
  let out: ApiResponse;
  try {
    out = req.method === 'GET' ? await handleGeocode(url, req.headers.authorization) : { status: 405, body: { error: 'method_not_allowed' } };
  } catch {
    out = { status: 500, body: { error: 'internal_error' } };
  }
  res.writeHead(out.status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...out.headers });
  res.end(JSON.stringify(out.body));
}

export default geocodeNodeHandler;
