export function stripAccents(s: string): string {
  return s.normalize('NFD').replace(/\p{M}+/gu, '');
}

/** Lowercase, accent-free, punctuation collapsed — for keyword matching. */
export function normalizeForMatch(s: string): string {
  return ` ${stripAccents(s)
    .toLowerCase()
    .replace(/[^\p{L}\p{N}%$]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()} `;
}

const STOPWORDS = new Set(
  (
    // pt
    'a o as os um uma uns umas de do da dos das no na nos nas em por para pra com sem sob sobre ' +
    'e ou mas que se ao aos à às pelo pela pelos pelas seu sua seus suas ele ela eles elas isso esse essa este esta ' +
    'como mais menos ja já nao não sim foi sao são ser esta está estao estão tem têm ter apos após ate até entre ' +
    'diz dizem afirma segundo contra durante ainda quando onde qual quais quem novo nova novos novas ' +
    'ano anos dia dias hoje ontem amanha amanhã veja saiba entenda video vídeo fotos ' +
    // en
    'the a an of to in on for with without by at from and or but is are was were be been has have had ' +
    'it its this that these those as after before over under into about says said new what how why who ' +
    'will would can could more most than up out his her their they we you not no video live ' +
    // es
    'el la los las un una del al y en por para con sin que es son fue'
  ).split(/\s+/),
);

/** Content tokens for similarity (clustering / dedup). */
export function contentTokens(s: string): string[] {
  return normalizeForMatch(s)
    .trim()
    .split(' ')
    .filter((w) => w.length >= 3 && !STOPWORDS.has(w))
    .map((w) => (w.length > 4 && w.endsWith('s') ? w.slice(0, -1) : w));
}

export function jaccard<T>(a: Set<T>, b: Set<T>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let inter = 0;
  for (const x of a) if (b.has(x)) inter++;
  return inter / (a.size + b.size - inter);
}

/** Small, fast non-cryptographic hash (cyrb53) — stable ids in browser and server. */
export function hashString(str: string, seed = 0): string {
  let h1 = 0xdeadbeef ^ seed;
  let h2 = 0x41c6ce57 ^ seed;
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
}

export function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

export function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Great-circle distance in km. */
export function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(a)));
}
