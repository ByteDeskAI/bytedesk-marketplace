#!/usr/bin/env node
// ao-topology: launch and conduct tmux-hosted multi-agent orchestrations from a declarative spec.
// Zero dependencies; runs from an installed plugin cache. Skills drive this CLI; agents call
// `reply`; the conductor calls `send`, `wait`, `capture`, and `status`.
import { readFile, readdir } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { doctor as runDoctor, tmuxInstallPlan } from "./lib/doctor.mjs";
import { launchRun, messagePointer } from "./lib/launch.mjs";
import { appendJournal, loadRun, pendingReplies, readJournal, recordReply, saveRun, sendMessage, waitForReplies } from "./lib/mailbox.mjs";
import { adapterSummary, loadAdapters, providerDirs } from "./lib/providers.mjs";
import { roleDirs, skillDirs } from "./lib/resolve.mjs";
import { listTemplates, loadSpec, materializeSpec, resolveInputs, specSchemaSummary, templateDirs, validateSpec } from "./lib/spec.mjs";
import * as tmux from "./lib/tmux.mjs";
import { TopologyError, absolutize, exists, fail, invariant, newRunId, parseArgs, parseDuration, readJson, writeJson } from "./lib/util.mjs";

const PLUGIN_ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const CLI_BIN = process.env.AO_TOPOLOGY_BIN || join(PLUGIN_ROOT, "bin", "ao-topology");

const USAGE = `ao-topology — tmux-hosted multi-agent orchestration

Discover
  templates [--consumer <dir>]                 list orchestration templates
  schema                                       print the spec schema summary
  providers [--json]                           list provider adapters
  doctor [--json] [--consumer <dir>]           check tmux, CLIs, and search paths
  runs [--consumer <dir>]                      list runs under <consumer>/.orchestration/runs

Compose
  validate (--spec <file> | --template <name>) validate a spec and print the normalized form
  compose --spec <file> [--save user|consumer|<dir>] [--name <slug>]
                                               validate and save a spec as a template

Launch and stop
  launch (--template <name> | --spec <file>) [--consumer <dir>] [--input k=v]... [--run-id <id>]
         [--dry-run] [--json]
  stop (--run <run_dir> | --session <name>) [--keep-files]
  status --run <run_dir> [--json]
  journal --run <run_dir> [--limit 50]

Conduct (used by the orchestrator agent)
  send --run <run_dir> --from <id> --to <id>[,<id>] --stage <slug> (--file <md> | --body <text>)
       [--contract <name>] [--round <n>] [--subject <text>] [--no-ring]
  wait --run <run_dir> [--from <id>[,<id>]] [--message <id>] [--timeout 20m] [--poll 3s] [--json]
  capture --run <run_dir> --agent <id> [--lines 60]
  nudge --run <run_dir> --agent <id> --text <text>

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
  for (const item of list(value)) {
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
    const root = join(ctx.consumer, ".orchestration", "runs");
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
    else if (flags.save === "consumer") dir = join(ctx.consumer, ".orchestration", "templates");
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
    const materialized = materializeSpec(spec, { runId, consumer: ctx.consumer, home: ctx.home, inputs });
    const adapters = await loadAdapters(ctx.providerDirs);
    const result = await launchRun({
      spec: materialized,
      adapters,
      skillSearchDirs: ctx.skillDirs,
      roleSearchDirs: ctx.roleDirs,
      cliBin: CLI_BIN,
      dryRun: Boolean(flags["dry-run"]),
      log: (line) => process.stderr.write(`${line}\n`),
    });
    result.template = path;
    if (flags.json || flags["dry-run"]) return out(result);
    out(`Launched ${materialized.name} · run ${runId}`);
    out(`  run dir: ${result.runDir}`);
    out(`  session: ${result.session}`);
    for (const agent of result.agents) out(`  ${agent.ready ? "✓" : "?"} ${agent.id} (${agent.role}, ${agent.adapter}) pane ${agent.pane}`);
    for (const warning of result.warnings) out(`  ! ${warning}`);
    out(`Attach: ${result.attach}`);
  },

  async send({ flags }) {
    const runDir = await runDirFrom(flags);
    const run = await loadRun(runDir);
    const from = flags.from && flags.from !== true ? String(flags.from) : "operator";
    const stage = flags.stage && flags.stage !== true ? String(flags.stage) : "message";
    invariant(/^[a-z][a-z0-9-]{0,39}$/.test(stage), "TOPOLOGY_STAGE_INVALID", "--stage must be a lowercase slug.");
    const body = await bodyFrom(flags);
    const message = await sendMessage({ runDir, from, to: list(flags.to), stage, body, contract: flags.contract, round: flags.round, subject: flags.subject });
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
    out({ ok: true, id: message.id, deliveries: message.deliveries, delivered, next: `${CLI_BIN} wait --run ${runDir} --from ${list(flags.to).join(",")} --message ${message.id} --timeout 20m` });
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

  async status({ flags }) {
    const runDir = await runDirFrom(flags);
    const run = await loadRun(runDir);
    const alive = await tmux.hasSession(run.session);
    const panes = alive ? await tmux.listPanes(run.session) : [];
    const pending = await pendingReplies(runDir);
    const journal = await readJournal(runDir, Number(flags.limit) > 0 ? Number(flags.limit) : 12);
    const agents = run.agents.map((agent) => {
      const pane = panes.find((item) => item.id === agent.pane);
      return { id: agent.id, role: agent.role, adapter: agent.adapter, pane: agent.pane, alive: Boolean(pane?.alive), command: pane?.command ?? null, pending: pending.filter((item) => item.agent === agent.id).map((item) => item.id) };
    });
    const report = { run_id: run.run_id, name: run.name, session: run.session, session_alive: alive, state: run.state, run_dir: runDir, inputs: run.inputs, agents, pending_count: pending.length, recent: journal };
    if (flags.json) return out(report);
    out(`${run.name} · run ${run.run_id} · state ${run.state} · session ${run.session} ${alive ? "(alive)" : "(gone)"}`);
    for (const agent of agents) out(`  ${agent.alive ? "●" : "○"} ${agent.id} (${agent.role}, ${agent.adapter}) pane ${agent.pane}${agent.command ? ` running ${agent.command}` : ""}${agent.pending.length ? ` — pending: ${agent.pending.join(", ")}` : ""}`);
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
