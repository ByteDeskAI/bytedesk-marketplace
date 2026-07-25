/**
 * TM-027 — with several agents working one board, "who did this" is the missing
 * column. Every task and every event records the thread that touched it: the main
 * session, a named teammate, or an anonymous subagent.
 */
import { after, describe, it } from "node:test";
import assert from "node:assert/strict";
import { cleanup, tempStore } from "./helpers.mjs";
import { actor, actorLabel } from "../../lib/actor.mjs";
import { create, logEvent, readEvents, update } from "../../lib/store.mjs";

const stores = [];
function store() {
  const p = tempStore();
  stores.push(p.root);
  return p;
}
after(() => cleanup(...stores));

function withEnv(env, fn) {
  const saved = {};
  for (const [k, v] of Object.entries(env)) {
    saved[k] = process.env[k];
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  try {
    return fn();
  } finally {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
}

const CLEAN = {
  TM_ACTOR: undefined,
  CLAUDE_AGENT_NAME: undefined,
  CLAUDE_CODE_CHILD_SESSION: undefined,
  CLAUDE_SESSION_ID: undefined,
  TM_ACTOR_INFER: undefined,
};

describe("actor", () => {
  it("is the main thread by default", () => {
    const got = withEnv(CLEAN, actor);
    assert.equal(got.thread, "main");
    assert.equal(got.name, null);
  });

  it("takes an explicit TM_ACTOR over anything inferred", () => {
    const got = withEnv({ ...CLEAN, TM_ACTOR: "worktree", TM_ACTOR_INFER: "1", CLAUDE_CODE_CHILD_SESSION: "1" }, actor);
    assert.equal(got.thread, "teammate");
    assert.equal(got.name, "worktree", "a spawned agent naming itself is the most reliable signal we have");
  });

  it("recognises a named teammate", () => {
    const got = withEnv({ ...CLEAN, CLAUDE_AGENT_NAME: "dashboard" }, actor);
    assert.equal(got.thread, "teammate");
    assert.equal(got.name, "dashboard");
  });

  it("stays 'main' when the child-session flag is the only signal", () => {
    // That flag is set for ordinary top-level sessions too — trusting it labelled
    // the main thread as a subagent on the real board.
    const got = withEnv({ ...CLEAN, CLAUDE_CODE_CHILD_SESSION: "1", CLAUDE_SESSION_ID: "abcdef123456" }, actor);
    assert.equal(got.thread, "main", "a wrong name on the board is worse than a plain one");
  });

  it("infers an anonymous subagent only when explicitly asked to", () => {
    const got = withEnv(
      { ...CLEAN, TM_ACTOR_INFER: "1", CLAUDE_CODE_CHILD_SESSION: "1", CLAUDE_SESSION_ID: "abcdef123456" },
      actor,
    );
    assert.equal(got.thread, "subagent");
    assert.match(got.session, /abcdef/, "keep enough of the session id to tell two subagents apart");
  });

  it("renders a short label for the board", () => {
    assert.equal(actorLabel({ thread: "main", name: null }), "main");
    assert.equal(actorLabel({ thread: "teammate", name: "mcp" }), "@mcp");
    assert.equal(actorLabel({ thread: "subagent", session: "abcdef123456" }), "subagent:abcdef");
  });
});

describe("attribution on the board", () => {
  it("stamps events with the actor", () => {
    const p = store();
    withEnv({ ...CLEAN, CLAUDE_AGENT_NAME: "worktree" }, () => logEvent("done", { id: "TM-001" }, p));
    const [event] = readEvents(p).filter((e) => e.event === "done");
    assert.equal(event.actor, "@worktree", "the log is the audit trail — it has to say who");
  });

  it("keeps the actor that last touched a task", () => {
    const p = store();
    const t = withEnv({ ...CLEAN }, () => create("task", { title: "shared work" }, "", p));
    withEnv({ ...CLEAN, CLAUDE_AGENT_NAME: "mcp" }, () => update(t.id, { status: "in_progress", actor: actorLabel(actor()) }, p));
    const { actor: who } = JSON.parse(JSON.stringify(update(t.id, {}, p)));
    assert.equal(who, "@mcp");
  });
});
