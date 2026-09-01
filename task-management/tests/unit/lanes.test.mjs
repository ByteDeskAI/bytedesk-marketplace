/**
 * Epic swimlanes, and the bug they exposed.
 *
 * The board's header lozenge and its burndown chart both used
 * `epics.find(e => e.status !== "done")` — "the first epic that isn't finished" — as the
 * active epic, while the store records the real answer in state.json and the board
 * payload has always carried it. With one epic the two agree. With two they do not, and
 * `firstOpenEpic` below is the old expression, kept as a test so the difference is
 * demonstrated rather than asserted.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { NO_EPIC, laneOrder, laneProgress, laneTasks, sortForLanes } from "../../dashboard/src/lib/lanes.mjs";

const epic = (id, status = "open", title = `epic ${id}`) => ({ id, title, status });
const task = (id, e, status = "open", rank) => ({ id, epic: e, status, rank });

/** Exactly what App.tsx used to compute. */
const firstOpenEpic = (epics) => epics.find((e) => e.status !== "done")?.id ?? null;

describe("the active epic", () => {
  it("differs from the first open epic as soon as there are two", () => {
    const epics = [epic("EP-001"), epic("EP-002")];
    const tasks = [task("TM-1", "EP-001"), task("TM-2", "EP-002")];

    // The store says EP-002 is active. The old expression says EP-001.
    assert.equal(firstOpenEpic(epics), "EP-001");
    assert.equal(laneOrder(epics, tasks, "EP-002")[0].id, "EP-002", "the lane order follows the store, not the file order");
  });

  it("puts the active epic first even when a closed one sorts before it", () => {
    const epics = [epic("EP-001", "done"), epic("EP-002"), epic("EP-003")];
    const tasks = [task("TM-1", "EP-001", "done"), task("TM-2", "EP-002"), task("TM-3", "EP-003")];

    assert.deepEqual(
      laneOrder(epics, tasks, "EP-003").map((l) => l.id),
      ["EP-003", "EP-002", "EP-001"],
      "active first, then open by id, then closed",
    );
  });

  it("marks exactly one lane active", () => {
    const epics = [epic("EP-001"), epic("EP-002")];
    const tasks = [task("TM-1", "EP-001"), task("TM-2", "EP-002")];
    assert.equal(laneOrder(epics, tasks, "EP-002").filter((l) => l.active).length, 1);
  });

  it("marks none active when the store has no active epic", () => {
    const epics = [epic("EP-001")];
    assert.equal(laneOrder(epics, [task("TM-1", "EP-001")], null).filter((l) => l.active).length, 0);
  });
});

describe("laneOrder", () => {
  it("carries decision:map onto the lane so the header can chip it", () => {
    const epics = [{ id: "EP-001", title: "a map", status: "open", labels: ["decision:map"] }];
    const lanes = laneOrder(epics, [task("TM-1", "EP-001")], "EP-001");
    assert.deepEqual(lanes[0].labels, ["decision:map"]);
  });

  it("shows the active epic even with no tasks in it yet", () => {
    // A freshly opened epic is exactly when you want to see the lane to drop work into.
    const lanes = laneOrder([epic("EP-001"), epic("EP-002")], [task("TM-1", "EP-001")], "EP-002");
    assert.ok(lanes.some((l) => l.id === "EP-002"));
  });

  it("hides an empty epic that is not active, rather than padding the board", () => {
    const lanes = laneOrder([epic("EP-001"), epic("EP-002")], [task("TM-1", "EP-001")], "EP-001");
    assert.deepEqual(lanes.map((l) => l.id), ["EP-001"]);
  });

  it("gives unfiled work its own lane, last", () => {
    const lanes = laneOrder([epic("EP-001")], [task("TM-1", "EP-001"), task("TM-2", null)], "EP-001");
    assert.deepEqual(lanes.map((l) => l.id), ["EP-001", NO_EPIC]);
  });

  it("omits the unfiled lane when everything is filed", () => {
    const lanes = laneOrder([epic("EP-001")], [task("TM-1", "EP-001")], "EP-001");
    assert.ok(!lanes.some((l) => l.id === NO_EPIC));
  });

  it("keeps work visible when its epic does not exist, and says the epic is missing", () => {
    // tm doctor calls this orphan-epic. Dropping the lane would hide real tasks
    // behind a data fault.
    const lanes = laneOrder([epic("EP-001")], [task("TM-1", "EP-001"), task("TM-9", "EP-404")], "EP-001");
    const orphan = lanes.find((l) => l.id === "EP-404");
    assert.ok(orphan, "the tasks still have to appear somewhere");
    assert.equal(orphan.status, "missing");
  });

  it("returns nothing for an empty board", () => {
    assert.deepEqual(laneOrder([], [], null), []);
  });
});

describe("laneTasks", () => {
  const tasks = [task("TM-1", "EP-001"), task("TM-2", "EP-002"), task("TM-3", null)];

  it("selects by epic", () => {
    assert.deepEqual(laneTasks(tasks, "EP-001").map((t) => t.id), ["TM-1"]);
  });

  it("selects the unfiled ones for the no-epic lane", () => {
    assert.deepEqual(laneTasks(tasks, NO_EPIC).map((t) => t.id), ["TM-3"]);
  });
});

describe("laneProgress", () => {
  it("counts done against total", () => {
    const rows = [task("TM-1", "E", "done"), task("TM-2", "E", "open"), task("TM-3", "E", "done")];
    assert.deepEqual(laneProgress(rows), { done: 2, total: 3, fraction: 2 / 3 });
  });

  it("does not divide by zero on an empty lane", () => {
    assert.deepEqual(laneProgress([]), { done: 0, total: 0, fraction: 0 });
  });

  it("reads 1 when everything is done", () => {
    assert.equal(laneProgress([task("TM-1", "E", "done")]).fraction, 1);
  });
});

describe("sortForLanes", () => {
  it("orders by lane first, so a status column reads down the screen", () => {
    // The keyboard walks the same five status columns whether or not the board is
    // grouped. If the sort did not put lanes in order, `j` would hop between them.
    const epics = [epic("EP-001"), epic("EP-002")];
    const tasks = [task("TM-1", "EP-001"), task("TM-2", "EP-002"), task("TM-3", "EP-001")];
    const lanes = laneOrder(epics, tasks, "EP-002");

    assert.deepEqual(
      sortForLanes(tasks, lanes).map((t) => t.id),
      ["TM-2", "TM-1", "TM-3"],
      "EP-002 is active so its lane is first",
    );
  });

  it("keeps rank order inside a lane", () => {
    const epics = [epic("EP-001")];
    const tasks = [task("TM-1", "EP-001", "open", 3000), task("TM-2", "EP-001", "open", 1000)];
    const lanes = laneOrder(epics, tasks, "EP-001");

    assert.deepEqual(sortForLanes(tasks, lanes).map((t) => t.id), ["TM-2", "TM-1"]);
  });

  it("falls back to id order for unranked cards, matching the flat board", () => {
    const epics = [epic("EP-001")];
    const tasks = [task("TM-2", "EP-001"), task("TM-1", "EP-001")];
    const lanes = laneOrder(epics, tasks, "EP-001");

    assert.deepEqual(sortForLanes(tasks, lanes).map((t) => t.id), ["TM-1", "TM-2"]);
  });

  it("puts a task whose lane is unknown at the end instead of dropping it", () => {
    const lanes = laneOrder([epic("EP-001")], [task("TM-1", "EP-001")], "EP-001");
    const tasks = [task("TM-9", "EP-404"), task("TM-1", "EP-001")];

    assert.deepEqual(sortForLanes(tasks, lanes).map((t) => t.id), ["TM-1", "TM-9"]);
  });

  it("does not mutate the array it is given", () => {
    const tasks = [task("TM-2", "EP-001"), task("TM-1", "EP-001")];
    const lanes = laneOrder([epic("EP-001")], tasks, "EP-001");
    sortForLanes(tasks, lanes);
    assert.deepEqual(tasks.map((t) => t.id), ["TM-2", "TM-1"], "the caller's order is the caller's");
  });
});
