/**
 * `data-bd-theme` on <html>. There are three states and only two of them are stamped:
 * "auto" REMOVES the attribute, because an absent stamp is what the family stylesheet reads
 * as "follow the machine" (`:root:not([data-bd-theme])` under `prefers-color-scheme`), and an
 * explicit stamp wins over it in both directions. Resolving the media query here and stamping
 * the answer, which this module used to do, opts the page out of that rule: the CSS path is
 * never taken, and every auto viewer waits for this module to load before the theme is right.
 * localStorage is the cache for the two explicit states; the board setting, when it arrives,
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

function apply() {
  const root = document.documentElement;
  if (theme === "auto") root.removeAttribute("data-bd-theme");
  else root.setAttribute("data-bd-theme", theme);
}
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
