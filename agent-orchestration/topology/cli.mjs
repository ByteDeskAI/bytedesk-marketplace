#!/usr/bin/env node
// ao-topology: launch and conduct tmux-hosted multi-agent orchestrations from a declarative spec.
// Zero dependencies; runs from an installed plugin cache. Skills drive this CLI; agents call
// `reply`; the conductor calls `send`, `wait`, `capture`, and `status`.
import { readFile, readdir } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { doctor as runDoctor, tmuxInstallPlan } from "./lib/doctor.mjs";
import { closeAllClients, isUndelivered, ringMessage, undeliveredReport } from "./lib/delivery.mjs";
import { deliverPointer, failoverAgent, launchRun, materializeWorkflowSpec, messagePointer, openRoleSession, recordedRoleSession, registeredLeadId, retryWorkflowSpec, roleSessionFor, runAgentVisual, tmuxFailureTrigger } from "./lib/launch.mjs";
import { agentDir, appendJournal, loadRun, pendingReplies, queueDepth, readJournal, recordReply, saveRun, sendMessage, waitForReplies } from "./lib/mailbox.mjs";
import { adapterFor, adapterSummary, buildArgv, loadAdapters, providerDirs } from "./lib/providers.mjs";
import { roleDirs, skillDirs } from "./lib/resolve.mjs";
import { listWorkflows, loadSpec, resolveInputs, specSchemaSummary, workflowDirs, validateSpec } from "./lib/spec.mjs";
import * as tmux from "./lib/tmux.mjs";
import { TopologyError, absolutize, exists, fail, invariant, newRunId, parseArgs, parseDuration, readJson, terminalText, writeJson, AO_HOME } from "./lib/util.mjs";
import { agentDirs, agentsRoot, createAgent, findLead, listAgents, requireAgent } from "./lib/agents.mjs";
import { displayName, roleVisual } from "./lib/identity.mjs";
import { sessionIdentity } from "./lib/session-names.mjs";
import { issueDelegation, listDelegations, routeMessage } from "./lib/routing.mjs";
import { sameIncarnation } from "./lib/incarnation.mjs";
import { stateRoot } from "./lib/repoid.mjs";
import { preserveWorktreeWorkflows, reconcileWorkflows } from './lib/discovery.mjs';
import { assertNativeRepository, assertRunOwnership, controlWorkflow, stopNativeRun, workflowDetail } from './lib/workflow-control.mjs';

const PLUGIN_ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const CLI_BIN = process.env.AO_TOPOLOGY_BIN || join(PLUGIN_ROOT, "bin", "ao-topology");

const USAGE = `ao-topology — tmux-hosted multi-agent orchestration

Discover
  workflows [--consumer <dir>]                 list orchestration workflows
  schema                                       print the spec schema summary
  providers [--json]                           list provider adapters
  doctor [--json] [--consumer <dir>]           check tmux, CLIs, and search paths
  runs [--consumer <dir>]                      list durable explicit workflows across linked worktrees
  console list|show|workflows|control|preserve --consumer <dir> --json
         [--workflow-id <runtime:id>] [--request-file <json>] [--worktree <dir>]
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
         [--dry-run] [--json] [--team <name>]   --team prefixes the session name and scopes personas
         [--allow-outside]       permit a cwd or run_dir outside the invoking repository
         [--no-respawn] [--pass-handoff] [--turn-timeout 10m] [--handoff-timeout 5m]
                                 a library agent that is already live is re-spawned (TM-280): its turn
                                 is waited out, it writes a handoff, its old session ends, and the
                                 handoff comes back to you; --pass-handoff also gives it to the new
                                 session. --no-respawn refuses with TOPOLOGY_AGENT_ALREADY_LIVE instead
         [--allow-auto-approve]  accepted, no effect: agents run without permission prompts by
                                 default (TM-214); set auto_approve: false on an agent to opt out
  stop (--run <run_dir> | --session <name>) [--keep-files]
  status --run <run_dir> [--json]
  journal --run <run_dir> [--limit 50]

Conduct (used by the orchestrator agent)
  agent new --role <role> [--cli <id>] [--reports-to <id>] [--name "First Last"]
  agent list [--json]                          the repo's roster, by name and title
  agent show <id|"Full Name">                  one agent
  agent restart <id|"Full Name"> --mode handoff|resume [--turn-timeout 10m] [--handoff-timeout 5m] [--json]
                                               apply a changed prompt to a LIVE agent (TM-297): its turn
                                               and any typed input are waited out, then handoff replaces
                                               the session and passes the predecessor's handoff; resume
                                               continues the same provider conversation where the
                                               provider can (else falls back to handoff and says why).
                                               A reviewer (TM-302) is refused TOPOLOGY_AGENT_BUSY while a
                                               review request to it is uncollected, then relaunched fresh
                                               and read-only; either mode says so (fallback: fresh).
                                               agent list --json flags restart_required per agent
  agent set-instructions <id> (--file <md> | --text <s>) [--mode append|replace]
                                               the agent's own instructions; replace drops its template

  session open <id|"Full Name">                open this agent's durable session, or reattach to it
       [--no-respawn] [--pass-handoff] [--turn-timeout 10m] [--handoff-timeout 5m]
                                               live in another session: re-spawn it, as launch does
  session handoff <id|"Full Name"> --file <md> point the agent's live session at a handoff file
  session list [--json]                        which of this repo's agents are live right now
  session close <id|"Full Name">               end it; the agent and its directory survive
  delegate --task <id> --to <agent> [--for <external-agent>]
                                               open a direct channel to one of your agents
  delegations [--json]                         open delegations in this repo
  delegate grant --to <agent-id> --repo <consumer> --scope integrate,record-landing
           --epic <EP-nnn> | --tasks <TM-nnn,...> --expires <duration, max 14d> [--reason <text>]
                                               Grant an approved plan's authority a lead can later
                                               exercise for tasks in that plan (TM-248). --epic is frozen
                                               to the epic's current task ids; a new task needs a new
                                               grant. Needs an interactive TTY and
                                               a typed confirmation; refuses agent markers and agent
                                               ancestor processes.
                                               Does NOT exclude a same-OS-user agent (see docs).
  delegate list [--repo <consumer>] [--json]    standing delegations granted for a repository
  delegate revoke <id> [--repo <consumer>]      revoke a standing delegation (refuses agent sessions)

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
  goal-loop start --consumer <repo> --goal <EP-id> --file <request.json>
  goal-loop show|list --consumer <repo> [--loop <id>]
  goal-loop report|control --consumer <repo> --loop <id> --file <request.json>
  goal-loop reconcile --consumer <repo> [--loop <id>]
  mailbox receipts --consumer <repo> [--agent <id>] [--workflow <id>] [--status <state>]
  mailbox dispose --consumer <repo> --agent <id> --message <id> --disposition handled|deferred|rejected
       [--kind mail|reply] [--reason <text>] [--retry-at <ISO>] [--result-ref <ref>]
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
  prompt preview (--agent <id> | --role <role>) [--consumer <repo>]   composed text + layer sources
  config get --scope global|repo [--consumer <repo>]                   one layer's raw document + revision
  config set --scope global|repo [--consumer <repo>] --file <json> [--if-revision <rev>]
                                               validated, atomic; refuses a stale --if-revision
  config validate --file <json> [--scope global|repo]
  startup pending|watch|hooks|install-hooks|uninstall-hooks [--provider <id> --server <name>]
  startup-check --source hook|manual
  git-hook install|uninstall|status [--consumer <repo>]   real git pre-commit hook: blocks a commit that enables
                                               agent-orchestration at project scope (covers terminal commits)
  enrollment request --pending-key <key> --agent <id> [--consumer <repo>]
  enrollment ack --pending-key <key> --nonce <nonce> [--agent <id>]
  presence publish|watch [--server <socket> --dir <presence-directory>]
  mailbox send|forward|inbox|outbox|resume|receipts|dispose [--agent <id> --from-project <dir> --to <id> --id <stable-id>]
  review listen|probe|publish|await [--agent <id> --nonce <nonce> --response <b64:...|json> --timeout 8s]
  manage status|admit|report|eligible|integrate|cleanup --task <TM-id> [--file <protocol.json>]
  manage record-landing --task <TM-id> --landed <sha> [--actor <name>] --reason <text> [--authorized]
                                               in place of --authorized, integrate and record-landing
                                               also accept a plan grant covering the task (see delegate
                                               grant); the actor is then the grantee. Inside a managed
                                               agent session --actor and --authorized are refused, and
                                               a covering grant is required even under auto_merge.
                                               With management.integrate_via "pull-request", integrate
                                               merges the task's PR itself (gh pr merge --merge
                                               --match-head-commit <approved sha>), refusing by name
                                               unless plan, base, head, ci, review and mergeable hold,
                                               then records the landing and closes the task.
                                               ADR-0027: the repository's own lead, proven by pane
                                               ancestry, records landings with no grant, and
                                               integrates with no grant when management.lead_autonomy
                                               on the SERVER default branch names it (integrate scope).
  manage assign|assignment|release --task <TM-id> [--agent <id>] [--prompt-file <path>]
  manage start-worker --task <TM-id> [--backend tmux|topology]    launch via tm dispatch and bind
  manage bind --task <TM-id> [--pane <id> [--server <socket>] | --pid <pid>]   verify/adopt a worker
  manage stop-worker --task <TM-id>     close the bound worker only when owned, idle and collected
  manage <verb> ... --summary             one line instead of JSON (no pipe to jq needed)
  permissions install [--mcp <mcp__server>[,...]] [--dry-run] | uninstall [--dry-run]
                                               OPERATOR-ONLY: allow rules for the lead's governed verbs in
                                               its <agent dir>/.claude/settings.local.json; prints the diff
  quota status [--agent <id>] [--json] | resolve --agent <id> --state applied|declined|closed
                                               provider quota incidents raised by the supervise tick.
                                               Detection writes the incident; it restarts nothing.

Common: --consumer defaults to the current directory; --json prints machine-readable output.
`;

function out(value) {
  process.stdout.write(typeof value === "string" ? `${value}\n` : `${JSON.stringify(value, null, 2)}\n`);
}

/** TM-243: one line per governed verb, so a lead never pipes JSON to jq (a pipe defeats rule matching). */
function manageSummary(verb, task, r) {
  const auth = a => a ? ` by ${a.actor}${a.delegation_id ? ` (delegation ${a.delegation_id} from ${a.delegated_by})` : ['repository-lead', 'lead-autonomy-policy'].includes(a.channel) ? ` (${a.channel}, ${a.adr || a.policy?.adr})` : ''}` : '';
  switch (verb) {
    case 'admit': return r.admitted ? `${task} admitted${r.resumed ? ' (resumed)' : ''}: ${r.record?.worktree} on ${r.record?.branch}` : `${task} not admitted: ${r.state}`;
    case 'start-worker': return r.bound ? `${task} worker started and bound: ${r.run ?? r.worker?.run}` : `${task} worker started, NOT bound: ${r.reason} — ${r.recovery}`;
    case 'stop-worker': return r.stopped ? `${task} worker stopped (${r.proof}${r.closed ? ', pane closed' : ''})` : `${task} worker NOT stopped: ${r.reason} — ${r.recovery}`;
    case 'report': return `${task} ${r.events?.at(-1)?.event ?? 'report'} recorded; state ${r.state}${r.review_request ? '; review queued' : ''}${r.review_blocked ? `; review blocked: ${r.review_blocked}` : ''}`;
    case 'integrate': case 'record-landing': return `${task} ${verb === 'integrate' ? 'merged' : 'landing recorded'}: ${r.merge?.landed} on ${r.merge?.target_branch}${r.merge?.pull_request ? ` via PR #${r.merge.pull_request.number}` : ''}${auth(r.merge?.authorization)}${r.closed ? `; ${task} closed` : ''}`;
    case 'eligible': return r.eligible ? `${task} eligible for integration` : `${task} NOT eligible: ${r.reasons.join('; ')}`;
    case 'cleanup': return r.cleaned ? `${task} cleaned` : `${task} NOT cleaned: ${r.reason} — ${r.recovery}`;
    default: return `${task} ${verb}: ${r.management?.state ?? r.state ?? 'ok'}`;
  }
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
  if (typeof flags.consumer === 'string') {
    invariant(isAbsolute(flags.consumer), 'TOPOLOGY_REPO_REQUIRED', 'Consumer must be an absolute repository path.');
    await assertNativeRepository({ consumer: flags.consumer, runDir });
  }
  return runDir;
}

/** TM-185: the icon for a library agent, with the repository's registered lead resolved once. */
/** TM-280: the re-spawn options shared by `launch` and `session open`. */
function respawnFlags(flags) {
  const on = (key) => flags[key] === true || String(flags[key]) === "true";
  return {
    respawn: !on("no-respawn"),
    requestedBy: process.env.AO_AGENT_ID || process.env.AO_SESSION || "operator",
    respawnBounds: {
      ...(flags["turn-timeout"] && flags["turn-timeout"] !== true ? { turnTimeoutMs: parseDuration(String(flags["turn-timeout"])) } : {}),
      ...(flags["handoff-timeout"] && flags["handoff-timeout"] !== true ? { handoffTimeoutMs: parseDuration(String(flags["handoff-timeout"])) } : {}),
    },
    passHandoff: on("pass-handoff"),
  };
}

/** What a re-spawn hands back to its caller: the predecessor, where the handoff is, and its text. */
async function respawnReport(record) {
  const { readHandoff } = await import("./lib/respawn.mjs");
  return { agent: record.agent, predecessor: record.predecessor, handoff: record.handoff ? { ...record.handoff, text: await readHandoff(record) } : null, turn: record.turn };
}

/** TM-297: what `agent restart` replaced, with what, and on which prompt revision. */
async function restartReport(requested, result, agent) {
  const { readPromptState } = await import("./lib/prompts.mjs");
  const { incarnationOf } = await import("./lib/incarnation.mjs");
  const record = result.respawn;
  const resumed = Boolean(record.resume?.provider_session_id);
  return {
    mode: resumed ? "resume" : "handoff",
    requested_mode: requested,
    ...(requested === "resume" && !resumed ? { fallback: "handoff", fallback_reason: record.resume?.reason ?? "not resumable" } : {}),
    ...(resumed ? { provider_session_id: record.resume.provider_session_id } : {}),
    old_session: record.predecessor,
    new_session: { session: result.session, id: result.record?.identity?.id ?? null, predecessor: result.record?.identity?.predecessor ?? null },
    incarnation: incarnationOf(result.binding),
    prompt_revision: (await readPromptState(agent._dir))?.desired_revision ?? null,
  };
}

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
    const ownership = await assertRunOwnership(run, { requireAlive: false });
    const alive = !ownership.gone;
    const pending = await pendingReplies(runDir).catch(() => []);
    return { state: run.state, session_alive: alive, agents: run.agents?.length ?? 0, pending: pending.length };
  } catch {
    return { state: "unreadable", session_alive: false, agents: 0, pending: 0 };
  }
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
 *
 * TM-167: every such site goes through ONE path, `activateRepository`, which starts a supervisor only
 * for an ENROLLED repository. An unenrolled repository gets `{ started: false, reason: "not-enrolled" }`
 * and no process. The fields added here are additive to what `startRepositorySupervision` returns.
 */
async function activate(ctx, reason) {
  const { activateRepository } = await import('./lib/repo-enrollment.mjs');
  const { enrollment, supervision } = await activateRepository({ ...ctx, reason });
  return { ...supervision, enrolled: enrollment.enrolled, enrollment_source: enrollment.source, activation: reason };
}

const commands = {
  async supervise({ flags }) {
    const { superviseRepository, SUPERVISE_EXIT } = await import('./lib/supervision.mjs');
    const ctx = context(flags);
    // TM-167: `supervise` runs in EVERY repository, enrolled or not, and stays read-only — presence,
    // census, slots, quota, prompt refresh for standing agents that already exist. It starts nothing, so
    // enrollment does not gate it. Measured before this rule was set: of the 11 repositories running a
    // supervisor on the operator's machine, only 3 resolved as enrolled, and exiting in the other 8 would
    // have stopped their Presence heartbeat and shown each of them stale in the gateway. What enrollment
    // DOES gate is anything that starts or recovers an agent (lead recovery in the reconcile tick checks
    // resolveEnrollment) and an ordinary verb's self-start (`activate`, above), which spawns a supervisor
    // only for an enrolled repository. The watcher below is scoped to this repository's panes either way.
    const { canonicalRepoId } = await import('./lib/repoid.mjs');
    const repoId = (await canonicalRepoId(ctx.consumer)).id;
    // Linked worktrees share one canonical repository id, so a machine with N worktrees of this
    // repo open starts N supervisors and N-1 of them MUST lose. Losing is the correct outcome, not
    // an error — but it is not a finish either. TM-289: it exits TRY_LATER (75), so process-compose's
    // `on_failure` retries it with backoff and the retry takes over once the holder ends. Exit 0 here
    // would strand the repository unsupervised when the winner dies.
    const owned = async (task) => {
      try { return await task(); }
      catch (error) {
        if (error?.code !== 'TOPOLOGY_SUPERVISION_OWNED') throw error;
        process.exitCode = SUPERVISE_EXIT.TRY_LATER;
        return out({ ok: true, supervising: false, reason: 'another-supervisor-owns-this-repository', consumer: ctx.consumer, exit_code: SUPERVISE_EXIT.TRY_LATER });
      }
    };
    if (flags.once) return owned(() => superviseRepository({ ...ctx, tmuxServer: flags.server }, { once: true, onTick: out }));
    const { watchServer } = await import('./lib/startup.mjs');
    // A one-shot `supervise --once` above is a human asking a question, so it always answers. The
    // DAEMON is not: it ticks every 2-15s forever, and streaming each report to stdout puts a
    // multi-line JSON blob in every console hosting this monitor. The presence document is already
    // the durable record of a heartbeat — a reader wanting per-tick detail passes --json.
    // Exceptions still speak: retirement and a degraded heartbeat are invisible in any other place.
    const notable = report => report?.stopped || report?.presence_beats_degraded || report?.transport_failures || report?.error;
    // TM-276 / ADR-0031: the transport and its source are logged at start and again whenever they
    // change, a fallback from an unreachable configured NATS as a named warning.
    let loggedTransport = null;
    const logTransport = (transport, at) => {
      const key = JSON.stringify([transport?.source, transport?.url, transport?.outage?.since, transport?.outage?.recovered_at]);
      if (!transport || key === loggedTransport) return;
      loggedTransport = key;
      const outage = transport.outage && !transport.outage.recovered_at ? transport.outage : null;
      out({ event: outage ? 'transport-fallback' : 'transport-selected', at: at ?? new Date().toISOString(), consumer: ctx.consumer,
        transport: transport.kind, source: transport.source, url: transport.url,
        ...(outage ? { warning: `configured NATS ${outage.url} (${outage.source}) is unreachable: ${outage.error}; using ${transport.source} ${transport.url}` } : {}) });
    };
    const onTick = report => { logTransport(report?.transport, report?.at); if (flags.json || notable(report)) out(report); };
    const controller = new AbortController();
    let watcher = Promise.resolve(), watcherError;
    // Start the watcher only after winning repository ownership. Both loops
    // share a lifetime; a failed or losing supervisor cannot leave one behind.
    const onOwned = async () => {
      const { resolveTransport, describeTransport, ignoredNatsEnv } = await import('./lib/orch-transport.mjs');
      // ADR-0032: once per supervisor start, never per tick.
      const ignored = ignoredNatsEnv(process.env);
      if (ignored) out({ ...ignored, consumer: ctx.consumer });
      // Open it now so the start log names what this supervisor will use, not a stale record.
      const opened = await resolveTransport({ env: process.env }).catch((error) => ({ error }));
      if (opened.error) out({ event: 'transport-unavailable', consumer: ctx.consumer, code: opened.error.code ?? null, message: opened.error.message });
      else logTransport(await describeTransport(process.env));
      watcher = watchServer({ ...ctx, tmuxServer: flags.server || 'default', repoId, signal: controller.signal })
        .catch(error => { watcherError = error; controller.abort(); });
    };
    let report;
    try {
      report = await owned(() => superviseRepository({ ...ctx, tmuxServer: flags.server }, { onTick, onOwned, signal: controller.signal }));
    } finally {
      controller.abort();
      await watcher;
      if (watcherError) throw watcherError;
    }
    // TM-289: a retired supervisor (its repository is gone) exits RETIRED (0), which `on_failure`
    // does not restart, and takes the repository off the supervise list so the next `services
    // ensure` does not render it again. Under process-compose it runs that ensure itself, so the
    // project reloads now and the finished process disappears from `services status`.
    if (report?.stopped === 'consumer-gone') {
      const { removeServiceRepo, runServicesEnsure, servicesEnabled } = await import('./lib/services-client.mjs');
      const { repoKey } = await import('./lib/repoid.mjs');
      const deregistered = await removeServiceRepo({ key: repoKey(repoId), consumer: ctx.consumer }).catch(() => false);
      const managed = process.env.AGENT_ORCHESTRATION_SERVICES_MANAGED === '1' && servicesEnabled();
      const reloaded = managed && deregistered ? (await runServicesEnsure()).ok === true : false;
      process.exitCode = SUPERVISE_EXIT.RETIRED;
      out({ ok: true, supervising: false, reason: 'retired-consumer-gone', consumer: ctx.consumer, deregistered, reloaded, exit_code: SUPERVISE_EXIT.RETIRED });
    }
    return report;
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
    // reboot. `activate` is idempotent — a live pid short-circuits in microseconds — and
    // never fatal, which is the right trade here: a census with no supervisor is a one-shot
    // answer, not a failed command.
    const supervision = await activate(ctx, 'census');
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

  async "git-hook"({ flags, positional }) {
    const api = await import('./lib/git-hook.mjs');
    const sub = positional[0] || 'status';
    const fn = { install: api.installGitHook, uninstall: api.uninstallGitHook, status: api.gitHookStatus }[sub];
    if (!fn) fail('TOPOLOGY_SUBCOMMAND_UNKNOWN', 'Use git-hook install|uninstall|status.');
    return out(await fn({ repo: context(flags).consumer }));
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
    // Inspection and disposition operate on retained receipts, never pull from NATS.
    // They must remain available while the transport is unavailable.
    if (sub === 'receipts' || sub === 'dispose') {
      invariant(typeof flags.consumer === 'string' && isAbsolute(flags.consumer), 'TOPOLOGY_REPO_REQUIRED', 'Mailbox receipt operations require --consumer <absolute repository path>.');
      const receipts = await import('./lib/mailbox-receipts.mjs');
      if (sub === 'receipts') return out(await receipts.listMailboxReceipts({ ...ctx, agent: flags.agent,
        kind: flags.kind, status: flags.status, workflowId: flags.workflow, runId: flags.run, taskId: flags.task }));
      return out(await receipts.setMailboxDisposition({ ...ctx, agent: flags.agent || process.env.AO_AGENT_ID,
        messageId: flags.message, kind: flags.kind || 'mail', disposition: flags.disposition,
        reason: flags.reason, retryAt: flags['retry-at'], resultRef: flags['result-ref'] }));
    }
    if (sub === 'outbox') return out(await api.readStandingOutbox({ ...ctx, agent: flags.agent || process.env.AO_AGENT_ID }));
    const { selectLiveTransport, closeLiveTransports } = await import('./lib/orch-transport.mjs');
    ctx.transport = await selectLiveTransport({ env: process.env });
    try {
    // A human asking to resume means now: --force skips each message's backoff (never a permanent hold).
    if (sub === 'resume') return out(await api.resumeStandingMessages({ ...ctx, force: flags.force === true }));
    if (sub === 'reply') return out(await api.recordStandingReply({ ...ctx, messageId: flags.message, agentId: flags.agent || process.env.AO_AGENT_ID, body: await bodyFrom(flags) }));
    if (sub === 'inbox' || sub === 'outbox') return out(await api[sub === 'inbox' ? 'readStandingInbox' : 'readStandingOutbox']({ ...ctx, agent: flags.agent || process.env.AO_AGENT_ID }));
    const input = { consumer: ctx.consumer, fromProject: flags['from-project'] || process.env.AO_CONSUMER,
      from: flags.from || process.env.AO_AGENT_ID, to: flags.to, id: flags.id, body: await bodyFrom(flags),
      task: flags.task, stage: flags.stage, subject: flags.subject, provenance: { source: 'ao-topology CLI' }, via: list(flags.via) };
    if (sub === 'send') return out(await api.sendStandingMessage(input, ctx));
    if (sub === 'forward') return out(await api.forwardStandingMessage({ ...input, parentId: flags.parent }, ctx));
    fail('TOPOLOGY_SUBCOMMAND_UNKNOWN', 'Use mailbox send|forward|inbox|outbox|resume|reply|receipts|dispose.');
    } finally { await closeLiveTransports(); }
  },
  async 'goal-loop'({ flags, positional }) {
    invariant(typeof flags.consumer === 'string' && isAbsolute(flags.consumer), 'TOPOLOGY_REPO_REQUIRED', 'Goal loops require --consumer <absolute repository path>.');
    const ctx = context(flags), api = await import('./lib/goal-loop.mjs');
    const sub = positional[0] || 'list';
    const options = { ...ctx, loopId: flags.loop, env: process.env };
    try {
      if (sub === 'list') return out(await api.listGoalLoops(options));
      if (sub === 'show') return out(await api.showGoalLoop(options));
      if (sub === 'reconcile') return out(await (flags.loop ? api.reconcileGoalLoop : api.reconcileGoalLoops)(options));
      invariant(['start', 'report', 'control'].includes(sub) && typeof flags.file === 'string', 'TOPOLOGY_GOAL_REQUEST', 'Use goal-loop start|report|control --file <JSON>, or show|list|reconcile.');
      const request = await readJson(absolutize(flags.file));
      if (sub === 'start') return out(await api.startGoalLoop({ ...options, goalId: flags.goal, request }));
      if (sub === 'report') return out(await api.reportGoalLoop({ ...options, report: request }));
      return out(await api.controlGoalLoop({ ...options, request }));
    } finally {
      const { closeLiveTransports } = await import('./lib/orch-transport.mjs');
      await closeLiveTransports();
    }
  },
  async review({ flags, positional }) {
    const sub = positional[0];
    const ctx = context(flags);
    const { publishReviewerVerdict, listenForReviewer, readReviewerRecord, reviewerProbeReady, awaitReviewerVerdict } = await import('./lib/reviewer.mjs');
    const { selectLiveTransport, closeLiveTransports } = await import('./lib/orch-transport.mjs');
    const transport = await selectLiveTransport({ env: process.env });
    try {
      if (sub === 'publish') {
        const nonce = flags.nonce && flags.nonce !== true ? String(flags.nonce) : positional[1];
        invariant(nonce, 'TOPOLOGY_REVIEWER_NONCE', 'Pass review publish --nonce <nonce> --response <b64:...|json>.');
        // TM-195: the whole response, findings included. No default verdict: a missing one is refused.
        const response = flags.response && flags.response !== true ? String(flags.response) : null;
        invariant(response, 'TOPOLOGY_REVIEWER_RESPONSE', 'Pass review publish --response with the complete response: b64:<base64 of the JSON> or the JSON {"verdict":...,"findings":[...]}.');
        const published = await publishReviewerVerdict({
          consumer: ctx.consumer,
          nonce,
          response,
          env: process.env,
          transport,
        });
        return out({ ok: true, subject: published.subject, nonce, transport: transport.kind });
      }
      if (sub === 'listen') {
        const record = await readReviewerRecord(ctx.consumer, process.env);
        invariant(record, 'TOPOLOGY_REVIEWER_UNAVAILABLE', 'No designated reviewer.');
        const listening = await listenForReviewer({ consumer: ctx.consumer, record, env: process.env, transport });
        // The probe subscription lives on this process. Returning would drain it in `finally`
        // before another agent could request the subject.
        await new Promise((resolve, reject) => {
          process.stdout.write(`${JSON.stringify(listening)}\n`, (error) => (error ? reject(error) : null));
          const stop = () => resolve();
          process.once('SIGINT', stop);
          process.once('SIGTERM', stop);
        });
        return;
      }
      if (sub === 'probe') {
        const record = await readReviewerRecord(ctx.consumer, process.env);
        invariant(record, 'TOPOLOGY_REVIEWER_UNAVAILABLE', 'No designated reviewer.');
        const timeoutMs = parseDuration(flags.timeout, 5_000);
        const ready = await reviewerProbeReady({
          consumer: ctx.consumer,
          record,
          env: process.env,
          timeoutMs,
          transport,
        });
        return out({ ok: ready === true, ready, transport: transport.kind });
      }
      if (sub === 'await') {
        const nonce = flags.nonce && flags.nonce !== true ? String(flags.nonce) : positional[1];
        invariant(nonce, 'TOPOLOGY_REVIEWER_NONCE', 'Pass review await --nonce <nonce>.');
        const timeoutMs = parseDuration(flags.timeout, 8_000);
        const waiting = await awaitReviewerVerdict({
          consumer: ctx.consumer,
          nonce,
          timeoutMs,
          env: process.env,
          transport,
        });
        await new Promise((resolve, reject) => {
          process.stdout.write(`${JSON.stringify({ ok: true, waiting: true, subject: waiting.subject, transport: transport.kind })}\n`, (error) => (error ? reject(error) : resolve()));
        });
        const received = await waiting.received;
        return out({ ok: true, subject: received.subject, body: received.body, via: received.via, transport: transport.kind });
      }
      fail('TOPOLOGY_SUBCOMMAND_UNKNOWN', 'Use review publish|listen|probe|await.');
    } finally { await closeLiveTransports(); }
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
    // TM-167: non-fatal and enrollment-gated like every other activation site.
    return out({ ...result, supervision: await activate(ctx, 'enrollment-ack') });
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
    const verb = positional[0] || 'status';
    // TM-243: a dispatched worker may send its own report and read status; every other governed verb
    // is the lead's. Same-user limit as TM-234: this marker is set by tm dispatch and can be unset.
    invariant(!process.env.TM_DISPATCH_WORKER || ['report', 'status', 'eligible', 'assignment'].includes(verb), 'TOPOLOGY_MANAGEMENT_WORKER_REFUSED',
      `A dispatched worker session (TM_DISPATCH_WORKER) may only run manage report|status|eligible|assignment; ${verb} belongs to the lead.`);
    // TM-243: bare commands. With no AO_AGENT_ID, name the caller from the census binding of its live
    // pane, so the lead never needs an env-var prefix (which defeats permission-rule matching).
    const env = { ...process.env };
    if (!env.AO_AGENT_ID) {
      const { bindingAgentId } = await import('./lib/delegation.mjs');
      const bound = await bindingAgentId({ consumer: ctx.consumer, env, home: ctx.home });
      if (bound) env.AO_AGENT_ID = bound;
    }
    const supplied = flags.file ? await readJson(absolutize(flags.file)) : {};
    const options = { ...supplied, ...ctx, env, task: flags.task || supplied.task, owner: env.TM_SESSION_ID || env.AO_AGENT_ID,
      // TM-135 idle dispatch. `agent` PINS a candidate; omitted, arbitration picks one under its own lock.
      agent: flags.agent || supplied.agent || null, promptFile: flags['prompt-file'] || supplied.promptFile || null, reason: flags.reason || supplied.reason || null,
      landed: flags.landed || supplied.landed || null, actor: flags.actor || supplied.actor || null,
      authorized: flags.authorized === true || supplied.authorized === true,
      // TM-218 worker start/adopt. Adoption is fail-closed; flags never assert idleness or ownership.
      backend: flags.backend || supplied.backend || null, pane: flags.pane || null, pid: flags.pid || null, tmuxServer: flags.server || null };
    const methods = { status:'managementStatus', bind:'bindTaskWorker', admit:'admitTask', report:'workerReport', eligible:'integrationEligibility', integrate:'integrateTask', cleanup:'cleanupTask', 'record-landing':'recordLanding',
      assign:'assignTaskToAgent', assignment:'assignmentResult', release:'releaseAssignment', 'start-worker':'startTaskWorker', 'stop-worker':'stopTaskWorker' };
    const method = methods[verb];
    invariant(method, 'TOPOLOGY_SUBCOMMAND_UNKNOWN', 'Use manage status|admit|start-worker|bind|stop-worker|report|eligible|integrate|record-landing|cleanup|assign|assignment|release.');
    const result = await api[method](options);
    return out(flags.summary ? manageSummary(verb, options.task, result) : result);
  },
  async permissions({ flags, positional }) {
    const ctx = context(flags), api = await import('./lib/permissions.mjs');
    const sub = positional[0];
    const common = { consumer: ctx.consumer, dryRun: flags['dry-run'] === true };
    let result;
    if (sub === 'install') result = await api.installPermissions({ ...common, mcp: list(flags.mcp) });
    else if (sub === 'uninstall') result = await api.uninstallPermissions(common);
    else fail('TOPOLOGY_SUBCOMMAND_UNKNOWN', 'Use permissions install [--mcp <mcp__server>[,...]] [--dry-run] | uninstall [--dry-run].');
    if (flags.json) return out(result);
    out(`${result.dry_run ? '[dry run] ' : ''}lead ${result.lead}: ${result.path}`);
    out(result.diff);
    if (sub === 'install') out(`\n${result.changed ? `Added ${result.added.length} rule(s).` : 'Every rule was already present.'} ${result.restart}`);
    else out(`\n${result.changed ? `Removed ${result.removed.length} rule(s).` : 'No rules installed by ao-topology were present.'}`);
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
    if (sub === 'status') return out({ ...await api.leadState(options), recovery: await (await import('./lib/lead-recovery.mjs')).leadRecoveryStatus(ctx) });
    if (sub === 'probes') return out(await api.pendingLeadProbes(options));
    // `activate`, NOT startRepositorySupervision: `role assign|ensure lead` is the same
    // operation through the other surface and degrades, so these must too. Two surfaces onto one
    // operation must not disagree about whether a repo that cannot start a supervisor is a
    // degraded repo or a failed command. tests/unit/topology-supervision-consistency.test.mjs
    // drives both and compares — which is also why both pass the same activation reason.
    if (sub === 'ensure') {
      // TM-394: repair a broken checkout first; a still-broken one refuses rather than mint a lead.
      const checkout = await (await import('./lib/checkout-repair.mjs')).ensureCheckout(ctx);
      const result = await api.ensureLead(options);
      return out({ ...result, ...(checkout.action === 'repaired' ? { checkout } : {}), supervision: await activate(ctx, 'role-holder') });
    }
    if (sub === 'assign') {
      const result = await api.assignLead({ ...options, agentRef: positional[1], session: flags.session });
      return out({ ...result, supervision: await activate(ctx, 'role-holder') });
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
      ? { ...result, supervision: await activate(ctx, 'role-holder') }
      : result);
  },
  async config({ flags, positional }) {
    // TM-296: the contract the gateway settings UI reads and writes config through. One layer's raw
    // document at a time, validated before any write, guarded by the revision the caller last read.
    const ctx = context(flags);
    const api = await import('./lib/config.mjs');
    const sub = positional[0];
    const scope = typeof flags.scope === 'string' ? flags.scope : null;
    const options = { consumer: ctx.consumer, home: ctx.home };
    const document = async () => {
      invariant(typeof flags.file === 'string', 'TOPOLOGY_CONFIG_FILE_REQUIRED', 'Pass --file <json>.');
      return readJson(absolutize(flags.file));
    };
    if (sub === 'get') return out({ ok: true, ...await api.readConfigLayer(scope, options) });
    if (sub === 'validate') {
      const doc = await document();
      const errors = api.validateConfigShape(doc, flags.file);
      return out({ ok: errors.length === 0, errors, warnings: scope ? api.layerWarnings(doc, scope, flags.file) : [] });
    }
    invariant(sub === 'set', 'TOPOLOGY_SUBCOMMAND_UNKNOWN', 'Use config get|set|validate.');
    return out(await api.writeConfigLayer(scope, await document(), { ...options, ifRevision: typeof flags['if-revision'] === 'string' ? flags['if-revision'] : null }));
  },
  async prompt({ flags, positional }) {
    const ctx = context(flags);
    const agentRef = positional[1] ?? (typeof flags.agent === 'string' ? flags.agent : undefined);
    if (positional[0] === 'preview' && agentRef === undefined && typeof flags.role === 'string') {
      // TM-296: what an agent of this role WOULD be told, before any agent of it exists.
      const { composePrompt } = await import('./lib/prompts.mjs');
      const { loadConfig } = await import('./lib/config.mjs');
      const { titleForRole } = await import('./lib/identity.mjs');
      const loaded = await loadConfig(ctx);
      const role = flags.role;
      const agent = { id: 'preview', full_name: `(preview ${role})`, title: titleForRole(role), role };
      return out(await composePrompt({ ...ctx, agent, dir: '<agent directory>', loaded, templateName: loaded.config?.[role]?.template ?? null }));
    }
    let agent, promptSession, recordedBinding = null;
    if (flags.run) {
      const runDir = await runDirFrom(flags), run = await loadRun(runDir);
      const entry = run.agents.find(a => a.id === agentRef);
      invariant(entry, 'TOPOLOGY_UNKNOWN_AGENT', 'Agent is not in this workflow run.');
      invariant(run.consumer, 'TOPOLOGY_RUN_CONSUMER_REQUIRED', 'Workflow prompt composition requires its recorded repository.');
      const dir = join(runDir, 'agents', entry.id);
      const definition = await readJson(join(dir, 'prompt-agent.json'));
      agent = { ...entry, ...definition, id: entry.id, _dir: dir };
      recordedBinding = entry.binding ?? null;
      ctx.consumer = run.consumer;
      promptSession = run.session;
    } else {
      agent = await requireAgent(agentRef, ctx.agentDirs);
      const record = await readJson(join(agent._dir, 'session.json')).catch(() => null);
      recordedBinding = record?.binding ?? null;
    }
    const api = await import('./lib/prompt-lifecycle.mjs');
    if (positional[0] === 'preview') {
      const { composePrompt } = await import('./lib/prompts.mjs');
      const { loadConfig } = await import('./lib/config.mjs');
      return out(await composePrompt({ ...ctx, agent, dir: agent._dir, loaded: await loadConfig(ctx), templateName: agent.template }));
    }
    // TM-167: the recorded server, else the caller's own ($TMUX — the pane being proven lives there).
    // With neither there is no server to look at, so no binding is proven and ack fails closed.
    const promptServer = recordedBinding?.serverKey ?? tmux.callerServer(process.env);
    const panes = promptServer ? await tmux.listServerPanes({ tmuxServer: promptServer }).catch(() => []) : [];
    const currentBinding = panes.find(p => p.paneId === process.env.TMUX_PANE && (!recordedBinding || sameIncarnation(p, recordedBinding))) ?? null;
    const expectedSession = promptSession || await recordedRoleSession({ agentsDir: dirname(agent._dir), agentId: agent.id });
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
    const t = report.transport;
    if (t && !t.error) out(`Transport: ${t.kind}${t.source ? ` via ${t.source}` : ""}${t.url ? ` ${t.url}` : ""}${t.note ? ` (${t.note})` : ""}`);
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
    const index = await reconcileWorkflows({ consumer: ctx.consumer });
    const runs = index.workflows.map(item => ({ ...item, run_id: item.nativeRunId, name: item.workflowName, run_dir: dirname(item.recordPath) }));
    if (flags.json) return out(runs);
    if (runs.length === 0) out(`No explicit workflows for ${ctx.consumer}.`);
    for (const run of runs) out(`${run.runtime} ${run.run_id}  ${run.name}  ${run.state}\n    ${run.run_dir}`);
    for (const rejected of index.rejected) out(`! ${rejected.code}: ${rejected.path}: ${rejected.message}`);
  },

  async console({ flags, positional }) {
    invariant(typeof flags.consumer === 'string' && isAbsolute(flags.consumer), 'TOPOLOGY_REPO_REQUIRED', 'Console operations require --consumer <absolute repository path>.');
    const ctx = context(flags), sub = positional[0] || 'list';
    if (sub === 'list') return out(await reconcileWorkflows({ consumer: ctx.consumer }));
    if (sub === 'preserve') {
      invariant(typeof flags.worktree === 'string', 'TOPOLOGY_WORKTREE_REQUIRED', 'Pass the worktree whose evidence must be preserved.');
      const result = await preserveWorktreeWorkflows({ consumer: ctx.consumer, worktree: absolutize(flags.worktree) });
      if (!result.ok) process.exitCode = 1;
      return out(result);
    }
    if (sub === 'show') return out(await workflowDetail({ consumer: ctx.consumer, workflowId: flags['workflow-id'], pluginRoot: PLUGIN_ROOT }));
    if (sub === 'workflows') {
      const workflows = [];
      for (const item of await listWorkflows(ctx.workflowDirs)) {
        if (item.error || workflows.some(workflow => workflow.name === item.name)) continue;
        const spec = await readJson(item.path);
        workflows.push({ name: item.name, description: item.description || '', inputs: spec.inputs || {}, path: item.path });
      }
      return out({ schemaVersion: 1, workflows });
    }
    invariant(sub === 'control' && typeof flags['request-file'] === 'string', 'TOPOLOGY_CONTROL_REQUEST', 'Pass console control --request-file <JSON>.');
    const request = await readJson(absolutize(flags['request-file']));
    const adapters = await loadAdapters(ctx.providerDirs);
    const result = await controlWorkflow({ consumer: ctx.consumer, request,
      // Gateway sets this only after its authenticated operator check. JSON actor
      // labels are audit data and cannot themselves grant operator authority.
      authenticatedHuman: process.env.AO_GATEWAY_OPERATOR === '1',
      launch: async ({ workflowName, inputs, runId, retry, actor, stateHome }) => {
        let spec;
        if (retry) {
          spec = await retryWorkflowSpec(retry, { runId, stateHome, actor });
        } else {
          const saved = (await listWorkflows(ctx.workflowDirs)).find(item => !item.error && item.name === workflowName);
          invariant(saved, 'TOPOLOGY_WORKFLOW_NOT_FOUND', 'Select a saved workflow from console workflows.');
          const loaded = await loadSpec({ specPath: saved.path, dirs: ctx.workflowDirs });
          spec = await materializeWorkflowSpec(loaded.spec, { runId, consumer: ctx.consumer, home: ctx.home, inputs: resolveInputs(loaded.spec, inputs) }, { stateHome });
        }
        spec.initiator = actor;
        const start = async (materialized, lineage, replyToken = null, retrySource = null) => launchRun({ spec: materialized, adapters,
          skillSearchDirs: ctx.skillDirs, roleSearchDirs: ctx.roleDirs, cliBin: CLI_BIN, stateHome, lineage, replyToken,
          launchChild: async ({ workflow, inputs: childInputs, lineage: childLineage, replyToken: childToken }) => {
            if (retrySource) {
              const previous = retrySource.agents.find(agent => agent.id === childLineage.agent_id)?.workflow;
              invariant(previous?.run_dir, 'TOPOLOGY_RETRY_UNAVAILABLE', 'The original child attempt has no retained recipe location. Preserve it and launch a reviewed saved workflow.');
              const admitted = await assertNativeRepository({ consumer: ctx.consumer, runDir: previous.run_dir, stateHome });
              invariant(admitted.run.parent?.run_id === retrySource.run_id && admitted.run.parent?.agent_id === childLineage.agent_id,
                'TOPOLOGY_CHILD_OWNERSHIP', 'The original child does not acknowledge its exact retry owner.');
              const childSpec = await retryWorkflowSpec(admitted.run, { runId: newRunId(), stateHome, actor });
              const result = await start(childSpec, childLineage, childToken, admitted.run);
              return { ...result, conductor: childSpec.agents.find(agent => agent.role === 'orchestrator')?.id || null };
            }
            const saved = (await listWorkflows(ctx.workflowDirs)).find(item => !item.error && item.name === workflow);
            invariant(saved, 'TOPOLOGY_WORKFLOW_NOT_FOUND', 'Child workflow must be saved in the project workflow catalog.');
            const child = await loadSpec({ specPath: saved.path, dirs: ctx.workflowDirs });
            const childSpec = await materializeWorkflowSpec(child.spec, { runId: newRunId(), consumer: materialized.consumer, home: ctx.home,
              inputs: resolveInputs(child.spec, childInputs), ...(materialized.team ? { team: materialized.team } : {}) }, { stateHome });
            const result = await start(childSpec, childLineage, childToken);
            return { ...result, conductor: childSpec.agents.find(agent => agent.role === 'orchestrator')?.id || null };
          }, log: line => process.stderr.write(`${line}\n`) });
        return start(spec, retry?.parent || null, null, retry);
      },
      failover: ({ target, agentId, to, actor }) => failoverAgent({ runDir: target.runDir, agentId, toLabel: to, adapters,
        approvedBy: actor.id, pluginRoot: PLUGIN_ROOT, home: ctx.home }),
      deliver: async ({ target, agentId, message, stage }) => {
        const agent = target.run.agents.find(item => item.id === agentId), adapter = adapters.get(agent.adapter);
        invariant(adapter, 'TOPOLOGY_PROVIDER_UNAVAILABLE', 'The recorded provider adapter is not installed.');
        const delivery = message.deliveries.find(item => item.agent === agentId && !item.standing);
        invariant(delivery, 'TOPOLOGY_CONTROL_DELIVERY', 'Message has no admitted native delivery for this member.');
        return tmux.withServer(agent.binding.serverKey, () => ringMessage({ runDir: target.runDir, agentId, agent, adapter,
          pointer: messagePointer({ id: message.id, from: 'human', stage, inbox: delivery.inbox, outbox: delivery.outbox }),
          messageId: message.id, session: target.run.session, deliverPointer, tmuxFailureTrigger }));
      },
    });
    if (!result.ok) process.exitCode = 1;
    return out(result);
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
      const materializedChild = await materializeWorkflowSpec(child.spec, {
        runId: childRunId,
        consumer: ctx.consumer,
        home: ctx.home,
        inputs: resolveInputs(child.spec, childInputs),
        ...(team ? { team } : {}),
        allowOutside: Boolean(flags["allow-outside"]),
        ...(flags["max-fanout"] && flags["max-fanout"] !== true ? { maxFanout: Number(flags["max-fanout"]) } : {}),
      });
      const result = await launchRun({
        spec: materializedChild,
        adapters: await loadAdapters(ctx.providerDirs),
        skillSearchDirs: ctx.skillDirs,
        roleSearchDirs: ctx.roleDirs,
        cliBin: CLI_BIN,
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
    // A deliberate escape hatch, off unless the operator asks: `--allow-outside` lets a spec resolve
    // a cwd or run_dir outside the invoking repo. It is not inferable from the spec, because the spec
    // is the thing being trusted less. `--allow-auto-approve` is accepted and ignored (TM-214).
    // TM-274 / ADR-0030: materializeWorkflowSpec names the session — after the agent for a spawn of one
    // library agent, `run--<workflow>` otherwise — with `--team` (or the spec's `team`) as the prefix.
    const team = flags.team && flags.team !== true ? String(flags.team) : undefined;
    const materialized = await materializeWorkflowSpec(spec, {
      runId,
      consumer: ctx.consumer,
      home: ctx.home,
      inputs,
      allowOutside: Boolean(flags["allow-outside"]),
      ...(flags["max-fanout"] && flags["max-fanout"] !== true ? { maxFanout: Number(flags["max-fanout"]) } : {}),
      ...(team ? { team } : {}),
    });
    const adapters = await loadAdapters(ctx.providerDirs);
    const { passHandoff: pass, ...respawnOptions } = respawnFlags(flags);
    const result = await launchRun({
      spec: materialized,
      adapters,
      skillSearchDirs: ctx.skillDirs,
      roleSearchDirs: ctx.roleDirs,
      cliBin: CLI_BIN,
      dryRun: Boolean(flags["dry-run"]),
      ...(flags["max-depth"] && flags["max-depth"] !== true ? { maxDepth: Number(flags["max-depth"]) } : {}),
      launchChild,
      log: (line) => process.stderr.write(`${line}\n`),
      ...respawnOptions,
    });
    result.template = path;
    // TM-280: the handoff goes back to the caller; the new session gets it only on --pass-handoff.
    if (result.respawned) {
      const { passHandoff } = await import("./lib/respawn.mjs");
      result.respawned = await Promise.all(result.respawned.map(async (record) => {
        const started = result.agents.find((agent) => agent.id === record.spec_agent);
        const passed = pass && started?.pane ? await passHandoff({ pane: started.pane, adapter: adapters.get(started.adapter), path: record.handoff.path }) : null;
        return { ...(await respawnReport(record)), passed_to_new_session: Boolean(passed?.delivered) };
      }));
    }
    if (!flags["dry-run"]) result.supervision = await activate(ctx, 'launch');
    if (flags.json || flags["dry-run"]) return out(result);
    out(`Launched ${materialized.name} · run ${runId}`);
    out(`  run dir: ${result.runDir}`);
    out(`  session: ${result.session}`);
    for (const agent of result.agents) {
      const fallbacks = agent.attempts.slice(0, -1).map((attempt) => `${attempt.label}: ${attempt.outcome}`).join("; ");
      out(`  ${agent.provider ? (agent.ready ? "✓" : "?") : "✗"} ${agent.roleIcon} ${agent.id} (${terminalText(agent.role)}) on ${agent.provider ?? "NO PROVIDER"} pane ${agent.pane}${fallbacks ? ` — skipped ${fallbacks}` : ""}`);
    }
    for (const warning of result.warnings) out(`  ! ${warning}`);
    for (const record of result.respawned ?? []) {
      out(`  ↻ re-spawned ${record.agent}: replaced ${record.predecessor.session} (${record.predecessor.id ?? "no id"}); handoff (${record.handoff.source}) ${record.handoff.path}${record.passed_to_new_session ? " — passed to the new session" : " — not passed; use --pass-handoff or session handoff"}`);
    }
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
    if (sub === "set-instructions") {
      const agent = await requireAgent(String(positional[1] || ""), ctx.agentDirs);
      invariant(!agent._dir.startsWith(`${PLUGIN_ROOT}/`), "TOPOLOGY_AGENT_READ_ONLY", `${displayName(agent)} is a bundled plugin agent; a plugin update would overwrite the change.`);
      const { setAgentInstructions } = await import('./lib/agents.mjs');
      const updated = await setAgentInstructions(agent, {
        file: typeof flags.file === "string" ? absolutize(flags.file) : null,
        text: typeof flags.text === "string" ? flags.text : null,
        mode: typeof flags.mode === "string" ? flags.mode : "append",
        repo: ctx.consumer,
      });
      // A replace that meets role protocol keeps it; say so where the operator made the change.
      const { composePrompt } = await import('./lib/prompts.mjs');
      const { loadConfig } = await import('./lib/config.mjs');
      const { warnings } = await composePrompt({ ...ctx, agent: { ...agent, ...updated }, dir: updated._dir, loaded: await loadConfig(ctx), templateName: agent.template });
      return out({ ok: true, id: updated.id, file: updated._file, instructions_mode: updated.instructions_mode, instructions_file: updated.instructions_file, warnings,
        next: `ao-topology prompt refresh ${updated.id} applies it (a live agent is staged as restart-required).` });
    }
    if (sub === "show") {
      const agent = await requireAgent(String(positional[1] || ""), ctx.agentDirs);
      out({ ok: true, agent: displayName(agent), ...agent, ...roleVisual({ role: agent.role }) });
      return;
    }
    if (sub === "restart") {
      const mode = String(flags.mode ?? "");
      invariant(mode === "handoff" || mode === "resume", "TOPOLOGY_RESTART_MODE", "Pass --mode handoff|resume.");
      const agent = await requireAgent(String(positional[1] || ""), ctx.agentDirs);
      if (agent.role === "reviewer") {
        // TM-302: a reviewer relaunches only through its own read-only path, and never mid-review.
        const { restartReviewer } = await import("./lib/reviewer.mjs");
        const { respawnBounds } = respawnFlags(flags);
        const restart = await restartReviewer({ ...ctx, agentId: agent.id, mode, turnTimeoutMs: respawnBounds.turnTimeoutMs,
          log: flags.json ? () => {} : (line) => console.error(`  ${line}`) });
        return out({ ok: true, agent: displayName(agent), id: agent.id, ...roleVisual({ role: agent.role }), restart });
      }
      return commands.session({ flags, positional: ["open", positional[1]], replace: mode });
    }
    const roster = await listAgents(ctx.agentDirs);
    const lead = await findLead(ctx.agentDirs);
    const visualOf = await libraryVisuals(ctx);
    if (flags.json) {
      // TM-297: per agent, the prompt revision it runs, the one config wants, and whether only a restart applies it.
      const { loadConfig } = await import('./lib/config.mjs');
      const { promptRevisions } = await import('./lib/prompt-lifecycle.mjs');
      const { liveSessionOf } = await import('./lib/launch.mjs');
      const loaded = await loadConfig(ctx);
      const sessions = await tmux.listSessionIdentities(); // one tmux query for the whole roster
      const agents = await Promise.all(roster.map(async (a) => ({ id: a.id, name: displayName(a), role: a.role, ...visualOf(a), reports_to: a.reports_to,
        ...await promptRevisions({ agent: a, consumer: ctx.consumer, loaded, live: Boolean(await liveSessionOf(a.id, { agentsDir: dirname(a._dir), sessions })) }) })));
      out({ ok: true, lead: lead ? lead.id : null, agents });
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
  async session({ flags, positional, replace = null }) {
    const ctx = context(flags);
    const sub = (positional && positional[0]) || "list";

    if (sub === "list") {
      const roster = await listAgents(ctx.agentDirs);
      const visualOf = await libraryVisuals(ctx);
      // Two kinds of session, and the difference is the point. A role-session is the agent's one
      // durable workspace, and opening it again reattaches. A spawn is one run of that agent, and
      // there may be several at once. TM-274: who a session belongs to is read from the `@ao-*`
      // options recorded on it (legacy `ao-<id>` / `<id>-<7 hex>` names until they end) — the
      // `<host>-<repo>-<role>-<name>` name is only a label.
      const live = await tmux.listSessionIdentities();
      const liveNames = new Set(live.map((entry) => entry.name));
      const spawnsFor = new Map();
      for (const entry of live) {
        const identity = sessionIdentity(entry);
        if (identity?.kind !== "spawn") continue;
        if (!spawnsFor.has(identity.agentId)) spawnsFor.set(identity.agentId, []);
        spawnsFor.get(identity.agentId).push({ session: entry.name, spawn: identity.spawn });
      }
      const rows = await Promise.all(roster.map(async (agent) => {
        const session = await recordedRoleSession({ agentsDir: dirname(agent._dir), agentId: agent.id });
        return {
          id: agent.id,
          agent: displayName(agent),
          role: agent.role,
          ...visualOf(agent),
          session,
          live: liveNames.has(session),
          spawns: (spawnsFor.get(agent.id) ?? []).sort((a, b) => a.spawn.localeCompare(b.spawn)),
        };
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
      const session = await recordedRoleSession({ agentsDir: dirname(agent._dir), agentId: agent.id });
      const live = await tmux.hasSession(session);
      if (live) await tmux.killSession(session);
      // The record and the agent directory are deliberately left behind: closing a session ends a
      // conversation, it does not retire the agent, and `open` must rebuild the same workspace.
      return out({ ok: true, agent: displayName(agent), session, closed: live });
    }

    if (sub === "handoff") {
      // TM-280: the lead's explicit, later way to give a re-spawned agent its predecessor's handoff.
      invariant(flags.file && flags.file !== true, "TOPOLOGY_HANDOFF_FILE_REQUIRED", "Pass --file <handoff.md>.");
      const file = absolutize(String(flags.file));
      invariant(await exists(file), "TOPOLOGY_HANDOFF_FILE_MISSING", `No handoff file at ${file}.`);
      const { liveSessionOf } = await import("./lib/launch.mjs");
      const { passHandoff, sessionPanes } = await import("./lib/respawn.mjs");
      const session = await liveSessionOf(agent.id, { agentsDir: dirname(agent._dir) });
      invariant(session, "TOPOLOGY_AGENT_NOT_LIVE", `${displayName(agent)} has no live session to hand off to.`, { agent_id: agent.id });
      const panes = await sessionPanes(session);
      const pane = (panes.find((entry) => entry.identity?.agentId === agent.id) ?? panes[0])?.paneId;
      const delivered = await passHandoff({ pane, adapter: adapterFor(agent, await loadAdapters(ctx.providerDirs)), path: file });
      return out({ ok: delivered.delivered, agent: displayName(agent), session, pane, handoff: file, delivered: delivered.delivered });
    }

    invariant(sub === "open", "TOPOLOGY_SUBCOMMAND_UNKNOWN", `Unknown: session ${sub}. Use open, list, close, or handoff.`);
    // TM-214: the plain buildArgv below is not the reviewer's read-only argv (buildReviewerArgv).
    invariant(agent.role !== "reviewer", "TOPOLOGY_REVIEWER_READ_ONLY", `${displayName(agent)} is the reviewer; it launches only read-only. Use: ao-topology reviewer ensure.`, { agent_id: agent.id });
    const adapters = await loadAdapters(ctx.providerDirs);
    const adapter = adapterFor(agent, adapters);
    const session = await roleSessionFor({ agentsDir: dirname(agent._dir), agentId: agent.id, consumer: ctx.consumer, role: agent.role, home: ctx.home });
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
    const { passHandoff: passFlag, ...respawnOptions } = respawnFlags(flags);
    const result = await openRoleSession({
      ...respawnOptions,
      replace,
      home: ctx.home,
      agentsDir: dirname(agent._dir),
      agentId: agent.id,
      adapter,
      argv,
      env: { AO_AGENT_ID: agent.id, AO_AGENT_ROLE: agent.role, AO_SESSION: session, AO_CONSUMER: ctx.consumer, ...agent.env },
      session,
      role: agent.role,
      coordinatesOnly: agent.coordinates_only === true,
      controlledRestart: flags.restart === true,
      log: flags.json ? () => {} : (line) => console.error(`  ${line}`),
    });
    // TM-297: a restart that collected a handoff (handoff mode, or resume that fell back to it) gives it
    // to the successor; that is the point of it. A resumed conversation collected none, so has none to pass.
    const handoffPath = result.respawn?.handoff?.path ?? null;
    const pass = Boolean(handoffPath) && (passFlag || replace !== null);
    out({
      ok: true,
      agent: displayName(agent),
      id: agent.id,
      ...roleVisual({ role: agent.role }),
      supervision: await activate(ctx, 'session-open'),
      session: result.session,
      pane: result.pane,
      created: result.created,
      reattached: result.reattached,
      ...(result.respawn ? { respawned: { ...(await respawnReport(result.respawn)),
        passed_to_new_session: pass ? (await (await import("./lib/respawn.mjs")).passHandoff({ pane: result.pane, adapter, path: handoffPath })).delivered : false } } : {}),
      cwd: result.record?.cwd ?? join(dirname(agent._dir), agent.id),
      attach: tmux.attachCommand(result.session),
      ...(replace ? { restart: await restartReport(replace, result, agent) } : {}),
    });
  },

  async delegate({ flags, positional }) {
    const sub = positional[0];
    // TM-234: standing authorization delegation (grant/list/revoke) is a distinct concept from the
    // routing delegation below (opening a channel for an external agent). Dispatching on the first
    // positional keeps both under the one verb the operator already knows without colliding: the
    // routing form below never reads a positional argument.
    if (sub === 'grant' || sub === 'list' || sub === 'revoke') {
      const ctx = context(flags), api = await import('./lib/delegation.mjs');
      const consumer = flags.repo && flags.repo !== true ? absolutize(String(flags.repo)) : ctx.consumer;
      if (sub === 'grant') {
        const grant = await api.grantDelegation({ consumer, to: flags.to, scopes: list(flags.scope), plan: { epic: flags.epic === true ? '' : flags.epic, tasks: list(flags.tasks) }, expires: flags.expires, reason: flags.reason });
        return out({ ok: true, ...grant });
      }
      if (sub === 'list') return out({ ok: true, delegations: await api.listStandingDelegations({ consumer }) });
      const id = flags.id && flags.id !== true ? String(flags.id) : positional[1];
      invariant(typeof id === 'string' && id, 'TOPOLOGY_DELEGATION_ID', 'Pass the delegation id to revoke: delegate revoke <id>.');
      return out(await api.revokeDelegation({ consumer, id }));
    }
    invariant(sub === undefined, 'TOPOLOGY_SUBCOMMAND_UNKNOWN', 'Use delegate grant|list|revoke, or delegate --to <agent> [--task <id>] [--for <external-agent>] to open a direct channel.');
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
    const { selectLiveTransport, closeLiveTransports } = await import('./lib/orch-transport.mjs');
    const transport = await selectLiveTransport({ env: process.env });
    try {
    const message = await sendMessage({ runDir, from, to: list(flags.to), stage, body, contract: flags.contract, round: flags.round, subject: flags.subject, route, fromProject, task, via, idempotencyKey: flags.id, consumer: flags.consumer && flags.consumer !== true ? ctx.consumer : undefined, standingOptions: { pluginRoot: PLUGIN_ROOT, home: ctx.home, transport }, addressing: maxRecipients, transport, env: process.env });
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
      // not three — but the process must not be held open by it. The NATS client is the same
      // kind of hold: drain it before the process exits or the socket keeps the event loop alive.
      closeAllClients();
      await closeLiveTransports();
    }

    out({
      ok: true,
      id: message.id,
      // The receiving repo is the run's, never the caller's cwd — same reasoning as routingConsumer.
      supervision: await activate({ ...ctx, consumer: routingConsumer || ctx.consumer }, 'send'),
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
    } finally {
      await closeLiveTransports();
    }
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
    const { selectLiveTransport, closeLiveTransports } = await import('./lib/orch-transport.mjs');
    const transport = await selectLiveTransport({ env: process.env });
    let result;
    try {
    result = await waitForReplies({
      runDir,
      agentIds: list(flags.from),
      messageId: flags.message && flags.message !== true ? String(flags.message) : undefined,
      timeoutMs,
      pollMs,
      transport,
      onTick: flags.quiet ? undefined : (pending, elapsed) => process.stderr.write(`waiting ${Math.round(elapsed / 1000)}s — pending: ${pending.map((item) => `${item.agent}:${item.id}`).join(", ")}\n`),
    });
    } finally { await closeLiveTransports(); }
    if (!result.ok) process.exitCode = 2;
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
    const { selectLiveTransport, closeLiveTransports } = await import('./lib/orch-transport.mjs');
    const transport = await selectLiveTransport({ env: process.env });
    let path;
    try {
      path = await recordReply({ runDir, agentId: String(flags.agent), messageId: String(flags.message), body, ...(token ? { token } : {}), transport });
    } finally { await closeLiveTransports(); }
    out({ ok: true, reply: path, transport: transport.kind });
  },

  async capture({ flags }) {
    const runDir = await runDirFrom(flags);
    const run = await loadRun(runDir);
    const agent = run.agents.find((item) => item.id === flags.agent);
    invariant(agent, "TOPOLOGY_UNKNOWN_AGENT", `Unknown agent "${flags.agent}". Agents: ${run.agents.map((item) => item.id).join(", ")}.`);
    refuseIfParticipant(agent, "capture");
    const lines = Number(flags.lines) > 0 ? Number(flags.lines) : 60;
    await assertRunOwnership(run);
    out(await tmux.withServer(agent.binding.serverKey, () => tmux.capture(agent.pane, lines)));
  },

  async nudge({ flags }) {
    const runDir = await runDirFrom(flags);
    const run = await loadRun(runDir);
    const agent = run.agents.find((item) => item.id === flags.agent);
    invariant(agent, "TOPOLOGY_UNKNOWN_AGENT", `Unknown agent "${flags.agent}".`);
    refuseIfParticipant(agent, "nudge — send it a message instead");
    invariant(typeof flags.text === "string" && flags.text.trim(), "TOPOLOGY_TEXT_REQUIRED", "Pass --text <text>.");
    await assertRunOwnership(run);
    await tmux.withServer(agent.binding.serverKey, () => tmux.sendText(agent.pane, flags.text, agent.submit_keys ?? ["Enter"]));
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
    const ownership = await assertRunOwnership(run, { requireAlive: false }).catch(error => ({ gone: true, panes: [], error: { code: error.code, message: error.message } }));
    const alive = ownership.error ? null : !ownership.gone;
    const panes = ownership.panes.map(pane => ({ ...pane, id: pane.paneId }));
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
    const report = { run_id: run.run_id, name: run.name, session: run.session, session_alive: alive, observation_error: ownership.error || null, state: run.state, run_dir: runDir, inputs: run.inputs, agents, pending_count: pending.length, queues, stalled, undelivered, recent: journal };
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
    invariant(flags.run && flags.run !== true, 'TOPOLOGY_RUN_REQUIRED', 'Stopping by session name is unsafe. Pass the native --run directory with recorded member incarnations.');
    const result = await stopNativeRun({ runDir: await runDirFrom(flags), cascade: flags['no-cascade'] !== true });
    if (!result.ok) process.exitCode = 1;
    out(result);
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
  } finally {
    const { closeLiveTransports } = await import('./lib/orch-transport.mjs');
    await closeLiveTransports();
  }
}

await main();
