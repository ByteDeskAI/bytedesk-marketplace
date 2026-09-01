import { typeOf } from "./types";
import type { Task } from "./types";

export interface Filters {
  text: string;
  status: string | null;
  epic: string | null;
  assignee: string | null;
  actor: string | null;
  priority: string | null;
  type: string | null;
  label: string | null;
  sprint: string | null;
  kind: string | null;
  id: string | null;
  goal: string | null;
}

export const EMPTY: Filters = {
  text: "",
  status: null,
  epic: null,
  assignee: null,
  actor: null,
  priority: null,
  type: null,
  label: null,
  sprint: null,
  kind: null,
  id: null,
  goal: null,
};

/**
 * The `field:value` vocabulary of `tm find` (lib/query.mjs FIELDS). Served on /api/meta as
 * `vocab.findFields`; this copy is the offline fallback and is pinned to the server's list by
 * tests/unit/query.test.mjs.
 */
export const FIELD_NAMES = ["status", "epic", "assignee", "actor", "priority", "type", "label", "kind", "id", "goal", "sprint"] as const;
export type Field = (typeof FIELD_NAMES)[number];

/**
 * `status:open -label:stale "half remembered"` → Filters. Same grammar as the CLI: bare words
 * search, `field:value` narrows, a leading `-` negates (kept as `-field` keys for the server;
 * the client applies only the positive half and hands the whole string to /api/find for the
 * rest). A `//` value stays a word so a URL never parses as a field.
 */
export function parseQuery(q: string, fields: readonly string[] = FIELD_NAMES): Filters {
  const f: Filters = { ...EMPTY };
  const words: string[] = [];
  for (const tok of q.match(/"[^"]*"|\S+/g) ?? []) {
    const m = /^(-?)([a-z]+):(.*)$/i.exec(tok);
    if (m && fields.includes(m[2].toLowerCase()) && !m[3].startsWith("//")) {
      if (m[1]) continue; // negation is the server's job (tm find); the board shows the positive set
      const key = m[2].toLowerCase() as Field;
      f[key] = m[3].replace(/^"|"$/g, "") || null;
    } else words.push(tok.replace(/^"|"$/g, ""));
  }
  f.text = words.join(" ");
  return f;
}

/** Filters → the query string, so the URL and the search box agree. */
export function formatQuery(f: Filters): string {
  const parts: string[] = [];
  for (const key of FIELD_NAMES) {
    const v = f[key];
    if (v) parts.push(/\s/.test(v) ? `${key}:"${v}"` : `${key}:${v}`);
  }
  if (f.text) parts.push(f.text);
  return parts.join(" ");
}

export function matches(task: Task, f: Filters): boolean {
  if (f.status && task.status !== f.status) return false;
  if (f.id && task.id !== f.id.toUpperCase()) return false;
  if (f.goal && !(task.goalDoc ?? "").includes(f.goal)) return false;
  if (f.kind && f.kind !== "task") return false;
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

export const isActive = (f: Filters) => Boolean(f.text) || FIELD_NAMES.some((k) => f[k] != null);

/** Distinct values actually present on the board — no empty dropdowns. */
export function options(
  tasks: Task[],
  key: "epic" | "assignee" | "actor" | "priority" | "type" | "status",
): string[] {
  if (key === "type") {
    return [...new Set(tasks.map((t) => typeOf(t)))].sort();
  }
  return [
    ...new Set(tasks.map((t) => t[key]).filter((v): v is string => Boolean(v))),
  ].sort();
}

export const labelOptions = (tasks: Task[], catalog: string[] = []) =>
  [...new Set([...catalog.filter((c) => c !== "decision:map"), ...tasks.flatMap((t) => t.labels ?? [])])].sort();

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
