// TM-297: `agent restart --mode handoff|resume` applies a changed prompt to a running agent. Every
// real-tmux case runs on its own isolated server (tests/helpers/isolated-tmux.mjs); the agent is
// tests/fixtures/fake-turn-agent.mjs, which logs its argv and every line typed into it with the phase
// (busy or idle) it arrived in. No real provider runs: the adapters below run node.
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import { openRoleSession } from "../../topology/lib/launch.mjs";
import { sanitizeCwd } from "../../topology/lib/providers.mjs";
import * as tmux from "../../topology/lib/tmux.mjs";
import { isolatedTmux } from "../helpers/isolated-tmux.mjs";
import { optOutOfEnrollment } from "../helpers/temp-repo.mjs";

const exec = promisify(execFile);
const HERE = dirname(fileURLToPath(import.meta.url));
const AGENT = join(HERE, "../fixtures/fake-turn-agent.mjs");
const CLI = join(HERE, "../../topology/cli.mjs");
const haveTmux = await exec("tmux", ["-V"]).then(() => true, () => false);
const FAST = { turnTimeoutMs: 30_000, handoffTimeoutMs: 15_000, exitTimeoutMs: 5_000, pollMs: 300 };
const COMPOSER = { empty_tmux_pattern: "^>[^a-zA-Z0-9]*$", empty_pattern: "(^|\\n)>[^a-zA-Z0-9\\n]*$", note: "the fake-turn fixture idles on a bare > line; same patterns as fixtures/fake-agent.json" };

async function scratch(t) {
  const root = await realpath(await mkdtemp(join(tmpdir(), "ao-restart-")));
  t.after(() => rm(root, { recursive: true, force: true }));
  return root;
}
const events = async (log) => (await readFile(log, "utf8").catch(() => "")).split("\n").filter(Boolean).map((line) => JSON.parse(line));
async function until(check, ms = 20_000, what = "condition") {
  const deadline = Date.now() + ms;
  for (;;) {
    const value = await check();
    if (value) return value;
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`);
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}

test("agent restart --mode handoff replaces the live session on the promoted prompt and passes the handoff; resume without provider support falls back and says so; agent list flags restart_required", { skip: haveTmux ? false : "no tmux" }, async (t) => {
  const root = await scratch(t);
  const consumer = join(root, "app");
  await mkdir(consumer);
  await exec("git", ["-C", consumer, "init", "-q"]);
  await optOutOfEnrollment(consumer); // TM-290: no supervisor, so no real lead provider
  const providers = join(root, "providers");
  await mkdir(providers);
  // A fake provider with no resume_args: resume must fall back to handoff.
  await writeFile(join(providers, "fake-turn.json"), JSON.stringify({ id: "fake-turn", command: process.execPath, args: [AGENT], submit_keys: ["Enter"],
    exit_command: "/exit", composer: COMPOSER, ready: { pattern: "^>", tmux_pattern: "^>", delay_ms: 300, timeout_ms: 30_000 } }));
  const log = join(root, "agent.log");
  const iso = isolatedTmux(t, { extraEnv: { AO_TMUX_COMMAND: "tmux", AO_TRANSPORT: "file", AGENT_ORCHESTRATION_SERVICES: "0", AGENT_ORCHESTRATION_STATE_HOME: join(root, "state"),
    HOME: join(root, "home"), XDG_CONFIG_HOME: join(root, ".cfg"), AO_NODE_NAME: "agents1", FAKE_TURN_LOG: log, FAKE_TURN_BUSY_MS: "1500", FAKE_TURN_HANDOFF: "1" } });
  assert.equal(iso.env.TMUX, "", "never inherit an operator tmux server");
  const ao = async (...args) => {
    const done = await exec(process.execPath, [CLI, ...args, "--consumer", consumer, "--providers-dir", providers, "--json"], { env: iso.env, timeout: 180_000 }).catch((error) => {
      error.message = `${args.slice(0, 2).join(" ")} failed: ${error.stdout}${error.stderr}`;
      throw error;
    });
    return JSON.parse(done.stdout);
  };
  const listed = async (id) => (await ao("agent", "list")).agents.find((entry) => entry.id === id);

  const agent = await ao("agent", "new", "--role", "lead", "--cli", "fake-turn", "--name", "Ada Lovelace");
  const opened = await ao("session", "open", agent.id);
  const first = await until(async () => (await events(log)).find((entry) => entry.event === "start"), 20_000, "the first incarnation");
  await until(async () => (await events(log)).some((entry) => entry.pid === first.pid && entry.event === "received"), 20_000, "the bootstrap");

  const before = await listed(agent.id);
  assert.equal(before.restart_required, false, JSON.stringify(before));
  assert.ok(before.desired_revision && before.applied_revision === before.desired_revision, "the live agent runs the composed prompt");

  // Change the prompt: the per-agent instructions layer.
  const definition = join(opened.cwd, "agent.json");
  await writeFile(definition, JSON.stringify({ ...JSON.parse(await readFile(definition, "utf8")), instructions: "NEW-INSTRUCTION-TM297" }));
  const changed = await listed(agent.id);
  assert.equal(changed.restart_required, true, JSON.stringify(changed));
  assert.equal(changed.applied_revision, before.applied_revision, "the running process still has the old prompt");
  assert.notEqual(changed.desired_revision, before.desired_revision);

  // Mid-turn when the restart arrives. (Every line starts a 1.5s turn. Kept shorter than the 2s pointer
  // settle on purpose: the fixture erases its spinner line at turn end, and with it any text typed
  // into that line mid-turn — so a successor still in its bootstrap turn would swallow the passed handoff.)
  await iso.tmux(["send-keys", "-t", opened.pane, "-l", "do some work"]);
  await iso.tmux(["send-keys", "-t", opened.pane, "Enter"]);
  await until(async () => (await events(log)).some((entry) => entry.pid === first.pid && entry.line === "do some work"), 10_000, "the work turn");
  const restarted = await ao("agent", "restart", agent.id, "--mode", "handoff", "--turn-timeout", "60s", "--handoff-timeout", "20s");
  const r = restarted.restart;
  assert.equal(r.mode, "handoff");
  assert.equal(r.fallback, undefined);
  assert.equal(r.old_session.session, opened.session);
  assert.equal(r.new_session.session, opened.session, "the successor keeps the session name");
  assert.ok(r.old_session.id && r.new_session.id && r.old_session.id !== r.new_session.id, "a new incarnation");
  assert.equal(r.new_session.predecessor, r.old_session.id);
  assert.ok(r.incarnation?.paneId, JSON.stringify(r.incarnation));
  assert.equal(r.prompt_revision, changed.desired_revision, "the promoted prompt is the changed one");
  assert.match(await readFile(join(opened.cwd, "prompt.md"), "utf8"), /NEW-INSTRUCTION-TM297/);
  assert.equal(restarted.respawned.handoff.source, "agent");
  assert.equal(restarted.respawned.passed_to_new_session, true);

  const all = await events(log);
  const oldLines = all.filter((entry) => entry.pid === first.pid && entry.event === "received");
  assert.ok(oldLines.every((entry) => entry.phase === "idle"), `nothing typed mid-turn: ${JSON.stringify(oldLines)}`);
  const workTurnEnd = all.findIndex((entry, index) => entry.pid === first.pid && entry.event === "turn-end" && index > all.findIndex((row) => row.line === "do some work"));
  assert.ok(workTurnEnd > 0 && all.findIndex((entry) => entry.line?.startsWith("[ao] Handoff requested")) > workTurnEnd, "the restart waited for the work turn to end");
  assert.deepEqual(oldLines.slice(-2).map((entry) => entry.line.slice(0, 24)), ["[ao] Handoff requested: ", "/exit"], "the handoff request, then the provider's own exit");
  const second = all.find((entry) => entry.event === "start" && entry.pid !== first.pid);
  assert.ok(second, "a successor started");
  const handedOff = await until(async () => (await events(log)).find((entry) => entry.pid === second.pid && entry.event === "received" && entry.line.includes(restarted.respawned.handoff.path)), 20_000, "the handoff pointer");
  assert.ok(handedOff);
  assert.equal((await listed(agent.id)).restart_required, false, "applied after the restart");

  // Resume on a provider that cannot: falls back to handoff and says why.
  const resumed = await ao("agent", "restart", agent.id, "--mode", "resume", "--turn-timeout", "60s", "--handoff-timeout", "20s");
  assert.equal(resumed.restart.mode, "handoff");
  assert.equal(resumed.restart.requested_mode, "resume");
  assert.equal(resumed.restart.fallback, "handoff");
  assert.match(resumed.restart.fallback_reason, /fake-turn declares no resume_args/);
  assert.equal(resumed.restart.old_session.id, r.new_session.id);
  // The fallback collected a handoff, so the successor must get it — else it starts with no context.
  assert.equal(resumed.respawned.handoff.source, "agent");
  assert.equal(resumed.respawned.passed_to_new_session, true, "a resume that fell back to handoff passes the handoff");
  const third = await until(async () => (await events(log)).find((entry) => entry.event === "start" && entry.pid !== first.pid && entry.pid !== second.pid), 20_000, "the fallback successor");
  await until(async () => (await events(log)).find((entry) => entry.pid === third.pid && entry.event === "received" && entry.line.includes(resumed.respawned.handoff.path)), 20_000, "the fallback handoff pointer");

  await assert.rejects(ao("agent", "restart", agent.id, "--mode", "sideways"), (error) => /TOPOLOGY_RESTART_MODE/.test(error.message));
  await ao("session", "close", agent.id);
  await assert.rejects(ao("agent", "restart", agent.id, "--mode", "handoff"), (error) => /TOPOLOGY_AGENT_NOT_LIVE/.test(error.message));
});

test("agent restart --mode resume relaunches resuming the same provider session id, with no handoff", { skip: haveTmux ? false : "no tmux" }, async (t) => {
  const root = await scratch(t);
  const iso = isolatedTmux(t, { extraEnv: { AGENT_ORCHESTRATION_STATE_HOME: join(root, "state"), AO_NODE_NAME: "agents1" } });
  const log = join(root, "agent.log");
  const agentsDir = join(root, "agents");
  const home = join(root, "home");
  // claude's adapter id (so its transcript is looked up) running the fake; resume_args as claude.json declares them.
  const adapter = { id: "claude", submit_keys: ["Enter"], exit_command: "/exit", resume_args: ["--resume", "{{provider_session_id}}"], ready: { delay_ms: 300 } };
  const open = (replace = null) => iso.within(() => openRoleSession({ agentsDir, agentId: "e5e5e5e5", adapter, argv: [process.execPath, AGENT], role: "worker",
    env: { FAKE_TURN_LOG: log, AGENT_ORCHESTRATION_STATE_HOME: join(root, "state"), AO_NODE_NAME: "agents1" }, session: "agents1--app--worker--eve",
    respawnBounds: FAST, replace, home }));
  const opened = await open();
  const first = await until(async () => (await events(log)).find((entry) => entry.event === "start"), 20_000, "the first incarnation");
  assert.deepEqual(first.argv, []);
  const transcripts = join(home, ".claude", "projects", sanitizeCwd(join(agentsDir, "e5e5e5e5")));
  await mkdir(transcripts, { recursive: true });
  await writeFile(join(transcripts, "0b5e7d2a-1111-4222-8333-944445555666.jsonl"), `${JSON.stringify({ type: "user", message: { content: "hello" } })}\n`);

  const restarted = await open("resume");
  assert.equal(restarted.session, opened.session);
  assert.equal(restarted.respawn.resume.provider_session_id, "0b5e7d2a-1111-4222-8333-944445555666");
  assert.equal(restarted.respawn.handoff, null, "a resumed conversation needs no handoff");
  const all = await events(log);
  assert.deepEqual(all.filter((entry) => entry.pid === first.pid && entry.event === "received").map((entry) => entry.line), ["/exit"], "no handoff request; the provider's own exit");
  const second = await until(async () => (await events(log)).find((entry) => entry.event === "start" && entry.pid !== first.pid), 20_000, "the successor");
  assert.deepEqual(second.argv, ["--resume", "0b5e7d2a-1111-4222-8333-944445555666"], "the successor resumes the same provider session");
  assert.equal(restarted.record.identity.predecessor, opened.record.identity.id);
});

test("agent restart never interrupts typed input, and refuses a session the agent does not own", { skip: haveTmux ? false : "no tmux" }, async (t) => {
  const root = await scratch(t);
  const iso = isolatedTmux(t, { extraEnv: { AGENT_ORCHESTRATION_STATE_HOME: join(root, "state"), AO_NODE_NAME: "agents1" } });
  const log = join(root, "agent.log");
  const agentsDir = join(root, "agents");
  const adapter = { id: "fake-turn", submit_keys: ["Enter"], exit_command: "/exit", composer: COMPOSER, ready: { delay_ms: 300 } };
  const open = (agentId, session, replace = null, bounds = FAST) => iso.within(() => openRoleSession({ agentsDir, agentId, adapter, argv: [process.execPath, AGENT], role: "worker",
    env: { FAKE_TURN_LOG: log, AGENT_ORCHESTRATION_STATE_HOME: join(root, "state"), AO_NODE_NAME: "agents1" }, session, respawnBounds: bounds, replace }));

  const opened = await open("f6f6f6f6", "agents1--app--worker--fay");
  const first = await until(async () => (await events(log)).find((entry) => entry.event === "start"), 20_000, "the agent");
  // Someone is typing into the composer and has not pressed Enter.
  await until(async () => /^> *$/m.test((await iso.tmux(["capture-pane", "-p", "-t", opened.pane])).stdout), 10_000, "the idle prompt");
  await iso.tmux(["send-keys", "-t", opened.pane, "-l", "half typed thought"]);
  await assert.rejects(open("f6f6f6f6", opened.session, "handoff", { ...FAST, turnTimeoutMs: 2_000 }),
    (error) => error.code === "TOPOLOGY_AGENT_BUSY" && /composer not empty/.test(error.details?.reason));
  assert.equal(await iso.within(() => tmux.hasSession(opened.session)), true, "the session is untouched");
  assert.deepEqual((await events(log)).filter((entry) => entry.pid === first.pid && entry.event === "received"), [], "nothing was typed or submitted");
  assert.match((await iso.tmux(["capture-pane", "-p", "-t", opened.pane])).stdout, /half typed thought/, "the typed input is still there");

  // A same-named session this agent has no record for is not its to restart.
  await iso.tmux(["new-session", "-d", "-s", "agents1--app--worker--gus", "sleep", "600"]);
  await assert.rejects(open("a7a7a7a7", "agents1--app--worker--gus", "handoff"), { code: "TOPOLOGY_SESSION_OWNERSHIP" });
  assert.equal(await iso.within(() => tmux.hasSession("agents1--app--worker--gus")), true);
});

test("agent restart --mode resume --pass-handoff on a resuming provider returns a result with no handoff to pass", { skip: haveTmux ? false : "no tmux" }, async (t) => {
  const root = await scratch(t);
  const consumer = join(root, "app");
  await mkdir(consumer);
  await exec("git", ["-C", consumer, "init", "-q"]);
  await optOutOfEnrollment(consumer);
  const providers = join(root, "providers");
  await mkdir(providers);
  // claude's id (so its transcript is looked up) and resume_args, running the fake — never a real claude.
  await writeFile(join(providers, "claude.json"), JSON.stringify({ id: "claude", command: process.execPath, args: [AGENT], submit_keys: ["Enter"], exit_command: "/exit",
    resume_args: ["--resume", "{{provider_session_id}}"], composer: COMPOSER, ready: { pattern: "^>", tmux_pattern: "^>", delay_ms: 300, timeout_ms: 30_000 } }));
  const log = join(root, "agent.log");
  const home = join(root, "home");
  const iso = isolatedTmux(t, { extraEnv: { AO_TMUX_COMMAND: "tmux", AO_TRANSPORT: "file", AGENT_ORCHESTRATION_SERVICES: "0", AGENT_ORCHESTRATION_STATE_HOME: join(root, "state"),
    HOME: home, XDG_CONFIG_HOME: join(root, ".cfg"), AO_NODE_NAME: "agents1", FAKE_TURN_LOG: log, FAKE_TURN_BUSY_MS: "300" } });
  assert.equal(iso.env.TMUX, "", "never inherit an operator tmux server");
  const ao = async (...args) => JSON.parse((await exec(process.execPath, [CLI, ...args, "--consumer", consumer, "--providers-dir", providers, "--json"], { env: iso.env, timeout: 180_000 })
    .catch((error) => { error.message = `${args.slice(0, 2).join(" ")} failed: ${error.stdout}${error.stderr}`; throw error; })).stdout);

  const agent = await ao("agent", "new", "--role", "lead", "--cli", "claude", "--name", "Rita Resume");
  const opened = await ao("session", "open", agent.id);
  const first = await until(async () => (await events(log)).find((entry) => entry.event === "start"), 20_000, "the first incarnation");
  await until(async () => (await events(log)).some((entry) => entry.pid === first.pid && entry.event === "received"), 20_000, "the bootstrap");
  const transcripts = join(home, ".claude", "projects", sanitizeCwd(opened.cwd));
  await mkdir(transcripts, { recursive: true });
  await writeFile(join(transcripts, "1c6f8e3b-2222-4333-8444-a55556666777.jsonl"), `${JSON.stringify({ type: "user", message: { content: "hello" } })}\n`);

  const restarted = await ao("agent", "restart", agent.id, "--mode", "resume", "--pass-handoff", "--turn-timeout", "60s", "--handoff-timeout", "20s");
  assert.equal(restarted.restart.mode, "resume");
  assert.equal(restarted.restart.fallback, undefined);
  assert.equal(restarted.restart.provider_session_id, "1c6f8e3b-2222-4333-8444-a55556666777");
  assert.equal(restarted.respawned.handoff, null, "a resumed conversation collected no handoff");
  assert.equal(restarted.respawned.passed_to_new_session, false);
  const second = await until(async () => (await events(log)).find((entry) => entry.event === "start" && entry.pid !== first.pid), 20_000, "the successor");
  assert.deepEqual(second.argv.slice(-2), ["--resume", "1c6f8e3b-2222-4333-8444-a55556666777"]);
  await ao("session", "close", agent.id);
});
