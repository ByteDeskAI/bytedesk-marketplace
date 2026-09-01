import { X } from "lucide-react";
import { useState } from "react";
import { Button } from "../../../components/ui/Button";
import { Select } from "../../../components/ui/Field";
import { Section } from "../../../components/ui/Inspector";
import { write } from "../../../lib/api";
import { Link } from "../../../lib/router";
import { routeForId } from "../../../app/routes";
import { useBoard, useMeta, useWrite } from "../../../lib/store";
import type { Task } from "../../../lib/types";
import { FALLBACK } from "../shared";

/** Typed links, written on both ends by the store; removing one drops both. */
export function Links({ task }: { task: Task }) {
  const board = useBoard();
  const meta = useMeta();
  const { run } = useWrite();
  const types = meta?.vocab.linkTypes ? Object.keys(meta.vocab.linkTypes) : FALLBACK.linkTypes;
  const [type, setType] = useState(types[0]);
  const targets = [...(board?.tasks ?? []).filter((t) => t.id !== task.id), ...(board?.adrs ?? [])];
  const links = task.links ?? [];
  const commits = task.commits ?? [];
  return (
    <Section title="links">
      {links.length === 0 && commits.length === 0 && <p className="tm-faint">no links</p>}
      <ul className="tm-links">
        {links.map((l) => (
          <li key={`${l.type}-${l.id}`} className="tm-links__row">
            <span className="tm-muted">{l.type}</span>
            <Link to={routeForId(l.id) ?? "#"} inspector className="mono">{l.id}</Link>
            <span className="tm-grow" />
            <Button variant="ghost" size="sm" icon={<X size={14} />} aria-label={`remove link ${l.type} ${l.id}`} title="remove from both ends" onClick={() => void run(() => write.unlink(task.id, l.type, l.id))} />
          </li>
        ))}
        {commits.map((c) => (
          <li key={c} className="tm-links__row">
            <span className="tm-muted">{/^https?:/.test(c) ? "pr" : "commit"}</span>
            {/^https?:/.test(c) ? <a href={c} target="_blank" rel="noreferrer" className="mono tm-truncate">{c}</a> : <span className="mono">{c}</span>}
          </li>
        ))}
      </ul>
      <div className="tm-row">
        <Select value={type} aria-label="link type" options={types.map((t) => ({ value: t, label: t }))} onChange={(e) => setType(e.target.value)} />
        <Select value="" placeholder="task or ADR…" aria-label="link target" className="tm-grow" options={targets.map((t) => ({ value: t.id, label: `${t.id} ${t.title}` }))} onChange={(e) => e.target.value && void run(() => write.link(task.id, type, e.target.value))} />
      </div>
    </Section>
  );
}
