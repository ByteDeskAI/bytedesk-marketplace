import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { cssMap } from "@atlaskit/css";
import Lozenge from "@atlaskit/lozenge";
import { Box, Inline, Stack, Text } from "@atlaskit/primitives/compiled";
import SectionMessage from "@atlaskit/section-message";
import Spinner from "@atlaskit/spinner";
import { burndown, startTimes } from "../metrics.mjs";
import { fetchBoard, fetchEvents, stopReason, subscribe, write } from "./api";
import { EMPTY, matches } from "./filters";
import type { Filters } from "./filters";
import { Activity } from "./components/Activity";
import { BulkBar } from "./components/BulkBar";
import { Column } from "./components/Column";
import { CreateModal } from "./components/CreateModal";
import { Sparkline } from "./components/Sparkline";
import { TaskDrawer } from "./components/TaskDrawer";
import { Toolbar } from "./components/Toolbar";
import { PwaBar } from "./components/PwaBar";
import { SettingsMenu } from "./components/SettingsMenu";
import { Palette } from "./components/Palette";
import type { Command } from "./components/Palette";
import { KeyHint, Shortcuts } from "./components/Shortcuts";
import { usePwa } from "./pwa/usePwa";
import { COLUMNS as KEY_COLUMNS, locate } from "./keys.mjs";
import {
  NO_EPIC,
  laneOrder,
  laneProgress,
  laneTasks,
  sortForLanes,
} from "./lanes.mjs";
import { loadCollapsed, saveCollapsed } from "./collapsed";
import { useLiveWork } from "./motion";
import { EpicLane } from "./components/EpicLane";
import type { Lane } from "./components/EpicLane";
import { useBoardKeys } from "./useBoardKeys";
import type { Board, Status, StoreEvent } from "./types";

// One order for the columns, the digit shortcuts and the keyboard walk — three
// arrays that must agree is three chances for `3` to mean a different column.
const COLUMNS = KEY_COLUMNS as Status[];

const styles = cssMap({
  page: { padding: "var(--ds-space-300)" },
  header: {
    borderBlockEndColor: "var(--ds-border)",
    borderBlockEndStyle: "solid",
    borderBlockEndWidth: "var(--ds-border-width)",
    paddingBlockEnd: "var(--ds-space-200)",
  },
  board: { overflowX: "auto", paddingBlockEnd: "var(--ds-space-100)" },
});

export function App() {
  const [board, setBoard] = useState<Board | null>(null);
  const [events, setEvents] = useState<StoreEvent[]>([]);
  const [live, setLive] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const [filters, setFilters] = useState<Filters>(EMPTY);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [openId, setOpenId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [palette, setPalette] = useState(false);
  const [help, setHelp] = useState(false);
  // localStorage is the cache that avoids a flash on load; the repo's config is the answer. It
  // used to be localStorage alone, which meant the layout you chose applied to one browser.
  const [grouped, setGrouped] = useState(
    () => localStorage.getItem("tm.grouped") === "1",
  );
  const searchRef = useRef<HTMLInputElement | null>(null);

  const setGroupedPersisted = useCallback((on: boolean) => {
    setGrouped(on);
    try {
      localStorage.setItem("tm.grouped", on ? "1" : "0");
    } catch {
      /* private mode — the toggle still works, it just won't persist locally */
    }
    void write.settings({ grouped: on });
  }, []);

  /**
   * Folded lanes. Seeded from localStorage once the project name is known — before that the
   * key would be wrong, and reading it early would fold the wrong board for one frame.
   */
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const project = board?.project ?? "";
  useEffect(() => {
    if (project) setCollapsed(loadCollapsed(project));
  }, [project]);
  const toggleLane = (id: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (!next.delete(id)) next.add(id);
      if (project) saveCollapsed(project, next);
      return next;
    });
  };

  const load = useCallback(() => {
    void fetchBoard().then(setBoard);
    void fetchEvents().then(setEvents);
    setNow(Date.now());
  }, []);

  useEffect(() => {
    load();
    // Elapsed times must tick even when the store is quiet. The SSE feed carries
    // writes from every other client and from the CLI, so no polling race.
    // The poll only exists to tick the elapsed-time labels; a hidden tab has no
    // labels to tick, and the SSE feed still delivers every real change.
    let timer = setInterval(load, 15_000);
    const visibility = () => {
      clearInterval(timer);
      if (!document.hidden) {
        load();
        timer = setInterval(load, 15_000);
      }
    };
    document.addEventListener("visibilitychange", visibility);
    const stop = subscribe(() => load(), setLive);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", visibility);
      stop();
    };
  }, [load]);

  /** Every write goes through here: refusals are shown, never swallowed. */
  const run = useCallback(
    (fn: () => Promise<unknown>) => {
      setError(null);
      fn()
        .catch((err: Error) => setError(err.message))
        .finally(load);
    },
    [load],
  );

  // Installability, notifications, the offline outbox and the app badge.
  const pwa = usePwa(
    events,
    (board?.tasks ?? []).filter((t) => t.status === "in_progress").length,
  );

  // The repo's copy wins over this browser's cache once it arrives.
  useEffect(() => {
    if (!board?.settings) return;
    pwa.adoptServerPrefs(board.settings);
    if (typeof board.settings.grouped === "boolean")
      setGrouped(board.settings.grouped);
  }, [board?.settings, pwa.adoptServerPrefs]);

  /**
   * Name the tab after the project too.
   *
   * The header alone does not help with two boards open: the tab strip shows only the title, and
   * every board's was "task-management board". Set from the payload rather than at build time,
   * because one built bundle serves every project.
   */
  useEffect(() => {
    if (board?.project) document.title = `${board.project} — board`;
  }, [board?.project]);

  const starts = useMemo(() => startTimes(events), [events]);
  // The store's own answer, out of state.json, which the board payload has always
  // carried. This used to be `epics.find(e => e.status !== "done")` — "the first epic
  // that isn't finished", which coincides with the active epic only while there is one
  // epic. With two, the header lozenge and the burndown both named the wrong one.
  const epic = board?.state?.activeEpic ?? null;

  const lanes = useMemo(
    () => (board ? laneOrder(board.epics, board.tasks, epic) : []),
    [board, epic],
  );

  // Backlog order: sparse ranks, unranked cards fall back to id order (creation order).
  // Grouped, the sort puts lanes in order first, so walking a status column with `j`
  // still goes down the screen instead of hopping between lanes.
  const visible = useMemo(() => {
    const filtered = (board?.tasks ?? []).filter((t) => matches(t, filters));
    return grouped
      ? sortForLanes(filtered, lanes)
      : filtered.sort(
          (a, b) =>
            (a.rank ?? Infinity) - (b.rank ?? Infinity) ||
            a.id.localeCompare(b.id),
        );
  }, [board, filters, grouped, lanes]);
  const series = useMemo(
    () =>
      board && epic
        ? burndown(board.tasks, events, { days: 14, now, epic })
        : [],
    [board, events, epic, now],
  );

  const select = (id: string, on: boolean) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });

  const toggle = useCallback(
    (id: string) =>
      setSelected((prev) =>
        prev.has(id)
          ? new Set([...prev].filter((x) => x !== id))
          : new Set([...prev, id]),
      ),
    [],
  );

  // A drawer, the create dialog, the palette or the help sheet owns the keyboard
  // while it is up — otherwise `c` inside a title field files a task.
  const modal = Boolean(openId) || creating || palette || help;

  const keys = useBoardKeys({
    visible,
    modal,
    onOpen: setOpenId,
    onTransition: (id, status) =>
      run(() => write.transition(id, status, stopReason(status))),
    onRank: (id, target, where) =>
      run(() => write.act(id, "rank", { [where]: target })),
    onSelect: toggle,
    onWatch: pwa.toggleWatch,
    onCreate: () => setCreating(true),
    onSearch: () => searchRef.current?.focus(),
    onHelp: () => setHelp(true),
    onPalette: () => setPalette(true),
    onEscape: () => {
      setSelected(new Set());
      setError(null);
    },
  });

  /** Board-level palette rows. Card actions are added by Palette from the cursor. */
  const commands: Command[] = useMemo(
    () => [
      {
        key: "create",
        label: "Create task",
        hint: "c",
        run: () => setCreating(true),
      },
      {
        key: "clear",
        label: "Clear all filters",
        run: () => setFilters(EMPTY),
      },
      {
        key: "search",
        label: "Search the board",
        hint: "/",
        run: () => searchRef.current?.focus(),
      },
      {
        key: "help",
        label: "Keyboard shortcuts",
        hint: "?",
        run: () => setHelp(true),
      },
      ...(keys.focusedId
        ? [
            {
              key: "open",
              label: `Open ${keys.focusedId}`,
              run: () => setOpenId(keys.focusedId),
            },
            {
              key: "watch",
              label: `Watch ${keys.focusedId}`,
              run: () => pwa.toggleWatch(keys.focusedId!),
            },
          ]
        : []),
      ...(selected.size
        ? [
            {
              key: "deselect",
              label: `Deselect ${selected.size} card(s)`,
              run: () => setSelected(new Set()),
            },
          ]
        : []),
    ],
    [keys.focusedId, pwa, selected.size],
  );

  /**
   * Which cards are being worked on right now — derived from the writes already streaming in over
   * SSE, so no new endpoint and no per-card transcript read. A card claimed hours ago and a card
   * being written to this second are both `in_progress`; only the second one moves.
   */
  const workingNow = useLiveWork(events, now);

  if (!board) {
    return (
      <Box xcss={styles.page}>
        <Spinner label="loading the board" />
      </Box>
    );
  }

  /**
   * The five status columns for one set of tasks. Rendered once flat, or once per lane.
   *
   * The keyboard cursor always reads the same five columns off `visible`, so a card's
   * focus index is computed from the whole board rather than from the lane it is in —
   * otherwise `j` would restart at the top of every lane.
   */
  const columnRow = (rows: typeof visible) => (
    <Box xcss={styles.board}>
      <Inline space="space.150" alignBlock="start">
        {COLUMNS.map((status, i) => (
          <Column
            key={status}
            index={i + 1}
            status={status}
            tasks={rows.filter((t) => t.status === status)}
            starts={starts}
            now={now}
            working={workingNow}
            focusedId={keys.focusedId}
            onFocusCard={(id) => {
              const at = locate(
                id,
                COLUMNS.map((s) =>
                  visible.filter((t) => t.status === s).map((t) => t.id),
                ),
              );
              if (at) keys.setFocus(at);
            }}
            selected={selected}
            onSelect={select}
            onOpen={setOpenId}
            onDrop={(id, to) =>
              run(() => write.transition(id, to, stopReason(to)))
            }
            watching={pwa.watching}
            onWatch={pwa.toggleWatch}
            outbox={pwa.pendingByTask}
            onDropBefore={(dragged, before) =>
              run(() =>
                board.tasks.find((t) => t.id === dragged)?.status === status
                  ? write.act(dragged, "rank", { before })
                  : write.transition(dragged, status, stopReason(status)),
              )
            }
          />
        ))}
      </Inline>
    </Box>
  );

  return (
    <Box xcss={styles.page}>
      <Stack space="space.200">
        <Box xcss={styles.header}>
          <Inline space="space.200" alignBlock="center" spread="space-between">
            <Inline space="space.150" alignBlock="center">
              <Text weight="bold">{board?.project ?? "task-management"}</Text>
              <Lozenge appearance="inprogress">
                {epic ?? "no active epic"}
              </Lozenge>
              <Text size="small" color="color.text.subtlest">
                {live ? "● live" : "○ reconnecting…"}
              </Text>
              <PwaBar pwa={pwa} />
              <SettingsMenu
                pwa={pwa}
                grouped={grouped}
                onGrouped={setGroupedPersisted}
                actor={board?.actor ?? null}
              />
            </Inline>
            <Inline space="space.200" alignBlock="center">
              <KeyHint onHelp={() => setHelp(true)} />
              <Sparkline series={series} />
            </Inline>
          </Inline>
        </Box>

        <Toolbar
          tasks={board.tasks}
          filters={filters}
          onChange={setFilters}
          onCreate={() => setCreating(true)}
          searchRef={searchRef}
          epics={board.epics}
          activeEpic={epic}
          onActivate={(id) => run(() => write.activeEpic(id))}
          savedViews={
            board.settings?.views as Record<string, Filters> | undefined
          }
          grouped={grouped}
          onGrouped={setGroupedPersisted}
        />

        {error ? (
          <SectionMessage appearance="error" title="That change was refused">
            <Text>{error}</Text>
          </SectionMessage>
        ) : null}

        <BulkBar
          ids={[...selected]}
          onClear={() => setSelected(new Set())}
          run={run}
        />

        {grouped ? (
          <Stack space="space.100">
            {(lanes as Lane[]).map((lane) => {
              const mine = laneTasks(visible, lane.id);
              const progress = laneProgress(laneTasks(board.tasks, lane.id));
              return (
                <Stack key={lane.id} space="space.075">
                  <EpicLane
                    lane={lane}
                    {...progress}
                    isNoEpic={lane.id === NO_EPIC}
                    onActivate={(id) => run(() => write.activeEpic(id))}
                    collapsed={collapsed.has(lane.id)}
                    onToggle={() => toggleLane(lane.id)}
                  />
                  {/* A lane the filter emptied is worth saying so, rather than
                      rendering five empty columns under a heading. */}
                  {collapsed.has(lane.id) ? null : mine.length ? (
                    columnRow(mine)
                  ) : (
                    <Text size="small" color="color.text.subtlest">
                      nothing here matches the filter
                    </Text>
                  )}
                </Stack>
              );
            })}
          </Stack>
        ) : (
          columnRow(visible)
        )}

        <Activity events={[...events].reverse().slice(0, 60)} />
      </Stack>

      <TaskDrawer
        task={board.tasks.find((t) => t.id === openId) ?? null}
        tasks={board.tasks}
        epics={board.epics}
        onClose={() => setOpenId(null)}
        run={run}
      />
      {creating ? (
        <CreateModal
          epics={board.epics}
          activeEpic={epic}
          onClose={() => setCreating(false)}
          run={run}
        />
      ) : null}
      <Palette
        isOpen={palette}
        onClose={() => setPalette(false)}
        tasks={visible}
        focused={keys.focusedId}
        commands={commands}
        onOpenTask={setOpenId}
        onTransition={(id, status) =>
          run(() => write.transition(id, status, stopReason(status)))
        }
      />
      <Shortcuts isOpen={help} onClose={() => setHelp(false)} />
    </Box>
  );
}
