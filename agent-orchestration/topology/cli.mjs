#!/usr/bin/env node
// ao-topology: launch and conduct tmux-hosted multi-agent orchestrations from a declarative spec.
// Zero dependencies; runs from an installed plugin cache. Skills drive this CLI; agents call
// `reply`; the conductor calls `send`, `wait`, `capture`, and `status`.
import { readFile, readdir } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { doctor as runDoctor, tmuxInstallPlan } from "./lib/doctor.mjs";
import { failoverAgent, launchRun, messagePointer } from "./lib/launch.mjs";
import { appendJournal, loadRun, pendingReplies, queueDepth, readJournal, recordReply, saveRun, sendMessage, waitForReplies } from "./lib/mailbox.mjs";
import { adapterSummary, loadAdapters, providerDirs } from "./lib/providers.mjs";
import { roleDirs, skillDirs } from "./lib/resolve.mjs";
import { listTemplates, loadSpec, materializeSpec, resolveInputs, specSchemaSummary, templateDirs, validateSpec } from "./lib/spec.mjs";
import * as tmux from "./lib/tmux.mjs";
import { TopologyError, absolutize, exists, fail, invariant, newRunId, parseArgs, parseDuration, readJson, writeJson, AO_HOME } from "./lib/util.mjs";
import { agentDirs, agentsRoot, createAgent, findLead, listAgents, requireAgent } from "./lib/agents.mjs";
import { displayName } from "./lib/identity.mjs";
import { issueDelegation, listDelegations, routeMessage } from "./lib/routing.mjs";

const PLUGIN_ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const CLI_BIN = process.env.AO_TOPOLOGY_BIN || join(PLUGIN_ROOT, "bin", "ao-topology");

const USAGE = `ao-topology — tmux-hosted multi-agent orchestration

Discover
  templates [--consumer <dir>]                 list orchestration templates
  schema                                       print the spec schema summary
  providers [--json]                           list provider adapters
  doctor [--json] [--consumer <dir>]           check tmux, CLIs, and search paths
  runs [--consumer <dir>]                      list runs under <consumer>/.bytedesk/agent-orchestration/runs

Compose
  inputs (--template <name> | --spec <file>)    show a template's inputs, options, and defaults
  validate (--spec <file> | --template <name>) validate a spec and print the normalized form
  compose --spec <file> [--save user|consumer|<dir>] [--name <slug>]
                                               validate and save a spec as a template

Launch and stop
  launch (--template <name> | --spec <file>) [--consumer <dir>] [--input k=v]... [--run-id <id>]
         [--dry-run] [--json]
         [--allow-outside]       permit a cwd or run_dir outside the invoking repository
         [--allow-auto-approve]  permit agents that run without their own permission prompts
  stop (--run <run_dir> | --session <name>) [--keep-files]
  status --run <run_dir> [--json]
  journal --run <run_dir> [--limit 50]

Conduct (used by the orchestrator agent)
  agent new --role <role> [--cli <id>] [--reports-to <id>] [--name "First Last"]
  agent list [--json]                          the repo's roster, by name and title
  agent show <id|"Full Name">                  one agent
  delegate --task <id> --to <agent> [--for <external-agent>]
                                               open a direct channel to one of your agents
  delegations [--json]                         open delegations in this repo

  send --run <run_dir> --from <id> --to <id>[,<id>] --stage <slug> (--file <md> | --body <text>)
       [--from-project <dir>] [--task <id>]    routed: an outsider reaches the lead unless delegated
       [--contract <name>] [--round <n>] [--subject <text>] [--no-ring]
  wait --run <run_dir> [--from <id>[,<id>]] [--message <id>] [--timeout 20m] [--poll 3s] [--json]
  capture --run <run_dir> --agent <id> [--lines 60]
  nudge --run <run_dir> --agent <id> --text <text>
  failover --run <run_dir> --agent <id> [--to <cli:model>]
                                               restart the agent on the next provider in its chain and
                                               re-deliver its unanswered messages

Reply (used by every agent)
  reply --run <run_dir> --agent <id> --message <id> (--file <md> | --body <text>)

Common: --consumer defaults to the current directory; --json prints machine-readable output.
`;

function out(value) {
  process.stdout.write(typeof value === "string" ? `${value}\n` : `${JSON.stringify(value, null, 2)}\n`);
}

function list(value) {
  if (value === undefined || value === true) return [];
  return [].concat(value).flatMap((item) => String(item).split(",")).map((item) => item.trim()).filter(Boolean);
}

function inputPairs(value) {
  const pairs = {};
  // Not split on commas: a multi-option input is passed as `--input deliverables=mark,favicon`.
  const items = value === undefined || value === true ? [] : [].concat(value).map(String);
  for (const item of items) {
    const eq = item.indexOf("=");
    invariant(eq > 0, "TOPOLOGY_INPUT_INVALID", `--input expects name=value (got "${item}").`);
    pairs[item.slice(0, eq).trim()] = item.slice(eq + 1);
  }
  return pairs;
}

function context(flags) {
  const consumer = absolutize(flags.consumer && flags.consumer !== true ? flags.consumer : process.cwd());
  const home = homedir();
  const extraTemplates = list(flags["templates-dir"]).map((dir) => absolutize(dir));
  const extraSkills = list(flags["skills-dir"]).map((dir) => absolutize(dir));
  const extraRoles = list(flags["roles-dir"]).map((dir) => absolutize(dir));
  const extraProviders = list(flags["providers-dir"]).map((dir) => absolutize(dir));
  const unique = (dirs) => [...new Set(dirs.map((dir) => resolve(dir)))];
  return {
    consumer,
    home,
    pluginRoot: PLUGIN_ROOT,
    templateDirs: unique(templateDirs({ pluginRoot: PLUGIN_ROOT, consumer, home, extra: extraTemplates })),
    skillDirs: unique(skillDirs({ pluginRoot: PLUGIN_ROOT, consumer, home, extra: extraSkills })),
    roleDirs: unique(roleDirs({ pluginRoot: PLUGIN_ROOT, consumer, home, extra: extraRoles })),
    providerDirs: unique(providerDirs({ pluginRoot: PLUGIN_ROOT, consumer, home, extra: extraProviders })),
    agentDirs: unique(agentDirs({ pluginRoot: PLUGIN_ROOT, consumer, home })),
  };
}

async function bodyFrom(flags) {
  if (flags.file && flags.file !== true) return readFile(absolutize(flags.file), "utf8");
  if (typeof flags.body === "string") return flags.body;
  if (!process.stdin.isTTY) {
    const chunks = [];
    for await (const chunk of process.stdin) chunks.push(chunk);
    const text = Buffer.concat(chunks).toString("utf8");
    if (text.trim()) return text;
  }
  fail("TOPOLOGY_BODY_REQUIRED", "Provide --file <path>, --body <text>, or pipe the body on stdin.");
}

async function runDirFrom(flags) {
  invariant(flags.run && flags.run !== true, "TOPOLOGY_RUN_REQUIRED", "Pass --run <run_dir>.");
  const runDir = absolutize(flags.run);
  invariant(await exists(join(runDir, "run.json")), "TOPOLOGY_RUN_NOT_FOUND", `No run.json under ${runDir}.`);
  return runDir;
}

const commands = {
  async help() {
    out(USAGE);
  },

  async schema() {
    out(specSchemaSummary());
  },

  async templates({ flags }) {
    const ctx = context(flags);
    const templates = await listTemplates(ctx.templateDirs);
    if (flags.json) return out({ searched: ctx.templateDirs, templates });
    if (templates.length === 0) return out(`No templates found. Searched:\n- ${ctx.templateDirs.join("\n- ")}`);
    for (const template of templates) {
      out(template.error ? `✗ ${template.name}  (${template.path}) — ${template.error.split("\n")[0]}` : `• ${template.name} — ${template.description || "(no description)"}\n    agents: ${template.agents.join(", ")}\n    ${template.path}`);
    }
  },

  async providers({ flags }) {
    const ctx = context(flags);
    const adapters = await loadAdapters(ctx.providerDirs);
    const summaries = [...adapters.values()].map(adapterSummary);
    if (flags.json) return out({ searched: ctx.providerDirs, adapters: summaries });
    for (const adapter of summaries) {
      const caps = Object.entries(adapter.supports).filter(([, on]) => on).map(([name]) => name).join(", ") || "typed text only";
      out(`• ${adapter.id} (${adapter.display}) — command: ${adapter.command}; supports: ${caps}\n    ${adapter.notes}`);
    }
  },

  async doctor({ flags }) {
    const ctx = context(flags);
    const adapters = await loadAdapters(ctx.providerDirs);
    const report = await runDoctor({ adapters, templateDirs: ctx.templateDirs, skillDirs: ctx.skillDirs, roleDirs: ctx.roleDirs, providerDirs: ctx.providerDirs });
    if (flags.json) return out(report);
    out(`OS: ${report.os.platform}${report.os.wsl ? " (WSL2)" : ""} · package manager: ${report.os.package_manager ?? "none"} · node ${report.node}`);
    out(`tmux: ${report.tmux ?? "NOT FOUND"}`);
    out("Providers:");
    for (const provider of report.providers) {
      out(`  ${provider.ready ? "✓" : "✗"} ${provider.id} — ${provider.ready ? `${provider.path}${provider.version ? ` (${provider.version})` : ""}` : `not found; ${provider.install_hint}`}`);
    }
    out("Search paths:");
    for (const [label, dirs] of Object.entries(report.dirs)) {
      out(`  ${label}: ${dirs.filter((dir) => dir.exists).map((dir) => dir.dir).join(", ") || "(none exist yet)"}`);
    }
    if (report.problems.length === 0) return out("OK — ready to launch.");
    out("Problems:");
    for (const problem of report.problems) {
      out(`  ! ${problem.message}${problem.fix?.command ? `\n    fix: ${problem.fix.command}` : ""}${problem.fix?.note ? `\n    note: ${problem.fix.note}` : ""}`);
    }
    process.exitCode = 1;
  },

  async runs({ flags }) {
    const ctx = context(flags);
    const root = join(ctx.consumer, AO_HOME, "runs");
    const entries = (await readdir(root).catch(() => [])).sort();
    const runs = [];
    for (const entry of entries) {
      const runFile = join(root, entry, "run.json");
      if (!(await exists(runFile))) continue;
      const run = await readJson(runFile);
      runs.push({ run_id: run.run_id, name: run.name, session: run.session, state: run.state, created: run.created, run_dir: run.run_dir, alive: await tmux.hasSession(run.session) });
    }
    if (flags.json) return out(runs);
    if (runs.length === 0) return out(`No runs under ${root}.`);
    for (const run of runs) out(`${run.alive ? "●" : "○"} ${run.run_id}  ${run.name}  ${run.state}  session=${run.session}\n    ${run.run_dir}`);
  },

  async inputs({ flags }) {
    const ctx = context(flags);
    const { spec, path } = await loadSpec({ template: flags.template, specPath: flags.spec, dirs: ctx.templateDirs });
    const entries = Object.entries(spec.inputs).map(([name, def]) => ({ name, ...def }));
    if (flags.json) return out({ template: spec.name, path, inputs: entries });
    if (entries.length === 0) return out(`${spec.name} takes no inputs.`);
    out(`Inputs for ${spec.name}:`);
    for (const input of entries) {
      out(`\n${input.name}${input.required ? " (required)" : ` (default: ${input.default})`}${input.multi ? " — pick one or more, comma-separated" : ""}\n  ${input.description || "(no description)"}`);
      for (const option of input.options ?? []) out(`    • ${option.value}${option.description ? ` — ${option.description}` : ""}`);
    }
    out(`\nLaunch with: ${CLI_BIN} launch --template ${spec.name}${entries.map((input) => ` --input ${input.name}=<value>`).join("")}`);
  },

  async validate({ flags }) {
    const ctx = context(flags);
    const { spec, path } = await loadSpec({ template: flags.template, specPath: flags.spec, dirs: ctx.templateDirs });
    out({ ok: true, path, spec });
  },

  async compose({ flags }) {
    const ctx = context(flags);
    invariant(flags.spec && flags.spec !== true, "TOPOLOGY_SPEC_REQUIRED", "Pass --spec <file.json> containing the composed spec.");
    const raw = await readJson(absolutize(flags.spec));
    if (flags.name && flags.name !== true) raw.name = flags.name;
    const spec = validateSpec(raw);
    if (!flags.save) return out({ ok: true, saved: null, spec });
    let dir;
    if (flags.save === true || flags.save === "user") dir = join(ctx.home, ".config", "agent-orchestration", "templates");
    else if (flags.save === "consumer") dir = join(ctx.consumer, AO_HOME, "templates");
    else dir = absolutize(flags.save);
    const path = join(dir, `${spec.name}.json`);
    if ((await exists(path)) && !flags.force) fail("TOPOLOGY_TEMPLATE_EXISTS", `Template already exists: ${path}. Pass --force to overwrite.`);
    await writeJson(path, spec);
    out({ ok: true, saved: path, name: spec.name });
  },

  async launch({ flags }) {
    const ctx = context(flags);
    const { spec, path } = await loadSpec({ template: flags.template, specPath: flags.spec, dirs: ctx.templateDirs });
    const inputs = resolveInputs(spec, inputPairs(flags.input));
    const runId = flags["run-id"] && flags["run-id"] !== true ? String(flags["run-id"]) : newRunId();
    // Two deliberate escape hatches, both off unless the operator asks. `--allow-outside` lets a
    // spec resolve a cwd or run_dir outside the invoking repo; `--allow-auto-approve` lets an agent
    // run without its own permission prompts. Neither is inferable from the spec, because the spec
    // is the thing being trusted less.
    const materialized = materializeSpec(spec, {
      runId,
      consumer: ctx.consumer,
      home: ctx.home,
      inputs,
      allowOutside: Boolean(flags["allow-outside"]),
    });
    const adapters = await loadAdapters(ctx.providerDirs);
    const result = await launchRun({
      spec: materialized,
      adapters,
      skillSearchDirs: ctx.skillDirs,
      roleSearchDirs: ctx.roleDirs,
      cliBin: CLI_BIN,
      dryRun: Boolean(flags["dry-run"]),
      allowAutoApprove: Boolean(flags["allow-auto-approve"]),
      log: (line) => process.stderr.write(`${line}\n`),
    });
    result.template = path;
    if (flags.json || flags["dry-run"]) return out(result);
    out(`Launched ${materialized.name} · run ${runId}`);
    out(`  run dir: ${result.runDir}`);
    out(`  session: ${result.session}`);
    for (const agent of result.agents) {
      const fallbacks = agent.attempts.slice(0, -1).map((attempt) => `${attempt.label}: ${attempt.outcome}`).join("; ");
      out(`  ${agent.provider ? (agent.ready ? "✓" : "?") : "✗"} ${agent.id} (${agent.role}) on ${agent.provider ?? "NO PROVIDER"} pane ${agent.pane}${fallbacks ? ` — skipped ${fallbacks}` : ""}`);
    }
    for (const warning of result.warnings) out(`  ! ${warning}`);
    out(`Attach: ${result.attach}`);
  },

  async agent({ flags, positional }) {
    const ctx = context(flags);
    const sub = (positional && positional[0]) || "list";
    if (sub === "new") {
      const role = flags.role && flags.role !== true ? String(flags.role) : "worker";
      const agent = await createAgent(ctx.consumer, {
        role,
        cli: flags.cli && flags.cli !== true ? String(flags.cli) : undefined,
        candidates: flags.candidates && flags.candidates !== true ? String(flags.candidates) : undefined,
        reports_to: flags["reports-to"] && flags["reports-to"] !== true ? String(flags["reports-to"]) : null,
        full_name: flags.name && flags.name !== true ? String(flags.name) : undefined,
        skills: list(flags.skill),
        mcp: list(flags.mcp),
      }, ctx.agentDirs);
      out({ ok: true, agent: displayName(agent), id: agent.id, role: agent.role, dir: agent._dir, reports_to: agent.reports_to });
      return;
    }
    if (sub === "show") {
      const agent = await requireAgent(String(positional[1] || ""), ctx.agentDirs);
      out({ ok: true, agent: displayName(agent), ...agent });
      return;
    }
    const roster = await listAgents(ctx.agentDirs);
    const lead = await findLead(ctx.agentDirs);
    if (flags.json) {
      out({ ok: true, lead: lead ? lead.id : null, agents: roster.map((a) => ({ id: a.id, name: displayName(a), role: a.role, reports_to: a.reports_to })) });
      return;
    }
    // People see names and titles. The id is shown too because this is an operator surface, but the
    // name always leads.
    console.log(`# Agents — ${ctx.consumer}`);
    if (roster.length === 0) console.log("  (none yet — ao-topology agent new --role lead)");
    for (const a of roster) {
      const mark = a.role === "lead" ? "*" : " ";
      console.log(`${mark} ${displayName(a)}${a.reports_to ? `  reports to ${a.reports_to}` : ""}  [${a.id}]`);
    }
  },

  async delegate({ flags }) {
    const ctx = context(flags);
    const local = await requireAgent(String(flags.to && flags.to !== true ? flags.to : ""), ctx.agentDirs);
    const lead = await findLead(ctx.agentDirs);
    const record = await issueDelegation(ctx.consumer, {
      task: flags.task && flags.task !== true ? String(flags.task) : null,
      external_agent: flags.for && flags.for !== true ? String(flags.for) : null,
      local_agent: local.id,
      // The resolved agent, not just its id: the coordinates_only refusal is a fact about the
      // agent, and without the record here it silently never fires.
      agent: local,
      issued_by: lead ? lead.id : null,
    });
    out({ ok: true, token: record.token, task: record.task, to: displayName(local), for: record.external_agent, expires_at: record.expires_at });
  },

  async delegations({ flags }) {
    const ctx = context(flags);
    const all = await listDelegations(ctx.consumer);
    out({ ok: true, delegations: all });
  },

  async send({ flags }) {
    const runDir = await runDirFrom(flags);
    const run = await loadRun(runDir);
    const from = flags.from && flags.from !== true ? String(flags.from) : "operator";
    const stage = flags.stage && flags.stage !== true ? String(flags.stage) : "message";
    invariant(/^[a-z][a-z0-9-]{0,39}$/.test(stage), "TOPOLOGY_STAGE_INVALID", "--stage must be a lowercase slug.");
    const body = await bodyFrom(flags);
    const ctx = context(flags);
    const fromProject = flags["from-project"] && flags["from-project"] !== true ? absolutize(String(flags["from-project"])) : null;
    const task = flags.task && flags.task !== true ? String(flags.task) : null;
    // The receiving repo is the one the RUN belongs to, recorded in run.json at launch — never the
    // caller's cwd. An agent sends from its own agent directory (its cwd is what scopes its memory),
    // and the conductor may send from anywhere; a cwd-derived consumer would silently look for the
    // wrong repo's lead and roster, and routing would then allow everything by finding no lead.
    // An explicit --consumer still wins, for the operator who means it.
    const routingConsumer = flags.consumer && flags.consumer !== true ? ctx.consumer : (run.consumer ?? ctx.consumer);
    // Routing is applied here, at the mailbox, rather than trusted to whoever composed the message.
    const route = fromProject
      ? (args) => routeMessage({ consumer: routingConsumer, pluginRoot: PLUGIN_ROOT, home: ctx.home, ...args })
      : null;
    const message = await sendMessage({ runDir, from, to: list(flags.to), stage, body, contract: flags.contract, round: flags.round, subject: flags.subject, route, fromProject, task });
    const delivered = [];
    if (!flags["no-ring"]) {
      for (const delivery of message.deliveries) {
        const agent = run.agents.find((item) => item.id === delivery.agent);
        if (!agent?.pane) continue;
        const pointer = messagePointer({ id: message.id, from, stage, inbox: delivery.inbox, outbox: delivery.outbox });
        const alive = await tmux.paneAlive(agent.pane);
        if (alive) await tmux.sendText(agent.pane, pointer, agent.submit_keys ?? ["Enter"]);
        delivered.push({ agent: agent.id, pane: agent.pane, rang: alive });
      }
    }
    out({
      ok: true,
      id: message.id,
      deliveries: message.deliveries,
      delivered,
      // A redirect is not an error, but the sender has to be told: it is waiting on an answer from
      // an agent that never received the message.
      redirected: message.redirects.length > 0 ? message.redirects : undefined,
      next: `${CLI_BIN} wait --run ${runDir} --from ${list(flags.to).join(",")} --message ${message.id} --timeout 20m`,
    });
  },

  async wait({ flags }) {
    const runDir = await runDirFrom(flags);
    const timeoutMs = parseDuration(flags.timeout, 20 * 60_000);
    const pollMs = parseDuration(flags.poll, 3000);
    const result = await waitForReplies({
      runDir,
      agentIds: list(flags.from),
      messageId: flags.message && flags.message !== true ? String(flags.message) : undefined,
      timeoutMs,
      pollMs,
      onTick: flags.quiet ? undefined : (pending, elapsed) => process.stderr.write(`waiting ${Math.round(elapsed / 1000)}s — pending: ${pending.map((item) => `${item.agent}:${item.id}`).join(", ")}\n`),
    });
    if (flags.json) return out(result);
    if (!result.ok) {
      out(`TIMEOUT after ${Math.round(result.elapsed_ms / 1000)}s. Still pending:`);
      for (const item of result.pending) out(`  - ${item.agent}: ${item.id} (expected ${item.outbox})`);
      out(`Inspect with: ${CLI_BIN} capture --run ${runDir} --agent <id>`);
      process.exitCode = 2;
      return;
    }
    out(`All replies received in ${Math.round(result.elapsed_ms / 1000)}s.`);
    for (const reply of result.replies) {
      out(`\n===== ${reply.agent} · ${reply.id} · ${reply.path} =====\n${reply.body.trim()}`);
    }
  },

  async reply({ flags }) {
    const runDir = await runDirFrom(flags);
    invariant(flags.agent && flags.agent !== true, "TOPOLOGY_AGENT_REQUIRED", "Pass --agent <id>.");
    invariant(flags.message && flags.message !== true, "TOPOLOGY_MESSAGE_REQUIRED", "Pass --message <id> (the id from the inbox file name, e.g. 003-brief).");
    const body = await bodyFrom(flags);
    const path = await recordReply({ runDir, agentId: String(flags.agent), messageId: String(flags.message), body });
    out({ ok: true, reply: path });
  },

  async capture({ flags }) {
    const runDir = await runDirFrom(flags);
    const run = await loadRun(runDir);
    const agent = run.agents.find((item) => item.id === flags.agent);
    invariant(agent, "TOPOLOGY_UNKNOWN_AGENT", `Unknown agent "${flags.agent}". Agents: ${run.agents.map((item) => item.id).join(", ")}.`);
    const lines = Number(flags.lines) > 0 ? Number(flags.lines) : 60;
    out(await tmux.capture(agent.pane, lines));
  },

  async nudge({ flags }) {
    const runDir = await runDirFrom(flags);
    const run = await loadRun(runDir);
    const agent = run.agents.find((item) => item.id === flags.agent);
    invariant(agent, "TOPOLOGY_UNKNOWN_AGENT", `Unknown agent "${flags.agent}".`);
    invariant(typeof flags.text === "string" && flags.text.trim(), "TOPOLOGY_TEXT_REQUIRED", "Pass --text <text>.");
    await tmux.sendText(agent.pane, flags.text, agent.submit_keys ?? ["Enter"]);
    await appendJournal(runDir, { type: "agent.nudged", agent: agent.id, text: flags.text });
    out({ ok: true, agent: agent.id, pane: agent.pane });
  },

  async failover({ flags }) {
    const runDir = await runDirFrom(flags);
    invariant(flags.agent && flags.agent !== true, "TOPOLOGY_AGENT_REQUIRED", "Pass --agent <id>.");
    const ctx = context(flags);
    const adapters = await loadAdapters(ctx.providerDirs);
    const result = await failoverAgent({ runDir, agentId: String(flags.agent), adapters, toLabel: flags.to && flags.to !== true ? String(flags.to) : undefined, log: (line) => process.stderr.write(`${line}\n`) });
    if (flags.json) return out(result);
    if (!result.ok) {
      out(`${result.agent}: no provider came up. Attempts: ${result.attempts.map((attempt) => `${attempt.label} (${attempt.outcome})`).join("; ")}`);
      process.exitCode = 2;
      return;
    }
    out(`${result.agent}: ${result.from ?? "none"} → ${result.to}${result.ready ? "" : " (not confirmed ready)"}${result.redelivered.length ? `; re-delivered ${result.redelivered.join(", ")}` : ""}`);
  },

  async status({ flags }) {
    const runDir = await runDirFrom(flags);
    const run = await loadRun(runDir);
    const alive = await tmux.hasSession(run.session);
    const panes = alive ? await tmux.listPanes(run.session) : [];
    const pending = await pendingReplies(runDir);
    // Inbox depth per agent. The lead is a bottleneck by design — every unvouched cross-repo
    // contact lands on it — and congestion there raises no error, it just makes everyone slower.
    // Reporting it as a number is the difference between diagnosing that and guessing at it.
    const queues = await queueDepth(runDir);
    const journal = await readJournal(runDir, Number(flags.limit) > 0 ? Number(flags.limit) : 12);
    const agents = run.agents.map((agent) => {
      const pane = panes.find((item) => item.id === agent.pane);
      return {
        id: agent.id,
        role: agent.role,
        provider: agent.provider ?? null,
        chain: (agent.candidates ?? []).map((candidate) => candidate.label),
        adapter: agent.adapter,
        pane: agent.pane,
        alive: Boolean(pane?.alive),
        command: pane?.command ?? null,
        pending: pending.filter((item) => item.agent === agent.id).map((item) => item.id),
        queue: queues.find((q) => q.agent === agent.id) ?? { depth: 0, oldest_age_ms: null, messages: [] },
      };
    });
    const report = { run_id: run.run_id, name: run.name, session: run.session, session_alive: alive, state: run.state, run_dir: runDir, inputs: run.inputs, agents, pending_count: pending.length, queues, recent: journal };
    if (flags.json) return out(report);
    out(`${run.name} · run ${run.run_id} · state ${run.state} · session ${run.session} ${alive ? "(alive)" : "(gone)"}`);
    // A malformed roster is worth saying out loud here: routing redirects against the agent
    // library, so if the library cannot name a single lead, the queue shown below is measuring a
    // different agent than the one messages are actually going to.
    for (const queue of queues) if (queue.lead_error) out(`  ! roster problem: ${queue.lead_error}`);
    for (const agent of agents) out(`  ${agent.alive ? "●" : "○"} ${agent.id} (${agent.role}) on ${agent.provider ?? "NO PROVIDER"} [chain: ${agent.chain.join(" → ")}] pane ${agent.pane}${agent.command ? ` running ${agent.command}` : ""}${agent.pending.length ? ` — queue ${agent.queue.depth}${agent.queue.oldest_age_ms != null ? `, oldest ${Math.round(agent.queue.oldest_age_ms / 1000)}s` : ""}: ${agent.pending.join(", ")}` : ""}`);
    out("Recent journal:");
    for (const event of journal) out(`  ${event.ts ?? ""}  ${event.type}${event.id ? ` ${event.id}` : ""}${event.agent ? ` ${event.agent}` : ""}${event.from ? ` from ${event.from}` : ""}${event.to ? ` to ${[].concat(event.to).join(",")}` : ""}`);
  },

  async journal({ flags }) {
    const runDir = await runDirFrom(flags);
    out(await readJournal(runDir, Number(flags.limit) > 0 ? Number(flags.limit) : 50));
  },

  async stop({ flags }) {
    let session = flags.session && flags.session !== true ? String(flags.session) : null;
    let runDir = null;
    if (flags.run && flags.run !== true) {
      runDir = await runDirFrom(flags);
      const run = await loadRun(runDir);
      session = run.session;
      run.state = "stopped";
      await saveRun(runDir, run);
      await appendJournal(runDir, { type: "run.stopped" });
    }
    invariant(session, "TOPOLOGY_SESSION_REQUIRED", "Pass --run <run_dir> or --session <name>.");
    const existed = await tmux.hasSession(session);
    if (existed) await tmux.killSession(session);
    out({ ok: true, session, killed: existed, run_dir: runDir, files_kept: true });
  },
};

async function main() {
  // `ao-topology ... | head` must not crash with EPIPE.
  process.stdout.on("error", (error) => {
    if (error.code === "EPIPE") process.exit(0);
    throw error;
  });
  const { flags, positional } = parseArgs(process.argv.slice(2));
  const name = positional[0] ?? (flags.help ? "help" : "help");
  const command = commands[name];
  if (!command) {
    process.stderr.write(`Unknown command "${name}".\n\n${USAGE}`);
    process.exitCode = 64;
    return;
  }
  try {
    await command({ flags, positional: positional.slice(1) });
  } catch (error) {
    if (error instanceof TopologyError) {
      if (flags.json) out({ ok: false, code: error.code, message: error.message, details: error.details });
      else process.stderr.write(`error ${error.code}: ${error.message}\n`);
      process.exitCode = 1;
      return;
    }
    throw error;
  }
}

await main();
