// TM-242: standing-agent panes launched by ao-topology used to always start in the agent's own
// directory, never the repo root — so Claude Code resolved CLAUDE_PROJECT_DIR (which it derives
// from the pane's actual cwd, not from an inherited/exported env var — measured live, see
// docs/standing-agents.md) to the wrong place and every project hook reading
// `${CLAUDE_PROJECT_DIR:-.}` broke. The fix is the launch cwd itself, so the one thing worth a
// regression guard is that all three tmux launch paths actually carry whatever cwd they are given
// through to the pane — consistently, not just on the one this bug happened to be reported against.
//
// Per .claude/rules/tmux-test-isolation.md: TMUX unset, a per-test TMUX_TMPDIR (a fresh server),
// and every kill-server scoped with -L. Never touch the default server.
import assert from "node:assert/strict";
import { execFile as execFileCallback } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { promisify } from "node:util";

import { newSession, newWindow, splitPanes, withServer } from "../../topology/lib/tmux.mjs";

const execFile = promisify(execFileCallback);
const haveTmux = await execFile("tmux", ["-V"]).then(() => true, () => false);

async function withIsolatedServer(t, fn) {
  const dir = await mkdtemp(join(tmpdir(), "ao-tmux-cwd-"));
  const server = join(dir, "srv");
  const env = { ...process.env, TMUX: "", TMUX_TMPDIR: dir, AO_TMUX_COMMAND: "tmux" };
  t.after(async () => {
    // Scoped by the exact socket this test created (-S), never a bare kill-server.
    await execFile("tmux", ["-S", server, "kill-server"], { env }).catch(() => {});
    await rm(dir, { recursive: true, force: true });
  });
  const restoreEnv = { ...process.env };
  Object.assign(process.env, { TMUX: "", TMUX_TMPDIR: dir, AO_TMUX_COMMAND: "tmux" });
  try {
    return await withServer(server, () => fn(server));
  } finally {
    process.env = restoreEnv;
  }
}

async function currentPath(server, pane) {
  const env = { ...process.env, TMUX: "" };
  const { stdout } = await execFile("tmux", ["-S", server, "display-message", "-p", "-t", pane, "#{pane_current_path}"], { env });
  return stdout.trim();
}

test("newSession launches the pane in the cwd it was given", { skip: haveTmux ? false : "no tmux" }, async (t) => {
  const repoRoot = await mkdtemp(join(tmpdir(), "ao-repo-"));
  t.after(() => rm(repoRoot, { recursive: true, force: true }));
  await withIsolatedServer(t, async (server) => {
    const pane = await newSession("cwd-check", { cwd: repoRoot, width: 80, height: 24 });
    assert.equal(await currentPath(server, pane), repoRoot);
  });
});

test("newWindow launches the pane in the cwd it was given", { skip: haveTmux ? false : "no tmux" }, async (t) => {
  const repoRoot = await mkdtemp(join(tmpdir(), "ao-repo-"));
  t.after(() => rm(repoRoot, { recursive: true, force: true }));
  await withIsolatedServer(t, async (server) => {
    await newSession("cwd-check", { cwd: repoRoot, width: 80, height: 24 });
    const pane = await newWindow("cwd-check", "second", repoRoot);
    assert.equal(await currentPath(server, pane), repoRoot);
  });
});

test("splitPanes launches every pane in the cwd it was given", { skip: haveTmux ? false : "no tmux" }, async (t) => {
  const repoRoot = await mkdtemp(join(tmpdir(), "ao-repo-"));
  t.after(() => rm(repoRoot, { recursive: true, force: true }));
  await withIsolatedServer(t, async (server) => {
    await newSession("cwd-check", { cwd: repoRoot, width: 80, height: 24, windowName: "main" });
    const [pane] = await splitPanes("cwd-check:main", [repoRoot]);
    assert.equal(await currentPath(server, pane), repoRoot);
  });
});

// The three functions above prove tmux.mjs faithfully carries a cwd through. This proves the
// caller that matters — a standing agent's session — actually passes the repo root, not the
// agent's own directory, for that cwd. See topology-launch.test.mjs for the record-level assertion
// (record.cwd / record.agent_dir) exercised against a real tmux server via openRoleSession.
