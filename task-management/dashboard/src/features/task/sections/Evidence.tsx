import { X } from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "../../../components/ui/Button";
import { TextArea } from "../../../components/ui/Field";
import { Section } from "../../../components/ui/Inspector";
import { attachEvidenceFile, evidenceUrl, fetchEvidence, write } from "../../../lib/api";
import { useWrite } from "../../../lib/store";
import type { EvidenceItem, Task } from "../../../lib/types";

const IMAGE = /\.(png|jpe?g|gif|webp|svg)$/i;

/** Proof: files copied into the store, urls, opaque handles. Previewable kinds open inline. */
export function Evidence({ task }: { task: Task }) {
  const { run, pending } = useWrite();
  const [rows, setRows] = useState<EvidenceItem[] | null>(null);
  const [note, setNote] = useState("");
  const [open, setOpen] = useState<string | null>(null);
  const key = (task.evidence ?? []).join("\0");
  useEffect(() => {
    let live = true;
    fetchEvidence(task.id)
      .then((r) => live && setRows(r.evidence ?? []))
      .catch(() => live && setRows((task.evidence ?? []).map((ref) => ({ ref, kind: /^https?:/.test(ref) ? "url" : "file", name: ref.split("/").pop() || ref, exists: true, previewable: false }))));
    return () => {
      live = false;
    };
  }, [task.id, key]);

  const list = rows ?? [];
  return (
    <Section title={`evidence · ${list.length}`}>
      {rows === null ? <p className="tm-faint">loading…</p> : list.length === 0 && <p className="tm-faint">No evidence yet. `tm done` on prototype and research tickets refuses without it.</p>}
      <ul className="tm-evidence">
        {list.map((it) => {
          const href = it.kind === "url" ? it.ref : it.previewable && it.exists ? evidenceUrl(task.id, it.ref) : null;
          const showing = open === it.ref;
          return (
            <li key={it.ref} className="tm-evidence__row" data-missing={(it.kind === "file" && !it.exists) || undefined}>
              <div className="tm-row">
                {it.previewable && it.exists ? (
                  <button type="button" className="tm-evidence__name mono" aria-expanded={showing} onClick={() => setOpen(showing ? null : it.ref)}>{it.name}</button>
                ) : href ? (
                  <a href={href} target="_blank" rel="noreferrer" className="tm-evidence__name mono">{it.name}</a>
                ) : (
                  <span className="tm-evidence__name mono" title={it.ref}>{it.name}{it.kind === "file" && !it.exists ? " (missing)" : ""}</span>
                )}
                <span className="tm-grow" />
                {href && it.previewable && <a href={href} target="_blank" rel="noreferrer" className="tm-faint">open</a>}
                <Button variant="ghost" size="sm" icon={<X size={14} />} aria-label={`detach ${it.name}`} title="detach — the file stays on disk" onClick={() => void run(() => write.evidence(task.id, { detach: it.ref }))} />
              </div>
              {showing && href && (IMAGE.test(it.ref) ? <img className="tm-evidence__img" src={href} alt={it.name} /> : <TextPreview href={href} />)}
            </li>
          );
        })}
      </ul>
      <TextArea value={note} rows={2} placeholder="paste output to attach as a log" aria-label="evidence text" mono onChange={(e) => setNote(e.target.value)} />
      <div className="tm-row" style={{ flexWrap: "wrap" }}>
        <Button size="sm" disabled={!note.trim()} pending={pending} onClick={() => void run(() => write.evidence(task.id, { text: note }), { ok: "attached" }).then(() => setNote(""))}>Attach text</Button>
        <label className="tm-btn" data-size="sm">
          Attach file
          <input type="file" className="sr-only" aria-label={`attach a file to ${task.id}`} onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) void run(() => attachEvidenceFile(task.id, f), { ok: `${f.name} attached` }); }} />
        </label>
      </div>
    </Section>
  );
}

function TextPreview({ href }: { href: string }) {
  const [text, setText] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    fetch(href).then((r) => r.text()).then((t) => live && setText(t.length > 20_000 ? t.slice(0, 20_000) + "\n… (truncated; open for the rest)" : t)).catch(() => live && setText("could not load"));
    return () => { live = false; };
  }, [href]);
  return <pre className="tm-evidence__pre">{text ?? "loading…"}</pre>;
}
