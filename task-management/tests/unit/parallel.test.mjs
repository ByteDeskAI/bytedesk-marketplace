/** lib/parallel — the batching `tm parallel`, `/api/parallel` and `tm_parallel` share. */
import { describe, it, after } from "node:test";
import assert from "node:assert/strict";
import { cleanup, tempStore } from "./helpers.mjs";
import { batches } from "../../lib/parallel.mjs";
import { claimTask } from "../../lib/claims.mjs";
import { dependencies } from "../../lib/issue.mjs";
import { create, writeConfig } from "../../lib/store.mjs";

const stores = [];
after(() => cleanup(...stores));
const store = () => {
  const p = tempStore();
  stores.push(p.root);
  writeConfig({ requireEpic: false }, p);
  return p;
};
const task = (p, title, fields = {}) => create("task", { title, acceptance: [], ...fields }, "", p);

describe("batches", () => {
  it("puts colliding touches in different batches and untouched work anywhere", () => {
    const p = store();
    task(p, "a", { touches: ["x"] });
    task(p, "b", { touches: ["x"] });
    task(p, "c", { touches: ["y"] });
    task(p, "d");
    const out = batches({}, p);
    assert.equal(out.length, 2);
    assert.deepEqual(out[0].tasks.map((t) => t.id), ["TM-001", "TM-003", "TM-004"]);
    assert.deepEqual(out[1].tasks.map((t) => t.id), ["TM-002"]);
    assert.deepEqual(out[0].touches.sort(), ["x", "y"]);
  });
  it("skips claimed, blocked and out-of-epic work", () => {
    const p = store();
    const e = create("epic", { title: "e" }, "", p);
    const held = task(p, "held", { epic: e.id });
    claimTask(held.id, { session: "s", actor: "main", p });
    const blocker = task(p, "blocker", { epic: e.id });
    const blocked = task(p, "blocked", { epic: e.id });
    dependencies(blocked.id, { add: [blocker.id] }, p);
    task(p, "elsewhere");
    const ids = batches({ epic: e.id }, p).flatMap((b) => b.tasks.map((t) => t.id));
    assert.deepEqual(ids, [blocker.id]);
  });
});
