/**
 * The choices the board remembers between visits: which notifications you want,
 * who you are, which cards you watch, and whether you have already said no to
 * the install banner.
 *
 * The STORE is the source of truth; localStorage is a cache in front of it.
 *
 * It used to be localStorage alone, which is why notifications had to be re-enabled in every
 * browser and on every machine — the preference was never about the browser, it was about this
 * project. `pushPrefs` writes through to `/api/settings`, which lands in the repo's own config file
 * next to the tasks, and `mergeServerPrefs` folds that back in when the board payload arrives.
 *
 * The cache stays because this is an installable app with an offline outbox: reading synchronously
 * at mount avoids a flash of the wrong settings, and a board that cannot reach its server still
 * knows what you asked for. Best-effort throughout — a board that forgets your preferences is a
 * minor annoyance; one that throws on a locked-down storage API is not.
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

/**
 * Fold the store's copy over the local one.
 *
 * The server wins on the keys it has an opinion about, because it is the shared answer; anything it
 * has never been told keeps the local value rather than being reset to a default.
 */
export function mergeServerPrefs(local, server) {
  if (!server || typeof server !== "object") return local;
  return {
    ...local,
    ...(Array.isArray(server.categories)
      ? { categories: server.categories.filter((c) => c in CATEGORIES) }
      : {}),
    ...(typeof server.me === "string" || server.me === null
      ? { me: server.me }
      : {}),
    ...(Array.isArray(server.watching) ? { watching: server.watching } : {}),
  };
}

/**
 * Write the shareable half through to the repo.
 *
 * `installDismissed` is deliberately NOT sent: whether this browser has dismissed an install
 * banner is genuinely about this browser, and pushing it would dismiss the banner on everyone
 * else's machine too.
 */
export function pushPrefs(prefs) {
  const body = {
    categories: prefs.categories,
    me: prefs.me,
    watching: prefs.watching,
  };
  return fetch("/api/settings", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  }).catch(() => {
    /* offline, or no server — the local cache already has it and the next load will retry */
  });
}
