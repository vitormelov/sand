import { sanitizeProfile, sanitizeSaved, type SavedItem, type StoredProfile } from '../../shared/profile';
import type { UserLocation } from '../../shared/types';

/** Header every state-changing request carries (server-side CSRF check). */
export const CSRF_HEADERS = { 'Content-Type': 'application/json', 'X-Sand': '1' };

export interface Me {
  email: string;
  profile: StoredProfile | null;
  /** Ids of news this user already opened. */
  viewed: string[];
  saved: SavedItem[];
}

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
  ) {
    super(code);
  }
}

async function call<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(path, { credentials: 'same-origin', ...init, headers: { ...(init.method && init.method !== 'GET' ? CSRF_HEADERS : {}), ...init.headers } });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(res.status, (body as { error?: string }).error ?? `http_${res.status}`);
  return body as T;
}

function toMe(r: { user: { email: string }; profile: unknown; viewed?: unknown; saved?: unknown }): Me {
  return {
    email: r.user.email,
    profile: r.profile ? sanitizeProfile(r.profile) : null,
    viewed: Array.isArray(r.viewed) ? r.viewed.filter((x): x is string => typeof x === 'string') : [],
    saved: Array.isArray(r.saved) ? r.saved.map(sanitizeSaved).filter((x): x is SavedItem => !!x) : [],
  };
}

/** Current session, or null when not logged in. */
export async function fetchMe(): Promise<Me | null> {
  try {
    return toMe(await call('/api/me'));
  } catch (e) {
    if (e instanceof ApiError && e.status === 401) return null;
    throw e;
  }
}

export async function register(email: string, password: string): Promise<Me> {
  return toMe(await call('/api/auth/register', { method: 'POST', body: JSON.stringify({ email, password }) }));
}

export async function login(email: string, password: string): Promise<Me> {
  return toMe(await call('/api/auth/login', { method: 'POST', body: JSON.stringify({ email, password }) }));
}

export async function logout(): Promise<void> {
  await call('/api/auth/logout', { method: 'POST', body: '{}' }).catch(() => undefined);
}

export async function saveProfile(p: StoredProfile): Promise<StoredProfile> {
  const r = await call<{ profile: unknown }>('/api/me/profile', { method: 'PUT', body: JSON.stringify(p) });
  return sanitizeProfile(r.profile);
}

export async function changePassword(current: string, next: string): Promise<void> {
  await call('/api/me/password', { method: 'POST', body: JSON.stringify({ current, next }) });
}

export async function deleteAccount(password: string): Promise<void> {
  await call('/api/me', { method: 'DELETE', body: JSON.stringify({ password }) });
}

export async function markViewed(ids: string[]): Promise<void> {
  if (ids.length) await call('/api/me/viewed', { method: 'POST', body: JSON.stringify({ ids }) });
}

export async function saveItem(item: SavedItem): Promise<void> {
  await call(`/api/me/saved/${item.id}`, { method: 'PUT', body: JSON.stringify(item) });
}

export async function unsaveItem(id: string): Promise<void> {
  await call(`/api/me/saved/${id}`, { method: 'DELETE', body: '{}' });
}

/** GPS → city. The browser rounds to ~11 km before sending; the server rounds again. */
export async function reverseGeocode(lat: number, lon: number): Promise<UserLocation | null> {
  const r = await call<{ result: UserLocation | null }>(`/api/geocode/reverse?lat=${lat.toFixed(1)}&lon=${lon.toFixed(1)}`);
  return r.result;
}

export const ERROR_TEXT: Record<string, string> = {
  invalid_email: 'E-mail inválido.',
  weak_password: 'A senha precisa ter pelo menos 8 caracteres.',
  email_taken: 'Já existe uma conta com este e-mail.',
  invalid_credentials: 'E-mail ou senha incorretos.',
  rate_limited: 'Muitas tentativas. Aguarde um minuto e tente de novo.',
};
