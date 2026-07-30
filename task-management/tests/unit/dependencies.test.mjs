/**
 * Dependencies, as a lib function rather than two inline mutates in the CLI.
 *
 * Before this, `issue.mjs` owned assignee, labels, priority, estimate, comments, links, subtasks
 * and rank — and had zero occurrences of `blockedBy`. Three consequences, all of them real:
 * the dashboard rendered `⊘ TM-002` on a card with no route to change it, nothing logged an event
 * so a dependency appearing was invisible in `tm log <id>`, and there was NO way to remove one —
 * doctor could drop a dangling reference, but a valid dependency added by mistake was permanent.
 */
import { after, describe, it } from "node:test";
import assert from "node:assert/strict";
import { cleanup, tempStore } from "./helpers.mjs";
import { create, read, readEvents, unblockDependents, update } from "../../lib/store.mjs";
import { dependencies } from "../../lib/issue.mjs";

const stores = [];
function store() {
  const p = tempStore();
  stores.push(p.root);
  return p;
}
after(() => cleanup(...stores));

const task = (p, title) => create("task", { title, blockedBy: [], blocks: [] }, "", p).id;

describe("adding", () => {
  it("writes both ends, because a one-sided edge is invisible from the other", () => {
    const p = store();
    const a = task(p, "dependent");
    const b = task(p, "blocker");

    dependencies(a, { add: [b] }, p);

    assert.deepEqual(read(a, p).blockedBy, [b]);
    assert.deepEqual(read(b, p).blocks, [a], "doctor reports a one-sided edge as a fault");
  });

  it("blocks open work, and leaves any other status alone", () => {
    const p = store();
    const b = task(p, "blocker");
    const open = task(p, "open one");
    const running = task(p, "running one");
    update(running, { status: "in_progress" }, p);

    dependencies(open, { add: [b] }, p);
    dependencies(running, { add: [b] }, p);

    assert.equal(read(open, p).status, "blocked");
    assert.equal(read(running, p).status, "in_progress", "a dependency must not stop work in flight");
  });

  it("is idempotent", () => {
    const p = store();
    const a = task(p, "a");
    const b = task(p, "b");
    dependencies(a, { add: [b] }, p);
    dependencies(a, { add: [b] }, p);
    assert.deepEqual(read(a, p).blockedBy, [b]);
    assert.deepEqual(read(b, p).blocks, [a]);
  });

  it("logs an event, so a dependency change is in the audit trail", () => {
    const p = store();
    const a = task(p, "a");
    const b = task(p, "b");
    dependencies(a, { add: [b] }, p);

    const ev = readEvents(p).filter((e) => e.event === "dep");
    assert.equal(ev.length, 1);
    assert.deepEqual(ev[0].on, [b]);
  });

  it("refuses a task that does not exist", () => {
    const p = store();
    assert.throws(() => dependencies(task(p, "a"), { add: ["TM-404"] }, p), /not found/);
  });
});

describe("cycles are refused, not reported later", () => {
  // doctor finds dep-cycles and deliberately will not repair them — which edge to cut is a
  // judgement — so the cheap moment to say no is before one exists.
  it("refuses a self-dependency", () => {
    const p = store();
    const a = task(p, "a");
    assert.throws(() => dependencies(a, { add: [a] }, p), /cannot depend on itself/);
  });

  it("refuses a direct loop", () => {
    const p = store();
    const a = task(p, "a");
    const b = task(p, "b");
    dependencies(a, { add: [b] }, p);
    assert.throws(() => dependencies(b, { add: [a] }, p), /would create a cycle/);
  });

  it("refuses a loop three hops long", () => {
    const p = store();
    const a = task(p, "a");
    const b = task(p, "b");
    const c = task(p, "c");
    dependencies(a, { add: [b] }, p);
    dependencies(b, { add: [c] }, p);
    assert.throws(() => dependencies(c, { add: [a] }, p), /would create a cycle/);
  });

  it("writes nothing when it refuses", () => {
    const p = store();
    const a = task(p, "a");
    const b = task(p, "b");
    dependencies(a, { add: [b] }, p);
    assert.throws(() => dependencies(b, { add: [a] }, p));
    assert.deepEqual(read(b, p).blockedBy ?? [], [], "a refused edge must not land half-written");
    assert.deepEqual(read(a, p).blocks ?? [], []);
  });

  it("allows a diamond, which is not a cycle", () => {
    const p = store();
    const root = task(p, "root");
    const left = task(p, "left");
    const right = task(p, "right");
    const top = task(p, "top");
    dependencies(left, { add: [root] }, p);
    dependencies(right, { add: [root] }, p);
    dependencies(top, { add: [left, right] }, p);
    assert.equal(read(top, p).blockedBy.length, 2);
  });

  it("terminates on a pre-existing loop instead of spinning, and does not blame the caller", () => {
    const p = store();
    const a = task(p, "a");
    const b = task(p, "b");
    // Force a loop past the guard, as a hand edit or a merge would.
    update(a, { blockedBy: [b] }, p);
    update(b, { blockedBy: [a] }, p);
    const c = task(p, "c");

    // Walking a's chain hits the a→b→a loop. `seen` stops the walk; and c is not IN that loop,
    // so this edge is legal — refusing it would blame the caller for damage they did not do.
    // `subtasks` takes the same stance: "pre-existing loop elsewhere; not ours to fix here".
    // doctor's dep-cycle finding is what reports the a↔b loop.
    assert.deepEqual(dependencies(c, { add: [a] }, p), [a]);
  });
});

describe("removing — which did not exist at all", () => {
  it("clears both ends", () => {
    const p = store();
    const a = task(p, "a");
    const b = task(p, "b");
    dependencies(a, { add: [b] }, p);

    dependencies(a, { remove: [b] }, p);

    assert.deepEqual(read(a, p).blockedBy, []);
    assert.deepEqual(read(b, p).blocks, [], "the other end has to be cleared too");
  });

  it("logs undep", () => {
    const p = store();
    const a = task(p, "a");
    const b = task(p, "b");
    dependencies(a, { add: [b] }, p);
    dependencies(a, { remove: [b] }, p);
    assert.deepEqual(readEvents(p).filter((e) => e.event === "undep")[0].off, [b]);
  });

  it("does NOT reopen the task itself — unblockDependents owns that transition", () => {
    const p = store();
    const a = task(p, "a");
    const b = task(p, "b");
    dependencies(a, { add: [b] }, p);
    assert.equal(read(a, p).status, "blocked");

    dependencies(a, { remove: [b] }, p);

    // Two functions deciding one status is how they come to disagree. Removing the last blocker
    // leaves the status alone; unblockDependents reopens when every blocker is resolved.
    assert.equal(read(a, p).status, "blocked");
  });

  it("leaves the task startable once its blocker completes, via the existing path", () => {
    const p = store();
    const a = task(p, "a");
    const b = task(p, "b");
    dependencies(a, { add: [b] }, p);
    update(b, { status: "done" }, p);

    assert.deepEqual(unblockDependents(b, p), [a]);
    assert.equal(read(a, p).status, "open");
  });

  it("ignores a blocker that was never there", () => {
    const p = store();
    const a = task(p, "a");
    assert.deepEqual(dependencies(a, { remove: ["TM-404"] }, p), []);
  });

  it("adds and removes in one call", () => {
    const p = store();
    const a = task(p, "a");
    const b = task(p, "b");
    const c = task(p, "c");
    dependencies(a, { add: [b] }, p);
    dependencies(a, { add: [c], remove: [b] }, p);
    assert.deepEqual(read(a, p).blockedBy, [c]);
    assert.deepEqual(read(b, p).blocks, []);
  });
});
