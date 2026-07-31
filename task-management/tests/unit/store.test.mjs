/**
 * TM-004 — every exit from `in_progress` releases the session claim.
 * TM-005 — deleted tasks stay on disk (the event log points at them) but must
 *          vanish from listings, counts, and the duplicate guard.
 */
import { after, describe, it } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { cleanup, tempStore } from "./helpers.mjs";
import { create, list, nextTasks, openTasks, release, state, update, writeState } from "../../lib/store.mjs";

const stores = [];
function store() {
  const p = tempStore();
  stores.push(p.root);
  return p;
}
after(() => cleanup(...stores));

function claimed(p, id, session = "session-a") {
  writeState({ claims: { ...state(p).claims, [id]: { session, ts: new Date().toISOString() } } }, p);
}

describe("release", () => {
  it("drops the claim and says so", () => {
    const p = store();
    const t = create("task", { title: "held" }, "", p);
    claimed(p, t.id);
    assert.equal(release(t.id, p), true);
    assert.deepEqual(state(p).claims, {});
  });

  it("is a no-op on an unclaimed task", () => {
    const p = store();
    const t = create("task", { title: "free" }, "", p);
    assert.equal(release(t.id, p), false);
  });

  it("leaves other sessions' claims alone", () => {
    const p = store();
    const mine = create("task", { title: "mine" }, "", p);
    const theirs = create("task", { title: "theirs" }, "", p);
    claimed(p, mine.id, "session-a");
    claimed(p, theirs.id, "session-b");
    release(mine.id, p);
    assert.deepEqual(Object.keys(state(p).claims), [theirs.id], "a release must not disturb a parallel session");
  });
});

describe("deleted tasks", () => {
  it("disappear from listings", () => {
    const p = store();
    const kept = create("task", { title: "kept" }, "", p);
    const gone = create("task", { title: "gone" }, "", p);
    update(gone.id, { status: "deleted" }, p);
    assert.deepEqual(list("task", {}, p).map((t) => t.id), [kept.id]);
  });

  it("are still reachable when asked for explicitly", () => {
    const p = store();
    const gone = create("task", { title: "gone" }, "", p);
    update(gone.id, { status: "deleted" }, p);
    assert.equal(list("task", { includeDeleted: true }, p).length, 1, "the file is still on disk and the audit log points at it");
    assert.equal(list("task", { status: "deleted" }, p).length, 1);
  });

  it("do not count toward open work or next", () => {
    const p = store();
    const gone = create("task", { title: "gone" }, "", p);
    update(gone.id, { status: "deleted" }, p);
    assert.deepEqual(openTasks(p), []);
    assert.deepEqual(nextTasks(p), []);
  });

  it("do not hold up an epic's completion count", () => {
    const p = store();
    const done = create("task", { title: "finished", epic: "EP-001" }, "", p);
    const gone = create("task", { title: "abandoned", epic: "EP-001" }, "", p);
    update(done.id, { status: "done" }, p);
    update(gone.id, { status: "deleted" }, p);
    const kids = list("task", { epic: "EP-001" }, p);
    assert.equal(kids.length, 1, "a deleted child must not sit in the denominator forever");
    assert.equal(kids.filter((t) => t.status === "done").length, 1);
  });
});

/**
 * A fresh clone must run as the committer's checkout did. state.json is gitignored — it holds
 * claims and overrides, which are per-machine — so anything shared that lands there is lost on
 * clone, silently: the board renders fine and the next task is created under no epic.
 */
describe("shared state survives a clone", () => {
  it("keeps activeEpic in the committed config, not in state.json", () => {
    const p = store();
    const e = create("epic", { title: "shared" }, "", p);
    writeState({ activeEpic: e.id, claims: {} }, p);

    assert.equal(JSON.parse(readFileSync(p.config, "utf8")).activeEpic, e.id, "the clone reads this file");
    assert.equal("activeEpic" in JSON.parse(readFileSync(p.state, "utf8")), false, "the clone never sees this one");
    assert.equal(state(p).activeEpic, e.id, "callers still read it off state()");
  });

  it("reads a pre-0.5 store that still has activeEpic in state.json", () => {
    const p = store();
    const e = create("epic", { title: "legacy" }, "", p);
    writeFileSync(p.state, JSON.stringify({ activeEpic: e.id, claims: {}, override: null, lastStopBlock: null }));

    assert.equal(state(p).activeEpic, e.id, "an existing store must not lose its active epic on upgrade");

    // and the next write moves it to where a clone will find it
    writeState({ activeEpic: e.id }, p);
    assert.equal(JSON.parse(readFileSync(p.config, "utf8")).activeEpic, e.id);
  });

  it("leaves the per-machine keys in state.json", () => {
    const p = store();
    writeState({ override: { reason: "mine" }, lastStopBlock: "x" }, p);
    const local = JSON.parse(readFileSync(p.state, "utf8"));

    assert.deepEqual(local.override, { reason: "mine" }, "an override is one person's bypass, not the project's");
    assert.equal(local.lastStopBlock, "x");
    // and a purely local write does not touch the committed file at all
    assert.equal(existsSync(p.config), false, "a claim or an override is nobody else's business");
  });
});
