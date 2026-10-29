import type { Prefs } from '../services/storage';
import type { SandStore, UiState } from '../state/store';
import { formatClock } from '../utils/format';

const STALE_MS = 60 * 60_000;

/**
 * Connection line. The source count is "switched on / available": sources this user turned
 * off in the settings count as off; sources the server cannot use are not counted at all.
 */
export function connectionText(ui: UiState, hidden: ReadonlySet<string> = new Set()): { label: string; tone: 'ok' | 'warn' | 'off' } {
  if (ui.demo) return { label: 'modo demonstração', tone: 'warn' };
  if (ui.connection === 'offline') return { label: 'sem internet', tone: 'off' };
  if (ui.connection === 'reconnecting') return { label: 'reconectando', tone: 'warn' };
  if (ui.connection === 'connecting' || !ui.snapshotLoaded) return { label: 'conectando', tone: 'warn' };
  const available = ui.status?.sources.filter((s) => s.health !== 'disabled') ?? [];
  const all = available.filter((s) => !hidden.has(s.id));
  // Sources still on their first poll are neither healthy nor failing yet.
  const srcs = all.filter((s) => s.health !== 'pending');
  if (all.length && srcs.length === 0) return { label: 'iniciando fontes', tone: 'warn' };
  const ok = srcs.filter((s) => s.health === 'ok').length;
  const lastSuccess = Math.max(0, ...srcs.map((s) => (s.lastSuccessAt ? Date.parse(s.lastSuccessAt) : 0)));
  if (srcs.length && ok === 0 && srcs.every((s) => s.health !== 'pending')) return { label: 'fontes indisponíveis', tone: 'off' };
  if (lastSuccess && Date.now() - lastSuccess > STALE_MS) return { label: 'dados desatualizados', tone: 'warn' };
  return { label: available.length ? `${all.length}/${available.length} fontes` : 'conectado', tone: 'ok' };
}

export function StatusBar({ ui, prefs, store, hiddenSources }: { ui: UiState; prefs: Prefs; store: SandStore; hiddenSources?: string[] }) {
  const conn = connectionText(ui, new Set(hiddenSources));
  const total = store.events.size;
  return (
    <footer className="statusbar" aria-live="polite">
      <span>
        {ui.sessionCount} {ui.sessionCount === 1 ? 'evento' : 'eventos'} nesta sessão
        {total ? ` · ${total} nas últimas ${prefs.windowHours} h` : ''}
      </span>
      <span>último às {formatClock(ui.lastReceivedAt ?? ui.status?.lastEventAt)}</span>
      {prefs.location && <span>{prefs.location.name}</span>}
      <span className={`statusbar__conn statusbar__conn--${conn.tone}`}>{conn.label}</span>
    </footer>
  );
}
