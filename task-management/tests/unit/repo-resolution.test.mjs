/**
 * TM-320 — repo resolution fails closed, `--repo` names a repo outright, and a repo nobody ran
 * `tm init` in is left alone.
 *
 * Everything here runs the real binaries as child processes with a scrubbed environment (no
 * TM_ROOT, no CLAUDE_PROJECT_DIR, a throwaway HOME, TMUX blank) — the guards live in how a
 * process resolves its own cwd and environment, which an in-process call cannot reproduce. Each
 * refusal case also asserts that NOTHING was created, because "refused" with a store left behind
 * is the failure this exists to stop.
 */
import { after, describe, it } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { addWorktree, cleanup, git, tempRepo } from "./helpers.mjs";
import { ensureDirs, isInitialized, paths } from "../../lib/paths.mjs";
import { ensurePool } from "../../lib/dispatch/pool.mjs";
import { diagnose } from "../../lib/doctor.mjs";

const BIN = resolve(import.meta.dirname, "..", "..", "bin");
const trash = [];
after(() => cleanup(...trash));

const scratch = (prefix = "tm-resolve-") => {
  const d = mkdtempSync(join(tmpdir(), prefix));
  trash.push(d);
  return d;
};
const repo = () => {
  const r = tempRepo();
  trash.push(r);
  return r;
};

/** A directory that is provably in no git work tree: mkdtemp under the system temp dir. */
const nonRepo = () => {
  const d = scratch("tm-nonrepo-");
  assert.equal(spawnSync("git", ["-C", d, "rev-parse", "--git-dir"], { encoding: "utf8" }).status !== 0, true, "fixture must not be inside a repo");
  return d;
};

const HOME = scratch("tm-home-");
const baseEnv = () => ({ PATH: process.env.PATH, HOME, TMUX: "", TMUX_TMPDIR: HOME, LANG: "C" });

function run(bin, args, { cwd, env = {}, input } = {}) {
  const res = spawnSync(process.execPath, [join(BIN, bin), ...args], { cwd, env: { ...baseEnv(), ...env }, input, encoding: "utf8", timeout: 60000 });
  return { status: res.status, stdout: res.stdout, stderr: res.stderr, all: `${res.stdout}${res.stderr}` };
}
const tm = (args, opts) => run("tm", args, opts);

/** Every `.bytedesk` anywhere under dir — including inside .git. `find`, not a walk of ours. */
const stores = (dir) => execFileSync("find", [dir, "-name", ".bytedesk"], { encoding: "utf8" }).trim().split("\n").filter(Boolean);

const store = (root) => join(root, ".bytedesk", "task-management");

describe("fail closed when the repo is ambiguous", () => {
  it("run from a directory that is not a repository: refuses, names --repo, creates nothing", () => {
    const dir = nonRepo();
    for (const args of [["init"], ["board"], ["task", "new", "x", "--body", "y"]]) {
      const r = tm(args, { cwd: dir });
      assert.notEqual(r.status, 0, `tm ${args[0]} must not succeed: ${r.all}`);
      assert.match(r.stderr, /--repo/, `the refusal names --repo: ${r.stderr}`);
    }
    assert.deepEqual(stores(dir), [], "no store was created in a bare cwd");
  });

  it("run from inside a submodule: refuses, names --repo, creates nothing in the parent's .git", () => {
    const parent = repo();
    const lib = repo();
    git(parent, "-c", "protocol.file.allow=always", "submodule", "add", "-q", lib, "sub");
    const sub = join(parent, "sub");
    const r = tm(["init"], { cwd: sub });
    assert.notEqual(r.status, 0, r.all);
    assert.match(r.stderr, /submodule/);
    assert.match(r.stderr, /--repo/);
    assert.deepEqual(stores(parent), [], "nothing under the parent, .git/modules included");
    // ...and naming the submodule explicitly is allowed: it is its own repository.
    const ok = tm(["--repo", sub, "init"], { cwd: sub });
    assert.equal(ok.status, 0, ok.all);
    assert.equal(existsSync(join(store(sub), "config.json")), true);
    assert.deepEqual(stores(join(parent, ".git")), [], "still nothing inside the parent's .git");
  });

  it("a stale CLAUDE_PROJECT_DIR naming another repo: refuses, names --repo, creates nothing", () => {
    const stale = repo();
    const here = repo();
    const r = tm(["init"], { cwd: here, env: { CLAUDE_PROJECT_DIR: stale } });
    assert.notEqual(r.status, 0, r.all);
    assert.match(r.stderr, /CLAUDE_PROJECT_DIR/);
    assert.match(r.stderr, /--repo/);
    assert.deepEqual([...stores(stale), ...stores(here)], [], "neither repo got a store");
    // The same stale variable is harmless once the caller says which repo it means.
    const ok = tm(["--repo", here, "init"], { cwd: here, env: { CLAUDE_PROJECT_DIR: stale } });
    assert.equal(ok.status, 0, ok.all);
    assert.deepEqual(stores(stale), [], "--repo beats the inherited variable");
    assert.equal(existsSync(store(here)), true);
  });

  it("a CLAUDE_PROJECT_DIR that agrees with cwd (a worktree of the same repo) needs no flag", () => {
    const main = repo();
    const wt = addWorktree(main, "agree");
    trash.push(wt);
    const r = tm(["init"], { cwd: wt, env: { CLAUDE_PROJECT_DIR: main } });
    assert.equal(r.status, 0, r.all);
    assert.equal(existsSync(join(store(main), "config.json")), true, "one store, in the main checkout");
    assert.deepEqual(stores(wt), [], "the worktree has none of its own");
  });

  it("TM_ROOT set to a directory that does not exist: refuses, names --repo, creates nothing", () => {
    const here = repo();
    const missing = join(scratch(), "not-there");
    const r = tm(["init"], { cwd: here, env: { TM_ROOT: missing } });
    assert.notEqual(r.status, 0, r.all);
    assert.match(r.stderr, /TM_ROOT/);
    assert.match(r.stderr, /--repo/);
    assert.equal(existsSync(missing), false, "the missing TM_ROOT was not created");
    assert.deepEqual(stores(here), [], "and it did not fall through to cwd");
  });

  it("inside a repository the normal case needs no flag", () => {
    const here = repo();
    const r = tm(["init"], { cwd: here });
    assert.equal(r.status, 0, r.all);
    assert.equal(existsSync(join(store(here), "config.json")), true);
  });
});

describe("--repo", () => {
  it("names the repo from outside any repository, as `--repo dir` and `--repo=dir`", () => {
    const target = repo();
    const outside = nonRepo();
    const init = tm(["--repo", target, "init"], { cwd: outside });
    assert.equal(init.status, 0, init.all);
    assert.deepEqual(stores(outside), [], "nothing next to where the command ran");
    const a = tm(["--repo", target, "board"], { cwd: outside });
    const b = tm([`--repo=${target}`, "board"], { cwd: outside });
    assert.equal(a.status, 0, a.all);
    assert.equal(b.status, 0, b.all);
    // Placement is free: the flag is global, not positional.
    assert.equal(tm(["board", "--repo", target], { cwd: outside }).status, 0);
  });

  it("is stripped before verbs see it, and a value-less --repo is refused rather than ignored", () => {
    const target = repo();
    assert.equal(tm(["--repo", target, "init"], { cwd: nonRepo() }).status, 0);
    const bare = tm(["board", "--repo"], { cwd: target });
    assert.equal(bare.status, 2, bare.all);
    assert.match(bare.stderr, /--repo needs a directory/);
  });

  it("a --repo that does not exist is an error, not a fall-through to cwd", () => {
    const here = repo();
    const r = tm(["--repo", join(scratch(), "nope"), "init"], { cwd: here });
    assert.notEqual(r.status, 0);
    assert.match(r.stderr, /does not exist/);
    assert.deepEqual(stores(here), []);
  });

  it("is accepted by tm-dashboard's strict flag list (not mistaken for an unknown option)", () => {
    const target = repo();
    const outside = nonRepo();
    // Uninitialized target: the dashboard exits 0 having created nothing — the point is that
    // `--repo <dir>` got past the allowlist, which exits 2 on anything it does not know.
    const r = run("tm-dashboard", ["--repo", target], { cwd: outside });
    assert.equal(r.status, 0, r.all);
    assert.deepEqual([...stores(target), ...stores(outside)], []);
    const unknown = run("tm-dashboard", ["--bogus"], { cwd: outside });
    assert.equal(unknown.status, 2, "the allowlist still refuses what it does not know");
    // And naming no repo from outside one gives --status something to say that names --repo.
    const status = run("tm-dashboard", ["--status"], { cwd: outside });
    assert.equal(status.status, 1);
    assert.match(status.stderr, /--repo/);
  });
});

describe("a hook payload's cwd inside a linked worktree", () => {
  it("gives the store, the branch and the actor stamp from the same repo (TM-190)", () => {
    const main = repo();
    assert.equal(tm(["init"], { cwd: main }).status, 0);
    const wt = addWorktree(main, "hook", "feat/from-payload");
    trash.push(wt);
    // The hook process itself stands nowhere useful: not a repo, no CLAUDE_PROJECT_DIR.
    const outside = nonRepo();
    const payload = JSON.stringify({ cwd: wt, session_id: "s-1", tool_name: "TaskCreate", tool_input: { subject: "Mirrored from a worktree", description: "body" }, tool_response: { id: "7" } });
    // An active epic satisfies the create gate the mirror goes through.
    assert.equal(tm(["epic", "new", "Fixture epic", "--body", "b"], { cwd: main }).status, 0);
    const r = tm(["hook", "post-task"], { cwd: outside, input: payload });
    assert.equal(r.status, 0, r.all);

    const tasksDir = join(store(main), "tasks");
    const file = readdirSync(tasksDir).find((f) => /mirrored-from-a-worktree/i.test(f));
    assert.ok(file, `the task landed in the MAIN checkout's store: ${readdirSync(tasksDir)}`);
    const text = readFileSync(join(tasksDir, file), "utf8");
    assert.match(text, /branch: "?feat\/from-payload"?/, "the branch is the worktree's, not the process cwd's (none)");
    assert.ok(text.includes(`worktree: ${JSON.stringify(realpathSync(wt))}`), "the worktree is the payload's directory");
    assert.deepEqual(stores(wt), [], "the worktree grew no store of its own");
    assert.deepEqual(stores(outside), []);
  });
});

describe("a repository nobody ran `tm init` in is left alone", () => {
  it("tm-dashboard, session-start, pool ensure and the MCP server create nothing", () => {
    const here = repo();

    const dash = run("tm-dashboard", [], { cwd: here });
    assert.equal(dash.status, 0, dash.all);

    const start = tm(["hook", "session-start"], { cwd: nonRepo(), input: JSON.stringify({ cwd: here, session_id: "s-2" }) });
    assert.equal(start.status, 0, start.all);

    const pool = tm(["pool", "ensure"], { cwd: here });
    assert.equal(pool.status, 0, pool.all);

    const lines = [
      { jsonrpc: "2.0", id: 1, method: "initialize", params: {} },
      { jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "tm_task_create", arguments: { title: "x", body: "y", acceptance: ["z"] } } },
      { jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "tm_board", arguments: {} } },
    ].map((l) => JSON.stringify(l)).join("\n");
    const mcp = run("tm-mcp", [], { cwd: here, input: `${lines}\n` });
    assert.equal(mcp.status, 0, mcp.all);
    const replies = mcp.stdout.trim().split("\n").map((l) => JSON.parse(l));
    for (const id of [2, 3]) {
      const text = replies.find((x) => x.id === id).result.content[0].text;
      assert.match(text, /not initialized/, `tool call ${id} is refused for lack of init: ${text}`);
    }

    assert.deepEqual(stores(here), [], "find .bytedesk is empty — nothing was created anywhere");
  });

  it("the MCP server takes a per-call repo, and a startup --repo, and refuses with --repo named when it has neither", () => {
    const target = repo();
    assert.equal(tm(["init"], { cwd: target }).status, 0);
    const outside = nonRepo();
    const call = (args, extra = []) => {
      const line = JSON.stringify({ jsonrpc: "2.0", id: 9, method: "tools/call", params: { name: "tm_board", arguments: args } });
      const r = run("tm-mcp", extra, { cwd: outside, input: `${line}\n` });
      return JSON.parse(r.stdout.trim().split("\n")[0]).result.content[0].text;
    };
    assert.match(call({}), /--repo|repo/, "no repo established from outside one is refused");
    assert.doesNotMatch(call({ repo: target }), /not initialized|--repo/, "a per-call repo is honoured");
    assert.doesNotMatch(call({}, ["--repo", target]), /not initialized|--repo/, "a startup --repo is honoured");
    assert.deepEqual(stores(outside), []);
  });

  it("ensureDirs will not create a store from nothing, and ensurePool will not write into one", () => {
    const here = repo();
    const p = paths(here);
    assert.throws(() => ensureDirs(p), /not initialized/);
    assert.equal(existsSync(p.base), false);
    assert.equal(ensurePool(p, { spawnImpl: () => assert.fail("spawned a pool") }).action, "uninitialized");
    assert.equal(existsSync(p.base), false, "pool.log was not written");
    ensureDirs(p, { init: true });
    assert.equal(existsSync(p.base), true, "`tm init` still can");
  });

  it("initialized means config.json: a bare store directory is not opted in, and doctor says so", () => {
    const here = repo();
    const p = paths(here);
    mkdirSync(p.base, { recursive: true });
    assert.equal(isInitialized(p), false, "a directory alone is not opt-in");
    const finding = diagnose(p).find((f) => f.code === "store-no-config");
    assert.ok(finding, "doctor flags it instead of silently disabling the board");
    assert.equal(finding.level, "error");
    writeFileSync(p.config, "{}\n");
    assert.equal(isInitialized(p), true);
    assert.equal(diagnose(p).some((f) => f.code === "store-no-config"), false, "and stops once config.json exists");
    // The CLI path: `tm doctor` on a config-less store reports it rather than dying on requireInit.
    rmSync(p.config);
    const r = tm(["doctor"], { cwd: here });
    assert.equal(r.status, 1, r.all);
    assert.match(r.stdout, /store-no-config|no config\.json/);
  });
});

describe("the worker release guard goes through resolveRoot", () => {
  it("a payload cwd in a worktree reads the main checkout's task, so the guard releases", () => {
    const main = repo();
    assert.equal(tm(["init"], { cwd: main }).status, 0);
    assert.equal(tm(["epic", "new", "E", "--body", "b"], { cwd: main }).status, 0);
    const made = tm(["task", "new", "guarded", "--body", "b", "--ac", "c"], { cwd: main });
    assert.equal(made.status, 0, made.all);
    const id = /TM-\d+/.exec(made.all)[0];
    // Resolve the task by hand: a done task is what releases a worker.
    const tasks = join(store(main), "tasks");
    const f = join(tasks, readdirSync(tasks).find((n) => n.startsWith(id)));
    // The store identifies a worker's task by the branch it recorded; drop the creator's own and pin the worker's.
    writeFileSync(f, readFileSync(f, "utf8").replace(/^branch: .*\n/m, "").replace(/^status: .*$/m, "status: done\nbranch: feat/guard"));
    const wt = addWorktree(main, "guard", "feat/guard");
    trash.push(wt);
    const payload = JSON.stringify({ cwd: wt, tool_input: { command: "git push --force origin main" } });
    const hook = (env) => spawnSync(process.execPath, [join(BIN, "tm-hook"), "pre-bash"], { cwd: nonRepo(), input: payload, encoding: "utf8", env: { ...baseEnv(), TM_DISPATCH_WORKER: "1", TM_DISPATCH_TASK: id, TM_DISPATCH_BRANCH: "feat/guard", ...env } });
    // The worktree has no .bytedesk of its own; only a canonicalized lookup finds the done task.
    { const h = hook({}); assert.equal(h.status, 0, `released: the task is done in the main checkout's store - ${h.stderr}`); }
    // A worker whose task is NOT resolved stays guarded — the force push is refused.
    writeFileSync(f, readFileSync(f, "utf8").replace(/^status: .*$/m, "status: in_progress"));
    assert.equal(hook({}).status, 2, "guarded while the task is open");
  });
});
