import { Lightbulb, Plus } from "lucide-react";
import { useState } from "react";
import type { ScreenProps } from "../../app/routes";
import { Button } from "../../components/ui/Button";
import { Chip } from "../../components/ui/Chip";
import { EmptyState } from "../../components/ui/EmptyState";
import { ErrorPanel } from "../../components/ui/ErrorPanel";
import { Field, Select, TextArea, TextField } from "../../components/ui/Field";
import { Modal } from "../../components/ui/Modal";
import { SkeletonRows } from "../../components/ui/Skeleton";
import { write } from "../../lib/api";
import { Link, navigate } from "../../lib/router";
import { useBoard, useLoading, useMeta, useWrite } from "../../lib/store";
import type { Capability } from "../../lib/types";
import "../../styles/capabilities.css";
import "../../styles/detail.css";

/** Store vocabulary → what a card says. */
export const capLabel = (s: string) => ({ open: "proposed", in_progress: "accepted", done: "shipped", deleted: "dropped" })[s] ?? s;
/** Mirrors lib/capability.mjs score(): impact × ease × confidence, 1–27; unset levels read as M. */
export function scoreOf(c: { score?: number; impact?: string; effort?: string; confidence?: string }): number {
  if (typeof c.score === "number") return c.score;
  const lvl: Record<string, number> = { L: 1, M: 2, H: 3 };
  const ease: Record<string, number> = { S: 3, M: 2, L: 1 };
  return (lvl[c.impact ?? ""] || 2) * (ease[c.effort ?? ""] || 2) * (lvl[c.confidence ?? ""] || 2);
}
export const capTone = (s: string) => ({ open: "info", in_progress: "accent", done: "ok" } as const)[s as "open" | "in_progress" | "done"];
const LEVELS = ["H", "M", "L"];
const EFFORTS = ["S", "M", "L"];

/** What is worth doing: ranked cards, best bet first. Accepting mints the task that builds it. */
export default function Capabilities(_: ScreenProps) {
  const board = useBoard();
  const { error } = useLoading();
  const [proposing, setProposing] = useState(false);
  const [showDropped, setShowDropped] = useState(false);
  const caps = (board?.capabilities ?? []).filter((c) => showDropped || c.status !== "deleted").slice().sort((a, b) => scoreOf(b) - scoreOf(a));
  return (
    <div className="tm-screen">
      <div className="tm-screen__head">
        <div>
          <h1>Capabilities</h1>
        </div>
        <div className="tm-screen__actions">
          <label className="tm-check"><input type="checkbox" checked={showDropped} onChange={(e) => setShowDropped(e.target.checked)} /><span>show dropped</span></label>
          <Button variant="primary" icon={<Plus size={16} />} onClick={() => setProposing(true)}>Propose</Button>
        </div>
      </div>
      {!board ? (
        error ? <ErrorPanel title="The board could not be loaded" detail={error} /> : <SkeletonRows rows={4} height={96} />
      ) : caps.length === 0 ? (
        <EmptyState icon={<Lightbulb size={28} />} title="Nothing proposed" action={<Button onClick={() => setProposing(true)}>Propose a capability</Button>}>
          Run <code>/task-management:enhance</code> to capture product state, research and propose ranked cards — or write one here.
        </EmptyState>
      ) : (
        <ul className="tm-cap-grid">
          {caps.map((c) => <CapCard key={c.id} cap={c} />)}
        </ul>
      )}
      <ProposeCap open={proposing} onClose={() => setProposing(false)} />
    </div>
  );
}

function CapCard({ cap }: { cap: Capability }) {
  return (
    <li>
      <Link to={`/capabilities/${cap.id}`} inspector className="tm-cap" data-status={cap.status}>
        <div className="tm-row" style={{ gap: "var(--tm-s2)", flexWrap: "wrap" }}>
          <span className="tm-id">{cap.id}</span>
          <Chip kind="plain" tone={capTone(cap.status)} dot>{capLabel(cap.status)}</Chip>
          {cap.area && <Chip kind="label">{cap.area}</Chip>}
          <span className="tm-grow" />
          <span className="tm-cap__score" title="impact × ease × confidence"><span className="mono">{scoreOf(cap)}</span><span className="tm-faint"> / 27</span></span>
        </div>
        <span className="tm-cap__title">{cap.title}</span>
        <div className="tm-row tm-faint" style={{ gap: "var(--tm-s3)", flexWrap: "wrap" }}>
          <span className="mono">I {cap.impact ?? "?"} · E {cap.effort ?? "?"} · C {cap.confidence ?? "?"}</span>
          {cap.task && <span className="mono">→ {cap.task}</span>}
          {cap.source && <span>from {cap.source}</span>}
          {(cap.evidence ?? []).length > 0 && <span>{cap.evidence!.length} evidence</span>}
        </div>
      </Link>
    </li>
  );
}

function ProposeCap({ open, onClose }: { open: boolean; onClose: () => void }) {
  const meta = useMeta();
  const { run, pending, error } = useWrite();
  const blank = { title: "", area: "", impact: "M", effort: "M", confidence: "M", source: "", problem: "", current: "", proposal: "", criteria: "", nonGoals: "" };
  const [f, setF] = useState(blank);
  const set = (k: keyof typeof blank) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });
  const levels = meta?.vocab.capLevels ?? LEVELS;
  const efforts = meta?.vocab.capEfforts ?? EFFORTS;
  const lines = (s: string) => s.split("\n").map((l) => l.trim()).filter(Boolean);
  const submit = async () => {
    if (!f.title.trim()) return;
    const r = await run(
      () => write.proposeCap({ title: f.title.trim(), area: f.area || undefined, impact: f.impact, effort: f.effort, confidence: f.confidence, source: f.source || undefined, problem: f.problem || undefined, current: f.current || undefined, proposal: f.proposal || undefined, criteria: lines(f.criteria), nonGoals: lines(f.nonGoals) }),
      { ok: "Capability proposed" },
    );
    if (r?.id) {
      setF(blank);
      onClose();
      navigate(`/capabilities/${r.id}`, { inspector: "/capabilities" });
    }
  };
  const opts = (xs: string[]) => xs.map((v) => ({ value: v, label: v }));
  return (
    <Modal open={open} onClose={onClose} title="Propose a capability" size="lg" footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button variant="primary" pending={pending} disabled={!f.title.trim()} onClick={() => void submit()}>Propose</Button></>}>
      <form className="tm-stack" onSubmit={(e) => { e.preventDefault(); void submit(); }}>
        <Field label="Title" error={error}>{(p) => <TextField {...p} autoFocus value={f.title} onChange={set("title")} />}</Field>
        <div className="tm-fields">
          <Field label="Impact">{(p) => <Select {...p} value={f.impact} options={opts(levels)} onChange={set("impact")} />}</Field>
          <Field label="Effort">{(p) => <Select {...p} value={f.effort} options={opts(efforts)} onChange={set("effort")} />}</Field>
          <Field label="Confidence">{(p) => <Select {...p} value={f.confidence} options={opts(levels)} onChange={set("confidence")} />}</Field>
          <Field label="Area">{(p) => <TextField {...p} value={f.area} placeholder="ux, platform…" onChange={set("area")} />}</Field>
          <Field label="Source">{(p) => <TextField {...p} value={f.source} placeholder="gap-backlog, research…" onChange={set("source")} />}</Field>
        </div>
        <Field label="Problem / job to be done">{(p) => <TextArea {...p} rows={2} value={f.problem} onChange={set("problem")} />}</Field>
        <Field label="Current state">{(p) => <TextArea {...p} rows={2} value={f.current} onChange={set("current")} />}</Field>
        <Field label="Proposed enhancement">{(p) => <TextArea {...p} rows={3} value={f.proposal} onChange={set("proposal")} />}</Field>
        <Field label="Acceptance criteria" hint="One per line — they become the minted task's gate.">{(p) => <TextArea {...p} rows={3} value={f.criteria} onChange={set("criteria")} />}</Field>
        <Field label="Non-goals" hint="One per line.">{(p) => <TextArea {...p} rows={2} value={f.nonGoals} onChange={set("nonGoals")} />}</Field>
      </form>
    </Modal>
  );
}
