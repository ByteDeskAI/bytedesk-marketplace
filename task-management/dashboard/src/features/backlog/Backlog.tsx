import { GripVertical, Inbox } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import "../../styles/board.css";
import { Button } from "../../components/ui/Button";
import { Chip } from "../../components/ui/Chip";
import { EmptyState } from "../../components/ui/EmptyState";
import { ErrorPanel } from "../../components/ui/ErrorPanel";
import { SkeletonRows } from "../../components/ui/Skeleton";
import type { ScreenProps } from "../../app/routes";
import { write } from "../../lib/api";
import { isTypingTarget, label, resolve } from "../../lib/keys.mjs";
import { usePaletteCommands } from "../../lib/palette";
import { Link, navigate, useLocation } from "../../lib/router";
import { useBoard, useLoading, useMeta, useWrite } from "../../lib/store";
import type { Status, Task } from "../../lib/types";
import { BulkBar } from "../board/BulkBar";
import { CreateEpicModal, CreateTaskModal } from "../board/CreateModals";
import { StopReason } from "../board/StopReason";
import { Toolbar } from "../board/Toolbar";
import { PRIORITY_GLYPH, holderOf, openBlockers, useFilters, visibleTasks } from "../board/model";

const RANK_STEP = 1000;
const INSPECTOR = /^\/(tasks|epics|sprints|capabilities|decisions)\/[^/]+$/;

/** `tm backlog`: every unfinished card by rank (a sparse integer), then id. */
function ranked(tasks: Task[]): Task[] {
  const open = tasks.filter((t) => t.status !== "done" && t.status !== "deleted").sort((a, b) => a.id.localeCompare(b.id));
  return open
    .map((t, i) => ({ t, key: t.rank ?? (i + 1) * RANK_STEP }))
    .sort((a, b) => a.key - b.key || a.t.id.localeCompare(b.t.id))
    .map((x) => x.t);
}

/** The queue as a table: where a card sits, what stops it, and whether it is committed. */
export default function Backlog(_: ScreenProps) {
  const board = useBoard();
  const meta = useMeta();
  const { loading, error } = useLoading();
  const { path } = useLocation();
  const { filters, set: setFilters } = useFilters();
  const { run } = useWrite();
  const [focus, setFocus] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [creating, setCreating] = useState<"task" | "epic" | null>(null);
  const [stop, setStop] = useState<{ ids: string[]; status: Status } | null>(null);

  const rows = useMemo(() => ranked(visibleTasks(board, filters)), [board, filters]);
  const ids = useMemo(() => rows.map((t) => t.id), [rows]);
  const sprintId = board?.state?.activeSprint ?? null;
  const sprint = board?.sprints.find((s) => s.id === sprintId) ?? null;
  const wipLimit = Number(meta?.config?.wipLimit) || 3;
  const inProgress = (board?.tasks ?? []).filter((t) => t.status === "in_progress").length;
  const points = rows.reduce((n, t) => n + (t.estimate ?? 0), 0);
  const unsized = rows.filter((t) => t.estimate == null).length;

  const open = useCallback((id: string) => navigate(`/tasks/${id}`, { inspector: true }), []);
  const rank = useCallback((id: string, target: string, where: "before" | "after") => void run(() => write.rank(id, { [where]: target })), [run]);
  const commit = useCallback(
    (id: string) => {
      const t = board?.tasks.find((x) => x.id === id);
      if (!t) return;
      const next = t.sprint && t.sprint === sprintId ? null : sprintId;
      if (!next && !t.sprint) return;
      void run(() => write.sprint(id, next), { optimistic: { id, patch: { sprint: next } }, ok: next ? `${id} committed to ${next}` : `${id} uncommitted` });
    },
    [board?.tasks, run, sprintId],
  );
  const select = useCallback((id: string) => setSelected((s) => { const n = new Set(s); if (!n.delete(id)) n.add(id); return n; }), []);

  // Keyboard: the board's rows without its columns. `s` commits to the sprint (screen-local).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const typing = isTypingTarget(e.target as HTMLElement);
      const modal = INSPECTOR.test(path) || creating !== null || stop !== null || Boolean(document.querySelector("dialog[open]"));
      if (!typing && !modal && !e.metaKey && !e.ctrlKey && !e.altKey && e.key === "s" && focus && sprintId) { e.preventDefault(); return commit(focus); }
      const intent = resolve(e, { typing, modal }) as { action: string } | null;
      if (!intent || !ids.length) return;
      const i = focus ? ids.indexOf(focus) : -1;
      const go = (n: number) => { e.preventDefault(); setFocus(ids[Math.max(0, Math.min(ids.length - 1, n))]); };
      switch (intent.action) {
        case "down": return go(i + 1);
        case "up": return go(i <= 0 ? 0 : i - 1);
        case "first": return go(0);
        case "last": return go(ids.length - 1);
        case "escape": e.preventDefault(); setFocus(null); return setSelected(new Set());
        case "create": e.preventDefault(); return setCreating("task");
        case "search": e.preventDefault(); return document.querySelector<HTMLInputElement>('input[type="search"]')?.focus();
        case "help": e.preventDefault(); return navigate("/help");
        default: break;
      }
      if (!focus) return;
      switch (intent.action) {
        case "open": e.preventDefault(); return open(focus);
        case "select": e.preventDefault(); return select(focus);
        case "rankUp": e.preventDefault(); return i > 0 ? rank(focus, ids[i - 1], "before") : undefined;
        case "rankDown": e.preventDefault(); return i < ids.length - 1 ? rank(focus, ids[i + 1], "after") : undefined;
        default: return;
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [ids, focus, path, creating, stop, sprintId, commit, open, select, rank]);
  useEffect(() => {
    if (focus) document.querySelector<HTMLElement>(`[data-tm-row="${focus}"]`)?.focus();
  }, [focus]);

  usePaletteCommands(() => [
    { label: "New task", hint: "c", group: "Backlog", run: () => setCreating("task") },
    ...(focus && sprintId ? [{ id: focus, label: `Commit ${focus} to ${sprintId}`, hint: "s", group: "Focused row", run: () => commit(focus) }] : []),
  ], [focus, sprintId, commit]);

  if (!board && loading) return <div className="tm-screen"><SkeletonRows rows={8} height={36} /></div>;
  if (!board) return <div className="tm-screen"><ErrorPanel title="The backlog could not be loaded" detail={error} /></div>;

  return (
    <div className="tm-screen tm-backlog-screen">
      <div className="tm-screen__head">
        <div>
          <h1>Backlog</h1>
          <p className="tm-backlog__summary">
            <span className="tm-id">{rows.length}</span> open · <span className="tm-id">{inProgress}/{wipLimit}</span> in progress (WIP) · <span className="tm-id">{points}</span> pts sized{unsized ? <>, <span className="tm-id">{unsized}</span> unsized</> : null}
            {sprint && <> · sprint <Link to={`/sprints/${sprint.id}`} inspector className="tm-id">{sprint.id}</Link>{sprint.report ? <> <span className="tm-id">{sprint.report.done}/{sprint.report.committed} pts</span>{sprint.report.unsized ? <> · {sprint.report.unsized} unsized</> : null}</> : null}{sprint.ends ? <> · ends <time className="tm-id" dateTime={sprint.ends}>{sprint.ends}</time></> : null}</>}
          </p>
        </div>
      </div>
      <Toolbar filters={filters} setFilters={setFilters} onCreateTask={() => setCreating("task")} onCreateEpic={() => setCreating("epic")} />
      <BulkBar ids={[...selected]} onClear={() => setSelected(new Set())} onStop={(ids, status) => setStop({ ids, status })} />
      {rows.length === 0 ? (
        <EmptyState icon={<Inbox size={28} />} title="Backlog is empty — every task is scheduled" action={<Button variant="primary" onClick={() => setCreating("task")}>New task</Button>}>
          Unfinished work lands here in rank order; drag a row or press [ and ] to reorder.
        </EmptyState>
      ) : (
        <div className="tm-table-wrap">
          <table className="tm-table tm-backlog" aria-label="ranked backlog">
            <thead>
              <tr>
                <th scope="col"><span className="sr-only">select</span></th>
                <th scope="col">rank</th>
                <th scope="col">id</th>
                <th scope="col">title</th>
                <th scope="col">status</th>
                <th scope="col">epic</th>
                <th scope="col">priority</th>
                <th scope="col" data-num>pts</th>
                <th scope="col">blocked by</th>
                <th scope="col">sprint</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((t, i) => {
                const blockers = openBlockers(t, board);
                const holder = holderOf(t, board);
                const committed = Boolean(sprintId) && t.sprint === sprintId;
                return (
                  <tr
                    key={t.id}
                    data-tm-row={t.id}
                    tabIndex={focus === t.id ? 0 : -1}
                    data-focused={focus === t.id || undefined}
                    data-selected={selected.has(t.id) || undefined}
                    aria-label={`${t.id} ${t.title}, ${label(t.status)}${blockers.length ? `, blocked by ${blockers.join(", ")}` : ""}${committed ? `, in ${sprintId}` : ""}`}
                    draggable
                    onDragStart={(e) => { e.dataTransfer.setData("text/tm-id", t.id); e.dataTransfer.effectAllowed = "move"; }}
                    onDragOver={(e) => { if (e.dataTransfer.types.includes("text/tm-id")) e.preventDefault(); }}
                    onDrop={(e) => { const d = e.dataTransfer.getData("text/tm-id"); if (d && d !== t.id) { e.preventDefault(); rank(d, t.id, "before"); } }}
                    onFocus={() => setFocus(t.id)}
                    onDoubleClick={() => open(t.id)}
                  >
                    <td data-label="select"><span className="tm-row" style={{ gap: "var(--tm-s1)" }}><GripVertical size={12} className="tm-backlog__grip" aria-hidden /><input type="checkbox" checked={selected.has(t.id)} onChange={() => select(t.id)} aria-label={`select ${t.id}`} /></span></td>
                    <td data-label="rank" className="tm-id">{t.rank ?? <span className="tm-faint" title="no explicit rank — placed by priority">{(i + 1) * RANK_STEP}</span>}</td>
                    <td data-label="id"><span className="tm-id">{t.id}</span></td>
                    <td data-label="title" className="tm-backlog__title"><button type="button" className="tm-linklike" aria-label={`Open ${t.id}: ${t.title}`} onClick={() => open(t.id)}>{t.title}</button>{holder && <Chip tone="accent" dot title={holder.session ?? holder.actor}>{holder.short}</Chip>}</td>
                    <td data-label="status"><Chip kind="status" value={t.status}>{label(t.status)}</Chip></td>
                    <td data-label="epic">{t.epic ? <Link to={`/epics/${t.epic}`} inspector className="tm-id">{t.epic}</Link> : <span className="tm-faint">—</span>}</td>
                    <td data-label="priority">{t.priority ? <Chip kind="plain" title={`priority ${t.priority}`}><span aria-hidden>{PRIORITY_GLYPH[t.priority]}</span> {t.priority}</Chip> : <span className="tm-faint">—</span>}</td>
                    <td data-label="pts" data-num>{t.estimate ?? <span className="tm-faint">—</span>}</td>
                    <td data-label="blocked by" className="tm-id">{blockers.length ? blockers.join(", ") : <span className="tm-faint">—</span>}</td>
                    <td data-label="sprint">
                      {t.sprint ? <Chip kind="count" tone={committed ? "accent" : undefined} onClick={sprintId ? () => commit(t.id) : undefined} title={committed ? "uncommit (s)" : undefined}>{t.sprint}</Chip> : sprintId ? <Button size="sm" variant="ghost" onClick={() => commit(t.id)} title="commit to the active sprint (s)">commit</Button> : <span className="tm-faint">—</span>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      <CreateTaskModal open={creating === "task"} onClose={() => setCreating(null)} />
      <CreateEpicModal open={creating === "epic"} onClose={() => setCreating(null)} />
      <StopReason target={stop} onConfirm={(reason) => { if (!stop) return; const s = stop; setStop(null); void run(() => write.bulk(s.ids, "transition", { status: s.status, reason }), { ok: `${s.ids.length} → ${label(s.status)}` }); }} onClose={() => setStop(null)} />
    </div>
  );
}
