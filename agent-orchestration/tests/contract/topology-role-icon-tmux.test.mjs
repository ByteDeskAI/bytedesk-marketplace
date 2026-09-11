// TM-168 on a real tmux server: role display options on every managed pane, the session title bar
// they render (including the bytes an attached terminal receives), what stays byte-identical, and
// what a hostile role or name cannot do. Fake providers only. Isolation per
// .claude/rules/tmux-test-isolation.md: TMUX '', a per-test TMUX_TMPDIR, a socket-scoped kill.
import assert from "node:assert/strict";
import { execFile as execFileCallback, spawn } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { promisify } from "node:util";

import { NESTED_TEAM_ICON, ROLE_ICON_MAP, UNKNOWN_ROLE_ICON } from "../../topology/lib/identity.mjs";
import { sleep, writeJson } from "../../topology/lib/util.mjs";

const execFile = promisify(execFileCallback);
const root = process.cwd();
const cli = join(root, "topology", "cli.mjs");
const fixtures = join(root, "tests", "fixtures");
const fakeAgent = join(fixtures, "fake-agent.mjs");
const ESC = String.fromCharCode(27);
const BEL = String.fromCharCode(7);
const HASH = "＃";
const SEMI = "；";
const HOSTILE_ROLE = `evil${ESC}]2;pwn${BEL}#[fg=red]#{pane_title};`;
const HOSTILE_NAME = `Mal${ESC}]0;owned${BEL} #{session_name}`;

const tmuxAvailable = await execFile("tmux", ["-V"]).then(() => true, () => false);
const scriptAvailable = await execFile("script", ["-V"]).then(() => true, () => false);

async function ao(args, env) {
  return (await execFile(process.execPath, [cli, ...args], { env: { ...process.env, ...env }, encoding: "utf8", timeout: 120_000 })).stdout;
}

/** `launch` and `session open` self-start a supervisor; it must stop before its directory is removed. */
async function supervisorsFor(consumer) {
  const { stdout } = await execFile("pgrep", ["-f", `supervise --consumer ${consumer}( |$)`]).catch((error) => ({ stdout: error.stdout ?? "" }));
  return stdout.split("\n").filter(Boolean).map(Number);
}

async function stopSupervisors(consumer) {
  for (const pid of await supervisorsFor(consumer)) { try { process.kill(pid, "SIGTERM"); } catch {} }
  for (let i = 0; i < 50 && (await supervisorsFor(consumer)).length; i += 1) await sleep(100);
  for (const pid of await supervisorsFor(consumer)) { try { process.kill(pid, "SIGKILL"); } catch {} }
}

/** Kill only this test's server, by socket, after proving the socket is under this test's TMUX_TMPDIR. */
async function killIsolatedServer(env, socket) {
  assert.ok(env.TMUX === "" && socket.startsWith(`${env.TMUX_TMPDIR}/`), `refusing to kill a tmux server outside this test's TMUX_TMPDIR: ${socket}`);
  await execFile("tmux", ["-S", socket, "kill-server"], { env: { ...process.env, ...env } }).catch(() => {});
}

/** Attach a real client in a pty for a moment and return everything tmux wrote to that terminal. */
async function attachedTerminalBytes(env, socket, session, pane, file) {
  const tm = { env: { ...process.env, ...env } };
  await execFile("tmux", ["-S", socket, "select-pane", "-t", pane], tm);
  const child = spawn("script", ["-q", "-c", `tmux -S ${socket} attach -t ${session}`, file], { env: { ...process.env, ...env, TERM: "xterm-256color", SHELL: "/bin/sh" }, stdio: "ignore" });
  const exited = new Promise((resolve) => child.once("exit", resolve));
  await sleep(1500);
  await execFile("tmux", ["-S", socket, "detach-client", "-s", session], tm).catch(() => {});
  await Promise.race([exited, sleep(3000)]);
  child.kill("SIGKILL");
  return readFile(file, "utf8").catch(() => "");
}

test("role icons reach managed panes and title bars; ids, names and pane titles stay unchanged; hostile text is inert", { skip: tmuxAvailable ? false : "tmux not installed" }, async (t) => {
  // Short on purpose: tmux's socket path must fit in ~104 bytes.
  const consumer = await mkdtemp("/tmp/ao-ri-");
  const env = {
    TMUX: "", AO_TMUX_COMMAND: "tmux", TMUX_TMPDIR: consumer, HOME: consumer, XDG_CONFIG_HOME: join(consumer, "config"),
    AO_CONSUMER: consumer, AGENT_ORCHESTRATION_STATE_HOME: join(consumer, "state"), AO_RING_WINDOW_MS: "20000", AO_BELL_POLL_MS: "500",
  };
  // Every tmux call here names this test's own server (TM-167 makes an unscoped listing an error).
  const socket = join(consumer, `tmux-${process.getuid()}`, "default");
  // One hook: reap the supervisor, then the server, then the directory they write into.
  t.after(async () => {
    await stopSupervisors(consumer);
    await killIsolatedServer(env, socket);
    await rm(consumer, { recursive: true, force: true });
  });
  const tm = async (...args) => (await execFile("tmux", ["-S", socket, ...args], { env: { ...process.env, ...env } })).stdout.replace(/\n$/, "");
  // Enrolled, so TM-167's gate lets launch and session open start a supervisor; ignored before that merge.
  await mkdir(join(consumer, ".bytedesk", "agent-orchestration"), { recursive: true });
  await writeJson(join(consumer, ".bytedesk", "agent-orchestration", "config.json"), { enabled: true });

  const lead = JSON.parse(await ao(["agent", "new", "--role", "lead", "--cli", "fake-agent", "--name", "Ada Vale", "--consumer", consumer], env));
  const evil = JSON.parse(await ao(["agent", "new", "--role", HOSTILE_ROLE, "--cli", "fake-agent", "--name", HOSTILE_NAME, "--consumer", consumer], env));
  // The standing session needs the fixture script as its argument; written before the byte snapshot.
  const leadFile = join(lead.dir, "agent.json");
  await writeJson(leadFile, { ...JSON.parse(await readFile(leadFile, "utf8")), args: [fakeAgent] });
  const agentBytes = () => Promise.all([leadFile, join(evil.dir, "agent.json")].map((file) => readFile(file)));
  const before = await agentBytes();

  // ---- a run: two ordinary agents, a library agent with a hostile role and name, and a nested team.
  const runId = `ri-${process.pid}`;
  const specPath = join(consumer, "spec.json");
  await writeJson(specPath, {
    version: 1, name: "icons", session: "ao-icons-{{run_id}}", layout: "grid",
    agents: [
      { id: "conductor", role: "orchestrator", cli: "fake-agent", model: "c1", args: [fakeAgent] },
      { id: "worker-a", role: "worker", cli: "fake-agent", model: "w1", args: [fakeAgent] },
      { id: "evil", agent: evil.id, cli: "fake-agent", model: "e1", args: [fakeAgent] },
      { id: "team", workflow: "no-such-team-tm168" },
    ],
    workflow: [{ stage: "ping", from: "conductor", to: ["worker-a"] }],
  });
  const launched = JSON.parse(await ao(["launch", "--spec", specPath, "--consumer", consumer, "--providers-dir", fixtures, "--run-id", runId, "--json"], env));
  const icon = { conductor: ROLE_ICON_MAP.orchestrator, "worker-a": ROLE_ICON_MAP.worker, evil: UNKNOWN_ROLE_ICON };
  assert.deepEqual(Object.fromEntries(launched.agents.map((agent) => [agent.id, agent.roleIcon])), icon, JSON.stringify(launched, null, 2));
  assert.deepEqual(launched.participants.map((p) => [p.id, p.roleIcon, p.roleLabel]), [["team", NESTED_TEAM_ICON, "Nested team"]]);
  const run = JSON.parse(await readFile(join(launched.runDir, "run.json"), "utf8"));
  assert.equal(run.agents[0].binding?.serverKey, socket, "the run was recorded on a different tmux server than the one this test reads");
  assert.deepEqual(run.agents.map((agent) => [agent.id, agent.roleIcon, agent.roleLabel]), [
    ["conductor", ROLE_ICON_MAP.orchestrator, "Orchestrator"],
    ["worker-a", ROLE_ICON_MAP.worker, "Worker"],
    ["evil", UNKNOWN_ROLE_ICON, "Agent"],
    ["team", NESTED_TEAM_ICON, "Nested team"],
  ]);
  const status = JSON.parse(await ao(["status", "--run", launched.runDir, "--json"], env));
  assert.deepEqual(status.agents.map((agent) => [agent.id, agent.roleIcon]), run.agents.map((agent) => [agent.id, agent.roleIcon]), "status and run.json disagree");

  const paneOf = (id) => launched.agents.find((agent) => agent.id === id).pane;
  for (const id of Object.keys(icon)) assert.equal(await tm("display", "-p", "-t", paneOf(id), "#{@ao_role_icon}"), icon[id], `${id} pane icon`);
  assert.equal(await tm("display", "-p", "-t", paneOf("conductor"), "#{@ao_agent}|#{@ao_role}|#{@ao_role_label}"), "conductor|orchestrator|Orchestrator");

  // The session title bar: session-scoped, rendered from the active pane.
  assert.equal(await tm("show-options", "-v", "-t", launched.session, "set-titles"), "on");
  assert.equal(await tm("show-options", "-gv", "set-titles"), "off", "set-titles must never be set globally");
  const titleFormat = await tm("show-options", "-v", "-t", launched.session, "set-titles-string");
  assert.equal(await tm("display", "-p", "-t", paneOf("conductor"), titleFormat), `${ROLE_ICON_MAP.orchestrator} conductor · Orchestrator`);
  assert.equal(await tm("display", "-p", "-t", paneOf("worker-a"), titleFormat), `${ROLE_ICON_MAP.worker} worker-a · Worker`);

  // Unchanged by TM-168: the session name from the spec, the grid's one window, and the provider-owned
  // pane title the launcher prints (`id · role · provider`).
  assert.equal(launched.session, `ao-icons-${runId}`);
  const listing = new Map((await tm("list-panes", "-s", "-t", `=${launched.session}`, "-F", "#{pane_id}\t#{window_name}\t#{pane_title}"))
    .split("\n").map((line) => { const [pane, window, title] = line.split("\t"); return [pane, { window, title }]; }));
  assert.deepEqual(listing.get(paneOf("conductor")), { window: "main", title: "conductor · orchestrator · fake-agent:c1" });
  assert.deepEqual(listing.get(paneOf("worker-a")), { window: "main", title: "worker-a · worker · fake-agent:w1" });

  // Hostile role and name: no escape, no format, no batch split — in the options and in the title.
  const evilPane = paneOf("evil");
  const evilName = `Mal]0;owned ${HASH}{session_name}, Engineer`;
  assert.equal(
    await tm("display", "-p", "-t", evilPane, "#{@ao_agent}\t#{@ao_role}\t#{@ao_role_label}\t#{@ao_role_icon}"),
    [evilName, `evil]2;pwn${HASH}[fg=red]${HASH}{pane_title}${SEMI}`, "Agent", UNKNOWN_ROLE_ICON].join("\t"),
  );
  assert.equal(await tm("display", "-p", "-t", evilPane, titleFormat), `${UNKNOWN_ROLE_ICON} ${evilName} · Agent`);
  assert.ok(!listing.get(evilPane).title.includes(ESC), "the launcher printed an escape into the pane title");

  // What an attached xterm actually receives: one OSC 0 title, and nothing the hostile name smuggled in.
  if (scriptAvailable) {
    const conductorBytes = await attachedTerminalBytes(env, socket, launched.session, paneOf("conductor"), join(consumer, "attach-conductor.bin"));
    assert.ok(conductorBytes.includes(`${ESC}]0;${ROLE_ICON_MAP.orchestrator} conductor · Orchestrator${BEL}`), JSON.stringify(conductorBytes.slice(0, 400)));
    const evilBytes = await attachedTerminalBytes(env, socket, launched.session, evilPane, join(consumer, "attach-evil.bin"));
    assert.ok(evilBytes.includes(`${ESC}]0;${UNKNOWN_ROLE_ICON} ${evilName} · Agent${BEL}`), JSON.stringify(evilBytes.slice(0, 400)));
    assert.ok(!evilBytes.includes(`${ESC}]0;owned`) && !evilBytes.includes(`${ESC}]2;pwn`), "a hostile name reached the terminal as an escape sequence");
  } else {
    t.diagnostic("script(1) not found; the attached-terminal byte check was skipped");
  }

  // ---- the human launch rows.
  const humanSpec = join(consumer, "human.json");
  await writeJson(humanSpec, {
    version: 1, name: "icons-human", session: "ao-icons-human-{{run_id}}", layout: "grid",
    agents: [
      { id: "conductor", role: "orchestrator", cli: "fake-agent", model: "c1", args: [fakeAgent] },
      { id: "worker-a", role: "worker", cli: "fake-agent", model: "w1", args: [fakeAgent] },
    ],
    workflow: [{ stage: "ping", from: "conductor", to: ["worker-a"] }],
  });
  const human = await ao(["launch", "--spec", humanSpec, "--consumer", consumer, "--providers-dir", fixtures, "--run-id", `${runId}-h`], env);
  assert.match(human, new RegExp(`^  [✓?] ${ROLE_ICON_MAP.orchestrator} conductor \\(orchestrator\\) on fake-agent:c1 pane %\\d+$`, "m"), human);
  assert.match(human, new RegExp(`^  [✓?] ${ROLE_ICON_MAP.worker} worker-a \\(worker\\) on fake-agent:w1 pane %\\d+$`, "m"), human);

  // ---- a durable role session.
  const opened = JSON.parse(await ao(["session", "open", lead.id, "--consumer", consumer, "--providers-dir", fixtures, "--json"], env));
  assert.deepEqual([opened.roleIcon, opened.roleLabel, opened.session], [ROLE_ICON_MAP.lead, "Lead", `ao-${lead.id}`]);
  assert.equal(await tm("display", "-p", "-t", opened.pane, "#{@ao_role_icon}"), ROLE_ICON_MAP.lead);
  assert.equal(await tm("show-options", "-v", "-t", opened.session, "set-titles"), "on");
  const leadTitle = await tm("show-options", "-v", "-t", opened.session, "set-titles-string");
  assert.equal(await tm("display", "-p", "-t", opened.pane, leadTitle), `${ROLE_ICON_MAP.lead} Ada Vale, Engineering Lead · Lead`);
  assert.equal(await tm("display", "-p", "-t", opened.pane, "#{session_name}\t#{window_name}\t#{pane_title}"), `ao-${lead.id}\t${lead.id}\t${lead.id} · lead · fake-agent`);

  assert.deepEqual(await agentBytes(), before, "agent.json was rewritten");
});
