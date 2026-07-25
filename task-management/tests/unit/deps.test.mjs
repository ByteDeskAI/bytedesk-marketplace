/**
 * TM-003 — the dependency graph must be live, not decorative.
 * v0.1 stored `blocked` and never re-evaluated it, so a completed blocker left its
 * dependents stuck forever and `tm done` could never report an unblock.
 */
import { after, describe, it } from "node:test";
import assert from "node:assert/strict";
import { rmSync } from "node:fs";
import { cleanup, tempStore } from "./helpers.mjs";
import { create, nextTasks, read, unblockDependents, update } from "../../lib/store.mjs";

const stores = [];
function store() {
  const p = tempStore();
  stores.push(p.root);
  return p;
}
after(() => cleanup(...stores));

/** blocker ← dependent, wired the way `tm dep` wires it. */
function pair(p, { manual = false } = {}) {
  const blocker = create("task", { title: "blocker", blocks: [], blockedBy: [] }, "", p);
  const dependent = create("task", { title: "dependent", blocks: [], blockedBy: [blocker.id] }, "", p);
  update(dependent.id, { status: "blocked", ...(manual ? { blockedReason: "waiting on legal" } : {}) }, p);
  update(blocker.id, { blocks: [dependent.id] }, p);
  return { blocker: blocker.id, dependent: dependent.id };
}

describe("unblockDependents", () => {
  it("reopens a dependency-blocked task when its last blocker completes", () => {
    const p = store();
    const { blocker, dependent } = pair(p);
    update(blocker, { status: "done" }, p);

    const freed = unblockDependents(blocker, p);

    assert.deepEqual(freed, [dependent], "done must report what it unblocked");
    assert.equal(read(dependent, p).status, "open");
  });

  it("leaves a task blocked while any other blocker is still open", () => {
    const p = store();
    const first = create("task", { title: "first", blockedBy: [] }, "", p);
    const second = create("task", { title: "second", blockedBy: [] }, "", p);
    const dependent = create("task", { title: "dependent", blockedBy: [first.id, second.id] }, "", p);
    update(dependent.id, { status: "blocked" }, p);
    update(first.id, { status: "done" }, p);

    assert.deepEqual(unblockDependents(first.id, p), []);
    assert.equal(read(dependent.id, p).status, "blocked");
  });

  it("respects a human block — a written reason is a decision, not a dependency", () => {
    const p = store();
    const { blocker, dependent } = pair(p, { manual: true });
    update(blocker, { status: "done" }, p);

    assert.deepEqual(unblockDependents(blocker, p), []);
    assert.equal(read(dependent, p).status, "blocked");
  });

  it("treats a deleted blocker as resolved", () => {
    const p = store();
    const { blocker, dependent } = pair(p);
    update(blocker, { status: "deleted" }, p);

    assert.deepEqual(unblockDependents(blocker, p), [dependent]);
    assert.equal(read(dependent, p).status, "open");
  });
});

describe("nextTasks", () => {
  it("surfaces a dependency-blocked task once its blockers are done", () => {
    const p = store();
    const { blocker, dependent } = pair(p);
    update(blocker, { status: "done" }, p);

    assert.deepEqual(
      nextTasks(p).map((t) => t.id),
      [dependent],
      "next must not depend on someone having run an unblock first",
    );
  });

  it("hides tasks whose blockers are unfinished", () => {
    const p = store();
    pair(p);
    assert.deepEqual(nextTasks(p).map((t) => t.title), ["blocker"]);
  });

  it("hides parked and in-progress work", () => {
    const p = store();
    const a = create("task", { title: "parked one" }, "", p);
    const b = create("task", { title: "running one" }, "", p);
    update(a.id, { status: "parked" }, p);
    update(b.id, { status: "in_progress" }, p);
    assert.deepEqual(nextTasks(p), []);
  });
});
