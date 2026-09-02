/**
 * TM-065 — the pool: agent-first pickup of ready-for-agent tasks.
 *
 * poolable() is pure store reads, so it runs against a plain temp store. Every
 * poolTick test that actually dispatches uses a store rooted in a real git repo
 * (dispatch provisions a worktree) and a fake backend registry injected
 * in-process — the same seam TM_DISPATCH_REGISTRY gives the CLI subprocess.
 */
import { after, describe, it } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { cleanup, tempRepo, tempStore } from "./helpers.mjs";
import { ensureDirs, paths } from "../../lib/paths.mjs";
import { claimTask } from "../../lib/claims.mjs";
import { listAgents, registerAgent } from "../../lib/agents.mjs";
import { create, read, seedGitContract, state, update, writeConfig } from "../../lib/store.mjs";
import { dispatch } from "../../lib/dispatch/index.mjs";
import { recordResult } from "../../lib/dispatch/collect.mjs";
import { livePool, poolTick, poolable, readPoolPid, releasePoolPid, runPool, writePoolPid } from "../../lib/dispatch/pool.mjs";

// The kill-switch tests set this themselves; nothing else may inherit it.
delete process.env.TM_ENFORCE;

const trash = [];
after(() => cleanup(...trash));

/**
 * A store rooted in a real git repo, because dispatch provisions a worktree.
 * The dispatch order is pinned to ["fake"] so resolveBackend never walks to a
 * REAL backend module, and every poolTick passes caps: {} so no real host
 * probe runs either — without both, an available orchestration binary on the
 * dev machine would be handed a real dispatch.
 */
function repoStore(cfg = {}) {
  const root = tempRepo();
  const p = paths(root);
  ensureDirs(p);
  seedGitContract(p);
  const { dispatch: dcfg, ...rest } = cfg;
  writeConfig({ ...rest, dispatch: { backends: ["fake"], ...(dcfg || {}) } }, p);
  trash.push(root);
  return p;
}

/** A plain store: enough for poolable() and pool.pid, which never provision. */
function store(cfg = {}) {
  const p = tempStore();
  if (Object.keys(cfg).length) writeConfig(cfg, p);
  trash.push(p.root);
  return p;
}

/** A backend that records what it was asked to launch, with a per-task run handle. */
function fakeBackend(spawnImpl = null) {
  const calls = [];
  return {
    name: "fake",
    calls,
    available: () => true,
    spawn: (req) => {
      calls.push(req);
      return spawnImpl ? spawnImpl(req) : { ok: true, run: `fake:${req.task.id}` };
    },
  };
}

/** A task the pool may pick up: open, unblocked, labelled ready-for-agent. */
function ready(p, title, extra = {}) {
  const t = create("task", { title }, "", p);
  update(t.id, { labels: ["ready-for-agent"], ...extra }, p);
  return t.id;
}

describe("poolable", () => {
  it("is the ready-for-agent, unclaimed, unblocked queue in queue order", () => {
    const p = store();
    const first = ready(p, "first ready");
    const unlabeled = create("task", { title: "not labelled" }, "", p);
    const claimed = ready(p, "already taken");
    const blocked = ready(p, "waits on the unlabeled one", { blockedBy: [unlabeled.id] });
    claimTask(claimed, { session: "s-other", actor: "@alice", p });

    assert.deepEqual(poolable(p).map((t) => t.id), [first], "only the ready, free, startable task qualifies");
  });

  it("keeps queue order when several tasks qualify", () => {
    const p = store();
    const a = ready(p, "a");
    const b = ready(p, "b");
    assert.deepEqual(poolable(p).map((t) => t.id), [a, b]);
  });
});

describe("poolTick — capacity", () => {
  it("dispatches up to dispatch.poolWip and skips the rest with a reason", async () => {
    const p = repoStore({ dispatch: { poolWip: 2 } });
    const t1 = ready(p, "one");
    const t2 = ready(p, "two");
    const t3 = ready(p, "three");
    const fake = fakeBackend();

    const res = await poolTick({ p, registry: { fake }, caps: {} });

    assert.deepEqual(res.dispatched.map((d) => d.id), [t1, t2], "queue order, up to capacity");
    assert.equal(res.capacity, 2);
    assert.deepEqual(res.skipped, [{ id: t3, reason: "at capacity" }]);
    assert.equal(read(t1, p).status, "in_progress");
    assert.equal(read(t1, p).dispatched.backend, "fake");
    assert.equal(read(t3, p).status, "open", "the task over capacity was never touched");
    assert.equal(state(p).claims[t3], undefined);
  });

  it("counts only alive pool-spawned workers against poolWip", async () => {
    const p = repoStore(); // default poolWip 3
    ready(p, "one");
    ready(p, "two");
    ready(p, "three");
    // A live dispatched worker (backend set) consumes a slot…
    registerAgent({ name: "agent:TM-009-pool", backend: "tmux", runId: "tmux:r1", pid: process.pid, session: "s-w" }, p);
    // …an interactive session (backend null) does not.
    registerAgent({ name: "human:interactive", pid: process.pid, session: "s-h" }, p);
    const fake = fakeBackend();

    const res = await poolTick({ p, registry: { fake }, caps: {} });

    assert.equal(res.capacity, 2, "3 WIP minus the one alive pool worker");
    assert.equal(res.dispatched.length, 2);
    assert.equal(res.skipped.length, 1);
    assert.equal(res.skipped[0].reason, "at capacity");
  });
});

describe("poolTick — touches discipline", () => {
  it("never dispatches two tasks that collide on touches in one tick", async () => {
    const p = repoStore(); // poolWip 3 — capacity is not the limiter here
    const t1 = ready(p, "owns same.ts", { touches: ["src/same.ts"] });
    const t2 = ready(p, "also wants same.ts", { touches: ["src/same.ts"] });
    const t3 = ready(p, "disjoint", { touches: ["src/other.ts"] });
    const fake = fakeBackend();

    const res = await poolTick({ p, registry: { fake }, caps: {} });

    assert.deepEqual(res.dispatched.map((d) => d.id), [t1, t3], "the collision-free set dispatches together");
    assert.equal(res.skipped.length, 1);
    assert.equal(res.skipped[0].id, t2);
    assert.match(res.skipped[0].reason, /collide/);
    assert.equal(read(t2, p).status, "open", "the colliding task waits for a later tick");
  });
});

describe("poolTick — kill-switches fire before any work", () => {
  it("TM_ENFORCE=off disables the tick", async () => {
    const p = repoStore();
    const id = ready(p, "ready");
    const fake = fakeBackend();
    process.env.TM_ENFORCE = "off";
    let res;
    try {
      res = await poolTick({ p, registry: { fake }, caps: {} });
    } finally {
      delete process.env.TM_ENFORCE;
    }

    assert.equal(res.disabled, true);
    assert.match(res.reason, /TM_ENFORCE/);
    assert.deepEqual(res.dispatched, []);
    assert.equal(fake.calls.length, 0, "nothing launched");
    assert.equal(read(id, p).status, "open");
    assert.equal(state(p).claims[id], undefined);
  });

  it("config dispatch.enabled=false disables the tick", async () => {
    const p = repoStore({ dispatch: { enabled: false } });
    const id = ready(p, "ready");
    const fake = fakeBackend();

    const res = await poolTick({ p, registry: { fake }, caps: {} });

    assert.equal(res.disabled, true);
    assert.match(res.reason, /dispatch\.enabled/);
    assert.equal(fake.calls.length, 0);
    assert.equal(read(id, p).status, "open");
  });
});

describe("poolTick — failure isolation", () => {
  it("one task's dispatch failure lands in skipped; the others still dispatch", async () => {
    const p = repoStore();
    const bad = ready(p, "unlaunchable");
    const good = ready(p, "fine");
    const fake = fakeBackend((req) =>
      req.task.id === bad ? { ok: false, reason: "boom: the harness binary is gone" } : { ok: true, run: `fake:${req.task.id}` },
    );

    const res = await poolTick({ p, registry: { fake }, caps: {} });

    assert.deepEqual(res.dispatched.map((d) => d.id), [good]);
    assert.equal(res.skipped.length, 1);
    assert.equal(res.skipped[0].id, bad);
    assert.match(res.skipped[0].reason, /boom/);
    assert.equal(read(bad, p).status, "open", "dispatch() released the failed claim");
    assert.equal(state(p).claims[bad], undefined);
    assert.equal(read(good, p).status, "in_progress");
  });
});

describe("poolTick — collect before dispatch", () => {
  it("collects a finished worker, freeing its capacity for the same tick", async () => {
    const p = repoStore({ dispatch: { poolWip: 1 } });
    const a = ready(p, "worker walks away");
    const b = ready(p, "next up");
    const fake = fakeBackend();
    const d = await dispatch(a, { backend: fake, session: "pool-tm-a", actor: "pool", p });
    assert.equal(d.ok, true, JSON.stringify(d));

    // The worker exited without closing: still in_progress, claim held, agent
    // reads alive — without collection this tick would be at capacity 0.
    const impls = { fake: (id, { p: pp }) => recordResult(id, { outcome: "failed", summary: "worker exited without closing" }, pp) };
    const res = await poolTick({ p, registry: { fake }, caps: {}, impls });

    assert.equal(res.collected.length, 1);
    assert.equal(res.collected[0].id, a);
    assert.equal(res.collected[0].outcome, "failed");
    assert.equal(res.collected[0].parked, true);
    assert.equal(read(a, p).status, "parked", "the failure parked the task");
    assert.equal(state(p).claims[a], undefined, "and released its claim");

    assert.equal(res.capacity, 1, "the collected worker no longer consumes WIP");
    assert.deepEqual(res.dispatched.map((x) => x.id), [b], "the freed slot dispatched the next task this tick");
    const retired = listAgents(p).find((x) => x.runId === `fake:${a}`);
    assert.ok(retired, "the worker's registry entry still exists");
    assert.equal(retired.alive, false, "and no longer reads alive");
  });
});

describe("poolTick — dry run", () => {
  it("reports what would dispatch and changes nothing", async () => {
    const p = repoStore();
    const id = ready(p, "maybe");
    const fake = fakeBackend();

    const res = await poolTick({ p, registry: { fake }, caps: {}, dryRun: true });

    assert.deepEqual(res.dispatched, [{ id, dryRun: true }]);
    assert.equal(fake.calls.length, 0, "spawn never ran");
    assert.equal(read(id, p).status, "open");
    assert.equal(state(p).claims[id], undefined);
  });
});

describe("pool.pid — one loop per store", () => {
  it("runPool refuses to start over a live pid file", async () => {
    const p = store();
    // A LIVE pid that is not this process — the refusal is for somebody else's pool.
    const child = spawn("sleep", ["30"], { stdio: "ignore" });
    try {
      writeFileSync(join(p.base, "pool.pid"), `${JSON.stringify({ pid: child.pid, store: p.base, started: "x" })}\n`);

      const res = await runPool({ p, intervalSeconds: 0 });

      assert.equal(res.ok, false);
      assert.match(res.reason, /already running/);
      assert.equal(readPoolPid(p).pid, child.pid, "the incumbent's pid file is left alone");
    } finally {
      child.kill("SIGKILL");
      releasePoolPid(p);
    }
    assert.equal(livePool(p), null);
  });

  it("a pid file owned by another store is not this store's pool", () => {
    const p = store();
    writeFileSync(join(p.base, "pool.pid"), `${JSON.stringify({ pid: process.pid, store: "/somewhere/else", started: "x" })}\n`);

    assert.equal(livePool(p), null, "a recycled/foreign pid never reads as our pool");
    assert.equal(readPoolPid(p).store, "/somewhere/else", "the record itself is still readable");
  });

  it("--auto is opt-in: no dispatch.enabled, no loop, no pid file", async () => {
    const p = store();

    const res = await runPool({ p, auto: true, intervalSeconds: 0 });

    assert.equal(res.disabled, true);
    assert.match(res.reason, /opt-in/);
    assert.equal(readPoolPid(p), null, "a refused autostart leaves no pid behind");
  });

  it("pool.pid is in the store's git contract, like agents.json", async () => {
    const { NOT_FOR_GIT, isHostFile } = await import("../../lib/store.mjs");
    assert.ok(NOT_FOR_GIT.includes("pool.pid"));
    assert.equal(isHostFile("pool.pid"), true);
    const p = store();
    const { readFileSync } = await import("node:fs");
    assert.match(readFileSync(p.gitignore, "utf8"), /^pool\.pid$/m, "the seeded .gitignore covers it");
  });
});
