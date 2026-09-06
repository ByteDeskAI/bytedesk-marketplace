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
