// useTheme — Phase 11 (BDM-27 / C7). Applies the theme as a data
// attribute on <html>; persists to localStorage. Server-side settings
// (settings.toml) is the canonical store across reloads/projects, but
// the hook caches in localStorage so the *first paint* doesn't flash.

import { useEffect } from 'preact/hooks';
import { usePersistentState } from './usePersistentState';

export type ThemeName = 'light' | 'dark' | 'repllt-blue';
export type FontName  = 'inter' | 'jetbrains-mono' | 'system';

export interface ThemeState {
  theme: ThemeName;
  accent: string; // hex
  font: FontName;
}

const DEFAULT: ThemeState = { theme: 'light', accent: '#2563eb', font: 'inter' };

export function useTheme(): [ThemeState, (s: ThemeState) => void] {
  const [state, setState] = usePersistentState<ThemeState>('fleet.theme', DEFAULT);
  useEffect(() => {
    const html = document.documentElement;
    if (state.theme === 'light') html.removeAttribute('data-theme');
    else html.setAttribute('data-theme', state.theme);
    if (state.font === 'inter') html.removeAttribute('data-font');
    else html.setAttribute('data-font', state.font);
    if (state.accent) html.style.setProperty('--color-accent', state.accent);
  }, [state]);
  return [state, setState];
}
