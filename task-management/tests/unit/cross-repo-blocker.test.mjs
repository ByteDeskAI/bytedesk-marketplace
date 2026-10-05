/**
 * TM-381 (EP-028): an unresolved cross-repo blocker (`tm ticket --from-task`) keeps the origin task
 * out of nextTasks — and so out of `tm next` and the pool — exactly as a local blockedBy does, and
 * clearing it (the ticket's merged/done event) makes the task ready again.
 */
import { after, it } from "node:test";
import assert from "node:assert/strict";
import { cleanup, tempStore } from "./helpers.mjs";
import { create, nextTasks, update, writeConfig } from "../../lib/store.mjs";
import { addLink, removeLink } from "../../lib/issue.mjs";
import { poolable } from "../../lib/dispatch/pool.mjs";
import { why } from "../../lib/graph.mjs";

delete process.env.TM_ENFORCE;
const trash = [];
after(() => cleanup(...trash));

it("a foreign blocked-by link holds the task out of next and the pool until it is removed", () => {
  const p = tempStore();
  trash.push(p.root);
  writeConfig({ dispatch: { backends: ["fake"] } }, p);
  const epic = create("epic", { title: "e" }, "", p).id;
  const id = create("task", { title: "origin work", epic, acceptance: [{ text: "ok", done: false }] }, "context\n", p).id;
  update(id, { labels: ["ready-for-agent"] }, p);
  const ids = (rows) => rows.map((t) => t.id);
  assert.deepEqual(ids(poolable(p)), [id], "control: ready and poolable before the ticket");

  addLink(id, "blocked by", "repo-b#TM-001", p);
  assert.deepEqual(ids(nextTasks(p)), [], "blocked: not in nextTasks");
  assert.deepEqual(ids(poolable(p)), [], "blocked: not poolable");
  assert.equal(why(id, p).startable, false);

  removeLink(id, "blocked by", "repo-b#TM-001", p);
  assert.deepEqual(ids(nextTasks(p)), [id], "cleared: back in nextTasks");
  assert.deepEqual(ids(poolable(p)), [id], "cleared: poolable again");
});
