/**
 * TM-375: a tmux-dispatched worker inherits the secrets named in `dispatch.passEnv` (tm config) or
 * `workers.passEnv` (the repository's agent-orchestration config). Names are config; values come
 * from the dispatching environment and must reach the worker without landing in argv, the returned
 * detail, the store, the prompt file or tmux's environment.
 */
import { after, describe, it } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir, userInfo } from "node:os";
import { dirname, join } from "node:path";
import { cleanup, tempRepo, tempStore } from "./helpers.mjs";
import { create, seedGitContract, writeConfig } from "../../lib/store.mjs";
import { ensureDirs, paths } from "../../lib/paths.mjs";
import * as tmux from "../../lib/dispatch/tmux.mjs";
import * as topology from "../../lib/dispatch/topology.mjs";
import { dispatch } from "../../lib/dispatch/index.mjs";

const trash = [];
after(() => cleanup(...trash));

const SENTINEL = `tm375-sentinel-${process.pid}-${Date.now()}`;
const sha = (s) => createHash("sha256").update(s).digest("hex");

function filesContaining(root, needle) {
  const hits = [];
  for (const entry of readdirSync(root, { recursive: true, withFileTypes: true })) {
    if (!entry.isFile()) continue;
    const path = join(entry.parentPath ?? entry.path, entry.name);
    try {
      if (readFileSync(path, "utf8").includes(needle)) hits.push(path);
    } catch {
      /* unreadable: a socket or similar */
    }
  }
  return hits;
}

/**
 * TM-448: names come from the USER's config only — tm's and agent-orchestration's global layer,
 * both under XDG_CONFIG_HOME, which every test here points at a private temp dir.
 */
const XDG = mkdtempSync(join(tmpdir(), "tm-passenv-xdg-"));
trash.push(XDG);
const savedXdg = process.env.XDG_CONFIG_HOME;
process.env.XDG_CONFIG_HOME = XDG;
after(() => (savedXdg === undefined ? delete process.env.XDG_CONFIG_HOME : (process.env.XDG_CONFIG_HOME = savedXdg)));
function userConfig({ tm = ["TM375_SECRET", "TM375_ABSENT"], ao = ["TM375_AO", "not a name"], tmuxCommand } = {}) {
  mkdirSync(join(XDG, "task-management"), { recursive: true });
  mkdirSync(join(XDG, "agent-orchestration"), { recursive: true });
  // TM-467: the worker command is user config too; the repository's is ignored.
  writeFileSync(join(XDG, "task-management", "config.json"), JSON.stringify({ dispatch: { passEnv: tm, ...(tmuxCommand ? { tmuxCommand } : {}) } }));
  writeFileSync(join(XDG, "agent-orchestration", "config.json"), JSON.stringify({ workers: { passEnv: ao } }));
}
userConfig();

/** A store whose git-tracked tm and ao configs name their own secrets — which must be ignored. */
function storeWithPassEnv(tmuxCommand, { tm = ["TM448_REPO_TM"], ao = ["TM448_REPO_AO"] } = {}) {
  const p = tempStore();
  trash.push(p.root);
  writeConfig({ dispatch: { passEnv: tm, ...(tmuxCommand ? { tmuxCommand } : {}) } }, p);
  mkdirSync(join(p.root, ".bytedesk", "agent-orchestration"), { recursive: true });
  writeFileSync(join(p.root, ".bytedesk", "agent-orchestration", "config.json"), JSON.stringify({ workers: { passEnv: ao } }));
  return p;
}

describe("TM-448 passEnv trusts only user config and never a reserved name", () => {
  it("repo-tracked passEnv is ignored with a warning, in tm config and in ao config", () => {
    const p = storeWithPassEnv();
    const plan = tmux.passEnvNames({ p });
    assert.deepEqual(plan.names, ["TM375_SECRET", "TM375_ABSENT", "TM375_AO"]);
    assert.deepEqual(plan.ignored, ["TM448_REPO_TM", "TM448_REPO_AO"]);
    assert.match(plan.warnings.join("\n"), /TM448_REPO_TM, TM448_REPO_AO ignored: named only in git-tracked repository config/);
    const res = tmux.spawn({ task: { id: "TM-448", title: "x" }, worktree: tmpdir(), prompt: "x", p, env: { TM448_REPO_TM: "v", TM448_REPO_AO: "v" } },
      { writeImpl: () => {}, spawnImpl: () => ({ status: 0 }) });
    assert.deepEqual(res.detail.passEnv, [], "nothing named only by the repo is passed");
    assert.deepEqual(res.detail.passEnvWarnings, plan.warnings, "the dispatch reports why");
    for (const a of res.detail.args.filter((a) => a.includes("tm-passenv-"))) rmSync(dirname(a), { recursive: true, force: true });
  });

  it("reserved names are refused from every layer", () => {
    const reserved = ["TM_ROOT", "TM_ACTOR", "AO_AGENT_ID", "CLAUDE_CONFIG_DIR", "PATH", "HOME", "LD_PRELOAD", "DYLD_INSERT_LIBRARIES", "NODE_OPTIONS", "GIT_SSH_COMMAND", "BASH_ENV", "ENV", "ZDOTDIR", "NODE_PATH", "PYTHONPATH", "PYTHONSTARTUP", "PERL5OPT", "RUBYOPT", "XDG_CONFIG_HOME", "TMUX", "TMUX_PANE", "SSH_AUTH_SOCK"];
    userConfig({ tm: ["TM375_SECRET", ...reserved.slice(0, 5)], ao: reserved.slice(5) });
    try {
      const plan = tmux.passEnvNames({ p: storeWithPassEnv(null, { tm: ["GIT_DIR"], ao: ["AO_CONSUMER"] }) });
      assert.deepEqual(plan.names, ["TM375_SECRET"]);
      assert.deepEqual(plan.refused.sort(), [...reserved, "GIT_DIR", "AO_CONSUMER"].sort());
      assert.match(plan.warnings.join("\n"), /refused: reserved names/);
    } finally {
      userConfig();
    }
  });

  it("the guard variables are applied after the secrets file, so it cannot override them", () => {
    const p = storeWithPassEnv();
    const dir = mkdtempSync(join(tmpdir(), "tm448-env-"));
    trash.push(dir);
    const envFile = join(dir, "env");
    // What a secrets file would have to contain to hijack the worker's store and identity.
    writeFileSync(envFile, "export TM_ROOT=/evil TM_ACTOR=evil TM_SESSION_ID=evil TM_DISPATCH_TASK=evil\n");
    const req = { task: { id: "TM-448", title: "x" }, worktree: dir, branch: "tm/TM-448-x", prompt: "prompt", session: "s-1", actor: "@a", p, envFile };
    const args = tmux.argvFor(req, ["sh", "-c", 'printf "%s|%s|%s|%s" "$TM_ROOT" "$TM_ACTOR" "$TM_SESSION_ID" "$TM_DISPATCH_TASK"']);
    // Run what the pane runs, with the -e values tmux would have set, and see who wins.
    const pane = args.slice(args.indexOf("tm-pass-env") - (tmux.PASS_ENV_WRAPPER.length - 1));
    const tmuxEnv = Object.fromEntries(args.flatMap((a, i) => (args[i - 1] === "-e" ? [a.split(/=(.*)/s).slice(0, 2)] : [])));
    const out = spawnSync(pane[0], pane.slice(1), { env: { PATH: process.env.PATH, ...tmuxEnv }, encoding: "utf8" });
    assert.equal(out.status, 0, `${out.stderr} ${out.error?.message} ${JSON.stringify(pane)}`);
    assert.equal(out.stdout, `${p.root}|@a|s-1|TM-448`);
  });
});

describe("TM-449 topology dispatch says which passEnv names it does not pass", () => {
  it("a tm-only name is reported on the result and the dispatched event; an ao global name is not", async () => {
    const p = storeWithPassEnv(null, { tm: [], ao: [] });
    const worktree = mkdtempSync(join(tmpdir(), "tm449-wt-"));
    trash.push(worktree);
    const res = topology.spawn({ task: { id: "TM-449", title: "x" }, worktree, prompt: "x", session: "s", actor: "@a", p }, {
      caps: { backends: { topology: { available: true, path: "/fake/ao-topology" } } },
      rosterList: [],
      writeImpl: () => {},
      spawnImpl: () => ({ status: 0, stdout: JSON.stringify({ session: "ao-449", run_id: "r449" }) }),
      env: { PATH: "/usr/bin" },
    });
    assert.equal(res.ok, true, res.reason);
    const w = res.detail.passEnvWarnings.join("\n");
    assert.match(w, /passEnv TM375_SECRET, TM375_ABSENT not passed by the topology backend/);
    assert.doesNotMatch(w, /TM375_AO/, "ao's own global workers.passEnv does reach the worker");

    // The same warnings reach the dispatch result and the `dispatched` event.
    const repo = paths(tempRepo());
    trash.push(repo.root);
    ensureDirs(repo);
    seedGitContract(repo);
    writeConfig({ enforce: false, requireEpic: false, dispatch: { enabled: false, governed: false } }, repo);
    const task = create("task", { title: "dispatch me", status: "open", labels: ["ready-for-agent"] }, "body", repo);
    const backend = { name: "topology", available: () => true, spawn: (r) => topology.spawn(r, { caps: { backends: { topology: { available: true, path: "/fake/ao-topology" } } }, rosterList: [], writeImpl: () => {}, spawnImpl: () => ({ status: 0, stdout: JSON.stringify({ session: "ao-449b" }) }) }) };
    const out = await dispatch(task.id, { p: repo, backend, caps: {}, session: "s-449" });
    assert.equal(out.ok, true, out.reason);
    assert.match(out.passEnvWarnings.join("\n"), /not passed by the topology backend/);
    const ev = readFileSync(repo.events, "utf8").trim().split("\n").map((l) => JSON.parse(l)).find((e) => e.event === "dispatched");
    assert.match(ev.passEnvWarnings.join("\n"), /TM375_SECRET, TM375_ABSENT not passed/);
  });
});

describe("TM-375 tmux backend passes configured secrets", () => {
  it("names come from user tm config and the ao global config; values never enter argv or detail", () => {
    const p = storeWithPassEnv();
    const worktree = mkdtempSync(join(tmpdir(), "tm-passenv-wt-"));
    const req = { task: { id: "TM-375", title: "x" }, worktree, prompt: "do it", session: "s", actor: "@a", p, env: { TM375_SECRET: SENTINEL, TM375_AO: `${SENTINEL}-ao` } };
    assert.deepEqual(tmux.passEnvNames(req).names, ["TM375_SECRET", "TM375_ABSENT", "TM375_AO"]);
    let args;
    const res = tmux.spawn(req, { writeImpl: () => {}, spawnImpl: (bin, a) => ((args = a), { status: 0 }) });
    assert.equal(res.ok, true);
    assert.deepEqual([res.detail.passEnv, res.detail.passEnvMissing], [["TM375_SECRET", "TM375_AO"], ["TM375_ABSENT"]]);
    assert.ok(!JSON.stringify({ args, res }).includes(SENTINEL), "no value in argv or the returned detail");
    const file = args[args.indexOf("tm-pass-env") + 1];
    assert.equal(statSync(file).mode & 0o777, 0o600);
    assert.equal(statSync(dirname(file)).mode & 0o777, 0o700);
    rmSync(dirname(file), { recursive: true, force: true }); // the pane never ran in this test
    rmSync(worktree, { recursive: true, force: true });
  });

  it("a failed tmux start removes the staged file", () => {
    const p = storeWithPassEnv();
    let args;
    const res = tmux.spawn({ task: { id: "TM-375", title: "x" }, worktree: tmpdir(), prompt: "x", p, env: { TM375_SECRET: SENTINEL } },
      { writeImpl: () => {}, spawnImpl: (bin, a) => ((args = a), { status: 1, stderr: "nope" }) });
    assert.equal(res.ok, false);
    assert.ok(args.indexOf("tm-pass-env") > 0, "a file was staged for the pane");
    assert.equal(existsSync(args[args.indexOf("tm-pass-env") + 1]), false);
  });

  const haveTmux = spawnSync("tmux", ["-V"]).status === 0;
  it("the worker's environment holds the secret and nothing on disk or in tmux does", { skip: haveTmux ? false : "no tmux" }, () => {
    // Isolation, three ways (.claude/rules/tmux-test-isolation.md): no inherited $TMUX, a private
    // TMUX_TMPDIR, and every kill scoped with -S.
    const tmuxDir = mkdtempSync("/tmp/tm375-");
    const socket = join(tmuxDir, `tmux-${userInfo().uid}`, "default");
    const saved = { TMUX: process.env.TMUX, TMUX_TMPDIR: process.env.TMUX_TMPDIR };
    process.env.TMUX = "";
    process.env.TMUX_TMPDIR = tmuxDir;
    const worktree = mkdtempSync(join(tmpdir(), "tm-passenv-wt-"));
    try {
      // The server starts WITHOUT the secret, as the operator's long-lived server would have.
      execFileSync("tmux", ["new-session", "-d", "-s", "keepalive", "sleep 120"]);
      assert.ok(existsSync(socket), "the isolated server is the one in use");
      userConfig({ tmuxCommand: ["sh", "-c", 'printf %s "$TM375_SECRET" | sha256sum > seen.sha; printf %s "$TM375_AO" | sha256sum > ao.sha; exec sleep 30'] });
      const p = storeWithPassEnv();
      const req = { task: { id: "TM-375", title: "x" }, worktree, prompt: "prompt", session: "s", actor: "@a", p, env: { ...process.env, TM375_SECRET: SENTINEL, TM375_AO: `${SENTINEL}-ao` } };
      const res = tmux.spawn(req);
      assert.equal(res.ok, true, res.reason);
      const seen = join(worktree, "seen.sha");
      const aoSeen = join(worktree, "ao.sha");
      const written = (f) => existsSync(f) && statSync(f).size > 0;
      // The worker writes seen.sha, then ao.sha: wait for both, or the second read races the shell.
      for (let i = 0; i < 100 && !(written(seen) && written(aoSeen)); i += 1) spawnSync("sleep", ["0.1"]);
      assert.equal(readFileSync(seen, "utf8").split(" ")[0], sha(SENTINEL), "the worker received the tm-config secret");
      assert.equal(readFileSync(aoSeen, "utf8").split(" ")[0], sha(`${SENTINEL}-ao`), "and the ao-config one");
      const staged = res.detail.args[res.detail.args.indexOf("tm-pass-env") + 1];
      assert.equal(existsSync(dirname(staged)), false, "the wrapper removed the staged dir");
      assert.deepEqual([...filesContaining(p.root, SENTINEL), ...filesContaining(worktree, SENTINEL)], []);
      const env = execFileSync("tmux", ["-S", socket, "show-environment", "-g"], { encoding: "utf8" }) + execFileSync("tmux", ["-S", socket, "show-environment", "-t", "tm-TM-375"], { encoding: "utf8" });
      assert.ok(env.length > 0 && !env.includes(SENTINEL), "tmux's environment never carries it");
      const ps = execFileSync("ps", ["-eo", "args"], { encoding: "utf8" });
      assert.ok(ps.includes("sleep 30") && !ps.includes(SENTINEL), "no argv carries it");
    } finally {
      userConfig();
      spawnSync("tmux", ["-S", socket, "kill-server"]);
      Object.assign(process.env, saved);
      if (saved.TMUX === undefined) delete process.env.TMUX;
      if (saved.TMUX_TMPDIR === undefined) delete process.env.TMUX_TMPDIR;
      rmSync(tmuxDir, { recursive: true, force: true });
      rmSync(worktree, { recursive: true, force: true });
    }
  });
});
