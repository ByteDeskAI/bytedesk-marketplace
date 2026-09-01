import { useEffect, useMemo, useState } from "react";
import { Button } from "../../components/ui/Button";
import { Chip } from "../../components/ui/Chip";
import { Combobox } from "../../components/ui/Combobox";
import { ErrorPanel } from "../../components/ui/ErrorPanel";
import { Field, TextField } from "../../components/ui/Field";
import { InlineEdit } from "../../components/ui/InlineEdit";
import { Inspector, Section } from "../../components/ui/Inspector";
import { KpiRow, KpiTile } from "../../components/ui/KpiTile";
import { Markdown } from "../../components/ui/Markdown";
import { Progress } from "../../components/ui/Progress";
import { SkeletonRows } from "../../components/ui/Skeleton";
import { fetchSprint, write } from "../../lib/api";
import { closeInspector, Link } from "../../lib/router";
import { useBoard, useEntity, useEvents, useWrite } from "../../lib/store";
import { toast } from "../../lib/toast";
import type { Sprint, Task } from "../../lib/types";
import type { ScreenProps } from "../../app/routes";
import "../../styles/sprints.css";

const STATUS_WORD: Record<string, string> = { open: "todo", in_progress: "in progress", backlog: "backlog", blocked: "blocked", parked: "parked", done: "done" };

/** One sprint: title, dates and body editable; commit or take back cards; the points report. */
export default function SprintInspector({ params }: ScreenProps) {
  const id = params.id;
  const board = useBoard();
  const events = useEvents();
  const { entity, loading, error } = useEntity<Sprint>(id);
  const { run, pending } = useWrite();
  const [report, setReport] = useState<Sprint["report"] | null>(null);
  const [ends, setEnds] = useState("");

  // The report is only on /api/sprint/:id (render.sprintCounts); refetch it whenever the feed moves.
  useEffect(() => {
    let live = true;
    fetchSprint(id).then((s) => live && setReport(s.report ?? null)).catch(() => {});
    return () => { live = false; };
  }, [id, events.length]);
  useEffect(() => setEnds(entity?.ends ?? ""), [entity?.ends]);

  const tasks = useMemo(() => (board?.tasks ?? []).filter((t) => t.sprint === id), [board?.tasks, id]);
  const options = useMemo(() => (board?.tasks ?? []).filter((t) => t.status !== "done" && t.status !== "deleted").map((t) => t.id).sort(), [board?.tasks]);
  const done = entity?.status === "done";
  const active = board?.state?.activeSprint === id;

  if (error) return <Inspector title={id} onClose={() => closeInspector("/sprints")} id={id}><ErrorPanel title={`${id} is not on this board`} detail={error} /></Inspector>;
  if (!entity) return <Inspector title={id} onClose={() => closeInspector("/sprints")} id={id}>{loading ? <SkeletonRows /> : <ErrorPanel title={`${id} is not on this board`} />}</Inspector>;

  const commit = (values: string[]) => {
    const have = new Set(tasks.map((t) => t.id));
    const want = new Set(values);
    const add = values.filter((v) => !have.has(v));
    const rm = tasks.map((t) => t.id).filter((v) => !want.has(v));
    void run(async () => {
      for (const t of add) await write.sprint(t, id);
      for (const t of rm) await write.sprint(t, null);
    });
  };

  return (
    <Inspector
      id={id}
      onClose={() => closeInspector("/sprints")}
      meta={<span className="tm-row"><span className="tm-id">{id}</span><Chip kind="status" value={done ? "done" : "open"}>{done ? "closed" : "open"}</Chip>{active && <Chip tone="accent" dot>active</Chip>}</span>}
      actions={<>
        {!done && !active && <Button size="sm" pending={pending} onClick={() => void run(() => write.activeSprint(id), { ok: `${id} is the active sprint` })}>Make active</Button>}
        {!done && <Button size="sm" variant="ghost" pending={pending} onClick={() => void run(async () => {
          const res = await write.closeSprint(id);
          toast("ok", `${id} closed`, res.unfinished ? `${res.unfinished} unfinished card(s) stay on the board` : undefined);
        })}>Close</Button>}
      </>}
      title={<InlineEdit label="title" value={entity.title} onSave={(v) => run(() => write.editSprint(id, { title: v }))} />}
    >
      <Section title="Report">
        <KpiRow>
          <KpiTile label="points done" value={`${report?.done ?? "–"} / ${report?.committed ?? "–"}`} />
          <KpiTile label="cards" value={report?.cards ?? tasks.length} />
          <KpiTile label="unsized" value={report?.unsized ?? "–"} />
        </KpiRow>
        <Progress value={report?.done ?? 0} max={report?.committed ?? 0} label="points done" />
      </Section>

      <Section title="Dates">
        <Field label="Ends" hint="YYYY-MM-DD. Clear it to remove the date.">
          {(p) => <TextField {...p} type="date" mono value={ends} onChange={(e) => setEnds(e.target.value)} onBlur={() => { if ((ends || null) !== (entity.ends ?? null)) void run(() => write.editSprint(id, { ends: ends || null })); }} />}
        </Field>
        {entity.closed && <span className="tm-faint">closed <span className="tm-id">{entity.closed}</span></span>}
      </Section>

      <Section title={`Committed (${tasks.length})`}>
        {!done && <Combobox label="commit tasks" values={tasks.map((t) => t.id)} options={options} onChange={commit} placeholder="TM-…" chipKind="plain" />}
        {tasks.length === 0 ? <p className="tm-faint">Nothing committed yet.</p> : (
          <ul className="tm-sprint-tasks">
            {tasks.map((t: Task) => (
              <li key={t.id} className="tm-row">
                <Link to={`/tasks/${t.id}`} inspector className="tm-id">{t.id}</Link>
                <Chip kind="status" value={t.status}>{STATUS_WORD[t.status] ?? t.status}</Chip>
                <span className="tm-truncate tm-grow">{t.title}</span>
                <span className="tm-id">{t.estimate != null ? `${t.estimate} pt` : "unsized"}</span>
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section title="Notes">
        <InlineEdit label="notes" multiline value={entity.body ?? ""} onSave={(v) => run(() => write.editSprint(id, { body: v }))} />
        {entity.body && <Markdown source={entity.body} />}
      </Section>
    </Inspector>
  );
}
