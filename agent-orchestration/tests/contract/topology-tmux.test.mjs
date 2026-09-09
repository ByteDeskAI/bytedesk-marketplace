// End-to-end: launch a two-agent spec into a real tmux server with fake agent CLIs, send a
// message through the mailbox, wait for the replies, and stop the session. Skips without tmux.
import assert from "node:assert/strict";
import { execFile as execFileCallback } from "node:child_process";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
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
    await execFile("tmux", ["kill-session", "-t", launched.session], { env: { ...process.env, ...env } }).catch(() => {});
    await rm(consumer, { recursive: true, force: true });
  });
  const worker = launched.agents.find((agent) => agent.id === "worker-a");
  return { runDir: launched.runDir, session: launched.session, env, consumer, worker };
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
    await execFile('tmux', ['kill-server'], { env }).catch(() => {});
    await rm(dir, { recursive: true, force: true });
  }
});
