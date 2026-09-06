/**
 * The run tree: who launched this run, and what it launched in turn.
 *
 * Nesting was always possible — an agent is a process in a pane with a shell and `ao-topology` on
 * its PATH, so a conductor that wants a sub-team can simply start one. What was missing was any
 * record of it: the child named no parent, the parent journalled no spawn, `stop` left the child
 * running, and a workflow could include itself for ever. These tests are about the record, not the
 * mechanism.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { childEnv, lineageFromEnv, lineageRefusal, MAX_DEPTH } from "../../topology/lib/lineage.mjs";
import { expandForEach, MAX_FANOUT } from "../../topology/lib/spec.mjs";

describe("lineage travels in the environment", () => {
  it("reads nothing at the root, and a full chain below it", () => {
    // A run with no parent is the ROOT, and that is a fact worth being explicit about: "no parent"
    // and "a parent we failed to record" must not look the same from the outside.
    assert.equal(lineageFromEnv({}), null);

    const env = childEnv({ runDir: "/r/parent", runId: "p1", agentId: "hand", depth: 0, chain: [], name: "outer" });
    assert.deepEqual(env, {
      AO_PARENT_RUN_DIR: "/r/parent",
      AO_PARENT_RUN_ID: "p1",
      AO_PARENT_AGENT_ID: "hand",
      AO_RUN_DEPTH: "1",
      AO_RUN_CHAIN: "outer",
    });

    const read = lineageFromEnv(env);
    assert.equal(read.run_dir, "/r/parent");
    assert.equal(read.agent_id, "hand");
    // The depth carried is the CHILD's own, already incremented — a run reads its depth rather than
    // deriving it, which is how the off-by-one stays impossible.
    assert.equal(read.depth, 1);
    assert.deepEqual(read.chain, ["outer"]);
  });

  it("grows the chain by exactly one workflow per level", () => {
    let env = childEnv({ runDir: "/a", runId: "1", agentId: "x", depth: 0, chain: [], name: "one" });
    env = childEnv({ runDir: "/b", runId: "2", agentId: "y", ...lineageFromEnv(env), name: "two" });
    assert.equal(env.AO_RUN_CHAIN, "one,two");
    assert.equal(env.AO_RUN_DEPTH, "2");
  });
});

describe("the refusals that keep a tree finite", () => {
  it("refuses a workflow already in its own ancestry, and names the loop", () => {
    const lineage = lineageFromEnv(childEnv({ runDir: "/r", runId: "1", agentId: "a", depth: 0, chain: [], name: "outer" }));
    const refusal = lineageRefusal({ name: "outer", lineage });
    assert.match(refusal, /already running in its own ancestry/);
    // The path, not just the verdict: "this loops" without saying where is not actionable.
    assert.match(refusal, /outer → outer/);
    assert.equal(lineageRefusal({ name: "inner", lineage }), null, "a different workflow below it is fine");
  });

  it("refuses past the depth cap, and says how to raise it", () => {
    const deep = lineageFromEnv({ AO_PARENT_RUN_DIR: "/r", AO_RUN_DEPTH: String(MAX_DEPTH + 1), AO_RUN_CHAIN: "a,b,c" });
    const refusal = lineageRefusal({ name: "d", lineage: deep });
    assert.match(refusal, new RegExp(`the limit is ${MAX_DEPTH}`));
    assert.match(refusal, /a → b → c → d/);
    assert.match(refusal, /--max-depth/, "a refusal that cannot be overridden should say so; this one can");
    assert.equal(lineageRefusal({ name: "d", lineage: deep, maxDepth: MAX_DEPTH + 2 }), null);
  });

  it("has nothing to refuse at the root", () => {
    assert.equal(lineageRefusal({ name: "anything", lineage: null }), null);
  });
});

describe("fan-out expands one entry into a team per item", () => {
  it("names each child after its item, not its position", () => {
    const agents = [
      { id: "conductor", role: "orchestrator", cli: "generic" },
      { id: "per-file", workflow: "review-one", for_each: ["src/a.js", "src/b.js"], inputs: { target: "{{item}}" } },
    ];
    const out = expandForEach(agents, {});
    assert.equal(out.length, 3);
    // The id is what a conductor types when it wants one of them. "per-file.1" is a thing nobody can
    // hold in their head across a run; the item is.
    assert.deepEqual(out.slice(1).map((a) => a.id), ["per-file.src-a-js", "per-file.src-b-js"]);
    assert.deepEqual(out.slice(1).map((a) => a.fanout_of), ["per-file", "per-file"]);
    // The item reaches the child through its own inputs, which is how the children differ at all.
    assert.deepEqual(out.slice(1).map((a) => a.inputs.target), ["src/a.js", "src/b.js"]);
    assert.equal(out[1].for_each, undefined, "the expanded copy is not itself a fan-out");
  });

  it("takes a comma-separated string, because an input can only ever supply one", () => {
    const out = expandForEach([{ id: "r", workflow: "w", for_each: "{{inputs.files}}" }], { inputs: { files: "a.js, b.js" } });
    assert.deepEqual(out.map((a) => a.id), ["r.a-js", "r.b-js"]);
  });

  it("resolves a slug collision rather than silently losing a child", () => {
    // "src/a.js" and "src-a.js" both slug to "src-a-js". Collapsing them would drop a reviewer and
    // look like it worked, which is the worst available outcome.
    const out = expandForEach([{ id: "r", workflow: "w", for_each: ["src/a.js", "src-a.js"] }], {});
    assert.equal(new Set(out.map((a) => a.id)).size, 2);
    assert.deepEqual(out.map((a) => a.id), ["r.src-a-js", "r.src-a-js-2"]);
  });

  it("refuses an empty list and one wider than the cap", () => {
    assert.throws(() => expandForEach([{ id: "r", workflow: "w", for_each: [] }], {}), (e) => e.code === "TOPOLOGY_FANOUT_EMPTY");
    const wide = Array.from({ length: MAX_FANOUT + 1 }, (_, i) => `f${i}`);
    // Each item is a whole tmux session and mailbox, not a pane — width is the cost that matters.
    assert.throws(() => expandForEach([{ id: "r", workflow: "w", for_each: wide }], {}), (e) => e.code === "TOPOLOGY_FANOUT_TOO_WIDE");
    assert.equal(expandForEach([{ id: "r", workflow: "w", for_each: wide }], {}, { maxFanout: 99 }).length, MAX_FANOUT + 1);
  });
});
