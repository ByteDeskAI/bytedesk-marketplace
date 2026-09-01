import { AlertTriangle, ClipboardCopy, MoreHorizontal, RotateCcw, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import type { ScreenProps } from "../../app/routes";
import { Button } from "../../components/ui/Button";
import { Chip } from "../../components/ui/Chip";
import { Combobox } from "../../components/ui/Combobox";
import { ErrorPanel } from "../../components/ui/ErrorPanel";
import { TextField } from "../../components/ui/Field";
import { InlineEdit } from "../../components/ui/InlineEdit";
import { Inspector, Section } from "../../components/ui/Inspector";
import { Menu } from "../../components/ui/Menu";
import { Modal } from "../../components/ui/Modal";
import { SkeletonRows } from "../../components/ui/Skeleton";
import { Tabs } from "../../components/ui/Tabs";
import { fetchHandoff, write } from "../../lib/api";
import { closeInspector, Link } from "../../lib/router";
import { useBoard, useEntity, useMeta, useWrite } from "../../lib/store";
import { toast } from "../../lib/toast";
import type { Adr, Task } from "../../lib/types";
import { answerOf, attentionOf, decisionRole, hasAnswer, setAnswer } from "../../../../lib/decision.mjs";
import { PlanPreview } from "../plans/PlanPreview";
import { Acceptance } from "./sections/Acceptance";
import { Blockers } from "./sections/Blockers";
import { Comments } from "./sections/Comments";
import { Evidence } from "./sections/Evidence";
import { Fields } from "./sections/Fields";
import { History } from "./sections/History";
import { Links } from "./sections/Links";
import { MarkdownEdit } from "./sections/MarkdownEdit";
import { Worktree } from "./sections/Worktree";
import { copyText, statusLabel, useMedia, when } from "./shared";
import { WorkStream } from "./workstream/WorkStream";
import "../../styles/task.css";
import "../../styles/detail.css";

type Tab = "task" | "history" | "work";

/**
 * One task, completely enough to resume from: identity stays in the sticky header, the body
 * scrolls, and an in-progress task shows its live work stream beside the fields (a tab on
 * narrower screens). Every control is one call to the write API; the server owns the gates.
 */
export default function TaskInspector({ params }: ScreenProps) {
  const id = params.id;
  const { entity, detail, loading, error } = useEntity<Task>(id);
  const meta = useMeta();
  const board = useBoard();
  const { run, pending } = useWrite();
  const [tab, setTab] = useState<Tab>("task");
  const [handoff, setHandoff] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [why, setWhy] = useState("");
  const wide = useMedia("(min-width: 1200px)");

  useEffect(() => setTab("task"), [id]);

  if (error) {
    return (
      <Inspector title={id} onClose={() => closeInspector()} id={id}>
        <ErrorPanel title={`${id} is not on this board`} detail={error} action={<Button size="sm" onClick={() => closeInspector()}>Back</Button>} />
      </Inspector>
    );
  }
  if (!entity) {
    return (
      <Inspector title={id} onClose={() => closeInspector()} id={id}>
        {loading ? <SkeletonRows rows={6} /> : <ErrorPanel title={`${id} is not on this board`} />}
      </Inspector>
    );
  }
  const task = entity;
  const body = detail?.body ?? "";
  const live = task.status === "in_progress";
  const role = decisionRole(task.labels ?? []) as string | null;
  const attention = role ? (attentionOf(role) as string | null) : null;
  const needsAnswer = Boolean(role) && task.status !== "done" && !hasAnswer(body);
  const held = board?.state?.claims?.[task.id] as { session?: string | null; actor?: string } | undefined;
  const mine = held && (held.session ?? null) === (meta?.session ?? null);
  const showWorkBeside = live && wide;
  const tabs: { id: Tab; label: string }[] = [{ id: "task", label: "Task" }, { id: "history", label: "History" }, ...(live && !wide ? [{ id: "work" as Tab, label: "Work" }] : [])];
  const adrs = decisionsFor(task, board?.adrs ?? []);
  const epic = task.epic ? board?.epics.find((e) => e.id === task.epic) : undefined;
  const catalog = board?.labelCatalog ?? meta?.vocab.labelCatalog ?? [];
  const labels = task.labels ?? [];

  const brief = () =>
    fetchHandoff(task.id)
      .then((h) => setHandoff(h.text))
      .catch((e: Error) => toast("bad", "Handoff could not be built", e.message));

  const meta_ = (
    <div className="tm-row tm-task__meta">
      <span className="tm-id" style={{ color: "var(--tm-ink)" }}>{task.id}</span>
      <Chip kind="status" value={task.status}>{statusLabel(task.status, meta)}</Chip>
      {held && <Chip kind="plain" tone={mine ? "accent" : "info"} dot title={held.session ?? "unowned claim"}>{mine ? "held by you" : `held by ${held.actor ?? "a session"}`}</Chip>}
      {task.actor && task.actor !== "main" && <Chip kind="plain">{task.actor}</Chip>}
      {task.epic && <Link to={`/epics/${task.epic}`} inspector className="tm-chip" data-kind="plain" title={epic?.title}>{task.epic}</Link>}
      {role && <Chip kind="plain" tone="info">{role.slice("decision:".length)}</Chip>}
      {attention && <Chip kind="plain" tone={attention === "HITL" ? "warn" : "accent"}>{attention}</Chip>}
      {needsAnswer && <Chip kind="plain" tone="bad" dot>needs answer</Chip>}
      {task.capability && <Link to={`/capabilities/${task.capability}`} inspector className="tm-chip" data-kind="plain">{task.capability}</Link>}
    </div>
  );

  const actions = (
    <Menu
      label={`actions for ${task.id}`}
      trigger={(p) => <Button variant="ghost" size="sm" icon={<MoreHorizontal size={16} />} aria-label="more actions" {...p} />}
      items={[
        { label: "Copy handoff brief", icon: <ClipboardCopy size={14} />, onSelect: () => void brief() },
        held && !mine
          ? { label: "Steal the claim", onSelect: () => void run(() => write.claim(task.id, true), { ok: `${task.id} is yours` }) }
          : mine
            ? { label: "Release the claim", onSelect: () => void run(() => write.release(task.id), { ok: `${task.id} released` }) }
            : { label: "Claim without starting", onSelect: () => void run(() => write.claim(task.id), { ok: `${task.id} claimed` }) },
        "sep",
        task.status === "deleted"
          ? { label: "Restore", icon: <RotateCcw size={14} />, onSelect: () => void run(() => write.restoreTask(task.id), { ok: `${task.id} restored` }) }
          : { label: "Delete…", icon: <Trash2 size={14} />, tone: "bad", onSelect: () => setConfirmDelete(true) },
      ]}
    />
  );

  return (
    <Inspector
      id={task.id}
      wide={showWorkBeside}
      onClose={() => closeInspector()}
      meta={meta_}
      actions={actions}
      title={
        <InlineEdit
          value={task.title}
          label={`title of ${task.id}`}
          placeholder="Give this task a title"
          onSave={(v) => { if (v && v !== task.title) void run(() => write.edit(task.id, { title: v }), { optimistic: { id: task.id, patch: { title: v } } }); }}
        />
      }
    >
      <div className="tm-task" data-live={showWorkBeside || undefined}>
        <div className="tm-task__main">
          {tabs.length > 1 && <Tabs tabs={tabs} value={tab} onChange={(t) => setTab(t as Tab)} label="task views" />}

          {tab === "history" && <History id={task.id} />}
          {tab === "work" && <WorkStream taskId={task.id} />}

          {tab === "task" && (
            <>
              <Section title="context">
                <MarkdownEdit key={`${task.id}-${detail ? "full" : "pending"}`} value={body} loading={!detail} label={`body of ${task.id}`} placeholder="Add context (markdown)" onSave={(v) => run(() => write.edit(task.id, { body: v }))} />
                {task.goalDoc && <p className="tm-faint">goal: <span className="mono">{task.goalDoc}</span></p>}
              </Section>

              {role && (
                <Section title="answer">
                  {needsAnswer && (
                    <p className="tm-reason" data-tone="warn">
                      <AlertTriangle size={14} /> Closing is gated on this: write the decision under <code>## Answer</code>. `tm done` and the board both refuse without it.
                    </p>
                  )}
                  <MarkdownEdit key={`${task.id}-answer-${detail ? "full" : "pending"}`} value={(answerOf(body) as string | null) ?? ""} loading={!detail} label={`answer on ${task.id}`} placeholder="The recorded decision (markdown)" onSave={(v) => run(() => write.edit(task.id, { body: setAnswer(body, v) as string }))} />
                </Section>
              )}

              <Section title="workflow">
                <Fields task={task} />
              </Section>

              <Section title="people and size">
                <dl className="tm-kv">
                  <dt>assignee</dt>
                  <dd><InlineEdit value={task.assignee ?? ""} label={`assignee of ${task.id}`} placeholder="unassigned" onSave={(v) => run(() => write.assign(task.id, v || null), { optimistic: { id: task.id, patch: { assignee: v || undefined } } })} /></dd>
                  <dt>estimate</dt>
                  <dd>
                    <InlineEdit
                      value={task.estimate == null ? "" : String(task.estimate)}
                      label={`estimate of ${task.id}`}
                      placeholder="unsized"
                      mono
                      onSave={(v) => {
                        if (!v) { void run(() => write.estimate(task.id, null)); return; }
                        const n = Number(v);
                        if (!Number.isFinite(n) || n < 0) { toast("bad", "Estimate must be a non-negative number"); return; }
                        void run(() => write.estimate(task.id, n), { optimistic: { id: task.id, patch: { estimate: n } } });
                      }}
                    />
                  </dd>
                  {task.created && <><dt>created</dt><dd className="mono">{when(task.created)}</dd></>}
                  {task.closed && <><dt>closed</dt><dd className="mono">{when(task.closed)}</dd></>}
                </dl>
              </Section>

              <Section title="labels">
                <Combobox
                  values={labels}
                  options={catalog.filter((l) => l !== "decision:map")}
                  creatable
                  label={`labels of ${task.id}`}
                  placeholder="add a label…"
                  onChange={(next) => {
                    const add = next.filter((l) => !labels.includes(l));
                    const remove = labels.filter((l) => !next.includes(l));
                    if (add.length || remove.length) void run(() => write.labels(task.id, { add, remove }), { optimistic: { id: task.id, patch: { labels: next } } });
                  }}
                />
              </Section>

              <Acceptance task={task} />
              <Blockers task={task} />
              <Worktree task={task} />
              <Links task={task} />

              <Section title="decisions">
                {adrs.length === 0 ? (
                  <p className="tm-faint">no ADRs linked or filed under this epic</p>
                ) : (
                  <ul className="tm-links">
                    {adrs.map((a) => (
                      <li key={a.id} className="tm-links__row">
                        <Link to={`/decisions/${a.id}`} inspector className="mono">{a.id}</Link>
                        <span className="tm-truncate">{a.title}</span>
                        {a.status && <Chip kind="plain" tone={a.status === "accepted" ? "ok" : a.status === "proposed" ? "info" : undefined}>{a.status}</Chip>}
                      </li>
                    ))}
                  </ul>
                )}
              </Section>

              {task.epic && (
                <Section title="plan">
                  {epic?.plan ? <PlanPreview path={epic.plan} /> : <p className="tm-faint">no plan linked to {task.epic}</p>}
                </Section>
              )}

              <Evidence task={task} />

              {(task.touches ?? []).length > 0 && (
                <Section title={`touches · ${task.touches!.length}`}>
                  <ul className="tm-touches">{task.touches!.map((p) => <li key={p} className="mono tm-truncate">{p}</li>)}</ul>
                </Section>
              )}

              <Comments task={task} />

              <Section title="handoff">
                <p className="tm-faint">A self-contained brief for another agent: epic, criteria left, blockers, evidence, branch.</p>
                <div><Button size="sm" onClick={() => void brief()}>Show handoff brief</Button></div>
              </Section>
            </>
          )}
        </div>
        {showWorkBeside && <div className="tm-task__side"><WorkStream taskId={task.id} /></div>}
      </div>

      <Modal
        open={handoff !== null}
        onClose={() => setHandoff(null)}
        title={`Handoff — ${task.id}`}
        size="lg"
        footer={
          <>
            <Button variant="ghost" onClick={() => setHandoff(null)}>Close</Button>
            <Button variant="primary" onClick={() => void copyText(handoff ?? "").then((ok) => toast(ok ? "ok" : "warn", ok ? "Handoff copied" : "Clipboard unavailable — select the text instead"))}>Copy</Button>
          </>
        }
      >
        <pre className="tm-task__handoff">{handoff}</pre>
      </Modal>

      <Modal
        open={confirmDelete}
        onClose={() => setConfirmDelete(false)}
        title={`Delete ${task.id}?`}
        footer={
          <>
            <Button variant="ghost" onClick={() => setConfirmDelete(false)}>Keep it</Button>
            <Button variant="danger" pending={pending} onClick={() => void run(() => write.deleteTask(task.id, why.trim() || undefined), { ok: `${task.id} deleted — restore from its page` }).then(() => { setConfirmDelete(false); closeInspector(); })}>Delete</Button>
          </>
        }
      >
        <div className="tm-stack">
          <p className="tm-muted">The file stays on disk with status <code>deleted</code>; the claim is released and the card leaves every list. Restore brings it back where it was.</p>
          <TextField value={why} placeholder="why (optional)" aria-label="reason for deleting" onChange={(e) => setWhy(e.target.value)} />
        </div>
      </Modal>
    </Inspector>
  );
}

/** ADRs the task links to, plus every ADR filed under its epic. */
function decisionsFor(task: Task, adrs: Adr[]): Adr[] {
  const byId = new Map(adrs.map((a) => [a.id, a]));
  const ids = new Set<string>();
  for (const l of task.links ?? []) if (l.id.startsWith("ADR-")) ids.add(l.id);
  if (task.epic) for (const a of adrs) if (a.epic === task.epic) ids.add(a.id);
  return [...ids].map((id) => byId.get(id) ?? { id, title: id, status: "" });
}
