import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { INTEREST } from '../shared/impact/config';
import type { SavedItem, StoredProfile } from '../shared/profile';
import type { Category } from '../shared/types';
import { Clock } from './components/Clock';
import { EventDetails, EventPreview } from './components/EventDetails';
import { LabPanel } from './components/LabPanel';
import { LeaderLine } from './components/LeaderLine';
import { IconBookmark, IconList, IconSettings } from './components/icons';
import { SavedList } from './components/SavedList';
import { Questionnaire } from './components/Questionnaire';
import { markViewed, saveItem, saveProfile, unsaveItem } from './services/account';
import { ParticleCanvas, type GrainRef } from './components/ParticleCanvas';
import { WorldMap } from './components/WorldMap';
import { eventPoints } from './map/eventPoints';
import { loadWorld } from './map/worldData';
import { PrivacyDialog } from './components/PrivacyDialog';
import { RecentList } from './components/RecentList';
import { SettingsPanel } from './components/SettingsPanel';
import { StatusBar, connectionText } from './components/StatusBar';
import { sendFeedback } from './services/api';
import { startDemo } from './services/demo';
import { clearAllLocal, DEFAULT_PREFS, loadFeedback, loadPrefs, saveFeedback, savePrefs, type FeedbackValue, type Prefs } from './services/storage';
import { StreamClient } from './services/stream';
import { viewScale, type SandSimulation, type SimSettings } from './simulation/SandSimulation';
import { SandStore, useStoreState } from './state/store';
import { useTheme } from './services/theme';

const IDLE_MS = 4_000;

/** Logged-in account. Without one (lab/demo), the profile lives only in this browser. */
export interface AccountProps {
  email: string;
  profile: StoredProfile;
  viewed?: string[];
  saved?: SavedItem[];
  onLogout: () => void;
  onDeleted: () => void;
}

function localProfile(p: Prefs): StoredProfile {
  return { location: p.location, interests: p.interests, affinity: p.affinity, onboarded: true };
}

function usePrefersReducedMotion(): boolean {
  const q = typeof window !== 'undefined' && window.matchMedia ? window.matchMedia('(prefers-reduced-motion: reduce)') : null;
  const [v, setV] = useState(q?.matches ?? false);
  useEffect(() => {
    if (!q) return;
    const on = () => setV(q.matches);
    q.addEventListener('change', on);
    return () => q.removeEventListener('change', on);
  }, [q]);
  return v;
}

type Panel = 'none' | 'settings' | 'recent' | 'saved';

const VIEWED_KEY = 'sand:viewed:v1';
const SAVED_KEY = 'sand:saved:v1';
function readLocal<T>(key: string, fallback: T): T {
  try {
    return (JSON.parse(localStorage.getItem(key) ?? 'null') as T) ?? fallback;
  } catch {
    return fallback;
  }
}
function writeLocal(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* private mode: kept for this session only */
  }
}

const query = new URLSearchParams(window.location.search);

export function App({ demo: demoProp = query.has('demo'), lab = query.has('lab'), account }: { demo?: boolean; lab?: boolean; account?: AccountProps }) {
  // The lab is a fictitious-data mode too: the real stream is never connected there.
  const demo = demoProp || lab;
  const [prefs, setPrefs] = useState<Prefs>(loadPrefs);
  const [profile, setProfile] = useState<StoredProfile>(() => account?.profile ?? localProfile(loadPrefs()));
  const [questionnaire, setQuestionnaire] = useState(!!account && !account.profile.onboarded);
  const saveTimer = useRef<ReturnType<typeof setTimeout>>();
  /** Profile changes are saved to the account (debounced) or, without one, to this browser. */
  const updateProfile = useCallback(
    (next: StoredProfile) => {
      setProfile(next);
      if (account) {
        clearTimeout(saveTimer.current);
        saveTimer.current = setTimeout(() => void saveProfile(next).catch(() => undefined), 600);
      } else {
        setPrefs((p) => ({ ...p, location: next.location, interests: next.interests, affinity: next.affinity }));
      }
    },
    [account],
  );
  const [feedback, setFeedback] = useState(loadFeedback);
  const store = useMemo(() => {
    const s = new SandStore(profile, demo);
    s.setHiddenSources(profile.hiddenSources ?? []);
    return s;
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const ui = useStoreState(store);
  useEffect(() => store.setHiddenSources(profile.hiddenSources ?? []), [profile.hiddenSources, store]);
  const simRef = useRef<SandSimulation | null>(null);
  // --- Seen and saved news -------------------------------------------------------
  // Kept in the account (or, in lab/demo, only in this browser).
  const [viewed, setViewed] = useState<Set<string>>(() => new Set(account?.viewed ?? readLocal<string[]>(VIEWED_KEY, [])));
  const [saved, setSaved] = useState<SavedItem[]>(() => account?.saved ?? readLocal<SavedItem[]>(SAVED_KEY, []));
  const pendingViewed = useRef<string[]>([]);
  const viewedTimer = useRef<ReturnType<typeof setTimeout>>();
  useEffect(() => {
    simRef.current?.setViewed(viewed);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const markSeen = useCallback(
    (id: string) => {
      if (viewed.has(id)) return;
      const next = new Set(viewed).add(id);
      setViewed(next);
      simRef.current?.markViewed(id);
      if (!account) return writeLocal(VIEWED_KEY, [...next].slice(-2000));
      pendingViewed.current.push(id);
      clearTimeout(viewedTimer.current);
      viewedTimer.current = setTimeout(() => {
        const ids = pendingViewed.current.splice(0);
        void markViewed(ids).catch(() => undefined);
      }, 1500);
    },
    [viewed, account],
  );
  const savedIds = useMemo(() => new Set(saved.map((s) => s.id)), [saved]);
  const toggleSave = useCallback(
    (eventId: string) => {
      const e = store.events.get(eventId);
      if (savedIds.has(eventId)) {
        const next = saved.filter((s) => s.id !== eventId);
        setSaved(next);
        if (account) void unsaveItem(eventId).catch(() => undefined);
        else writeLocal(SAVED_KEY, next);
        return;
      }
      if (!e) return;
      const item: SavedItem = { id: e.id, title: e.title, url: e.url, sourceName: e.sourceName, publishedAt: e.publishedAt, summary: e.summary, savedAt: new Date().toISOString() };
      const next = [item, ...saved];
      setSaved(next);
      if (account) void saveItem(item).catch(() => undefined);
      else writeLocal(SAVED_KEY, next);
    },
    [saved, savedIds, store, account],
  );
  const [selected, setSelected] = useState<{ id: string; particleId?: number } | null>(null);
  const [hovered, setHovered] = useState<GrainRef | null>(null);
  const hoverTimer = useRef<ReturnType<typeof setTimeout>>();
  // Leaving a grain hides the preview after a short grace period (no flicker between neighbours).
  const onHover = useCallback((g: GrainRef | null) => {
    clearTimeout(hoverTimer.current);
    if (g) setHovered(g);
    else hoverTimer.current = setTimeout(() => setHovered(null), 140);
  }, []);
  const [panel, setPanel] = useState<Panel>('none');
  const [privacy, setPrivacy] = useState(false);
  const [idle, setIdle] = useState(false);
  const [dismissedCritical, setDismissedCritical] = useState<Set<string>>(new Set());
  const systemReduced = usePrefersReducedMotion();
  const reducedMotion = prefs.reducedMotion === 'on' || (prefs.reducedMotion === 'auto' && systemReduced);
  const theme = useTheme(prefs.theme);

  // Data source: the real stream, or an explicitly labelled DEMO generator.
  useEffect(() => {
    if (lab) return;
    if (demo) return startDemo(store);
    const client = new StreamClient(store);
    client.start();
    return () => client.stop();
  }, [store, demo, lab]);

  // Persist preferences; recompute impact when what it depends on changes.
  useEffect(() => savePrefs(prefs), [prefs]);
  // Everything in the profile except the feedback-learned affinity (which only affects new estimates).
  const profileKey = JSON.stringify({ ...profile, affinity: undefined });
  const firstProfile = useRef(true);
  useEffect(() => {
    if (firstProfile.current) {
      firstProfile.current = false;
      return;
    }
    store.setProfile(profile);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profileKey, store]);

  const update = useCallback((patch: Partial<Prefs>) => setPrefs((p) => ({ ...p, ...patch })), []);

  // Ambient mode: chrome fades after a few seconds without interaction.
  useEffect(() => {
    let t: ReturnType<typeof setTimeout>;
    const wake = () => {
      setIdle(false);
      clearTimeout(t);
      t = setTimeout(() => setIdle(true), IDLE_MS);
    };
    wake();
    const evs = ['pointermove', 'pointerdown', 'keydown', 'wheel', 'touchstart'] as const;
    evs.forEach((e) => window.addEventListener(e, wake, { passive: true }));
    return () => {
      clearTimeout(t);
      evs.forEach((e) => window.removeEventListener(e, wake));
    };
  }, []);
  const chromeHidden = prefs.ambient && idle && panel === 'none' && !selected && !hovered && !privacy;

  const simSettings: SimSettings = useMemo(
    () => ({ gravity: prefs.gravity, speed: prefs.speed, sizeScale: prefs.sizeScale, density: prefs.density, reducedMotion, sound: prefs.sound, theme, terrain: prefs.showMap }),
    [prefs.gravity, prefs.speed, prefs.sizeScale, prefs.density, reducedMotion, prefs.sound, theme, prefs.showMap],
  );

  // Opening a news item (click, list, saved) marks it as seen.
  useEffect(() => {
    if (selected && store.events.has(selected.id)) markSeen(selected.id);
  }, [selected, store, markSeen]);

  const openEvent = useCallback((id: string) => {
    setSelected({ id });
    if (window.innerWidth < 900) setPanel('none');
  }, []);

  const onFeedback = useCallback(
    (eventId: string, value: FeedbackValue) => {
      const ev = store.events.get(eventId);
      if (!ev) return;
      const previous = feedback[eventId];
      if (previous === value) return;
      // Bounded nudge per category; applies to future estimates only.
      const affinity = { ...profile.affinity };
      const step = INTEREST.feedbackStep;
      for (const c of ev.analysis.categories.slice(0, 2) as Category[]) {
        let v = affinity[c] ?? 0;
        if (previous) v -= previous === 'relevant' ? step : -step;
        v += value === 'relevant' ? step : -step;
        affinity[c] = Math.max(-INTEREST.maxAffinityPoints, Math.min(INTEREST.maxAffinityPoints, v));
      }
      const next = { ...feedback, [eventId]: value };
      setFeedback(next);
      saveFeedback(next);
      updateProfile({ ...profile, affinity });
      if (!ev.demo) void sendFeedback(eventId, value);
    },
    [feedback, profile, store, updateProfile],
  );
  // Affinity changes reach the engine without recomputing existing grains.
  useEffect(() => {
    store.setAffinity(profile.affinity);
  }, [profile.affinity, store]);

  const selectedEvent = selected ? store.events.get(selected.id) : undefined;
  const previewEvent = hovered ? store.events.get(hovered.eventId) : undefined;

  // Red marker on the map where the pinned (or hovered) story happened.
  const [centroids, setCentroids] = useState<Map<string, [number, number]>>();
  useEffect(() => {
    if (prefs.showMap && !centroids) loadWorld().then((d) => setCentroids(d.centroids), () => undefined);
  }, [prefs.showMap, centroids]);
  const focusEvent = selectedEvent ?? previewEvent;
  const markers = useMemo(() => (focusEvent && centroids ? eventPoints(focusEvent, centroids) : []), [focusEvent, centroids]);
  const selectedImpact = selected ? store.impacts.get(selected.id) : undefined;
  useEffect(() => {
    if (selected && !selectedEvent) setSelected(null); // expired while open
  }, [selected, selectedEvent, ui.version]);

  // Separate, accessible channel for critical situations (never a flashing grain).
  const critical = useMemo(() => {
    if (!prefs.criticalAlerts) return undefined;
    let best: { id: string; title: string; t: number } | undefined;
    for (const [id, imp] of store.impacts) {
      if (!imp.urgent || dismissedCritical.has(id)) continue;
      const e = store.events.get(id);
      if (!e) continue;
      const t = Date.parse(e.occurredAt ?? e.publishedAt ?? e.firstSeenAt);
      if (Date.now() - t > 24 * 3_600_000) continue;
      if (!best || t > best.t) best = { id, title: e.title, t };
    }
    return best;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ui.version, prefs.criticalAlerts, dismissedCritical, store]);

  const conn = connectionText(ui);
  const emptyMessage = !ui.demo
    ? ui.connection === 'offline'
      ? 'Sem internet. A paisagem continua aqui; novas notícias chegam quando a conexão voltar.'
      : !ui.snapshotLoaded
        ? ui.connection === 'reconnecting'
          ? 'Não foi possível conectar ao servidor do SAND. Tentando novamente…'
          : 'Conectando às fontes de notícias…'
        : store.events.size === 0
          ? 'Aguardando as primeiras notícias reais. Nada é inventado enquanto isso.'
          : undefined
    : undefined;

  return (
    <main className={`app ${chromeHidden ? 'is-ambient' : ''} ${reducedMotion ? 'reduce-motion' : ''}`}>
      {prefs.showMap && <WorldMap markers={markers} theme={theme} />}
      <ParticleCanvas
        store={store}
        settings={simSettings}
        selectedEventId={selected?.id ?? null}
        simRef={simRef}
        onHover={onHover}
        onSelect={(g) => {
          if (g) {
            setSelected({ id: g.eventId, particleId: g.particleId });
            setPanel('none');
          } else {
            setSelected(null);
          }
        }}
      />

      <header className="topbar chrome">
        <span className="brand">SAND</span>
        <Clock />
        <nav className="topbar__actions" aria-label="Controles">
          <span className={`dot dot--${conn.tone}`} title={conn.label} aria-label={`Conexão: ${conn.label}`} role="img" />
          <button className="icon-btn" onClick={() => {
              setSelected(null);
              setPanel((p) => (p === 'recent' ? 'none' : 'recent'));
            }} aria-label="Notícias recentes" aria-pressed={panel === 'recent'}>
            <IconList />
          </button>
          <button
            className="icon-btn"
            onClick={() => {
              setSelected(null);
              setPanel((p) => (p === 'saved' ? 'none' : 'saved'));
            }}
            aria-label="Notícias salvas"
            aria-pressed={panel === 'saved'}
          >
            <IconBookmark />
          </button>
          <button className="icon-btn" onClick={() => {
              setSelected(null);
              setPanel((p) => (p === 'settings' ? 'none' : 'settings'));
            }} aria-label="Configurações" aria-pressed={panel === 'settings'}>
            <IconSettings />
          </button>
        </nav>
      </header>

      {/* Always visible, even in ambient mode: fictitious data must never pass for real news. */}
      {demo && <span className="demo-badge">{lab ? 'LAB' : 'DEMO'} — dados fictícios</span>}
      {lab && <LabPanel store={store} simRef={simRef} sizeScale={prefs.sizeScale * viewScale(window.innerWidth)} />}

      {critical && (
        <div className="critical chrome-keep" role="status" aria-live="polite">
          <span className="critical__mark" aria-hidden="true" />
          <button className="link-btn link-btn--inline" onClick={() => openEvent(critical.id)}>
            {critical.title}
          </button>
          <button className="icon-btn icon-btn--small" aria-label="Dispensar aviso" onClick={() => setDismissedCritical((s) => new Set(s).add(critical.id))}>
            ×
          </button>
        </div>
      )}

      {emptyMessage && <p className="empty-state">{emptyMessage}</p>}

      {prefs.showIndicators && (
        <div className="chrome">
          <StatusBar ui={ui} prefs={{ ...prefs, location: profile.location }} store={store} />
        </div>
      )}

      {!selectedEvent && previewEvent && panel === 'none' && (
        <>
          <EventPreview event={previewEvent} impact={store.impacts.get(previewEvent.id)} seen={viewed.has(previewEvent.id)} />
          <LeaderLine simRef={simRef} eventId={previewEvent.id} particleId={hovered?.particleId} target=".details--preview" />
        </>
      )}

      {selectedEvent && selectedImpact && (
        <LeaderLine simRef={simRef} eventId={selectedEvent.id} particleId={selected?.particleId} target=".details--full" />
      )}
      {selectedEvent && selectedImpact && (
        <EventDetails
          event={selectedEvent}
          impact={selectedImpact}
          feedback={feedback[selectedEvent.id]}
          saved={savedIds.has(selectedEvent.id)}
          onToggleSave={() => toggleSave(selectedEvent.id)}
          relatedTitle={(id) => store.events.get(id)?.title}
          onFeedback={(v) => onFeedback(selectedEvent.id, v)}
          onClose={() => setSelected(null)}
          onOpenRelated={openEvent}
        />
      )}

      {panel === 'settings' && (
        <SettingsPanel
          prefs={prefs}
          profile={profile}
          sources={ui.status?.sources}
          account={account}
          onProfileChange={updateProfile}
          onEditAnswers={() => {
            setPanel('none');
            setQuestionnaire(true);
          }}
          onChange={update}
          onClose={() => setPanel('none')}
          onPrivacy={() => setPrivacy(true)}
          onClearAll={() => {
            clearAllLocal();
            setFeedback({});
            setPrefs({ ...DEFAULT_PREFS, onboarded: true });
          }}
        />
      )}
      {panel === 'recent' && <RecentList store={store} ui={ui} viewed={viewed} savedIds={savedIds} onOpen={openEvent} onClose={() => setPanel('none')} />}
      {panel === 'saved' && (
        <SavedList
          items={saved}
          isLive={(id) => store.events.has(id)}
          onOpen={openEvent}
          onRemove={(id) => toggleSave(id)}
          onClose={() => setPanel('none')}
        />
      )}
      {privacy && <PrivacyDialog onClose={() => setPrivacy(false)} />}

      {questionnaire && account && (
        <Questionnaire
          initial={profile}
          onCancel={profile.onboarded ? () => setQuestionnaire(false) : undefined}
          onDone={(p) => {
            setQuestionnaire(false);
            clearTimeout(saveTimer.current);
            setProfile(p);
            void saveProfile(p).catch(() => undefined);
          }}
        />
      )}
    </main>
  );
}
