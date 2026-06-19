// usePersistentState — Phase 7 (BDM-22). localStorage-backed useState
// for UI prefs (density, accent, theme later in Phase 11).

import { useEffect, useState } from 'preact/hooks';

export function usePersistentState<T>(key: string, initial: T): [T, (v: T) => void] {
  const [v, setV] = useState<T>(() => {
    try {
      const raw = localStorage.getItem(key);
      if (raw == null) return initial;
      return JSON.parse(raw) as T;
    } catch {
      return initial;
    }
  });
  useEffect(() => {
    try {
      localStorage.setItem(key, JSON.stringify(v));
    } catch { /* quota / privacy mode — best-effort */ }
  }, [key, v]);
  return [v, setV];
}
