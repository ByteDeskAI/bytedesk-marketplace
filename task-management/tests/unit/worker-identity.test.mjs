/**
 * TM-470 — a dispatched worker is decided by recorded dispatch ancestry, not by an env var it owns.
 *
 * The live tests build a real process tree: an `sh` stands in for the worker's pane (its pid is the
 * recorded anchor), and the probe runs BELOW it with `env -u TM_DISPATCH_WORKER`. The same probe run
 * from the test process — outside that tree, same registry — is the control.
 */
import { after, describe, it } from "node:test";
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { cleanup, tempRepo } from "./helpers.mjs";
import { ensureDirs, paths } from "../../lib/paths.mjs";
import { create, seedGitContract } from "../../lib/store.mjs";
import { dispatch } from "../../lib/dispatch/index.mjs";
import * as tmux from "../../lib/dispatch/tmux.mjs";
import { WORKER_RULE, isWorkerCaller, recordWorker, startTime, workerRecordFor } from "../../lib/worker-identity.mjs";

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
    assert.match(inside.stderr, /TM-001.*force/s, "the task comes from the record, not the env");
    const outside = spawnSync("sh", [HOOK, "pre-bash"], { input, env, encoding: "utf8" });
    assert.equal(outside.status, 0, outside.stderr);
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
      const backend = { name: "fake", available: () => true, spawn: () => ({ ok: true, run: "fake:1", anchors: [process.pid] }) };
      const res = await dispatch(t.id, { backend, session: "s-anchor", actor: "@bot", p, caps: {} });
      assert.equal(res.ok, true, res.reason);
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
