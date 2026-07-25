/**
 * TM-006 — claims are the interlock that stops two parallel sessions grabbing the
 * same task. That only works if a claim expires when its session dies, and if a
 * live claim can be taken deliberately rather than silently.
 */
import { after, describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { cleanup, tempStore } from "./helpers.mjs";
import { claimTask, claimant, expired, releaseClaim } from "../../lib/claims.mjs";
import { create, state, writeConfig, writeState } from "../../lib/store.mjs";

const stores = [];
function store() {
  const p = tempStore();
  stores.push(p.root);
  return p;
}
after(() => cleanup(...stores));

const ago = (min) => new Date(Date.now() - min * 60_000).toISOString();

describe("claimTask", () => {
  it("claims an unheld task", () => {
    const p = store();
    const t = create("task", { title: "free" }, "", p);
    const res = claimTask(t.id, { session: "s1", p });
    assert.equal(res.ok, true);
    assert.equal(state(p).claims[t.id].session, "s1");
  });

  it("is idempotent for the same session", () => {
    const p = store();
    const t = create("task", { title: "mine" }, "", p);
    claimTask(t.id, { session: "s1", p });
    assert.equal(claimTask(t.id, { session: "s1", p }).ok, true, "re-entering your own task must not be an error");
  });

  it("refuses a task another live session holds, and says who has it", () => {
    const p = store();
    const t = create("task", { title: "contended" }, "", p);
    // A live claim needs a worktree that still exists — a vanished one means the
    // session is gone, which is the *other* test below.
    const wt = join(p.root, "wt-a");
    mkdirSync(wt, { recursive: true });
    claimTask(t.id, { session: "s1", worktree: wt, p });

    const res = claimTask(t.id, { session: "s2", p });

    assert.equal(res.ok, false);
    assert.match(res.reason, /s1/, "the refusal must name the holder");
    assert.match(res.reason, /wt-a/, "and where they are working");
    assert.match(res.reason, /--steal/, "and how to proceed anyway");
    assert.equal(state(p).claims[t.id].session, "s1", "a refused claim must not have changed anything");
  });

  it("takes a held task with --steal, recording the theft", () => {
    const p = store();
    const t = create("task", { title: "contended" }, "", p);
    claimTask(t.id, { session: "s1", p });

    const res = claimTask(t.id, { session: "s2", steal: true, p });

    assert.equal(res.ok, true);
    assert.equal(res.stolenFrom, "s1");
    assert.equal(state(p).claims[t.id].session, "s2");
  });

  it("takes over an expired claim without ceremony", () => {
    const p = store();
    writeConfig({ claimTtlMinutes: 60 }, p);
    const t = create("task", { title: "abandoned" }, "", p);
    writeState({ claims: { [t.id]: { session: "ghost", ts: ago(120) } } }, p);

    const res = claimTask(t.id, { session: "s2", p });

    assert.equal(res.ok, true, "a claim from a session that never came back must not block the board forever");
    assert.equal(state(p).claims[t.id].session, "s2");
  });

  it("treats a claim whose worktree is gone as expired", () => {
    const p = store();
    const t = create("task", { title: "orphaned" }, "", p);
    const wt = join(p.root, "gone-worktree");
    mkdirSync(wt, { recursive: true });
    writeState({ claims: { [t.id]: { session: "s1", worktree: wt, ts: new Date().toISOString() } } }, p);
    rmSync(wt, { recursive: true, force: true });

    assert.equal(claimTask(t.id, { session: "s2", p }).ok, true);
  });
});

describe("expired", () => {
  it("is false for a fresh claim and true past the TTL", () => {
    const p = store();
    writeConfig({ claimTtlMinutes: 30 }, p);
    assert.equal(expired({ session: "s1", ts: ago(5) }, p), false);
    assert.equal(expired({ session: "s1", ts: ago(45) }, p), true);
  });

  it("treats a missing timestamp as expired rather than eternal", () => {
    const p = store();
    assert.equal(expired({ session: "s1" }, p), true);
  });
});

describe("claimant", () => {
  it("reports nothing for an unheld or expired task", () => {
    const p = store();
    const t = create("task", { title: "free" }, "", p);
    assert.equal(claimant(t.id, p), null);
    writeConfig({ claimTtlMinutes: 10 }, p);
    writeState({ claims: { [t.id]: { session: "old", ts: ago(60) } } }, p);
    assert.equal(claimant(t.id, p), null, "an expired claim is not a claimant");
  });

  it("reports the live holder", () => {
    const p = store();
    const t = create("task", { title: "held" }, "", p);
    claimTask(t.id, { session: "s1", branch: "tm/TM-001", p });
    assert.equal(claimant(t.id, p).session, "s1");
    assert.equal(claimant(t.id, p).branch, "tm/TM-001");
  });
});

describe("releaseClaim", () => {
  it("frees the task for the next session", () => {
    const p = store();
    const t = create("task", { title: "handed off" }, "", p);
    claimTask(t.id, { session: "s1", p });
    releaseClaim(t.id, p);
    assert.equal(claimTask(t.id, { session: "s2", p }).ok, true);
  });
});
