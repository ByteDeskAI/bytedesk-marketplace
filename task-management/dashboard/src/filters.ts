import { typeOf } from "./types";
import type { Task } from "./types";

export interface Filters {
  text: string;
  epic: string | null;
  assignee: string | null;
  actor: string | null;
  priority: string | null;
  type: string | null;
  label: string | null;
  sprint: string | null;
}

export const EMPTY: Filters = {
  text: "",
  epic: null,
  assignee: null,
  actor: null,
  priority: null,
  type: null,
  label: null,
  sprint: null,
};

export function matches(task: Task, f: Filters): boolean {
  if (f.epic && task.epic !== f.epic) return false;
  if (f.assignee && task.assignee !== f.assignee) return false;
  if (f.actor && task.actor !== f.actor) return false;
  if (f.priority && task.priority !== f.priority) return false;
  if (f.type && typeOf(task) !== f.type) return false;
  if (f.label && !(task.labels ?? []).includes(f.label)) return false;
  if (f.sprint && task.sprint !== f.sprint) return false;
  if (f.text) {
    const hay =
      `${task.id} ${task.title} ${(task.labels ?? []).join(" ")}`.toLowerCase();
    if (!hay.includes(f.text.toLowerCase())) return false;
  }
  return true;
}

export const isActive = (f: Filters) =>
  Boolean(f.text) ||
  f.epic != null ||
  f.assignee != null ||
  f.actor != null ||
  f.priority != null ||
  f.type != null ||
  f.label != null ||
  f.sprint != null;

/** Distinct values actually present on the board — no empty dropdowns. */
export function options(
  tasks: Task[],
  key: "epic" | "assignee" | "actor" | "priority" | "type",
): string[] {
  if (key === "type") {
    return [...new Set(tasks.map((t) => typeOf(t)))].sort();
  }
  return [
    ...new Set(tasks.map((t) => t[key]).filter((v): v is string => Boolean(v))),
  ].sort();
}

export const labelOptions = (tasks: Task[]) =>
  [...new Set(tasks.flatMap((t) => t.labels ?? []))].sort();

// ── saved views ──────────────────────────────────────────────────────────────
// The note that used to sit here said "localStorage, per browser — move to the store only if views
// need to follow the project across machines." They do: a view is a way of looking at THIS board,
// and it was being kept somewhere the board could not reach. localStorage is now the cache that
// renders instantly and survives offline; the repo's config is the answer.
const KEY = "tm.views";
export type SavedViews = Record<string, Filters>;

export function loadViews(): SavedViews {
  try {
    return JSON.parse(localStorage.getItem(KEY) || "{}") as SavedViews;
  } catch {
    return {};
  }
}

export function saveViews(views: SavedViews) {
  try {
    localStorage.setItem(KEY, JSON.stringify(views));
  } catch {
    /* private mode — the filter still works, it just won't persist */
  }
}

/**
 * Fold the repo's saved views over this browser's cache.
 *
 * A name defined in both is the repo's: it is the shared answer, and a local copy of it is a stale
 * echo of an earlier save. Names only this browser knows are kept rather than dropped, so a view
 * saved while the server was unreachable is not lost on the next load.
 */
export function mergeViews(local: SavedViews, server: unknown): SavedViews {
  if (!server || typeof server !== "object") return local;
  return { ...local, ...(server as SavedViews) };
}

/** Write them where the tasks are, so they follow the project. Best-effort, like the cache. */
export function pushViews(views: SavedViews) {
  return fetch("/api/settings", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ views }),
  }).catch(() => {
    /* offline — the cache has it, and the next successful save carries it up */
  });
}
