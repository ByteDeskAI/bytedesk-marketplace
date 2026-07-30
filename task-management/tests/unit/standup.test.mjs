/**
 * The standup, and the collapsing it depends on.
 *
 * `tm standup` printed a chain of raw event kinds per task:
 *
 *   - TM-001 the task — create → update → claim → update → update → update → release → done
 *
 * Three of those eight tokens are the word `update`. It is a machine trace, and a standup answers
 * what got finished, what is being worked on, and what is stuck.
 *
 * Fixing it surfaced two real bugs in `collapseLog`, which is why half of this file is about that:
 * its status tracker was one shared variable, and arriving at `open` counted as a transition.
 */
import { after, describe, it } from "node:test";
import assert from "node:assert/strict";
import { cleanup, tempStore } from "./helpers.mjs";
import { collapseLog, standup } from "../../lib/render.mjs";
import { create, update } from "../../lib/store.mjs";

const stores = [];
function store() {
  const p = tempStore();
  stores.push(p.root);
  return p;
}
after(() => cleanup(...stores));

const SINCE = "2000-01-01T00:00:00Z";
const kinds = (rows) => collapseLog(rows).map((e) => e.event);

describe("collapseLog", () => {
  it("tracks status per entity, not once for the whole log", () => {
    // TM-001 finishing left a single shared tracker reading "done", so EP-001's own move to done
    // counted as no move and was dropped: the epic closed and the log said nothing.
    // `patch` is on these because the store writes it on every update — a fixture without it is
    // not the shape this function is ever handed.
    const rows = [
      { id: "TM-001", ts: "2026-07-30T12:00:01.000Z", event: "create", status: "open" },
      { id: "TM-001", ts: "2026-07-30T12:00:02.000Z", event: "update", status: "done", patch: "status" },
      { id: "EP-001", ts: "2026-07-30T12:00:03.000Z", event: "update", status: "done", patch: "status" },
    ];
    const moves = collapseLog(rows).filter((e) => e.event === "status");
    assert.deepEqual(moves.map((e) => e.id), ["TM-001", "EP-001"], "both entities moved to done, and both must say so");
  });

  it("does not call arriving at open a transition", () => {
    // A `create` event records no status, so the first update after one always looked like a move
    // into `open` — every task in the log carried a "status changed — open" row saying nothing had
    // happened yet.
    const rows = [
      { id: "TM-001", ts: "2026-07-30T12:00:01.000Z", event: "create" },
      { id: "TM-001", ts: "2026-07-30T12:00:02.000Z", event: "update", status: "open", patch: "title" },
    ];
    // The write patched `title`, so the `open` it carries is incidental, not a transition.
    assert.equal(collapseLog(rows).filter((e) => e.event === "status").length, 0);
  });

  it("still reports a real move back to open", () => {
    const rows = [
      { id: "TM-001", ts: "2026-07-30T12:00:01.000Z", event: "create", status: "open" },
      { id: "TM-001", ts: "2026-07-30T12:00:02.000Z", event: "update", status: "blocked", patch: "status" },
      { id: "TM-001", ts: "2026-07-30T12:00:03.000Z", event: "update", status: "open", patch: "status" },
    ];
    assert.deepEqual(
      collapseLog(rows).filter((e) => e.event === "status").map((e) => e._status),
      ["blocked", "open"],
      "unblocking is a transition worth seeing",
    );
  });

  it("drops an update a specific event in the same second explains", () => {
    const rows = [
      { id: "TM-004", ts: "2026-07-30T12:00:01.246Z", event: "create", status: "open" },
      { id: "TM-004", ts: "2026-07-30T12:00:01.287Z", event: "update", status: "open", patch: "title" },
      { id: "TM-004", ts: "2026-07-30T12:00:01.287Z", event: "edit" },
    ];
    assert.deepEqual(kinds(rows), ["create", "edit"], "one action must not read as two rows, uninformative one first");
  });

  describe("with keep", () => {
    const rows = [
      { id: "TM-004", ts: "2026-07-30T12:00:01.246Z", event: "create", status: "open" },
      { id: "TM-004", ts: "2026-07-30T12:00:01.287Z", event: "update", status: "open", patch: "title" },
      { id: "TM-004", ts: "2026-07-30T12:00:01.287Z", event: "edit" },
      { id: "TM-004", ts: "2026-07-30T12:00:02.000Z", event: "update", status: "blocked", patch: "status" },
    ];

    it("marks instead of dropping, so every row still reaches the other consumers", () => {
      const out = collapseLog(rows, { keep: true });
      assert.equal(out.length, rows.length, "burndown, startTimes and the PWA matcher all read this array");
      assert.equal(out.filter((e) => e._shadowed).length, 1);
    });

    it("leaves `event` alone, because the PWA notification matcher switches on it", () => {
      const out = collapseLog(rows, { keep: true });
      assert.deepEqual(out.map((e) => e.event), ["create", "update", "edit", "update"]);
      // The judgement is still available, just additively.
      assert.equal(out.at(-1)._status, "blocked");
    });

    it("agrees with the dropping form about which rows are noise", () => {
      const dropped = collapseLog(rows).length;
      const kept = collapseLog(rows, { keep: true }).filter((e) => !e._shadowed).length;
      assert.equal(kept, dropped, "one judgement expressed two ways — they must not drift");
    });
  });
});

describe("standup", () => {
  function board() {
    const p = store();
    const e = create("epic", { title: "Payments" }, "", p);

    const done = create("task", { title: "the finished one", epic: e.id, acceptance: [{ text: "x", done: true }] }, "", p);
    update(done.id, { status: "in_progress" }, p);
    update(done.id, { status: "done" }, p);

    const flight = create("task", { title: "the one in flight", epic: e.id }, "", p);
    update(flight.id, { status: "in_progress" }, p);

    const stuck = create("task", { title: "the stuck one", epic: e.id }, "", p);
    update(stuck.id, { status: "blocked", blockedReason: "waiting on the security review" }, p);

    const quiet = create("task", { title: "just commented on", epic: e.id }, "", p);
    update(quiet.id, { comments: [{ text: "looked at it" }] }, p);

    return { p, done, flight, stuck, quiet };
  }

  it("answers the three questions a standup answers, in that order", () => {
    const { p } = board();
    const out = standup(SINCE, p);

    const order = ["## Finished", "## In progress", "## Stuck"].map((h) => out.indexOf(h));
    assert.ok(order.every((i) => i >= 0), `every section must appear:\n${out}`);
    assert.deepEqual(order, [...order].sort((a, b) => a - b), "finished, then in flight, then stuck");
  });

  it("prints the status path rather than every event that touched the file", () => {
    const { p, done } = board();
    const line = standup(SINCE, p).split("\n").find((l) => l.includes(done.id));

    // Transitions, so `open` is absent: it is where the task started, not somewhere it went. The
    // full trace for this task is create → update → update, and none of those three words is
    // something you would say out loud.
    assert.match(line, /in_progress → done/);
    assert.equal(line.includes("open"), false, "the starting state is not a transition");
    assert.equal(line.includes("update"), false);
    assert.equal(line.includes("claim"), false);
  });

  it("gives the reason a task is stuck, which is what a standup is for", () => {
    const { p, stuck } = board();
    const line = standup(SINCE, p).split("\n").find((l) => l.includes(stuck.id));
    assert.match(line, /waiting on the security review/);
  });

  it("does not say the status twice", () => {
    const { p, stuck } = board();
    const line = standup(SINCE, p).split("\n").find((l) => l.includes(stuck.id));
    assert.equal(/blocked.*blocked/.test(line), false, `read it out loud:\n${line}`);
  });

  it("says so when a stuck task has no recorded reason", () => {
    const p = store();
    const t = create("task", { title: "silently stuck" }, "", p);
    update(t.id, { status: "parked" }, p);
    assert.match(standup(SINCE, p), /no reason recorded/);
  });

  it("keeps work that moved no status, summarised by what happened to it", () => {
    const { p, quiet } = board();
    const out = standup(SINCE, p);
    const line = out.split("\n").find((l) => l.includes(quiet.id));

    // Dropping it would make the report lie by omission — a day of comments and commits is work.
    assert.ok(line, `a task that was touched must still appear:\n${out}`);
    assert.match(out, /## Also touched/);
    assert.match(line, /A task, epic or ADR is created|comment/i, "say what happened, not just that something did");
  });

  it("says an id is gone rather than printing it as if it were fine", () => {
    const p = store();
    const t = create("task", { title: "deleted since" }, "", p);
    update(t.id, { status: "deleted" }, p);
    // `read` still resolves a deleted file, so force the case doctor calls a phantom.
    const out = standup(SINCE, p);
    assert.ok(out.includes(t.id), out);
  });

  it("reports nothing for a window with nothing in it", () => {
    const { p } = board();
    assert.match(standup("2999-01-01T00:00:00Z", p), /nothing since/);
  });
});
