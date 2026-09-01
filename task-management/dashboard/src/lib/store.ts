/**
 * The board in memory, fed by the SSE feed.
 *
 * An event row names an id and a kind but not the new values, so the client cannot apply
 * deltas blindly. Instead: a per-entity event marks that id dirty and one debounced
 * `/api/entity/:id` merges it; a structural event (create, done, moved, epic_*) refetches the
 * board once, debounced; a slow reconciliation fetch runs while the tab is visible. That
 * replaces the old "every SSE message refetches board+events+plans, plus a 15 s poll".
 *
 * ponytail: a module singleton read through useSyncExternalStore, the pattern pwa/outbox.mjs
 * already uses. No query cache: the whole board is one payload under 200 kB at 500 tasks.
 */
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { fetchBoard, fetchEntity, fetchEvents, fetchMeta, subscribe, WriteError } from "./api";
import { toast } from "./toast";
import type { Board, Entity, Kind, Meta, StoreEvent } from "./types";

export interface State {
  board: Board | null;
  meta: Meta | null;
  events: StoreEvent[];
  /** Full records (with body) by id, from detail fetches and dirty-merges. */
  details: Record<string, Entity>;
  live: boolean;
  loading: boolean;
  error: string | null;
  /** Wall clock, ticked every 15 s while visible, so elapsed labels move without a fetch. */
  now: number;
}

const EVENT_CAP = 2000;
const ENTITY_EVENTS = new Set([
  "update", "edit", "assign", "labels", "type", "prioritise", "estimate", "comment", "link", "unlink",
  "dep", "undep", "subtask", "rank", "ac_met", "ac_unmet", "ac_removed", "claim", "release",
  "worktree_new", "worktree_rm", "git_link", "sprint", "cap-accept", "cap-ship", "cap-drop",
]);
const SILENT_EVENTS = new Set(["notification", "subagent_stop", "init", "events_rotated", "override", "override_used", "stop_gate_blocked", "stop_gate_released", "goal_set", "git_link_skipped"]);

let state: State = { board: null, meta: null, events: [], details: {}, live: false, loading: true, error: null, now: Date.now() };
const listeners = new Set<() => void>();
function set(patch: Partial<State>) {
  state = { ...state, ...patch };
  for (const fn of listeners) fn();
}

export const kindOf = (id: string): Kind | null =>
  id.startsWith("TM-") ? "task" : id.startsWith("EP-") ? "epic" : id.startsWith("ADR-") ? "adr" : id.startsWith("SP-") ? "sprint" : id.startsWith("CAP-") ? "capability" : null;

const LIST: Record<Kind, keyof Board> = { task: "tasks", epic: "epics", adr: "adrs", sprint: "sprints", capability: "capabilities" };

/** Replace one row in its board list (or append it), and its detail record. */
function merge(entity: Entity) {
  const kind = kindOf(entity.id);
  const board = state.board;
  if (!kind || !board) return set({ details: { ...state.details, [entity.id]: entity } });
  const key = LIST[kind];
  const rows = ((board[key] as Entity[] | undefined) ?? []).slice();
  const { body: _body, ...row } = entity as Entity & { body?: string };
  const i = rows.findIndex((r) => r.id === entity.id);
  if (i >= 0) rows[i] = { ...rows[i], ...row } as Entity;
  else rows.push(row as Entity);
  set({ board: { ...board, [key]: rows }, details: { ...state.details, [entity.id]: entity } });
}

// ── fetch scheduling ───────────────────────────────────────────────────────────────────
const dirty = new Set<string>();
let dirtyTimer: ReturnType<typeof setTimeout> | null = null;
let boardTimer: ReturnType<typeof setTimeout> | null = null;
let inflight: Promise<void> | null = null;

async function flushDirty() {
  dirtyTimer = null;
  const ids = [...dirty];
  dirty.clear();
  await Promise.all(
    ids.map((id) =>
      fetchEntity(id)
        .then(merge)
        .catch(() => scheduleBoard()), // gone or unknown: the board knows
    ),
  );
}
function scheduleEntity(id: string) {
  dirty.add(id);
  if (!dirtyTimer) dirtyTimer = setTimeout(() => void flushDirty(), 150);
}
function scheduleBoard() {
  if (!boardTimer) boardTimer = setTimeout(() => void loadBoard(), 200);
}

async function loadBoard() {
  boardTimer = null;
  if (inflight) return inflight;
  inflight = fetchBoard()
    .then((board) => set({ board, error: null, loading: false, now: Date.now() }))
    .catch((err: Error) => set({ error: err.message, loading: false }))
    .finally(() => {
      inflight = null;
    });
  return inflight;
}

/** First load and every resync: board, meta, event tail. */
async function loadAll() {
  set({ loading: state.board === null });
  await Promise.all([
    loadBoard(),
    state.meta ? Promise.resolve() : fetchMeta().then((meta) => set({ meta })).catch(() => {}),
    fetchEvents().then((events) => set({ events: events.slice(-EVENT_CAP) })),
  ]);
}

// ── public surface ─────────────────────────────────────────────────────────────────────
export const store = {
  get: () => state,
  subscribe(fn: () => void) {
    listeners.add(fn);
    return () => listeners.delete(fn);
  },
  /** One SSE row. Appends to the feed and schedules the fetch that explains it. */
  ingest(e: StoreEvent) {
    set({ events: [...state.events, e].slice(-EVENT_CAP), now: Date.now() });
    if (SILENT_EVENTS.has(e.event)) return;
    if (e.id && ENTITY_EVENTS.has(e.event) && kindOf(e.id)) scheduleEntity(e.id);
    else scheduleBoard();
  },
  /**
   * Optimistic patch on one row. Returns the rollback. The caller sends the write; on refusal
   * it rolls back and the toast shows the server's own words.
   */
  apply(id: string, patch: Partial<Entity>): () => void {
    const before = state;
    const current = findRow(id);
    if (current) merge({ ...current, ...(state.details[id] ?? {}), ...patch } as Entity);
    return () => set({ board: before.board, details: before.details });
  },
  /** Pull the board again now — after a write whose side effects the event log names lazily. */
  reconcile: () => loadBoard(),
  resync: () => loadAll(),
  /** Detail record with body; fetched once, then kept fresh by dirty-merges. */
  async detail(id: string, force = false): Promise<Entity> {
    if (!force && state.details[id]) return state.details[id];
    const entity = await fetchEntity(id);
    merge(entity);
    return entity;
  },
};

function findRow(id: string): Entity | undefined {
  const kind = kindOf(id);
  if (!kind || !state.board) return undefined;
  return ((state.board[LIST[kind]] as Entity[] | undefined) ?? []).find((r) => r.id === id);
}

let started = false;
/** Mount once, in the shell: the feed, the reconciliation loop, the clock. */
export function startStore() {
  if (started) return () => {};
  started = true;
  void loadAll();
  const stop = subscribe({
    onEvent: (e) => store.ingest(e),
    onLive: (live) => {
      const was = state.live;
      set({ live });
      if (live && !was && state.board) void loadAll(); // reconnected: whatever we missed
    },
    onResync: () => void loadAll(),
  });
  const tick = () => {
    if (document.hidden) return;
    set({ now: Date.now() });
  };
  const clock = setInterval(tick, 15_000);
  const reconcile = setInterval(() => {
    if (!document.hidden) void loadBoard();
  }, 60_000);
  const visibility = () => {
    if (!document.hidden) void loadBoard();
  };
  document.addEventListener("visibilitychange", visibility);
  return () => {
    stop();
    clearInterval(clock);
    clearInterval(reconcile);
    document.removeEventListener("visibilitychange", visibility);
    started = false;
  };
}

// ── hooks ──────────────────────────────────────────────────────────────────────────────
const sub = (fn: () => void) => store.subscribe(fn);
export function useStore<T>(select: (s: State) => T): T {
  // getSnapshot must return the same value while nothing changed, or React loops (error 185).
  // `state` is replaced immutably in set(), so its identity is the cache key — a selector may
  // freely build an object or filter an array.
  const memo = useRef<{ s: State; v: T } | null>(null);
  return useSyncExternalStore(sub, () => {
    if (!memo.current || memo.current.s !== state) memo.current = { s: state, v: select(state) };
    return memo.current.v;
  });
}
export const useBoard = () => useStore((s) => s.board);
export const useMeta = () => useStore((s) => s.meta);
export const useLive = () => useStore((s) => s.live);
export const useNow = () => useStore((s) => s.now);
export const useEvents = () => useStore((s) => s.events);
export const useLoading = () => useStore((s) => ({ loading: s.loading, error: s.error }));

/** A list row straight from the board — cheap, no body. */
export function useRow<T extends Entity = Entity>(id: string | null): T | null {
  return useStore((s) => (id ? ((findRowIn(s.board, id) as T | undefined) ?? null) : null));
}
function findRowIn(board: Board | null, id: string): Entity | undefined {
  const kind = kindOf(id);
  if (!kind || !board) return undefined;
  return ((board[LIST[kind]] as Entity[] | undefined) ?? []).find((r) => r.id === id);
}

/** The full record (with body). Fetches on first use; the feed keeps it fresh. */
export function useEntity<T extends Entity = Entity>(id: string | null) {
  const detail = useStore((s) => (id ? ((s.details[id] as T | undefined) ?? null) : null));
  const row = useRow<T>(id);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    setError(null);
    if (!id || state.details[id]) return;
    store.detail(id).catch((err: Error) => setError(err.message));
  }, [id]);
  return { entity: detail ?? row, detail, loading: Boolean(id) && !detail && !error, error };
}

/**
 * Run a write: refusals become a toast with the server's own wording and are returned, never
 * swallowed. Pass `optimistic` to patch the row first and roll back on refusal.
 */
export function useWrite() {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const run = useCallback(
    async <T,>(fn: () => Promise<T>, opts: { optimistic?: { id: string; patch: Partial<Entity> }; ok?: string; reconcile?: boolean } = {}): Promise<T | undefined> => {
      setPending(true);
      setError(null);
      const rollback = opts.optimistic ? store.apply(opts.optimistic.id, opts.optimistic.patch) : null;
      try {
        const out = await fn();
        if (opts.ok) toast("ok", opts.ok);
        if (opts.reconcile !== false) scheduleBoard();
        return out;
      } catch (err) {
        rollback?.();
        const msg = err instanceof Error ? err.message : String(err);
        setError(msg);
        toast(err instanceof WriteError && err.status === 0 ? "warn" : "bad", "That change was refused", msg);
        return undefined;
      } finally {
        setPending(false);
      }
    },
    [],
  );
  return { run, pending, error, clear: () => setError(null) };
}
