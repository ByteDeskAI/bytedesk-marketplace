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
import { cleanup, tempStore } from "./helpers.mjs";
import { writeConfig } from "../../lib/store.mjs";
import * as tmux from "../../lib/dispatch/tmux.mjs";

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

/** A store whose tm config names one secret and whose ao config names another. */
function storeWithPassEnv(tmuxCommand) {
  const p = tempStore();
  trash.push(p.root);
  writeConfig({ dispatch: { passEnv: ["TM375_SECRET", "TM375_ABSENT"], ...(tmuxCommand ? { tmuxCommand } : {}) } }, p);
  mkdirSync(join(p.root, ".bytedesk", "agent-orchestration"), { recursive: true });
  writeFileSync(join(p.root, ".bytedesk", "agent-orchestration", "config.json"), JSON.stringify({ workers: { passEnv: ["TM375_AO", "not a name"] } }));
  return p;
}

describe("TM-375 tmux backend passes configured secrets", () => {
  it("names come from tm config and the ao repo config; values never enter argv or detail", () => {
    const p = storeWithPassEnv();
    const worktree = mkdtempSync(join(tmpdir(), "tm-passenv-wt-"));
    const req = { task: { id: "TM-375", title: "x" }, worktree, prompt: "do it", session: "s", actor: "@a", p, env: { TM375_SECRET: SENTINEL, TM375_AO: `${SENTINEL}-ao` } };
    assert.deepEqual(tmux.passEnvNames(req), ["TM375_SECRET", "TM375_ABSENT", "TM375_AO"]);
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
      const p = storeWithPassEnv(["sh", "-c", 'printf %s "$TM375_SECRET" | sha256sum > seen.sha; printf %s "$TM375_AO" | sha256sum > ao.sha; exec sleep 30']);
      const req = { task: { id: "TM-375", title: "x" }, worktree, prompt: "prompt", session: "s", actor: "@a", p, env: { ...process.env, TM375_SECRET: SENTINEL, TM375_AO: `${SENTINEL}-ao` } };
      const res = tmux.spawn(req);
      assert.equal(res.ok, true, res.reason);
      const seen = join(worktree, "seen.sha");
      for (let i = 0; i < 100 && !(existsSync(seen) && statSync(seen).size > 0); i += 1) spawnSync("sleep", ["0.1"]);
      assert.equal(readFileSync(seen, "utf8").split(" ")[0], sha(SENTINEL), "the worker received the tm-config secret");
      assert.equal(readFileSync(join(worktree, "ao.sha"), "utf8").split(" ")[0], sha(`${SENTINEL}-ao`), "and the ao-config one");
      const staged = res.detail.args[res.detail.args.indexOf("tm-pass-env") + 1];
      assert.equal(existsSync(dirname(staged)), false, "the wrapper removed the staged dir");
      assert.deepEqual([...filesContaining(p.root, SENTINEL), ...filesContaining(worktree, SENTINEL)], []);
      const env = execFileSync("tmux", ["-S", socket, "show-environment", "-g"], { encoding: "utf8" }) + execFileSync("tmux", ["-S", socket, "show-environment", "-t", "tm-TM-375"], { encoding: "utf8" });
      assert.ok(env.length > 0 && !env.includes(SENTINEL), "tmux's environment never carries it");
      const ps = execFileSync("ps", ["-eo", "args"], { encoding: "utf8" });
      assert.ok(ps.includes("sleep 30") && !ps.includes(SENTINEL), "no argv carries it");
    } finally {
      spawnSync("tmux", ["-S", socket, "kill-server"]);
      Object.assign(process.env, saved);
      if (saved.TMUX === undefined) delete process.env.TMUX;
      if (saved.TMUX_TMPDIR === undefined) delete process.env.TMUX_TMPDIR;
      rmSync(tmuxDir, { recursive: true, force: true });
      rmSync(worktree, { recursive: true, force: true });
    }
  });
});
