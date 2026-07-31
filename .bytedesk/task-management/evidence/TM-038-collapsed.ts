/**
 * Which epic lanes are folded shut.
 *
 * Per project, not per browser: one browser has a tab open on several boards (each project gets
 * its own port), and a single key would make collapsing an epic here fold an unrelated lane
 * there. The project name comes from the board payload, which is what the header already shows.
 *
 * localStorage rather than the store: this is how one person is looking at the board right now,
 * not a fact about the work. Saved views went the other way — a view is a way of reading THIS
 * board and belongs in the repo — and the difference is whether a teammate would want it.
 */
const KEY = (project: string) => `tm.collapsed:${project || "unknown"}`;

export function loadCollapsed(project: string): Set<string> {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY(project)) || "[]");
    return new Set(Array.isArray(raw) ? raw.filter((x) => typeof x === "string") : []);
  } catch {
    return new Set(); // corrupt or private mode — everything open is the safe default
  }
}

export function saveCollapsed(project: string, ids: Set<string>) {
  try {
    localStorage.setItem(KEY(project), JSON.stringify([...ids]));
  } catch {
    /* private mode — folding still works for this session, it just won't survive a reload */
  }
}
