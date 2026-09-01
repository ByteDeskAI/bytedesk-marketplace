import { useEffect, useState } from "react";
import { Chip } from "../../../components/ui/Chip";
import { Select } from "../../../components/ui/Field";
import { Section } from "../../../components/ui/Inspector";
import { fetchWhy, write } from "../../../lib/api";
import { Link } from "../../../lib/router";
import { useBoard, useMeta, useWrite } from "../../../lib/store";
import type { Task, Why } from "../../../lib/types";
import { statusLabel } from "../shared";

/**
 * Direct blockers, editable; and the transitive why-chain from `tm why`, which is the only
 * thing that tells you TM-002 is itself waiting on TM-003 parked last week with a reason.
 */
export function Blockers({ task }: { task: Task }) {
  const board = useBoard();
  const meta = useMeta();
  const { run } = useWrite();
  const [why, setWhy] = useState<Why | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const key = `${task.status}|${(task.blockedBy ?? []).join(",")}|${task.updated ?? ""}`;
  useEffect(() => {
    let live = true;
    fetchWhy(task.id)
      .then((w) => live && setWhy(w))
      .catch((e: Error) => live && setFailed(e.message));
    return () => {
      live = false;
    };
  }, [task.id, key]);

  const others = (board?.tasks ?? []).filter((t) => t.id !== task.id && !(task.blockedBy ?? []).includes(t.id));
  const direct = task.blockedBy ?? [];
  const blocking = why?.reasons.filter((r) => r.blocking) ?? [];

  return (
    <Section title="blocked by">
      {direct.length ? (
        <div className="tm-row" style={{ flexWrap: "wrap", gap: "var(--tm-s2)" }}>
          {direct.map((d) => (
            <Chip key={d} kind="plain" tone="bad" onRemove={() => void run(() => write.dep(task.id, { remove: [d] }))}>
              <Link to={`/tasks/${d}`} inspector className="mono">{d}</Link>
            </Chip>
          ))}
        </div>
      ) : (
        <p className="tm-faint">nothing is blocking this</p>
      )}
      <Select placeholder="add a blocker…" value="" aria-label="add a blocker" options={others.map((t) => ({ value: t.id, label: `${t.id} ${t.title}` }))} onChange={(e) => e.target.value && void run(() => write.dep(task.id, { add: [e.target.value] }))} />

      {failed && <p className="tm-faint">why: {failed}</p>}
      {why && (
        <div className="tm-why" aria-label="why this cannot start">
          <div className="tm-row">
            <Chip kind="plain" tone={why.startable ? "ok" : "warn"} dot>{why.startable ? "startable" : "not startable"}</Chip>
            {why.roots.length > 0 && (
              <span className="tm-muted">
                start here:{" "}
                {why.roots.map((r, i) => (
                  <span key={r}>{i > 0 && ", "}<Link to={`/tasks/${r}`} inspector className="mono">{r}</Link></span>
                ))}
              </span>
            )}
          </div>
          {blocking.map((r, i) => <p key={i} className="tm-why__reason">{r.text}</p>)}
          {why.chain.length > 0 && (
            <ol className="tm-why__chain">
              {why.chain.map((n) => (
                <li key={`${n.id}-${n.depth}`} style={{ marginLeft: `calc(${n.depth} * var(--tm-s5))` }}>
                  <Link to={`/tasks/${n.id}`} inspector className="mono">{n.id}</Link>
                  <span className="tm-truncate">{n.title}</span>
                  {n.status && <Chip kind="status" value={n.status}>{statusLabel(n.status, meta)}</Chip>}
                  {n.reason && <span className="tm-faint">— {n.reason}</span>}
                </li>
              ))}
            </ol>
          )}
          {why.cycles && why.cycles.length > 0 && <p className="tm-reason" data-tone="bad">cycle: {why.cycles.map((c) => c.join(" → ")).join("; ")}</p>}
        </div>
      )}
    </Section>
  );
}
