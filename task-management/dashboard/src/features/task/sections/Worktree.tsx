import { useState } from "react";
import { Button } from "../../../components/ui/Button";
import { Section } from "../../../components/ui/Inspector";
import { Modal } from "../../../components/ui/Modal";
import { Toggle } from "../../../components/ui/Toggle";
import { write } from "../../../lib/api";
import { useWrite } from "../../../lib/store";
import type { Task } from "../../../lib/types";

/** Branch and checkout for this task. Remove asks first: a dirty worktree is work. */
export function Worktree({ task }: { task: Task }) {
  const { run, pending, error } = useWrite();
  const [confirm, setConfirm] = useState(false);
  const [force, setForce] = useState(false);
  return (
    <Section
      title="worktree"
      actions={
        task.worktree ? (
          <Button size="sm" variant="ghost" onClick={() => setConfirm(true)}>Remove</Button>
        ) : (
          <Button size="sm" pending={pending} onClick={() => void run(() => write.worktree(task.id, "create"), { ok: `worktree created for ${task.id}` })}>Create worktree</Button>
        )
      }
    >
      {task.branch || task.worktree ? (
        <dl className="tm-kv">
          {task.branch && <><dt>branch</dt><dd className="mono">{task.branch}</dd></>}
          {task.worktree && <><dt>path</dt><dd className="mono">{task.worktree}</dd></>}
          {task.session && <><dt>session</dt><dd className="mono tm-truncate">{task.session}</dd></>}
        </dl>
      ) : (
        <p className="tm-faint">no worktree — `tm worktree new {task.id}` makes an isolated checkout with node_modules shared</p>
      )}
      {error && <p className="tm-reason" data-tone="bad">{error}</p>}
      <Modal
        open={confirm}
        onClose={() => setConfirm(false)}
        title={`Remove the worktree for ${task.id}?`}
        footer={
          <>
            <Button variant="ghost" onClick={() => setConfirm(false)}>Keep it</Button>
            <Button variant="danger" pending={pending} onClick={() => void run(() => write.worktree(task.id, "remove", force), { ok: `worktree removed` }).then(() => setConfirm(false))}>Remove</Button>
          </>
        }
      >
        <div className="tm-stack">
          <p className="tm-muted">Shared node_modules are unlinked first; the branch stays. A checkout with uncommitted changes is refused unless you force it.</p>
          <Toggle checked={force} onChange={setForce}>Force — discard uncommitted changes in the worktree</Toggle>
        </div>
      </Modal>
    </Section>
  );
}
