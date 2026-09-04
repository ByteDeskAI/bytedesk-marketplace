// Launch a materialized spec: write the run directory, one bootstrap file and one launcher per
// (agent, candidate), create the tmux session, start every agent on the first candidate in its
// fallback chain that actually comes up, and deliver each agent its bootstrap pointer.
// `failoverAgent` re-runs the same start logic for one agent from the next candidate mid-run.
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { appendJournal, agentDir, loadRun, pendingReplies, saveRun } from "./mailbox.mjs";
import { adapterFor, buildArgv, commandExists, failureOnScreen } from "./providers.mjs";
import { loadRole, resolveSkill } from "./resolve.mjs";
import * as tmux from "./tmux.mjs";
import { exists, fail, invariant, nowIso, render, shellQuote, sleep, writeText } from "./util.mjs";

const POINTER_TEMPLATE = "[ao] Message {{id}} from {{from}} ({{stage}}): read {{inbox}} then write your complete reply to {{outbox}}";

export function messagePointer(fields) {
  return render(POINTER_TEMPLATE, fields);
}

export function candidateLabel(candidate) {
  return candidate.model ? `${candidate.cli}:${candidate.model}` : candidate.cli;
}

function describeAgents(spec, selfId) {
  return spec.agents
    .map((agent) => {
      const chain = agent.candidates.map(candidateLabel).join(" → ");
      return `- \`${agent.id}\` — role ${agent.role}, providers ${chain}${agent.id === selfId ? " ← you" : ""}`;
    })
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
- Provider chain: ${agent.candidates.map(candidateLabel).join(" → ")} (the conductor can fail you over to the next one)
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
8. If your own provider stops serving you (usage limit, auth), say so in the terminal; the
   conductor will fail you over to the next provider in your chain and your mailbox survives.

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

Fail an agent over to the next provider in its chain (usage limit, auth failure, dead pane);
pending messages are re-delivered automatically:
\`${cliBin} failover --run ${shellQuote(spec.run_dir)} --agent <id>\`

Status and journal: \`${cliBin} status --run ${shellQuote(spec.run_dir)}\`

Begin when you have replied READY: the mission is the inputs above plus the workflow.
` : ""}
`;
}

function launcherScript({ agent, candidate, argv, env }) {
  const lines = ["#!/usr/bin/env bash", `# Generated by ao-topology. Runs agent ${agent.id} on ${candidateLabel(candidate)} inside its tmux pane.`, "set -u", `cd ${shellQuote(agent.cwd)}`];
  for (const [key, value] of Object.entries(env)) {
    if (!/^[A-Z_][A-Z0-9_]*$/i.test(key)) fail("TOPOLOGY_ENV_INVALID", `Agent ${agent.id}: env name "${key}" is not a valid variable name.`);
    lines.push(`export ${key}=${shellQuote(value)}`);
  }
  lines.push(`printf '\\033]2;%s\\007' ${shellQuote(`${agent.id} · ${agent.role} · ${candidateLabel(candidate)}`)}`);
  lines.push(`exec ${argv.map(shellQuote).join(" ")}`);
  return `${lines.join("\n")}\n`;
}

async function waitReady(pane, adapter, timeoutMs) {
  const started = Date.now();
  const check = async () => {
    const screen = await tmux.capture(pane, 40);
    const failure = failureOnScreen(adapter, screen);
    if (failure) return { ready: false, failed: true, reason: `screen matched failure pattern /${failure}/` };
    if (!(await tmux.paneAlive(pane))) return { ready: false, failed: true, reason: "pane exited" };
    return null;
  };
  if (adapter.ready.pattern) {
    const pattern = new RegExp(adapter.ready.pattern, "m");
    while (Date.now() - started < timeoutMs) {
      const failed = await check();
      if (failed) return failed;
      if (pattern.test(await tmux.capture(pane, 40))) return { ready: true, elapsed_ms: Date.now() - started };
      await sleep(500);
    }
    return { ready: false, failed: false, reason: `ready pattern not seen within ${timeoutMs}ms` };
  }
  await sleep(adapter.ready.delay_ms ?? 3000);
  const failed = await check();
  if (failed) return failed;
  return { ready: true, reason: "fixed delay" };
}

/** Build launcher + argv for every candidate of one agent; write nothing yet. */
function prepareCandidates({ spec, agent, adapters, bootstrapFile, dir, warnings }) {
  const system_prompt = `You are agent "${agent.id}" (role: ${agent.role}) in the multi-agent orchestration "${spec.name}". Before doing anything else, read ${bootstrapFile} and follow it exactly.`;
  return agent.candidates.map((candidate, index) => {
    const adapter = adapterFor({ ...agent, cli: candidate.cli, model: candidate.model }, adapters);
    if (adapter.fallback) warnings.push(`agent ${agent.id}: no adapter for cli "${candidate.cli}"; using the generic adapter with command "${adapter.command}"`);
    const vars = { run_id: spec.run_id, run_dir: spec.run_dir, session: spec.session, agent_id: agent.id, agent_role: agent.role, bootstrap_file: bootstrapFile, system_prompt };
    const argv = buildArgv(adapter, { ...agent, cli: candidate.cli, model: candidate.model }, vars);
    const env = { AO_RUN_DIR: spec.run_dir, AO_AGENT_ID: agent.id, AO_AGENT_ROLE: agent.role, AO_SESSION: spec.session, AO_PROVIDER: candidateLabel(candidate), ...agent.env };
    return { index, candidate, label: candidateLabel(candidate), adapter, argv, env, vars, launcher: join(dir, `launch-${index}.sh`) };
  });
}

/**
 * Start one agent in its pane, walking the candidate chain from `startIndex`. Returns
 * { ok, index, label, adapter, ready, attempts:[{label, outcome}] }.
 */
async function startAgentInPane({ pane, agentId, candidates, startIndex = 0, runDir, log = () => {}, respawn = false }) {
  const attempts = [];
  for (let index = startIndex; index < candidates.length; index += 1) {
    const item = candidates[index];
    if (!(await commandExists(item.adapter.command))) {
      attempts.push({ label: item.label, outcome: `command "${item.adapter.command}" not found` });
      await appendJournal(runDir, { type: "agent.candidate_skipped", agent: agentId, candidate: item.label, reason: "command not found" });
      continue;
    }
    if (respawn || index > startIndex) await tmux.respawnPane(pane);
    log(`starting ${agentId} on ${item.label} in pane ${pane}`);
    await tmux.sendText(pane, `bash ${shellQuote(item.launcher)}`);
    const readiness = await waitReady(pane, item.adapter, item.adapter.ready.timeout_ms ?? 45_000);
    if (readiness.failed) {
      attempts.push({ label: item.label, outcome: readiness.reason });
      await appendJournal(runDir, { type: "agent.candidate_failed", agent: agentId, candidate: item.label, reason: readiness.reason });
      continue;
    }
    const pointer = render(item.adapter.bootstrap_message, item.vars);
    await tmux.sendText(pane, pointer, item.adapter.submit_keys);
    attempts.push({ label: item.label, outcome: readiness.ready ? "ready" : `started (${readiness.reason})` });
    await appendJournal(runDir, { type: "agent.started", agent: agentId, candidate: item.label, adapter: item.adapter.id, pane, ready: readiness.ready });
    return { ok: true, index, label: item.label, adapter: item.adapter, ready: readiness.ready, attempts };
  }
  await appendJournal(runDir, { type: "agent.exhausted", agent: agentId, attempts });
  return { ok: false, index: -1, label: null, adapter: null, ready: false, attempts };
}

/**
 * Launch one run. Returns { runDir, session, agents:[{id, pane, provider, ready, attempts}], warnings, attach }.
 */
export async function launchRun({ spec, adapters, skillSearchDirs, roleSearchDirs, cliBin, dryRun = false, log = () => {} }) {
  const warnings = [];
  invariant(!(await exists(join(spec.run_dir, "run.json"))), "TOPOLOGY_RUN_EXISTS", `Run directory already exists: ${spec.run_dir}`);
  if (!dryRun && (await tmux.hasSession(spec.session))) {
    fail("TOPOLOGY_SESSION_EXISTS", `tmux session "${spec.session}" already exists. Stop it first: ao-topology stop --session ${spec.session}`);
  }

  const prepared = [];
  for (const agent of spec.agents) {
    const skills = [];
    for (const name of agent.skills.filter((item) => item && item !== "none")) {
      const resolved = await resolveSkill(name, skillSearchDirs);
      if (!resolved.path) warnings.push(`agent ${agent.id}: skill "${name}" not found in any skill directory`);
      skills.push(resolved);
    }
    const role = await loadRole(agent.role, roleSearchDirs);
    if (role.fallback) warnings.push(`agent ${agent.id}: no role pack for "${agent.role}"; using ${role.path ? "worker" : "an inline placeholder"}`);
    const dir = agentDir(spec.run_dir, agent.id);
    const bootstrapFile = join(dir, "BOOTSTRAP.md");
    const candidates = prepareCandidates({ spec, agent, adapters, bootstrapFile, dir, warnings });
    prepared.push({ agent, skills, role, dir, bootstrapFile, candidates });
  }

  if (dryRun) {
    return {
      dryRun: true,
      runDir: spec.run_dir,
      session: spec.session,
      warnings,
      agents: prepared.map((item) => ({
        id: item.agent.id,
        role: item.agent.role,
        cwd: item.agent.cwd,
        candidates: item.candidates.map((candidate) => ({ label: candidate.label, adapter: candidate.adapter.id, command: candidate.argv })),
        skills: item.skills,
        role_pack: item.role.path,
      })),
    };
  }

  await mkdir(join(spec.run_dir, spec.artifacts.dir), { recursive: true });
  for (const item of prepared) {
    await mkdir(join(item.dir, "inbox"), { recursive: true });
    await mkdir(join(item.dir, "outbox"), { recursive: true });
    await writeText(item.bootstrapFile, bootstrapText({ spec, agent: item.agent, role: item.role, skills: item.skills, cliBin }));
    for (const candidate of item.candidates) {
      await writeText(candidate.launcher, launcherScript({ agent: item.agent, candidate: candidate.candidate, argv: candidate.argv, env: candidate.env }), 0o700);
    }
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
    agents: prepared.map((item) => ({
      id: item.agent.id,
      role: item.agent.role,
      cwd: item.agent.cwd,
      pane: null,
      bootstrap: item.bootstrapFile,
      candidates: item.candidates.map((candidate) => ({ label: candidate.label, cli: candidate.candidate.cli, model: candidate.candidate.model ?? null, adapter: candidate.adapter.id, launcher: candidate.launcher, submit_keys: candidate.adapter.submit_keys })),
      active: null,
      provider: null,
      adapter: null,
      submit_keys: ["Enter"],
    })),
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
    const started = await startAgentInPane({ pane, agentId: item.agent.id, candidates: item.candidates, runDir: spec.run_dir, log });
    const entry = run.agents.find((agent) => agent.id === item.agent.id);
    if (started.ok) {
      entry.active = started.index;
      entry.provider = started.label;
      entry.adapter = started.adapter.id;
      entry.submit_keys = started.adapter.submit_keys;
      if (!started.ready) warnings.push(`agent ${item.agent.id}: ${started.label} did not look ready (${started.attempts.at(-1).outcome}); bootstrap pointer was sent anyway`);
      if (started.index > 0) warnings.push(`agent ${item.agent.id}: fell back to ${started.label} after ${started.attempts.slice(0, -1).map((attempt) => `${attempt.label} (${attempt.outcome})`).join(", ")}`);
    } else {
      warnings.push(`agent ${item.agent.id}: every provider in its chain failed — ${started.attempts.map((attempt) => `${attempt.label}: ${attempt.outcome}`).join("; ")}`);
    }
    await saveRun(spec.run_dir, run);
    results.push({ id: item.agent.id, role: item.agent.role, pane, provider: started.label, adapter: started.adapter?.id ?? null, ready: started.ready, attempts: started.attempts });
  }
  if (spec.layout !== "windows") await tmux.selectPane(panes.get(first.agent.id));

  run.state = results.every((result) => result.provider) ? "running" : "degraded";
  await saveRun(spec.run_dir, run);
  await appendJournal(spec.run_dir, { type: "run.launched", state: run.state, warnings });
  return { runDir: spec.run_dir, session: spec.session, state: run.state, agents: results, warnings, attach: tmux.attachCommand(spec.session) };
}

/**
 * Restart one agent on the next candidate in its chain (or a specific one via `toLabel`),
 * re-send its bootstrap, and re-ring every message it has not answered yet.
 */
export async function failoverAgent({ runDir, agentId, adapters, toLabel, log = () => {} }) {
  const run = await loadRun(runDir);
  const entry = run.agents.find((agent) => agent.id === agentId);
  invariant(entry, "TOPOLOGY_UNKNOWN_AGENT", `Unknown agent "${agentId}". Agents: ${run.agents.map((agent) => agent.id).join(", ")}.`);
  invariant(await tmux.hasSession(run.session), "TOPOLOGY_SESSION_GONE", `tmux session ${run.session} is not running.`);
  let startIndex = (entry.active ?? -1) + 1;
  if (toLabel) {
    startIndex = entry.candidates.findIndex((candidate) => candidate.label === toLabel || candidate.cli === toLabel);
    invariant(startIndex >= 0, "TOPOLOGY_CANDIDATE_UNKNOWN", `"${toLabel}" is not in ${agentId}'s chain: ${entry.candidates.map((candidate) => candidate.label).join(", ")}.`);
  }
  invariant(startIndex < entry.candidates.length, "TOPOLOGY_CHAIN_EXHAUSTED", `${agentId} has no provider left after ${entry.provider ?? "none"}. Chain: ${entry.candidates.map((candidate) => candidate.label).join(" → ")}. Add candidates to the template or restart with --to <cli:model>.`);
  const previous = entry.provider;
  const candidates = entry.candidates.map((candidate, index) => {
    const adapter = adapterFor({ cli: candidate.cli, model: candidate.model, args: [], skills: [] }, adapters);
    return { index, label: candidate.label, adapter, launcher: candidate.launcher, vars: { run_id: run.run_id, run_dir: runDir, session: run.session, agent_id: agentId, agent_role: entry.role, bootstrap_file: entry.bootstrap } };
  });
  await appendJournal(runDir, { type: "agent.failover", agent: agentId, from: previous, to_index: startIndex });
  const started = await startAgentInPane({ pane: entry.pane, agentId, candidates, startIndex, runDir, log, respawn: true });
  if (!started.ok) {
    entry.active = entry.candidates.length;
    entry.provider = null;
    run.state = "degraded";
    await saveRun(runDir, run);
    return { ok: false, agent: agentId, from: previous, attempts: started.attempts };
  }
  entry.active = started.index;
  entry.provider = started.label;
  entry.adapter = started.adapter.id;
  entry.submit_keys = started.adapter.submit_keys;
  await saveRun(runDir, run);
  // Re-ring anything still unanswered so the new provider picks up where the old one stopped.
  const pending = await pendingReplies(runDir, [agentId]);
  for (const item of pending) {
    const pointer = messagePointer({ id: item.id, from: "conductor", stage: item.id.split("-").slice(1).join("-"), inbox: item.inbox, outbox: item.outbox });
    await tmux.sendText(entry.pane, pointer, entry.submit_keys);
  }
  await appendJournal(runDir, { type: "agent.failover_complete", agent: agentId, from: previous, to: started.label, redelivered: pending.map((item) => item.id) });
  return { ok: true, agent: agentId, from: previous, to: started.label, ready: started.ready, redelivered: pending.map((item) => item.id), attempts: started.attempts };
}
