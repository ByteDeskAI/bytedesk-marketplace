/**
 * TM-178 — one pool per repo, out of band from any session.
 *
 * `ensurePool` starts a DETACHED `tm pool run` and returns; the pool outlives the session that
 * started it, and a session that wants one only ever asks. No session holds a pool process of its
 * own, so opening a second session costs nothing.
 *
 * Every test drives real processes against a temp store with TM_DISPATCH_REGISTRY naming the fake
 * registry and TMUX blank, so nothing real launches and no tmux server is reachable. Every pool
 * process is SIGKILLed in t.after, pass or fail — poolProcs() finds them by argv plus the TM_ROOT
 * in /proc/<pid>/environ, so a pool belonging to another store is never touched.
 */
import { after, describe, it } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawn, spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { cleanup, tempRepo } from "./helpers.mjs";
import { ensureDirs, paths } from "../../lib/paths.mjs";
import { create, seedGitContract, update, writeConfig } from "../../lib/store.mjs";
import * as pool from "../../lib/dispatch/pool.mjs";

delete process.env.TM_ENFORCE;

const HERE = dirname(fileURLToPath(import.meta.url));
const TM = join(HERE, "..", "..", "bin", "tm");
const REGISTRY = join(HERE, "fixtures", "fake-dispatch-registry.mjs");

const trash = [];
after(() => cleanup(...trash));

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function until(fn, ms = 8000, step = 25) {
  const end = Date.now() + ms;
  for (;;) {
    const v = fn();
    if (v) return v;
    if (Date.now() > end) return null;
    await sleep(step);
  }
}

const alive = (pid) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return err.code === "EPERM";
  }
};

/** Every `tm pool run` process belonging to THIS store, by argv and its own TM_ROOT. */
function poolProcs(p) {
  let ps = "";
  try {
    ps = execFileSync("ps", ["-eo", "pid=,args="], { encoding: "utf8" });
  } catch {
    return [];
  }
  return ps
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => /bin\/tm pool run/.test(l))
    .map((l) => Number(l.split(/\s+/)[0]))
    .filter((pid) => Number.isInteger(pid) && pid > 0)
    .filter((pid) => {
      try {
        return readFileSync(`/proc/${pid}/environ`, "utf8").split("\0").includes(`TM_ROOT=${p.root}`);
      } catch {
        return false;
      }
    });
}

function repoStore(dcfg = {}, t) {
  const root = tempRepo();
  const p = paths(root);
  ensureDirs(p);
  seedGitContract(p);
  writeConfig({ dispatch: { backends: ["fake"], pollSeconds: 0.3, ...dcfg } }, p);
  trash.push(root);
  if (t) {
    t.after(() => {
      for (const pid of poolProcs(p)) {
        try {
          process.kill(pid, "SIGKILL");
        } catch {
          /* already gone */
        }
      }
    });
  }
  return p;
}

function env(p) {
  const e = { ...process.env, TM_ROOT: p.root, TM_DISPATCH_REGISTRY: REGISTRY, TMUX: "" };
  delete e.TM_ENFORCE;
  return e;
}

/**
 * Run `tm …` to completion — the short-lived "session" that asks for a pool and leaves.
 *
 * The timeout is load-bearing: every verb here must RETURN. A verb that becomes the pool instead
 * of starting one blocks forever, and without this the suite would hang rather than fail.
 */
function tm(p, ...args) {
  const r = spawnSync(process.execPath, [TM, ...args], { cwd: p.root, env: env(p), encoding: "utf8", timeout: 20000, killSignal: "SIGKILL" });
  assert.notEqual(r.signal, "SIGKILL", `tm ${args.join(" ")} did not return within 20 s`);
  return r;
}

const poolLog = (p) => {
  try {
    return readFileSync(join(p.base, "pool.log"), "utf8");
  } catch {
    return "";
  }
};

function complete(p, title) {
  const epic = create("epic", { title: `epic for ${title}` }, "", p).id;
  const t = create("task", { title, epic, acceptance: [{ text: "it works", done: false }] }, "context\n", p);
  update(t.id, { labels: ["ready-for-agent"] }, p);
  return t.id;
}

describe("TM-178 — ensure starts one detached pool per repo", () => {
  it("the pool outlives the short-lived process that asked for it", async (t) => {
    const p = repoStore({}, t);

    const r = tm(p, "pool", "ensure");

    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /^pool: started \(pid \d+\)$/m, r.stdout);
    const pid = await until(() => pool.readPoolPid(p)?.pid);
    assert.ok(pid, `a pool claimed pool.pid (log: ${poolLog(p)})`);
    assert.notEqual(pid, r.pid, "the pool is not the process that asked");
    await sleep(600); // the asking process is long gone; the pool keeps ticking
    assert.equal(alive(pid), true, "the detached pool is still running after its caller exited");
    assert.deepEqual(poolProcs(p), [pid], "exactly one pool process for this store");
    assert.match(poolLog(p), /pool: running \(pid \d+\)/, "the pool's stream goes to pool.log");
  });

  it("a second ensure starts nothing and reports the running pool", async (t) => {
    const p = repoStore({}, t);
    assert.equal(tm(p, "pool", "ensure").status, 0);
    const pid = await until(() => pool.readPoolPid(p)?.pid);
    assert.ok(pid);

    const again = tm(p, "pool", "ensure");

    assert.equal(again.status, 0, again.stderr);
    assert.equal(again.stdout.trim(), `pool: running (pid ${pid})`);
    await sleep(400);
    assert.deepEqual(poolProcs(p), [pid], "still exactly one pool");
  });

  it("ensure while dispatch.enabled is false spawns nothing", async (t) => {
    const p = repoStore({ enabled: false }, t);

    const r = tm(p, "pool", "ensure");

    assert.equal(r.status, 0, r.stderr);
    assert.equal(r.stdout.trim(), "pool: off (dispatch.enabled false)");
    await sleep(400);
    assert.equal(existsSync(join(p.base, "pool.pid")), false, "no pid file");
    assert.deepEqual(poolProcs(p), [], "no pool process");
  });

  it("run --auto is an alias of ensure, so an older cached monitors.json still behaves", async (t) => {
    const p = repoStore({}, t);

    const r = tm(p, "pool", "run", "--auto");

    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /^pool: (started|running) \(pid \d+\)$/m, r.stdout);
    const pid = await until(() => pool.readPoolPid(p)?.pid);
    assert.ok(pid);
    assert.notEqual(pid, r.pid, "the alias detached a pool rather than becoming one");
  });

  it("two concurrent ensures leave exactly one live pool, and one clean log", async (t) => {
    const p = repoStore({}, t);

    const both = [
      spawn(process.execPath, [TM, "pool", "ensure"], { cwd: p.root, env: env(p), stdio: "ignore" }),
      spawn(process.execPath, [TM, "pool", "ensure"], { cwd: p.root, env: env(p), stdio: "ignore" }),
    ];
    await Promise.all(both.map((c) => new Promise((r) => c.on("exit", r))));
    const pid = await until(() => pool.readPoolPid(p)?.pid);
    assert.ok(pid);
    await sleep(600);

    assert.deepEqual(poolProcs(p), [pid], `exactly one pool survived the race (log: ${poolLog(p)})`);
    const running = poolLog(p).split("\n").filter((l) => l.startsWith("pool: running"));
    assert.equal(running.length, 1, `the loser wrote nothing to the log: ${poolLog(p)}`);
  });

  it("three more ensures add no processes", async (t) => {
    const p = repoStore({}, t);
    assert.equal(tm(p, "pool", "ensure").status, 0);
    const pid = await until(() => pool.readPoolPid(p)?.pid);
    assert.ok(pid);

    for (let i = 0; i < 3; i += 1) assert.equal(tm(p, "pool", "ensure").status, 0);
    await sleep(400);

    assert.deepEqual(poolProcs(p), [pid]);
  });
});

describe("TM-178 — the detached pool follows config and comes back", () => {
  it("setting dispatch.enabled false makes the running pool exit within one poll", async (t) => {
    const p = repoStore({}, t);
    assert.equal(tm(p, "pool", "ensure").status, 0);
    const pid = await until(() => pool.readPoolPid(p)?.pid);
    assert.ok(pid);

    writeConfig({ dispatch: { enabled: false } }, p);
    const gone = await until(() => !alive(pid), 4000);

    assert.ok(gone, `the pool exited (log: ${poolLog(p)})`);
    assert.equal(pool.readPoolPid(p), null, "and released pool.pid");
    assert.match(poolLog(p), /pool: stopped — dispatch\.enabled is false/);
  });

  it("a SIGKILLed pool leaves a stale pid file, and the next ensure replaces it", async (t) => {
    const p = repoStore({}, t);
    assert.equal(tm(p, "pool", "ensure").status, 0);
    const first = await until(() => pool.readPoolPid(p)?.pid);
    assert.ok(first);

    process.kill(first, "SIGKILL");
    assert.ok(await until(() => !alive(first)));
    assert.equal(pool.readPoolPid(p)?.pid, first, "control: the killed pool could not clean up");

    const r = tm(p, "pool", "ensure");

    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /^pool: started \(pid \d+\)$/m, r.stdout);
    const second = await until(() => pool.readPoolPid(p)?.pid !== first && pool.readPoolPid(p)?.pid);
    assert.ok(second, `a fresh pool replaced the stale record (log: ${poolLog(p)})`);
    assert.equal(alive(second), true);
    assert.deepEqual(poolProcs(p), [second]);
  });

  it("an idle pool exits on its own after dispatch.idleExitMinutes, and the next ensure brings it back", async (t) => {
    const p = repoStore({ idleExitMinutes: 0.02 }, t); // 1.2 s with nothing to do
    assert.equal(tm(p, "pool", "ensure").status, 0);
    const pid = await until(() => pool.readPoolPid(p)?.pid);
    assert.ok(pid);

    const gone = await until(() => !alive(pid), 8000);

    assert.ok(gone, `the idle pool exited (log: ${poolLog(p)})`);
    assert.match(poolLog(p), /pool: idle — exiting/);
    assert.equal(pool.readPoolPid(p), null, "and released pool.pid");

    assert.equal(tm(p, "pool", "ensure").status, 0);
    assert.ok(await until(() => pool.readPoolPid(p)?.pid), "the next ensure starts a new one");
  });

  it("a pool with work to do does not idle out", async (t) => {
    const p = repoStore({ idleExitMinutes: 0.02, poolWip: 0 }, t); // poolable work it cannot start yet
    complete(p, "waiting for a slot");
    assert.equal(tm(p, "pool", "ensure").status, 0);
    const pid = await until(() => pool.readPoolPid(p)?.pid);
    assert.ok(pid);

    await sleep(3000);

    assert.equal(alive(pid), true, `a queue is not idle (log: ${poolLog(p)})`);
  });
});

describe("TM-178 — the triggers", () => {
  it("the user-prompt hook starts a pool when none is live, and still prints its own output only", async (t) => {
    const p = repoStore({}, t);

    const r = spawnSync(process.execPath, [TM, "hook", "user-prompt"], {
      cwd: p.root,
      env: env(p),
      input: JSON.stringify({ cwd: p.root, prompt: "just a prompt" }),
      encoding: "utf8",
      timeout: 20000,
      killSignal: "SIGKILL",
    });

    assert.equal(r.status, 0, r.stderr);
    assert.equal(r.stdout.includes("pool:"), false, "the trigger is silent on the hook's stdout");
    assert.ok(await until(() => pool.readPoolPid(p)?.pid), "a pool is running after one prompt");
  });

  it("tm config dispatch.enabled true starts a pool at once", async (t) => {
    const p = repoStore({ enabled: false }, t);
    assert.equal(tm(p, "pool", "ensure").status, 0);
    assert.deepEqual(poolProcs(p), [], "control: nothing runs while it is off");

    const r = tm(p, "config", "dispatch.enabled", "true");

    assert.equal(r.status, 0, r.stderr);
    assert.ok(await until(() => pool.readPoolPid(p)?.pid), "turning it on starts the pool without waiting for a session");
  });

  it("the dashboard settings save starts a pool when a dispatch key changes", async (t) => {
    const p = repoStore({ enabled: false }, t);
    const { applySettings } = await import("../../lib/settings.mjs");

    applySettings({ "dispatch.enabled": true }, p);

    assert.ok(await until(() => pool.readPoolPid(p)?.pid), "the settings write started the pool");
  });
});

describe("TM-178 — pool status carries what the dashboard needs", () => {
  it("reports idleExitMinutes and the log path", async (t) => {
    const p = repoStore({ idleExitMinutes: 5 }, t);

    const r = tm(p, "pool", "status", "--json");

    assert.equal(r.status, 0, r.stderr);
    const status = JSON.parse(r.stdout);
    assert.equal(status.idleExitMinutes, 5);
    assert.equal(status.log, join(p.base, "pool.log"));
    assert.equal(status.enabled, true, "the existing shape is unchanged");
    assert.equal(status.running, false);
  });

  it("pool.log is in the store's git contract, like pool.pid", async () => {
    const { NOT_FOR_GIT } = await import("../../lib/store.mjs");
    assert.ok(NOT_FOR_GIT.includes("pool.log"));
    const p = repoStore();
    assert.match(readFileSync(p.gitignore, "utf8"), /^pool\.log$/m, "the seeded .gitignore covers it");
  });
});
