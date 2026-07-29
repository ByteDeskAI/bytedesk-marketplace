/**
 * The claim interlock has to mean the same thing over MCP as it does on the CLI.
 *
 * It did not. `tm start` refused a task another live session held; `tm_task_update` with
 * action=start — the path Claude actually uses — did a bare `writeState` and took it silently.
 * Three defects in that one line, all reproduced before this file existed:
 *
 *   1. no holder check, so MCP took what the CLI refused, with no refusal and no event
 *   2. the replacement record was `{session, ts}` only, dropping actor/worktree/branch/pid —
 *      and `expired()` reads `claim.worktree` to notice a dead worktree, so a stolen claim
 *      became permanently un-expirable and the refusal message degraded to "session bob"
 *   3. no `claim_stolen` event, so the only trace was a generic `update`
 *
 * `tm_claim` had its own version: it compared sessions but never asked `expired()`, so a claim
 * left by a crashed session blocked an MCP agent forever while the CLI treated it as dead.
 */
import { after, describe, it } from "node:test";
import assert from "node:assert/strict";
import { cleanup, tempStore } from "./helpers.mjs";
import { writeFileSync } from "node:fs";
import { create, readEvents, state, writeConfig } from "../../lib/store.mjs";
import { callTool } from "../../lib/mcp.mjs";

const stores = [];
function store() {
  const p = tempStore();
  stores.push(p.root);
  writeConfig({ requireEpic: false, wipLimit: 99 }, p);
  return p;
}
after(() => cleanup(...stores));

/** callTool reads the session from the environment, as the real server does. */
function as(session, name, args, p) {
  const before = process.env.CLAUDE_SESSION_ID;
  process.env.CLAUDE_SESSION_ID = session;
  try {
    return callTool(name, args, p);
  } finally {
    if (before === undefined) delete process.env.CLAUDE_SESSION_ID;
    else process.env.CLAUDE_SESSION_ID = before;
  }
}

function contested() {
  const p = store();
  const t = create("task", { title: "the contested task", acceptance: [] }, "", p);
  as("alice", "tm_claim", { id: t.id }, p);
  return { p, id: t.id };
}

describe("tm_task_update start", () => {
  it("refuses a task another live session holds", () => {
    const { p, id } = contested();
    const res = as("bob", "tm_task_update", { id, action: "start" }, p);

    assert.equal(res.ok, false, "the path Claude uses must not get an easier ride than the CLI");
    assert.match(res.error, /claimed by/);
    assert.equal(state(p).claims[id].session, "alice", "and the claim must not have moved");
  });

  it("names steal in the refusal, or an agent retries in a loop", () => {
    const { p, id } = contested();
    assert.match(as("bob", "tm_task_update", { id, action: "start" }, p).error, /--steal|steal/);
  });

  it("leaves no status change behind when it refuses", () => {
    const { p, id } = contested();
    as("bob", "tm_task_update", { id, action: "start" }, p);
    // The claim is taken BEFORE the status write, so a refusal cannot leave a task
    // in_progress that nobody holds.
    assert.notEqual(as("alice", "tm_show", { id }, p).doc.status, "done");
    assert.equal(state(p).claims[id].session, "alice");
  });

  it("takes it with steal, and says whose it was", () => {
    const { p, id } = contested();
    const res = as("bob", "tm_task_update", { id, action: "start", steal: true }, p);

    assert.equal(res.ok, true);
    assert.equal(res.stolenFrom, "alice");
    assert.equal(state(p).claims[id].session, "bob");
  });

  it("records claim_stolen, so taking someone's work leaves a trace", () => {
    const { p, id } = contested();
    as("bob", "tm_task_update", { id, action: "start", steal: true }, p);

    const ev = readEvents(p).filter((e) => e.event === "claim_stolen");
    assert.equal(ev.length, 1);
    assert.equal(ev[0].from, "alice");
  });

  it("keeps the fields expired() needs", () => {
    const { p, id } = contested();
    as("bob", "tm_task_update", { id, action: "start", steal: true }, p);

    const claim = state(p).claims[id];
    // Without worktree, expired() can never notice a dead checkout and the claim outlives
    // the session forever. Without actor, the next refusal reads "session bob".
    assert.ok(claim.worktree, "worktree is what expired() checks");
    assert.ok(claim.actor, "actor is what the refusal message names");
    assert.ok(claim.pid);
  });

  it("lets the holder start its own task without stealing from itself", () => {
    const { p, id } = contested();
    assert.equal(as("alice", "tm_task_update", { id, action: "start" }, p).ok, true);
  });
});

describe("tm_task_update done", () => {
  it("releases the claim and logs it", () => {
    const p = store();
    const t = create("task", { title: "finish me", acceptance: [] }, "", p);
    as("alice", "tm_claim", { id: t.id }, p);

    assert.equal(as("alice", "tm_task_update", { id: t.id, action: "done" }, p).ok, true);
    assert.equal(t.id in (state(p).claims || {}), false);
    // The hand-rolled delete never logged this.
    assert.ok(readEvents(p).some((e) => e.event === "release" && e.id === t.id));
  });
});

describe("tm_claim", () => {
  it("refuses a live foreign claim", () => {
    const { p, id } = contested();
    assert.equal(as("bob", "tm_claim", { id }, p).ok, false);
  });

  it("takes a claim whose worktree is gone, exactly as the CLI does", () => {
    const p = store();
    const t = create("task", { title: "abandoned", acceptance: [] }, "", p);
    as("alice", "tm_claim", { id: t.id }, p);
    // A crashed session's claim: expired() sees the missing worktree. The old check compared
    // sessions only, so MCP was blocked forever on something the CLI considered dead.
    const s = state(p);
    s.claims[t.id] = { ...s.claims[t.id], worktree: "/nonexistent-checkout" };
    writeConfig({}, p);
    writeFileSync(p.state, JSON.stringify(s));

    assert.equal(as("bob", "tm_claim", { id: t.id }, p).ok, true);
  });

  it("still reads the claim map when given no id", () => {
    const { p, id } = contested();
    assert.ok(id in as("alice", "tm_claim", {}, p).claims);
  });
});
