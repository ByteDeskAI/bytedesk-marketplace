import { FileText, Layers, Map, Plus } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import "../../styles/board.css";
import { Button } from "../../components/ui/Button";
import { Chip } from "../../components/ui/Chip";
import { EmptyState } from "../../components/ui/EmptyState";
import { ErrorPanel } from "../../components/ui/ErrorPanel";
import { Progress } from "../../components/ui/Progress";
import { SkeletonRows } from "../../components/ui/Skeleton";
import type { ScreenProps } from "../../app/routes";
import { write } from "../../lib/api";
import { isTypingTarget, label, resolve } from "../../lib/keys.mjs";
import { laneProgress } from "../../lib/lanes.mjs";
import { usePaletteCommands } from "../../lib/palette";
import { navigate, useLocation } from "../../lib/router";
import { useBoard, useLoading, useWrite } from "../../lib/store";
import type { Epic, Task } from "../../lib/types";
import { CreateEpicModal } from "../board/CreateModals";
import { decisionRole, useFilters } from "../board/model";

const INSPECTOR = /^\/(tasks|epics|sprints|capabilities|decisions)\/[^/]+$/;

/** Active first, then open by id, then closed: the order the board's lanes use. */
function order(epics: Epic[], active: string | null): Epic[] {
  return [...epics].sort((a, b) => {
    if ((a.id === active) !== (b.id === active)) return a.id === active ? -1 : 1;
    const closed = (e: Epic) => (e.status === "done" ? 1 : 0);
    return closed(a) - closed(b) || a.id.localeCompare(b.id);
  });
}

/** Every epic with its progress; open one to read the record it keeps. */
export default function Epics(_: ScreenProps) {
  const board = useBoard();
  const { loading, error } = useLoading();
  const { path } = useLocation();
  const { filters } = useFilters();
  const { run } = useWrite();
  const [focus, setFocus] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const active = board?.state?.activeEpic ?? null;

  const rows = useMemo(() => {
    const q = filters.text.toLowerCase();
    const list = (board?.epics ?? []).filter((e) => (!q || `${e.id} ${e.title}`.toLowerCase().includes(q)) && (!filters.epic || e.id === filters.epic));
    return order(list, active);
  }, [board?.epics, filters, active]);
  const ids = useMemo(() => rows.map((e) => e.id), [rows]);
  const childrenOf = useCallback((id: string) => (board?.tasks ?? []).filter((t) => t.epic === id && t.status !== "deleted"), [board?.tasks]);
  const open = useCallback((id: string) => navigate(`/epics/${id}`, { inspector: true }), []);
  const activate = useCallback((id: string) => void run(() => write.activeEpic(id), { ok: `${id} is the active epic` }), [run]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const typing = isTypingTarget(e.target as HTMLElement);
      const modal = INSPECTOR.test(path) || creating || Boolean(document.querySelector("dialog[open]"));
      if (!typing && !modal && !e.metaKey && !e.ctrlKey && !e.altKey && e.key === "a" && focus) { e.preventDefault(); return activate(focus); }
      const intent = resolve(e, { typing, modal }) as { action: string } | null;
      if (!intent || !ids.length) return;
      const i = focus ? ids.indexOf(focus) : -1;
      const go = (n: number) => { e.preventDefault(); setFocus(ids[Math.max(0, Math.min(ids.length - 1, n))]); };
      switch (intent.action) {
        case "down": return go(i + 1);
        case "up": return go(i <= 0 ? 0 : i - 1);
        case "first": return go(0);
        case "last": return go(ids.length - 1);
        case "open": if (focus) { e.preventDefault(); open(focus); } return;
        case "create": e.preventDefault(); return setCreating(true);
        case "search": e.preventDefault(); return document.querySelector<HTMLInputElement>('input[type="search"]')?.focus();
        case "help": e.preventDefault(); return navigate("/help");
        case "escape": return setFocus(null);
        default: return;
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [ids, focus, path, creating, activate, open]);
  useEffect(() => {
    if (focus) document.querySelector<HTMLElement>(`[data-tm-epic="${focus}"]`)?.focus();
  }, [focus]);

  usePaletteCommands(() => [
    { label: "New epic", hint: "c", group: "Epics", run: () => setCreating(true) },
    ...(focus && focus !== active ? [{ id: focus, label: `Make ${focus} the active epic`, hint: "a", group: "Focused epic", run: () => activate(focus) }] : []),
  ], [focus, active, activate]);

  if (!board && loading) return <div className="tm-screen"><SkeletonRows rows={5} height={72} /></div>;
  if (!board) return <div className="tm-screen"><ErrorPanel title="Epics could not be loaded" detail={error} /></div>;

  return (
    <div className="tm-screen tm-epics-screen">
      <div className="tm-screen__head">
        <h1>Epics</h1>
        <div className="tm-screen__actions"><Button variant="primary" onClick={() => setCreating(true)}><Plus size={14} /> New epic</Button></div>
      </div>
      {rows.length === 0 ? (
        <EmptyState icon={<Layers size={28} />} title={board.epics.length ? "No epic matches" : "No epics yet"} action={<Button variant="primary" onClick={() => setCreating(true)}>Create epic</Button>}>
          {board.epics.length ? "Clear the filter to see them all." : "Epics gate task creation — nothing files until one is active."}
        </EmptyState>
      ) : (
        <ul className="tm-epics" role="list">
          {rows.map((e) => {
            const kids = childrenOf(e.id);
            const { done, total } = laneProgress(kids);
            const inProgress = kids.filter((t) => t.status === "in_progress").length;
            const blocked = kids.filter((t) => t.status === "blocked").length;
            const isMap = (e.labels ?? []).includes("decision:map");
            const fog = isMap ? kids.filter((t: Task) => decisionRole(t.labels) && t.status !== "done").length : 0;
            return (
              <li key={e.id} className="tm-card tm-epic" role="listitem" data-tm-epic={e.id} data-active={e.id === active || undefined} data-focused={focus === e.id || undefined} data-done={e.status === "done" || undefined} tabIndex={focus === e.id ? 0 : -1} onFocus={() => setFocus(e.id)} aria-label={`${e.id} ${e.title}, ${label(e.status)}${e.id === active ? ", active" : ""}, ${done} of ${total} done`}>
                <div className="tm-epic__main">
                  <div className="tm-row">
                    <span className="tm-id">{e.id}</span>
                    <Chip kind="status" value={e.status}>{e.status === "done" ? "closed" : e.status === "open" ? "open" : label(e.status)}</Chip>
                    {e.id === active && <Chip tone="accent" dot>active</Chip>}
                    {isMap && <Chip tone="info" dot={false}><Map size={11} aria-hidden /> map{fog ? ` · fog ${fog}` : ""}</Chip>}
                    {e.plan && <Chip kind="count" title={e.plan}><FileText size={11} aria-hidden /> plan</Chip>}
                  </div>
                  <button type="button" className="tm-epic__title" aria-label={`Open ${e.id}: ${e.title}`} onClick={() => open(e.id)}>{e.title}</button>
                  <div className="tm-row tm-epic__facts">
                    {total === 0 ? <span className="tm-faint">no tasks yet — <code>tm task new "&lt;title&gt;"</code> files under the active epic</span> : (
                      <>
                        {inProgress > 0 && <Chip kind="status" value="in_progress">{inProgress} in progress</Chip>}
                        {blocked > 0 && <Chip kind="status" value="blocked">{blocked} blocked</Chip>}
                        <span className="tm-faint">{total} task{total === 1 ? "" : "s"}</span>
                      </>
                    )}
                  </div>
                </div>
                <div className="tm-epic__side">
                  <span className="tm-epic__progress"><span className="tm-id">{done}/{total} done</span></span>
                  <Progress value={done} max={total} label={`${done} of ${total} done`} tone={total > 0 && done === total ? "ok" : undefined} />
                  <div className="tm-row" style={{ justifyContent: "flex-end" }}>
                    {e.id !== active && e.status !== "done" && <Button size="sm" variant="ghost" onClick={() => activate(e.id)} title="make active (a)">Make active</Button>}
                    <Button size="sm" onClick={() => open(e.id)}>Open</Button>
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}
      <CreateEpicModal open={creating} onClose={() => setCreating(false)} />
    </div>
  );
}
