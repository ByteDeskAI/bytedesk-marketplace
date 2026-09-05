// Launch a materialized spec: write the run directory, one bootstrap file and one launcher per
// (agent, candidate), create the tmux session, start every agent on the first candidate in its
// fallback chain that actually comes up, and deliver each agent its bootstrap pointer.
// `failoverAgent` re-runs the same start logic for one agent from the next candidate mid-run.
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { mkdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import { appendJournal, agentDir, loadRun, pendingReplies, saveRun } from "./mailbox.mjs";
import { adapterFor, buildArgv, commandExists, failureOnScreen, grantsDirs, memoryLocation } from "./providers.mjs";
import { mintSpawn, sessionName } from "./identity.mjs";
import { loadRole, resolveSkill } from "./resolve.mjs";
import * as tmux from "./tmux.mjs";
import { ensureRunsIgnored, exists, fail, invariant, nowIso, render, shellQuote, sleep, writeText } from "./util.mjs";

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

export function launcherScript({ agent, candidate, argv, env }) {
  const lines = ["#!/usr/bin/env bash", `# Generated by ao-topology. Runs agent ${agent.id} on ${candidateLabel(candidate)} inside its tmux pane.`, "set -u", `cd ${shellQuote(agent.cwd)}`];
  for (const [key, value] of Object.entries(env)) {
    if (!/^[A-Z_][A-Z0-9_]*$/i.test(key)) fail("TOPOLOGY_ENV_INVALID", `Agent ${agent.id}: env name "${key}" is not a valid variable name.`);
    lines.push(`export ${key}=${shellQuote(value)}`);
  }
  lines.push(`printf '\\033]2;%s\\007' ${shellQuote(`${agent.id} · ${agent.role} · ${candidateLabel(candidate)}`)}`);
  lines.push(`exec ${argv.map(shellQuote).join(" ")}`);
  return `${lines.join("\n")}\n`;
}

/**
 * Everything about readiness that is a decision rather than an I/O call, so it can be tested
 * without a tmux server.
 *
 * `screenSince` is the fix for the false positive: the pane already holds a shell prompt and the
 * echoed launcher line when we start looking, and a ready pattern like /[>\u276f]/ matches a bare zsh
 * or starship prompt perfectly well. Only output produced after the launcher was sent counts.
 */
export function screenSince(screen, baseline) {
  const text = String(screen ?? "");
  if (!baseline) return text;
  // Anchor on the last occurrence rather than a prefix match: tmux trims trailing blank lines, so a
  // snapshot taken earlier is not reliably a prefix of a later one.
  const at = text.lastIndexOf(baseline);
  return at === -1 ? text : text.slice(at + baseline.length);
}

/**
 * Verdict on one look at a pane. `null` means "nothing decided yet, keep waiting"; only the
 * ready-pattern path can return it. The fixed-delay path always decides, which is what makes
 * ready:false reachable for the five adapters that have no pattern.
 */
export function evaluateScreen(adapter, screen, { alive = true } = {}) {
  const failure = failureOnScreen(adapter, screen);
  if (failure) return { ready: false, failed: true, reason: `screen matched failure pattern /${failure}/` };
  if (!alive) return { ready: false, failed: true, reason: "pane exited" };
  if (adapter.ready.pattern) {
    return new RegExp(adapter.ready.pattern, "m").test(screen) ? { ready: true, failed: false, reason: "ready pattern" } : null;
  }
  const delay = adapter.ready.delay_ms ?? 3000;
  if (screen.trim().length === 0) {
    return {
      ready: false,
      failed: false,
      reason: `no output from ${adapter.id} after ${delay}ms; it may still be starting. Give this adapter a ready.pattern for a real check.`,
    };
  }
  return { ready: true, failed: false, reason: "fixed delay" };
}

/**
 * Wait until the pane's shell is actually accepting input, and return a marker that separates the
 * shell's output from the agent's.
 *
 * Nothing used to wait for the shell at all: the launcher was typed the instant the pane existed,
 * so a slow rc file (a banner, a version manager, anything that writes on startup) swallowed the
 * keystrokes and the agent never started — while readiness polling went on to match whatever the
 * shell had drawn. Signalling a tmux channel from the shell proves it is live and gives readiness a
 * reliable place to start reading from.
 */
async function waitForShell(pane, timeoutMs = 15_000) {
  const channel = `ao-shell-${randomUUID().slice(0, 8)}`;
  // The shell signals the tmux server when it is ready to accept the next command. This is a real
  // barrier rather than a guess: screen scraping cannot replace it — a narrow pane renders one
  // character per line and no marker survives that.
  const baselineBefore = await tmux.captureAll(pane);
  await tmux.sendText(pane, `tmux wait-for -S ${channel}`);
  const signalled = await tmux.waitForChannel(channel, timeoutMs);
  if (!signalled) return { ok: false, marker: "" };
  return { ok: true, marker: baselineBefore, channel };
}

async function waitReady(pane, adapter, timeoutMs, { baseline = "" } = {}) {
  const started = Date.now();
  const look = async () => {
    const screen = screenSince(await tmux.captureAll(pane), baseline);
    return evaluateScreen(adapter, screen, { alive: await tmux.paneAlive(pane) });
  };

  if (adapter.ready.pattern) {
    while (Date.now() - started < timeoutMs) {
      const verdict = await look();
      if (verdict) return { ...verdict, elapsed_ms: Date.now() - started };
      await sleep(500);
    }
    return { ready: false, failed: false, reason: `ready pattern not seen within ${timeoutMs}ms` };
  }

  // No pattern for this adapter: wait the declared delay, then decide from what the pane shows.
  await sleep(adapter.ready.delay_ms ?? 3000);
  return { ...(await look()), elapsed_ms: Date.now() - started };
}

/**
 * A tmux session name for one spawn of one agent: the agent's stable id plus a per-spawn
 * discriminator. Uniqueness scope is **live sessions on this host** — the discriminator only has to
 * tell two concurrent spawns apart, and that is the scope tmux itself enforces, so it is checked
 * against tmux rather than assumed from randomness.
 */
export async function uniqueSessionName(agentId, { has = tmux.hasSession, mint = mintSpawn, attempts = 10 } = {}) {
  for (let i = 0; i < attempts; i += 1) {
    const name = sessionName(agentId, mint());
    if (!(await has(name))) return name;
  }
  fail("TOPOLOGY_SESSION_NAME_EXHAUSTED", `Could not mint a free session name for agent ${agentId} in ${attempts} attempts. Stop some sessions: tmux ls.`);
}

/**
 * The secret that proves an agent is itself. It is a capability, not an identifier: whoever holds it
 * can write that agent's outbox and satisfy its barrier, so it is minted per agent per run, exported
 * into that one agent's launcher environment, and never shared between agents.
 */
export function mintAgentToken(rand = randomBytes) {
  return rand(16).toString("hex");
}

export function tokenDigest(token) {
  return createHash("sha256").update(String(token)).digest("hex");
}

/** Build launcher + argv for every candidate of one agent; write nothing yet. */
function prepareCandidates({ spec, agent, adapters, bootstrapFile, dir, warnings, token }) {
  // A coordinator is granted nothing. It delegates rather than implements, and it is the only
  // address an outsider may reach directly in cross-repo routing — the most exposed agent in the
  // system should be the least capable one. Its cwd is its own agent directory, so withholding the
  // work-tree grant leaves that directory the only writable path it has: "cannot write the repo" is
  // then a property of what it was launched with, not a sentence in its prompt.
  const coordinator = agent.coordinates_only === true;
  // Any other agent whose cwd is not the repo has its own memory (every shipped CLI keys session
  // state by working directory) but no access to the tree it is meant to work in. The adapter
  // declares how to grant it; if it declares nothing, say so rather than launching a blind agent.
  const addDirs = coordinator
    ? []
    : [...new Set([...(agent.add_dirs ?? []), ...(resolve(agent.cwd) === resolve(spec.consumer) ? [] : [spec.consumer])])].filter(Boolean);
  const system_prompt = `You are agent "${agent.id}" (role: ${agent.role}) in the multi-agent orchestration "${spec.name}". Before doing anything else, read ${bootstrapFile} and follow it exactly.`;
  return agent.candidates.map((candidate, index) => {
    const adapter = adapterFor({ ...agent, cli: candidate.cli, model: candidate.model }, adapters);
    if (adapter.fallback) warnings.push(`agent ${agent.id}: no adapter for cli "${candidate.cli}"; using the generic adapter with command "${adapter.command}"`);
    const vars = { run_id: spec.run_id, run_dir: spec.run_dir, session: spec.session, agent_id: agent.id, agent_role: agent.role, bootstrap_file: bootstrapFile, system_prompt };
    if (addDirs.length > 0 && !grantsDirs(adapter)) {
      warnings.push(`agent ${agent.id}: ${candidateLabel(candidate)} has no add_dir_args, so it cannot be granted ${addDirs.join(", ")} — it will only see ${agent.cwd}. Add add_dir_args to its provider JSON, or give the agent cwd ${spec.consumer}.`);
    }
    if (coordinator && (adapter.coordinator_args ?? []).length === 0) {
      warnings.push(`agent ${agent.id}: ${candidateLabel(candidate)} declares no coordinator_args, so nothing removes its write tools — it is contained only by having no directory granted beyond ${agent.cwd}. Add coordinator_args to its provider JSON.`);
    }
    const argv = buildArgv(adapter, { ...agent, cli: candidate.cli, model: candidate.model, coordinates_only: coordinator, add_dirs: addDirs }, vars);
    // AO_AGENT_TOKEN goes in last, after the spec's own env: a spec is data, often committed data,
    // and it may not name the secret that decides which agent this pane is allowed to answer as.
    const env = { AO_RUN_DIR: spec.run_dir, AO_AGENT_ID: agent.id, AO_AGENT_ROLE: agent.role, AO_SESSION: spec.session, AO_PROVIDER: candidateLabel(candidate), ...agent.env, AO_AGENT_TOKEN: token };
    return { index, candidate, label: candidateLabel(candidate), adapter, argv, env, vars, add_dirs: addDirs, memory: memoryLocation(adapter, { cwd: agent.cwd, home: spec.home ?? process.env.HOME ?? "" }), launcher: join(dir, `launch-${index}.sh`) };
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
    // Prove the shell is accepting input before typing the launcher into it, and take the marker it
    // returns as the boundary between shell output and agent output.
    const shell = await waitForShell(pane);
    if (!shell.ok) {
      attempts.push({ label: item.label, outcome: "shell did not become ready" });
      await appendJournal(runDir, { type: "agent.candidate_failed", agent: agentId, candidate: item.label, reason: "shell did not become ready" });
      continue;
    }
    const baseline = shell.marker;
    await tmux.sendText(pane, `bash ${shellQuote(item.launcher)}`);
    const readiness = await waitReady(pane, item.adapter, item.adapter.ready.timeout_ms ?? 45_000, { baseline });
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
export async function launchRun({ spec, adapters, skillSearchDirs, roleSearchDirs, cliBin, dryRun = false, allowAutoApprove = false, log = () => {} }) {
  const warnings = [];
  // Consent, not just a warning. auto_approve strips the agent's own permission prompts, which
  // docs/topology.md names as this layer's safety boundary; a spec is data, often committed data,
  // so removing that boundary has to be an operator's decision at the moment of launch.
  const autoApproved = spec.agents.filter((agent) => agent.auto_approve);
  if (autoApproved.length > 0) {
    warnings.push(
      `auto_approve is on for ${autoApproved.map((agent) => agent.id).join(", ")} — ${autoApproved.length === 1 ? "that agent" : "those agents"} will run without permission prompts in ${spec.cwd}. Their own prompts are normally the safety boundary.`,
    );
    // The gate fires on --dry-run as well. A dry run is how an operator inspects a spec, so it is
    // exactly where the consent question belongs: finding out about it only after panes exist is
    // finding out too late.
    invariant(
      allowAutoApprove,
      "TOPOLOGY_AUTO_APPROVE_UNCONFIRMED",
      `This spec runs ${autoApproved.length === 1 ? "an agent" : "agents"} without permission prompts (auto_approve): ${autoApproved.map((agent) => `${agent.id} (${agent.role})`).join(", ")}. Their own prompts are the safety boundary this layer relies on, and the spec removes it in ${spec.cwd}. Re-run with --allow-auto-approve if that is genuinely intended.`,
      { agents: autoApproved.map((agent) => agent.id) },
    );
  }
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
    // One token per agent, not per candidate: a failover changes the provider, not who the agent is.
    const token = mintAgentToken();
    const candidates = prepareCandidates({ spec, agent, adapters, bootstrapFile, dir, warnings, token });
    prepared.push({ agent, skills, role, dir, bootstrapFile, candidates, token });
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
        candidates: item.candidates.map((candidate) => ({ label: candidate.label, adapter: candidate.adapter.id, command: candidate.argv, add_dirs: candidate.add_dirs, memory: candidate.memory })),
        skills: item.skills,
        role_pack: item.role.path,
      })),
    };
  }

  // Before anything is written into the run dir: these repos deliberately commit `.bytedesk/`, so
  // without this every mailbox file and journal line lands in the consumer's next diff.
  await ensureRunsIgnored(spec.run_dir);
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
      // The digest, never the secret. A record that is enough to check a reply with, and never
      // enough to forge one with: the run dir is readable by every agent in the run. Anything that
      // needs the token itself reads it from that agent's own launcher, where only that pane sees it.
      token_sha256: tokenDigest(item.token),
      candidates: item.candidates.map((candidate) => ({ label: candidate.label, cli: candidate.candidate.cli, model: candidate.candidate.model ?? null, adapter: candidate.adapter.id, launcher: candidate.launcher, submit_keys: candidate.adapter.submit_keys, add_dirs: candidate.add_dirs, memory: candidate.memory })),
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
