import { X } from "lucide-react";
import { useState } from "react";
import { Button } from "../../../components/ui/Button";
import { Checkbox } from "../../../components/ui/Checkbox";
import { TextField } from "../../../components/ui/Field";
import { Section } from "../../../components/ui/Inspector";
import { write } from "../../../lib/api";
import { useWrite } from "../../../lib/store";
import type { Task } from "../../../lib/types";

/** The done gate, editable both ways: a tick can be untaken, a criterion removed (renumbers the rest). */
export function Acceptance({ task }: { task: Task }) {
  const { run } = useWrite();
  const [text, setText] = useState("");
  const rows = task.acceptance ?? [];
  const met = rows.filter((a) => a.done).length;
  return (
    <Section title={`acceptance criteria · ${met}/${rows.length}`}>
      {rows.length === 0 && <p className="tm-faint">None yet — `tm done` refuses a task with no criteria.</p>}
      <ul className="tm-ac">
        {rows.map((a, i) => (
          <li key={`${i}-${a.text}`} className="tm-ac__row">
            <Checkbox
              checked={Boolean(a.done)}
              strike
              onChange={(v) => void run(() => write.accept(task.id, i + 1, { done: v }), { optimistic: { id: task.id, patch: { acceptance: rows.map((r, j) => (j === i ? { ...r, done: v } : r)) } } })}
            >
              {a.text}
            </Checkbox>
            <Button variant="ghost" size="sm" icon={<X size={14} />} aria-label={`remove criterion ${i + 1}`} title="remove — renumbers the ones after it" onClick={() => void run(() => write.accept(task.id, i + 1, { remove: true }))} />
          </li>
        ))}
      </ul>
      <form
        className="tm-row"
        onSubmit={(e) => {
          e.preventDefault();
          const t = text.trim();
          if (!t) return;
          void run(() => write.ac(task.id, t)).then(() => setText(""));
        }}
      >
        <TextField value={text} placeholder="add a criterion" aria-label="new acceptance criterion" onChange={(e) => setText(e.target.value)} className="tm-grow" />
        <Button size="sm" type="submit" disabled={!text.trim()}>Add</Button>
      </form>
    </Section>
  );
}
