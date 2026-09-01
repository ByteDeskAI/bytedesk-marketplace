import { useState } from "react";
import { Button } from "../../components/ui/Button";
import { Chip } from "../../components/ui/Chip";
import { Field, Select, TextArea, TextField } from "../../components/ui/Field";
import { Modal } from "../../components/ui/Modal";
import { write } from "../../lib/api";
import { Link } from "../../lib/router";
import { useBoard, useWrite } from "../../lib/store";

type Result = Awaited<ReturnType<typeof write.goalImport>>;

/**
 * `tm goal import` from the board: a repo-relative path (a `.md` goal doc becomes one task under
 * the chosen epic; a `.plan.json` manifest lands a whole epic) or a pasted doc. Refusals — no
 * parseable criteria, a path outside the repo — are the server's own text, shown verbatim.
 */
export function ImportGoal({ open, onClose, onDone }: { open: boolean; onClose: () => void; onDone: () => void }) {
  const board = useBoard();
  const { run, pending, error, clear } = useWrite();
  const [mode, setMode] = useState<"path" | "paste">("path");
  const [path, setPath] = useState("");
  const [content, setContent] = useState("");
  const [name, setName] = useState("");
  const [epic, setEpic] = useState("");
  const [result, setResult] = useState<Result | null>(null);
  const openEpics = (board?.epics ?? []).filter((e) => e.status !== "done");
  const active = board?.state?.activeEpic ?? null;
  const reset = () => { setResult(null); clear(); };
  const close = () => { reset(); onClose(); };
  const submit = () => {
    const payload = mode === "path" ? { path: path.trim() } : { content, name: name.trim() || "pasted-goal.md" };
    void run(() => write.goalImport({ ...payload, ...(epic ? { epic } : {}) })).then((r) => { if (r) { setResult(r); onDone(); } });
  };
  const ready = mode === "path" ? path.trim().length > 0 : content.trim().length > 0;
  return (
    <Modal
      open={open}
      onClose={close}
      title="Import a goal"
      footer={result ? <Button variant="primary" onClick={close}>Done</Button> : <><Button variant="ghost" onClick={close}>Cancel</Button><Button variant="primary" pending={pending} disabled={!ready} onClick={submit}>Import</Button></>}
    >
      {result ? (
        <div className="tm-stack">
          {result.epic && !result.id ? (
            <p>Landed <Link to={`/epics/${result.epic}`} inspector className="mono">{result.epic}</Link> with {(result.tasks ?? []).length} task(s).</p>
          ) : (
            <p>Created <Link to={`/tasks/${result.id}`} inspector className="mono">{result.id}</Link>{result.epic ? <> under <span className="mono">{result.epic}</span></> : null}.</p>
          )}
          {(result.tasks ?? []).length > 0 && (
            <ul className="tm-links">{result.tasks!.map((t) => <li key={t} className="tm-links__row"><Link to={`/tasks/${t}`} inspector className="mono">{t}</Link></li>)}</ul>
          )}
          {(result.skipped ?? []).length > 0 && (
            <div className="tm-stack" style={{ gap: "var(--tm-s1)" }}>
              <span className="tm-caps">skipped · {result.skipped!.length}</span>
              {result.skipped!.map((s) => <p key={s.id} className="tm-reason" data-tone="warn"><Chip kind="plain" tone="warn" dot>{s.id}</Chip><span>{s.why}</span></p>)}
            </div>
          )}
        </div>
      ) : (
        <div className="tm-stack">
          <div className="tm-row" role="group" aria-label="source">
            <Button size="sm" variant={mode === "path" ? "primary" : "ghost"} aria-pressed={mode === "path"} onClick={() => setMode("path")}>A file in the repo</Button>
            <Button size="sm" variant={mode === "paste" ? "primary" : "ghost"} aria-pressed={mode === "paste"} onClick={() => setMode("paste")}>Paste a doc</Button>
          </div>
          {mode === "path" ? (
            <Field label="Path" hint="Repo-relative. A .md goal doc becomes one task; a .plan.json manifest lands a whole epic with its dependencies.">
              {(p) => <TextField {...p} mono autoFocus value={path} placeholder="docs/goals/acp-pod-A1.md" onChange={(e) => setPath(e.target.value)} onKeyDown={(e) => e.key === "Enter" && ready && submit()} />}
            </Field>
          ) : (
            <>
              <Field label="Name" hint="Recorded as the task's goal doc.">{(p) => <TextField {...p} mono value={name} placeholder="my-goal.md" onChange={(e) => setName(e.target.value)} />}</Field>
              <Field label="Goal doc" hint="A # Goal heading and a success-criteria list, or the /goal contract block with Stop when:.">{(p) => <TextArea {...p} mono rows={10} value={content} onChange={(e) => setContent(e.target.value)} />}</Field>
            </>
          )}
          <Field label="Epic" hint={active ? `Defaults to the active epic, ${active}.` : "No active epic — a doc import needs one; a manifest opens its own."}>
            {(p) => <Select {...p} value={epic} placeholder={active ? `active (${active})` : "manifest opens its own"} options={openEpics.map((e) => ({ value: e.id, label: `${e.id} ${e.title}` }))} onChange={(e) => setEpic(e.target.value)} />}
          </Field>
          {error && <p className="tm-reason" data-tone="bad" role="alert">{error}</p>}
        </div>
      )}
    </Modal>
  );
}
