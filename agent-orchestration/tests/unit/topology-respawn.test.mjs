// TM-280 / ADR-0030 part 4: re-spawning a live library agent. Every real-tmux case runs on its own
// isolated server (tests/helpers/isolated-tmux.mjs, .claude/rules/tmux-test-isolation.md). The agent
// is tests/fixtures/fake-turn-agent.mjs, which logs every line typed into it with the phase (busy or
// idle) it arrived in — so "never mid-turn" is asserted on what the pane actually received.
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import { claimAgent, fallbackHandoff, readTail, sessionPanes, transcriptTurns, passHandoff } from "../../topology/lib/respawn.mjs";
import { openRoleSession } from "../../topology/lib/launch.mjs";
import { sanitizeCwd } from "../../topology/lib/providers.mjs";
import { ulid } from "../../topology/lib/session-names.mjs";
import * as tmux from "../../topology/lib/tmux.mjs";
import { isolatedTmux } from "../helpers/isolated-tmux.mjs";
import { optOutOfEnrollment } from "../helpers/temp-repo.mjs";

const exec = promisify(execFile);
const HERE = dirname(fileURLToPath(import.meta.url));
const AGENT = join(HERE, "../fixtures/fake-turn-agent.mjs");
const haveTmux = await exec("tmux", ["-V"]).then(() => true, () => false);
const FAKE = { id: "fake-agent", submit_keys: ["Enter"] };
const FAST = { turnTimeoutMs: 30_000, handoffTimeoutMs: 15_000, exitTimeoutMs: 5_000, pollMs: 300 };

async function scratch(t) {
  const root = await realpath(await mkdtemp(join(tmpdir(), "ao-respawn-")));
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

/** A live session for `agentId` running the fake agent, with identity metadata; returns its pid. */
async function holder(iso, name, { agentId, id, log, env = {}, cwd }) {
  const vars = Object.entries({ FAKE_TURN_LOG: log, ...env }).flatMap(([key, value]) => ["-e", `${key}=${value}`]);
  await iso.tmux(["-f", "/dev/null", "new-session", "-d", "-s", name, "-x", "200", "-y", "50", "-c", cwd, ...vars, process.execPath, AGENT]);
  const pane = (await iso.tmux(["display-message", "-p", "-t", `=${name}:`, "#{pane_id}"])).stdout.trim();
  await iso.within(() => tmux.setIdentity(pane, { session: { id, agent: agentId, role: "worker", kind: "spawn", run: "r0" } }));
  const started = await until(async () => (await events(log)).find((entry) => entry.event === "start"), 20_000, "the fake agent to start");
  return { pane, pid: started.pid };
}

function setup(t, root) {
  const iso = isolatedTmux(t, { extraEnv: { AGENT_ORCHESTRATION_STATE_HOME: join(root, "state"), AO_NODE_NAME: "agents1" } });
  assert.equal(iso.env.TMUX, "", "never inherit an operator tmux server");
  const kills = [];
  const killSession = async (session) => { kills.push(session); return tmux.killSession(session); };
  return { iso, kills, env: iso.env, deps: { killSession } };
}

test("re-spawn waits out the turn, collects the agent's handoff for the caller, and does not give it to the new session", { skip: haveTmux ? false : "no tmux" }, async (t) => {
  const root = await scratch(t);
  const { iso, kills } = setup(t, root);
  const log = join(root, "agent.log");
  const agentsDir = join(root, "agents");
  const id = ulid();
  // Mid-turn for 4s when the re-spawn arrives.
  const old = await holder(iso, "spawn-holder", { agentId: "a1a1a1a1", id, log, cwd: root, env: { FAKE_TURN_START_BUSY_MS: "4000", FAKE_TURN_HANDOFF: "1" } });

  const opened = await iso.within(() => openRoleSession({
    agentsDir, agentId: "a1a1a1a1", adapter: FAKE, argv: [process.execPath, AGENT], role: "worker",
    env: { FAKE_TURN_LOG: log, AGENT_ORCHESTRATION_STATE_HOME: join(root, "state"), AO_NODE_NAME: "agents1" },
    session: "agents1--app--worker--ada", respawnBounds: FAST, respawn: true,
  }));
  assert.ok(opened.respawn, "the live agent was re-spawned, not refused");

  // Ordering: the turn ended BEFORE anything was typed into the old pane, and nothing arrived busy.
  const all = await events(log);
  const mine = all.filter((entry) => entry.pid === old.pid);
  const turnEnd = mine.findIndex((entry) => entry.event === "turn-end");
  const received = mine.filter((entry) => entry.event === "received");
  assert.deepEqual(received.map((entry) => entry.phase), ["idle"], `exactly one line, the handoff request, and none mid-turn: ${JSON.stringify(received)}`);
  assert.ok(turnEnd >= 0, "the fake agent's turn ended");
  assert.ok(mine.indexOf(received[0]) > turnEnd, "the handoff request came after the turn ended");
  assert.match(received[0].line, /^\[ao\] Handoff requested/);

  // The agent's own handoff is returned to the caller.
  assert.equal(opened.respawn.handoff.source, "agent");
  const text = await readFile(opened.respawn.handoff.path, "utf8");
  assert.match(text, /## Goal\nfinish the widget/);
  assert.match(text, new RegExp(`pid ${old.pid}`));

  // Old session ended exactly once; the predecessor is recorded on the new incarnation.
  assert.equal(await iso.within(() => tmux.hasSession("spawn-holder")), false);
  assert.equal(opened.respawn.predecessor.id, id);
  assert.equal(opened.record.identity.predecessor, id, "session.json names the predecessor");
  assert.notEqual(opened.record.identity.id, id, "the new incarnation has its own ULID");
  const [newPane] = await iso.within(() => sessionPanes("agents1--app--worker--ada"));
  assert.equal(newPane.meta.predecessor, id, "@ao-predecessor is on the new session");
  assert.equal(newPane.meta.id, opened.record.identity.id);
  void kills;

  // The new session received nothing — the lead has not passed the handoff.
  const fresh = await until(async () => (await events(log)).find((entry) => entry.event === "start" && entry.pid !== old.pid), 20_000, "the new incarnation");
  await new Promise((resolve) => setTimeout(resolve, 1500));
  assert.deepEqual((await events(log)).filter((entry) => entry.pid === fresh.pid && entry.event === "received"), [], "no handoff was injected");

  // Only when the lead passes it.
  const passed = await iso.within(() => passHandoff({ pane: newPane.paneId, adapter: FAKE, path: opened.respawn.handoff.path }));
  assert.equal(passed.delivered, true);
  const got = await until(async () => (await events(log)).find((entry) => entry.pid === fresh.pid && entry.event === "received"), 10_000, "the passed handoff");
  assert.ok(got.line.includes(opened.respawn.handoff.path), got.line);
});

test("an agent that never answers gets a labelled transcript fallback, and its session is ended exactly once", { skip: haveTmux ? false : "no tmux" }, async (t) => {
  const root = await scratch(t);
  const { iso, kills, deps } = setup(t, root);
  const log = join(root, "agent.log");
  const cwd = join(root, "work.dir");
  await mkdir(cwd);
  // A claude-shaped transcript where Claude Code keeps it: ~/.claude/projects/<cwd, / and . as ->/.
  const home = join(root, "home");
  const transcripts = join(home, ".claude", "projects", sanitizeCwd(cwd));
  await mkdir(transcripts, { recursive: true });
  const lines = [
    "{not json — a partial write}",
    JSON.stringify({ type: "user", message: { content: "Please refactor the parser" } }),
    JSON.stringify({ type: "assistant", message: { stop_reason: "tool_use", content: [{ type: "thinking", thinking: "SECRET-THOUGHT", signature: "x" }, { type: "text", text: "Refactoring parser.mjs now" }, { type: "tool_use", name: "Edit", input: {} }] } }),
    JSON.stringify({ type: "user", message: { content: [{ type: "image", source: { data: "BASE64BLOB" } }, { type: "tool_result", content: "ok" }] } }),
    JSON.stringify({ type: "some-future-type", x: 1 }),
    JSON.stringify({ type: "assistant", message: { stop_reason: "end_turn", content: [{ type: "text", text: "Parser split into two modules" }] } }),
  ];
  await writeFile(join(transcripts, "11111111-old.jsonl"), `${JSON.stringify({ type: "user", message: { content: "an older conversation" } })}\n`);
  await new Promise((resolve) => setTimeout(resolve, 20));
  await writeFile(join(transcripts, "22222222-live.jsonl"), `${lines.join("\n")}\n`);

  const id = ulid();
  const old = await holder(iso, "silent-holder", { agentId: "b2b2b2b2", id, log, cwd, env: { FAKE_TURN_HANDOFF: "0" } });
  // claude's adapter id (so the transcript is looked up) with an exit command the fake honours.
  const adapter = { id: "claude", submit_keys: ["Enter"], exit_command: "/exit" };
  const claim = await iso.within(() => claimAgent({ agentId: "b2b2b2b2", adapter, home, env: { ...process.env, AGENT_ORCHESTRATION_STATE_HOME: join(root, "state") },
    bounds: { ...FAST, handoffTimeoutMs: 1_500 }, deps }));
  await claim.release();

  assert.equal(claim.respawn.handoff.source, "transcript-fallback");
  assert.equal(claim.respawn.handoff.transcript, join(transcripts, "22222222-live.jsonl"), "the newest transcript is the live one");
  const text = await readFile(claim.respawn.handoff.path, "utf8");
  assert.match(text, /^# Handoff — TRANSCRIPT-DERIVED FALLBACK/);
  assert.match(text, /NOT its own account/);
  assert.match(text, /Refactoring parser\.mjs now \(tool: Edit\)/);
  assert.match(text, /Parser split into two modules/);
  assert.doesNotMatch(text, /SECRET-THOUGHT|BASE64BLOB|an older conversation/, "thinking and image blocks are dropped; only the live transcript is read");

  // Clean exit first (the fake received /exit and exited), then exactly one kill of that one session.
  const mine = (await events(log)).filter((entry) => entry.pid === old.pid);
  assert.ok(mine.some((entry) => entry.event === "exit"), "the provider's own exit command was sent first");
  assert.deepEqual(kills, ["silent-holder"], "the old session was ended exactly once, by its exact name");
  assert.equal(await iso.within(() => tmux.hasSession("silent-holder")), false);
});

test("--no-respawn keeps TOPOLOGY_AGENT_ALREADY_LIVE; a turn that never ends refuses with the session untouched", { skip: haveTmux ? false : "no tmux" }, async (t) => {
  const root = await scratch(t);
  const { iso, kills, deps } = setup(t, root);
  const log = join(root, "agent.log");
  const env = { ...process.env, AGENT_ORCHESTRATION_STATE_HOME: join(root, "state") };
  const old = await holder(iso, "busy-holder", { agentId: "c3c3c3c3", id: ulid(), log, cwd: root, env: { FAKE_TURN_START_BUSY_MS: "600000" } });

  await assert.rejects(iso.within(() => claimAgent({ agentId: "c3c3c3c3", adapter: FAKE, respawn: false, env, deps })), { code: "TOPOLOGY_AGENT_ALREADY_LIVE" });
  await assert.rejects(iso.within(() => claimAgent({ agentId: "c3c3c3c3", adapter: FAKE, env, deps, bounds: { ...FAST, turnTimeoutMs: 1_500 } })), { code: "TOPOLOGY_AGENT_BUSY" });
  assert.deepEqual(kills, [], "nothing was killed");
  assert.equal(await iso.within(() => tmux.hasSession("busy-holder")), true, "the busy session is untouched");
  assert.deepEqual((await events(log)).filter((entry) => entry.pid === old.pid && entry.event === "received"), [], "nothing was typed into it");
  // Both refusals released the lock: a third claim gets past it (and is refused for the same reason).
  await assert.rejects(iso.within(() => claimAgent({ agentId: "c3c3c3c3", adapter: FAKE, respawn: false, env, deps })), { code: "TOPOLOGY_AGENT_ALREADY_LIVE" });
});

test("TM-484: an open that does not ask to respawn refuses a live agent, and nobody replaces its own session", { skip: haveTmux ? false : "no tmux" }, async (t) => {
  const root = await scratch(t);
  const { iso, kills, deps } = setup(t, root);
  const log = join(root, "agent.log");
  const env = { ...process.env, AGENT_ORCHESTRATION_STATE_HOME: join(root, "state") };
  const old = await holder(iso, "self-holder", { agentId: "b8b8b8b8", id: ulid(), log, cwd: root });

  // Lead ensure, reviewer ensure and every other automated open pass no respawn: refused, untouched.
  await assert.rejects(iso.within(() => openRoleSession({ agentsDir: join(root, "agents"), agentId: "b8b8b8b8", adapter: FAKE, argv: [process.execPath, AGENT], role: "lead",
    env: { FAKE_TURN_LOG: log, AGENT_ORCHESTRATION_STATE_HOME: join(root, "state"), AO_NODE_NAME: "agents1" }, session: "agents1--app--lead--bo", respawnBounds: FAST })),
  { code: "TOPOLOGY_AGENT_ALREADY_LIVE" });

  // Asked to respawn, but from inside the live session itself: refused before anything is typed. The
  // real caller lookup runs: TMUX names this test's server and TMUX_PANE the holder's own pane.
  const saved = { TMUX: process.env.TMUX, TMUX_PANE: process.env.TMUX_PANE };
  t.after(() => { for (const [key, value] of Object.entries(saved)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; } });
  const socket = (await iso.tmux(["display-message", "-p", "-t", old.pane, "#{socket_path}"])).stdout.trim();
  Object.assign(process.env, { TMUX: `${socket},1,0`, TMUX_PANE: old.pane });
  await assert.rejects(iso.within(() => claimAgent({ agentId: "b8b8b8b8", adapter: FAKE, env, deps, bounds: FAST })), { code: "TOPOLOGY_RESPAWN_SELF" });
  // The same pane id on a DIFFERENT server (an operator shell's stale TMUX) is not the caller.
  process.env.TMUX = `${join(root, "elsewhere.sock")},1,0`;
  await assert.rejects(iso.within(() => claimAgent({ agentId: "b8b8b8b8", adapter: FAKE, respawn: false, env, deps })), { code: "TOPOLOGY_AGENT_ALREADY_LIVE" });

  assert.deepEqual(kills, [], "nothing was killed");
  assert.equal(await iso.within(() => tmux.hasSession("self-holder")), true, "the live session is untouched");
  assert.deepEqual((await events(log)).filter((entry) => entry.pid === old.pid && entry.event === "received"), [], "nothing was typed into it");
});

test("two concurrent re-spawns of one agent replace it exactly once; the loser joins the winner's result", { skip: haveTmux ? false : "no tmux" }, async (t) => {
  const root = await scratch(t);
  const { iso, kills, deps } = setup(t, root);
  const log = join(root, "agent.log");
  const env = { ...process.env, AGENT_ORCHESTRATION_STATE_HOME: join(root, "state") };
  const id = ulid();
  await holder(iso, "agents1--app--worker--dot", { agentId: "d4d4d4d4", id, log, cwd: root, env: { FAKE_TURN_START_BUSY_MS: "1500", FAKE_TURN_HANDOFF: "1" } });

  // Each caller, like launch, creates the replacement under the same name before releasing.
  const respawnOnce = async () => {
    const claim = await iso.within(() => claimAgent({ agentId: "d4d4d4d4", adapter: FAKE, env, deps, bounds: FAST }));
    try {
      await iso.tmux(["new-session", "-d", "-s", "agents1--app--worker--dot", "-e", `FAKE_TURN_LOG=${log}`, process.execPath, AGENT]);
      const pane = (await iso.tmux(["display-message", "-p", "-t", "=agents1--app--worker--dot:", "#{pane_id}"])).stdout.trim();
      await iso.within(() => tmux.setIdentity(pane, { session: { id: ulid(), agent: "d4d4d4d4", kind: "spawn", predecessor: claim.respawn?.predecessor.id } }));
      return claim.respawn;
    } finally { await claim.release(); }
  };
  const outcomes = await Promise.allSettled([respawnOnce(), respawnOnce()]);
  const won = outcomes.filter((outcome) => outcome.status === "fulfilled");
  const lost = outcomes.filter((outcome) => outcome.status === "rejected");
  assert.equal(won.length, 1, JSON.stringify(outcomes.map((outcome) => outcome.reason?.code ?? "ok")));
  assert.equal(lost.length, 1);
  assert.equal(lost[0].reason.code, "TOPOLOGY_RESPAWN_JOINED");
  assert.equal(lost[0].reason.details.joined.handoff.path, won[0].value.handoff.path, "the loser carries the winner's handoff");
  assert.deepEqual(kills, ["agents1--app--worker--dot"], "exactly one replacement");
  assert.equal(won[0].value.predecessor.id, id);
});

test("transcript reading tolerates junk and never reads more than the tail", async (t) => {
  const root = await scratch(t);
  const file = join(root, "t.jsonl");
  const filler = JSON.stringify({ type: "user", message: { content: "x".repeat(1000) } });
  await writeFile(file, `${Array.from({ length: 400 }, () => filler).join("\n")}\n${JSON.stringify({ type: "assistant", message: { content: [{ type: "text", text: "LAST" }] } })}\n`);
  const lines = await readTail(file, 8 * 1024);
  assert.ok(lines.length < 10, `only the tail was read (${lines.length} lines)`);
  const turns = transcriptTurns(lines);
  assert.equal(turns.at(-1).text, "LAST");
  assert.match(fallbackHandoff({ agentId: "x", waitedMs: 1000, paneTail: "screen" }), /PANE-CAPTURE FALLBACK/);
});

test("launch of a live library agent re-spawns it under the SAME name and returns the handoff; session handoff passes it", { skip: haveTmux ? false : "no tmux" }, async (t) => {
  const root = await scratch(t);
  const consumer = join(root, "app");
  await mkdir(consumer);
  await exec("git", ["-C", consumer, "init", "-q"]);
  await optOutOfEnrollment(consumer); // TM-290: launch self-starts a supervisor, whose lead would be real
  const log = join(root, "agent.log");
  const iso = isolatedTmux(t, { extraEnv: { AO_TMUX_COMMAND: "tmux", AO_TRANSPORT: "file", AGENT_ORCHESTRATION_SERVICES: "0", AGENT_ORCHESTRATION_STATE_HOME: join(root, "state"),
    XDG_CONFIG_HOME: join(root, ".cfg"), AO_NODE_NAME: "agents1", FAKE_TURN_LOG: log, FAKE_TURN_BUSY_MS: "3000", FAKE_TURN_HANDOFF: "1", FAKE_TURN_EXEC: "1" } });
  assert.equal(iso.env.TMUX, "", "never inherit an operator tmux server");
  const cli = join(HERE, "../../topology/cli.mjs");
  const ao = async (...args) => {
    const done = await exec(process.execPath, [cli, ...args, "--consumer", consumer, "--json"], { env: iso.env, timeout: 180_000 }).catch((error) => {
      error.message = `${args.slice(0, 2).join(" ")} failed: ${error.stdout}${error.stderr}`;
      throw error;
    });
    return JSON.parse(done.stdout);
  };
  const agent = await ao("agent", "new", "--role", "worker", "--cli", "fake-agent");
  const specPath = join(root, "solo.json");
  await writeFile(specPath, JSON.stringify({ version: 1, name: "solo", agents: [{ agent: agent.id, role: "orchestrator", cli: "fake-agent", args: [AGENT] }] }));
  const launch = (runId, ...extra) => ao("launch", "--spec", specPath, "--providers-dir", join(HERE, "../fixtures"), "--run-id", runId, ...extra);

  const first = await launch("run-one");
  const firstStart = (await events(log)).find((entry) => entry.event === "start");
  // Its bootstrap pointer starts a 3s turn; re-spawn while that turn runs.
  await until(async () => (await events(log)).some((entry) => entry.pid === firstStart.pid && entry.event === "received"), 20_000, "the bootstrap");
  const second = await launch("run-two", "--turn-timeout", "60s", "--handoff-timeout", "20s");

  assert.equal(second.session, first.session, "the fresh session has the same name");
  assert.equal(second.respawned?.length, 1);
  const [record] = second.respawned;
  assert.equal(record.predecessor.session, first.session);
  assert.equal(record.handoff.source, "agent");
  assert.match(record.handoff.text, /## Goal\nfinish the widget/, "the handoff text is returned to the caller");
  assert.equal(record.passed_to_new_session, false);

  const all = await events(log);
  const oldLines = all.filter((entry) => entry.pid === firstStart.pid && entry.event === "received");
  assert.equal(oldLines.length, 2, "the old agent got its bootstrap, then the handoff request");
  assert.equal(oldLines[1].phase, "idle", "the handoff request waited for the turn to end");
  const fresh = all.find((entry) => entry.event === "start" && entry.pid !== firstStart.pid);
  assert.ok(fresh, "a new incarnation started");
  assert.equal(all.filter((entry) => entry.event === "start").length, 2, "exactly one replacement");
  const freshLines = () => events(log).then((rows) => rows.filter((entry) => entry.pid === fresh.pid && entry.event === "received"));
  assert.ok((await freshLines()).every((entry) => !entry.line.includes(record.handoff.path) && !/handoff/i.test(entry.line)), "the new session was not given the handoff");

  // Recorded predecessor: run.json and the session's own metadata.
  const run = JSON.parse(await readFile(join(second.runDir, "run.json"), "utf8"));
  assert.equal(run.agents[0].predecessor, record.predecessor.id);
  assert.equal(run.session_identity.predecessor, record.predecessor.id);
  assert.ok(record.predecessor.id && record.predecessor.id !== run.session_identity.id);
  const [pane] = await iso.within(() => sessionPanes(second.session));
  assert.equal(pane.meta.predecessor, record.predecessor.id);

  // TM-463: an unidentified caller (neither the proven lead nor the agent) is refused and types nothing.
  await assert.rejects(ao("session", "handoff", agent.id, "--file", record.handoff.path), (error) => /TOPOLOGY_HANDOFF_UNAUTHORIZED/.test(error.message));
  assert.ok((await freshLines()).every((entry) => !entry.line.includes(record.handoff.path)), "a refused handoff typed nothing");
  // TM-463 F2: naming the agent in the env is a claim, not proof. This process is not in its pane.
  await assert.rejects(exec(process.execPath, [cli, "session", "handoff", agent.id, "--file", record.handoff.path, "--consumer", consumer, "--json"],
    { env: { ...iso.env, AO_AGENT_ID: agent.id, AO_CONSUMER: consumer }, timeout: 180_000 }), (error) => /TOPOLOGY_DELEGATION_ACTOR/.test(`${error.stdout}`));
  assert.ok((await freshLines()).every((entry) => !entry.line.includes(record.handoff.path)), "an env-only self claim typed nothing");

  // The agent itself, proven: the census binds its live pane, and the handoff runs as a child of the
  // agent's own pane process (the fixture's `!run`), so requireGranteeCaller's ancestry walk holds.
  const [live] = await iso.within(() => tmux.listServerPanes({ tmuxServer: iso.socket, env: iso.env }))
    .then((rows) => rows.filter((row) => row.paneId === pane.paneId));
  assert.ok(live, `pane ${pane.paneId} is listed on the test server`);
  const { canonicalRepoId, repoKey } = await import("../../topology/lib/repoid.mjs");
  const { censusPath } = await import("../../topology/lib/census.mjs");
  const { PRESENCE_BINDING_FIELDS } = await import("../../topology/lib/presence.mjs");
  const binding = Object.fromEntries(PRESENCE_BINDING_FIELDS.map((field) => [field, live[field]]));
  const census = censusPath({ env: { AGENT_ORCHESTRATION_STATE_HOME: join(root, "state") }, key: repoKey((await canonicalRepoId(consumer)).id) });
  await mkdir(dirname(census), { recursive: true });
  await writeFile(census, JSON.stringify({ at: new Date().toISOString(), agents: [{ agentId: agent.id, binding }] }));
  const outFile = join(root, "handoff-from-pane.json");
  const script = join(root, "handoff-from-pane.sh");
  const q = (value) => `'${String(value).replaceAll("'", "'\\''")}'`;
  await writeFile(script, `export AGENT_ORCHESTRATION_STATE_HOME=${q(join(root, "state"))} AO_TRANSPORT=file AGENT_ORCHESTRATION_SERVICES=0\n`
    + `${q(process.execPath)} ${q(cli)} session handoff ${q(agent.id)} --file ${q(record.handoff.path)} --consumer ${q(consumer)} --json > ${q(`${outFile}.tmp`)} 2>&1; mv ${q(`${outFile}.tmp`)} ${q(outFile)}\n`);
  await iso.within(() => tmux.sendText(pane.paneId, `!run ${script}`));
  await until(async () => (await readFile(outFile, "utf8").catch(() => null)) !== null, 60_000, "the in-pane handoff");
  const output = await readFile(outFile, "utf8");
  const passed = JSON.parse(output.slice(output.indexOf("{")));
  assert.equal(passed.delivered, true, output);
  assert.ok((await freshLines()).some((entry) => entry.line.includes(record.handoff.path)), "after session handoff, the new session has the pointer");

  // --no-respawn keeps the old answer for scripts.
  await assert.rejects(launch("run-three", "--no-respawn"), (error) => /TOPOLOGY_AGENT_ALREADY_LIVE/.test(`${error.stdout}${error.stderr}`));
});

test("TM-484: a multi-agent launch refused for one agent ends no other agent's session", { skip: haveTmux ? false : "no tmux" }, async (t) => {
  const root = await scratch(t);
  const consumer = join(root, "app");
  await mkdir(consumer);
  await exec("git", ["-C", consumer, "init", "-q"]);
  await optOutOfEnrollment(consumer);
  const log = join(root, "agent.log");
  const iso = isolatedTmux(t, { extraEnv: { AO_TMUX_COMMAND: "tmux", AO_TRANSPORT: "file", AGENT_ORCHESTRATION_SERVICES: "0", AGENT_ORCHESTRATION_STATE_HOME: join(root, "state"),
    XDG_CONFIG_HOME: join(root, ".cfg"), AO_NODE_NAME: "agents1", FAKE_TURN_LOG: log, FAKE_TURN_HANDOFF: "1" } });
  assert.equal(iso.env.TMUX, "", "never inherit an operator tmux server");
  const cli = join(HERE, "../../topology/cli.mjs");
  const ao = async (...args) => {
    const done = await exec(process.execPath, [cli, ...args, "--consumer", consumer, "--json"], { env: iso.env, timeout: 180_000 }).catch((error) => {
      error.message = `${args.slice(0, 2).join(" ")} failed: ${error.stdout}${error.stderr}`;
      throw error;
    });
    return JSON.parse(done.stdout);
  };
  // The idle agent is the one claimed FIRST, so a launch that committed claims one at a time would have
  // ended its session before reaching the busy one.
  const [idle, busy] = [(await ao("agent", "new", "--role", "worker", "--cli", "fake-agent")).id, (await ao("agent", "new", "--role", "worker", "--cli", "fake-agent")).id].sort();
  const idleHolder = await holder(iso, "idle-holder", { agentId: idle, id: ulid(), log, cwd: root });
  await holder(iso, "busy-holder", { agentId: busy, id: ulid(), log, cwd: root, env: { FAKE_TURN_START_BUSY_MS: "600000" } });
  const specPath = join(root, "pair.json");
  await writeFile(specPath, JSON.stringify({ version: 1, name: "pair", agents: [
    { agent: idle, role: "orchestrator", cli: "fake-agent", args: [AGENT] }, { agent: busy, role: "worker", cli: "fake-agent", args: [AGENT] }] }));

  await assert.rejects(ao("launch", "--spec", specPath, "--providers-dir", join(HERE, "../fixtures"), "--run-id", "pair-one", "--turn-timeout", "2s", "--handoff-timeout", "2s"),
    (error) => /TOPOLOGY_AGENT_BUSY/.test(error.message));
  assert.equal(await iso.within(() => tmux.hasSession("idle-holder")), true, "the idle agent's session was not ended");
  assert.equal(await iso.within(() => tmux.hasSession("busy-holder")), true, "the busy agent's session was not ended");
  assert.deepEqual((await events(log)).filter((entry) => entry.pid === idleHolder.pid && entry.event === "received"), [], "no handoff request reached the idle agent");
});
