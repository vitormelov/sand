import { useEffect, useState } from 'react';

export type ThemePref = 'auto' | 'light' | 'dark';
export type Theme = 'light' | 'dark';

const media = () => (typeof window !== 'undefined' && window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)') : null);

export function resolveTheme(pref: ThemePref): Theme {
  if (pref === 'light' || pref === 'dark') return pref;
  return media()?.matches ? 'dark' : 'light';
}

/** Sets the theme on <html> (CSS variables) and the browser UI colour. */
export function applyTheme(theme: Theme): void {
  document.documentElement.dataset.theme = theme;
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', theme === 'dark' ? '#0f0f10' : '#ffffff');
}

/** Resolved theme, following the system when the preference is "auto". */
export function useTheme(pref: ThemePref): Theme {
  const [system, setSystem] = useState(() => resolveTheme('auto'));
  useEffect(() => {
    const q = media();
    if (!q) return;
    const on = () => setSystem(q.matches ? 'dark' : 'light');
    q.addEventListener('change', on);
    return () => q.removeEventListener('change', on);
  }, []);
  const theme = pref === 'auto' ? system : pref;
  useEffect(() => applyTheme(theme), [theme]);
  return theme;
}
