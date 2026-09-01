import { ChevronDown, ChevronRight, FileText, Map } from "lucide-react";
import { Button } from "../../components/ui/Button";
import { Chip } from "../../components/ui/Chip";
import { Progress } from "../../components/ui/Progress";
import { write } from "../../lib/api";
import { NO_EPIC, laneProgress } from "../../lib/lanes.mjs";
import { Link } from "../../lib/router";
import { useWrite } from "../../lib/store";
import type { Task } from "../../lib/types";
import { decisionRole } from "./model";

export interface Lane { id: string; title: string; status: string | null; active: boolean; plan?: string; labels?: string[] }

/** The row heading when the board is grouped: progress, the plan chip, the map chip and its fog. */
export function EpicLane({ lane, tasks, collapsed, onToggle }: { lane: Lane; tasks: Task[]; collapsed: boolean; onToggle: () => void }) {
  const { run, pending } = useWrite();
  const { done, total, fraction } = laneProgress(tasks);
  const isMap = (lane.labels ?? []).includes("decision:map");
  const fog = isMap ? tasks.filter((t) => decisionRole(t.labels) && t.status !== "done").length : 0;
  const real = lane.id !== NO_EPIC && lane.status !== "missing";
  return (
    <header className="tm-lane" data-active={lane.active || undefined} data-collapsed={collapsed || undefined}>
      <button type="button" className="tm-lane__fold" aria-expanded={!collapsed} aria-label={`${collapsed ? "expand" : "collapse"} ${lane.title}`} onClick={onToggle}>
        {collapsed ? <ChevronRight size={14} /> : <ChevronDown size={14} />}
      </button>
      {real ? (
        <Link to={`/epics/${lane.id}`} inspector className="tm-lane__title">
          <span className="tm-id">{lane.id}</span> {lane.title}
        </Link>
      ) : (
        <span className="tm-lane__title"><span className="tm-id">{lane.id === NO_EPIC ? "" : lane.id}</span> {lane.title}</span>
      )}
      {lane.active && <Chip tone="accent" dot>active</Chip>}
      {lane.status === "done" && <Chip kind="status" value="done">closed</Chip>}
      {lane.status === "missing" && <Chip tone="bad" dot title="an epic id with no epic file — tm doctor --fix clears it">missing</Chip>}
      {isMap && <Chip tone="info" dot={false}><Map size={11} aria-hidden /> map{fog ? ` · fog ${fog}` : ""}</Chip>}
      {lane.plan && <Chip kind="count" title={lane.plan}><FileText size={11} aria-hidden /> plan</Chip>}
      <span className="tm-grow" />
      <span className="tm-lane__progress">
        <Progress value={done} max={total} label={`${done} of ${total} done`} tone={total > 0 && done === total ? "ok" : undefined} />
        <span className="tm-id">{done}/{total}</span>
      </span>
      {real && !lane.active && lane.status !== "done" && (
        <Button size="sm" variant="ghost" pending={pending} onClick={() => void run(() => write.activeEpic(lane.id), { ok: `${lane.id} is the active epic` })}>Make active</Button>
      )}
      <span className="sr-only">{Math.round(fraction * 100)}%</span>
    </header>
  );
}
