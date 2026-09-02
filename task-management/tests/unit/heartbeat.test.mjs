/**
 * TM-067 — claims held by liveness, not by the wall clock alone.
 *
 * A long-running dispatched worker used to hold its claim only until
 * claimTtlMinutes ran out; the TTL could not tell a slow worker from a dead
 * one. Now the holder refreshes `ts` (heartbeatClaim), the dispatcher beats
 * that pulse for its workers, and when a worker dies the reaper parks its task
 * and releases its claim (reapDeadWorkers) instead of leaving in_progress work
 * nobody is doing.
 */
import { after, describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { cleanup, tempStore } from "./helpers.mjs";
import { claimTask, claimant, expired, heartbeatClaim } from "../../lib/claims.mjs";
import { create, read, readEvents, state, update, writeConfig, writeState } from "../../lib/store.mjs";
import { agentsFile, listAgents, reapDeadWorkers, registerAgent } from "../../lib/agents.mjs";
import { heartbeatOnce } from "../../lib/dispatch/index.mjs";

const stores = [];
function store() {
  const p = tempStore();
  stores.push(p.root);
  return p;
}
after(() => cleanup(...stores));

const ago = (min) => new Date(Date.now() - min * 60_000).toISOString();
/** A pid that cannot exist: above every platform's PID_MAX, so signal 0 is ESRCH. */
const DEAD_PID = 2 ** 22;

/** Rewrite the registry file directly — the test's way of backdating a heartbeat. */
function surgery(p, fn) {
  const reg = JSON.parse(readFileSync(agentsFile(p), "utf8"));
  fn(reg);
  writeFileSync(agentsFile(p), `${JSON.stringify(reg, null, 2)}\n`);
}

/** A claimed, in-progress task plus the registered worker holding it. */
function claimedWork(p, { session, alive = false }) {
  const t = create("task", { title: `work of ${session}` }, "", p);
  claimTask(t.id, { session, p });
  update(t.id, { status: "in_progress", session }, p);
  const name = `agent:${t.id}-${session}`;
  registerAgent({ name, pid: alive ? process.pid : DEAD_PID, session }, p);
  if (!alive) {
    surgery(p, (reg) => {
      reg.agents[name].heartbeatAt = ago(120);
    });
  }
  return { id: t.id, name };
}

describe("heartbeatClaim", () => {
  it("refreshes a backdated claim's ts, so the claim is no longer expired", () => {
    const p = store();
    writeConfig({ claimTtlMinutes: 30 }, p);
    const t = create("task", { title: "slow but alive" }, "", p);
    claimTask(t.id, { session: "s1", p });
    writeState({ claims: { [t.id]: { ...state(p).claims[t.id], ts: ago(45) } } }, p);
    assert.equal(expired(state(p).claims[t.id], p), true, "fixture: the claim has aged out");

    const refreshed = heartbeatClaim(t.id, { session: "s1", p });

    assert.ok(refreshed, "the holder's heartbeat is accepted");
    assert.ok(Date.parse(refreshed.ts) > Date.parse(ago(1)), "ts moved to now");
    assert.equal(claimant(t.id, p)?.session, "s1", "the claim is live again and still the holder's");
  });

  it("refuses a stranger's heartbeat and leaves the claim untouched", () => {
    const p = store();
    const t = create("task", { title: "mine" }, "", p);
    claimTask(t.id, { session: "s1", p });
    const before = state(p).claims[t.id];

    const res = heartbeatClaim(t.id, { session: "s2", p });

    assert.equal(res, null, "a stranger cannot keep someone else's claim alive");
    assert.deepEqual(state(p).claims[t.id], before, "nothing about the claim changed");
  });

  it("returns null for a task with no claim, and creates nothing", () => {
    const p = store();
    const t = create("task", { title: "unclaimed" }, "", p);
    assert.equal(heartbeatClaim(t.id, { session: "s1", p }), null);
    assert.equal(state(p).claims[t.id], undefined, "a heartbeat is not a claim");
  });

  it("treats a null-session claim as unowned: refreshable by anyone, adopted by nobody", () => {
    const p = store();
    const t = create("task", { title: "shell work" }, "", p);
    writeState({ claims: { [t.id]: { session: null, ts: ago(10) } } }, p);

    const refreshed = heartbeatClaim(t.id, { session: "s2", p });

    assert.ok(refreshed, "an unowned claim can be kept alive");
    assert.equal(refreshed.session, null, "refreshing it does not make it yours");
    assert.ok(Date.parse(refreshed.ts) > Date.parse(ago(1)));
  });

  it("logs nothing — a heartbeat is a pulse, not an event", () => {
    const p = store();
    const t = create("task", { title: "quiet" }, "", p);
    claimTask(t.id, { session: "s1", p });
    const before = readEvents(p).length;

    heartbeatClaim(t.id, { session: "s1", p });

    assert.equal(readEvents(p).length, before, "an event per pulse is what makes people switch the log off");
  });
});

describe("heartbeatOnce — the supervisor-driven pulse", () => {
  it("refreshes the holder's claim and never throws on a missing one", () => {
    const p = store();
    const t = create("task", { title: "supervised" }, "", p);
    claimTask(t.id, { session: "s1", p });

    assert.ok(heartbeatOnce(t.id, "s1", p), "the supervisor's beat lands");
    assert.equal(heartbeatOnce("TM-999", "s1", p), null, "nothing to keep alive");
    assert.equal(heartbeatOnce(t.id, "s2", p), null, "and strangers are still refused");
  });
});

describe("expired — unchanged semantics", () => {
  it("claimTtlMinutes: 0 still disables expiry entirely", () => {
    const p = store();
    writeConfig({ claimTtlMinutes: 0 }, p);
    const t = create("task", { title: "eternal" }, "", p);
    claimTask(t.id, { session: "s1", p });
    writeState({ claims: { [t.id]: { ...state(p).claims[t.id], ts: ago(60 * 24 * 30) } } }, p);

    assert.equal(expired(state(p).claims[t.id], p), false, "a month-old claim is live when the TTL is off");
    assert.equal(claimant(t.id, p)?.session, "s1");
  });
});

describe("reapDeadWorkers", () => {
  it("parks a dead worker's task, releases its claim, and logs one worker_reaped", () => {
    const p = store();
    const { id, name } = claimedWork(p, { session: "s-dead" });

    const res = reapDeadWorkers(p);

    assert.deepEqual(res.reaped, [name], "the registry half of the reap still reports");
    assert.deepEqual(res.parked, [{ id, agent: name, session: "s-dead" }]);

    const task = read(id, p);
    assert.equal(task.status, "parked", "the task is NOT left in_progress");
    assert.equal(task.parkedReason, `agent ${name} died`);
    assert.equal(state(p).claims[id], undefined, "the claim is released");

    const evt = readEvents(p).find((e) => e.event === "worker_reaped");
    assert.ok(evt, "the reap lands in the event log");
    assert.equal(evt.id, id);
    assert.equal(evt.agent, name);
    assert.equal(evt.session, "s-dead");
  });

  it("leaves an alive worker's task and claim alone", () => {
    const p = store();
    const { id } = claimedWork(p, { session: "s-live", alive: true });

    const res = reapDeadWorkers(p);

    assert.deepEqual(res.reaped, []);
    assert.deepEqual(res.parked, [], "a live worker is never reaped");
    assert.equal(read(id, p).status, "in_progress");
    assert.equal(state(p).claims[id].session, "s-live", "the claim still stands");
    assert.equal(readEvents(p).filter((e) => e.event === "worker_reaped").length, 0);
  });

  it("is idempotent: a second pass parks nothing and logs nothing new", () => {
    const p = store();
    claimedWork(p, { session: "s-dead" });
    reapDeadWorkers(p);
    const eventsAfterFirst = readEvents(p).filter((e) => e.event === "worker_reaped").length;

    const second = reapDeadWorkers(p);

    assert.deepEqual(second.parked, [], "already parked is not re-parked");
    assert.equal(
      readEvents(p).filter((e) => e.event === "worker_reaped").length,
      eventsAfterFirst,
      "a reaper on a timer must not rewrite the same event every pass",
    );
  });

  it("leaves null-session claims alone — they belong to no agent", () => {
    const p = store();
    const t = create("task", { title: "shell work" }, "", p);
    writeState({ claims: { [t.id]: { session: null, ts: new Date().toISOString() } } }, p);
    claimedWork(p, { session: "s-dead" });

    reapDeadWorkers(p);

    assert.ok(state(p).claims[t.id], "an unowned claim is not a dead worker's claim");
  });
});
