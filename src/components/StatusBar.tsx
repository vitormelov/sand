import type { Prefs } from '../services/storage';
import type { SandStore, UiState } from '../state/store';
import { formatClock } from '../utils/format';

const STALE_MS = 60 * 60_000;

export function connectionText(ui: UiState): { label: string; tone: 'ok' | 'warn' | 'off' } {
  if (ui.demo) return { label: 'modo demonstração', tone: 'warn' };
  if (ui.connection === 'offline') return { label: 'sem internet', tone: 'off' };
  if (ui.connection === 'reconnecting') return { label: 'reconectando', tone: 'warn' };
  if (ui.connection === 'connecting' || !ui.snapshotLoaded) return { label: 'conectando', tone: 'warn' };
  const all = ui.status?.sources.filter((s) => s.health !== 'disabled') ?? [];
  // Sources still on their first poll are neither healthy nor failing yet.
  const srcs = all.filter((s) => s.health !== 'pending');
  if (all.length && srcs.length === 0) return { label: 'iniciando fontes', tone: 'warn' };
  const ok = srcs.filter((s) => s.health === 'ok').length;
  const lastSuccess = Math.max(0, ...srcs.map((s) => (s.lastSuccessAt ? Date.parse(s.lastSuccessAt) : 0)));
  if (srcs.length && ok === 0 && srcs.every((s) => s.health !== 'pending')) return { label: 'fontes indisponíveis', tone: 'off' };
  if (lastSuccess && Date.now() - lastSuccess > STALE_MS) return { label: 'dados desatualizados', tone: 'warn' };
  return { label: srcs.length ? `${ok}/${srcs.length} fontes` : 'conectado', tone: 'ok' };
}

export function StatusBar({ ui, prefs, store }: { ui: UiState; prefs: Prefs; store: SandStore }) {
  const conn = connectionText(ui);
  const total = store.events.size;
  return (
    <footer className="statusbar" aria-live="polite">
      <span>
        {ui.sessionCount} {ui.sessionCount === 1 ? 'evento' : 'eventos'} nesta sessão
        {total ? ` · ${total} nas últimas horas` : ''}
      </span>
      <span>último às {formatClock(ui.lastReceivedAt ?? ui.status?.lastEventAt)}</span>
      {prefs.location && <span>{prefs.location.name}</span>}
      <span className={`statusbar__conn statusbar__conn--${conn.tone}`}>{conn.label}</span>
    </footer>
  );
}
