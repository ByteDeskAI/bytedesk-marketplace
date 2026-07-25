/**
 * The choices the board remembers between visits: which notifications you want,
 * who you are, which cards you watch, and whether you have already said no to
 * the install banner.
 *
 * localStorage, one key, best-effort. A board that forgets your preferences is a
 * minor annoyance; a board that throws on a locked-down storage API is not.
 */
import { CATEGORIES } from "./notify.mjs";

const KEY = "tm-board-prefs";

/** Everything off by default. Notifications are opt-in, per category. */
const DEFAULTS = {
  categories: [],
  me: null,
  watching: [],
  installDismissed: false,
};

export function loadPrefs() {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) || "{}");
    return {
      ...DEFAULTS,
      ...raw,
      // Drop anything we no longer have a category for, rather than trusting the blob.
      categories: (raw.categories || []).filter((c) => c in CATEGORIES),
      watching: Array.isArray(raw.watching) ? raw.watching : [],
    };
  } catch {
    return { ...DEFAULTS };
  }
}

export function savePrefs(prefs) {
  try {
    localStorage.setItem(KEY, JSON.stringify(prefs));
  } catch {
    /* private mode — the session still works, it just starts fresh next time */
  }
}
