/**
 * What the board, the backlog and the epic screens agree on: how a task reads (holder, staleness,
 * decision role), the queue order `tm next` uses, filters in the URL, and the few per-browser
 * preferences (grouping, folded lanes, watched cards).
 *
 * Pure where it can be; hooks only where the URL or the store is involved.
 */
import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { loadCollapsed, saveCollapsed } from "../../lib/collapsed";
import { EMPTY, FIELD_NAMES, formatQuery, matches, parseQuery, type Filters } from "../../lib/filters";
import { setQuery, useLocation } from "../../lib/router";
import { useBoard, useMeta, useNow } from "../../lib/store";
import type { Board, Task } from "../../lib/types";
import { loadPrefs, pushPrefs, savePrefs } from "../../pwa/prefs.mjs";

// ── vocabulary ──────────────────────────────────────────────────────────────────────────
export const PRIORITIES = ["highest", "high", "medium", "low", "lowest"] as const;
export const PRIORITY_GLYPH: Record<string, string> = { highest: "▲▲", high: "▲", medium: "◆", low: "▼", lowest: "▼▼" };
/** `decision:*` roles a ticket can wear; `decision:map` is the epic's, never a ticket's. */
const DECISION_KIND = ["decision:interview", "decision:research", "decision:prototype", "decision:unblock"];

export const decisionRole = (labels: string[] = []) => labels.find((l) => DECISION_KIND.includes(l)) ?? null;
/** HITL vs AFK — from the role, never the status (lib/decision.mjs attentionOf). */
export const attentionOf = (role: string | null) => (role ? (role === "decision:research" ? "AFK" : "HITL") : null);
export const needsAnswer = (t: Task) => Boolean(decisionRole(t.labels)) && !t.hasAnswer && t.status !== "done";

/** Direct blockers still open — the card shows those, the inspector walks the chain. */
export const openBlockers = (t: Task, board: Board | null) =>
  (t.blockedBy ?? []).filter((id) => {
    const b = board?.tasks.find((x) => x.id === id);
    return !b || (b.status !== "done" && b.status !== "deleted");
  });

/**
 * `tm next` order (lib/store.mjs queueOrder): an explicit rank first, in rank order; then priority
 * with unset read as medium; id breaks the tie so the same board never renders two ways.
 */
export function queueOrder(tasks: Task[], priorities: readonly string[] = PRIORITIES): Task[] {
  const pri = (t: Task) => {
    const i = priorities.indexOf(t.priority ?? "medium");
    return i < 0 ? priorities.indexOf("medium") : i;
  };
  return [...tasks].sort((a, b) => {
    const ar = a.rank != null;
    const br = b.rank != null;
    if (ar !== br) return ar ? -1 : 1;
    if (ar && br && a.rank !== b.rank) return (a.rank as number) - (b.rank as number);
    return pri(a) - pri(b) || a.id.localeCompare(b.id);
  });
}

// ── who holds it, how long it has sat ─────────────────────────────────────────────────
export interface Holder { actor: string; session: string | null; short: string }

/** The claim in state.json wins; the task's own stamp is the fallback for a store without one. */
export function holderOf(t: Task, board: Board | null): Holder | null {
  if (t.status !== "in_progress") return null;
  const claim = (board?.state?.claims ?? {})[t.id] as { session?: string | null; actor?: string } | undefined;
  const actor = claim?.actor ?? t.actor ?? null;
  const session = claim?.session ?? t.session ?? null;
  if (!actor && !session) return null;
  const who = actor ?? "session";
  return { actor: who, session, short: session ? `${who} · ${session.slice(0, 4)}…` : who };
}

export const elapsedMs = (t: Task, now: number) => {
  const at = Date.parse(t.updated ?? t.created ?? "");
  return Number.isNaN(at) ? null : Math.max(0, now - at);
};

/** In progress and untouched for longer than `staleMinutes` — the config the CLI reads too. */
export function isStale(t: Task, now: number, staleMinutes: number) {
  if (t.status !== "in_progress") return false;
  const ms = elapsedMs(t, now);
  return ms !== null && ms > staleMinutes * 60_000;
}

export const acCount = (t: Task) => {
  const all = t.acceptance ?? [];
  return { met: all.filter((a) => a.done).length, total: all.length };
};

export const stopReason = (t: Task) => (t.status === "blocked" ? t.blockedReason : t.status === "parked" ? t.parkedReason : undefined);

export function useStaleMinutes() {
  const meta = useMeta();
  const v = Number(meta?.config?.staleMinutes);
  return Number.isFinite(v) && v > 0 ? v : 90;
}

// ── filters live in the URL ───────────────────────────────────────────────────────────
export function useFilters(): { filters: Filters; q: string; set: (f: Filters) => void; fields: readonly string[] } {
  const { query } = useLocation();
  const meta = useMeta();
  const q = query.get("q") ?? "";
  const fields = meta?.vocab.findFields ?? FIELD_NAMES;
  const filters = useMemo(() => parseQuery(q, fields), [q, fields]);
  const set = useCallback((f: Filters) => setQuery({ q: formatQuery(f) || null }), []);
  return { filters, q, set, fields };
}

export const visibleTasks = (board: Board | null, f: Filters) =>
  (board?.tasks ?? []).filter((t) => t.status !== "deleted" && matches(t, f));

export { EMPTY, matches, formatQuery };
export type { Filters };

// ── small per-browser preferences ─────────────────────────────────────────────────────
/** Group-by-epic: localStorage renders the first frame; the repo's setting wins when it arrives. */
export function useGrouped(): [boolean, (on: boolean) => void] {
  const board = useBoard();
  const [grouped, setGrouped] = useState(() => localStorage.getItem("tm.grouped") === "1");
  useEffect(() => {
    if (typeof board?.settings?.grouped === "boolean") setGrouped(board.settings.grouped);
  }, [board?.settings?.grouped]);
  const set = useCallback((on: boolean) => {
    setGrouped(on);
    try {
      localStorage.setItem("tm.grouped", on ? "1" : "0");
    } catch {
      /* private mode */
    }
  }, []);
  return [grouped, set];
}

export function useCollapsed(project: string) {
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  useEffect(() => {
    if (project) setCollapsed(loadCollapsed(project));
  }, [project]);
  const toggle = useCallback(
    (id: string) =>
      setCollapsed((prev) => {
        const next = new Set(prev);
        if (!next.delete(id)) next.add(id);
        if (project) saveCollapsed(project, next);
        return next;
      }),
    [project],
  );
  return { collapsed, toggle };
}

/**
 * Watched cards. The PWA hook in the shell owns notifications; this reads and writes the same
 * prefs blob so `w` on a card lands where the notifier looks.
 * ponytail: the shell's copy catches up on its next prefs load rather than through a shared bus.
 */
const watchListeners = new Set<() => void>();
let watching: string[] = loadPrefs().watching as string[];
export function useWatching(): [Set<string>, (id: string) => void] {
  const list = useSyncExternalStore(
    (fn) => {
      watchListeners.add(fn);
      return () => watchListeners.delete(fn);
    },
    () => watching,
  );
  const toggle = useCallback((id: string) => {
    const prefs = loadPrefs();
    const next = prefs.watching.includes(id) ? prefs.watching.filter((x: string) => x !== id) : [...prefs.watching, id];
    const merged = { ...prefs, watching: next };
    savePrefs(merged);
    void pushPrefs(merged);
    watching = next;
    watchListeners.forEach((fn) => fn());
  }, []);
  return [useMemo(() => new Set(list), [list]), toggle];
}

export function useMedia(query: string) {
  const mq = useMemo(() => (typeof matchMedia === "function" ? matchMedia(query) : null), [query]);
  return useSyncExternalStore(
    (fn) => {
      mq?.addEventListener("change", fn);
      return () => mq?.removeEventListener("change", fn);
    },
    () => mq?.matches ?? false,
  );
}
export const useIsPhone = () => useMedia("(max-width: 719px)");

export { useNow };
