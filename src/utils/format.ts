const timeFmt = new Intl.DateTimeFormat('pt-BR', { hour: '2-digit', minute: '2-digit' });
const dateTimeFmt = new Intl.DateTimeFormat('pt-BR', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

export function formatWhen(iso: string | undefined, now = Date.now()): string {
  if (!iso) return 'não informado';
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return 'não informado';
  const d = new Date(t);
  const today = new Date(now);
  const sameDay = d.toDateString() === today.toDateString();
  const yesterday = new Date(now - 86_400_000).toDateString() === d.toDateString();
  if (sameDay) return `hoje, ${timeFmt.format(d)}`;
  if (yesterday) return `ontem, ${timeFmt.format(d)}`;
  return dateTimeFmt.format(d);
}

export function formatRelative(iso: string | undefined, now = Date.now()): string {
  if (!iso) return '';
  const diff = Math.max(0, now - Date.parse(iso));
  const min = Math.round(diff / 60_000);
  if (min < 1) return 'agora';
  if (min < 60) return `há ${min} min`;
  const h = Math.round(min / 60);
  if (h < 24) return `há ${h} h`;
  return `há ${Math.round(h / 24)} d`;
}

export function formatClock(iso: string | undefined): string {
  return iso ? timeFmt.format(new Date(iso)) : '—';
}

export function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
}
