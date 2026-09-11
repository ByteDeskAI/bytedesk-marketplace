/**
 * TM-175 — the pool is safe to leave running unattended.
 *
 * One describe per defect (B4–B8) plus the brakes and the overrun signal. Same
 * fixtures as pool.test.mjs: a real git repo because dispatch provisions a
 * worktree, a fake backend registry injected in-process, caps: {} so no real
 * host probe runs, and the dispatch order pinned to ["fake"]. Nothing here
 * reaches tmux, ao-topology or claude.
 *
 * The pool module is imported as a namespace on purpose: an export this task
 * adds (readPoolState, resumePool) is then a TypeError inside the one test that
 * needs it, not a link error that turns every test in the file red.
 */
import { after, describe, it } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { cleanup, tempRepo, tempStore } from "./helpers.mjs";
import { ensureDirs, paths } from "../../lib/paths.mjs";
import { listAgents } from "../../lib/agents.mjs";
import { create, read, readEvents, seedGitContract, state, update, writeConfig } from "../../lib/store.mjs";
import { worktreePath } from "../../lib/worktree.mjs";
import { dispatch } from "../../lib/dispatch/index.mjs";
import { recordResult } from "../../lib/dispatch/collect.mjs";
import * as pool from "../../lib/dispatch/pool.mjs";

delete process.env.TM_ENFORCE;

const trash = [];
after(() => cleanup(...trash));

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

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

function store(cfg = {}) {
  const p = tempStore();
  writeConfig({ dispatch: { backends: ["fake"] }, ...cfg }, p);
  trash.push(p.root);
  return p;
}

function fakeBackend(spawnImpl = null) {
  const calls = [];
  return {
    name: "fake",
    calls,
    available: () => true,
    spawn: (req) => {
      calls.push(req.task.id);
      return spawnImpl ? spawnImpl(req) : { ok: true, run: `fake:${req.task.id}` };
    },
  };
}

/** Complete enough to pass agentReadiness under the default config (TM-178 B3): body, criterion, epic. */
function ready(p, title, extra = {}) {
  const epic = create("epic", { title: `epic for ${title}` }, "", p).id;
  const t = create("task", { title, epic, acceptance: [{ text: "it works", done: false }] }, "context\n", p);
  update(t.id, { labels: ["ready-for-agent"], ...extra }, p);
  return t.id;
}

/** Collector overrides: a worker still running, and a worker that died without closing. */
const pending = { fake: () => ({ ok: true, pending: true }) };
const dies = { fake: (id, { p: pp }) => recordResult(id, { outcome: "failed", summary: "worker exited without closing" }, pp) };

const events = (p, name) => readEvents(p).filter((e) => e.event === name);

describe("TM-175 B4 — busy is counted from the board, not the agent registry", () => {
  it("poolWip still holds after every worker's registry entry passes agentTtlMinutes", async () => {
    // 0.001 min = 60 ms. tmux/topology spawns register pid null and nothing renews heartbeatAt.
    const p = repoStore({ agentTtlMinutes: 0.001, dispatch: { poolWip: 2 } });
    ready(p, "one");
    ready(p, "two");
    const fake = fakeBackend();

    const first = await pool.poolTick({ p, registry: { fake }, caps: {}, impls: pending });
    assert.equal(first.dispatched.length, 2, "control: both slots filled");
    await sleep(150);
    assert.equal(listAgents(p).filter((a) => a.alive).length, 0, "control: the registry now reads every worker dead");

    const third = ready(p, "three");
    const res = await pool.poolTick({ p, registry: { fake }, caps: {}, impls: pending });

    assert.equal(res.capacity, 0, "two in_progress dispatched tasks still fill poolWip 2");
    assert.deepEqual(res.dispatched, []);
    assert.deepEqual(res.skipped, [{ id: third, reason: "at capacity" }]);
    assert.equal(read(third, p).status, "open");
  });

  it("backendCaps count in_progress tasks by dispatched.backend, after the TTL too", async () => {
    const p = repoStore({ agentTtlMinutes: 0.001, dispatch: { poolWip: 5, backendCaps: { fake: 1 } } });
    ready(p, "first");
    const fake = fakeBackend();
    assert.equal((await pool.poolTick({ p, registry: { fake }, caps: {}, impls: pending })).dispatched.length, 1);
    await sleep(150);

    const second = ready(p, "second");
    const res = await pool.poolTick({ p, registry: { fake }, caps: {}, impls: pending });

    assert.deepEqual(res.dispatched, []);
    assert.deepEqual(res.skipped, [{ id: second, reason: "backend fake at cap (1)" }]);
  });

  it("an in_progress task without a dispatch record (interactive work) does not consume pool WIP", async () => {
    const p = repoStore(); // poolWip 3
    ready(p, "one");
    ready(p, "two");
    ready(p, "three");
    const worker = create("task", { title: "a pool worker is on this" }, "", p);
    update(worker.id, { status: "in_progress", dispatched: { backend: "tmux", run: "tmux:tm-x", session: "s-w", at: new Date().toISOString() } }, p);
    const human = create("task", { title: "a human is on this" }, "", p);
    update(human.id, { status: "in_progress" }, p);
    const fake = fakeBackend();

    const res = await pool.poolTick({ p, registry: { fake }, caps: {}, impls: { tmux: () => ({ ok: true, pending: true }) } });

    assert.equal(res.capacity, 2, "3 WIP minus the one dispatched task; the interactive one is free");
    assert.equal(res.dispatched.length, 2);
  });
});

describe("TM-175 B5 — a stop that lands during a tick is not lost", () => {
  it("SIGTERM during a slow tick ends the loop after that tick and removes pool.pid", async () => {
    const p = repoStore();
    ready(p, "slow to launch");
    let signalled = false;
    const slow = {
      name: "fake",
      available: () => true,
      spawn: async (req) => {
        // runPool's listener is installed while it runs, so this is the pool's stop, not the test's death.
        process.kill(process.pid, "SIGTERM");
        signalled = true;
        await sleep(300);
        return { ok: true, run: `fake:${req.task.id}` };
      },
    };

    const run = pool.runPool({ p, intervalSeconds: 3600, registry: { fake: slow }, caps: {} });
    const res = await Promise.race([run, sleep(5000).then(() => "still sleeping")]);
    if (res === "still sleeping") {
      process.emit("SIGTERM"); // the lost stop left the loop in a one-hour sleep; wake it so the file can exit
      await run;
    }

    assert.equal(signalled, true, "control: the signal was sent mid-tick");
    assert.deepEqual(res, { ok: true, stopped: true }, "the loop ended after the tick instead of sleeping");
    assert.equal(pool.readPoolPid(p), null, "pool.pid removed");
  });
});

describe("TM-175 B6 — running work occupies its touches", () => {
  it("skips a ready task whose touches overlap an in_progress task's touches", async () => {
    const p = repoStore();
    const running = create("task", { title: "already running" }, "", p);
    update(running.id, { status: "in_progress", touches: ["src/a.ts"] }, p);
    const clash = ready(p, "wants a.ts", { touches: ["src/a.ts"] });
    const free = ready(p, "wants b.ts", { touches: ["src/b.ts"] });
    const untouched = ready(p, "declares nothing");
    const fake = fakeBackend();

    const res = await pool.poolTick({ p, registry: { fake }, caps: {} });

    assert.deepEqual(res.dispatched.map((d) => d.id), [free, untouched], "no-touches work keeps today's behaviour");
    assert.equal(res.skipped.length, 1);
    assert.equal(res.skipped[0].id, clash);
    assert.match(res.skipped[0].reason, new RegExp(`in_progress ${running.id}`), "the reason names the running task");
    assert.equal(read(clash, p).status, "open");
  });
});

describe("TM-175 B7 — a failed dispatch removes the worktree it created", () => {
  it("removes the worktree after a spawn failure, so a re-dispatch of that task succeeds", async () => {
    const p = repoStore();
    const id = ready(p, "flaky launch");
    const wt = worktreePath(id, read(id, p).title, p);
    let calls = 0;
    const flaky = {
      name: "fake",
      available: () => true,
      spawn: (req) => (++calls === 1 ? { ok: false, reason: "harness crashed" } : { ok: true, run: `fake:${req.task.id}` }),
    };

    const first = await dispatch(id, { backend: flaky, session: "s1", p });
    assert.equal(first.ok, false);
    assert.match(first.reason, /harness crashed/, "the spawn's own reason survives the cleanup");
    assert.equal(existsSync(wt), false, "the worktree this dispatch created is gone");
    assert.equal(read(id, p).worktree ?? null, null, "and the task no longer points at it");
    assert.equal(read(id, p).status, "open");
    assert.equal(state(p).claims[id], undefined);

    const second = await dispatch(id, { backend: flaky, session: "s1", p });
    assert.equal(second.ok, true, JSON.stringify(second));
    assert.ok(existsSync(wt));
  });

  it("keeps a claim that predates the dispatch while removing the worktree it created", async () => {
    // Reachable without --steal: `tm start` claims for session s1, then s1 runs `tm dispatch`.
    const { claimTask } = await import("../../lib/claims.mjs");
    const p = repoStore();
    const id = ready(p, "started by hand");
    const wt = worktreePath(id, read(id, p).title, p);
    assert.equal(claimTask(id, { session: "s1", actor: "@human", p }).ok, true, "control: s1 holds the claim");
    update(id, { status: "in_progress" }, p);

    const res = await dispatch(id, { backend: fakeBackend(() => ({ ok: false, reason: "harness crashed" })), session: "s1", p });

    assert.equal(res.ok, false);
    assert.match(res.reason, /harness crashed/);
    assert.equal(existsSync(wt), false, "the worktree this dispatch created is gone");
    assert.equal(read(id, p).worktree ?? null, null);
    assert.equal(read(id, p).branch ?? null, null);
    assert.equal(state(p).claims[id]?.session, "s1", "the claim that existed before the dispatch is still held by s1");
    assert.equal(read(id, p).status, "in_progress", "and the status it had is restored");
  });

  it("never removes a checkout it did not create (guard)", async () => {
    const p = repoStore();
    const id = ready(p, "occupied");
    const wt = worktreePath(id, read(id, p).title, p);
    mkdirSync(wt, { recursive: true });
    writeFileSync(join(wt, "occupant.txt"), "x");

    const res = await dispatch(id, { backend: fakeBackend(), session: "s1", p });

    assert.equal(res.ok, false);
    assert.ok(existsSync(join(wt, "occupant.txt")), "a provisioning refusal leaves the occupant alone");
  });
});

describe("TM-175 B8 — pool.pid is taken exclusively", () => {
  it("two concurrent runPool calls on one store give exactly one running pool", async () => {
    const p = store();
    const results = await Promise.all([
      pool.runPool({ p, intervalSeconds: 0, registry: { fake: fakeBackend() }, caps: {} }),
      pool.runPool({ p, intervalSeconds: 0, registry: { fake: fakeBackend() }, caps: {} }),
    ]);

    assert.equal(results.filter((r) => r.ok === true).length, 1, JSON.stringify(results));
    assert.equal(results.filter((r) => r.ok === false && /already running/.test(r.reason)).length, 1, JSON.stringify(results));
    assert.equal(pool.readPoolPid(p), null, "the winner removed its pid on exit");
  });

  it("replaces a stale record: a dead pid, or another store's path (guard)", async () => {
    const dead = store();
    writeFileSync(join(dead.base, "pool.pid"), `${JSON.stringify({ pid: spawnSync("true").pid, store: dead.base, started: "x" })}\n`);
    const foreign = store();
    writeFileSync(join(foreign.base, "pool.pid"), `${JSON.stringify({ pid: process.pid, store: "/somewhere/else", started: "x" })}\n`);

    for (const p of [dead, foreign]) {
      const res = await pool.runPool({ p, intervalSeconds: 0, registry: { fake: fakeBackend() }, caps: {} });
      assert.equal(res.ok, true, JSON.stringify(res));
      assert.equal(pool.readPoolPid(p), null);
    }
  });
});

describe("TM-175 brakes — the pool pauses instead of burning the queue", () => {
  it("workers that die at once pause the pool after maxFailures (default 3), before the queue is parked", async () => {
    const p = repoStore({ dispatch: { poolWip: 1 } });
    const ids = [1, 2, 3, 4, 5, 6].map((n) => ready(p, `task ${n}`));
    const fake = fakeBackend();

    let last;
    for (let i = 0; i < 8; i += 1) last = await pool.poolTick({ p, registry: { fake }, caps: {}, impls: dies });

    assert.equal(fake.calls.length, 3, `three workers died, then the pool stopped dispatching (dispatched ${fake.calls})`);
    assert.equal(ids.filter((id) => read(id, p).status === "parked").length, 3);
    assert.deepEqual(ids.slice(3).map((id) => read(id, p).status), ["open", "open", "open"]);
    assert.ok(last.paused, "the tick reports the pause");
    const st = pool.readPoolState(p);
    assert.match(st.pausedReason, /3 consecutive failures/);
    assert.ok(st.pausedAt);
    assert.equal(events(p, "pool_paused").length, 1, "pool_paused is logged once, not every paused tick");
  });

  it("maxFailures consecutive dispatch failures pause the pool mid-tick", async () => {
    const p = repoStore({ dispatch: { poolWip: 3, maxFailures: 2 } });
    for (const n of [1, 2, 3, 4, 5]) ready(p, `task ${n}`);
    const fake = fakeBackend(() => ({ ok: false, reason: "boom" }));

    const res = await pool.poolTick({ p, registry: { fake }, caps: {} });
    assert.equal(fake.calls.length, 2, "the second failure stops the tick");
    assert.ok(res.paused);
    assert.ok(res.skipped.some((s) => /paused/.test(s.reason)), JSON.stringify(res.skipped));

    await pool.poolTick({ p, registry: { fake }, caps: {} });
    assert.equal(fake.calls.length, 2, "and the next tick dispatches nothing");
  });

  it("one quota-shaped dispatch failure pauses at once", async () => {
    const p = repoStore({ dispatch: { poolWip: 3 } });
    for (const n of [1, 2, 3]) ready(p, `task ${n}`);
    const fake = fakeBackend(() => ({ ok: false, reason: "Claude usage limit reached — resets 5pm" }));

    const res = await pool.poolTick({ p, registry: { fake }, caps: {} });

    assert.equal(fake.calls.length, 1);
    assert.ok(res.paused);
    assert.match(pool.readPoolState(p).pausedReason, /usage limit/);
  });

  it("one quota-shaped worker failure pauses at once", async () => {
    const p = repoStore({ dispatch: { poolWip: 1 } });
    for (const n of [1, 2, 3]) ready(p, `task ${n}`);
    const fake = fakeBackend();
    const rateLimited = { fake: (id, { p: pp }) => recordResult(id, { outcome: "failed", summary: "API Error: 429 Too Many Requests" }, pp) };

    await pool.poolTick({ p, registry: { fake }, caps: {}, impls: rateLimited });
    const res = await pool.poolTick({ p, registry: { fake }, caps: {}, impls: rateLimited });

    assert.equal(fake.calls.length, 1, "the first worker's 429 stopped the second dispatch");
    assert.ok(res.paused);
    assert.match(pool.readPoolState(p).pausedReason, /429/);
  });

  it("a dispatched task that closes resets the count; a pending worker neither adds nor resets", async () => {
    const p = repoStore({ dispatch: { poolWip: 1, maxFailures: 2 } });
    const [a, b, c, d] = [1, 2, 3, 4].map((n) => ready(p, `task ${n}`));
    const fake = fakeBackend();
    let mode = "dies";
    const impls = { fake: (id, opts) => (mode === "pending" ? pending.fake() : dies.fake(id, opts)) };
    const tick = () => pool.poolTick({ p, registry: { fake }, caps: {}, impls });

    await tick(); // dispatch a
    await tick(); // a dies (1), dispatch b
    assert.equal(read(a, p).status, "parked");
    assert.equal(pool.readPoolState(p).failures, 1);

    // b's worker closed its task between ticks: the exact write `tm done` performs (bin/tm done).
    await sleep(5);
    update(b, { status: "done", closed: new Date().toISOString() }, p);
    mode = "pending";
    await tick(); // b is done: reset; dispatch c
    assert.equal(pool.readPoolState(p).failures, 0, "a closed dispatched task resets the count");
    await tick(); // c pending
    assert.equal(pool.readPoolState(p).failures, 0, "a pending collect does not add");

    mode = "dies";
    const fifth = await tick(); // c dies (1), dispatch d
    assert.equal(fifth.paused ?? null, null, "one failure after the reset is not a pause");
    const sixth = await tick(); // d dies (2) → pause
    assert.ok(sixth.paused);
    assert.deepEqual(fake.calls, [a, b, c, d]);
  });

  it("a dispatched task parked by hand neither resets nor adds; a task closed before the streak does not reset it", async () => {
    const p = repoStore({ dispatch: { poolWip: 2, maxFailures: 3 } });
    const [a, b, c] = [1, 2, 3].map((n) => ready(p, `task ${n}`));
    const fake = fakeBackend();
    let dying = null;
    const impls = { fake: (id, opts) => (id === dying ? dies.fake(id, opts) : pending.fake()) };
    const tick = () => pool.poolTick({ p, registry: { fake }, caps: {}, impls });

    await tick(); // dispatch a, b
    update(a, { status: "done", closed: new Date(Date.now() - 60_000).toISOString() }, p); // closed long before any failure
    dying = b;
    await tick(); // b dies (1); dispatch c
    assert.equal(pool.readPoolState(p).failures, 1);

    update(c, { status: "parked", parkedReason: "a human took it back" }, p);
    await tick();
    assert.equal(pool.readPoolState(p).failures, 1, "a hand-parked task is neither a success nor a failure, and an old close is not a reset");
  });

  it("the pause is on disk: a fresh loop stays paused until resumePool", async () => {
    const p = repoStore({ dispatch: { maxFailures: 1 } });
    ready(p, "a");
    ready(p, "b");
    const broken = fakeBackend(() => ({ ok: false, reason: "boom" }));
    assert.ok((await pool.poolTick({ p, registry: { fake: broken }, caps: {} })).paused);

    // A restart: a new loop that knows only what is on disk.
    const good = fakeBackend();
    const ticks = [];
    const res = await pool.runPool({ p, intervalSeconds: 0, registry: { fake: good }, caps: {}, onTick: (t) => ticks.push(t) });
    assert.equal(res.ok, true);
    assert.ok(ticks[0].paused, "the restarted loop is still paused");
    assert.equal(good.calls.length, 0, "and dispatched nothing");

    pool.resumePool(p);
    const st = pool.readPoolState(p);
    assert.equal(st.failures, 0);
    assert.equal(st.pausedReason ?? null, null);

    const after = await pool.poolTick({ p, registry: { fake: good }, caps: {} });
    assert.equal(after.dispatched.length, 2, "resume lets the pool dispatch again");
  });

  it("the pause file is in the store's git contract, like pool.pid", async () => {
    const { NOT_FOR_GIT, isHostFile } = await import("../../lib/store.mjs");
    assert.ok(NOT_FOR_GIT.includes("pool.state.json"));
    assert.equal(isHostFile("pool.state.json"), true);
    const p = store();
    assert.match(readFileSync(p.gitignore, "utf8"), /^pool\.state\.json$/m);
  });
});

describe("TM-175 — worker_overrun", () => {
  it("collect logs worker_overrun once for a pending worker past maxRuntimeMinutes, and does not park it", async () => {
    const p = repoStore({ dispatch: { maxRuntimeMinutes: 1 } });
    const id = ready(p, "long runner");
    const fake = fakeBackend();
    await pool.poolTick({ p, registry: { fake }, caps: {}, impls: pending });

    await pool.poolTick({ p, registry: { fake }, caps: {}, impls: pending });
    assert.equal(events(p, "worker_overrun").length, 0, "control: a fresh worker is not an overrun");

    update(id, { dispatched: { ...read(id, p).dispatched, at: new Date(Date.now() - 2 * 60_000).toISOString() } }, p);
    await pool.poolTick({ p, registry: { fake }, caps: {}, impls: pending });
    await pool.poolTick({ p, registry: { fake }, caps: {}, impls: pending });

    const overruns = events(p, "worker_overrun");
    assert.equal(overruns.length, 1, "logged once, not every tick");
    assert.equal(overruns[0].id, id);
    assert.equal(read(id, p).status, "in_progress", "an overrun is visibility, not a park");
    assert.ok(state(p).claims[id], "and the claim stands");
  });
});
