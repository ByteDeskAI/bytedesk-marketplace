// End-to-end: launch a two-agent spec into a real tmux server with fake agent CLIs, send a
// message through the mailbox, wait for the replies, and stop the session. Skips without tmux.
import assert from "node:assert/strict";
import { execFile as execFileCallback } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import { join } from "node:path";
import test from "node:test";
import { promisify } from "node:util";

import { writeJson } from "../../topology/lib/util.mjs";

const execFile = promisify(execFileCallback);
const root = process.cwd();
const cli = join(root, "topology", "cli.mjs");
const fakeAgent = join(root, "tests", "fixtures", "fake-agent.mjs");

async function ao(args, env = {}) {
  const result = await execFile(process.execPath, [cli, ...args], { env: { ...process.env, ...env }, encoding: "utf8", timeout: 120_000 });
  return result.stdout;
}

async function assertBindings(runDir, env) {
  const run = JSON.parse(await readFile(join(runDir, 'run.json'), 'utf8'));
  for (const agent of run.agents) {
    const binding = agent.binding;
    assert.ok(binding, `${agent.id} must record its final pane incarnation`);
    const observed = (await execFile('tmux', ['display-message', '-p', '-t', agent.pane,
      '#{socket_path}|#{pid}|#{session_id}|#{session_created}|#{pane_id}|#{pane_pid}'], { env: { ...process.env, ...env } })).stdout.trim().split('|');
    assert.deepEqual([binding.serverKey, String(binding.serverPid), binding.sessionId, String(binding.sessionCreated), binding.paneId, String(binding.panePid)], observed);
  }
}

const tmuxAvailable = await execFile("tmux", ["-V"]).then(() => true, () => false);

test("launch → send → wait → status → stop with fake agents in tmux", { skip: tmuxAvailable ? false : "tmux not installed" }, async () => {
  const consumer = await mkdtemp(join(os.tmpdir(), "ao-topology-e2e-"));
  const tmpSocket = `ao-test-${process.pid}`;
  const env = { TMUX: "", AO_TMUX_COMMAND: "tmux", TMUX_TMPDIR: consumer, AO_CONSUMER: consumer, AGENT_ORCHESTRATION_STATE_HOME: join(consumer, "state") };
  const spec = {
    version: 1,
    name: "e2e",
    session: "ao-e2e-{{run_id}}",
    layout: "grid",
    agents: [
      { id: "conductor", role: "orchestrator", cli: "fake-agent", model: "fable", args: [fakeAgent] },
      { id: "worker-a", role: "worker", candidates: ["no-such-cli-zz:foo", "fake-limit:x", "fake-agent:w1"], args: [fakeAgent] },
      { id: "worker-b", role: "designer", candidates: "fake-agent:w2, fake-agent:w3", args: [fakeAgent, "--defer-stage", "again", "--defer-model", "w2"], skills: ["definitely-missing-skill"] },
    ],
    workflow: [{ stage: "ping", from: "conductor", to: ["worker-a", "worker-b"] }],
  };
  const specPath = join(consumer, "spec.json");
  await writeJson(specPath, spec);
  let runDir;
  let session;
  let passed = false;
  try {
    const launched = JSON.parse(await ao(["launch", "--spec", specPath, "--consumer", consumer, "--providers-dir", join(root, "tests", "fixtures"), "--run-id", `t-${tmpSocket}`, "--json"], env));
    runDir = launched.runDir;
    session = launched.session;
    assert.equal(launched.agents.length, 3);
    assert.ok(launched.agents.every((agent) => agent.ready), JSON.stringify(launched, null, 2));
    assert.ok(launched.warnings.some((warning) => warning.includes("definitely-missing-skill")));
    const workerA = launched.agents.find((agent) => agent.id === "worker-a");
    assert.equal(workerA.provider, "fake-agent:w1");
    await assertBindings(runDir, env);
    assert.deepEqual(workerA.attempts.map((attempt) => attempt.label), ["no-such-cli-zz:foo", "fake-limit:x", "fake-agent:w1"]);
    assert.match(workerA.attempts[1].outcome, /usage limit/);
    assert.ok(launched.warnings.some((warning) => warning.includes("worker-a: fell back to fake-agent:w1")));

    const bootstrap = await readFile(join(runDir, "agents", "worker-b", "BOOTSTRAP.md"), "utf8");
    assert.match(bootstrap, /Role: \*\*designer\*\*/);
    assert.match(bootstrap, /NOT FOUND/);
    const conductorBootstrap = await readFile(join(runDir, "agents", "conductor", "BOOTSTRAP.md"), "utf8");
    assert.match(conductorBootstrap, /## Workflow you conduct/);
    assert.match(conductorBootstrap, /\*\*ping\*\*/);

    // Give the fake agents a moment to answer READY, then check their screens.
    await new Promise((resolve) => setTimeout(resolve, 1500));
    const screen = await ao(["capture", "--run", runDir, "--agent", "worker-a", "--lines", "20"], env);
    assert.match(screen, /READY/);

    const sent = JSON.parse(await ao(["send", "--run", runDir, "--from", "conductor", "--to", "worker-a,worker-b", "--stage", "ping", "--body", "PING please"], env));
    assert.equal(sent.id, "001-ping");
    assert.ok(sent.delivered.every((item) => item.rang === false && item.notification === 'durable-pending')); // fixture polls its inbox

    const waited = JSON.parse(await ao(["wait", "--run", runDir, "--from", "worker-a,worker-b", "--message", "001-ping", "--timeout", "30s", "--poll", "500ms", "--json", "--quiet"], env));
    assert.equal(waited.ok, true, JSON.stringify(waited));
    assert.deepEqual(waited.replies.map((reply) => reply.agent).sort(), ["worker-a", "worker-b"]);
    assert.match(waited.replies[0].body, /saw-body: PING/);
    assert.match(waited.replies.find((reply) => reply.agent === "worker-b").body, /model: w2/);

    const status = JSON.parse(await ao(["status", "--run", runDir, "--json"], env));
    assert.equal(status.session_alive, true);
    assert.equal(status.pending_count, 0);
    assert.ok(status.agents.every((agent) => agent.alive));
    assert.deepEqual(status.agents.find((agent) => agent.id === "worker-b").chain, ["fake-agent:w2", "fake-agent:w3"]);

    // Mid-run failover: w2 deliberately defers this stage at its safe boundary. The successor
    // reads the durable inbox after bootstrap and answers without an injected terminal bell.
    const sent2 = JSON.parse(await ao(["send", "--run", runDir, "--from", "conductor", "--to", "worker-b", "--stage", "again", "--body", "PING again", "--no-ring"], env));
    const failover = JSON.parse(await ao(["failover", "--run", runDir, "--agent", "worker-b", "--providers-dir", join(root, "tests", "fixtures"), "--json"], env));
    assert.equal(failover.ok, true, JSON.stringify(failover));
    assert.equal(failover.from, "fake-agent:w2");
    assert.equal(failover.to, "fake-agent:w3");
    await assertBindings(runDir, env);
    assert.deepEqual(failover.redelivered, []);
    assert.ok(failover.pending.every(id => id === sent2.id), 'the successor may already have consumed the pending file during bootstrap');
    const waited2 = JSON.parse(await ao(["wait", "--run", runDir, "--from", "worker-b", "--message", sent2.id, "--timeout", "30s", "--poll", "500ms", "--json", "--quiet"], env));
    assert.equal(waited2.ok, true, JSON.stringify(waited2));
    assert.match(waited2.replies[0].body, /model: w3/);
    // Chain exhausted → clear error.
    const exhausted = JSON.parse(await ao(["failover", "--run", runDir, "--agent", "worker-b", "--providers-dir", join(root, "tests", "fixtures"), "--json"], env).catch((error) => error.stdout));
    assert.equal(exhausted.code, "TOPOLOGY_CHAIN_EXHAUSTED");

    const stopped = JSON.parse(await ao(["stop", "--run", runDir], env));
    assert.equal(stopped.killed, true);
    const after = JSON.parse(await ao(["status", "--run", runDir, "--json"], env));
    assert.equal(after.session_alive, false);
    assert.equal(after.state, "stopped");
    passed = true;
  } finally {
    if (session) await execFile("tmux", ["kill-session", "-t", session], { env: { ...process.env, ...env } }).catch(() => {});
    // Kept on failure, deliberately. This case has failed intermittently for days and every
    // investigation started from an assertion message with no pane logs behind it, because the
    // finally had already deleted the run — including `agents/<id>/pane.log`, which is the only
    // record of what a pane that "never looked ready" actually had on it. The live harness keeps
    // its scratch tree on failure for exactly this reason; so does this one now.
    if (passed) await rm(consumer, { recursive: true, force: true });
    else process.stderr.write(`\nkept for inspection: ${consumer}\n`);
  }
});

test("managed shell ignores ambient default-command and an unsignalled timeout is never ready", { skip: tmuxAvailable ? false : "tmux not installed" }, async () => {
  const dir = await mkdtemp(join(os.tmpdir(), 'ao-tmux-shell-'));
  const env = { ...process.env, TMUX: '', TMUX_TMPDIR: dir, AO_TMUX_COMMAND: 'tmux' };
  try {
    // A deliberately non-shell default is a deterministic stand-in for a stalled login rc.
    await execFile('tmux', ['new-session', '-d', '-s', 'sentinel', 'cat'], { env });
    await execFile('tmux', ['set-option', '-g', 'default-command', 'cat'], { env });
    const modulePath = join(root, 'topology/lib/tmux.mjs');
    const source = `
      import assert from 'node:assert/strict';
      import { newSession, newWindow, splitPanes, respawnPane, clearAndWaitForShell, waitForChannel } from ${JSON.stringify(new URL('file://' + modulePath).href)};
      const pane = await newSession('managed', { cwd: ${JSON.stringify(dir)} });
      assert.equal(await waitForChannel('never-signalled', 100), false, 'timeout is not acknowledgement');
      const { run } = await import(${JSON.stringify(new URL('file://' + join(root, 'topology/lib/util.mjs')).href)});
      assert.equal((await run('tmux', ['wait-for', 'also-never-signalled'], { allowFailure: true, timeoutMs: 100 })).code, 124, 'SIGTERM exit zero is still a timeout');
      assert.equal((await clearAndWaitForShell(pane, 'managed-first', 1500)).ok, true);
      await respawnPane(pane);
      assert.equal((await clearAndWaitForShell(pane, 'managed-respawn', 1500)).ok, true);
      const windowPane = await newWindow('managed', 'extra', ${JSON.stringify(dir)});
      assert.equal((await clearAndWaitForShell(windowPane, 'managed-window', 1500)).ok, true);
      const [split] = await splitPanes('managed:extra', [${JSON.stringify(dir)}]);
      assert.equal((await clearAndWaitForShell(split, 'managed-split', 1500)).ok, true);
    `;
    await execFile(process.execPath, ['--input-type=module', '-e', source], { env, timeout: 15000 });
  } finally {
    await execFile('tmux', ['kill-server'], { env }).catch(() => {});
    await rm(dir, { recursive: true, force: true });
  }
});
