import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { cssMap } from "@atlaskit/css";
import Lozenge from "@atlaskit/lozenge";
import { Box, Inline, Stack, Text } from "@atlaskit/primitives/compiled";
import SectionMessage from "@atlaskit/section-message";
import Spinner from "@atlaskit/spinner";
import { burndown, startTimes } from "../metrics.mjs";
import { fetchBoard, fetchEvents, subscribe, write } from "./api";
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
import { Palette } from "./components/Palette";
import type { Command } from "./components/Palette";
import { KeyHint, Shortcuts } from "./components/Shortcuts";
import { usePwa } from "./pwa/usePwa";
import { COLUMNS as KEY_COLUMNS, locate } from "./keys.mjs";
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
  const searchRef = useRef<HTMLInputElement | null>(null);

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
  const pwa = usePwa(events, (board?.tasks ?? []).filter((t) => t.status === "in_progress").length);

  const starts = useMemo(() => startTimes(events), [events]);
  const epic = board?.epics.find((e) => e.status !== "done")?.id ?? null;
  // Backlog order: sparse ranks, unranked cards fall back to id order (creation order).
  const visible = useMemo(
    () =>
      (board?.tasks ?? [])
        .filter((t) => matches(t, filters))
        .sort((a, b) => (a.rank ?? Infinity) - (b.rank ?? Infinity) || a.id.localeCompare(b.id)),
    [board, filters],
  );
  const series = useMemo(
    () => (board && epic ? burndown(board.tasks, events, { days: 14, now, epic }) : []),
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
    (id: string) => setSelected((prev) => (prev.has(id) ? new Set([...prev].filter((x) => x !== id)) : new Set([...prev, id]))),
    [],
  );

  // A drawer, the create dialog, the palette or the help sheet owns the keyboard
  // while it is up — otherwise `c` inside a title field files a task.
  const modal = Boolean(openId) || creating || palette || help;

  const keys = useBoardKeys({
    visible,
    modal,
    onOpen: setOpenId,
    onTransition: (id, status) => run(() => write.transition(id, status)),
    onRank: (id, target, where) => run(() => write.act(id, "rank", { [where]: target })),
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
      { key: "create", label: "Create task", hint: "c", run: () => setCreating(true) },
      { key: "clear", label: "Clear all filters", run: () => setFilters(EMPTY) },
      { key: "search", label: "Search the board", hint: "/", run: () => searchRef.current?.focus() },
      { key: "help", label: "Keyboard shortcuts", hint: "?", run: () => setHelp(true) },
      ...(keys.focusedId
        ? [
            { key: "open", label: `Open ${keys.focusedId}`, run: () => setOpenId(keys.focusedId) },
            { key: "watch", label: `Watch ${keys.focusedId}`, run: () => pwa.toggleWatch(keys.focusedId!) },
          ]
        : []),
      ...(selected.size
        ? [{ key: "deselect", label: `Deselect ${selected.size} card(s)`, run: () => setSelected(new Set()) }]
        : []),
    ],
    [keys.focusedId, pwa, selected.size],
  );

  if (!board) {
    return (
      <Box xcss={styles.page}>
        <Spinner label="loading the board" />
      </Box>
    );
  }

  return (
    <Box xcss={styles.page}>
      <Stack space="space.200">
        <Box xcss={styles.header}>
          <Inline space="space.200" alignBlock="center" spread="space-between">
            <Inline space="space.150" alignBlock="center">
              <Text weight="bold">task-management</Text>
              <Lozenge appearance="inprogress">{epic ?? "no active epic"}</Lozenge>
              <Text size="small" color="color.text.subtlest">
                {live ? "● live" : "○ reconnecting…"}
              </Text>
              <PwaBar pwa={pwa} />
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
        />

        {error ? (
          <SectionMessage appearance="error" title="That change was refused">
            <Text>{error}</Text>
          </SectionMessage>
        ) : null}

        <BulkBar ids={[...selected]} onClear={() => setSelected(new Set())} run={run} />

        <Box xcss={styles.board}>
          <Inline space="space.150" alignBlock="start">
            {COLUMNS.map((status, i) => (
              <Column
                key={status}
                index={i + 1}
                status={status}
                tasks={visible.filter((t) => t.status === status)}
                starts={starts}
                now={now}
                focusedId={keys.focusedId}
                onFocusCard={(id) => {
                  const at = locate(id, COLUMNS.map((s) => visible.filter((t) => t.status === s).map((t) => t.id)));
                  if (at) keys.setFocus(at);
                }}
                selected={selected}
                onSelect={select}
                onOpen={setOpenId}
                onDrop={(id, to) => run(() => write.transition(id, to))}
                watching={pwa.watching}
                onWatch={pwa.toggleWatch}
                outbox={pwa.pendingByTask}
                onDropBefore={(dragged, before) =>
                  run(() =>
                    board.tasks.find((t) => t.id === dragged)?.status === status
                      ? write.act(dragged, "rank", { before })
                      : write.transition(dragged, status),
                  )
                }
              />
            ))}
          </Inline>
        </Box>

        <Activity events={[...events].reverse().slice(0, 60)} />
      </Stack>

      <TaskDrawer
        task={board.tasks.find((t) => t.id === openId) ?? null}
        tasks={board.tasks}
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
        onTransition={(id, status) => run(() => write.transition(id, status))}
      />
      <Shortcuts isOpen={help} onClose={() => setHelp(false)} />
    </Box>
  );
}
