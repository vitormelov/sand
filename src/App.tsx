import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { INTEREST } from '../shared/impact/config';
import type { Category, UserProfile } from '../shared/types';
import { EventDetails } from './components/EventDetails';
import { IconList, IconSettings } from './components/icons';
import { Onboarding } from './components/Onboarding';
import { ParticleCanvas } from './components/ParticleCanvas';
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

export function App({ demo = new URLSearchParams(window.location.search).has('demo') }: { demo?: boolean }) {
  const [prefs, setPrefs] = useState<Prefs>(loadPrefs);
  const [feedback, setFeedback] = useState(loadFeedback);
  const store = useMemo(() => new SandStore(profileOf(prefs), demo), []); // eslint-disable-line react-hooks/exhaustive-deps
  const ui = useStoreState(store);
  const simRef = useRef<SandSimulation | null>(null);
  const [selected, setSelected] = useState<{ id: string; anchor?: { x: number; y: number; r: number } } | null>(null);
  const [panel, setPanel] = useState<Panel>('none');
  const [privacy, setPrivacy] = useState(false);
  const [idle, setIdle] = useState(false);
  const [dismissedCritical, setDismissedCritical] = useState<Set<string>>(new Set());
  const systemReduced = usePrefersReducedMotion();
  const reducedMotion = prefs.reducedMotion === 'on' || (prefs.reducedMotion === 'auto' && systemReduced);

  // Data source: the real stream, or an explicitly labelled DEMO generator.
  useEffect(() => {
    if (demo) return startDemo(store);
    const client = new StreamClient(store);
    client.start();
    return () => client.stop();
  }, [store, demo]);

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
  const chromeHidden = prefs.ambient && idle && panel === 'none' && !selected && !privacy;

  const simSettings: SimSettings = useMemo(
    () => ({ gravity: prefs.gravity, speed: prefs.speed, sizeScale: prefs.sizeScale, density: prefs.density, reducedMotion, sound: prefs.sound }),
    [prefs.gravity, prefs.speed, prefs.sizeScale, prefs.density, reducedMotion, prefs.sound],
  );

  const openEvent = useCallback((id: string) => {
    const anchor = simRef.current?.grainPosition(id);
    setSelected({ id, anchor });
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
      <ParticleCanvas
        store={store}
        settings={simSettings}
        selectedEventId={selected?.id ?? null}
        simRef={simRef}
        onSelect={(id, anchor) => {
          if (id) {
            setSelected({ id, anchor });
            setPanel('none');
          } else {
            setSelected(null);
          }
        }}
      />

      <header className="topbar chrome">
        <span className="brand">SAND</span>
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
      {demo && <span className="demo-badge">DEMO — dados fictícios</span>}

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

      {selectedEvent && selectedImpact && (
        <EventDetails
          event={selectedEvent}
          impact={selectedImpact}
          anchor={selected?.anchor}
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
