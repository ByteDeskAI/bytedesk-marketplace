import { useState } from "react";
import { Button } from "../../../components/ui/Button";
import { Select, TextField } from "../../../components/ui/Field";
import { write } from "../../../lib/api";
import { useBoard, useMeta, useWrite } from "../../../lib/store";
import { typeOf, type Task } from "../../../lib/types";
import { FALLBACK, statusLabel } from "../shared";

/**
 * The selects that move a card: status, type, priority, epic (one control), sprint, parent.
 * Blocked and parked take a reason before they write — an inline field, never a prompt.
 */
export function Fields({ task }: { task: Task }) {
  const board = useBoard();
  const meta = useMeta();
  const { run, pending, error } = useWrite();
  const [stop, setStop] = useState<{ status: "blocked" | "parked"; reason: string } | null>(null);

  const statuses = meta?.vocab.columns ?? FALLBACK.statuses;
  const priorities = meta?.vocab.priorities ?? FALLBACK.priorities;
  const types = meta?.vocab.types ?? FALLBACK.types;
  const epics = board?.epics ?? [];
  const sprints = board?.sprints ?? [];
  const others = (board?.tasks ?? []).filter((t) => t.id !== task.id);
  const opt = (v: string, label = v) => ({ value: v, label });

  const transition = (status: string, reason?: string) =>
    run(() => write.transition(task.id, status as Task["status"], reason ? { reason } : {}), {
      optimistic: reason || status === "done" || status === "in_progress" ? undefined : { id: task.id, patch: { status: status as Task["status"] } },
    });

  // The next verb first, the way the CLI reads: start, done, resume, unblock. Park and block ask why inline.
  const primary =
    task.status === "in_progress" ? { label: "Done", to: "done" }
    : task.status === "parked" ? { label: "Resume", to: "in_progress" }
    : task.status === "blocked" ? { label: "Unblock", to: "open" }
    : task.status === "done" ? { label: "Reopen", to: "open" }
    : task.status === "deleted" ? null
    : { label: "Start", to: "in_progress" };

  return (
    <div className="tm-stack" style={{ gap: "var(--tm-s3)" }}>
      <div className="tm-row tm-actions" style={{ flexWrap: "wrap" }}>
        {primary && <Button variant="primary" size="sm" pending={pending} onClick={() => void transition(primary.to)}>{primary.label}</Button>}
        {task.status !== "parked" && task.status !== "done" && task.status !== "deleted" && <Button size="sm" onClick={() => setStop({ status: "parked", reason: "" })}>Park…</Button>}
        {task.status !== "blocked" && task.status !== "done" && task.status !== "deleted" && <Button size="sm" onClick={() => setStop({ status: "blocked", reason: "" })}>Block…</Button>}
      </div>
      {error && <p className="tm-reason" data-tone="bad" role="alert">{error}</p>}
      <div className="tm-fields">
        <label className="tm-fields__cell">
          <span className="tm-caps">status</span>
          <Select
            value={task.status}
            options={statuses.map((s) => opt(s, statusLabel(s, meta)))}
            disabled={pending}
            onChange={(e) => {
              const next = e.target.value;
              if (next === task.status) return;
              if (next === "blocked" || next === "parked") setStop({ status: next, reason: "" });
              else void transition(next);
            }}
          />
        </label>
        <label className="tm-fields__cell">
          <span className="tm-caps">type</span>
          <Select value={typeOf(task)} options={types.map((t) => opt(t))} onChange={(e) => void run(() => write.type(task.id, e.target.value))} />
        </label>
        <label className="tm-fields__cell">
          <span className="tm-caps">priority</span>
          <Select
            value={task.priority ?? ""}
            placeholder="none"
            options={priorities.map((p) => opt(p))}
            onChange={(e) => void run(() => write.priority(task.id, e.target.value || null), { optimistic: { id: task.id, patch: { priority: (e.target.value || undefined) as Task["priority"] } } })}
          />
        </label>
        <label className="tm-fields__cell">
          <span className="tm-caps">epic</span>
          <Select
            value={task.epic ?? ""}
            placeholder="none"
            options={epics.map((e) => opt(e.id, `${e.id} ${e.title}${e.status === "done" ? " (done)" : ""}`))}
            onChange={(e) => {
              const next = e.target.value || null;
              if (next !== (task.epic ?? null)) void run(() => write.edit(task.id, { epic: next }));
            }}
          />
        </label>
        <label className="tm-fields__cell">
          <span className="tm-caps">sprint</span>
          <Select
            value={task.sprint ?? ""}
            placeholder="none"
            options={sprints.map((s) => opt(s.id, `${s.id} ${s.title}`))}
            onChange={(e) => void run(() => write.sprint(task.id, e.target.value || null), { optimistic: { id: task.id, patch: { sprint: e.target.value || null } } })}
          />
        </label>
        <label className="tm-fields__cell">
          <span className="tm-caps">parent</span>
          <Select
            value={task.parent ?? ""}
            placeholder="none"
            options={others.map((t) => opt(t.id, `${t.id} ${t.title}`))}
            onChange={(e) => void run(() => write.subtask(task.id, e.target.value || null))}
          />
        </label>
      </div>

      {stop && (
        <form
          className="tm-stop"
          onSubmit={(e) => {
            e.preventDefault();
            void transition(stop.status, stop.reason.trim()).then(() => setStop(null));
          }}
        >
          <span className="tm-muted">Why is it {stop.status}? The board shows this on the card.</span>
          <div className="tm-row">
            <TextField autoFocus value={stop.reason} placeholder="waiting on counsel" aria-label={`${stop.status} reason`} onChange={(e) => setStop({ ...stop, reason: e.target.value })} className="tm-grow" />
            <Button size="sm" variant="primary" type="submit" pending={pending}>{stop.status === "blocked" ? "Block" : "Park"}</Button>
            <Button size="sm" variant="ghost" onClick={() => setStop(null)}>Cancel</Button>
          </div>
        </form>
      )}

      {task.status === "blocked" && task.blockedReason && <p className="tm-reason" data-tone="bad">blocked — {task.blockedReason}</p>}
      {task.status === "parked" && task.parkedReason && <p className="tm-reason" data-tone="warn">parked — {task.parkedReason}</p>}
    </div>
  );
}
