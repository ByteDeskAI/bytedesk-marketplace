import { Ban, Star } from "lucide-react";
import { memo, type DragEvent } from "react";
import { Chip } from "../../components/ui/Chip";
import { label } from "../../lib/keys.mjs";
import { Link } from "../../lib/router";
import type { Task } from "../../lib/types";
import { fmtDuration } from "../../../metrics.mjs";
import { PRIORITY_GLYPH, acCount, attentionOf, decisionRole, needsAnswer, stopReason, type Holder } from "./model";

export interface TaskCardProps {
  task: Task;
  focused: boolean;
  selected: boolean;
  live: boolean;
  stale: boolean;
  watched: boolean;
  holder: Holder | null;
  blockers: string[];
  pending?: "queued" | "refused" | "failed" | string;
  elapsed: number | null;
  onOpen: (id: string) => void;
  onSelect: (id: string) => void;
  onWatch: (id: string) => void;
  onDragStart: (id: string) => void;
  onDropBefore: (dragged: string, target: string) => void;
}

/**
 * One card: id, status, title, one row of chips, and the sentence a stopped card carries.
 * Everything else lives in the inspector. The claimed card is the only lit plate on the board.
 */
export const TaskCard = memo(function TaskCard({ task: t, focused, selected, live, stale, watched, holder, blockers, pending, elapsed, onOpen, onSelect, onWatch, onDragStart, onDropBefore }: TaskCardProps) {
  const ac = acCount(t);
  const role = decisionRole(t.labels);
  const attention = attentionOf(role);
  const reason = stopReason(t);
  const labels = (t.labels ?? []).filter((l) => !l.startsWith("decision:"));
  const parts = [
    `${t.id} ${t.title}`,
    label(t.status),
    t.priority ? `priority ${t.priority}` : "",
    holder ? `held by ${holder.actor}` : t.status === "in_progress" ? "unclaimed" : "",
    blockers.length ? `blocked by ${blockers.join(", ")}` : "",
    stale ? "stale" : "",
    pending ? pending : "",
  ].filter(Boolean);

  const onDrop = (e: DragEvent) => {
    const dragged = e.dataTransfer.getData("text/tm-id");
    if (!dragged || dragged === t.id) return;
    e.preventDefault();
    e.stopPropagation();
    onDropBefore(dragged, t.id);
  };

  return (
    <li
      className="tm-card tm-task"
      role="listitem"
      data-tm-card={t.id}
      data-status={t.status}
      data-focused={focused || undefined}
      data-selected={selected || undefined}
      data-live={live || undefined}
      data-claimed={holder ? true : undefined}
      data-stale={stale || undefined}
      tabIndex={focused ? 0 : -1}
      aria-label={parts.join(", ")}
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData("text/tm-id", t.id);
        e.dataTransfer.effectAllowed = "move";
        onDragStart(t.id);
      }}
      onDragOver={(e) => {
        if (e.dataTransfer.types.includes("text/tm-id")) e.preventDefault();
      }}
      onDrop={onDrop}
      onDoubleClick={() => onOpen(t.id)}
    >
      <div className="tm-task__identity">
        <input type="checkbox" className="tm-task__select" checked={selected} onChange={() => onSelect(t.id)} aria-label={`select ${t.id}`} tabIndex={-1} />
        <span className="tm-id">{t.id}</span>
        <Chip kind="status" value={t.status}>{label(t.status)}</Chip>
        {live && <span className="tm-task__live" aria-label="live: a session is writing to this card">live</span>}
        <span className="tm-grow" />
        {elapsed !== null && (t.status === "in_progress" || t.status === "blocked" || t.status === "parked") && (
          <span className="tm-task__elapsed" data-stale={stale || undefined} title={stale ? "in progress and untouched past staleMinutes" : "time in this column"}>
            {stale ? "stale " : ""}{fmtDuration(elapsed)}
          </span>
        )}
        <button type="button" className="tm-task__watch" aria-pressed={watched} aria-label={watched ? `stop watching ${t.id}` : `watch ${t.id}`} title="watch — notify me if this is blocked or taken (w)" onClick={() => onWatch(t.id)} tabIndex={-1}>
          <Star size={13} fill={watched ? "currentColor" : "none"} />
        </button>
      </div>
      <button type="button" className="tm-task__title" aria-label={`Open ${t.id}: ${t.title}`} onClick={() => onOpen(t.id)} tabIndex={-1}>
        {t.title}
      </button>
      <div className="tm-task__chips">
        {t.epic && <Link to={`/epics/${t.epic}`} inspector className="tm-chip tm-task__epic" tabIndex={-1}>{t.epic}</Link>}
        {t.priority && (
          <Chip kind="plain" title={`priority ${t.priority}`}>
            <span aria-hidden>{PRIORITY_GLYPH[t.priority] ?? "◆"}</span> {t.priority}
          </Chip>
        )}
        {t.estimate != null && <Chip kind="count">{t.estimate} pts</Chip>}
        {ac.total > 0 && <Chip kind="count" tone={ac.met === ac.total ? "ok" : undefined}>AC {ac.met}/{ac.total}</Chip>}
        {t.status === "in_progress" && (holder ? <Chip tone="accent" dot title={holder.session ?? holder.actor}>{holder.short}</Chip> : <Chip>unclaimed</Chip>)}
        {t.assignee && <Chip kind="plain">@{t.assignee}</Chip>}
        {t.parent && <Chip kind="count" title="subtask of">↳ {t.parent}</Chip>}
        {blockers.map((b) => (
          <Chip key={b} tone="bad" dot={false} title={`blocked by ${b}`}><Ban size={10} aria-hidden /> {b}</Chip>
        ))}
        {role && <Chip tone="info" dot={false}>{role.replace("decision:", "")}</Chip>}
        {attention && <Chip kind="count">{attention}</Chip>}
        {needsAnswer(t) && <Chip tone="warn" dot>needs answer</Chip>}
        {t.capability && <Chip kind="count" title="builds a capability">{t.capability}</Chip>}
        {labels.slice(0, 3).map((l) => (
          <Chip key={l} kind="label">{l}</Chip>
        ))}
        {labels.length > 3 && <Chip kind="count">+{labels.length - 3}</Chip>}
        {(t.commits?.length ?? 0) > 0 && <Chip kind="count" title="linked commits">{t.commits!.length} commit{t.commits!.length === 1 ? "" : "s"}</Chip>}
        {pending === "queued" && <Chip tone="info" dot>queued</Chip>}
        {(pending === "refused" || pending === "failed") && <Chip tone="bad" dot>refused</Chip>}
      </div>
      {reason && <p className="tm-task__reason tm-clamp-2" title={reason}>{reason}</p>}
    </li>
  );
});
