// TM-168 terminal and CLI surfaces: every projection carries a computed role icon, human rows show it
// before the readable name, tmux display values are sanitised, and nothing rewrites agent.json.
// No tmux server is started here: CLI runs use a fake `tmux` on AO_TMUX_COMMAND. The real-server
// behaviour is tests/contract/topology-role-icon-tmux.test.mjs.
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { chmod, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { promisify } from "node:util";

import { NESTED_TEAM_ICON, ROLE_ICON_MAP, UNKNOWN_ROLE_ICON } from "../../topology/lib/identity.mjs";
import { launchRun, launcherScript, registeredLeadId, runAgentVisual, runPaneDisplay } from "../../topology/lib/launch.mjs";
import { leadRegistryDir } from "../../topology/lib/lead.mjs";
import { canonicalRepoId, repoKey } from "../../topology/lib/repoid.mjs";
import { loadAdapters } from "../../topology/lib/providers.mjs";
import { materializeSpec, validateSpec } from "../../topology/lib/spec.mjs";
import { ROLE_TITLE_FORMAT, roleDisplayArgs, sessionTitleArgs, tmuxText } from "../../topology/lib/tmux.mjs";
import { shellQuote, terminalText, writeJson } from "../../topology/lib/util.mjs";

const exec = promisify(execFile);
const root = process.cwd();
const cli = join(root, "topology", "cli.mjs");
const fixtures = join(root, "tests", "fixtures");
const ESC = String.fromCharCode(27);
const BEL = String.fromCharCode(7);
const C1_CSI = String.fromCharCode(0x9b);
const DEL = String.fromCharCode(0x7f);
const FULLWIDTH_HASH = "＃";
const FULLWIDTH_SEMICOLON = "；";
const CONTROL = /[\u0000-\u001f\u007f-\u009f]/;
const HOSTILE_ROLE = `evil${ESC}]2;pwn${BEL}#[fg=red]#{pane_title};`;
const HOSTILE_NAME = `Mal${ESC}[31m${C1_CSI}Icious${DEL} #{pane_title} ${"x".repeat(300)}`;

test("hostile text loses control and tmux format characters; ordinary text is untouched", () => {
  // The fixtures really are hostile, or every assertion below would pass vacuously.
  assert.ok(CONTROL.test(HOSTILE_ROLE) && CONTROL.test(HOSTILE_NAME) && HOSTILE_ROLE.includes("#{"));

  assert.equal(terminalText(HOSTILE_ROLE), "evil]2;pwn#[fg=red]#{pane_title};");
  assert.equal(tmuxText(HOSTILE_ROLE), `evil]2;pwn${FULLWIDTH_HASH}[fg=red]${FULLWIDTH_HASH}{pane_title}${FULLWIDTH_SEMICOLON}`);
  const name = tmuxText(HOSTILE_NAME);
  assert.equal(Array.from(name).length, 80, "a tmux value is capped");
  assert.ok(!CONTROL.test(name) && !name.includes("#"), JSON.stringify(name));

  for (const ordinary of ["Ada Vale, Engineering Lead", "conductor", "Image generation", "impl · worker · claude:opus", ...Object.values(ROLE_ICON_MAP), NESTED_TEAM_ICON, UNKNOWN_ROLE_ICON]) {
    assert.equal(terminalText(ordinary), ordinary);
    assert.equal(tmuxText(ordinary), ordinary);
  }
  // The cap counts code points, so it never cuts an emoji in half.
  assert.equal(tmuxText(`${"a".repeat(79)}${ROLE_ICON_MAP.lead}`), `${"a".repeat(79)}${ROLE_ICON_MAP.lead}`);
  assert.equal(tmuxText(`${"a".repeat(80)}${ROLE_ICON_MAP.lead}`), "a".repeat(80));
});

test("pane display options are four pane-scoped set-options whose values cannot split the batch", () => {
  const args = roleDisplayArgs("%9", { agent: HOSTILE_NAME, role: HOSTILE_ROLE, roleLabel: "Agent", roleIcon: UNKNOWN_ROLE_ICON });
  const commands = [];
  for (const arg of args) {
    if (arg === ";") commands.push([]);
    else commands.at(-1).push(arg);
  }
  assert.deepEqual(
    commands.map((command) => command.slice(0, 5)),
    ["@ao_agent", "@ao_role", "@ao_role_label", "@ao_role_icon"].map((name) => ["set-option", "-p", "-t", "%9", name]),
  );
  for (const [, , , , name, value, ...rest] of commands) {
    assert.deepEqual(rest, [], `${name} must be one argv element`);
    assert.ok(!CONTROL.test(value) && !value.includes("#") && !value.endsWith(";"), `${name}=${JSON.stringify(value)}`);
  }
  assert.equal(commands[3][5], UNKNOWN_ROLE_ICON);

  // Session-scoped, never -g: the server is shared with every other session on the machine.
  assert.deepEqual(sessionTitleArgs("s1"), [";", "set-option", "-t", "s1", "set-titles", "on", ";", "set-option", "-t", "s1", "set-titles-string", ROLE_TITLE_FORMAT]);
  assert.ok(ROLE_TITLE_FORMAT.includes("#{@ao_role_icon} #{@ao_agent} · #{@ao_role_label}"), ROLE_TITLE_FORMAT);
});

test("the launcher's OSC 2 title keeps its text for an ordinary role and cannot carry an escape for a hostile one", () => {
  const titleLine = (role) =>
    launcherScript({ agent: { id: "impl", role, cwd: "/repo" }, candidate: { cli: "fake-agent", model: "w1" }, argv: ["node"], env: {} })
      .split("\n")
      .find((line) => line.startsWith("printf "));
  // The line exactly as it was before TM-168.
  assert.equal(titleLine("worker"), "printf '\\033]2;%s\\007' 'impl · worker · fake-agent:w1'");
  const hostile = titleLine(HOSTILE_ROLE);
  assert.ok(!CONTROL.test(hostile), JSON.stringify(hostile));
  assert.equal(hostile, `printf '\\033]2;%s\\007' ${shellQuote("impl · evil]2;pwn#[fg=red]#{pane_title}; · fake-agent:w1")}`);
});

test("run agents: declared role, custom role and nested team each get a computed icon, at launch and on read", async (t) => {
  const consumer = await mkdtemp(join(tmpdir(), "ao-role-icon-run-"));
  t.after(() => rm(consumer, { recursive: true, force: true }));
  const spec = materializeSpec(
    validateSpec({
      name: "icons",
      agents: [
        { id: "conductor", role: "orchestrator", cli: "fake-agent", args: ["x"] },
        { id: "auditor", role: "security-auditor", cli: "fake-agent", args: ["x"] },
        { id: "reviewers", workflow: "review-team" },
      ],
      workflow: [{ stage: "ping", from: "conductor", to: ["auditor", "reviewers"] }],
    }),
    { runId: "r1", consumer, home: consumer, inputs: {} },
  );
  const dry = await launchRun({ spec, adapters: await loadAdapters([fixtures]), skillSearchDirs: [], roleSearchDirs: [], cliBin: "ao", dryRun: true });
  assert.deepEqual(
    dry.agents.map((agent) => [agent.id, agent.role, agent.roleIcon, agent.roleLabel]),
    [
      ["conductor", "orchestrator", ROLE_ICON_MAP.orchestrator, "Orchestrator"],
      ["auditor", "security-auditor", UNKNOWN_ROLE_ICON, "Agent"],
      ["reviewers", "worker", NESTED_TEAM_ICON, "Nested team"],
    ],
  );

  // A run.json entry written before TM-168 has no icon; one an agent tampered with has a hostile one.
  // Both are recomputed from the role, never echoed.
  assert.deepEqual(runAgentVisual({ id: "old", role: "worker" }), { roleIcon: ROLE_ICON_MAP.worker, roleLabel: "Worker" });
  assert.deepEqual(runAgentVisual({ role: "worker", roleIcon: `${ESC}]2;pwn${BEL}`, roleLabel: "Lead" }), { roleIcon: ROLE_ICON_MAP.worker, roleLabel: "Worker" });
  assert.deepEqual(runAgentVisual({ role: "worker", workflow: { name: "team" } }), { roleIcon: NESTED_TEAM_ICON, roleLabel: "Nested team" });
});

/** An isolated consumer, and a CLI whose tmux is a script that only ever answers `list-sessions`. */
async function consumerFixture(t) {
  const home = await mkdtemp(join(tmpdir(), "ao-role-icon-cli-"));
  const consumer = join(home, "repo");
  await mkdir(consumer, { recursive: true });
  const fakeTmux = join(home, "fake-tmux.sh");
  const env = {
    ...process.env, HOME: home, XDG_CONFIG_HOME: join(home, "config"), TMUX: "", TMUX_TMPDIR: home,
    AO_TMUX_COMMAND: fakeTmux, AGENT_ORCHESTRATION_STATE_HOME: join(home, "state"),
  };
  t.after(() => rm(home, { recursive: true, force: true }));
  const sessions = async (names) => {
    await writeFile(fakeTmux, `#!/bin/sh\ncase "$*" in\n  *list-sessions*) printf '%s\\n' ${names.map(shellQuote).join(" ")} ;;\n  *) exit 1 ;;\nesac\n`);
    await chmod(fakeTmux, 0o755);
  };
  await sessions([]);
  const ao = async (...args) => (await exec(process.execPath, [cli, ...args, "--consumer", consumer], { env })).stdout;
  return { home, consumer, ao, sessions };
}

async function agentFiles(consumer) {
  const dir = join(consumer, ".bytedesk", "agent-orchestration", "agents");
  const files = new Map();
  for (const id of await readdir(dir)) {
    const bytes = await readFile(join(dir, id, "agent.json")).catch(() => null);
    if (bytes) files.set(id, bytes);
  }
  return files;
}

test("agent and session lists: icon before the readable name, additive JSON, ids unchanged, agent.json never rewritten", async (t) => {
  const { consumer, ao, sessions } = await consumerFixture(t);
  const lead = JSON.parse(await ao("agent", "new", "--role", "lead", "--name", "Ada Vale"));
  const designer = JSON.parse(await ao("agent", "new", "--role", "designer", "--name", "Dara Duvall"));
  const evil = JSON.parse(await ao("agent", "new", "--role", HOSTILE_ROLE, "--name", `Mal${ESC}[31m Icious #{pane_title}`));
  assert.deepEqual([lead.roleIcon, lead.roleLabel, lead.role], [ROLE_ICON_MAP.lead, "Lead", "lead"]);
  assert.deepEqual([evil.roleIcon, evil.roleLabel, evil.role], [UNKNOWN_ROLE_ICON, "Agent", HOSTILE_ROLE]);
  const before = await agentFiles(consumer);
  assert.equal(before.size, 3, "the byte comparison at the end must cover every agent");

  const listed = JSON.parse(await ao("agent", "list", "--json"));
  const row = (id) => listed.agents.find((agent) => agent.id === id);
  assert.deepEqual(row(lead.id), { id: lead.id, name: "Ada Vale, Engineering Lead", role: "lead", roleIcon: ROLE_ICON_MAP.lead, roleLabel: "Lead", reports_to: null });
  assert.deepEqual([row(designer.id).roleIcon, row(designer.id).roleLabel], [ROLE_ICON_MAP.designer, "Designer"]);
  assert.deepEqual([row(evil.id).roleIcon, row(evil.id).roleLabel, row(evil.id).role], [UNKNOWN_ROLE_ICON, "Agent", HOSTILE_ROLE]);

  const agentLines = (await ao("agent", "list")).split("\n");
  for (const expected of [
    `* ${ROLE_ICON_MAP.lead} Ada Vale, Engineering Lead  [${lead.id}]`,
    `  ${ROLE_ICON_MAP.designer} Dara Duvall, Design Engineer  [${designer.id}]`,
    `  ${UNKNOWN_ROLE_ICON} Mal[31m Icious #{pane_title}, Engineer  [${evil.id}]`,
  ]) assert.ok(agentLines.includes(expected), `missing ${JSON.stringify(expected)} in\n${agentLines.join("\n")}`);
  assert.ok(agentLines.every((line) => !CONTROL.test(line)), "agent list printed a control character");

  const shown = JSON.parse(await ao("agent", "show", designer.id));
  assert.deepEqual([shown.id, shown.role, shown.roleIcon, shown.roleLabel], [designer.id, "designer", ROLE_ICON_MAP.designer, "Designer"]);

  await sessions([`ao-${lead.id}`, `${lead.id}-1234567`, "ghost01-abcdef0"]);
  const listedSessions = JSON.parse(await ao("session", "list", "--json"));
  const leadRow = listedSessions.sessions.find((entry) => entry.id === lead.id);
  assert.deepEqual([leadRow.roleIcon, leadRow.roleLabel, leadRow.session, leadRow.live], [ROLE_ICON_MAP.lead, "Lead", `ao-${lead.id}`, true]);
  assert.deepEqual(leadRow.spawns, [{ session: `${lead.id}-1234567`, spawn: "1234567" }]);
  assert.deepEqual(listedSessions.unknown_agent_spawns, [{ session: "ghost01-abcdef0", spawn: "abcdef0", agent_id: "ghost01", roleIcon: UNKNOWN_ROLE_ICON, roleLabel: "Agent" }]);

  const sessionLines = (await ao("session", "list")).split("\n");
  for (const expected of [
    `* ${ROLE_ICON_MAP.lead} Ada Vale, Engineering Lead  ao-${lead.id}  [${lead.id}]`,
    `    spawn 1234567  ${lead.id}-1234567`,
    `  ${ROLE_ICON_MAP.designer} Dara Duvall, Design Engineer  (no role-session)  [${designer.id}]`,
    `  ? ${UNKNOWN_ROLE_ICON} ghost01-abcdef0  (spawn of ghost01, not in this roster)`,
  ]) assert.ok(sessionLines.includes(expected), `missing ${JSON.stringify(expected)} in\n${sessionLines.join("\n")}`);
  assert.ok(sessionLines.every((line) => !CONTROL.test(line)), "session list printed a control character");

  const roles = JSON.parse(await ao("role", "list"));
  const designers = roles.roles.find((entry) => entry.role === "designer").holders;
  assert.deepEqual(designers.map((holder) => [holder.id, holder.roleIcon, holder.roleLabel]), [[designer.id, ROLE_ICON_MAP.designer, "Designer"]]);

  assert.deepEqual(await agentFiles(consumer), before, "a read-only surface rewrote agent.json");
});

test("status computes icons for a run.json written before TM-168, uses the team icon, and never echoes a stored icon", async (t) => {
  const { home, ao } = await consumerFixture(t);
  const runDir = join(home, "run");
  const childDir = join(home, "child");
  await mkdir(runDir, { recursive: true });
  await mkdir(childDir, { recursive: true });
  await writeJson(join(childDir, "run.json"), { version: 1, name: "review-team", run_id: "child", session: "ao-child-gone", state: "running", agents: [{ id: "lead", role: "orchestrator" }] });
  await writeJson(join(runDir, "run.json"), {
    version: 1, name: "old", run_id: "r-old", session: "ao-old-gone", run_dir: runDir, state: "running", created: new Date().toISOString(), sequence: 0,
    agents: [
      { id: "conductor", role: "orchestrator", pane: null, candidates: [{ label: "fake-agent:x" }], provider: "fake-agent:x", adapter: "fake-agent" },
      { id: "auditor", role: "security-auditor", roleIcon: `${ESC}]2;pwn${BEL}`, roleLabel: "Lead", pane: null, candidates: [], provider: null },
      { id: "reviewers", role: "worker", pane: null, candidates: [], workflow: { name: "review-team", inputs: {}, run_dir: childDir, session: "ao-child-gone", conductor: "lead" } },
    ],
  });

  const status = JSON.parse(await ao("status", "--run", runDir, "--json"));
  assert.deepEqual(
    status.agents.map((agent) => [agent.id, agent.roleIcon, agent.roleLabel]),
    [["conductor", ROLE_ICON_MAP.orchestrator, "Orchestrator"], ["auditor", UNKNOWN_ROLE_ICON, "Agent"], ["reviewers", NESTED_TEAM_ICON, "Nested team"]],
  );
  assert.ok(!JSON.stringify(status).includes("pwn"), "a stored roleIcon was echoed");

  const lines = (await ao("status", "--run", runDir)).split("\n");
  for (const prefix of [
    `  ○ ${ROLE_ICON_MAP.orchestrator} conductor (orchestrator) on fake-agent:x [chain: fake-agent:x]`,
    `  ○ ${UNKNOWN_ROLE_ICON} auditor (security-auditor) on NO PROVIDER`,
    `  ○ ${NESTED_TEAM_ICON} reviewers (worker) is a TEAM running \`review-team\``,
  ]) assert.ok(lines.some((line) => line.startsWith(prefix)), `no line starts ${JSON.stringify(prefix)}:\n${lines.join("\n")}`);
  assert.ok(lines.every((line) => !CONTROL.test(line) && !line.includes("pwn")), lines.join("\n"));
});

/**
 * Lines that DECIDE something from a role icon or label: a comparison, a switch, or reading the tmux
 * option back. Rendering an icon is fine; branching on one is the authority leak criterion 6 forbids.
 */
function authorityReads(source) {
  const decides = /(roleIcon|roleLabel|@ao_role)[^\n]*(===|!==|==|!=)|(===|!==|==|!=)[^\n]*(roleIcon|roleLabel|@ao_role)|switch\s*\([^)]*(roleIcon|roleLabel)|show-options[^\n]*@ao_/;
  return source.split("\n").filter((line) => decides.test(line));
}

test("no topology code reads a role icon, label or @ao_ option back to decide anything", async () => {
  // The scan can find what it looks for: without this, an empty result proves nothing.
  assert.equal(authorityReads('if (agent.roleIcon === "x") grant();\nconst v = await tmux(["show-options", "-v", "@ao_role_icon"]);').length, 2);
  const files = [join(root, "topology", "cli.mjs")];
  for (const name of await readdir(join(root, "topology", "lib"))) if (name.endsWith(".mjs")) files.push(join(root, "topology", "lib", name));
  assert.ok(files.length > 20, `scanned only ${files.length} files`);
  const found = [];
  for (const file of files) for (const line of authorityReads(await readFile(file, "utf8"))) found.push(`${file}: ${line.trim()}`);
  assert.deepEqual(found, []);
});

/** Register `agentId` as the repository lead exactly where readLeadRegistration looks for it. */
async function registerLead(consumer, agentId, env) {
  const key = repoKey((await canonicalRepoId(consumer)).id);
  await writeJson(join(leadRegistryDir(env), `${key}.json`), { agent_id: agentId, consumer });
  return join(leadRegistryDir(env), `${key}.json`);
}

test("TM-185: a registered lead coordinating a run shows the lead icon at launch and on its pane; any other orchestrator keeps its own", async (t) => {
  const consumer = await mkdtemp(join(tmpdir(), "ao-role-icon-lead-"));
  // launchRun resolves the registration from process.env; keep it out of the operator's real state.
  const saved = process.env.AGENT_ORCHESTRATION_STATE_HOME;
  process.env.AGENT_ORCHESTRATION_STATE_HOME = join(consumer, "state");
  t.after(async () => {
    if (saved === undefined) delete process.env.AGENT_ORCHESTRATION_STATE_HOME;
    else process.env.AGENT_ORCHESTRATION_STATE_HOME = saved;
    await rm(consumer, { recursive: true, force: true });
  });
  const leadId = "ada00001";
  await writeJson(join(consumer, ".bytedesk", "agent-orchestration", "agents", leadId, "agent.json"), {
    id: leadId, role: "lead", first_name: "Ada", last_name: "Vale", full_name: "Ada Vale", title: "Engineering Lead",
  });
  const worker = { id: "worker-a", role: "worker", cli: "fake-agent", args: ["x"] };
  const asLead = [{ id: "conductor", agent: leadId, role: "orchestrator", cli: "fake-agent", args: ["x"] }, worker];
  const plain = [{ id: "conductor", role: "orchestrator", cli: "fake-agent", args: ["x"] }, worker];
  const specOf = (agents) => materializeSpec(
    validateSpec({ name: "led", agents, workflow: [{ stage: "ping", from: "conductor", to: ["worker-a"] }] }),
    { runId: "r1", consumer, home: consumer, inputs: {} },
  );
  const adapters = await loadAdapters([fixtures]);
  const dry = (agents) => launchRun({ spec: specOf(agents), adapters, skillSearchDirs: [], roleSearchDirs: [], cliBin: "ao", dryRun: true });

  assert.equal(await registeredLeadId({ consumer }), null, "no registration yet");
  const unregistered = await dry(asLead);
  assert.equal(unregistered.agents[0].roleIcon, ROLE_ICON_MAP.orchestrator, "without a registration the declared role stands");

  await registerLead(consumer, leadId, process.env);
  const found = await registeredLeadId({ consumer });
  assert.equal(found, leadId);
  assert.deepEqual((await dry(asLead)).agents.map((a) => [a.id, a.role, a.roleIcon, a.roleLabel]), [
    ["conductor", "orchestrator", ROLE_ICON_MAP.lead, "Lead"],
    ["worker-a", "worker", ROLE_ICON_MAP.worker, "Worker"],
  ]);
  assert.deepEqual((await dry(plain)).agents.map((a) => [a.id, a.roleIcon]), [["conductor", ROLE_ICON_MAP.orchestrator], ["worker-a", ROLE_ICON_MAP.worker]]);

  // The pane option values preparePane receives, with the lead resolved the way launchRun resolves it.
  assert.deepEqual(runPaneDisplay(specOf(asLead).agents[0], found), { agent: "Ada Vale, Engineering Lead", role: "orchestrator", roleIcon: ROLE_ICON_MAP.lead, roleLabel: "Lead" });
  assert.deepEqual(runPaneDisplay(specOf(plain).agents[0], found), { agent: "conductor", role: "orchestrator", roleIcon: ROLE_ICON_MAP.orchestrator, roleLabel: "Orchestrator" });
  // The same for a run.json entry, which names its library agent in agent_id.
  assert.equal(runAgentVisual({ id: "conductor", agent_id: leadId, role: "orchestrator" }, found).roleIcon, ROLE_ICON_MAP.lead);

  // An unreadable registration, or no consumer at all, is "no lead" — never an error.
  const broken = await mkdtemp(join(consumer, "broken-"));
  const brokenPath = await registerLead(broken, leadId, process.env);
  await writeFile(brokenPath, "{ not json");
  assert.equal(await registeredLeadId({ consumer: broken }), null);
  assert.equal(await registeredLeadId({}), null);
});

test("TM-185: status, session list, agent list and role list show the registered lead's icon whatever its declared role", async (t) => {
  const { home, consumer, ao } = await consumerFixture(t);
  const lead = JSON.parse(await ao("agent", "new", "--role", "worker", "--name", "Wes Warden"));
  const other = JSON.parse(await ao("agent", "new", "--role", "worker", "--name", "Wren Other"));
  const runDir = join(home, "led-run");
  await writeJson(join(runDir, "run.json"), {
    version: 1, name: "led", run_id: "led", session: "ao-led-gone", consumer, run_dir: runDir, state: "running", created: new Date().toISOString(), sequence: 0,
    agents: [
      { id: "conductor", agent_id: lead.id, role: "orchestrator", pane: null, candidates: [{ label: "fake-agent:x" }], provider: "fake-agent:x" },
      { id: "backup", agent_id: "backup", role: "orchestrator", pane: null, candidates: [], provider: null },
    ],
  });
  const icons = async () => {
    const status = JSON.parse(await ao("status", "--run", runDir, "--json"));
    const sessions = JSON.parse(await ao("session", "list", "--json")).sessions;
    const agents = JSON.parse(await ao("agent", "list", "--json")).agents;
    const workers = JSON.parse(await ao("role", "list")).roles.find((entry) => entry.role === "worker").holders;
    const by = (rows, id) => rows.find((row) => row.id === id)?.roleIcon;
    return {
      conductor: by(status.agents, "conductor"), backup: by(status.agents, "backup"),
      session: [by(sessions, lead.id), by(sessions, other.id)], agent: [by(agents, lead.id), by(agents, other.id)], role: [by(workers, lead.id), by(workers, other.id)],
    };
  };
  const { orchestrator, worker, lead: crown } = ROLE_ICON_MAP;
  assert.deepEqual(await icons(), { conductor: orchestrator, backup: orchestrator, session: [worker, worker], agent: [worker, worker], role: [worker, worker] }, "before registration");

  await registerLead(consumer, lead.id, { AGENT_ORCHESTRATION_STATE_HOME: join(home, "state") });
  assert.deepEqual(await icons(), { conductor: crown, backup: orchestrator, session: [crown, worker], agent: [crown, worker], role: [crown, worker] }, "after registration");

  const statusLines = (await ao("status", "--run", runDir)).split("\n");
  for (const prefix of [`  ○ ${crown} conductor (orchestrator) on fake-agent:x`, `  ○ ${orchestrator} backup (orchestrator) on NO PROVIDER`]) {
    assert.ok(statusLines.some((line) => line.startsWith(prefix)), `no line starts ${JSON.stringify(prefix)}:\n${statusLines.join("\n")}`);
  }
  const sessionLines = (await ao("session", "list")).split("\n");
  assert.ok(sessionLines.includes(`  ${crown} Wes Warden, Engineer  (no role-session)  [${lead.id}]`), sessionLines.join("\n"));
});
