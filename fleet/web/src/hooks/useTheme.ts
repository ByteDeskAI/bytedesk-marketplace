// useTheme — Operator theme (BDM-31). Replaces the prior Light/Dark/
// Repllt-Blue trio with two themes: Operator (dark, default) and
// Operator Day (light variant). Applies as a `data-theme` attribute on
// <html>; persists to localStorage.

import { useEffect } from 'preact/hooks';
import { usePersistentState } from './usePersistentState';

export type ThemeName = 'operator' | 'day';
export type FontName  = 'inter' | 'jetbrains-mono' | 'system';

export interface ThemeState {
  theme: ThemeName;
  accent: string; // hex
  font: FontName;
}

const DEFAULT: ThemeState = { theme: 'operator', accent: '#ff9e3d', font: 'inter' };

// Migrate legacy theme names persisted before BDM-31.
function migrate(s: unknown): ThemeState {
  const v = (s ?? {}) as Partial<ThemeState> & { theme?: string };
  let theme: ThemeName = DEFAULT.theme;
  if (v.theme === 'operator' || v.theme === 'day') theme = v.theme;
  else if (v.theme === 'light') theme = 'day';
  else if (v.theme === 'dark' || v.theme === 'repllt-blue') theme = 'operator';
  const accent = typeof v.accent === 'string' ? v.accent : DEFAULT.accent;
  const font: FontName =
    v.font === 'inter' || v.font === 'jetbrains-mono' || v.font === 'system'
      ? v.font
      : DEFAULT.font;
  return { theme, accent, font };
}

export function useTheme(): [ThemeState, (s: ThemeState) => void] {
  const [raw, setState] = usePersistentState<ThemeState>('fleet.theme', DEFAULT);
  const state = migrate(raw);
  useEffect(() => {
    const html = document.documentElement;
    // Operator (dark) is the :root default — no attribute.
    // Operator Day (light) opts in via data-theme="day".
    if (state.theme === 'operator') html.removeAttribute('data-theme');
    else html.setAttribute('data-theme', state.theme);
    if (state.font === 'inter') html.removeAttribute('data-font');
    else html.setAttribute('data-font', state.font);
    if (state.accent) html.style.setProperty('--color-accent', state.accent);
  }, [state.theme, state.font, state.accent]);
  return [state, setState];
}
