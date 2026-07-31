/**
 * The order of the queue.
 *
 * `priority` and `rank` were both writable and neither was ever read. `nextTasks` filtered and
 * returned whatever order `list` gave it, which is id order — so a task set to `highest` and
 * dragged to the top of the backlog still came second behind an untouched `low` one. Since
 * `tm next` is what the README, the SessionStart block and the `tm_next` tool all point an
 * agent at, priority could not influence what any agent picked up.
 *
 * `queueOrder` is asserted directly on plain objects, because a comparator is a pure function
 * and the interesting cases are combinations of two sparse fields; `nextTasks` is asserted
 * through the store, because the point of sorting inside it is that its five callers get the
 * order without asking.
 */
import { after, describe, it } from "node:test";
import assert from "node:assert/strict";
import { cleanup, tempStore } from "./helpers.mjs";
import { PRIORITIES, create, nextTasks, queueOrder, update } from "../../lib/store.mjs";

const stores = [];
function store() {
  const p = tempStore();
  stores.push(p.root);
  return p;
}
after(() => cleanup(...stores));

const ids = (tasks) => queueOrder(tasks).map((t) => t.id);
const task = (id, extra = {}) => ({ id, title: id, status: "open", ...extra });

describe("priority, where nothing is ranked", () => {
  it("puts the urgent one first even though its id is last", () => {
    assert.deepEqual(
      ids([task("TM-001", { priority: "low" }), task("TM-002", { priority: "highest" })]),
      ["TM-002", "TM-001"],
      "id order is creation order, which is not a statement about importance",
    );
  });

  it("orders the whole ladder", () => {
    const shuffled = ["low", "highest", "lowest", "high", "medium"].map((pri, i) => task(`TM-00${i + 1}`, { priority: pri }));
    assert.deepEqual(
      queueOrder(shuffled).map((t) => t.priority),
      PRIORITIES,
      "the vocabulary is already in order; the sort must agree with it",
    );
  });

  it("reads an unset priority as medium rather than as urgent or as last", () => {
    const rows = [task("TM-001", { priority: "high" }), task("TM-002"), task("TM-003", { priority: "low" })];
    assert.deepEqual(ids(rows), ["TM-001", "TM-002", "TM-003"]);
  });

  it("ignores a priority that is not in the vocabulary", () => {
    // A hand edit can write anything. Treating an unrecognised value as urgent would let a
    // typo jump the queue.
    const rows = [task("TM-001", { priority: "URGENT!!" }), task("TM-002", { priority: "high" })];
    assert.deepEqual(ids(rows), ["TM-002", "TM-001"]);
  });
});

describe("rank", () => {
  it("beats priority, because a rank is a deliberate placement and a priority is a label", () => {
    const rows = [task("TM-001", { rank: 500 }), task("TM-002", { priority: "highest" })];
    assert.deepEqual(ids(rows), ["TM-001", "TM-002"]);
  });

  it("puts everything ranked ahead of everything unranked", () => {
    // Not interleaved by list position: a fallback rank would give every task a distinct
    // pseudo-rank, and priority as a tiebreaker on values that are never tied is priority
    // that still does nothing.
    const rows = [
      task("TM-001", { priority: "highest" }),
      task("TM-002", { rank: 9000 }),
      task("TM-003", { priority: "high" }),
      task("TM-004", { rank: 1000 }),
    ];
    assert.deepEqual(ids(rows), ["TM-004", "TM-002", "TM-001", "TM-003"]);
  });

  it("orders the ranked among themselves by rank, and falls back to priority only inside a tie", () => {
    const rows = [
      task("TM-001", { rank: 1000, priority: "lowest" }),
      task("TM-002", { rank: 1000, priority: "highest" }),
      task("TM-003", { rank: 500 }),
    ];
    assert.deepEqual(ids(rows), ["TM-003", "TM-002", "TM-001"]);
  });

  it("handles the fractional ranks that placing a card between two others produces", () => {
    const rows = [task("TM-001", { rank: 1000 }), task("TM-002", { rank: 1500 }), task("TM-003", { rank: 1250 })];
    assert.deepEqual(ids(rows), ["TM-001", "TM-003", "TM-002"]);
  });

  it("does not read rank 0 as absent", () => {
    // `rank ?? fallback` is correct and `rank || fallback` is not; 0 is a legitimate rank and
    // the top of the queue is exactly where it would be.
    const rows = [task("TM-001", { priority: "highest" }), task("TM-002", { rank: 0 })];
    assert.deepEqual(ids(rows), ["TM-002", "TM-001"]);
  });
});

describe("the order is total", () => {
  it("breaks a full tie on id, so the same board never renders two ways", () => {
    const rows = [task("TM-003"), task("TM-001"), task("TM-002")];
    assert.deepEqual(ids(rows), ["TM-001", "TM-002", "TM-003"]);
  });

  it("gives the same answer whichever order it is handed", () => {
    const rows = [
      task("TM-001", { priority: "low" }),
      task("TM-002", { rank: 200 }),
      task("TM-003", { priority: "highest" }),
      task("TM-004", { rank: 100 }),
      task("TM-005"),
    ];
    const forward = ids(rows);
    assert.deepEqual(ids([...rows].reverse()), forward, "an unstable queue is a second source of flake");
    assert.deepEqual(forward, ["TM-004", "TM-002", "TM-003", "TM-005", "TM-001"]);
  });

  it("does not mutate what it was given", () => {
    const rows = [task("TM-002"), task("TM-001")];
    queueOrder(rows);
    assert.deepEqual(rows.map((t) => t.id), ["TM-002", "TM-001"], "sorting a caller's array in place is a side effect nobody asked for");
  });
});

describe("nextTasks", () => {
  it("hands its five callers the order without any of them asking", () => {
    const p = store();
    const e = create("epic", { title: "epic" }, "", p);
    const low = create("task", { title: "aaa low thing", epic: e.id, priority: "low" }, "", p);
    const urgent = create("task", { title: "zzz the urgent one", epic: e.id, priority: "highest" }, "", p);

    assert.deepEqual(
      nextTasks(p).map((t) => t.id),
      [urgent.id, low.id],
      `${urgent.id} is the one to pick up, and it has the later id`,
    );
  });

  it("follows a task that gets re-prioritised", () => {
    const p = store();
    const e = create("epic", { title: "epic" }, "", p);
    const first = create("task", { title: "first", epic: e.id }, "", p);
    const second = create("task", { title: "second", epic: e.id }, "", p);

    assert.deepEqual(nextTasks(p).map((t) => t.id), [first.id, second.id]);
    update(second.id, { priority: "highest" }, p);
    assert.deepEqual(nextTasks(p).map((t) => t.id), [second.id, first.id], "the field has to be read on every call, not at create time");
  });
});
