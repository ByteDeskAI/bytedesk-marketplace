import { CalendarRange, Plus } from "lucide-react";
import { useMemo, useState } from "react";
import { burndown } from "../../../metrics.mjs";
import { Button } from "../../components/ui/Button";
import { Card } from "../../components/ui/Card";
import { Chip } from "../../components/ui/Chip";
import { EmptyState } from "../../components/ui/EmptyState";
import { ErrorPanel } from "../../components/ui/ErrorPanel";
import { Field, TextField } from "../../components/ui/Field";
import { KpiRow, KpiTile } from "../../components/ui/KpiTile";
import { Modal } from "../../components/ui/Modal";
import { Progress } from "../../components/ui/Progress";
import { SkeletonRows } from "../../components/ui/Skeleton";
import { Sparkline } from "../../components/ui/Sparkline";
import { write } from "../../lib/api";
import { Link, navigate } from "../../lib/router";
import { useBoard, useEvents, useLoading, useWrite } from "../../lib/store";
import { toast } from "../../lib/toast";
import type { Sprint } from "../../lib/types";
import type { ScreenProps } from "../../app/routes";
import "../../styles/sprints.css";

export const reportLine = (s: Sprint) => {
  const r = s.report;
  if (!r) return "no report";
  return `${r.done}/${r.committed} pts · ${r.cards} card${r.cards === 1 ? "" : "s"}${r.unsized ? ` · ${r.unsized} unsized` : ""}`;
};

/** Sprint list: the active one first with its burndown, then the rest by id. */
export default function Sprints(_: ScreenProps) {
  const board = useBoard();
  const events = useEvents();
  const { loading, error } = useLoading();
  const { run, pending } = useWrite();
  const [creating, setCreating] = useState(false);
  const [closing, setClosing] = useState<Sprint | null>(null);

  const activeId = board?.state?.activeSprint ?? null;
  const sprints = useMemo(() => {
    const all = board?.sprints ?? [];
    return [...all].sort((a, b) => (a.id === activeId ? -1 : b.id === activeId ? 1 : a.status === b.status ? a.id.localeCompare(b.id) : a.status === "done" ? 1 : -1));
  }, [board?.sprints, activeId]);
  const active = sprints.find((s) => s.id === activeId) ?? null;
  const series = useMemo(() => {
    if (!active || !board) return [];
    // ponytail: metrics.burndown counts cards; points-per-day would need estimates on the events. The KPI row carries the points.
    return burndown(board.tasks.filter((t) => t.sprint === active.id), events, { days: 14 });
  }, [active, board, events]);

  if (error && !board) return <div className="tm-screen"><ErrorPanel title="Sprints could not be loaded" detail={error} /></div>;
  if (loading && !board) return <div className="tm-screen"><SkeletonRows rows={4} /></div>;

  const unfinished = (s: Sprint) => (board?.tasks ?? []).filter((t) => t.sprint === s.id && t.status !== "done" && t.status !== "deleted").length;

  return (
    <div className="tm-screen">
      <div className="tm-screen__head">
        <div>
          <h1>Sprints</h1>
          <p>What you committed to finishing this fortnight. An epic says what a body of work is; a sprint says when.</p>
        </div>
        <div className="tm-screen__actions">
          <Button variant="primary" icon={<Plus size={14} />} onClick={() => setCreating(true)}>New sprint</Button>
        </div>
      </div>

      {active && (
        <Card className="tm-sprint-hero">
          <div className="tm-row" style={{ flexWrap: "wrap" }}>
            <Link to={`/sprints/${active.id}`} inspector className="tm-id">{active.id}</Link>
            <strong className="tm-truncate">{active.title}</strong>
            <Chip tone="accent" dot>active</Chip>
            {active.ends && <span className="tm-faint">ends <span className="tm-id">{active.ends}</span></span>}
          </div>
          <KpiRow>
            <KpiTile label="points done" value={`${active.report?.done ?? 0} / ${active.report?.committed ?? 0}`} />
            <KpiTile label="cards" value={active.report?.cards ?? 0} />
            <KpiTile label="unsized" value={active.report?.unsized ?? 0} delta={active.report?.unsized ? "counted apart, not as zero" : undefined} />
            <KpiTile label="open cards, 14 days" value={series.length ? series[series.length - 1].remaining : 0}>
              <Sparkline points={series.map((d) => d.remaining)} bars={series.map((d) => d.done)} width={180} height={34} label="cards remaining per day, done per day" />
            </KpiTile>
          </KpiRow>
        </Card>
      )}

      {sprints.length === 0 ? (
        <EmptyState icon={<CalendarRange size={28} />} title="No sprint — create one" action={<Button variant="primary" onClick={() => setCreating(true)}>New sprint</Button>}>
          Points were writable everywhere and read by nothing until a sprint gave them a denominator.
        </EmptyState>
      ) : (
        <ul className="tm-sprints" aria-label="sprints">
          {sprints.map((s) => {
            const r = s.report;
            const done = s.status === "done";
            return (
              <li key={s.id}>
                <Card interactive className="tm-sprint" data-done={done || undefined} onClick={() => navigate(`/sprints/${s.id}`, { inspector: true })}>
                  <div className="tm-row">
                    <span className="tm-id">{s.id}</span>
                    <Chip kind="status" value={done ? "done" : "open"}>{done ? "closed" : "open"}</Chip>
                    {s.id === activeId && <Chip tone="accent" dot>active</Chip>}
                    <span className="tm-grow" />
                    {s.ends && <span className="tm-faint">ends <span className="tm-id">{s.ends}</span></span>}
                  </div>
                  <strong className="tm-truncate">{s.title}</strong>
                  <div className="tm-row">
                    <Progress value={r?.done ?? 0} max={r?.committed ?? 0} label={`${s.id} points`} />
                    <span className="tm-faint" style={{ whiteSpace: "nowrap" }}>{reportLine(s)}</span>
                  </div>
                  <div className="tm-row tm-sprint__actions" onClick={(e) => e.stopPropagation()}>
                    {!done && s.id !== activeId && <Button size="sm" pending={pending} onClick={() => void run(() => write.activeSprint(s.id), { ok: `${s.id} is the active sprint` })}>Make active</Button>}
                    {!done && <Button size="sm" variant="ghost" onClick={() => setClosing(s)}>Close</Button>}
                    <Link to={`/sprints/${s.id}`} inspector>Open</Link>
                  </div>
                </Card>
              </li>
            );
          })}
        </ul>
      )}

      <CreateSprint open={creating} onClose={() => setCreating(false)} />
      <Modal open={Boolean(closing)} onClose={() => setClosing(null)} title={closing ? `Close ${closing.id}?` : undefined}
        footer={<>
          <Button variant="ghost" onClick={() => setClosing(null)}>Keep it open</Button>
          <Button variant="danger" pending={pending} onClick={() => closing && void run(async () => {
            const res = await write.closeSprint(closing.id);
            toast("ok", `${closing.id} closed`, res.unfinished ? `${res.unfinished} card${res.unfinished === 1 ? "" : "s"} left uncommitted — still on the board` : "everything committed was finished");
            setClosing(null);
          })}>Close sprint</Button>
        </>}>
        {closing && <p>{unfinished(closing) ? `${unfinished(closing)} unfinished card${unfinished(closing) === 1 ? "" : "s"} stay on the board with the sprint still set — nothing is deleted, they are simply no longer committed.` : "Every committed card is done."}</p>}
      </Modal>
    </div>
  );
}

export function CreateSprint({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { run, pending, error } = useWrite();
  const [title, setTitle] = useState("");
  const [ends, setEnds] = useState("");
  const submit = () =>
    void run(async () => {
      const res = await write.createSprint({ title: title.trim(), ...(ends ? { ends } : {}) });
      setTitle(""); setEnds(""); onClose();
      navigate(`/sprints/${res.id}`, { inspector: true });
    }, { ok: "sprint created and made active" });
  return (
    <Modal open={open} onClose={onClose} title="New sprint" footer={<>
      <Button variant="ghost" onClick={onClose}>Cancel</Button>
      <Button variant="primary" pending={pending} disabled={!title.trim()} onClick={submit}>Create and make active</Button>
    </>}>
      <form className="tm-stack" onSubmit={(e) => { e.preventDefault(); if (title.trim()) submit(); }}>
        <Field label="Title" error={error}>{(p) => <TextField {...p} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Sprint 12" autoFocus />}</Field>
        <Field label="Ends" hint="Optional. The date closes nothing by itself.">{(p) => <TextField {...p} type="date" mono value={ends} onChange={(e) => setEnds(e.target.value)} />}</Field>
      </form>
    </Modal>
  );
}
