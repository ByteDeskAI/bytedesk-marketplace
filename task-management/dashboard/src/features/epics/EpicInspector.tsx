import { FileText, Map } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import "../../styles/board.css";
import { Bars } from "../../components/ui/Bars";
import { Button } from "../../components/ui/Button";
import { Chip } from "../../components/ui/Chip";
import { ErrorPanel } from "../../components/ui/ErrorPanel";
import { Field, Select, TextArea, TextField } from "../../components/ui/Field";
import { InlineEdit } from "../../components/ui/InlineEdit";
import { Inspector, Section } from "../../components/ui/Inspector";
import { Markdown } from "../../components/ui/Markdown";
import { Modal } from "../../components/ui/Modal";
import { Progress } from "../../components/ui/Progress";
import { SkeletonRows } from "../../components/ui/Skeleton";
import type { ScreenProps } from "../../app/routes";
import { fetchPlanFile, fetchPlans, write } from "../../lib/api";
import { COLUMNS, label } from "../../lib/keys.mjs";
import { laneProgress } from "../../lib/lanes.mjs";
import { Link, closeInspector, navigate } from "../../lib/router";
import { useBoard, useEntity, useWrite } from "../../lib/store";
import type { Epic, PlanFile, PlanInboxItem, Status } from "../../lib/types";
import { attentionOf, decisionRole, holderOf, needsAnswer } from "../board/model";

/**
 * The epic's record: why it exists, the plan it came from, its children and who holds them,
 * the decisions taken under it, and how far along it is. Title and body edit in place
 * (`PATCH /api/epic/:id`); make-active, close and reopen are the same verbs `tm epic` has.
 */
export default function EpicInspector({ params }: ScreenProps) {
  const id = params.id;
  const board = useBoard();
  const { entity, detail, loading, error } = useEntity<Epic>(id);
  const { run, pending } = useWrite();
  const [confirmClose, setConfirmClose] = useState(false);
  const [importing, setImporting] = useState(false);
  const [plan, setPlan] = useState<PlanFile | null>(null);
  const [plans, setPlans] = useState<PlanInboxItem[]>([]);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const saveBody = () => run(() => write.editEpic(id, { body: draft }), { ok: "body saved" }).then(() => setEditing(false));
  const active = board?.state?.activeEpic === id;
  const epic = detail ?? entity;
  const kids = useMemo(() => (board?.tasks ?? []).filter((t) => t.epic === id && t.status !== "deleted"), [board?.tasks, id]);
  const adrs = useMemo(() => (board?.adrs ?? []).filter((a) => a.epic === id), [board?.adrs, id]);
  const { done, total } = laneProgress(kids);
  const isMap = (epic?.labels ?? []).includes("decision:map");
  const openKids = kids.filter((t) => t.status !== "done").length;

  useEffect(() => setEditing(false), [id]);
  useEffect(() => {
    setPlan(null);
    if (epic?.plan) fetchPlanFile(epic.plan).then(setPlan).catch(() => setPlan(null));
  }, [epic?.plan]);
  useEffect(() => {
    fetchPlans().then((all) => setPlans(all.filter((p) => !p.linkedEpic || p.linkedEpic === id))).catch(() => setPlans([]));
  }, [id]);

  const close = () => closeInspector("/epics");
  if (!epic && loading) return <Inspector title={id} onClose={close} id={id}><SkeletonRows /></Inspector>;
  if (!epic) return <Inspector title={id} onClose={close} id={id}><ErrorPanel title={`${id} is not on this board`} detail={error} /></Inspector>;

  const byStatus = (COLUMNS as Status[]).map((s) => ({ label: label(s), value: kids.filter((t) => t.status === s).length }));

  return (
    <Inspector
      id={id}
      onClose={close}
      title={<InlineEdit value={epic.title} label={`${id} title`} onSave={(title) => run(() => write.editEpic(id, { title }), { ok: "title saved" })} />}
      meta={
        <>
          <span className="tm-id">{id}</span>
          <Chip kind="status" value={epic.status}>{epic.status === "done" ? "closed" : epic.status === "open" ? "open" : label(epic.status)}</Chip>
          {active && <Chip tone="accent" dot>active</Chip>}
          {isMap && <Chip tone="info" dot={false}><Map size={11} aria-hidden /> map</Chip>}
        </>
      }
      actions={
        epic.status === "done" ? (
          <Button size="sm" pending={pending} onClick={() => void run(() => write.reopenEpic(id), { ok: `${id} reopened` })}>Reopen</Button>
        ) : (
          <>
            {!active && <Button size="sm" pending={pending} onClick={() => void run(() => write.activeEpic(id), { ok: `${id} is the active epic` })}>Make active</Button>}
            <Button size="sm" variant="default" onClick={() => setImporting(true)}>Import goals…</Button>
            <Button size="sm" variant="default" onClick={() => setConfirmClose(true)}>Close epic</Button>
          </>
        )
      }
    >
      <Section title="why this epic" actions={!editing && <Button size="sm" variant="ghost" onClick={() => { setDraft(epic.body ?? ""); setEditing(true); }}>edit</Button>}>
        {editing ? (
          <div className="tm-stack">
            <TextArea value={draft} onChange={(e) => setDraft(e.target.value)} rows={10} mono aria-label={`${id} body`} autoFocus onKeyDown={(e) => { if (e.key === "Escape") { e.stopPropagation(); setEditing(false); } if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) void saveBody(); }} />
            <div className="tm-row" style={{ justifyContent: "flex-end" }}><Button size="sm" variant="ghost" onClick={() => setEditing(false)}>Cancel</Button><Button size="sm" variant="primary" pending={pending} onClick={() => void saveBody()}>Save</Button></div>
          </div>
        ) : (epic.body ?? "").trim() ? (
          <Markdown source={epic.body ?? ""} />
        ) : (
          <button type="button" className="tm-inline" data-empty="true" onClick={() => { setDraft(""); setEditing(true); }}>empty — say what this body of work is</button>
        )}
        {epic.closed && <span className="tm-faint">closed <time className="tm-id" dateTime={epic.closed}>{epic.closed.slice(0, 16).replace("T", " ")}</time></span>}
      </Section>

      <Section title="plan" actions={epic.plan ? <Button size="sm" variant="ghost" onClick={() => void run(() => write.epicPlan(id, null), { ok: "plan unlinked" })}>unlink</Button> : undefined}>
        {epic.plan ? (
          <>
            <Chip kind="count" title={epic.plan}><FileText size={11} aria-hidden /> {plan?.name ?? epic.plan.split("/").pop()}</Chip>
            {plan?.manifest?.goals ? (
              <ol className="tm-plan-goals">
                {plan.manifest.goals.map((g) => (
                  <li key={g.id}><span className="tm-id">{g.id}</span> {g.title ?? g.doc}</li>
                ))}
              </ol>
            ) : plan?.content ? (
              <pre className="tm-plan-preview">{plan.content.slice(0, 1600)}{plan.content.length > 1600 ? "\n…" : ""}</pre>
            ) : (
              <span className="tm-faint">{plan === null ? "loading the plan…" : "the plan file is empty"}</span>
            )}
          </>
        ) : plans.length ? (
          <Select aria-label="link a plan" placeholder="link a plan from the inbox…" value="" options={plans.map((p) => ({ value: p.path, label: p.name }))} onChange={(e) => e.target.value && void run(() => write.epicPlan(id, e.target.value), { ok: "plan linked" })} />
        ) : (
          <span className="tm-faint">no plan linked — approve one in Claude Code and it lands in <Link to="/plans">Plans</Link></span>
        )}
      </Section>

      <Section title={`children · ${kids.length}`} actions={<Button size="sm" variant="ghost" onClick={() => navigate(`/board?q=epic:${id}`)}>on the board</Button>}>
        {kids.length === 0 ? (
          <span className="tm-faint">no tasks yet — <code>tm task new "&lt;title&gt;"</code> files under the active epic</span>
        ) : (
          <ul className="tm-children" role="list">
            {kids.map((t) => {
              const holder = holderOf(t, board);
              const role = decisionRole(t.labels);
              return (
                <li key={t.id} className="tm-child">
                  <Link to={`/tasks/${t.id}`} inspector className="tm-child__main">
                    <span className="tm-id">{t.id}</span>
                    <span className="tm-child__title">{t.title}</span>
                  </Link>
                  <span className="tm-row tm-child__state">
                    <Chip kind="status" value={t.status}>{label(t.status)}</Chip>
                    {holder && <Chip tone="accent" dot title={holder.session ?? holder.actor}>{holder.short}</Chip>}
                    {role && <Chip tone="info" dot={false}>{role.replace("decision:", "")}{attentionOf(role) ? ` · ${attentionOf(role)}` : ""}</Chip>}
                    {needsAnswer(t) && <Chip tone="warn" dot>needs answer</Chip>}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </Section>

      <Section title={`decisions · ${adrs.length}`} actions={<Button size="sm" variant="ghost" onClick={() => navigate("/decisions")}>all</Button>}>
        {adrs.length === 0 ? (
          <span className="tm-faint">none recorded under {id} — a real multi-option answer becomes an ADR on its own</span>
        ) : (
          <ul className="tm-children" role="list">
            {adrs.map((a) => (
              <li key={a.id} className="tm-child">
                <Link to={`/decisions/${a.id}`} inspector className="tm-child__main"><span className="tm-id">{a.id}</span><span className="tm-child__title">{a.title}</span></Link>
                <span className="tm-row tm-child__state">
                  <Chip tone={a.status === "accepted" ? "ok" : a.status === "superseded" ? undefined : "info"} dot>{a.status}</Chip>
                  {a.status === "proposed" && <Button size="sm" onClick={() => void run(() => write.acceptAdr(a.id), { ok: `${a.id} accepted` })}>Accept</Button>}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section title="progress">
        <div className="tm-row"><Progress value={done} max={total} label={`${done} of ${total} done`} tone={total > 0 && done === total ? "ok" : undefined} /><span className="tm-id">{done}/{total}</span></div>
        {total > 0 && <Bars rows={byStatus} label={`${id} children by status`} />}
      </Section>

      <Modal open={confirmClose} onClose={() => setConfirmClose(false)} title={`Close ${id}?`} footer={<><Button variant="ghost" onClick={() => setConfirmClose(false)}>Cancel</Button><Button variant="primary" pending={pending} onClick={() => void run(() => write.closeEpic(id), { ok: `${id} closed` }).then(() => setConfirmClose(false))}>Close epic</Button></>}>
        <p>
          {openKids > 0 ? `${openKids} task${openKids === 1 ? " is" : "s are"} still open under it. They stay on the board; the epic stops gating new work and clears the active pointer if it holds it.` : "Every child is done. Closing writes the closed timestamp and clears the active pointer if this epic holds it."}
        </p>
        <p className="tm-faint">The same as <code>tm epic done {id}</code>. <code>tm reopen</code> brings it back.</p>
      </Modal>
      {importing && <GoalImportModal epic={id} onClose={() => setImporting(false)} />}
    </Inspector>
  );
}

/**
 * `tm goal import <doc.md|*.plan.json> --epic <id>` from the board. A path is read inside the
 * repo; pasted text never touches the filesystem. Refusals (no parseable criteria) come back
 * as the CLI's own 409 text, and a manifest's skipped docs are listed rather than hidden.
 * ponytail: duplicated on the plans screen on purpose — two tiny forms beat a shared module.
 */
function GoalImportModal({ epic, onClose }: { epic: string; onClose: () => void }) {
  const [path, setPath] = useState("");
  const [content, setContent] = useState("");
  const [name, setName] = useState("");
  const [result, setResult] = useState<{ id?: string; epic?: string; tasks?: string[]; skipped?: { id: string; why: string }[] } | null>(null);
  const { run, pending, error } = useWrite();
  const submit = () =>
    void run(() => write.goalImport(path.trim() ? { path: path.trim(), epic } : { content, name: name.trim() || "pasted-goal.md", epic }), { ok: "goal imported" }).then((r) => setResult((r as typeof result) ?? null));
  return (
    <Modal open onClose={onClose} title={`Import goals into ${epic}`} footer={<><Button variant="ghost" onClick={onClose}>{result ? "Done" : "Cancel"}</Button>{!result && <Button variant="primary" pending={pending} disabled={!path.trim() && !content.trim()} onClick={submit}>Import</Button>}</>}>
      {result ? (
        <div className="tm-stack">
          {result.id && <p><span className="tm-id">{result.id}</span> created under <span className="tm-id">{result.epic ?? epic}</span>.</p>}
          {result.tasks && <p>{result.tasks.length} task{result.tasks.length === 1 ? "" : "s"} landed under <span className="tm-id">{result.epic}</span>.</p>}
          {result.skipped && result.skipped.length > 0 && (
            <ul className="tm-stack" aria-label="skipped goals">{result.skipped.map((s) => <li key={s.id}><span className="tm-id">{s.id}</span> — {s.why}</li>)}</ul>
          )}
        </div>
      ) : (
        <div className="tm-stack">
          <Field label="Path in this repo">{(a) => <TextField {...a} value={path} onChange={(e) => setPath(e.target.value)} placeholder="docs/goals/feature.md or program.plan.json" mono />}</Field>
          <p className="tm-faint">or paste a goal doc — a manifest has to be a path, since its docs are files.</p>
          <Field label="Name">{(a) => <TextField {...a} value={name} onChange={(e) => setName(e.target.value)} placeholder="pasted-goal.md" mono disabled={!!path.trim()} />}</Field>
          <Field label="Goal doc">{(a) => <TextArea {...a} value={content} onChange={(e) => setContent(e.target.value)} rows={8} mono disabled={!!path.trim()} />}</Field>
          {error && <ErrorPanel title="Import refused" detail={error} />}
        </div>
      )}
    </Modal>
  );
}
