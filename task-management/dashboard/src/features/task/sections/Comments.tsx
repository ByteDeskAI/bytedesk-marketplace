import { useState } from "react";
import { Button } from "../../../components/ui/Button";
import { TextArea } from "../../../components/ui/Field";
import { Section } from "../../../components/ui/Inspector";
import { write } from "../../../lib/api";
import { useWrite } from "../../../lib/store";
import type { Task } from "../../../lib/types";
import { when } from "../shared";

/** Append-only, like `tm comment`: the store gives comments no id, so there is nothing to edit. */
export function Comments({ task }: { task: Task }) {
  const { run, pending } = useWrite();
  const [text, setText] = useState("");
  const rows = task.comments ?? [];
  return (
    <Section title={`comments · ${rows.length}`}>
      {rows.length === 0 && <p className="tm-faint">No comments yet.</p>}
      <ul className="tm-comments">
        {rows.map((c, i) => (
          <li key={`${c.ts}-${i}`} className="tm-comment">
            <div className="tm-row tm-faint" style={{ gap: "var(--tm-s2)" }}>
              <span>{c.author ?? "?"}</span>
              <span className="mono">{when(c.ts)}</span>
            </div>
            <p>{c.text}</p>
          </li>
        ))}
      </ul>
      <form
        className="tm-stack"
        style={{ gap: "var(--tm-s2)" }}
        onSubmit={(e) => {
          e.preventDefault();
          const t = text.trim();
          if (t) void run(() => write.comment(task.id, t)).then(() => setText(""));
        }}
      >
        <TextArea value={text} rows={2} placeholder="add a note — comments are append-only" aria-label="new comment" onChange={(e) => setText(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) (e.currentTarget.form as HTMLFormElement).requestSubmit(); }} />
        <div className="tm-row"><span className="tm-grow" /><Button size="sm" type="submit" disabled={!text.trim()} pending={pending}>Comment</Button></div>
      </form>
    </Section>
  );
}
