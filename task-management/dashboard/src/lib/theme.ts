/**
 * `data-bd-theme` on <html>. "auto" follows the OS; the family stylesheet does the rest.
 * localStorage is the cache so the first paint is right; the board setting, when it arrives,
 * wins (Settings writes both).
 */
import { useSyncExternalStore } from "react";

export type Theme = "auto" | "dark" | "light";
const KEY = "tm.theme";
const listeners = new Set<() => void>();
let theme: Theme = ((): Theme => {
  try {
    const v = localStorage.getItem(KEY);
    return v === "dark" || v === "light" ? v : "auto";
  } catch {
    return "auto";
  }
})();

const media = typeof matchMedia === "function" ? matchMedia("(prefers-color-scheme: light)") : null;

function apply() {
  const resolved = theme === "auto" ? (media?.matches ? "light" : "dark") : theme;
  document.documentElement.setAttribute("data-bd-theme", resolved);
}
media?.addEventListener("change", apply);
apply();

export function setTheme(next: Theme) {
  theme = next;
  try {
    localStorage.setItem(KEY, next);
  } catch {
    /* private mode */
  }
  apply();
  for (const fn of listeners) fn();
}

export function useTheme(): Theme {
  return useSyncExternalStore(
    (fn) => {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    () => theme,
  );
}
