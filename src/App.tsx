import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { INTEREST } from '../shared/impact/config';
import type { Category, UserProfile } from '../shared/types';
import { Clock } from './components/Clock';
import { EventDetails, EventPreview } from './components/EventDetails';
import { LabPanel } from './components/LabPanel';
import { LeaderLine } from './components/LeaderLine';
import { IconList, IconSettings } from './components/icons';
import { Onboarding } from './components/Onboarding';
import { ParticleCanvas, type GrainRef } from './components/ParticleCanvas';
import { WorldMap } from './components/WorldMap';
import { PrivacyDialog } from './components/PrivacyDialog';
import { RecentList } from './components/RecentList';
import { SettingsPanel } from './components/SettingsPanel';
import { StatusBar, connectionText } from './components/StatusBar';
import { sendFeedback } from './services/api';
import { startDemo } from './services/demo';
import { clearAllLocal, DEFAULT_PREFS, loadFeedback, loadPrefs, saveFeedback, savePrefs, type FeedbackValue, type Prefs } from './services/storage';
import { StreamClient } from './services/stream';
import type { SandSimulation, SimSettings } from './simulation/SandSimulation';
import { SandStore, useStoreState } from './state/store';

const IDLE_MS = 4_000;

function profileOf(p: Prefs): UserProfile {
  return { location: p.location, interests: p.interests, affinity: p.affinity };
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

type Panel = 'none' | 'settings' | 'recent';

const query = new URLSearchParams(window.location.search);

export function App({ demo: demoProp = query.has('demo'), lab = query.has('lab') }: { demo?: boolean; lab?: boolean }) {
  // The lab is a fictitious-data mode too: the real stream is never connected there.
  const demo = demoProp || lab;
  const [prefs, setPrefs] = useState<Prefs>(loadPrefs);
  const [feedback, setFeedback] = useState(loadFeedback);
  const store = useMemo(() => new SandStore(profileOf(prefs), demo), []); // eslint-disable-line react-hooks/exhaustive-deps
  const ui = useStoreState(store);
  const simRef = useRef<SandSimulation | null>(null);
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
  const profileKey = JSON.stringify([prefs.location, prefs.interests]);
  const firstProfile = useRef(true);
  useEffect(() => {
    if (firstProfile.current) {
      firstProfile.current = false;
      return;
    }
    store.setProfile(profileOf(prefs));
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
    () => ({ gravity: prefs.gravity, speed: prefs.speed, sizeScale: prefs.sizeScale, density: prefs.density, reducedMotion, sound: prefs.sound }),
    [prefs.gravity, prefs.speed, prefs.sizeScale, prefs.density, reducedMotion, prefs.sound],
  );

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
      const affinity = { ...prefs.affinity };
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
      setPrefs((p) => ({ ...p, affinity }));
      if (!ev.demo) void sendFeedback(eventId, value);
    },
    [feedback, prefs.affinity, store],
  );
  // Affinity changes reach the engine without recomputing existing grains.
  useEffect(() => {
    store.setAffinity(prefs.affinity);
  }, [prefs.affinity, store]);

  const selectedEvent = selected ? store.events.get(selected.id) : undefined;
  const previewEvent = hovered ? store.events.get(hovered.eventId) : undefined;
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
    <main className={`app ${chromeHidden ? 'is-ambient' : ''}`}>
      {prefs.showMap && <WorldMap />}
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
      {lab && <LabPanel store={store} simRef={simRef} sizeScale={prefs.sizeScale} />}

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
          <StatusBar ui={ui} prefs={prefs} store={store} />
        </div>
      )}

      {!selectedEvent && previewEvent && panel === 'none' && (
        <>
          <EventPreview event={previewEvent} impact={store.impacts.get(previewEvent.id)} />
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
          relatedTitle={(id) => store.events.get(id)?.title}
          onFeedback={(v) => onFeedback(selectedEvent.id, v)}
          onClose={() => setSelected(null)}
          onOpenRelated={openEvent}
        />
      )}

      {panel === 'settings' && (
        <SettingsPanel
          prefs={prefs}
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
      {panel === 'recent' && <RecentList store={store} ui={ui} onOpen={openEvent} onClose={() => setPanel('none')} />}
      {privacy && <PrivacyDialog onClose={() => setPrivacy(false)} />}

      {!prefs.onboarded && !demo && (
        <Onboarding onPick={(loc) => update({ location: loc, onboarded: true })} onSkip={() => update({ onboarded: true })} />
      )}
    </main>
  );
}
