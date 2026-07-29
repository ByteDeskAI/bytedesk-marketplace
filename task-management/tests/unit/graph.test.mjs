/**
 * `tm why` / `tm graph` — the dependency graph read transitively.
 *
 * The failure these guard against is a chain that reports the wrong culprit: the
 * card says `⊘ TM-002`, TM-002 is itself waiting on TM-003, and the work you can
 * actually pick up is TM-003. A one-hop answer sends you to the wrong task.
 */
import { after, describe, it } from "node:test";
import assert from "node:assert/strict";
import { cleanup, tempStore } from "./helpers.mjs";
import { create, update, writeConfig, writeState } from "../../lib/store.mjs";
import { graphData, mermaid, renderWhy, why } from "../../lib/graph.mjs";

const stores = [];
function store() {
  const p = tempStore();
  stores.push(p.root);
  // Every test that isn't about the WIP gate wants it out of the way.
  writeConfig({ wipLimit: 0 }, p);
  return p;
}
after(() => cleanup(...stores));

/** a ← b ← c: c is what you can start, a is what the card names. */
function chainOfThree(p) {
  const root = create("task", { title: "root cause", blockedBy: [] }, "", p);
  const middle = create("task", { title: "middle", blockedBy: [root.id] }, "", p);
  const top = create("task", { title: "top", blockedBy: [middle.id] }, "", p);
  update(middle.id, { status: "blocked" }, p);
  update(top.id, { status: "blocked" }, p);
  return { root: root.id, middle: middle.id, top: top.id };
}

describe("why — the chain", () => {
  it("walks past the direct blocker to the task that can actually be started", () => {
    const p = store();
    const { root, middle, top } = chainOfThree(p);

    const w = why(top, p);

    assert.equal(w.startable, false);
    assert.deepEqual(w.chain.map((c) => c.id), [middle, root], "depth-first, nearest hop first");
    assert.deepEqual(w.chain.map((c) => c.depth), [0, 1]);
    assert.deepEqual(w.roots.map((r) => r.id), [root], "the root is the only startable thing in the chain");
  });

  it("drops a resolved blocker from the chain instead of reporting it", () => {
    const p = store();
    const { root, middle, top } = chainOfThree(p);
    update(root, { status: "done" }, p);

    const w = why(top, p);

    assert.deepEqual(w.chain.map((c) => c.id), [middle]);
    assert.deepEqual(w.roots.map((r) => r.id), [middle], "middle is now the frontier");
  });

  it("reports a startable task as startable, with no reasons", () => {
    const p = store();
    const t = create("task", { title: "free", blockedBy: [] }, "", p);

    const w = why(t.id, p);

    assert.equal(w.startable, true);
    assert.deepEqual(w.reasons, []);
    assert.match(renderWhy(w), /nothing is holding this up/);
  });

  it("carries the written reason at each hop — a parked blocker without one is useless", () => {
    const p = store();
    const { root, top } = chainOfThree(p);
    update(root, { status: "parked", parkedReason: "waiting on legal" }, p);

    const w = why(top, p);

    assert.equal(w.chain.find((c) => c.id === root).reason, "waiting on legal");
    assert.match(renderWhy(w), /waiting on legal/);
  });

  it("terminates on a cycle and names it rather than recursing forever", () => {
    const p = store();
    const a = create("task", { title: "a", blockedBy: [] }, "", p);
    const b = create("task", { title: "b", blockedBy: [a.id] }, "", p);
    update(a.id, { blockedBy: [b.id], status: "blocked" }, p);
    update(b.id, { status: "blocked" }, p);

    const w = why(a.id, p);

    assert.ok(w.cycles.length, "the cycle must be reported");
    assert.ok(w.reasons.some((r) => r.kind === "cycle" && r.blocking));
  });

  it("calls a dangling dependency missing, not resolved", () => {
    const p = store();
    const t = create("task", { title: "orphaned dep", blockedBy: ["TM-999"] }, "", p);
    update(t.id, { status: "blocked" }, p);

    const w = why(t.id, p);

    assert.equal(w.startable, false, "a dep we cannot find must not read as satisfied");
    assert.equal(w.chain[0].status, "missing");
    assert.ok(w.reasons.some((r) => r.kind === "dangling"));
    assert.deepEqual(w.roots, [], "a broken reference is not work you can pick up");
  });

  it("shares one blocker between two dependents without double-counting it", () => {
    const p = store();
    const shared = create("task", { title: "shared", blockedBy: [] }, "", p);
    const left = create("task", { title: "left", blockedBy: [shared.id] }, "", p);
    const top = create("task", { title: "top", blockedBy: [shared.id, left.id] }, "", p);
    update(left.id, { status: "blocked" }, p);
    update(top.id, { status: "blocked" }, p);

    const w = why(top.id, p);

    assert.deepEqual(w.chain.filter((c) => c.id === shared.id).length, 1);
  });
});

describe("why — reasons that are not dependencies", () => {
  it("distinguishes a hand-written block from a dependency", () => {
    const p = store();
    const t = create("task", { title: "legal", blockedBy: [] }, "", p);
    update(t.id, { status: "blocked", blockedReason: "waiting on counsel" }, p);

    const w = why(t.id, p);

    assert.equal(w.startable, false);
    assert.equal(w.reasons.find((r) => r.kind === "declared").text, "blocked by hand: waiting on counsel");
    assert.deepEqual(w.chain, []);
  });

  it("names the session holding the claim", () => {
    const p = store();
    const t = create("task", { title: "held", blockedBy: [] }, "", p);
    writeState({ claims: { [t.id]: { session: "other-session", actor: "agent-2", ts: new Date().toISOString() } } }, p);

    const w = why(t.id, p);

    assert.equal(w.startable, false);
    assert.match(w.reasons.find((r) => r.kind === "claimed").text, /agent-2/);
  });

  it("reports the WIP limit as blocking, since start would refuse", () => {
    const p = store();
    writeConfig({ wipLimit: 1 }, p);
    const running = create("task", { title: "running", blockedBy: [] }, "", p);
    update(running.id, { status: "in_progress" }, p);
    const waiting = create("task", { title: "waiting", blockedBy: [] }, "", p);

    assert.equal(why(waiting.id, p).startable, false);
    assert.equal(why(running.id, p).startable, true, "the task already in progress is not blocked by itself");
  });

  it("treats parked as informational — `tm start` resumes a parked task", () => {
    const p = store();
    const t = create("task", { title: "paused", blockedBy: [] }, "", p);
    update(t.id, { status: "parked", parkedReason: "direction change" }, p);

    const w = why(t.id, p);

    assert.equal(w.startable, true, "parked is not a gate");
    assert.equal(w.reasons.find((r) => r.kind === "parked").blocking, false);
  });

  it("says a done task has nothing to start", () => {
    const p = store();
    const t = create("task", { title: "finished", blockedBy: [] }, "", p);
    update(t.id, { status: "done" }, p);

    assert.ok(why(t.id, p).reasons.some((r) => r.kind === "resolved"));
  });

  it("returns null for an id that does not exist", () => {
    assert.equal(why("TM-404", store()), null);
  });
});

describe("graph", () => {
  it("emits Mermaid with an edge per dependency, pointing blocker → blocked", () => {
    const p = store();
    const { root, middle, top } = chainOfThree(p);

    const g = mermaid({}, p);

    assert.equal(g.tasks, 3);
    assert.equal(g.edges, 2);
    assert.match(g.mermaid, /^flowchart TD/);
    assert.match(g.mermaid, new RegExp(`${root.replace("-", "_")} --> ${middle.replace("-", "_")}`));
    assert.match(g.mermaid, new RegExp(`${middle.replace("-", "_")} --> ${top.replace("-", "_")}`));
  });

  it("keeps hyphenated ids out of Mermaid node names", () => {
    const p = store();
    create("task", { title: "one", blockedBy: [] }, "", p);

    const { mermaid: src } = mermaid({}, p);

    assert.ok(!/^\s+TM-\d+\[/m.test(src), "a hyphen in a node id is not valid Mermaid");
    assert.match(src, /TM_001\["TM-001 one"\]:::open/);
  });

  it("hides done work by default and includes it with --all", () => {
    const p = store();
    const t = create("task", { title: "shipped", blockedBy: [] }, "", p);
    update(t.id, { status: "done" }, p);

    assert.equal(mermaid({}, p).tasks, 0);
    assert.equal(mermaid({ includeDone: true }, p).tasks, 1);
  });

  it("draws a blocker from outside the epic filter, because it still explains the block", () => {
    const p = store();
    const outside = create("task", { title: "other epic", epic: "EP-002", blockedBy: [] }, "", p);
    const inside = create("task", { title: "mine", epic: "EP-001", blockedBy: [outside.id] }, "", p);
    update(inside.id, { status: "blocked" }, p);

    const g = mermaid({ epic: "EP-001" }, p);

    assert.equal(g.tasks, 1, "only the filtered task counts as in-scope");
    assert.match(g.mermaid, new RegExp(`${outside.id.replace("-", "_")}\\[`), "the outside blocker is still drawn");
    assert.equal(g.edges, 1);
  });

  it("escapes a quote in a title rather than emitting broken Mermaid", () => {
    const p = store();
    create("task", { title: 'the "quoted" one [x]', blockedBy: [] }, "", p);

    const src = mermaid({}, p).mermaid;

    assert.match(src, /&quot;quoted&quot;/);
    assert.ok(!/\[x\]/.test(src.split("\n")[1]), "brackets inside a label break the node shape");
  });

  it("gives the same edges as data for --json", () => {
    const p = store();
    const { root, middle } = chainOfThree(p);

    const d = graphData({}, p);

    assert.equal(d.nodes.length, 3);
    assert.ok(d.edges.some((e) => e.from === root && e.to === middle));
  });
});
