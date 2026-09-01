/**
 * Batches of work that can safely run at once: unblocked, unclaimed, and touching disjoint paths.
 *
 * Lifted out of `bin/tm parallel` so `GET /api/parallel` and `tm_parallel` batch on the same
 * rule. Greedy first-fit: a task joins the first batch whose touches it does not collide with.
 * ponytail: O(batches × touches) per task; a bin-packing pass if boards grow past hundreds of
 * startable tasks, which `tm next` already caps in practice.
 */
import { claimant } from "./claims.mjs";
import { paths } from "./paths.mjs";
import { nextTasks } from "./store.mjs";

export function batches({ epic = null } = {}, p = paths()) {
  const candidates = nextTasks(p)
    .filter((t) => !epic || t.epic === epic)
    .filter((t) => !claimant(t.id, p));

  const out = [];
  for (const task of candidates) {
    const touches = new Set(task.touches || []);
    const batch = out.find((b) => !b.touches.size || !touches.size || ![...touches].some((x) => b.touches.has(x)));
    if (batch) {
      batch.tasks.push(task);
      for (const x of touches) batch.touches.add(x);
    } else {
      out.push({ tasks: [task], touches: new Set(touches) });
    }
  }
  return out.map((b) => ({ tasks: b.tasks.map((t) => ({ id: t.id, title: t.title })), touches: [...b.touches] }));
}
