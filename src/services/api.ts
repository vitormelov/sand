import type { UserLocation } from '../../shared/types';
import type { FeedbackValue } from './storage';

export async function searchCities(q: string, signal?: AbortSignal): Promise<{ results: UserLocation[]; source: string }> {
  const res = await fetch(`/api/geocode?${new URLSearchParams({ q, lang: 'pt' })}`, { signal });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

/** Anonymous aggregate: only the event id and the vote are sent — never the profile. */
export async function sendFeedback(eventId: string, value: FeedbackValue): Promise<void> {
  try {
    await fetch('/api/feedback', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ eventId, value }),
    });
  } catch {
    /* feedback is best-effort; the local preference is already saved */
  }
}

/** Only http(s) links are ever opened. */
export function safeExternalUrl(url: string | undefined): string | undefined {
  if (!url) return undefined;
  try {
    const u = new URL(url);
    return u.protocol === 'http:' || u.protocol === 'https:' ? u.toString() : undefined;
  } catch {
    return undefined;
  }
}
