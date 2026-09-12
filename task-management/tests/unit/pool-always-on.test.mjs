/**
 * TM-178 — the pool is on by default, follows its config live, outlives the session that started
 * it, and takes only tasks that pass the shared readiness check.
 *
 * Same fixtures as pool.test.mjs: a real git repo because dispatch provisions a worktree, a fake
 * backend, caps: {} and the dispatch order pinned to ["fake"]. The one-pool-per-store test runs
 * two real `tm pool run` processes against a temp store with TM_DISPATCH_REGISTRY naming the fake
 * registry, so nothing real launches; every child is SIGKILLed in t.after, pass or fail.
 *
 * The pool module is imported as a namespace so an export this task adds (poolEnabled) fails only
 * the test that uses it.
 */
import { after, describe, it } from "node:test";
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { existsSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { cleanup, tempRepo, tempStore } from "./helpers.mjs";
import { ensureDirs, paths } from "../../lib/paths.mjs";
import { create, read, seedGitContract, update, writeConfig } from "../../lib/store.mjs";
import { settingsSnapshot } from "../../lib/settings.mjs";
import * as pool from "../../lib/dispatch/pool.mjs";

delete process.env.TM_ENFORCE;

const HERE = dirname(fileURLToPath(import.meta.url));
const TM = join(HERE, "..", "..", "bin", "tm");
const REGISTRY = join(HERE, "fixtures", "fake-dispatch-registry.mjs");

const trash = [];
after(() => cleanup(...trash));

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Poll `fn` until it returns truthy or `ms` passes; returns the value or null. */
async function until(fn, ms = 5000, step = 20) {
  const end = Date.now() + ms;
  for (;;) {
    const v = fn();
    if (v) return v;
    if (Date.now() > end) return null;
    await sleep(step);
  }
}

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

function store() {
  const p = tempStore();
  trash.push(p.root);
  return p;
}

function fakeBackend() {
  const calls = [];
  return { name: "fake", calls, available: () => true, spawn: (req) => (calls.push(req.task.id), { ok: true, run: `fake:${req.task.id}` }) };
}

/** A task a worker can take under the default config: a body, a criterion and an epic. */
function complete(p, title) {
  const epic = create("epic", { title: `epic for ${title}` }, "", p).id;
  const t = create("task", { title, epic, acceptance: [{ text: "it works", done: false }] }, "context\n", p);
  update(t.id, { labels: ["ready-for-agent"] }, p);
  return t.id;
}

/** A child env that can reach only the temp store and the fake backend, and no tmux server. */
function childEnv(p) {
  const env = { ...process.env, TM_ROOT: p.root, TM_DISPATCH_REGISTRY: REGISTRY, TMUX: "" };
  delete env.TM_ENFORCE;
  return env;
}

/** `tm pool run` as a real process, stdout captured, SIGKILLed when the test ends. */
function startPool(p, t) {
  const child = spawn(process.execPath, [TM, "pool", "run"], { cwd: p.root, env: childEnv(p), stdio: ["ignore", "pipe", "pipe"] });
  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (d) => (stdout += d));
  child.stderr.on("data", (d) => (stderr += d));
  const exited = new Promise((resolve) => child.on("exit", (code, signal) => resolve({ code, signal })));
  t.after(() => {
    if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
  });
  return { child, exited, lines: () => stdout.split("\n").filter(Boolean), dump: () => `stdout: ${stdout} | stderr: ${stderr}` };
}

describe("TM-178 — one predicate, on by default", () => {
  it("poolEnabled is true unless dispatch.enabled is exactly false", () => {
    assert.equal(pool.poolEnabled({}), true);
    assert.equal(pool.poolEnabled({ dispatch: {} }), true);
    assert.equal(pool.poolEnabled({ dispatch: { enabled: true } }), true);
    assert.equal(pool.poolEnabled({ dispatch: { enabled: false } }), false);
  });

  it("the settings catalog defaults dispatch.enabled to true", () => {
    const field = settingsSnapshot(store()).fields.find((f) => f.key === "dispatch.enabled");
    assert.equal(field.default, true);
    assert.equal(field.value, true, "an unset store reads as on");
  });

  it("tm pool status reports enabled through the same predicate", () => {
    const p = store();
    const status = () => {
      const r = spawnSync(process.execPath, [TM, "pool", "status", "--json"], { env: childEnv(p), encoding: "utf8" });
      assert.equal(r.status, 0, r.stderr);
      return JSON.parse(r.stdout).enabled;
    };
    assert.equal(status(), true, "unset is on");
    writeConfig({ dispatch: { enabled: false } }, p);
    assert.equal(status(), false);
  });
});

describe("TM-178 B3 — the pool takes only tasks that pass agentReadiness", () => {
  it("skips a hand-labelled incomplete task, names the missing fields, and does not count a failure", async () => {
    const p = repoStore();
    const good = complete(p, "specified");
    const bare = create("task", { title: "a title and nothing else" }, "", p).id;
    update(bare, { labels: ["ready-for-agent"] }, p); // a person's label: the store's sync leaves it
    assert.ok(pool.poolable(p).some((t) => t.id === bare), "control: the hand label makes it poolable");
    const fake = fakeBackend();

    const res = await pool.poolTick({ p, registry: { fake }, caps: {} });

    assert.deepEqual(res.dispatched.map((d) => d.id), [good]);
    assert.deepEqual(res.skipped, [{ id: bare, reason: "not ready: body, acceptance criteria, epic" }]);
    assert.deepEqual(fake.calls, [good], "the incomplete task never reached the backend");
    assert.equal(read(bare, p).status, "open");
    assert.equal(pool.readPoolState(p).failures, 0, "a readiness skip is not a brake failure");
  });
});

describe("TM-178 — the loop follows dispatch.enabled live", () => {
  it("unset: the loop dispatches; set false mid-run: no further dispatch, exit within one poll, pool.pid released", async () => {
    const p = repoStore();
    const first = complete(p, "first");
    const fake = fakeBackend();
    const states = [];
    let second = null;
    let flippedAt = 0;
    const POLL = 0.5;

    const run = pool.runPool({
      p,
      intervalSeconds: POLL,
      registry: { fake },
      caps: {},
      onState: (line) => states.push(line),
      // Synchronous, between the tick and the sleep: no tick can be mid-flight when the flag flips.
      onTick: () => {
        if (second) return;
        assert.equal(pool.readPoolPid(p)?.pid, process.pid, "the running loop holds pool.pid");
        writeConfig({ dispatch: { enabled: false } }, p);
        second = complete(p, "second — created after the flag went false");
        flippedAt = Date.now();
      },
    });
    const res = await Promise.race([run, sleep(5000).then(() => "still running")]);

    assert.ok(second, "the loop ran a tick with the flag unset");
    assert.notEqual(res, "still running", "the loop exited");
    assert.equal(res.disabled, true, JSON.stringify(res));
    assert.ok(Date.now() - flippedAt < POLL * 1000 + 500, `exited within one poll (${Date.now() - flippedAt} ms)`);
    assert.deepEqual(fake.calls, [first], "the unset flag dispatched; the false flag dispatched nothing more");
    assert.equal(read(second, p).status, "open");
    assert.equal(pool.readPoolPid(p), null, "pool.pid released");
    assert.deepEqual(states, [`pool: running (pid ${process.pid})`, "pool: stopped — dispatch.enabled is false"]);
  });

  it("explicit false at launch: the loop returns at once, no tick, no pid file", async () => {
    const p = repoStore({ dispatch: { enabled: false } });
    complete(p, "ready but the pool is off");
    const fake = fakeBackend();
    const ticks = [];
    const t0 = Date.now();

    const res = await pool.runPool({ p, intervalSeconds: 30, registry: { fake }, caps: {}, onTick: (t) => ticks.push(t) });

    assert.equal(res.disabled, true);
    assert.ok(Date.now() - t0 < 2000, "no sleep");
    assert.equal(ticks.length, 0);
    assert.equal(fake.calls.length, 0);
    assert.equal(pool.readPoolPid(p), null);
  });
});

describe("TM-178 — `tm pool run` is one foreground pool per store", () => {
  it("a second run refuses with exit 2 while a live pool holds pool.pid, and prints its state line", async (t) => {
    const POLL = 0.4;
    const p = repoStore({ dispatch: { pollSeconds: POLL } });
    const task = complete(p, "the pool dispatches this");

    const a = startPool(p, t);
    assert.ok(await until(() => pool.readPoolPid(p)?.pid === a.child.pid), `control: the pool holds pool.pid (${a.dump()})`);
    assert.ok(await until(() => read(task, p).status === "in_progress"), `it dispatched with the flag unset (${a.dump()})`);

    const b = startPool(p, t);
    const refused = await Promise.race([b.exited, sleep(5000).then(() => null)]);

    assert.deepEqual(refused, { code: 2, signal: null }, `a second run is refused, not queued (${b.dump()})`);
    assert.equal(pool.readPoolPid(p)?.pid, a.child.pid, "the incumbent's pid file is left alone");
    await sleep(POLL * 1000 * 3);
    assert.deepEqual(a.lines(), [`pool: running (pid ${a.child.pid})`], "one line across several ticks");

    // The kill switch: false stops the running pool within one poll, and it releases pool.pid.
    writeConfig({ dispatch: { enabled: false } }, p);
    const exit = await Promise.race([a.exited, sleep(POLL * 1000 + 3000).then(() => null)]);
    assert.deepEqual(exit, { code: 0, signal: null }, a.dump());
    assert.equal(a.lines().at(-1), "pool: stopped — dispatch.enabled is false");
    assert.equal(existsSync(join(p.base, "pool.pid")), false, "the exiting pool released pool.pid");
  });
});

describe("TM-178 — the session-start line", () => {
  const poolLines = (p) => {
    const r = spawnSync(process.execPath, [TM, "hook", "session-start"], { input: JSON.stringify({ cwd: p.root }), env: childEnv(p), encoding: "utf8" });
    assert.equal(r.status, 0, r.stderr);
    const ctx = JSON.parse(r.stdout).hookSpecificOutput?.additionalContext || "";
    return ctx.split("\n").filter((l) => l.startsWith("pool: "));
  };

  it("on with no pool yet: one line with the state, the ready count and the working count", () => {
    const p = store();
    complete(p, "ready");
    const busy = create("task", { title: "a worker has this" }, "", p).id;
    update(busy, { status: "in_progress", dispatched: { backend: "fake", run: "fake:x", session: "s", at: new Date().toISOString() } }, p);

    assert.deepEqual(poolLines(p), ["pool: on — starting with this session · 1 ready · 1 working · tm config dispatch.enabled false to stop"]);
  });

  it("on with a live pool: names its pid", (t) => {
    const p = store();
    const holder = spawn("sleep", ["30"], { stdio: "ignore" });
    t.after(() => holder.kill("SIGKILL"));
    writeFileSync(join(p.base, "pool.pid"), `${JSON.stringify({ pid: holder.pid, store: p.base, started: "x" })}\n`);

    assert.deepEqual(poolLines(p), [`pool: on — running (pid ${holder.pid}) · 0 ready · 0 working · tm config dispatch.enabled false to stop`]);
  });

  it("off: says so, and how to turn it back on", () => {
    const p = store();
    writeConfig({ dispatch: { enabled: false } }, p);

    assert.deepEqual(poolLines(p), ["pool: off (dispatch.enabled false) — tm config dispatch.enabled true"]);
  });
});
