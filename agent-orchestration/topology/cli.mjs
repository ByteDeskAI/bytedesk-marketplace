#!/usr/bin/env node
// ao-topology: launch and conduct tmux-hosted multi-agent orchestrations from a declarative spec.
// Zero dependencies; runs from an installed plugin cache. Skills drive this CLI; agents call
// `reply`; the conductor calls `send`, `wait`, `capture`, and `status`.
import { readFile, readdir } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { doctor as runDoctor, tmuxInstallPlan } from "./lib/doctor.mjs";
import { closeAllClients, isUndelivered, ringMessage, undeliveredReport } from "./lib/delivery.mjs";
import { deliverPointer, failoverAgent, launchRun, messagePointer, openRoleSession, registeredLeadId, roleSessionName, runAgentVisual, tmuxFailureTrigger, uniqueSessionName } from "./lib/launch.mjs";
import { agentDir, appendJournal, loadRun, pendingReplies, queueDepth, readJournal, recordReply, saveRun, sendMessage, waitForReplies } from "./lib/mailbox.mjs";
import { adapterFor, adapterSummary, buildArgv, loadAdapters, providerDirs } from "./lib/providers.mjs";
import { roleDirs, skillDirs } from "./lib/resolve.mjs";
import { agentAddress, DEFAULT_SESSION, listWorkflows, loadSpec, materializeSpec, resolveInputs, specSchemaSummary, workflowDirs, validateSpec } from "./lib/spec.mjs";
import * as tmux from "./lib/tmux.mjs";
import { TopologyError, absolutize, exists, fail, invariant, newRunId, parseArgs, parseDuration, readJson, terminalText, writeJson, AO_HOME } from "./lib/util.mjs";
import { agentDirs, agentsRoot, createAgent, findLead, listAgents, requireAgent } from "./lib/agents.mjs";
import { displayName, parseSessionName, roleVisual } from "./lib/identity.mjs";
import { childrenFile } from "./lib/lineage.mjs";
import { issueDelegation, listDelegations, routeMessage } from "./lib/routing.mjs";
import { sameIncarnation } from "./lib/incarnation.mjs";
import { stateRoot } from "./lib/repoid.mjs";

const PLUGIN_ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const CLI_BIN = process.env.AO_TOPOLOGY_BIN || join(PLUGIN_ROOT, "bin", "ao-topology");

const USAGE = `ao-topology — tmux-hosted multi-agent orchestration

Discover
  workflows [--consumer <dir>]                 list orchestration workflows
  schema                                       print the spec schema summary
  providers [--json]                           list provider adapters
  doctor [--json] [--consumer <dir>]           check tmux, CLIs, and search paths
  runs [--consumer <dir>]                      list runs under <consumer>/.bytedesk/agent-orchestration/runs
  observer targets|start|open|status|inspect|watch|report|close
           [--observer <id> --target <id> | --run <run_dir>]
           [--ack-timeout 30s]                     prompt proof deadline; env AO_OBSERVER_ACK_TIMEOUT_MS

Compose
  inputs (--workflow <name> | --spec <file>)   show a workflow's inputs, options, and defaults
  validate (--spec <file> | --workflow <name>) validate a spec and print the normalized form
  compose --spec <file> [--save user|consumer|<dir>] [--name <slug>]
                                               validate and save a spec as a workflow

Launch and stop
  launch (--workflow <name> | --spec <file>) [--consumer <dir>] [--input k=v]... [--run-id <id>]
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

  session open <id|"Full Name">                open this agent's durable session, or reattach to it
  session list [--json]                        which of this repo's agents are live right now
  session close <id|"Full Name">               end it; the agent and its directory survive
  delegate --task <id> --to <agent> [--for <external-agent>]
                                               open a direct channel to one of your agents
  delegations [--json]                         open delegations in this repo

  send --run <run_dir> --from <id> --to <id>[,<id>] --stage <slug> (--file <md> | --body <text>)
       [--to @run|@repo|@role:<role>|@idle]    audiences, unioned by the same comma; [--max-recipients <n>]
       [--from-project <dir>] [--task <id>]    routed: an outsider reaches the lead unless delegated
       [--via <id>[,<id>]]                     hops already taken; forwarding must pass the chain on
       [--contract <name>] [--round <n>] [--subject <text>] [--no-ring]
  wait --run <run_dir> [--from <id>[,<id>]] [--message <id>] [--timeout 20m] [--poll 3s] [--json]
  ack --run <run_dir> --agent <id> --message <id> [--note <text>]
                                               optional receipt; no state depends on it
  capture --run <run_dir> --agent <id> [--lines 60]
  nudge --run <run_dir> --agent <id> --text <text>
  failover --run <run_dir> --agent <id> [--to <cli:model>]
       [--incident <id> --approved-by <who>]   restart the agent on the next provider in its chain and
                                               re-deliver its unanswered messages. With --incident it
                                               spends failover.consent: ask needs --approved-by, auto
                                               is consent given in advance in config, never refuses.

Reply (used by every agent)
  reply --run <run_dir> --agent <id> --message <id> (--file <md> | --body <text>)

Standing repository services
  supervise [--once --server <socket>]          reconcile presence, prompts and held mail
  census [--json] [--watch]                     what every agent in this repo is doing right now:
                                                working / needs-input / idle / attention /
                                                quota-blocked / dead / unknown
  slot request <name> --reason <text> [--expect 30m] | release <name> | status [<name>]
       grant <name> --to <agent>                LEAD-ONLY override that jumps the queue; the
                                                ordinary handover is mechanical and needs no verb
  lead status|ensure|assign <agent>|detach|probes|ack <nonce>
  reviewer status|ensure|request|collect|eligible [--task TM-id --revision <sha> --author <id>]
  role list|show <role>|status <role>|assign <role> [<agent>]|ensure <role> [<agent>]
       |reassign <role> [<agent>] [--force]|detach <role> [<agent>] [--kill]|history <role>
                                               lead, reviewer, worker, designer, image-gen
  prompt preview|refresh|watch|ack <agent> [--revision <hash> --nonce <nonce>]
  startup pending|watch|hooks|install-hooks|uninstall-hooks [--provider <id> --server <name>]
  startup-check --source hook|manual
  enrollment request --pending-key <key> --agent <id> [--consumer <repo>]
  enrollment ack --pending-key <key> --nonce <nonce> [--agent <id>]
  presence publish|watch [--server <socket> --dir <presence-directory>]
  mailbox send|forward|inbox|outbox|resume [--agent <id> --from-project <dir> --to <id> --id <stable-id>]
  manage status|admit|report|eligible|integrate|cleanup --task <TM-id> [--file <protocol.json>]
  manage assign|assignment|release --task <TM-id> [--agent <id>] [--prompt-file <path>]
  quota status [--agent <id>] [--json] | resolve --agent <id> --state applied|declined|closed
                                               provider quota incidents raised by the supervise tick.
                                               Detection writes the incident; it restarts nothing.

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
  const extraWorkflows = [...list(flags["workflows-dir"]), ...list(flags["templates-dir"])].map((dir) => absolutize(dir));
  const extraSkills = list(flags["skills-dir"]).map((dir) => absolutize(dir));
  const extraRoles = list(flags["roles-dir"]).map((dir) => absolutize(dir));
  const extraProviders = list(flags["providers-dir"]).map((dir) => absolutize(dir));
  const unique = (dirs) => [...new Set(dirs.map((dir) => resolve(dir)))];
  return {
    consumer,
    home,
    pluginRoot: PLUGIN_ROOT,
    workflowDirs: unique(workflowDirs({ pluginRoot: PLUGIN_ROOT, consumer, home, extra: extraWorkflows })),
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

/** TM-185: the icon for a library agent, with the repository's registered lead resolved once. */
async function libraryVisuals(ctx) {
  const leadId = await registeredLeadId({ consumer: ctx.consumer, home: ctx.home });
  return (agent) => roleVisual({ role: agent.role, repoRole: agent.id === leadId ? "lead" : null });
}

/**
 * Refuse a pane operation on a workflow participant, and say where to look instead.
 *
 * capture, nudge and failover are all questions about a PROCESS — what is on its screen, type this
 * at it, restart it on another provider. A participant is a team in another run, so none of them
 * have an answer here; the honest response names the run where they do. Without this, capture
 * returned silence, nudge leaked `can't find pane: null` from tmux, and failover reported "no
 * provider left after none. Chain: ." — three different ways of not saying "that is a team".
 */
function refuseIfParticipant(agent, verb) {
  invariant(
    !agent?.workflow,
    "TOPOLOGY_AGENT_IS_A_WORKFLOW",
    `${agent?.id} is a workflow participant running "${agent?.workflow?.name}", not a pane, so there is nothing to ${verb}. Its own run is at ${agent?.workflow?.run_dir ?? "(not launched)"} — try \`status --run ${agent?.workflow?.run_dir ?? "<child run dir>"}\`.`,
  );
}

/**
 * What a participant's child run is actually doing, for the parent's `status`.
 *
 * A participant has no pane, so every column `status` prints about a process is empty for it — the
 * first cut rendered a perfectly healthy team as "on NO PROVIDER [chain: ] pane null", which reads
 * as a broken agent. What the operator wants at the parent level is the one line they would get by
 * running `status` in the child: is its session up, what state is it in, and is anything queued
 * there. Best-effort throughout: a child whose run.json has been deleted is reported as gone rather
 * than crashing the parent's status.
 */
async function childSummary(runDir) {
  try {
    const run = await loadRun(runDir);
    const alive = await tmux.hasSession(run.session);
    const pending = await pendingReplies(runDir).catch(() => []);
    return { state: run.state, session_alive: alive, agents: run.agents?.length ?? 0, pending: pending.length };
  } catch {
    return { state: "unreadable", session_alive: false, agents: 0, pending: 0 };
  }
}

/**
 * Stop every run beneath this one, depth-first.
 *
 * Depth-first because stopping top-down orphans every level below the one that fails: kill the
 * parent's session first and a grandchild is still running with nothing left that names it. From the
 * bottom up, a failure leaves a smaller mess, and one that `children.json` can still describe.
 *
 * Every step is best effort. A child whose directory has been deleted, or whose session a human
 * already killed, is not a reason to abandon the rest of the tree — the point of cascading is that
 * one unreachable node does not strand its siblings.
 */
async function stopChildren(runDir, stopped, seen = new Set()) {
  if (seen.has(runDir)) return stopped;
  seen.add(runDir);
  const children = await readJson(childrenFile(runDir)).catch(() => null);
  if (!Array.isArray(children)) return stopped;
  for (const child of children) {
    if (!child?.run_dir) continue;
    await stopChildren(child.run_dir, stopped, seen);
    try {
      const run = await loadRun(child.run_dir);
      if (run.state !== "stopped") {
        run.state = "stopped";
        await saveRun(child.run_dir, run);
        await appendJournal(child.run_dir, { type: "run.stopped", by: "parent cascade" });
      }
      if (await tmux.hasSession(run.session)) await tmux.killSession(run.session);
      await appendJournal(runDir, { type: "run.child_exited", child_run_id: run.run_id, child_run_dir: child.run_dir, reason: "stopped with its parent" });
      stopped.push({ run_id: run.run_id, run_dir: child.run_dir, session: run.session });
    } catch {
      /* a child we cannot read is one we cannot stop; the siblings still get their turn */
    }
  }
  return stopped;
}

/**
 * The workflow named on the command line: `--workflow` is the flag, `--template` is what it used to
 * be called. Both resolve, undocumented on the old side — a rename that breaks every script and
 * SKILL.md in every consuming repo is not a rename, it is an outage with a changelog entry.
 */
function nameFrom(flags) {
  const value = flags.workflow ?? flags.template;
  return value && value !== true ? String(value) : undefined;
}

/**
 * Claude hosts start the supervisor as a plugin monitor (`monitors/monitors.json`). Codex, Grok and
 * Kimi have no monitor concept at all, so the ordinary verbs self-start it too: first command wins,
 * and both routes converge on the same per-repo supervision lock. Idempotent — a live pid
 * short-circuits in microseconds — and deliberately NEVER fatal: a repo with no supervisor
 * publishes stale presence, which is a degraded repo, not a failed command.
 */
async function ensureSupervision(ctx) {
  try {
    const { startRepositorySupervision } = await import('./lib/supervision.mjs');
    return await startRepositorySupervision(ctx);
  } catch (error) {
    return { started: false, error: error.message };
  }
}

const commands = {
  async supervise({ flags }) {
    const { superviseRepository } = await import('./lib/supervision.mjs');
    const ctx = context(flags);
    // Linked worktrees share one canonical repository id, so a machine with N worktrees of this
    // repo open starts N supervisors and N-1 of them MUST lose. Losing is the correct outcome and
    // therefore not an error: exit 0 saying who owns it, so a monitor host does not read the loss
    // as a crash and restart it in a loop.
    const owned = async (task) => {
      try { return await task(); }
      catch (error) {
        if (error?.code !== 'TOPOLOGY_LOCK_TIMEOUT') throw error;
        return out({ ok: true, supervising: false, reason: 'another-supervisor-owns-this-repository', consumer: ctx.consumer });
      }
    };
    if (flags.once) return owned(() => superviseRepository({ ...ctx, tmuxServer: flags.server }, { once: true, onTick: out }));
    const { watchServer } = await import('./lib/startup.mjs');
    // A one-shot `supervise --once` above is a human asking a question, so it always answers. The
    // DAEMON is not: it ticks every 2-15s forever, and streaming each report to stdout puts a
    // multi-line JSON blob in every console hosting this monitor. The presence document is already
    // the durable record of a heartbeat — a reader wanting per-tick detail passes --json.
    // Exceptions still speak: retirement and a degraded heartbeat are invisible in any other place.
    const notable = report => report?.stopped || report?.presence_beats_degraded || report?.error;
    const onTick = flags.json ? out : report => { if (notable(report)) out(report); };
    return Promise.all([owned(() => superviseRepository({ ...ctx, tmuxServer: flags.server }, { onTick })), watchServer({ ...ctx, tmuxServer: flags.server || 'default' })]);
  },

  async census({ flags }) {
    const ctx = context(flags);
    const { readCensus, takeCensus, formatCensus } = await import('./lib/census.mjs');
    // The ladder belongs to the loop owner, so --watch borrows the SUPERVISOR's, rather than
    // census.mjs keeping a second copy of the same three numbers.
    const { nextRung, SLEEP_LADDER_MS } = await import('./lib/supervision.mjs');
    const { canonicalRepoId } = await import('./lib/repoid.mjs');
    const { collectPresenceAgents } = await import('./lib/presence.mjs');
    const identity = await canonicalRepoId(ctx.consumer);
    // `census` is a repo-scoped verb, so it self-starts the supervisor like every other one:
    // asking what the agents are doing is exactly the moment you want the tick back after a
    // reboot. `ensureSupervision` is idempotent — a live pid short-circuits in microseconds — and
    // never fatal, which is the right trade here: a census with no supervisor is a one-shot
    // answer, not a failed command.
    const supervision = await ensureSupervision(ctx);
    const memo = new Map();
    const observe = async (previous) => {
      // Prefer the supervisor's document: ONE answer to "is this agent alive" per repo. Only when
      // it is missing or stale does the CLI take its own — a stale document is not a cheap read,
      // it is a wrong one.
      const published = await readCensus({ ...ctx, identity });
      if (published && !published.stale) return published;
      let panes = [];
      const listPanesFn = async (args) => { const rows = await (await import('./lib/tmux.mjs')).listServerPanes(args); panes.push(...rows); return rows; };
      let agents = [];
      try { agents = await collectPresenceAgents({ ...ctx, identity, tmuxServer: flags.server, listPanesFn }); }
      catch (error) { if (error?.code !== 'TOPOLOGY_TMUX_OBSERVATION_FAILED') throw error; panes = null; }
      const adapters = await loadAdapters(ctx.providerDirs).catch(() => null);
      // A one-shot has no loop behind it, so it takes census.mjs's own conservative fallbacks
      // (15 s / 45 s) rather than inventing a cadence it is not running at.
      return takeCensus({ ...ctx, identity }, { agents, panes, adapters, memo, previous });
    };
    if (!flags.watch) {
      const document = await observe(null);
      return out(flags.json ? { ...document, supervision } : formatCensus(document));
    }
    // --watch rides the supervisor's own 2/5/15 ladder: 2 s while anything is moving, 15 s while
    // nothing is. A watcher that polls at a fixed 1 s is the busy loop this phase removed.
    let previous = null, rung = -1;
    for (;;) {
      previous = await observe(previous);
      out(flags.json ? previous : formatCensus(previous));
      rung = nextRung(rung, previous.activity);
      await new Promise((resolve) => setTimeout(resolve, SLEEP_LADDER_MS[rung]));
    }
  },

  async slot({ flags, positional }) {
    // TM-132. The only verbs here are request / release / status / grant. There is deliberately no
    // "wait for my turn": the grant is mechanical, so the supervise tick hands the slot over with
    // zero model turns on either side, and `status` is how you see that it happened.
    const ctx = context(flags);
    const api = await import('./lib/slots.mjs');
    const sub = positional[0] || 'status';
    const name = positional[1];
    const say = (view) => out(flags.json ? view : api.formatSlot(view));
    if (sub === 'status') {
      const view = await api.slotStatus({ ...ctx, name: name ?? null });
      return out(flags.json ? view : (view.slots ? view.slots.map(api.formatSlot).join('\n') || 'no slots in this repository' : api.formatSlot(view)));
    }
    if (sub === 'request') {
      const view = await api.requestSlot({ ...ctx, name,
        agentId: flags.agent && flags.agent !== true ? String(flags.agent) : process.env.AO_AGENT_ID,
        reason: flags.reason && flags.reason !== true ? String(flags.reason) : null,
        expectMs: flags.expect && flags.expect !== true ? parseDuration(String(flags.expect)) : null,
        runDir: flags.run && flags.run !== true ? absolutize(String(flags.run)) : null });
      await api.notifyGrants(view.events, ctx);
      return say(view);
    }
    if (sub === 'release') {
      const view = await api.releaseSlot({ ...ctx, name,
        agentId: flags.agent && flags.agent !== true ? String(flags.agent) : process.env.AO_AGENT_ID,
        runDir: flags.run && flags.run !== true ? absolutize(String(flags.run)) : null });
      return say(view);
    }
    if (sub === 'grant') {
      const view = await api.grantSlot({ ...ctx, name, to: flags.to && flags.to !== true ? String(flags.to) : null });
      await api.notifyGrants(view.events, ctx);
      return say(view);
    }
    fail('TOPOLOGY_SUBCOMMAND_UNKNOWN', 'Use slot request|release|status|grant.');
  },

  async presence({ flags, positional }) {
    const ctx = context(flags), api = await import('./lib/presence.mjs');
    const options = { ...ctx, presenceDir: flags.dir, tmuxServer: flags.server };
    if (positional[0] === 'watch') return api.watchPresence({ ...options, onPublish: out });
    invariant(!positional[0] || positional[0] === 'publish', 'TOPOLOGY_SUBCOMMAND_UNKNOWN', 'Use presence publish|watch.');
    return out(await api.publishPresence(options));
  },
  async mailbox({ flags, positional }) {
    const ctx = context(flags), api = await import('./lib/standing-mailbox.mjs');
    const sub = positional[0] || 'inbox';
    if (sub === 'resume') return out(await api.resumeStandingMessages(ctx));
    if (sub === 'reply') return out(await api.recordStandingReply({ ...ctx, messageId: flags.message, agentId: flags.agent || process.env.AO_AGENT_ID, body: await bodyFrom(flags) }));
    if (sub === 'inbox' || sub === 'outbox') return out(await api[sub === 'inbox' ? 'readStandingInbox' : 'readStandingOutbox']({ ...ctx, agent: flags.agent || process.env.AO_AGENT_ID }));
    const input = { consumer: ctx.consumer, fromProject: flags['from-project'] || process.env.AO_CONSUMER,
      from: flags.from || process.env.AO_AGENT_ID, to: flags.to, id: flags.id, body: await bodyFrom(flags),
      task: flags.task, stage: flags.stage, subject: flags.subject, provenance: { source: 'ao-topology CLI' }, via: list(flags.via) };
    if (sub === 'send') return out(await api.sendStandingMessage(input, ctx));
    if (sub === 'forward') return out(await api.forwardStandingMessage({ ...input, parentId: flags.parent }, ctx));
    fail('TOPOLOGY_SUBCOMMAND_UNKNOWN', 'Use mailbox send|forward|inbox|outbox|resume.');
  },
  async enrollment({ flags, positional }) {
    const sub = positional[0];
    invariant(sub === 'request' || sub === 'ack', 'TOPOLOGY_SUBCOMMAND_UNKNOWN', 'Use enrollment request|ack.');
    const ctx = context({ ...flags, consumer: flags.consumer || process.env.AO_CONSUMER });
    const pendingKey = flags['pending-key'];
    invariant(typeof pendingKey === 'string' && pendingKey, 'TOPOLOGY_ENROLLMENT_KEY', 'Pass --pending-key from startup pending.');
    const agentRef = flags.agent || (sub === 'ack' ? process.env.AO_AGENT_ID : undefined);
    invariant(typeof agentRef === 'string' && agentRef, 'TOPOLOGY_ENROLLMENT_AGENT', 'Pass --agent with the repository library identity.');
    const api = await import('./lib/enrollment.mjs');
    const options = { ...ctx, pendingKey, agentRef };
    if (sub === 'request') return out(await api.requestEnrollment(options));
    invariant(typeof flags.nonce === 'string' && flags.nonce, 'TOPOLOGY_ENROLLMENT_ACK', 'Pass the challenge --nonce from the assigned session.');
    const result = await api.acknowledgeEnrollment({ ...options, nonce: flags.nonce });
    const { startRepositorySupervision } = await import('./lib/supervision.mjs');
    return out({ ...result, supervision: await startRepositorySupervision(ctx) });
  },
  async reviewer({ flags, positional }) {
    const ctx = context(flags), api = await import('./lib/reviewer.mjs');
    const options = { ...ctx, task: flags.task, revision: flags.revision, authorAgentIds: list(flags.author) };
    const sub = positional[0] || 'status';
    if (sub === 'status') return out(await api.reviewerAvailability(options));
    if (sub === 'ensure') return out(await api.ensureReviewer({ ...options, notAgentIds: options.authorAgentIds }));
    if (sub === 'request') return out(await api.requestReview(options));
    if (sub === 'collect') return out(await api.collectReview(options));
    if (sub === 'eligible') return out(await api.reviewEligibility(options));
    if (sub === 'ack') return out(await api.reviewerNonceAck({ ...options, nonce: positional[1] }));
    fail('TOPOLOGY_SUBCOMMAND_UNKNOWN', 'Use reviewer status|ensure|request|collect|eligible|ack.');
  },
  async manage({ flags, positional }) {
    const ctx = context(flags), api = await import('./lib/management.mjs');
    const supplied = flags.file ? await readJson(absolutize(flags.file)) : {};
    const options = { ...supplied, ...ctx, task: flags.task || supplied.task, owner: process.env.TM_SESSION_ID || process.env.AO_AGENT_ID,
      // TM-135 idle dispatch. `agent` PINS a candidate; omitted, arbitration picks one under its own lock.
      agent: flags.agent || supplied.agent || null, promptFile: flags['prompt-file'] || supplied.promptFile || null, reason: flags.reason || supplied.reason || null };
    const methods = { status:'managementStatus', bind:'bindTaskWorker', admit:'admitTask', report:'workerReport', eligible:'integrationEligibility', integrate:'integrateTask', cleanup:'cleanupTask',
      assign:'assignTaskToAgent', assignment:'assignmentResult', release:'releaseAssignment' };
    const method = methods[positional[0] || 'status'];
    invariant(method, 'TOPOLOGY_SUBCOMMAND_UNKNOWN', 'Use manage status|admit|report|eligible|integrate|cleanup|assign|assignment|release.');
    return out(await api[method](options));
  },
  async 'startup-check'({ flags }) {
    const ctx = context(flags);
    const { startupCheck } = await import('./lib/startup.mjs');
    const result=await startupCheck({ ...ctx, source: String(flags.source || 'manual'), agentId: process.env.AO_AGENT_ID, session: process.env.AO_SESSION, pane: process.env.TMUX_PANE });
    if(result.readiness.state === 'blocked') process.exitCode=2;
    return out(result);
  },
  async startup({ flags, positional }) {
    const ctx = context(flags), api = await import('./lib/startup.mjs');
    const sub = positional[0] || 'pending';
    if (sub === 'pending') return out(await api.pendingEnrollments(ctx));
    if (sub === 'watch') return out(await api.watchServer({ ...ctx, once: flags.once === true, tmuxServer: flags.server || 'default' }));
    const adapter = (await loadAdapters(ctx.providerDirs)).get(String(flags.provider || 'claude'));
    invariant(adapter, 'TOPOLOGY_PROVIDER_UNKNOWN', 'Unknown provider.');
    if (sub === 'install-hooks') return out(await api.installHooks({ ...ctx, adapter, cliBin: join(PLUGIN_ROOT, 'bin', 'ao-topology') }));
    if (sub === 'uninstall-hooks') return out(await api.uninstallHooks({ ...ctx, adapter }));
    if (sub === 'hooks') return out(await api.hooksStatus({ ...ctx, adapter }));
    fail('TOPOLOGY_SUBCOMMAND_UNKNOWN', 'Use startup pending|watch|hooks|install-hooks|uninstall-hooks.');
  },
  async lead({ flags, positional }) {
    const ctx = context(flags);
    const api = await import('./lib/lead.mjs');
    const sub = positional[0] || 'status';
    // TM-161. `|| 5000` here is why the late-ack fix did nothing on a live pane: the CLI passed an
    // EXPLICIT five seconds on every call, so `lead.mjs`'s DEFAULT_ACK_TIMEOUT_MS — raised to 30s
    // and made env-configurable by TM-157 precisely because a probe has to fit a MODEL TURN — was
    // never consulted. The probe's `expires_at` was five seconds away, so it was expired before the
    // agent's next turn boundary, and the ack it then ran correctly was refused as stale.
    //
    // Measured on a live pane: the probe file appeared and was gone within about five seconds
    // against what should have been a 150s window, and three consecutive asks read `unresponsive`.
    //
    // Omit the key when the flag is absent, so the library default applies. A fix that raises a
    // default is worthless while a caller hardcodes past it — this is the third time in this epic
    // that a change reached one of two callers, and it is now written down in
    // `.claude/rules/verification-that-can-fail.md`.
    const options = { ...ctx, ...(flags['ack-timeout'] ? { ackTimeoutMs: Number(flags['ack-timeout']) } : {}) };
    if (sub === 'status') return out(await api.leadState(options));
    if (sub === 'probes') return out(await api.pendingLeadProbes(options));
    // `ensureSupervision`, NOT startRepositorySupervision: `role assign|ensure lead` is the same
    // operation through the other surface and degrades, so these must too. Two surfaces onto one
    // operation must not disagree about whether a repo that cannot start a supervisor is a
    // degraded repo or a failed command. tests/unit/topology-supervision-consistency.test.mjs
    // drives both and compares.
    if (sub === 'ensure') {
      const result = await api.ensureLead(options);
      return out({ ...result, supervision: await ensureSupervision(ctx) });
    }
    if (sub === 'assign') {
      const result = await api.assignLead({ ...options, agentRef: positional[1], session: flags.session });
      return out({ ...result, supervision: await ensureSupervision(ctx) });
    }
    if (sub === 'detach') return out(await api.detachLead({ ...options, kill: flags.kill === true }));
    if (sub === 'ack') return out(await api.leadNonceAck({ ...options, nonce: positional[1] }));
    fail('TOPOLOGY_SUBCOMMAND_UNKNOWN', 'Use lead status|ensure|assign|detach|ack.');
  },
  async role({ flags, positional }) {
    // One surface over lead.mjs and reviewer.mjs; roles.mjs does the dispatch, so this stays a
    // parameter map. `role status` prints registered/alive/responsive as three separate fields —
    // do not collapse them into one tick when rendering non-JSON output later.
    const ctx = context(flags);
    const { roleCommand } = await import('./lib/roles.mjs');
    const verb = positional[0] || 'list';
    const result = await roleCommand({
      ...ctx,
      verb,
      role: positional[1],
      agentRef: positional[2] ?? (flags.agent && flags.agent !== true ? String(flags.agent) : null),
      session: flags.session && flags.session !== true ? String(flags.session) : null,
      notAgentIds: list(flags.author),
      runDir: flags.run && flags.run !== true ? absolutize(String(flags.run)) : null,
      force: flags.force === true,
      kill: flags.kill === true,
      limit: Number(flags.limit || 0),
      // TM-161: same reason as `lead` above — let the library default apply unless asked.
      ...(flags['ack-timeout'] ? { ackTimeoutMs: Number(flags['ack-timeout']) } : {}),
    });
    // A verb that leaves the repo with a standing holder starts supervision, exactly as
    // `lead ensure` and `lead assign` do — two surfaces onto the same operation must not differ on
    // whether presence gets published afterwards. Read-only verbs and `detach` do not.
    return out(['assign', 'ensure', 'reassign'].includes(verb)
      ? { ...result, supervision: await ensureSupervision(ctx) }
      : result);
  },
  async prompt({ flags, positional }) {
    const ctx = context(flags);
    let agent, promptSession, recordedBinding = null;
    if (flags.run) {
      const runDir = await runDirFrom(flags), run = await loadRun(runDir);
      const entry = run.agents.find(a => a.id === positional[1]);
      invariant(entry, 'TOPOLOGY_UNKNOWN_AGENT', 'Agent is not in this workflow run.');
      invariant(run.consumer, 'TOPOLOGY_RUN_CONSUMER_REQUIRED', 'Workflow prompt composition requires its recorded repository.');
      const dir = join(runDir, 'agents', entry.id);
      const definition = await readJson(join(dir, 'prompt-agent.json'));
      agent = { ...entry, ...definition, id: entry.id, _dir: dir };
      recordedBinding = entry.binding ?? null;
      ctx.consumer = run.consumer;
      promptSession = run.session;
    } else {
      agent = await requireAgent(positional[1], ctx.agentDirs);
      const record = await readJson(join(agent._dir, 'session.json')).catch(() => null);
      recordedBinding = record?.binding ?? null;
    }
    const api = await import('./lib/prompt-lifecycle.mjs');
    if (positional[0] === 'preview') {
      const { composePrompt } = await import('./lib/prompts.mjs');
      const { loadConfig } = await import('./lib/config.mjs');
      return out(await composePrompt({ ...ctx, agent, dir: agent._dir, loaded: await loadConfig(ctx), templateName: agent.template }));
    }
    const panes = await tmux.listServerPanes(recordedBinding?.serverKey ? { tmuxServer: recordedBinding.serverKey } : {}).catch(() => []);
    const currentBinding = panes.find(p => p.paneId === process.env.TMUX_PANE && (!recordedBinding || sameIncarnation(p, recordedBinding))) ?? null;
    const expectedSession = promptSession || roleSessionName(agent.id);
    if (positional[0] === 'ack') return out(await api.acknowledgePrompt({ agent, revision: flags.revision, nonce: flags.nonce, binding: currentBinding, consumer: ctx.consumer, session: expectedSession }));
    if (positional[0] === 'watch') return api.watchPrompts({ ...ctx, agent }, { onChange: out });
    invariant(positional[0] === 'refresh', 'TOPOLOGY_SUBCOMMAND_UNKNOWN', 'Use prompt preview|refresh|ack|watch.');
    return out(await api.refreshPrompt({ ...ctx, agent, session: expectedSession, live: await tmux.hasSession(expectedSession), safeBoundary: flags['safe-boundary'] === true, binding: recordedBinding }));
  },
  async help() {
    out(USAGE);
  },

  async schema() {
    out(specSchemaSummary());
  },

  async workflows({ flags }) {
    const ctx = context(flags);
    const workflows = await listWorkflows(ctx.workflowDirs);
    if (flags.json) return out({ searched: ctx.workflowDirs, workflows, templates: workflows });
    if (workflows.length === 0) return out(`No workflows found. Searched:\n- ${ctx.workflowDirs.join("\n- ")}`);
    for (const workflow of workflows) {
      out(workflow.error ? `✗ ${workflow.name}  (${workflow.path}) — ${workflow.error.split("\n")[0]}` : `• ${workflow.name} — ${workflow.description || "(no description)"}\n    agents: ${workflow.agents.join(", ")}\n    ${workflow.path}`);
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
    const report = await runDoctor({ adapters, workflowDirs: ctx.workflowDirs, skillDirs: ctx.skillDirs, roleDirs: ctx.roleDirs, providerDirs: ctx.providerDirs, consumer: ctx.consumer, env: ctx.env, home: ctx.home });
    if (flags.json) return out(report);
    out(`OS: ${report.os.platform}${report.os.wsl ? " (WSL2)" : ""} · package manager: ${report.os.package_manager ?? "none"} · node ${report.node}`);
    out(`tmux: ${report.tmux ?? "NOT FOUND"}`);
    if (report.supervision) {
      const s = report.supervision;
      const age = s.tick_age_ms === null ? "no tick yet" : `last tick ${Math.round(s.tick_age_ms / 1000)}s ago`;
      out(`Supervisor: ${s.state}${s.pid ? ` pid ${s.pid}` : ""} · ${age}${s.restarts ? ` · ${s.restarts} restarts` : ""}`);
    }
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

  async observer({ flags, positional }) {
    const ctx = context(flags);
    const api = await import('./lib/observer.mjs');
    const sub = positional[0] || 'targets';
    const observerId = flags.observer && flags.observer !== true ? String(flags.observer) : process.env.AO_AGENT_ID || 'observer';
    const options = { ...ctx, observerId };
    if (sub === 'targets') return out({ ok: true, targets: await api.discoverObserverTargets(ctx) });
    if (sub === 'open' || sub === 'start') {
      const { observerAckTimeout } = await import('./lib/observer-session.mjs');
      if ((!flags.run || flags.run === true) && (!flags.target || flags.target === true)) {
        const targets = await api.discoverObserverTargets(ctx);
        if (process.stdin.isTTY && targets.length === 1) flags.target = targets[0].id;
        else return out({ ok: false, code: 'TOPOLOGY_OBSERVER_SELECTION', message: 'Select one target and rerun with --target <id>.', targets });
      }
      return out({ ok: true, ...await api.openObserver({ ...options,
        runDir: flags.run && flags.run !== true ? absolutize(String(flags.run)) : null,
        target: flags.target && flags.target !== true ? String(flags.target) : null,
        timeoutMs: observerAckTimeout({ ackTimeout: flags['ack-timeout'], legacyTimeout: flags.timeout, env: process.env }) }) });
    }
    if (sub === 'status') return out({ ok: true, ...await api.observerStatus(options) });
    if (sub === 'inspect') return out({ ok: true, ...await api.inspectObservedRun(options) });
    if (sub === 'watch') return api.watchObservedRun(options, { once: flags.once === true,
      intervalMs: flags.interval && flags.interval !== true ? parseDuration(String(flags.interval)) : 5000,
      onTick: value => out({ ok: true, ...value }) });
    if (sub === 'report') {
      const { sendStandingMessage } = await import('./lib/standing-mailbox.mjs');
      return out({ ok: true, ...await api.reportFinding(String(flags.finding || ''), { ...options,
        affectedConsumer: flags['affected-consumer'] ? absolutize(String(flags['affected-consumer'])) : ctx.consumer,
        affectedLead: flags['affected-lead'],
        marketplaceConsumer: flags['marketplace-consumer'] ? absolutize(String(flags['marketplace-consumer'])) : null,
        marketplaceLead: flags['marketplace-lead'],
        send: (input) => sendStandingMessage(input, ctx),
      }) });
    }
    if (sub === 'close') return out({ ok: true, ...await api.closeObserver(options) });
    fail('TOPOLOGY_SUBCOMMAND_UNKNOWN', 'Use observer targets|start|open|status|inspect|watch|report|close.');
  },

  async inputs({ flags }) {
    const ctx = context(flags);
    const { spec, path } = await loadSpec({ workflow: nameFrom(flags), specPath: flags.spec, dirs: ctx.workflowDirs });
    const entries = Object.entries(spec.inputs).map(([name, def]) => ({ name, ...def }));
    if (flags.json) return out({ template: spec.name, path, inputs: entries });
    if (entries.length === 0) return out(`${spec.name} takes no inputs.`);
    out(`Inputs for ${spec.name}:`);
    for (const input of entries) {
      out(`\n${input.name}${input.required ? " (required)" : ` (default: ${input.default})`}${input.multi ? " — pick one or more, comma-separated" : ""}\n  ${input.description || "(no description)"}`);
      for (const option of input.options ?? []) out(`    • ${option.value}${option.description ? ` — ${option.description}` : ""}`);
    }
    out(`\nLaunch with: ${CLI_BIN} launch --workflow ${spec.name}${entries.map((input) => ` --input ${input.name}=<value>`).join("")}`);
  },

  async validate({ flags }) {
    const ctx = context(flags);
    const { spec, path } = await loadSpec({ workflow: nameFrom(flags), specPath: flags.spec, dirs: ctx.workflowDirs });
    // A deprecated key is not a problem — the spec is valid and will run — so it is reported rather
    // than raised. Silently accepting it is how a rename never finishes.
    for (const note of spec.deprecations ?? []) process.stderr.write(`deprecated: ${note}\n`);
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
    if (flags.save === true || flags.save === "user") dir = join(ctx.home, ".config", "agent-orchestration", "workflows");
    else if (flags.save === "consumer") dir = join(ctx.consumer, AO_HOME, "workflows");
    else dir = absolutize(flags.save);
    const path = join(dir, `${spec.name}.json`);
    if ((await exists(path)) && !flags.force) fail("TOPOLOGY_TEMPLATE_EXISTS", `A workflow by that name already exists: ${path}. Pass --force to overwrite.`);
    await writeJson(path, spec);
    out({ ok: true, saved: path, name: spec.name });
  },

  async launch({ flags }) {
    const ctx = context(flags);
    const { spec, path } = await loadSpec({ workflow: nameFrom(flags), specPath: flags.spec, dirs: ctx.workflowDirs });
    // How a workflow participant becomes a real run. The launcher knows how to start a set of panes;
    // it does not know how to find a workflow by name, resolve its inputs, or build the adapter and
    // skill search paths — that context lives here, so the recursion is handed down as a function
    // rather than reimplemented one layer lower.
    const launchChild = async ({ workflow, inputs: childInputs, lineage: childLineage, replyToken }) => {
      const child = await loadSpec({ workflow, dirs: ctx.workflowDirs });
      const childRunId = newRunId();
      const materializedChild = materializeSpec(child.spec, {
        runId: childRunId,
        consumer: ctx.consumer,
        home: ctx.home,
        inputs: resolveInputs(child.spec, childInputs),
        allowOutside: Boolean(flags["allow-outside"]),
        ...(flags["max-fanout"] && flags["max-fanout"] !== true ? { maxFanout: Number(flags["max-fanout"]) } : {}),
      });
      const result = await launchRun({
        spec: materializedChild,
        adapters: await loadAdapters(ctx.providerDirs),
        skillSearchDirs: ctx.skillDirs,
        roleSearchDirs: ctx.roleDirs,
        cliBin: CLI_BIN,
        allowAutoApprove: Boolean(flags["allow-auto-approve"]),
        ...(flags["max-depth"] && flags["max-depth"] !== true ? { maxDepth: Number(flags["max-depth"]) } : {}),
        lineage: childLineage,
        replyToken,
        launchChild,
        log: (line) => process.stderr.write(`${line}\n`),
      });
      return { ...result, conductor: (materializedChild.agents.find((agent) => agent.role === "orchestrator") ?? {}).id ?? null };
    };
    const inputs = resolveInputs(spec, inputPairs(flags.input));
    const runId = flags["run-id"] && flags["run-id"] !== true ? String(flags["run-id"]) : newRunId();
    // Two deliberate escape hatches, both off unless the operator asks. `--allow-outside` lets a
    // spec resolve a cwd or run_dir outside the invoking repo; `--allow-auto-approve` lets an agent
    // run without its own permission prompts. Neither is inferable from the spec, because the spec
    // is the thing being trusted less.
    // Address the session by WHO when the run is a spawn of one known agent, and by what-and-when
    // otherwise. Only when the spec did not name a session itself — a spec that states its own name
    // is stating a requirement, and guessing over it would break whoever is reading that name.
    // The discriminator's uniqueness scope is live sessions on this host, which is the scope tmux
    // itself enforces, so `uniqueSessionName` probes rather than trusting the entropy.
    const address = spec.session === DEFAULT_SESSION
      ? agentAddress(spec, { consumer: ctx.consumer, home: ctx.home, agentDirs: ctx.agentDirs })
      : null;
    const materialized = materializeSpec(spec, {
      runId,
      consumer: ctx.consumer,
      home: ctx.home,
      inputs,
      allowOutside: Boolean(flags["allow-outside"]),
      ...(flags["max-fanout"] && flags["max-fanout"] !== true ? { maxFanout: Number(flags["max-fanout"]) } : {}),
      session: address ? await uniqueSessionName(address) : undefined,
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
      ...(flags["max-depth"] && flags["max-depth"] !== true ? { maxDepth: Number(flags["max-depth"]) } : {}),
      launchChild,
      log: (line) => process.stderr.write(`${line}\n`),
    });
    result.template = path;
    if (!flags["dry-run"]) result.supervision = await ensureSupervision(ctx);
    if (flags.json || flags["dry-run"]) return out(result);
    out(`Launched ${materialized.name} · run ${runId}`);
    out(`  run dir: ${result.runDir}`);
    out(`  session: ${result.session}`);
    for (const agent of result.agents) {
      const fallbacks = agent.attempts.slice(0, -1).map((attempt) => `${attempt.label}: ${attempt.outcome}`).join("; ");
      out(`  ${agent.provider ? (agent.ready ? "✓" : "?") : "✗"} ${agent.roleIcon} ${agent.id} (${terminalText(agent.role)}) on ${agent.provider ?? "NO PROVIDER"} pane ${agent.pane}${fallbacks ? ` — skipped ${fallbacks}` : ""}`);
    }
    for (const warning of result.warnings) out(`  ! ${warning}`);
    out(`Attach: ${result.attach}`);
  },

  async agent({ flags, positional }) {
    const ctx = context(flags);
    const sub = (positional && positional[0]) || "list";
    if (sub === "new") {
      const { loadConfig, findTemplate } = await import('./lib/config.mjs');
      const loaded = await loadConfig(ctx);
      invariant(!loaded.errors.length, 'TOPOLOGY_CONFIG_INVALID', 'Agent configuration is invalid.', { errors: loaded.errors });
      const found = flags.template ? findTemplate(loaded.layers, String(flags.template)) : null;
      invariant(!flags.template || found, 'TOPOLOGY_TEMPLATE_MISSING', 'Requested template is not configured.');
      const template = found?.template || {};
      const role = flags.role && flags.role !== true ? String(flags.role) : template.role || "worker";
      const agent = await createAgent(ctx.consumer, {
        ...template, template: found?.name,
        role,
        cli: flags.cli && flags.cli !== true ? String(flags.cli) : template.cli,
        candidates: flags.candidates && flags.candidates !== true ? String(flags.candidates) : undefined,
        reports_to: flags["reports-to"] && flags["reports-to"] !== true ? String(flags["reports-to"]) : null,
        full_name: flags.name && flags.name !== true ? String(flags.name) : undefined,
        skills: flags.skill ? list(flags.skill) : template.skills,
        mcp: flags.mcp ? list(flags.mcp) : template.mcp,
      }, ctx.agentDirs, ctx);
      out({ ok: true, agent: displayName(agent), id: agent.id, role: agent.role, ...roleVisual({ role: agent.role }), dir: agent._dir, reports_to: agent.reports_to });
      return;
    }
    if (sub === "show") {
      const agent = await requireAgent(String(positional[1] || ""), ctx.agentDirs);
      out({ ok: true, agent: displayName(agent), ...agent, ...roleVisual({ role: agent.role }) });
      return;
    }
    const roster = await listAgents(ctx.agentDirs);
    const lead = await findLead(ctx.agentDirs);
    const visualOf = await libraryVisuals(ctx);
    if (flags.json) {
      out({ ok: true, lead: lead ? lead.id : null, agents: roster.map((a) => ({ id: a.id, name: displayName(a), role: a.role, ...visualOf(a), reports_to: a.reports_to })) });
      return;
    }
    // People see names and titles. The id is shown too because this is an operator surface, but the
    // name always leads.
    console.log(`# Agents — ${ctx.consumer}`);
    if (roster.length === 0) console.log("  (none yet — ao-topology agent new --role lead)");
    for (const a of roster) {
      const mark = a.role === "lead" ? "*" : " ";
      console.log(`${mark} ${visualOf(a).roleIcon} ${terminalText(displayName(a))}${a.reports_to ? `  reports to ${terminalText(a.reports_to)}` : ""}  [${a.id}]`);
    }
  },

  /**
   * Durable, project-bound sessions — the counterpart to `launch`. A run is spawned, worked and torn
   * down; a role-session is a named workspace you CALL, keyed to the agent's stable id, that
   * outlives this process. `open` on a live session reattaches rather than creating a second one,
   * which is what makes the identity durable rather than merely repeatable.
   */
  async session({ flags, positional }) {
    const ctx = context(flags);
    const sub = (positional && positional[0]) || "list";

    if (sub === "list") {
      const roster = await listAgents(ctx.agentDirs);
      const visualOf = await libraryVisuals(ctx);
      // Two kinds of session, and the difference is the point. A role-session is the agent's one
      // durable workspace, named `ao-<id>`, and opening it again reattaches. A spawn is one run of
      // that agent, named `<id>-<spawn>`, and there may be several at once. Stable agent, distinct
      // spawns: `who` is the id, `which run` is the discriminator.
      const live = await tmux.listSessions();
      const spawnsFor = new Map();
      for (const name of live) {
        const parsed = parseSessionName(name);
        if (!parsed) continue;
        if (!spawnsFor.has(parsed.agentId)) spawnsFor.set(parsed.agentId, []);
        spawnsFor.get(parsed.agentId).push({ session: name, spawn: parsed.spawn });
      }
      const rows = roster.map((agent) => ({
        id: agent.id,
        agent: displayName(agent),
        role: agent.role,
        ...visualOf(agent),
        session: roleSessionName(agent.id),
        live: live.includes(roleSessionName(agent.id)),
        spawns: (spawnsFor.get(agent.id) ?? []).sort((a, b) => a.spawn.localeCompare(b.spawn)),
      }));
      // A spawn whose agent is not in this repo's roster still belongs to someone; saying so beats
      // pretending it is not there, because it is holding a tmux session either way.
      const orphans = [...spawnsFor].filter(([id]) => !roster.some((agent) => agent.id === id))
        .flatMap(([id, spawns]) => spawns.map((entry) => ({ ...entry, agent_id: id, ...roleVisual({}) })));
      if (flags.json) return out({ ok: true, sessions: rows, unknown_agent_spawns: orphans });
      console.log(`# Sessions — ${ctx.consumer}`);
      if (rows.length === 0) console.log("  (no agents yet — ao-topology agent new --role lead)");
      for (const row of rows) {
        console.log(`${row.live ? "*" : " "} ${row.roleIcon} ${terminalText(row.agent)}  ${row.live ? row.session : "(no role-session)"}  [${row.id}]`);
        for (const entry of row.spawns) console.log(`    spawn ${entry.spawn}  ${entry.session}`);
      }
      for (const entry of orphans) console.log(`  ? ${entry.roleIcon} ${terminalText(entry.session)}  (spawn of ${terminalText(entry.agent_id)}, not in this roster)`);
      return;
    }

    const ref = String(positional[1] || (flags.agent && flags.agent !== true ? flags.agent : "") || "");
    invariant(ref, "TOPOLOGY_AGENT_REQUIRED", `Name the agent: ao-topology session ${sub} <id|"Full Name">.`);
    const agent = await requireAgent(ref, ctx.agentDirs);

    if (sub === "close") {
      const session = roleSessionName(agent.id);
      const live = await tmux.hasSession(session);
      if (live) await tmux.killSession(session);
      // The record and the agent directory are deliberately left behind: closing a session ends a
      // conversation, it does not retire the agent, and `open` must rebuild the same workspace.
      return out({ ok: true, agent: displayName(agent), session, closed: live });
    }

    invariant(sub === "open", "TOPOLOGY_SUBCOMMAND_UNKNOWN", `Unknown: session ${sub}. Use open, list, or close.`);
    const adapters = await loadAdapters(ctx.providerDirs);
    const adapter = adapterFor(agent, adapters);
    const session = roleSessionName(agent.id);
    // The session's cwd is the agent's own directory — that is what gives it memory of its own under
    // every shipped CLI. The repo is therefore granted explicitly, exactly as `launch` does it, and
    // a coordinator is granted nothing beyond its own directory.
    const addDirs = agent.role === 'observer' ? [stateRoot(process.env, ctx.home)] : agent.coordinates_only === true ? [] : [ctx.consumer];
    const vars = {
      session,
      agent_id: agent.id,
      agent_role: agent.role,
      bootstrap_file: join(agent._dir, "prompt.md"),
      system_prompt: `You are ${displayName(agent)} (id "${agent.id}", role: ${agent.role}), the standing ${agent.role} for ${ctx.consumer}. Read ${join(agent._dir, "prompt.md")} and follow it.`,
    };
    const { refreshPrompt } = await import('./lib/prompt-lifecycle.mjs');
    const prompt = await refreshPrompt({ ...ctx, agent, session, live: await tmux.hasSession(session) });
    invariant(prompt.status !== 'invalid-config', 'TOPOLOGY_PROMPT_INVALID', 'Prompt invalid; existing session preserved.');
    const argv = buildArgv(adapter, { ...agent, add_dirs: addDirs }, vars);
    const result = await openRoleSession({
      agentsDir: dirname(agent._dir),
      agentId: agent.id,
      adapter,
      argv,
      env: { AO_AGENT_ID: agent.id, AO_AGENT_ROLE: agent.role, AO_SESSION: session, AO_CONSUMER: ctx.consumer, ...agent.env },
      role: agent.role,
      coordinatesOnly: agent.coordinates_only === true,
      controlledRestart: flags.restart === true,
      log: flags.json ? () => {} : (line) => console.error(`  ${line}`),
    });
    out({
      ok: true,
      agent: displayName(agent),
      id: agent.id,
      ...roleVisual({ role: agent.role }),
      supervision: await ensureSupervision(ctx),
      session: result.session,
      pane: result.pane,
      created: result.created,
      reattached: result.reattached,
      cwd: result.record?.cwd ?? join(dirname(agent._dir), agent.id),
      attach: tmux.attachCommand(result.session),
    });
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
    const from = flags.from && flags.from !== true ? String(flags.from) : process.env.AO_AGENT_ID || "operator";
    const stage = flags.stage && flags.stage !== true ? String(flags.stage) : "message";
    invariant(/^[a-z][a-z0-9-]{0,39}$/.test(stage), "TOPOLOGY_STAGE_INVALID", "--stage must be a lowercase slug.");
    const body = await bodyFrom(flags);
    const ctx = context(flags);
    const fromProject = flags["from-project"] && flags["from-project"] !== true ? absolutize(String(flags["from-project"])) : process.env.AO_CONSUMER || null;
    const task = flags.task && flags.task !== true ? String(flags.task) : null;
    // The receiving repo is the one the RUN belongs to, recorded in run.json at launch — never the
    // caller's cwd. An agent sends from its own agent directory (its cwd is what scopes its memory),
    // and the conductor may send from anywhere; a cwd-derived consumer would silently look for the
    // wrong repo's lead and roster, and routing would then allow everything by finding no lead.
    // An explicit --consumer supplies context only for legacy runs lacking it.
    const routingConsumer = run.consumer || (flags.consumer && flags.consumer !== true ? ctx.consumer : null);
    // Routing is applied here, at the mailbox, rather than trusted to whoever composed the message.
    const route = fromProject && routingConsumer
      ? (args) => routeMessage({ consumer: routingConsumer, pluginRoot: PLUGIN_ROOT, home: ctx.home, ...args })
      : null;
    // The via chain travels with the message and is what stops re-forwarding and lead-to-lead
    // ping-pong. Without a way to pass it, a forwarding agent starts every hop from an empty chain
    // and the hop limit can never be reached — the guard would be wired and still never fire.
    const via = list(flags.via);
    // `--max-recipients` mirrors `--max-fanout`, and is the ONLY addressing knob the CLI owns:
    // expansion itself happens inside sendMessage, never here, so no caller can address a room
    // without passing through admission.
    const maxRecipients = flags["max-recipients"] && flags["max-recipients"] !== true ? { maxRecipients: Number(flags["max-recipients"]) } : {};
    const message = await sendMessage({ runDir, from, to: list(flags.to), stage, body, contract: flags.contract, round: flags.round, subject: flags.subject, route, fromProject, task, via, idempotencyKey: flags.id, consumer: flags.consumer && flags.consumer !== true ? ctx.consumer : undefined, standingOptions: { pluginRoot: PLUGIN_ROOT, home: ctx.home }, addressing: maxRecipients });
    // `--no-ring` has been in USAGE, in tests/live/two-projects.sh and in
    // tests/contract/topology-tmux.test.mjs since this command was written, and was never
    // implemented in this body — the flag parsed and did nothing.
    const noRing = flags["no-ring"] === true || String(flags["no-ring"]) === "true";
    const adapters = await loadAdapters(ctx.providerDirs);
    const delivered = [];
    const { forwardMessageToWorkflow } = await import('./lib/mailbox.mjs');

    // TM-127 disabled the bell on the correct observation that "pane liveness proves neither an
    // empty composer nor a safe tool-input state" — but the result was that every send reported
    // { rang: false, notification: 'durable-pending' }, so an idle agent was never woken at all.
    // The answer is not to re-enable the guess: `ringMessage` OBSERVES the composer through the
    // adapter's measured `composer` block, and an adapter without one still holds and reports.
    const ring = async ({ agentEntry, agentId, pointer, session, runDirForState, messageId }) => {
      const adapter = adapters.get(agentEntry?.adapter ?? "") ?? adapters.get(agentEntry?.cli ?? "");
      if (!adapter) {
        return { agent: agentId, rang: false, notification: 'durable-pending',
          delivery: { state: 'held', ring_capability: 'unsupported', reason: `no adapter recorded for ${agentId}`, escalated: false } };
      }
      return ringMessage({
        runDir: runDirForState, agentId, agent: agentEntry, adapter, pointer, messageId,
        session, noRing, deliverPointer, tmuxFailureTrigger,
        log: (line) => process.stderr.write(`${line}\n`),
      });
    };

    try {
      for (const delivery of message.deliveries) {
        const agent = run.agents.find((item) => item.id === delivery.agent);
        if (agent?.workflow?.run_dir) {
          const forwarded = await forwardMessageToWorkflow({ runDir, messageId: message.id,
            recipient: delivery.agent, standingOptions: { pluginRoot: PLUGIN_ROOT, home: ctx.home } });
          // The child's conductor is the one that has to wake up, in the CHILD session. Same bell,
          // no new path: "a message reaches a terminal state on every transport, or a human is told
          // which one it is stuck on and why."
          const childRun = await loadRun(agent.workflow.run_dir).catch(() => null);
          const conductor = childRun?.agents?.find((item) => item.id === agent.workflow.conductor) ?? null;
          const rung = conductor
            ? await ring({
                agentEntry: conductor, agentId: conductor.id, session: childRun.session,
                runDirForState: agent.workflow.run_dir, messageId: forwarded.id,
                pointer: messagePointer({ id: forwarded.id, from, stage, inbox: join(agentDir(agent.workflow.run_dir, conductor.id), "inbox"), outbox: join(agentDir(agent.workflow.run_dir, conductor.id), "outbox") }),
              })
            : { rang: false, notification: 'durable-pending', delivery: null };
          delivered.push({ agent: agent.id, workflow: agent.workflow.name, forwarded_as: forwarded.id,
            run_dir: agent.workflow.run_dir, holds: forwarded.holds,
            rang: rung.rang, notification: rung.notification, delivery: rung.delivery });
          continue;
        }
        // A standing (cross-repo) delivery does not carry `inbox`/`outbox` back from `sendMessage` —
        // `standing-mailbox.mjs` owns those paths. The pointer then names the command that reads it,
        // which is true and useful; surfacing the real path means threading it out of
        // `sendStandingMessage`, which is a change to a frozen-adjacent surface and not this one.
        const pointer = delivery.inbox
          ? messagePointer({ id: message.id, from, stage, inbox: delivery.inbox, outbox: delivery.outbox })
          : `[ao] Message ${message.id} from ${from} (${stage}): read it with ${CLI_BIN} mailbox inbox --agent ${delivery.agent}, then reply.`;
        const rung = await ring({
          agentEntry: agent, agentId: delivery.agent, pointer,
          session: run.session, runDirForState: runDir, messageId: message.id,
        });
        delivered.push({ agent: delivery.agent, standing: Boolean(delivery.standing),
          rang: rung.rang, notification: rung.notification, delivery: rung.delivery });
      }
    } finally {
      // One control client per session, refcounted — a fan-out `--to a,b,c` costs one tmux client,
      // not three — but the process must not be held open by it.
      closeAllClients();
    }

    out({
      ok: true,
      id: message.id,
      // The receiving repo is the run's, never the caller's cwd — same reasoning as routingConsumer.
      supervision: await ensureSupervision({ ...ctx, consumer: routingConsumer || ctx.consumer }),
      deliveries: message.deliveries,
      holds: message.holds,
      delivered,
      // A redirect is not an error, but the sender has to be told: it is waiting on an answer from
      // an agent that never received the message.
      redirected: message.redirects.length > 0 ? message.redirects : undefined,
      next: `${CLI_BIN} wait --run ${runDir} --from ${list(flags.to).join(",")} --message ${message.id} --timeout 20m`,
    });
    // Exit 3 ONLY when the pane was judged safe and the pointer still did not land. Never for
    // `held` (nothing was typed, so nothing is wrong with the pane), never for an adapter with no
    // measured composer, never for `--no-ring`, and never for a degraded supervisor — that is
    // reported in `supervision` above and is not a delivery failure. `isUndelivered` is that rule
    // in one place.
    if (delivered.some((item) => isUndelivered(item.delivery))) process.exitCode = 3;
  },

  async ack({ flags }) {
    // Optional, and deliberately load-bearing for nothing: engagement is a pane.log byte offset, so
    // no state in the delivery machine depends on an agent remembering to call this. Useful to a
    // human or a hook that wants a receipt in the journal.
    const runDir = await runDirFrom(flags);
    const agentId = String(flags.agent && flags.agent !== true ? flags.agent : process.env.AO_AGENT_ID || "");
    const messageId = String(flags.message && flags.message !== true ? flags.message : "");
    invariant(agentId && messageId, "TOPOLOGY_ACK_INVALID", "Pass --agent <id> and --message <id>.");
    await appendJournal(runDir, { type: "message.acked", id: messageId, agent: agentId, note: flags.note && flags.note !== true ? String(flags.note) : null });
    out({ ok: true, id: messageId, agent: agentId });
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
    // `--token` was named in recordReply's own refusal text and never wired, so an agent following
    // that advice got the same refusal again. It is required now anyway: a child workflow's
    // conductor already holds AO_AGENT_TOKEN for its OWN run, so answering upward as a participant
    // in its parent needs the other token passed explicitly.
    const token = flags.token && flags.token !== true ? String(flags.token) : undefined;
    const path = await recordReply({ runDir, agentId: String(flags.agent), messageId: String(flags.message), body, ...(token ? { token } : {}) });
    out({ ok: true, reply: path });
  },

  async capture({ flags }) {
    const runDir = await runDirFrom(flags);
    const run = await loadRun(runDir);
    const agent = run.agents.find((item) => item.id === flags.agent);
    invariant(agent, "TOPOLOGY_UNKNOWN_AGENT", `Unknown agent "${flags.agent}". Agents: ${run.agents.map((item) => item.id).join(", ")}.`);
    refuseIfParticipant(agent, "capture");
    const lines = Number(flags.lines) > 0 ? Number(flags.lines) : 60;
    out(await tmux.capture(agent.pane, lines));
  },

  async nudge({ flags }) {
    const runDir = await runDirFrom(flags);
    const run = await loadRun(runDir);
    const agent = run.agents.find((item) => item.id === flags.agent);
    invariant(agent, "TOPOLOGY_UNKNOWN_AGENT", `Unknown agent "${flags.agent}".`);
    refuseIfParticipant(agent, "nudge — send it a message instead");
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
    const result = await failoverAgent({ runDir, agentId: String(flags.agent), adapters,
      toLabel: flags.to && flags.to !== true ? String(flags.to) : undefined,
      // TM-135: an incident is the OBSERVATION a failover answers, and --approved-by is who said
      // yes. Neither is required for the manual path — an operator at a keyboard is already the
      // human turn the consent gate exists to demand.
      incidentId: flags.incident && flags.incident !== true ? String(flags.incident) : null,
      approvedBy: flags["approved-by"] && flags["approved-by"] !== true ? String(flags["approved-by"]) : null,
      consumer: ctx.consumer, home: ctx.home, pluginRoot: ctx.pluginRoot,
      log: (line) => process.stderr.write(`${line}\n`) });
    if (flags.json) return out(result);
    if (!result.ok) {
      out(`${result.agent}: no provider came up. Attempts: ${result.attempts.map((attempt) => `${attempt.label} (${attempt.outcome})`).join("; ")}`);
      process.exitCode = 2;
      return;
    }
    out(`${result.agent}: ${result.from ?? "none"} → ${result.to}${result.ready ? "" : " (not confirmed ready)"}${result.redelivered.length ? `; re-delivered ${result.redelivered.join(", ")}` : ""}`);
    if (result.incident) out(`  incident ${result.incident} closed as applied, authorised by ${result.approved_by}; the lead was told (${result.announced ?? "not delivered"}).`);
    if (result.pending.length) out(`  ${result.pending.length} unanswered message(s) are being re-delivered — the new provider has a different memory, so it will read as cold. That is expected.`);
  },

  /**
   * Provider quota incidents. Read-only by default: this verb never fails anything over, because
   * detection and takeover are deliberately two acts. `ao-topology failover --incident <id>` is
   * the second one.
   */
  async quota({ flags, positional }) {
    const ctx = context(flags);
    const { listIncidents, readIncident, resolveIncident, approvalCommand } = await import("./lib/quota.mjs");
    const verb = positional[0] ?? "status";
    if (verb === "resolve") {
      invariant(flags.agent && flags.agent !== true, "TOPOLOGY_AGENT_REQUIRED", "Pass --agent <id>.");
      invariant(flags.state && flags.state !== true, "TOPOLOGY_QUOTA_STATE", "Pass --state applied|declined|closed.");
      return out(await resolveIncident({ consumer: ctx.consumer, home: ctx.home, agentId: String(flags.agent), state: String(flags.state),
        by: flags["approved-by"] && flags["approved-by"] !== true ? String(flags["approved-by"]) : null,
        note: flags.note && flags.note !== true ? String(flags.note) : null }));
    }
    invariant(verb === "status", "TOPOLOGY_SUBCOMMAND_UNKNOWN", "Use quota status|resolve.");
    const rows = flags.agent && flags.agent !== true
      ? [await readIncident({ consumer: ctx.consumer, home: ctx.home, agentId: String(flags.agent) })].filter(Boolean)
      : await listIncidents({ consumer: ctx.consumer, home: ctx.home });
    if (flags.json) return out({ incidents: rows });
    if (rows.length === 0) return out("No provider quota incidents recorded for this repository.");
    for (const row of rows) {
      out(`${row.state === "open" ? "!" : "-"} ${row.agent_id.padEnd(24)} ${String(row.provider).padEnd(10)} ${row.state.padEnd(9)} /${row.pattern}/ (${row.evidence}) ${row.detected_at}`);
      const command = approvalCommand({ incident: row });
      if (row.state === "open") out(`    ${command ?? "not in a run roster; change a standing agent's provider with `role reassign`"}`);
    }
  },

  async status({ flags }) {
    const runDir = await runDirFrom(flags);
    const run = await loadRun(runDir);
    const leadId = await registeredLeadId({ consumer: run.consumer, home: homedir() });
    const alive = await tmux.hasSession(run.session);
    const panes = alive ? await tmux.listPanes(run.session) : [];
    const pending = await pendingReplies(runDir);
    // Inbox depth per agent. The lead is a bottleneck by design — every unvouched cross-repo
    // contact lands on it — and congestion there raises no error, it just makes everyone slower.
    // Reporting it as a number is the difference between diagnosing that and guessing at it.
    const queues = await queueDepth(runDir);
    const journal = await readJournal(runDir, Number(flags.limit) > 0 ? Number(flags.limit) : 12);
    const agents = [];
    for (const agent of run.agents) {
      const pane = panes.find((item) => item.id === agent.pane);
      const entry = {
        id: agent.id,
        role: agent.role,
        // Recomputed from the role, never echoed from run.json (older files lack it; agents can write it).
        ...runAgentVisual(agent, leadId),
        provider: agent.provider ?? null,
        chain: (agent.candidates ?? []).map((candidate) => candidate.label),
        adapter: agent.adapter,
        pane: agent.pane,
        alive: Boolean(pane?.alive),
        command: pane?.command ?? null,
        pending: pending.filter((item) => item.agent === agent.id).map((item) => item.id),
        queue: queues.find((q) => q.agent === agent.id) ?? { depth: 0, oldest_age_ms: null, messages: [] },
      };
      // A participant is a whole run, so its liveness is its child session's, not a pane's.
      if (agent.workflow?.run_dir) {
        entry.workflow = { ...agent.workflow, child: await childSummary(agent.workflow.run_dir) };
        entry.alive = entry.workflow.child.session_alive;
      }
      agents.push(entry);
    }
    // A conductor that came up, acknowledged its brief and then stopped looks EXACTLY like a healthy
    // run from here: session alive, every agent ready, no error anywhere, an empty mailbox. The only
    // thing missing is the one thing that matters — it never sent anything. Nothing said so, so the
    // operator's first clue was a stage that had produced nothing an hour later (TM-122).
    const orchestrator = run.agents.find((agent) => agent.role === "orchestrator" && !agent.workflow);
    // The WHOLE journal, not the tail `journal` holds for display. `readJournal`'s default here is
    // twelve entries, so on any run with a bit of history the first `message.sent` scrolls out of
    // view — and a conductor that has been working for an hour would be reported as one that never
    // started. A stall claim that gets louder the longer a run works is worse than no claim.
    const everSent = (await readJournal(runDir, Number.MAX_SAFE_INTEGER)).some((event) => event.type === "message.sent");
    const sinceLaunch = Date.now() - Date.parse(run.created ?? 0);
    const stalled = Boolean(
      orchestrator && alive && run.state === "running" && !everSent && Number.isFinite(sinceLaunch) && sinceLaunch > 120_000,
    );
    // Escalation is never silent. Two things land here: a bell that was judged safe and still did
    // not land, and a message that WAS submitted and then produced nothing — the latter is TM-122
    // (an agent that acknowledged its bootstrap and stopped) caught mechanically, for a stat().
    const undelivered = await undeliveredReport(runDir);
    const report = { run_id: run.run_id, name: run.name, session: run.session, session_alive: alive, state: run.state, run_dir: runDir, inputs: run.inputs, agents, pending_count: pending.length, queues, stalled, undelivered, recent: journal };
    if (flags.json) return out(report);
    out(`${run.name} · run ${run.run_id} · state ${run.state} · session ${run.session} ${alive ? "(alive)" : "(gone)"}`);
    // A malformed roster is worth saying out loud here: routing redirects against the agent
    // library, so if the library cannot name a single lead, the queue shown below is measuring a
    // different agent than the one messages are actually going to.
    for (const queue of queues) if (queue.lead_error) out(`  ! roster problem: ${queue.lead_error}`);
    if (stalled) {
      out(`  ! STALLED: ${orchestrator.id} has been up for ${Math.round(sinceLaunch / 60_000)} minutes and has never sent a message.`);
      out(`    Every agent is healthy and the mailbox is empty, which is what a conductor that acknowledged its`);
      out(`    brief and then stopped looks like. Start it: nudge --run ${runDir} --agent ${orchestrator.id} --text "Begin now, and follow your BOOTSTRAP.md end to end."`);
    }
    if (undelivered.length > 0) {
      out(`  ! UNDELIVERED: ${undelivered.length} message${undelivered.length === 1 ? "" : "s"} reached the mailbox and were never driven.`);
      for (const item of undelivered) out(`    - ${item.message} → ${item.agent}: ${item.state} (${item.notification}) — ${item.reason}`);
      out(`    The message files are intact; only the bell failed. Re-ring one with: nudge --run ${runDir} --agent <id> --text "Read your inbox and answer <message-id> now."`);
    }
    for (const agent of agents) {
      const queued = agent.pending.length ? ` — queue ${agent.queue.depth}${agent.queue.oldest_age_ms != null ? `, oldest ${Math.round(agent.queue.oldest_age_ms / 1000)}s` : ""}: ${agent.pending.join(", ")}` : "";
      if (agent.workflow) {
        const child = agent.workflow.child;
        out(`  ${agent.alive ? "●" : "○"} ${agent.roleIcon} ${agent.id} (${terminalText(agent.role)}) is a TEAM running \`${agent.workflow.name}\` — ${child.agents} agents, state ${child.state}, session ${agent.workflow.session} ${child.session_alive ? "(alive)" : "(gone)"}${queued}`);
        out(`      conductor ${agent.workflow.conductor} · ${child.pending} awaiting reply there · status --run ${agent.workflow.run_dir}`);
        continue;
      }
      out(`  ${agent.alive ? "●" : "○"} ${agent.roleIcon} ${agent.id} (${terminalText(agent.role)}) on ${agent.provider ?? "NO PROVIDER"} [chain: ${agent.chain.join(" → ")}] pane ${agent.pane}${agent.command ? ` running ${agent.command}` : ""}${queued}`);
    }
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
    // Children first, and depth-first, so a grandchild is not left holding a session after its
    // parent's is gone. Stopping the tree from the top down would orphan every level below the one
    // that failed; from the bottom up, a failure leaves a smaller mess and a findable one.
    const stoppedChildren = [];
    if (flags.run && flags.run !== true) {
      runDir = await runDirFrom(flags);
      if (flags["no-cascade"] !== true) await stopChildren(runDir, stoppedChildren);
      const run = await loadRun(runDir);
      session = run.session;
      run.state = "stopped";
      await saveRun(runDir, run);
      await appendJournal(runDir, { type: "run.stopped", children_stopped: stoppedChildren.length });
    }
    invariant(session, "TOPOLOGY_SESSION_REQUIRED", "Pass --run <run_dir> or --session <name>.");
    const existed = await tmux.hasSession(session);
    if (existed) await tmux.killSession(session);
    out({ ok: true, session, killed: existed, run_dir: runDir, files_kept: true, children_stopped: stoppedChildren });
  },
};

// The old noun still answers, undocumented. `templates` was in every SKILL.md, every runbook and
// every consumer's muscle memory before this rename; the cost of keeping it is one line.
commands.templates = commands.workflows;

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
