import { Download, Inbox, Link2 } from "lucide-react";
import { useEffect, useState } from "react";
import type { ScreenProps } from "../../app/routes";
import { Button } from "../../components/ui/Button";
import { Chip } from "../../components/ui/Chip";
import { EmptyState } from "../../components/ui/EmptyState";
import { ErrorPanel } from "../../components/ui/ErrorPanel";
import { Select } from "../../components/ui/Field";
import { SkeletonRows } from "../../components/ui/Skeleton";
import { fetchPlans, write } from "../../lib/api";
import { Link } from "../../lib/router";
import { useBoard, useEvents, useWrite } from "../../lib/store";
import type { PlanInboxItem } from "../../lib/types";
import { ImportGoal } from "./ImportGoal";
import { PlanPreview } from "./PlanPreview";
import "../../styles/plans.css";
import "../../styles/detail.css";

/** Plans copied out of ~/.claude/plans on ExitPlanMode. Unlinked ones can be attached to an open epic. */
export default function Plans(_: ScreenProps) {
  const board = useBoard();
  const { run, pending } = useWrite();
  const [plans, setPlans] = useState<PlanInboxItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);
  const [bump, setBump] = useState(0);
  const events = useEvents();
  const tick = events.filter((e) => e.event === "plan_captured" || e.event === "epic_active" || e.event === "create").length;
  useEffect(() => {
    let live = true;
    fetchPlans().then((p) => live && setPlans(p)).catch((e: Error) => live && setError(e.message));
    return () => { live = false; };
  }, [tick, bump]);
  const openEpics = (board?.epics ?? []).filter((e) => e.status !== "done");
  const current = plans?.find((p) => p.path === selected) ?? null;
  return (
    <div className="tm-screen">
      <div className="tm-screen__head">
        <div>
          <h1>Plans</h1>
        </div>
        <span className="tm-grow" />
        <Button size="sm" icon={<Download size={14} />} onClick={() => setImporting(true)}>Import goal…</Button>
      </div>
      <ImportGoal open={importing} onClose={() => setImporting(false)} onDone={() => setBump((n) => n + 1)} />
      {error ? (
        <ErrorPanel title="Plans could not be listed" detail={error} />
      ) : plans === null ? (
        <SkeletonRows rows={4} />
      ) : plans.length === 0 ? (
        <EmptyState icon={<Inbox size={28} />} title="No plans yet">Approve a plan in Claude Code (ExitPlanMode) and it lands here, linked to a new epic.</EmptyState>
      ) : (
        <div className="tm-plans">
          <ul className="tm-plans__list" aria-label="plans">
            {plans.map((p) => (
              <li key={p.path}>
                <button type="button" className="tm-plan" aria-pressed={p.path === selected} onClick={() => setSelected(p.path)}>
                  <span className="tm-plan__name">{p.name}</span>
                  <span className="tm-row" style={{ gap: "var(--tm-s2)", flexWrap: "wrap" }}>
                    {p.linkedEpic ? <Chip kind="plain" tone="ok" dot>{p.linkedEpic}</Chip> : <Chip kind="plain" tone="warn" dot>unlinked</Chip>}
                    {!p.exists && <Chip kind="plain" tone="bad" dot>missing</Chip>}
                  </span>
                </button>
              </li>
            ))}
          </ul>
          <section className="tm-plans__preview" aria-label="plan preview">
            {!current ? (
              <p className="tm-faint">Select a plan to read it.</p>
            ) : (
              <div className="tm-stack">
                <div className="tm-row" style={{ flexWrap: "wrap" }}>
                  <strong className="tm-grow">{current.name}</strong>
                  {current.linkedEpic ? (
                    <Link to={`/epics/${current.linkedEpic}`} inspector className="tm-btn" data-size="sm">Open {current.linkedEpic}</Link>
                  ) : openEpics.length ? (
                    <span className="tm-row">
                      <Link2 size={14} className="tm-faint" />
                      <Select value="" placeholder="link to an epic…" aria-label="link plan to an epic" disabled={pending} options={openEpics.map((e) => ({ value: e.id, label: `${e.id} ${e.title}` }))} onChange={(e) => e.target.value && void run(() => write.epicPlan(e.target.value, current.path), { ok: `${current.name} linked to ${e.target.value}` }).then(() => setPlans((ps) => ps?.map((p) => (p.path === current.path ? { ...p, linkedEpic: e.target.value } : p)) ?? ps))} />
                    </span>
                  ) : (
                    <Button size="sm" disabled title="open an epic first">No open epic to link</Button>
                  )}
                </div>
                <p className="tm-faint mono">{current.path}</p>
                {current.exists ? <PlanPreview path={current.path} /> : <p className="tm-reason" data-tone="bad">the file is gone — `tm doctor --fix` clears the reference</p>}
              </div>
            )}
          </section>
        </div>
      )}
    </div>
  );
}
