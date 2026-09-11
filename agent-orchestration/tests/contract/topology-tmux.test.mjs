// End-to-end: launch a two-agent spec into a real tmux server with fake agent CLIs, send a
// message through the mailbox, wait for the replies, and stop the session. Skips without tmux.
import assert from "node:assert/strict";
import { execFile as execFileCallback } from "node:child_process";
import { createHash } from "node:crypto";
import { access, mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import { join } from "node:path";
import test from "node:test";
import { promisify } from "node:util";

import { sleep, writeJson } from "../../topology/lib/util.mjs";

const execFile = promisify(execFileCallback);
const root = process.cwd();
const cli = join(root, "topology", "cli.mjs");
const fakeAgent = join(root, "tests", "fixtures", "fake-agent.mjs");

async function ao(args, env = {}) {
  const result = await execFile(process.execPath, [cli, ...args], { env: { ...process.env, ...env }, encoding: "utf8", timeout: 120_000 });
  return result.stdout;
}

/**
 * `ao()` throws on a non-zero exit, and exit 3 — "the pane was judged safe and the pointer still
 * did not land" — is now a legitimate outcome that has to be asserted rather than caught.
 */
async function aoAllowingFailure(args, env = {}) {
  return execFile(process.execPath, [cli, ...args], { env: { ...process.env, ...env }, encoding: "utf8", timeout: 120_000 })
    .then((result) => ({ code: 0, stdout: result.stdout, stderr: result.stderr }))
    .catch((error) => ({ code: error.code ?? 1, stdout: error.stdout ?? "", stderr: error.stderr ?? "" }));
}

/**
 * Every `cli.mjs supervise` this consumer caused. `launch` self-starts one (ensureSupervision) and
 * it only retires on a later tick after the consumer directory is removed, so without an explicit
 * stop it outlives the test — measured: the `stuck` case's supervisor was still running 3s after the
 * suite exited, and a leak check taken then cannot tell that from a real leak. Matched on the
 * consumer path, which mkdtemp made unique to this test.
 */
async function supervisorsFor(consumer) {
  const { stdout } = await execFile("pgrep", ["-f", `supervise --consumer ${consumer}( |$)`]).catch((error) => ({ stdout: error.stdout ?? "" }));
  return stdout.split("\n").filter(Boolean).map(Number);
}

async function stopSupervisors(consumer) {
  for (const pid of await supervisorsFor(consumer)) { try { process.kill(pid, "SIGTERM"); } catch {} }
  for (let i = 0; i < 50 && (await supervisorsFor(consumer)).length; i += 1) await sleep(100);
  for (const pid of await supervisorsFor(consumer)) { try { process.kill(pid, "SIGKILL"); } catch {} }
}

/**
 * Kill the test's own tmux server, scoped by SOCKET (.claude/rules/tmux-test-isolation.md rule 3),
 * and only after checking that socket lives under this test's TMUX_TMPDIR — the one mistake this
 * teardown must never make is resolving to the operator's server and killing it.
 */
async function killIsolatedServer(env) {
  const socket = await execFile("tmux", ["list-panes", "-a", "-F", "#{socket_path}"], { env: { ...process.env, ...env } })
    .then((result) => result.stdout.split("\n")[0].trim()).catch(() => "");
  if (!socket) return;
  assert.ok(env.TMUX === "" && socket.startsWith(`${env.TMUX_TMPDIR}/`), `refusing to kill a tmux server outside this test's TMUX_TMPDIR: ${socket}`);
  await execFile("tmux", ["-S", socket, "kill-server"], { env: { ...process.env, ...env } }).catch(() => {});
}

/**
 * Re-record a pane's six-tuple binding after the test has deliberately replaced its process.
 *
 * `respawn-pane -k` changes `pane_pid`, which is one of the six fields the ring checks before it
 * types anything — so without this every delivery contract below would stop at `stale-binding` and
 * we would be re-testing the guard instead of the states behind it. This is what `failoverAgent`
 * does for real after it respawns a pane.
 */
async function rebindPane(runDir, agentId, pane, env) {
  const fields = ["socket_path", "pid", "session_id", "session_created", "pane_id", "pane_pid"];
  const observed = (await execFile("tmux", ["display-message", "-p", "-t", pane, fields.map((f) => `#{${f}}`).join("|")], { env: { ...process.env, ...env } })).stdout.trim().split("|");
  const run = JSON.parse(await readFile(join(runDir, "run.json"), "utf8"));
  const agent = run.agents.find((item) => item.id === agentId);
  agent.binding = {
    ...agent.binding,
    serverKey: observed[0], serverPid: Number(observed[1]), sessionId: observed[2],
    sessionCreated: Number(observed[3]), paneId: observed[4], panePid: Number(observed[5]),
  };
  await writeJson(join(runDir, "run.json"), run);
}

/**
 * A minimal two-agent run for the delivery contracts below: one conductor, one worker whose pane we
 * then replace with a stand-in for a specific misbehaviour. Deliberately its own launcher rather
 * than a share of the big test above — those assertions are about failover chains and skills, and
 * coupling them to these would make one failure look like two.
 */
async function launchDeliveryRun(t, label, extraEnv = {}) {
  const consumer = await mkdtemp(join(os.tmpdir(), `ao-topology-${label}-`));
  const env = {
    TMUX: "", AO_TMUX_COMMAND: "tmux", TMUX_TMPDIR: consumer, AO_CONSUMER: consumer,
    AGENT_ORCHESTRATION_STATE_HOME: join(consumer, "state"),
    // Bound the ring so a failure is a failing assertion rather than a 60s hang per recipient.
    AO_RING_WINDOW_MS: "20000", AO_BELL_POLL_MS: "500",
    ...extraEnv,
  };
  const specPath = join(consumer, "spec.json");
  await writeJson(specPath, {
    version: 1, name: label, session: `ao-${label}-{{run_id}}`, layout: "grid",
    agents: [
      { id: "conductor", role: "orchestrator", cli: "fake-agent", model: "fable", args: [fakeAgent] },
      { id: "worker-a", role: "worker", cli: "fake-agent", model: "w1", args: [fakeAgent] },
    ],
    workflow: [{ stage: "ping", from: "conductor", to: ["worker-a"] }],
  });
  const launched = JSON.parse(await ao(["launch", "--spec", specPath, "--consumer", consumer, "--providers-dir", join(root, "tests", "fixtures"), "--run-id", `${label}-${process.pid}`, "--json"], env));
  t.after(async () => {
    await stopSupervisors(consumer);
    await killIsolatedServer(env);
    await rm(consumer, { recursive: true, force: true });
  });
  const worker = launched.agents.find((agent) => agent.id === "worker-a");
  return { runDir: launched.runDir, runId: `${label}-${process.pid}`, session: launched.session, env, consumer, worker };
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
  // AO_RING_WINDOW_MS bounds the doorbell: without it a ring that cannot find a safe moment waits
  // the full 60s default per recipient, and a failing assertion would look like a hung test.
  const env = { TMUX: "", AO_TMUX_COMMAND: "tmux", TMUX_TMPDIR: consumer, AO_CONSUMER: consumer, AGENT_ORCHESTRATION_STATE_HOME: join(consumer, "state"), AO_RING_WINDOW_MS: "20000", AO_BELL_POLL_MS: "500" };
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

    // `--providers-dir` on `send` for the same reason `launch` needs it: the doorbell resolves the
    // recipient's adapter to read its measured `composer`, and these agents run a FIXTURE adapter
    // that is not in the plugin's own providers/ directory. Real adapters need no flag.
    const sent = JSON.parse(await ao(["send", "--run", runDir, "--providers-dir", join(root, "tests", "fixtures"), "--from", "conductor", "--to", "worker-a,worker-b", "--stage", "ping", "--body", "PING please"], env));
    assert.equal(sent.id, "001-ping");
    // INVERTED from the TM-127 regression, which asserted `rang === false && durable-pending` — the
    // bell NOT ringing — as if that were the contract. It was the bug. The fixture still polls its
    // inbox, so the reply would arrive either way; what is pinned here is that the doorbell was
    // OBSERVED to work — the pointer was typed and the composer emptied again — rather than assumed.
    // This assertion is only meaningful because tests/fixtures/fake-agent.json declares a measured
    // `composer`: without one the adapter is `ring_capability: "unsupported"`, the bell correctly
    // refuses to ring, and every line below would pass while proving nothing.
    assert.ok(sent.delivered.every((item) => item.rang === true), JSON.stringify(sent.delivered, null, 2));
    assert.ok(sent.delivered.every((item) => item.notification === 'submitted'), JSON.stringify(sent.delivered, null, 2));
    for (const item of sent.delivered) {
      assert.equal(item.delivery.state, "submitted");
      assert.equal(item.delivery.ring_capability, "supported");
      assert.equal(item.delivery.composer_empty_after, true);
      assert.equal(item.delivery.typed, true);
      assert.equal(item.delivery.escalated, false);
      assert.equal(item.delivery.rungs[0], "retype");
      // NOT `deepEqual(rungs, ["retype"])`. This fixture polls its inbox every 100ms, so it may
      // answer the message BEFORE the pointer is typed — and its reply path returns early without
      // redrawing the `> ` prompt when the outbox already exists, which leaves a composer that
      // genuinely is not empty until the next keystroke. One resubmit then clears it. Which of the
      // two happens is a race with the fixture, so asserting the exact rung list would be flaky by
      // construction. What is NOT a race, and is the thing worth pinning, is that the pointer is
      // typed exactly once however many rungs it takes.
      assert.equal(item.delivery.rungs.filter((rung) => rung === "retype").length, 1, JSON.stringify(item.delivery.rungs));
      // Additive: every key `delivered[]` carried before still carries it, with its old type.
      assert.equal(typeof item.agent, "string");
    }

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
    const sent2 = JSON.parse(await ao(["send", "--run", runDir, "--providers-dir", join(root, "tests", "fixtures"), "--from", "conductor", "--to", "worker-b", "--stage", "again", "--body", "PING again", "--no-ring"], env));
    // --no-ring sat in USAGE, in this file and in tests/live/two-projects.sh since `send` was
    // written, and the body never read it. It is implemented now, so assert the difference.
    assert.ok(sent2.delivered.every((item) => item.rang === false && item.notification === 'ring-skipped'), JSON.stringify(sent2.delivered, null, 2));
    assert.ok(sent2.delivered.every((item) => item.delivery.escalated === false), "a skipped ring is never an escalation");
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
    await stopSupervisors(consumer);
    if (session) await killIsolatedServer(env);
    // Kept on failure, deliberately. This case has failed intermittently for days and every
    // investigation started from an assertion message with no pane logs behind it, because the
    // finally had already deleted the run — including `agents/<id>/pane.log`, which is the only
    // record of what a pane that "never looked ready" actually had on it. The live harness keeps
    // its scratch tree on failure for exactly this reason; so does this one now.
    if (passed) await rm(consumer, { recursive: true, force: true });
    else process.stderr.write(`\nkept for inspection: ${consumer}\n`);
  }
});

test("a message rung at a deaf pane escalates rather than reporting a delivery", { skip: tmuxAvailable ? false : "tmux not installed" }, async (t) => {
  const { runDir, env, worker } = await launchDeliveryRun(t, "deaf");
  // A pane that LOOKS ready and is not listening. It prints the fixture's prompt — so the composer
  // pattern matches and every safety check passes — and then hands the terminal to a process in RAW
  // MODE, which turns the tty echo off. That is what a CLI does the moment it takes the terminal,
  // and it is why a pointer typed mid-startup vanishes with no error anywhere (TM-126). NOT `sleep`:
  // a process that merely ignores stdin still has the line discipline echoing what is typed at it,
  // so the text appears on the pane and any check for it passes — against the bug.
  const deaf = join(root, "tests", "fixtures", "deaf-pane.mjs");
  await execFile("tmux", ["respawn-pane", "-k", "-t", worker.pane, `sh -c 'printf "> "; exec ${process.execPath} ${deaf}'`], { env: { ...process.env, ...env } });
  await new Promise((resolve) => setTimeout(resolve, 1000));

  // Free contract, because respawning gave us one: the pane now has a different `pane_pid`, so its
  // six-tuple no longer matches what the run recorded. That is exactly the `%N` reuse case — tmux
  // hands a recycled pane id to a stranger's session — and the ring must refuse to type a task
  // assignment into it. It refuses without escalating, because nothing is wrong with the message.
  const stale = await aoAllowingFailure(["send", "--run", runDir, "--providers-dir", join(root, "tests", "fixtures"), "--from", "conductor", "--to", "worker-a", "--stage", "stale", "--body", "PING stale"], env);
  const staleItem = JSON.parse(stale.stdout).delivered.find((entry) => entry.agent === "worker-a");
  assert.equal(staleItem.notification, "stale-binding", JSON.stringify(staleItem, null, 2));
  assert.equal(staleItem.rang, false);
  assert.equal(staleItem.delivery.escalated, false, "a pane that is not ours is not a delivery failure");
  assert.equal(stale.code, 0, "and it is never exit 3");

  await rebindPane(runDir, "worker-a", worker.pane, env);

  const result = await aoAllowingFailure(["send", "--run", runDir, "--providers-dir", join(root, "tests", "fixtures"), "--from", "conductor", "--to", "worker-a", "--stage", "deaf", "--body", "PING deaf"], env);
  const sent = JSON.parse(result.stdout);
  const item = sent.delivered.find((entry) => entry.agent === "worker-a");
  assert.equal(item.rang, false, JSON.stringify(item, null, 2));
  assert.equal(item.notification, "ring-failed", JSON.stringify(item, null, 2));
  assert.equal(item.delivery.state, "not-typed");
  assert.equal(item.delivery.escalated, true);
  assert.ok(item.delivery.rungs.length > 1, "a pointer that does not land is retried before it is called a failure");
  // Exit 3 is for exactly this: the pane was judged safe and the pointer still did not land.
  assert.equal(result.code, 3, `expected exit 3, got ${result.code}: ${result.stderr}`);

  // Never silent. The journal carries it and `status` says which message is stuck and why.
  const journal = JSON.parse(await ao(["journal", "--run", runDir, "--limit", "200"], env));
  assert.ok(journal.some((event) => event.type === "message.undelivered" && event.agent === "worker-a"), JSON.stringify(journal.map((e) => e.type)));
  const status = JSON.parse(await ao(["status", "--run", runDir, "--json"], env));
  assert.equal(status.undelivered.length, 1, JSON.stringify(status.undelivered, null, 2));
  assert.equal(status.undelivered[0].agent, "worker-a");
  assert.equal(status.undelivered[0].notification, "ring-failed");
  assert.match(await ao(["status", "--run", runDir], env), /! UNDELIVERED/);

  // And the message of record is untouched: the file is there, and nothing re-sent it.
  const inbox = await readdir(join(runDir, "agents", "worker-a", "inbox"));
  assert.equal(inbox.filter((name) => name.includes("-deaf")).length, 1, JSON.stringify(inbox));
});

test("a pointer stuck in the composer is resubmitted with the submit key alone, never re-typed", { skip: tmuxAvailable ? false : "tmux not installed" }, async (t) => {
  const { runDir, env, worker } = await launchDeliveryRun(t, "stuck", { AO_RING_WINDOW_MS: "9000" });
  // A pane that echoes what is typed at it and never redraws a fresh prompt. The mechanism differs
  // from a real TUI — here the line discipline does the echoing — but the OBSERVABLE is identical
  // and that is what the state machine reads: the occurrence count rises, and no line matching the
  // adapter's measured empty-composer pattern comes back. That is `typed-unsubmitted`, the TM-121
  // family: text sits in the composer, the agent looks idle, and nothing used to retry.
  await execFile("tmux", ["respawn-pane", "-k", "-t", worker.pane, `sh -c 'printf "> "; cat > /dev/null'`], { env: { ...process.env, ...env } });
  await new Promise((resolve) => setTimeout(resolve, 1000));
  await rebindPane(runDir, "worker-a", worker.pane, env);

  const result = await aoAllowingFailure(["send", "--run", runDir, "--providers-dir", join(root, "tests", "fixtures"), "--from", "conductor", "--to", "worker-a", "--stage", "stuck", "--body", "PING stuck"], env);
  const item = JSON.parse(result.stdout).delivered.find((entry) => entry.agent === "worker-a");
  assert.equal(item.notification, "stuck-in-composer", JSON.stringify(item, null, 2));
  assert.equal(item.delivery.state, "typed-unsubmitted");
  assert.equal(item.delivery.typed, true);
  assert.equal(item.delivery.escalated, true);
  assert.equal(result.code, 3, `expected exit 3, got ${result.code}: ${result.stderr}`);
  // Cheapest rung first, and it NEVER re-types: re-typing would append a second copy of the pointer
  // to the draft already sitting in the composer, and the agent would read a doubled message.
  assert.deepEqual(item.delivery.rungs.slice(0, 3), ["retype", "resubmit", "resubmit"], JSON.stringify(item.delivery.rungs));
  assert.equal(item.delivery.rungs.filter((rung) => rung === "retype").length, 1, JSON.stringify(item.delivery.rungs));
  // The direct evidence, and the assertion a future refactor of the ladder would break first.
  const screen = await ao(["capture", "--run", runDir, "--agent", "worker-a", "--lines", "60"], env);
  assert.equal(screen.split("[ao] Message").length - 1, 1, `the pointer must appear on the pane exactly once:\n${screen}`);
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
    // Scoped by SOCKET, not only by env. This teardown used to be a bare `kill-server` in a
    // sibling test, and an inherited $TMUX made it target the OPERATOR'S server: it destroyed 37
    // live agent sessions on 2026-09-09. Env isolation is correct here and is kept, but it is one
    // careless edit away from doing that again, so the socket is named explicitly as well.
    const socket = await execFile('tmux', ['display-message', '-p', '#{socket_path}'], { env })
      .then(r => r.stdout.trim()).catch(() => '');
    if (socket) await execFile('tmux', ['-S', socket, 'kill-server'], { env }).catch(() => {});
    await rm(dir, { recursive: true, force: true });
  }
});

// TM-164 AC4. The unit suite proves the gate with a fake tmux; this proves it on a real server: a
// managed observer pane, a real prompt acknowledgement typed from inside it, and the attachment
// that must not exist until that acknowledgement lands.
test("observer start commits a v2 attachment only after its own pane acknowledges the current prompt", { skip: tmuxAvailable ? false : "tmux not installed" }, async (t) => {
  const { env, consumer, runId } = await launchDeliveryRun(t, "observer");
  const state = env.AGENT_ORCHESTRATION_STATE_HOME;
  const present = (path) => access(path).then(() => true, () => false);
  const six = (b) => ["serverKey", "serverPid", "sessionId", "sessionCreated", "paneId", "panePid"].map((key) => String(b?.[key]));

  // `launch` self-started a supervisor. It must live on the isolated server: one that inherited the
  // operator's $TMUX would reconcile, and label, the operator's panes.
  const supervisors = await supervisorsFor(consumer);
  assert.ok(supervisors.length >= 1, "launch self-starts a supervisor; none was found, so its isolation went unchecked");
  if (process.platform === "linux") {
    for (const pid of supervisors) {
      const environ = (await readFile(`/proc/${pid}/environ`, "utf8")).split("\0");
      assert.ok(environ.includes("TMUX=") && environ.includes(`TMUX_TMPDIR=${consumer}`), `supervisor ${pid} does not carry the isolated tmux env`);
    }
  }

  // The fake provider. It draws a prompt and, when the standing bootstrap pointer arrives, marks that
  // it is withholding, waits for the test to release it, then acknowledges from inside its own pane
  // exactly as the generated prompt instructs a real observer to.
  const fixture = join(consumer, "observer-fixture");
  await mkdir(fixture, { recursive: true });
  const withheld = join(fixture, "withheld"), release = join(fixture, "release"), provider = join(fixture, "fake-observer.sh");
  const stateField = (key) => `$('${process.execPath}' -p 'require(process.cwd() + "/prompt-state.json").${key}')`;
  await writeFile(provider, `${[
    "#!/bin/sh",
    "printf 'fake-observer ready\\n> '",
    "while IFS= read -r line; do",
    '  case "$line" in',
    '    Read*"begin your standing role"*)',
    `      : > '${withheld}'`,
    `      while [ ! -e '${release}' ]; do sleep 0.1; done`,
    `      '${process.execPath}' '${cli}' prompt ack "$AO_AGENT_ID" --consumer "$AO_CONSUMER" --revision "${stateField("desired_revision")}" --nonce "${stateField("nonce")}" --json > ack.json 2>&1`,
    "      printf 'acked\\n> ' ;;",
    "    *) printf '> ' ;;",
    "  esac",
    "done",
  ].join("\n")}\n`, { mode: 0o755 });
  await writeJson(join(fixture, "fake-observer.json"), {
    id: "fake-observer", display: "Fake observer (tests)", command: "sh", args: [provider],
    model_args: [], system_prompt_args: [], auto_approve_args: [],
    ready: { pattern: "^>", tmux_pattern: "^>", delay_ms: 200, timeout_ms: 30000 },
    submit_keys: ["Enter"], detect: null, notes: "Test-only observer provider written by tests/contract/topology-tmux.test.mjs.",
  });

  const created = JSON.parse(await ao(["agent", "new", "--role", "observer", "--cli", "fake-observer", "--name", "Olive Watcher", "--consumer", consumer], env));
  const observerId = created.id, agentDir = created.dir;
  const attachmentPath = join(state, "observers", observerId, "attachment.json");

  let startResult = null;
  const starting = aoAllowingFailure(["observer", "start", "--consumer", consumer, "--target", `run:${runId}`, "--observer", observerId,
    "--providers-dir", fixture, "--ack-timeout", "30s", "--json"], env).then((result) => (startResult = result));
  const until = async (check, what) => {
    for (const deadline = Date.now() + 60_000; Date.now() < deadline && !startResult; await sleep(100)) if (await check()) return;
    assert.fail(`${what}; observer start ${startResult ? `already exited: ${JSON.stringify(startResult)}` : "is still running"}`);
  };

  // 1. No attachment while the acknowledgement is withheld.
  await until(() => present(withheld), "the observer pane never received its standing bootstrap pointer");
  // The managed-launch startup journal line is openRoleSession's LAST step. Absence asserted before it
  // would pass with no gate at all, because the session is still opening; after it, the prompt
  // acknowledgement is the only thing left between observer start and an attachment.
  const sessionOpened = async () => {
    for (const name of await readdir(join(state, "startup")).catch(() => [])) {
      if ((await readFile(join(state, "startup", name), "utf8")).includes(`"agentId":"${observerId}"`)) return true;
    }
    return false;
  };
  await until(sessionOpened, "the observer session never finished opening");
  for (let i = 0; i < 20; i += 1) {
    assert.equal(await present(attachmentPath), false, "an attachment was committed before the observer acknowledged its prompt");
    await sleep(100);
  }
  const staged = JSON.parse(await readFile(join(agentDir, "prompt-state.json"), "utf8"));
  assert.equal(staged.status, "awaiting-ack", JSON.stringify(staged));
  assert.equal(startResult, null, "observer start must still be waiting for the acknowledgement");

  // The right agent, session, repository, nonce and revision — from a process that is not the pane.
  const forged = await aoAllowingFailure(["prompt", "ack", observerId, "--consumer", consumer, "--revision", staged.desired_revision, "--nonce", staged.nonce, "--json"],
    { ...env, AO_AGENT_ID: observerId, AO_SESSION: staged.desired_session, AO_CONSUMER: consumer, TMUX_PANE: "" });
  assert.equal(forged.code, 1, `${forged.stdout}${forged.stderr}`);
  assert.equal(JSON.parse(forged.stdout).details?.reason, "incarnation-mismatch", forged.stdout);
  assert.equal(await present(attachmentPath), false, "a refused acknowledgement must not attach the observer");

  // 2. Release: the pane acknowledges from its own process, and observer start commits.
  await writeFile(release, "");
  const started = await starting;
  const ack = await readFile(join(agentDir, "ack.json"), "utf8").catch((error) => error.message);
  assert.equal(started.code, 0, `observer start failed after the pane was released.\nstdout: ${started.stdout}\nstderr: ${started.stderr}\nack.json: ${ack}`);
  const result = JSON.parse(started.stdout);
  const { attachment } = result;
  assert.deepEqual(JSON.parse(await readFile(attachmentPath, "utf8")), attachment, "the committed file is the attachment start reported");
  assert.equal(attachment.version, 2);
  assert.equal(attachment.observation_allowed, true);
  assert.ok(attachment.prompt_acknowledged_at, JSON.stringify(attachment));
  const binding = attachment.observer_binding;
  assert.ok(binding.serverKey.startsWith(`${consumer}/`), `observer bound to a tmux server outside this test's TMUX_TMPDIR: ${binding.serverKey}`);
  const panes = (await execFile("tmux", ["-S", binding.serverKey, "list-panes", "-a", "-F",
    "#{socket_path}|#{pid}|#{session_id}|#{session_created}|#{pane_id}|#{pane_pid}|#{session_name}|#{pane_dead}"], { env: { ...process.env, ...env } }))
    .stdout.trim().split("\n").map((line) => line.split("|"));
  const bound = panes.filter((pane) => pane.slice(0, 6).join("|") === six(binding).join("|"));
  assert.equal(bound.length, 1, `observer_binding matches no live pane:\n${JSON.stringify(binding)}\n${panes.map((pane) => pane.join("|")).join("\n")}`);
  assert.deepEqual(bound[0].slice(6), [attachment.observer_session, "0"], "the bound pane must be the live observer session");
  assert.equal(result.activation_delivery?.delivered, true, JSON.stringify(result.activation_delivery));
  const status = JSON.parse(await ao(["observer", "status", "--consumer", consumer, "--observer", observerId], env));
  assert.deepEqual([status.status, status.observation_allowed, status.prompt_current], ["attached", true, true], JSON.stringify(status));

  // 3. No stale prompt source: the attached revision is the prompt composed now, is the file the pane
  // was told to read, and is what that exact pane acknowledged.
  const composed = JSON.parse(await ao(["prompt", "preview", observerId, "--consumer", consumer], env));
  assert.equal(composed.ok, true, JSON.stringify(composed.errors));
  assert.equal(attachment.prompt_revision, composed.revision);
  const promptFile = await readFile(join(agentDir, "prompt.md"), "utf8");
  assert.equal(createHash("sha256").update(promptFile, "utf8").digest("hex").slice(0, 16), attachment.prompt_revision, "prompt.md is not the revision the observer attached with");
  const applied = JSON.parse(await readFile(join(agentDir, "prompt-state.json"), "utf8"));
  assert.deepEqual([applied.status, applied.desired_revision, applied.applied_revision], ["current", attachment.prompt_revision, attachment.prompt_revision], JSON.stringify(applied));
  assert.deepEqual(six(applied.applied_binding), six(binding), "the acknowledgement must come from the bound pane");
});
