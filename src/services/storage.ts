import { CATEGORIES, type Category, type UserLocation } from '../../shared/types';

/**
 * Preferences live only in this browser (localStorage). Nothing here is sent
 * to the server: impact is computed locally from the user's city and interests.
 */

export type ReducedMotionPref = 'auto' | 'on' | 'off';

export interface Prefs {
  version: 1;
  onboarded: boolean;
  location?: UserLocation;
  interests: Category[];
  affinity: Partial<Record<Category, number>>;
  density: 'low' | 'normal' | 'high';
  speed: number;
  gravity: number;
  sizeScale: number;
  reducedMotion: ReducedMotionPref;
  showIndicators: boolean;
  ambient: boolean;
  sound: boolean;
  criticalAlerts: boolean;
  showMap: boolean;
  /** Multiplier for the strength of the map lines (1 = default). */
  mapIntensity: number;
  /** A balloon with the news title rides beside each grain while it falls. */
  fallingTitles: boolean;
  /** Show only news from the last N hours (12–48). */
  windowHours: number;
  /** 'organized': grains fall by impact, lowest on the left, highest on the right. */
  layout: 'natural' | 'organized';
  /** Main categories the user chose not to see fall. */
  hiddenCategories: Category[];
  theme: 'auto' | 'light' | 'dark';
}

export const DEFAULT_PREFS: Prefs = {
  version: 1,
  onboarded: false,
  interests: [],
  affinity: {},
  density: 'normal',
  speed: 1,
  gravity: 1,
  sizeScale: 1,
  reducedMotion: 'auto',
  showIndicators: true,
  ambient: true,
  sound: false,
  criticalAlerts: true,
  showMap: true,
  mapIntensity: 1,
  fallingTitles: true,
  windowHours: 48,
  layout: 'natural',
  hiddenCategories: [],
  // First visit: black background. People can switch to light or to the system setting.
  theme: 'dark',
};

const KEY = 'sand:prefs:v1';
const FEEDBACK_KEY = 'sand:feedback:v1';

const num = (v: unknown, lo: number, hi: number, def: number) => (typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : def);
const str = (v: unknown, max = 80) => (typeof v === 'string' ? v.slice(0, max) : undefined);

/** Validates whatever is in storage — it may be stale, edited or corrupted. */
export function sanitizePrefs(raw: unknown): Prefs {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, any>;
  const loc = r.location as Record<string, unknown> | undefined;
  const location: UserLocation | undefined =
    loc && typeof loc.name === 'string' && typeof loc.countryCode === 'string'
      ? {
          name: str(loc.name)!,
          admin1: str(loc.admin1, 10),
          admin1Name: str(loc.admin1Name),
          countryCode: str(loc.countryCode, 2)!.toUpperCase(),
          countryName: str(loc.countryName) ?? str(loc.countryCode, 2)!,
          lat: typeof loc.lat === 'number' ? Math.round(loc.lat * 10) / 10 : undefined,
          lon: typeof loc.lon === 'number' ? Math.round(loc.lon * 10) / 10 : undefined,
        }
      : undefined;
  const affinity: Partial<Record<Category, number>> = {};
  for (const c of CATEGORIES) if (typeof r.affinity?.[c] === 'number') affinity[c] = num(r.affinity[c], -10, 10, 0);
  return {
    version: 1,
    onboarded: r.onboarded === true,
    location,
    interests: Array.isArray(r.interests) ? r.interests.filter((c: unknown): c is Category => CATEGORIES.includes(c as Category)) : [],
    affinity,
    density: ['low', 'normal', 'high'].includes(r.density) ? r.density : DEFAULT_PREFS.density,
    speed: num(r.speed, 0.25, 2, 1),
    gravity: num(r.gravity, 0.4, 2, 1),
    sizeScale: num(r.sizeScale, 0.6, 1.6, 1),
    reducedMotion: ['auto', 'on', 'off'].includes(r.reducedMotion) ? r.reducedMotion : 'auto',
    showIndicators: typeof r.showIndicators === 'boolean' ? r.showIndicators : true,
    ambient: typeof r.ambient === 'boolean' ? r.ambient : true,
    sound: r.sound === true,
    criticalAlerts: typeof r.criticalAlerts === 'boolean' ? r.criticalAlerts : true,
    showMap: typeof r.showMap === 'boolean' ? r.showMap : true,
    mapIntensity: num(r.mapIntensity, 0.2, 2, 1),
    fallingTitles: typeof r.fallingTitles === 'boolean' ? r.fallingTitles : true,
    windowHours: Math.round(num(r.windowHours, 12, 48, 48)),
    layout: r.layout === 'organized' ? 'organized' : 'natural',
    hiddenCategories: Array.isArray(r.hiddenCategories) ? CATEGORIES.filter((c) => r.hiddenCategories.includes(c)) : [],
    theme: ['auto', 'light', 'dark'].includes(r.theme) ? r.theme : DEFAULT_PREFS.theme,
  };
}

export function loadPrefs(): Prefs {
  try {
    const s = localStorage.getItem(KEY);
    return s ? sanitizePrefs(JSON.parse(s)) : { ...DEFAULT_PREFS };
  } catch {
    return { ...DEFAULT_PREFS };
  }
}

export function savePrefs(p: Prefs): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(p));
  } catch {
    /* storage unavailable (private mode): preferences last for this session only */
  }
}

export type FeedbackValue = 'relevant' | 'not_relevant';

export function loadFeedback(): Record<string, FeedbackValue> {
  try {
    const raw = JSON.parse(localStorage.getItem(FEEDBACK_KEY) ?? '{}') as Record<string, unknown>;
    const out: Record<string, FeedbackValue> = {};
    for (const [k, v] of Object.entries(raw)) if (v === 'relevant' || v === 'not_relevant') out[k] = v;
    return out;
  } catch {
    return {};
  }
}

export function saveFeedback(map: Record<string, FeedbackValue>): void {
  try {
    const entries = Object.entries(map).slice(-500);
    localStorage.setItem(FEEDBACK_KEY, JSON.stringify(Object.fromEntries(entries)));
  } catch {
    /* ignore */
  }
}

export function clearAllLocal(): void {
  try {
    localStorage.removeItem(KEY);
    localStorage.removeItem(FEEDBACK_KEY);
  } catch {
    /* ignore */
  }
}
