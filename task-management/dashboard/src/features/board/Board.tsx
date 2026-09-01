import { Inbox, SearchX } from "lucide-react";
import { openKeysSheet } from "../../app/KeysSheet";
import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from "react";
import "../../styles/board.css";
import { Button } from "../../components/ui/Button";
import { EmptyState } from "../../components/ui/EmptyState";
import { ErrorPanel } from "../../components/ui/ErrorPanel";
import { Skeleton } from "../../components/ui/Skeleton";
import type { ScreenProps } from "../../app/routes";
import { write } from "../../lib/api";
import { isActive } from "../../lib/filters";
import { COLUMNS, label } from "../../lib/keys.mjs";
import { NO_EPIC, laneOrder, laneTasks, sortForLanes } from "../../lib/lanes.mjs";
import { useLiveWork } from "../../lib/motion";
import { usePaletteCommands } from "../../lib/palette";
import { navigate, useLocation } from "../../lib/router";
import { useBoard, useEvents, useLoading, useNow, useWrite } from "../../lib/store";
import type { Status, Task } from "../../lib/types";
import { useBoardKeys } from "../../lib/useBoardKeys";
import { getQueue, subscribe as subscribeOutbox } from "../../pwa/outbox.mjs";
import { pending as pendingOf } from "../../pwa/queue.mjs";
import { BulkBar } from "./BulkBar";
import { Column } from "./Column";
import { CreateEpicModal, CreateTaskModal } from "./CreateModals";
import { EpicLane, type Lane } from "./EpicLane";
import { StopReason } from "./StopReason";
import { TaskCard } from "./TaskCard";
import { Toolbar } from "./Toolbar";
import { EMPTY, elapsedMs, holderOf, isStale, openBlockers, useCollapsed, useFilters, useGrouped, useIsPhone, useStaleMinutes, useWatching, visibleTasks } from "./model";

const INSPECTOR = /^\/(tasks|epics|sprints|capabilities|decisions)\/[^/]+$/;
const outboxSub = (fn: () => void) => subscribeOutbox(fn) as () => void;
/** Queued / refused writes per task, from the offline outbox; the queue reference is the snapshot. */
function usePending(): Map<string, { status: string }> {
  const queue = useSyncExternalStore(outboxSub, getQueue);
  return useMemo(() => pendingOf(queue) as Map<string, { status: string }>, [queue]);
}

/** The kanban: six columns, or one row of six per epic lane; every write is a CLI verb. */
export default function Board(_: ScreenProps) {
  const board = useBoard();
  const events = useEvents();
  const now = useNow();
  const { loading, error } = useLoading();
  const { path } = useLocation();
  const { filters, set: setFilters } = useFilters();
  const [grouped, setGrouped] = useGrouped();
  const { collapsed, toggle } = useCollapsed(board?.project ?? "");
  const [watching, toggleWatch] = useWatching();
  const staleMinutes = useStaleMinutes();
  const phone = useIsPhone();
  const pending = usePending();
  const live = useLiveWork(events, now);
  const { run } = useWrite();

  // The phone shows one column; open on the first that has cards rather than an empty one.
  const [phonePick, setPhoneStatus] = useState<Status | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [creating, setCreating] = useState<"task" | "epic" | null>(null);
  const [stop, setStop] = useState<{ ids: string[]; status: Status } | null>(null);

  const activeEpic = board?.state?.activeEpic ?? null;
  const visible = useMemo(() => visibleTasks(board, filters), [board, filters]);
  const lanes = useMemo<Lane[]>(() => (grouped ? (laneOrder(board?.epics ?? [], visible, activeEpic) as Lane[]) : []), [grouped, board?.epics, visible, activeEpic]);
  // Lane-first order keeps `j` walking down the screen; ungrouped, rank then id.
  const ordered = useMemo(() => sortForLanes(visible, lanes) as Task[], [visible, lanes]);
  const phoneStatus: Status = phonePick ?? (COLUMNS as Status[]).find((s) => ordered.some((t) => t.status === s)) ?? "in_progress";
  const byId = useMemo(() => new Map((board?.tasks ?? []).map((t) => [t.id, t])), [board?.tasks]);
  const inspectorOpen = INSPECTOR.test(path);

  // ── writes ─────────────────────────────────────────────────────────────────────────
  const move = useCallback(
    (id: string, status: Status, reason?: string) => {
      const t = byId.get(id);
      if (!t || t.status === status) return;
      if ((status === "blocked" || status === "parked") && reason === undefined) return setStop({ ids: [id], status });
      // `done` runs the acceptance gate; a card that jumps and comes back teaches you to distrust the jump.
      void run(() => write.transition(id, status, reason ? { reason } : {}), { optimistic: status === "done" ? undefined : { id, patch: { status } } });
    },
    [byId, run],
  );
  const rank = useCallback((id: string, target: string, where: "before" | "after") => void run(() => write.rank(id, { [where]: target })), [run]);
  const dropBefore = useCallback(
    (dragged: string, target: string) => {
      const a = byId.get(dragged);
      const b = byId.get(target);
      if (!a || !b) return;
      if (a.status !== b.status) move(dragged, b.status);
      rank(dragged, target, "before");
    },
    [byId, move, rank],
  );
  const select = useCallback((id: string) => setSelected((s) => { const n = new Set(s); if (!n.delete(id)) n.add(id); return n; }), []);
  const open = useCallback((id: string) => navigate(`/tasks/${id}`, { inspector: true }), []);
  const confirmStop = (reason: string) => {
    if (!stop) return;
    const { ids, status } = stop;
    setStop(null);
    if (ids.length === 1) return move(ids[0], status, reason || "");
    void run(() => write.bulk(ids, "transition", { status, reason }), { ok: `${ids.length} cards → ${label(status)}` });
  };

  // ── keyboard ───────────────────────────────────────────────────────────────────────
  const { focusedId } = useBoardKeys({
    visible: ordered,
    modal: inspectorOpen || creating !== null || stop !== null,
    onOpen: open,
    onTransition: move,
    onRank: rank,
    onSelect: select,
    onWatch: toggleWatch,
    onCreate: () => setCreating("task"),
    onSearch: () => document.querySelector<HTMLInputElement>('input[type="search"]')?.focus(),
    onHelp: openKeysSheet,
    onPalette: () => {}, // the shell opens it
    onEscape: () => setSelected(new Set()),
  });

  usePaletteCommands(() => {
    const cmds = [];
    const t = focusedId ? byId.get(focusedId) : null;
    if (t) {
      for (const s of COLUMNS as Status[]) if (s !== t.status) cmds.push({ id: t.id, label: `Move ${t.id} to ${label(s)}`, group: "Focused card", run: () => move(t.id, s) });
      cmds.push({ id: t.id, label: `Open ${t.id}`, group: "Focused card", run: () => open(t.id) }, { id: t.id, label: `${selected.has(t.id) ? "Deselect" : "Select"} ${t.id}`, group: "Focused card", run: () => select(t.id) }, { id: t.id, label: `${watching.has(t.id) ? "Unwatch" : "Watch"} ${t.id}`, group: "Focused card", run: () => toggleWatch(t.id) });
    }
    cmds.push(
      { label: "New task", hint: "c", group: "Board", run: () => setCreating("task") },
      { label: "New epic", group: "Board", run: () => setCreating("epic") },
      { label: grouped ? "Ungroup columns" : "Group by epic", group: "Board", run: () => { setGrouped(!grouped); void write.settings({ grouped: !grouped }); } },
      { label: "Clear filters", group: "Board", run: () => setFilters(EMPTY) },
    );
    return cmds;
  }, [focusedId, byId, selected, watching, grouped, move, open, select, toggleWatch, setGrouped, setFilters]);

  useEffect(() => {
    // A selection of cards that filtered away is a bulk write on things you cannot see.
    setSelected((s) => { const keep = new Set([...s].filter((id) => visible.some((t) => t.id === id))); return keep.size === s.size ? s : keep; });
  }, [visible]);

  // ── render ─────────────────────────────────────────────────────────────────────────
  if (!board && loading) return <BoardSkeleton />;
  if (!board) return <div className="tm-screen"><ErrorPanel title="The board could not be loaded" detail={error} /></div>;

  const card = (t: Task) => (
    <TaskCard
      key={t.id}
      task={t}
      focused={focusedId === t.id}
      selected={selected.has(t.id)}
      live={live.has(t.id)}
      stale={isStale(t, now, staleMinutes)}
      watched={watching.has(t.id)}
      holder={holderOf(t, board)}
      blockers={openBlockers(t, board)}
      pending={pending.get(t.id)?.status}
      elapsed={elapsedMs(t, now)}
      onOpen={open}
      onSelect={select}
      onWatch={toggleWatch}
      onDragStart={() => {}}
      onDropBefore={dropBefore}
    />
  );
  const columns = (tasks: Task[]) =>
    (COLUMNS as Status[]).filter((s) => !phone || s === phoneStatus).map((s) => {
      const rows = tasks.filter((t) => t.status === s);
      return (
        <Column key={s} status={s} count={rows.length} onDropStatus={move} compact={phone}>
          {rows.map(card)}
        </Column>
      );
    });

  const noWork = board.tasks.length === 0;
  return (
    <div className="tm-screen tm-board-screen" data-phone={phone || undefined}>
      <h1 className="sr-only">Board</h1>
      <Toolbar filters={filters} setFilters={setFilters} grouped={grouped} setGrouped={setGrouped} onCreateTask={() => setCreating("task")} onCreateEpic={() => setCreating("epic")} />
      <BulkBar ids={[...selected]} onClear={() => setSelected(new Set())} onStop={(ids, status) => setStop({ ids, status })} />
      {phone && (
        <nav className="tm-segmented" aria-label="column">
          {(COLUMNS as Status[]).map((s) => (
            <button key={s} type="button" aria-pressed={s === phoneStatus} onClick={() => setPhoneStatus(s)}>
              {label(s)} <span className="tm-id">{ordered.filter((t) => t.status === s).length}</span>
            </button>
          ))}
        </nav>
      )}
      {noWork ? (
        <EmptyState icon={<Inbox size={28} />} title={activeEpic ? "No tasks yet" : "No epic is active"} action={activeEpic ? <Button variant="primary" onClick={() => setCreating("task")}>New task</Button> : <Button variant="primary" onClick={() => setCreating("epic")}>Create epic</Button>}>
          {activeEpic ? `Tasks file under ${activeEpic}. Press c, or run tm task new "<title>".` : "Epics gate task creation. Open one here or with tm epic new \"<title>\"."}
        </EmptyState>
      ) : visible.length === 0 && isActive(filters) ? (
        <EmptyState icon={<SearchX size={28} />} title="Nothing matches" action={<Button onClick={() => setFilters(EMPTY)}>Clear filters</Button>}>
          {board.tasks.length} task{board.tasks.length === 1 ? "" : "s"} on the board, none matching the filter.
        </EmptyState>
      ) : grouped ? (
        <div className="tm-lanes">
          {lanes.map((lane) => {
            const rows = laneTasks(ordered, lane.id) as Task[];
            const folded = collapsed.has(lane.id);
            return (
              <section key={lane.id} className="tm-lane-block" aria-label={lane.id === NO_EPIC ? "no epic" : lane.id}>
                <EpicLane lane={lane} tasks={rows} collapsed={folded} onToggle={() => toggle(lane.id)} />
                {!folded && <div className="tm-board">{columns(rows)}</div>}
              </section>
            );
          })}
        </div>
      ) : (
        <div className="tm-board">{columns(ordered)}</div>
      )}
      <CreateTaskModal open={creating === "task"} onClose={() => setCreating(null)} />
      <CreateEpicModal open={creating === "epic"} onClose={() => setCreating(null)} />
      <StopReason target={stop} onConfirm={confirmStop} onClose={() => setStop(null)} />
    </div>
  );
}

function BoardSkeleton() {
  return (
    <div className="tm-screen" aria-busy="true" aria-label="loading the board">
      <Skeleton height={28} width="60%" />
      <div className="tm-board">
        {COLUMNS.map((s) => (
          <div key={s} className="tm-col"><Skeleton height={20} width="50%" /><Skeleton height={84} /><Skeleton height={84} /><Skeleton height={64} /></div>
        ))}
      </div>
    </div>
  );
}
