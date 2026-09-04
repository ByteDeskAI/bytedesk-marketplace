// Launch a materialized spec: write the run directory, one bootstrap file and launcher per agent,
// create the tmux session, start every CLI, and deliver each agent its bootstrap pointer.
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { appendJournal, agentDir, saveRun } from "./mailbox.mjs";
import { adapterFor, buildArgv } from "./providers.mjs";
import { loadRole, resolveSkill } from "./resolve.mjs";
import * as tmux from "./tmux.mjs";
import { exists, fail, invariant, nowIso, render, shellQuote, sleep, writeText } from "./util.mjs";

const POINTER_TEMPLATE = "[ao] Message {{id}} from {{from}} ({{stage}}): read {{inbox}} then write your complete reply to {{outbox}}";

export function messagePointer(fields) {
  return render(POINTER_TEMPLATE, fields);
}

function describeAgents(spec, selfId) {
  return spec.agents
    .map((agent) => `- \`${agent.id}\` — role ${agent.role}, CLI ${agent.cli}${agent.model ? ` (${agent.model})` : ""}${agent.id === selfId ? " ← you" : ""}`)
    .join("\n");
}

function describeWorkflow(spec) {
  if (spec.workflow.length === 0) return "_No fixed workflow; the conductor decides the stages from the mission._";
  return spec.workflow
    .map((stage, index) => {
      const parts = [`${index + 1}. **${stage.stage}**`];
      if (stage.from) parts.push(`from \`${stage.from}\``);
      if (stage.to.length) parts.push(`to ${stage.to.map((id) => `\`${id}\``).join(", ")}`);
      if (stage.wait_for.length) parts.push(`wait for ${stage.wait_for.map((id) => `\`${id}\``).join(", ")}`);
      if (stage.contract) parts.push(`contract \`${stage.contract}\``);
      if (stage.timeout) parts.push(`timeout ${stage.timeout}`);
      if (stage.loop_until) parts.push(`repeat until \`${stage.loop_until}\`${stage.max_rounds ? ` (max ${stage.max_rounds} rounds)` : ""}`);
      const line = parts.join(" · ");
      return stage.description ? `${line}\n   ${stage.description}` : line;
    })
    .join("\n");
}

function describeGates(spec) {
  if (spec.gates.length === 0) return "_No human gates declared._";
  return spec.gates.map((gate) => `- after **${gate.after}**: ${gate.human ? "stop and ask the operator" : "automatic"}${gate.description ? ` — ${gate.description}` : ""}`).join("\n");
}

function describeInputs(spec) {
  const entries = Object.entries(spec.inputs_resolved ?? {});
  if (entries.length === 0) return "_None._";
  return entries.map(([key, value]) => `- **${key}**: ${value}`).join("\n");
}

function bootstrapText({ spec, agent, role, skills, cliBin }) {
  const self = agentDir(spec.run_dir, agent.id);
  const isConductor = agent.role === "orchestrator";
  const skillLines = skills.length === 0
    ? "_No skills assigned._"
    : skills.map((skill) => (skill.path ? `- \`${skill.name}\` → read \`${skill.path}\` now` : `- \`${skill.name}\` → NOT FOUND; say so in your first reply and continue without it`)).join("\n");
  return `# Bootstrap — agent \`${agent.id}\` in orchestration \`${spec.name}\`

You are one agent in a tmux-hosted multi-agent run. Read this whole file, then read every skill
listed under "Skills", then reply in your terminal with the single word READY.

## Identity

- Agent id: \`${agent.id}\`
- Role: **${agent.role}**
- Run id: \`${spec.run_id}\`
- Run directory: \`${spec.run_dir}\`
- Your mailbox: inbox \`${join(self, "inbox")}\`, outbox \`${join(self, "outbox")}\`
- Shared artifacts: \`${join(spec.run_dir, spec.artifacts.dir)}\`
- Working directory: \`${agent.cwd}\`

## Agents in this run

${describeAgents(spec, agent.id)}

## Inputs

${describeInputs(spec)}

## Mailbox protocol (all agents)

1. A message arrives as a file in your inbox. The terminal shows a one-line pointer like
   \`[ao] Message 003-brief from orchestrator ...\`. The file is the message; the pointer is only a bell.
2. Read the message file. Do the work it asks for.
3. Write your complete reply to the exact outbox path named in the message. The reply file is the
   only thing the sender reads — never rely on what you print in the terminal.
4. Prefer this helper to write the reply (it also journals it):
   \`${cliBin} reply --run ${shellQuote(spec.run_dir)} --agent ${agent.id} --message <id> --file <your-draft.md>\`
   Writing the outbox file directly is also acceptable.
5. Put deliverables (files, images, code) under the shared artifacts directory in a subfolder named
   after your agent id and the message id, and list their paths in the reply.
6. Never write outside the run directory or your working directory unless a message explicitly
   authorizes a path. Never edit another agent's mailbox.
7. If you are blocked or the request is ambiguous, still write a reply: say what is missing.

## Skills

${skillLines}

## Role

${role.text.trim()}
${role.fallback ? "\n_(fallback role pack — no specific pack found for this role)_\n" : ""}
${agent.instructions ? `## Additional instructions for this agent\n\n${agent.instructions.trim()}\n` : ""}
${isConductor ? `## Workflow you conduct

${describeWorkflow(spec)}

## Human gates

${describeGates(spec)}

## Conductor commands

Send a message (writes inbox files, journals, and rings each pane):
\`${cliBin} send --run ${shellQuote(spec.run_dir)} --from ${agent.id} --to <id>[,<id>] --stage <stage> --file <message.md>\`

Wait for replies (blocks until every recipient's reply file exists or the timeout passes):
\`${cliBin} wait --run ${shellQuote(spec.run_dir)} --from <id>[,<id>] --message <id> --timeout 20m\`

Look at an agent's screen when a wait times out:
\`${cliBin} capture --run ${shellQuote(spec.run_dir)} --agent <id> --lines 80\`

Status and journal: \`${cliBin} status --run ${shellQuote(spec.run_dir)}\`

Begin when you have replied READY: the mission is the inputs above plus the workflow.
` : ""}
`;
}

function launcherScript({ agent, argv, env }) {
  const lines = ["#!/usr/bin/env bash", "# Generated by ao-topology. Runs one agent CLI inside its tmux pane.", "set -u", `cd ${shellQuote(agent.cwd)}`];
  for (const [key, value] of Object.entries(env)) {
    if (!/^[A-Z_][A-Z0-9_]*$/i.test(key)) fail("TOPOLOGY_ENV_INVALID", `Agent ${agent.id}: env name "${key}" is not a valid variable name.`);
    lines.push(`export ${key}=${shellQuote(value)}`);
  }
  lines.push(`printf '\\033]2;%s\\007' ${shellQuote(`${agent.id} · ${agent.role} · ${agent.cli}`)}`);
  lines.push(`exec ${argv.map(shellQuote).join(" ")}`);
  return `${lines.join("\n")}\n`;
}

async function waitReady(pane, adapter, timeoutMs) {
  const started = Date.now();
  if (adapter.ready.pattern) {
    const pattern = new RegExp(adapter.ready.pattern, "m");
    while (Date.now() - started < timeoutMs) {
      const screen = await tmux.capture(pane, 40);
      if (pattern.test(screen)) return { ready: true, elapsed_ms: Date.now() - started };
      if (!(await tmux.paneAlive(pane))) return { ready: false, reason: "pane exited" };
      await sleep(500);
    }
    return { ready: false, reason: `ready pattern not seen within ${timeoutMs}ms` };
  }
  await sleep(adapter.ready.delay_ms ?? 3000);
  return { ready: await tmux.paneAlive(pane), reason: "fixed delay" };
}

/**
 * Launch one run. Returns { runDir, session, agents:[{id, pane, ready}], warnings, attach }.
 */
export async function launchRun({ spec, adapters, skillSearchDirs, roleSearchDirs, cliBin, dryRun = false, log = () => {} }) {
  const warnings = [];
  invariant(!(await exists(join(spec.run_dir, "run.json"))), "TOPOLOGY_RUN_EXISTS", `Run directory already exists: ${spec.run_dir}`);
  if (!dryRun && (await tmux.hasSession(spec.session))) {
    fail("TOPOLOGY_SESSION_EXISTS", `tmux session "${spec.session}" already exists. Stop it first: ao-topology stop --session ${spec.session}`);
  }

  const prepared = [];
  for (const agent of spec.agents) {
    const adapter = adapterFor(agent, adapters);
    if (adapter.fallback) warnings.push(`agent ${agent.id}: no adapter for cli "${agent.cli}"; using the generic adapter with command "${adapter.command}"`);
    const skills = [];
    for (const name of agent.skills) {
      const resolved = await resolveSkill(name, skillSearchDirs);
      if (!resolved.path) warnings.push(`agent ${agent.id}: skill "${name}" not found in any skill directory`);
      skills.push(resolved);
    }
    const role = await loadRole(agent.role, roleSearchDirs);
    if (role.fallback) warnings.push(`agent ${agent.id}: no role pack for "${agent.role}"; using ${role.path ? "worker" : "an inline placeholder"}`);
    const dir = agentDir(spec.run_dir, agent.id);
    const bootstrapFile = join(dir, "BOOTSTRAP.md");
    const vars = {
      run_id: spec.run_id,
      run_dir: spec.run_dir,
      session: spec.session,
      agent_id: agent.id,
      agent_role: agent.role,
      bootstrap_file: bootstrapFile,
      system_prompt: `You are agent "${agent.id}" (role: ${agent.role}) in the multi-agent orchestration "${spec.name}". Before doing anything else, read ${bootstrapFile} and follow it exactly.`,
    };
    const argv = buildArgv(adapter, agent, vars);
    const env = { AO_RUN_DIR: spec.run_dir, AO_AGENT_ID: agent.id, AO_AGENT_ROLE: agent.role, AO_SESSION: spec.session, ...agent.env };
    prepared.push({ agent, adapter, skills, role, dir, bootstrapFile, launcher: join(dir, "launch.sh"), argv, env, vars });
  }

  if (dryRun) {
    return { dryRun: true, runDir: spec.run_dir, session: spec.session, warnings, agents: prepared.map((item) => ({ id: item.agent.id, role: item.agent.role, adapter: item.adapter.id, command: item.argv, cwd: item.agent.cwd, skills: item.skills, role_pack: item.role.path })) };
  }

  await mkdir(join(spec.run_dir, spec.artifacts.dir), { recursive: true });
  for (const item of prepared) {
    await mkdir(join(item.dir, "inbox"), { recursive: true });
    await mkdir(join(item.dir, "outbox"), { recursive: true });
    await writeText(item.bootstrapFile, bootstrapText({ spec, agent: item.agent, role: item.role, skills: item.skills, cliBin }));
    await writeText(item.launcher, launcherScript({ agent: item.agent, argv: item.argv, env: item.env }), 0o700);
  }

  const run = {
    version: 1,
    name: spec.name,
    run_id: spec.run_id,
    session: spec.session,
    consumer: spec.consumer,
    run_dir: spec.run_dir,
    layout: spec.layout,
    inputs: spec.inputs_resolved ?? {},
    workflow: spec.workflow,
    gates: spec.gates,
    artifacts_dir: join(spec.run_dir, spec.artifacts.dir),
    created: nowIso(),
    state: "launching",
    sequence: 0,
    agents: prepared.map((item) => ({ id: item.agent.id, role: item.agent.role, cli: item.agent.cli, adapter: item.adapter.id, model: item.agent.model ?? null, cwd: item.agent.cwd, pane: null, bootstrap: item.bootstrapFile, launcher: item.launcher, submit_keys: item.adapter.submit_keys })),
  };
  await saveRun(spec.run_dir, run);
  await appendJournal(spec.run_dir, { type: "run.created", name: spec.name, run_id: spec.run_id, session: spec.session, agents: run.agents.map((agent) => agent.id) });

  // Conductor first so it owns pane 0 / the main pane.
  const ordered = [...prepared].sort((a, b) => (a.agent.role === "orchestrator" ? -1 : b.agent.role === "orchestrator" ? 1 : 0));
  const first = ordered[0];
  const firstPane = await tmux.newSession(spec.session, { cwd: first.agent.cwd, windowName: spec.layout === "windows" ? first.agent.id : "main" });
  const panes = new Map([[first.agent.id, firstPane]]);
  for (const item of ordered.slice(1)) {
    const pane = spec.layout === "windows"
      ? await tmux.newWindow(spec.session, item.agent.id, item.agent.cwd)
      : await tmux.splitPane(`${spec.session}:main`, { cwd: item.agent.cwd, horizontal: false });
    panes.set(item.agent.id, pane);
    if (spec.layout !== "windows") await tmux.selectLayout(`${spec.session}:main`, spec.layout === "grid" ? "tiled" : "main-vertical");
  }
  for (const item of ordered) {
    await tmux.setPaneTitle(panes.get(item.agent.id), `${item.agent.id} · ${item.agent.role}`);
  }
  for (const agent of run.agents) agent.pane = panes.get(agent.id);
  await saveRun(spec.run_dir, run);

  const results = [];
  for (const item of ordered) {
    const pane = panes.get(item.agent.id);
    log(`starting ${item.agent.id} (${item.adapter.id}) in pane ${pane}`);
    await tmux.sendText(pane, `bash ${shellQuote(item.launcher)}`);
    const readiness = await waitReady(pane, item.adapter, item.adapter.ready.timeout_ms ?? 45_000);
    if (!readiness.ready) warnings.push(`agent ${item.agent.id}: CLI did not look ready (${readiness.reason}); bootstrap pointer was sent anyway`);
    const pointer = render(item.adapter.bootstrap_message, item.vars);
    await tmux.sendText(pane, pointer, item.adapter.submit_keys);
    await appendJournal(spec.run_dir, { type: "agent.started", agent: item.agent.id, adapter: item.adapter.id, pane, ready: readiness.ready });
    results.push({ id: item.agent.id, role: item.agent.role, adapter: item.adapter.id, pane, ready: readiness.ready });
  }
  if (spec.layout !== "windows") await tmux.selectPane(panes.get(first.agent.id));

  run.state = "running";
  await saveRun(spec.run_dir, run);
  await appendJournal(spec.run_dir, { type: "run.launched", warnings });
  return { runDir: spec.run_dir, session: spec.session, agents: results, warnings, attach: tmux.attachCommand(spec.session) };
}
