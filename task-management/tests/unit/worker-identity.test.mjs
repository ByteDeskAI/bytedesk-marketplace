/**
 * TM-470 — a dispatched worker is decided by recorded dispatch ancestry, not by an env var it owns.
 *
 * The live tests build a real process tree: an `sh` stands in for the worker's pane (its pid is the
 * recorded anchor), and the probe runs BELOW it with `env -u TM_DISPATCH_WORKER`. The same probe run
 * from the test process — outside that tree, same registry — is the control.
 */
import { after, describe, it } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawn, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { cleanup, tempRepo } from "./helpers.mjs";
import { ensureDirs, paths } from "../../lib/paths.mjs";
import { create, read, seedGitContract, update } from "../../lib/store.mjs";
import { dispatch } from "../../lib/dispatch/index.mjs";
import * as tmux from "../../lib/dispatch/tmux.mjs";
import { WORKER_RULE, isWorkerCaller, parseRepoSlug, recordWorker, repoSlug, startTime, workerRecordFor } from "../../lib/worker-identity.mjs";

const PLUGIN_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const LIB = join(PLUGIN_ROOT, "lib");
const HOOK = join(PLUGIN_ROOT, "hooks", "tm-hook.sh");
const trash = [];
after(() => cleanup(...trash));

function scratch() {
  const dir = mkdtempSync(join(tmpdir(), "tm-worker-id-"));
  trash.push(dir);
  return dir;
}

/** The env a probe runs with: no marker inherited from whoever runs this suite, plus `extra`. */
function cleanEnv(extra = {}) {
  const env = { ...process.env, TMUX: "" };
  for (const k of ["TM_DISPATCH_WORKER", "TM_DISPATCH_TASK", "TM_DISPATCH_BRANCH", "TM_DISPATCH_INTEGRATION_BRANCH", "TM_DISPATCH_GOVERNED", "TM_ROOT", "TM_WORKER_REGISTRY"]) delete env[k];
  return { ...env, ...extra };
}

/** What a probe prints: the predicate's verdict and what each tm worker refusal says. */
const PROBE = `
import { isWorkerCaller } from ${JSON.stringify(join(LIB, "worker-identity.mjs"))};
import { governTask, readyForReview } from ${JSON.stringify(join(LIB, "governance.mjs"))};
import { governedCompletion } from ${JSON.stringify(join(LIB, "governance-check.mjs"))};
import { paths } from ${JSON.stringify(join(LIB, "paths.mjs"))};
const p = paths(process.env.PROBE_ROOT);
const msg = (fn) => { try { fn(); return "ok"; } catch (e) { return e.message; } };
console.log(JSON.stringify({
  who: isWorkerCaller(),
  govern: msg(() => governTask("TM-001", { workflowRunId: "w", leadId: "l", recordPath: "/r", p })),
  review: msg(() => readyForReview("TM-002", { revision: "x", p })),
  completion: governedCompletion({ id: "TM-001", governance: { version: 1 } }, p).reason ?? "allow",
}));
`;

/**
 * Run argv BELOW a stand-in pane: the anchor `sh` waits until its pid is recorded, then runs argv as a
 * child (not exec — `; :` keeps the shell alive) with `env -u TM_DISPATCH_WORKER`. Resolves {stdout, code}.
 */
async function underAnchor(argv, { registry, record, env, input = "" }) {
  const go = join(scratch(), "go");
  const stdin = join(dirname(go), "stdin");
  writeFileSync(stdin, input);
  const script = 'while [ ! -f "$0" ]; do sleep 0.02; done; env -u TM_DISPATCH_WORKER "$@" < "$STDIN_FILE"; echo "exit=$?"; :';
  const child = spawn("sh", ["-c", script, go, ...argv], { env: { ...env, TM_DISPATCH_WORKER: "1", STDIN_FILE: stdin }, stdio: ["ignore", "pipe", "pipe"] });
  let out = "";
  let err = "";
  child.stdout.on("data", (d) => (out += d));
  child.stderr.on("data", (d) => (err += d));
  const written = recordWorker([child.pid], record, { dir: registry });
  assert.equal(written.length, 1, "the anchor was recorded");
  writeFileSync(go, "");
  await new Promise((resolve) => child.on("close", resolve));
  const code = Number(/exit=(\d+)/.exec(out)?.[1]);
  return { stdout: out.replace(/exit=\d+\n?$/, ""), stderr: err, code };
}

function store() {
  const root = tempRepo();
  trash.push(root);
  const p = paths(root);
  ensureDirs(p);
  seedGitContract(p);
  return p;
}

describe("worker-identity — the rule", () => {
  it("a live anchor in the ancestry decides; a recycled pid (other start time) does not", () => {
    const rec = { pid: 500, start: "77", task: "TM-1" };
    assert.equal(workerRecordFor([900, 500, 1], [rec], () => "77"), rec);
    assert.equal(workerRecordFor([900, 500, 1], [rec], () => "78"), null, "same pid, different process");
    assert.equal(workerRecordFor([900, 400, 1], [rec], () => "77"), null, "not an ancestor");
    assert.match(WORKER_RULE, /ancestry/);
  });

  it("the env marker adds a worker but its absence removes none", () => {
    const dir = scratch();
    assert.deepEqual(isWorkerCaller({ env: { TM_DISPATCH_WORKER: "1" }, pids: [123456789], dirs: [dir] }).via, "env");
    assert.equal(isWorkerCaller({ env: {}, pids: [123456789], dirs: [dir] }).worker, false);
    recordWorker([process.pid], { task: "TM-7" }, { dir });
    const who = isWorkerCaller({ env: {}, pids: [process.pid], dirs: [dir] });
    assert.equal(who.worker, true);
    assert.equal(who.via, "ancestry");
    assert.equal(who.record.task, "TM-7");
  });

  it("a record whose anchor is gone is pruned", () => {
    const dir = scratch();
    const dead = spawnSync("true").pid;
    writeFileSync(join(dir, `${dead}.json`), JSON.stringify({ pid: dead, start: "1", task: "TM-9" }));
    assert.equal(isWorkerCaller({ env: {}, pids: [dead], dirs: [dir] }).worker, false);
    assert.deepEqual(readdirSync(dir), [], "the stale record was removed");
  });
});

describe("worker-identity — env -u TM_DISPATCH_WORKER from inside the worker's process tree", () => {
  it("is still a worker, and every tm worker refusal still refuses; outside the tree, none is", async () => {
    const registry = scratch();
    const p = store();
    const probe = join(scratch(), "probe.mjs");
    writeFileSync(probe, PROBE);
    const env = cleanEnv({ TM_WORKER_REGISTRY: registry, PROBE_ROOT: p.root });

    const inside = await underAnchor([process.execPath, probe], { registry, record: { task: "TM-001", branch: "tm/x" }, env });
    const got = JSON.parse(inside.stdout);
    console.log(`# inside, marker unset: ${JSON.stringify(got)}`);
    assert.equal(got.who.worker, true, inside.stderr);
    assert.equal(got.who.via, "ancestry");
    assert.equal(got.who.record.task, "TM-001");
    assert.match(got.govern, /dispatched worker cannot grant/);
    assert.match(got.review, /may submit only its own task/);
    assert.match(got.completion, /workers finish at ready-for-review/);

    // The control: the same probe, same registry, from outside the recorded tree.
    const outside = spawnSync(process.execPath, [probe], { env, encoding: "utf8" });
    const ctl = JSON.parse(outside.stdout);
    console.log(`# outside: ${JSON.stringify(ctl)}`);
    assert.equal(ctl.who.worker, false);
    assert.doesNotMatch(ctl.govern, /dispatched worker/);
    assert.doesNotMatch(ctl.review, /dispatched worker/);
    assert.doesNotMatch(ctl.completion, /workers finish/);
  });

  it("the pre-bash hook still guards it, marker unset; outside the tree it stands aside", async () => {
    const registry = scratch();
    const repo = tempRepo();
    trash.push(repo);
    const input = JSON.stringify({ tool_name: "Bash", tool_input: { command: "git push --force origin main" }, cwd: repo });
    const env = cleanEnv({ TM_WORKER_REGISTRY: registry });
    const inside = await underAnchor(["sh", HOOK, "pre-bash"], { registry, record: { task: "TM-001", branch: "tm/x", integrationBranch: "main" }, env, input });
    assert.equal(inside.code, 2, `refused inside the tree (stderr: ${inside.stderr})`);
    assert.match(inside.stderr, /dispatch guard/);
    assert.doesNotMatch(inside.stderr, /TM-001/, "the task is never taken from the record (TM-481 C1)");
    const outside = spawnSync("sh", [HOOK, "pre-bash"], { input, env, encoding: "utf8" });
    assert.equal(outside.status, 0, outside.stderr);
  });
});

describe("TM-481 C1 — a forged registry record never relaxes the guard", () => {
  /** A worker pinned at spawn (harness env) to an OPEN task, and a record rewritten to point elsewhere. */
  function forged() {
    const real = store();
    const fake = store();
    const task = create("task", { title: "open work" }, "body", real);
    const twin = create("task", { title: "forged twin" }, "body", fake);
    assert.equal(twin.id, task.id, "precondition: the fake store mints the same id");
    update(twin.id, { status: "done" }, fake);
    return { real, fake, task };
  }
  const hookIn = (registry, record, env, command, cwd) =>
    underAnchor(["sh", HOOK, "pre-bash"], { registry, record, env, input: JSON.stringify({ tool_name: "Bash", tool_input: { command }, cwd }) });

  it("a record whose root points at a store where the task is `done` does not release it", async () => {
    const { real, fake, task } = forged();
    const registry = scratch();
    const env = cleanEnv({ TM_WORKER_REGISTRY: registry, TM_DISPATCH_TASK: task.id, TM_DISPATCH_BRANCH: "tm/x", TM_DISPATCH_INTEGRATION_BRANCH: "main", TM_ROOT: real.root });
    const record = { task: task.id, branch: "main", integrationBranch: "main", root: fake.root };
    for (const command of ["gh pr merge 12 --admin", "git push --force origin main"]) {
      const r = await hookIn(registry, record, env, command, real.root);
      console.log(`# forged record, ${command}: exit ${r.code}`);
      assert.equal(r.code, 2, `${command} stays refused (stderr: ${r.stderr})`);
    }
  });

  it("a record that disagrees with the spawn-time env is itself refused", async () => {
    const { real, task } = forged();
    const registry = scratch();
    const env = cleanEnv({ TM_WORKER_REGISTRY: registry, TM_DISPATCH_TASK: task.id, TM_DISPATCH_BRANCH: "tm/x", TM_ROOT: real.root });
    const r = await hookIn(registry, { task: task.id, branch: "tm/evil", root: real.root }, env, "git status", real.root);
    assert.equal(r.code, 2, r.stderr);
    assert.match(r.stderr, /disagrees/);
  });

  it("a record cannot supply a branch the env lacks", async () => {
    const registry = scratch();
    const repo = tempRepo();
    trash.push(repo);
    const r = await hookIn(registry, { task: "TM-001", branch: "tm/evil" }, cleanEnv({ TM_WORKER_REGISTRY: registry }), "git push origin tm/evil", repo);
    assert.equal(r.code, 2, `no branch was pinned at spawn, so no push is the worker's (stderr: ${r.stderr})`);
  });
});

describe("TM-470 M1 — a dispatched task whose registry record is gone fails closed", () => {
  const self = () => ({ pid: process.pid, start: startTime(process.pid) });
  it("a live anchor on the task with no registry record makes the caller a worker", () => {
    const dir = scratch();
    const task = { id: "TM-1", dispatched: { anchors: [self()] } };
    const who = isWorkerCaller({ env: {}, pids: [987654321], dirs: [dir], task });
    assert.equal(who.worker, true);
    assert.equal(who.via, "missing-record");
    recordWorker([process.pid], { task: "TM-1" }, { dir });
    assert.equal(isWorkerCaller({ env: {}, pids: [987654321], dirs: [dir], task }).worker, false, "record present, caller outside the tree");
    assert.equal(isWorkerCaller({ env: {}, pids: [process.pid], dirs: [scratch()], task }).via, "task-anchor");
    const dead = spawnSync("true").pid;
    assert.equal(isWorkerCaller({ env: {}, pids: [987654321], dirs: [scratch()], task: { dispatched: { anchors: [{ pid: dead, start: "1" }] } } }).worker, false, "a dead anchor is just history");
  });

  it("governedCompletion refuses on that task, from OUTSIDE the worker's tree, when its record was deleted", async () => {
    const { governedCompletion } = await import("../../lib/governance-check.mjs");
    const saved = { reg: process.env.TM_WORKER_REGISTRY, w: process.env.TM_DISPATCH_WORKER };
    process.env.TM_WORKER_REGISTRY = scratch();
    delete process.env.TM_DISPATCH_WORKER;
    // The worker's pane: a live process that is not this test's ancestor, with no registry record.
    const pane = spawn("sleep", ["30"], { stdio: "ignore" });
    try {
      await new Promise((r) => setTimeout(r, 50));
      const anchor = { pid: pane.pid, start: startTime(pane.pid) };
      assert.ok(anchor.start, "the stand-in pane is alive");
      const gate = governedCompletion({ id: "TM-001", governance: { version: 1 }, dispatched: { anchors: [anchor] } }, store());
      assert.equal(gate.allow, false);
      assert.match(gate.reason, /workers finish at ready-for-review/);
    } finally {
      pane.kill();
      if (saved.reg === undefined) delete process.env.TM_WORKER_REGISTRY;
      else process.env.TM_WORKER_REGISTRY = saved.reg;
      if (saved.w !== undefined) process.env.TM_DISPATCH_WORKER = saved.w;
    }
  });
});

describe("worker-identity — dispatch records the anchor", () => {
  it("the tmux backend asks tmux for the pane pid and reports it as the anchor", () => {
    const req = { task: { id: "TM-001" }, worktree: scratch(), prompt: "p", branch: "tm/x", p: { root: scratch() } };
    const res = tmux.spawn(req, { spawnImpl: () => ({ status: 0, stdout: "4242\n" }), writeImpl: () => {} });
    assert.deepEqual(res.anchors, [4242]);
    const args = res.detail.args;
    assert.deepEqual(args.slice(args.indexOf("-P"), args.indexOf("-P") + 3), ["-P", "-F", "#{pane_pid}"]);
  });

  it("dispatch() writes the backend's anchors to the registry with the task, branch and governance", async () => {
    const registry = scratch();
    const saved = process.env.TM_WORKER_REGISTRY;
    process.env.TM_WORKER_REGISTRY = registry;
    try {
      const p = store();
      const t = create("task", { title: "anchor me" }, "body", p);
      const seen = [];
      const backend = { name: "fake", available: () => true, spawn: (req) => (seen.push(req), { ok: true, run: "fake:1", anchors: [process.pid] }) };
      const res = await dispatch(t.id, { backend, session: "s-anchor", actor: "@bot", p, caps: {} });
      assert.equal(res.ok, true, res.reason);
      // TM-481: governance and the pinned repository reach the backend (and so the worker's env).
      // This fixture has no origin, so no repository is pinned — and a worker with none cannot merge.
      assert.equal(seen[0].governed, false);
      assert.ok("repo" in seen[0], "the pinned repository is passed to the backend");
      assert.equal(seen[0].repo, null);
      assert.equal(Object.fromEntries(tmux.workerEnv({ ...seen[0], repo: "acme/widgets", governed: true })).TM_DISPATCH_REPO, "acme/widgets");
      assert.equal(Object.fromEntries(tmux.workerEnv({ ...seen[0], governed: true })).TM_DISPATCH_GOVERNED, "1");
      const remote = tempRepo();
      trash.push(remote);
      execFileSync("git", ["-C", remote, "remote", "add", "origin", "git@github.com:acme/widgets.git"]);
      assert.equal(repoSlug(remote), "acme/widgets");
      for (const url of ["https://github.com/acme/widgets", "https://github.com/acme/widgets.git", "ssh://git@github.com/acme/widgets.git"]) assert.equal(parseRepoSlug(url), "acme/widgets", url);
      assert.equal(parseRepoSlug("https://gitlab.com/acme/widgets"), null);
      // TM-470 M1: the anchor is on the task too, so a deleted registry record fails closed.
      assert.deepEqual(read(t.id, p).dispatched.anchors, [{ pid: process.pid, start: startTime(process.pid) }]);
      const file = join(registry, `${process.pid}.json`);
      assert.ok(existsSync(file), "the anchor record exists");
      const rec = JSON.parse(readFileSync(file, "utf8"));
      assert.equal(rec.task, t.id);
      assert.equal(rec.branch, res.branch);
      assert.equal(rec.governed, false);
      assert.equal(rec.start, startTime(process.pid));
    } finally {
      if (saved === undefined) delete process.env.TM_WORKER_REGISTRY;
      else process.env.TM_WORKER_REGISTRY = saved;
    }
  });
});

describe("worker-identity — rule 3: every tm worker refusal uses the one predicate", () => {
  it("nothing in lib/ or bin/ decides worker-ness from TM_DISPATCH_WORKER except worker-identity.mjs", () => {
    const files = [];
    const walk = (dir) => {
      for (const e of readdirSync(dir, { withFileTypes: true })) {
        const f = join(dir, e.name);
        if (e.isDirectory()) walk(f);
        else files.push(f);
      }
    };
    walk(join(PLUGIN_ROOT, "lib"));
    walk(join(PLUGIN_ROOT, "bin"));
    assert.ok(files.length > 20, `the walk found the sources (${files.length})`);
    const readers = files.filter((f) => !f.endsWith("worker-identity.mjs") && /env\.TM_DISPATCH_WORKER|env\[["']TM_DISPATCH_WORKER/.test(readFileSync(f, "utf8")));
    assert.deepEqual(readers, []);
    const users = files.filter((f) => /isWorkerCaller\(/.test(readFileSync(f, "utf8"))).map((f) => f.slice(PLUGIN_ROOT.length + 1)).sort();
    console.log(`# isWorkerCaller callers: ${users.join(", ")}`);
    for (const f of ["bin/tm-hook", "lib/governance-check.mjs", "lib/governance.mjs"]) assert.ok(users.includes(f), `${f} uses the predicate`);
  });
});
