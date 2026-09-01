import { useEffect, useState } from "react";
import { Button } from "../../components/ui/Button";
import { Combobox } from "../../components/ui/Combobox";
import { Field, Select, TextArea, TextField } from "../../components/ui/Field";
import { Modal } from "../../components/ui/Modal";
import { fetchTemplate, fetchTemplates, write } from "../../lib/api";
import { labelOptions } from "../../lib/filters";
import { navigate } from "../../lib/router";
import { useBoard, useMeta, useWrite } from "../../lib/store";
import type { TemplateSummary } from "../../lib/types";
import { PRIORITIES } from "./model";

/**
 * New task. Create is one POST (title, body, epic, assignee, priority, template, acceptance);
 * type, labels and blockers are the follow-up writes the store already has verbs for.
 */
export function CreateTaskModal({ open, onClose, epic: initialEpic }: { open: boolean; onClose: () => void; epic?: string | null }) {
  const board = useBoard();
  const meta = useMeta();
  const { run, pending, error } = useWrite();
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [epic, setEpic] = useState("");
  const [priority, setPriority] = useState("");
  const [type, setType] = useState("");
  const [assignee, setAssignee] = useState("");
  const [labels, setLabels] = useState<string[]>([]);
  const [deps, setDeps] = useState<string[]>([]);
  const [ac, setAc] = useState("");
  const [template, setTemplate] = useState("");
  const [templates, setTemplates] = useState<TemplateSummary[]>([]);

  useEffect(() => {
    if (!open) return;
    setTitle(""); setBody(""); setPriority(""); setType(""); setAssignee(""); setLabels([]); setDeps([]); setAc(""); setTemplate("");
    setEpic(initialEpic ?? board?.state?.activeEpic ?? "");
    fetchTemplates().then(setTemplates).catch(() => setTemplates([]));
  }, [open, initialEpic, board?.state?.activeEpic]);

  const pickTemplate = (name: string) => {
    setTemplate(name);
    if (!name) return;
    fetchTemplate(name)
      .then((t) => {
        setBody(t.body ?? "");
        const f = t.fields as { type?: string; priority?: string; labels?: string[] };
        if (f.type) setType(f.type);
        if (f.priority) setPriority(f.priority);
        if (Array.isArray(f.labels)) setLabels(f.labels);
      })
      .catch(() => {});
  };

  const submit = () =>
    run(async () => {
      const acceptance = ac.split("\n").map((s) => s.trim()).filter(Boolean);
      const made = await write.create({ title: title.trim(), body: body || undefined, epic: epic || null, assignee: assignee.trim() || undefined, priority: priority || undefined, template: template || undefined, acceptance: acceptance.length ? acceptance : undefined });
      if (type) await write.type(made.id, type);
      if (labels.length) await write.labels(made.id, { add: labels });
      if (deps.length) await write.dep(made.id, { add: deps });
      onClose();
      navigate(`/tasks/${made.id}`, { inspector: true });
      return made;
    }, { ok: "created" });

  const open_tasks = (board?.tasks ?? []).filter((t) => t.status !== "done" && t.status !== "deleted");
  return (
    <Modal open={open} onClose={onClose} title="New task" size="lg" footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button variant="primary" onClick={() => void submit()} pending={pending} disabled={!title.trim()}>Create</Button></>}>
      <form className="tm-stack" onSubmit={(e) => { e.preventDefault(); if (title.trim()) void submit(); }}>
        <Field label="title" error={error}>{(p) => <TextField {...p} value={title} onChange={(e) => setTitle(e.target.value)} autoFocus placeholder="what, in one line" />}</Field>
        <div className="tm-grid-2">
          <Field label="template" hint="fills the body and the fields a starter declares">{(p) => <Select {...p} placeholder="none" value={template} options={templates.map((t) => ({ value: t.name, label: `${t.name} — ${t.description}` }))} onChange={(e) => pickTemplate(e.target.value)} />}</Field>
          <Field label="epic" hint={epic ? undefined : "requireEpic is on: the create gate needs an active epic"}>{(p) => <Select {...p} placeholder="none" value={epic} options={(board?.epics ?? []).filter((e) => e.status !== "done").map((e) => ({ value: e.id, label: `${e.id} ${e.title}` }))} onChange={(e) => setEpic(e.target.value)} />}</Field>
          <Field label="priority">{(p) => <Select {...p} placeholder="medium (unset)" value={priority} options={(meta?.vocab.priorities ?? [...PRIORITIES]).map((v) => ({ value: v, label: v }))} onChange={(e) => setPriority(e.target.value)} />}</Field>
          <Field label="type">{(p) => <Select {...p} placeholder="task" value={type} options={(meta?.vocab.types ?? ["task", "bug", "story", "spike", "chore"]).map((v) => ({ value: v, label: v }))} onChange={(e) => setType(e.target.value)} />}</Field>
          <Field label="assignee">{(p) => <TextField {...p} value={assignee} onChange={(e) => setAssignee(e.target.value)} placeholder="who" />}</Field>
          <Field label="labels">{() => <Combobox label="labels" values={labels} options={labelOptions(board?.tasks ?? [], board?.labelCatalog ?? [])} onChange={setLabels} creatable placeholder="add a label…" />}</Field>
        </div>
        <Field label="blocked by" hint="dependencies; a cycle is refused at write time">{() => <Combobox label="blocked by" values={deps} options={open_tasks.map((t) => t.id)} onChange={setDeps} placeholder="TM-…" chipKind="plain" />}</Field>
        <Field label="acceptance criteria" hint="one per line — tm done refuses until every one is ticked">{(p) => <TextArea {...p} value={ac} onChange={(e) => setAc(e.target.value)} rows={3} placeholder={"the token refresh path is covered by a test\nthe error surfaces the server's own wording"} />}</Field>
        <Field label="body" hint="markdown">{(p) => <TextArea {...p} value={body} onChange={(e) => setBody(e.target.value)} rows={6} mono />}</Field>
      </form>
    </Modal>
  );
}

/** New epic; it becomes the active one, which is the gate every later create checks. */
export function CreateEpicModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { run, pending, error } = useWrite();
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  useEffect(() => {
    if (open) { setTitle(""); setBody(""); }
  }, [open]);
  const submit = () =>
    run(async () => {
      const made = await write.createEpic({ title: title.trim(), body: body || undefined });
      onClose();
      navigate(`/epics/${made.id}`, { inspector: true });
      return made;
    }, { ok: "epic created and set active" });
  return (
    <Modal open={open} onClose={onClose} title="New epic" footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button variant="primary" onClick={() => void submit()} pending={pending} disabled={!title.trim()}>Create and activate</Button></>}>
      <form className="tm-stack" onSubmit={(e) => { e.preventDefault(); if (title.trim()) void submit(); }}>
        <Field label="title" error={error}>{(p) => <TextField {...p} value={title} onChange={(e) => setTitle(e.target.value)} autoFocus />}</Field>
        <Field label="why this epic" hint="markdown; what the body of work is, so tasks under it have meaning">{(p) => <TextArea {...p} value={body} onChange={(e) => setBody(e.target.value)} rows={5} />}</Field>
      </form>
    </Modal>
  );
}
