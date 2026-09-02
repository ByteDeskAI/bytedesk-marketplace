/**
 * gateStop × dispatch — a worker session whose in-progress task was dispatched to it must not be
 * nagged by its own Stop gate: the pool's collector (lib/dispatch/collect.mjs) owns the outcome
 * from dispatch onward, and its park-on-failure path is the backstop for a dead worker.
 */
import { after, describe, it } from "node:test";
import assert from "node:assert/strict";
import { cleanup, tempStore, withSessionEnv } from "./helpers.mjs";
import { gateStop } from "../../lib/enforce.mjs";
import { create, mutate, state, writeConfig, writeState } from "../../lib/store.mjs";

const stores = [];
after(() => cleanup(...stores));

const SESSION = "worker-1";

function store() {
  const p = tempStore();
  stores.push(p.root);
  writeConfig({ enforce: true }, p);
  return p;
}

/** Claim `id` for `session`, the way `tm start` / dispatch() do. */
function claim(p, id, session) {
  const claims = { ...state(p).claims, [id]: { session, actor: "main", pid: 1, ts: new Date().toISOString() } };
  writeState({ claims }, p);
}

/** Stamp `dispatched` on the task, the way lib/dispatch/index.mjs does after a spawn. */
function dispatched(p, id, session = SESSION) {
  mutate(id, () => ({ dispatched: { backend: "tmux", run: `tmux:tm-${id}`, session, at: new Date().toISOString() } }), p);
}

/** Run gateStop as SESSION, with no ambient harness session leaking in. */
function stopAs(p, session = SESSION) {
  return withSessionEnv(session ? { TM_SESSION_ID: session } : {}, () => gateStop(p));
}

describe("gateStop with dispatched work", () => {
  it("does not block the stop for a dispatched task this session claims", () => {
    const p = store();
    const t = create("task", { title: "handed to the pool", status: "in_progress", session: SESSION }, "", p);
    claim(p, t.id, SESSION);
    dispatched(p, t.id);
    assert.equal(stopAs(p).block, false, "the collector owns the outcome; nagging the worker is noise");
  });

  it("still blocks for an ordinary in_progress task", () => {
    const p = store();
    const t = create("task", { title: "plain work", status: "in_progress", session: SESSION }, "", p);
    claim(p, t.id, SESSION);
    const res = stopAs(p);
    assert.equal(res.block, true);
    assert.match(res.reason, new RegExp(t.id));
  });

  it("blocks only on the non-dispatched tasks of a mixed set", () => {
    const p = store();
    const d = create("task", { title: "dispatched", status: "in_progress", session: SESSION }, "", p);
    claim(p, d.id, SESSION);
    dispatched(p, d.id);
    const mine = create("task", { title: "still mine", status: "in_progress", session: SESSION }, "", p);
    claim(p, mine.id, SESSION);
    const res = stopAs(p);
    assert.equal(res.block, true);
    assert.match(res.reason, new RegExp(mine.id), "the ordinary task is named");
    assert.equal(res.reason.includes(d.id), false, "the dispatched task must not be listed as unfinished");
  });

  it("does not exempt a dispatched task somebody ELSE claims", () => {
    const p = store();
    // No task.session, so the task falls inside this session's view — but the claim belongs to
    // another session, so the pool is not answering to THIS stop.
    const t = create("task", { title: "dispatched elsewhere", status: "in_progress" }, "", p);
    claim(p, t.id, "a-different-session");
    dispatched(p, t.id, "a-different-session");
    const res = stopAs(p);
    assert.equal(res.block, true);
    assert.match(res.reason, new RegExp(t.id));
  });

  it("does not exempt an anonymous session — it cannot prove the claim", () => {
    const p = store();
    const t = create("task", { title: "dispatched", status: "in_progress" }, "", p);
    claim(p, t.id, SESSION);
    dispatched(p, t.id);
    assert.equal(stopAs(p, null).block, true);
  });

  it("still never blocks twice in a row on the same set", () => {
    const p = store();
    const t = create("task", { title: "plain work", status: "in_progress", session: SESSION }, "", p);
    claim(p, t.id, SESSION);
    assert.equal(stopAs(p).block, true, "one nudge");
    assert.equal(stopAs(p).block, false, "then it gets out of the way");
  });
});
