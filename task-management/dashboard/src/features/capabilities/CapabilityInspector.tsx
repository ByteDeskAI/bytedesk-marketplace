import { useEffect, useState } from "react";
import type { ScreenProps } from "../../app/routes";
import { Button } from "../../components/ui/Button";
import { Chip } from "../../components/ui/Chip";
import { ErrorPanel } from "../../components/ui/ErrorPanel";
import { Field, Select, TextField } from "../../components/ui/Field";
import { InlineEdit } from "../../components/ui/InlineEdit";
import { Inspector, Section } from "../../components/ui/Inspector";
import { Modal } from "../../components/ui/Modal";
import { SkeletonRows } from "../../components/ui/Skeleton";
import { fetchEvidence, write } from "../../lib/api";
import { closeInspector, Link, navigate } from "../../lib/router";
import { useBoard, useEntity, useMeta, useWrite } from "../../lib/store";
import type { Capability, EvidenceItem } from "../../lib/types";
import { MarkdownEdit } from "../task/sections/MarkdownEdit";
import { capLabel, capTone } from "./Capabilities";
import "../../styles/capabilities.css";
import "../../styles/detail.css";

/** One card: accept mints the task, ship needs proof, drop takes a reason. Fields edit in place. */
export default function CapabilityInspector({ params }: ScreenProps) {
  const id = params.id;
  const { entity, detail, loading, error } = useEntity<Capability>(id);
  const meta = useMeta();
  const board = useBoard();
  const { run, pending } = useWrite();
  const [shipping, setShipping] = useState(false);
  const [dropping, setDropping] = useState(false);
  const close = () => closeInspector("/capabilities");
  if (error || (!entity && !loading)) return <Inspector title={id} onClose={close} id={id}><ErrorPanel title={`${id} is not on this board`} detail={error} /></Inspector>;
  if (!entity) return <Inspector title={id} onClose={close} id={id}><SkeletonRows /></Inspector>;
  const cap = entity;
  const body = detail?.body ?? "";
  const task = cap.task ? board?.tasks.find((t) => t.id === cap.task) : undefined;
  const levels = meta?.vocab.capLevels ?? ["H", "M", "L"];
  const efforts = meta?.vocab.capEfforts ?? ["S", "M", "L"];
  const opts = (xs: string[]) => xs.map((v) => ({ value: v, label: v }));
  const patch = (p: Record<string, unknown>) => void run(() => write.editCap(cap.id, p), { optimistic: { id: cap.id, patch: p as Partial<Capability> } });
  const hasEvidence = (cap.evidence ?? []).length > 0 || (task?.evidence ?? []).length > 0;
  return (
    <Inspector
      id={cap.id}
      onClose={close}
      meta={
        <div className="tm-row" style={{ flexWrap: "wrap", gap: "var(--tm-s2)" }}>
          <span className="tm-id" style={{ color: "var(--tm-ink)" }}>{cap.id}</span>
          <Chip kind="plain" tone={capTone(cap.status)} dot>{capLabel(cap.status)}</Chip>
          <span className="tm-cap__score"><span className="mono">{cap.score ?? "–"}</span><span className="tm-faint"> / 27</span></span>
          {cap.task && <Link to={`/tasks/${cap.task}`} inspector className="tm-chip" data-kind="plain">{cap.task}</Link>}
        </div>
      }
      actions={
        <>
          {cap.status === "open" && <Button size="sm" variant="primary" pending={pending} onClick={() => void run(() => write.acceptCap(cap.id), { ok: `${cap.id} accepted` }).then((r) => r?.task && navigate(`/tasks/${r.task}`, { inspector: "/capabilities" }))}>Accept</Button>}
          {cap.status === "in_progress" && <Button size="sm" variant="primary" onClick={() => setShipping(true)} title={hasEvidence ? undefined : "shipping refuses without evidence"}>Ship…</Button>}
          {(cap.status === "open" || cap.status === "in_progress") && <Button size="sm" variant="ghost" onClick={() => setDropping(true)}>Drop…</Button>}
        </>
      }
      title={<InlineEdit value={cap.title} label={`title of ${cap.id}`} placeholder="Title" onSave={(v) => { if (v) patch({ title: v }); }} />}
    >
      {cap.droppedReason && <p className="tm-reason" data-tone="warn">dropped — {cap.droppedReason}</p>}
      {cap.shipped && <p className="tm-reason" data-tone="ok">shipped {cap.shipped.slice(0, 10)}</p>}
      <Section title="sizing">
        <div className="tm-fields">
          <Field label="Impact">{(p) => <Select {...p} value={cap.impact ?? ""} placeholder="?" options={opts(levels)} onChange={(e) => patch({ impact: e.target.value })} />}</Field>
          <Field label="Effort">{(p) => <Select {...p} value={cap.effort ?? ""} placeholder="?" options={opts(efforts)} onChange={(e) => patch({ effort: e.target.value })} />}</Field>
          <Field label="Confidence">{(p) => <Select {...p} value={cap.confidence ?? ""} placeholder="?" options={opts(levels)} onChange={(e) => patch({ confidence: e.target.value })} />}</Field>
        </div>
        <dl className="tm-kv">
          <dt>area</dt><dd><InlineEdit value={cap.area ?? ""} label="area" placeholder="none" onSave={(v) => patch({ area: v })} /></dd>
          <dt>source</dt><dd><InlineEdit value={cap.source ?? ""} label="source" placeholder="none" onSave={(v) => patch({ source: v })} /></dd>
        </dl>
      </Section>
      <Section title="card">
        <MarkdownEdit key={`${cap.id}-${detail ? "full" : "pending"}`} value={body} loading={!detail} label={`body of ${cap.id}`} placeholder="Problem / Current state / Proposal / Acceptance criteria / Non-goals" onSave={(v) => run(() => write.editCap(cap.id, { body: v }))} />
      </Section>
      {(cap.evidence ?? []).length > 0 && (
        <Section title="evidence">
          <ul className="tm-touches">{cap.evidence!.map((e) => <li key={e} className="mono tm-truncate">{e}</li>)}</ul>
        </Section>
      )}
      {(cap.related ?? []).length > 0 && (
        <Section title="related">
          <ul className="tm-links">{cap.related!.map((r) => <li key={r} className="tm-links__row"><Link to={`/tasks/${r}`} inspector className="mono">{r}</Link></li>)}</ul>
        </Section>
      )}
      <ShipModal cap={cap} open={shipping} onClose={() => setShipping(false)} />
      <DropModal cap={cap} open={dropping} onClose={() => setDropping(false)} />
    </Inspector>
  );
}

/** Ship needs a proof ref: pick one off the minted task, or type a path / url. */
function ShipModal({ cap, open, onClose }: { cap: Capability; open: boolean; onClose: () => void }) {
  const { run, pending, error } = useWrite();
  const [items, setItems] = useState<EvidenceItem[]>([]);
  const [ref, setRef] = useState("");
  useEffect(() => {
    if (!open || !cap.task) return;
    fetchEvidence(cap.task).then((r) => setItems(r.evidence ?? [])).catch(() => setItems([]));
  }, [open, cap.task]);
  const own = cap.evidence ?? [];
  const choices = [...own, ...items.map((i) => i.ref)];
  return (
    <Modal open={open} onClose={onClose} title={`Ship ${cap.id}`} footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button variant="primary" pending={pending} onClick={() => void run(() => write.shipCap(cap.id, { evidence: ref.trim() || undefined, task: cap.task }), { ok: `${cap.id} shipped` }).then((r) => r && onClose())}>Ship</Button></>}>
      <div className="tm-stack">
        <p className="tm-muted">Shipping refuses without evidence. {own.length ? "This card already carries some; add more or ship as is." : "Point at proof — a log, a test file, a PR url."}</p>
        {choices.length > 0 && (
          <Field label="From the task">{(p) => <Select {...p} value="" placeholder="pick a ref…" options={choices.map((c) => ({ value: c, label: c }))} onChange={(e) => setRef(e.target.value)} />}</Field>
        )}
        <Field label="Evidence ref" error={error}>{(p) => <TextField {...p} mono value={ref} placeholder="tests/unit/mcp.test.mjs or https://…/pull/12" onChange={(e) => setRef(e.target.value)} />}</Field>
      </div>
    </Modal>
  );
}

function DropModal({ cap, open, onClose }: { cap: Capability; open: boolean; onClose: () => void }) {
  const { run, pending, error } = useWrite();
  const [why, setWhy] = useState("");
  return (
    <Modal open={open} onClose={onClose} title={`Drop ${cap.id}?`} footer={<><Button variant="ghost" onClick={onClose}>Keep it</Button><Button variant="danger" pending={pending} onClick={() => void run(() => write.dropCap(cap.id, why.trim() || undefined), { ok: `${cap.id} dropped` }).then((r) => r && onClose())}>Drop</Button></>}>
      <div className="tm-stack">
        <p className="tm-muted">The card stays on disk marked dropped, with the reason; nothing is deleted.</p>
        <Field label="Why" error={error}>{(p) => <TextField {...p} autoFocus value={why} placeholder="superseded by the router work" onChange={(e) => setWhy(e.target.value)} />}</Field>
      </div>
    </Modal>
  );
}
