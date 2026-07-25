import type { Task } from "./types";

export interface Filters {
  text: string;
  epic: string | null;
  assignee: string | null;
  actor: string | null;
  priority: string | null;
  label: string | null;
}

export const EMPTY: Filters = { text: "", epic: null, assignee: null, actor: null, priority: null, label: null };

export function matches(task: Task, f: Filters): boolean {
  if (f.epic && task.epic !== f.epic) return false;
  if (f.assignee && task.assignee !== f.assignee) return false;
  if (f.actor && task.actor !== f.actor) return false;
  if (f.priority && task.priority !== f.priority) return false;
  if (f.label && !(task.labels ?? []).includes(f.label)) return false;
  if (f.text) {
    const hay = `${task.id} ${task.title} ${(task.labels ?? []).join(" ")}`.toLowerCase();
    if (!hay.includes(f.text.toLowerCase())) return false;
  }
  return true;
}

export const isActive = (f: Filters) => JSON.stringify(f) !== JSON.stringify(EMPTY);

/** Distinct values actually present on the board — no empty dropdowns. */
export function options(tasks: Task[], key: "epic" | "assignee" | "actor" | "priority"): string[] {
  return [...new Set(tasks.map((t) => t[key]).filter((v): v is string => Boolean(v)))].sort();
}

export const labelOptions = (tasks: Task[]) => [...new Set(tasks.flatMap((t) => t.labels ?? []))].sort();

// ── saved views ──────────────────────────────────────────────────────────────
// ponytail: localStorage, per browser. Move to the store only if views need to
// follow the project across machines.
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
