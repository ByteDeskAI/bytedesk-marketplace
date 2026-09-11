// One surface over repository standing: who holds `lead`, `reviewer`, `worker`, `designer` and
// `image-gen` right now, and how a role changes hands.
//
// This module owns almost no behaviour. lead.mjs and reviewer.mjs already hold the invariants that
// matter — one lead and one reviewer per canonical repository, a reviewer that is never the author
// and never the lead, a session that is killed only on an explicit ownership-checked request — and
// the way to keep those invariants true is to CALL them, not to restate them here. Every verb below
// is a dispatch into one of those modules plus, for the non-singleton roles, the agent library and
// openRoleSession. What is genuinely new is exactly three things: the ROLE_KINDS table, the handoff
// (`reassign`), and the per-role history log.
//
// Two decisions are load-bearing.
//
// 1. `status` reports THREE fields — registered, alive, responsive — and never one tick. A record
//    existing, a pane incarnation running, and an agent acknowledging a nonce are three different
//    facts, and leadState keeps them apart for a reason: a CLI parked on a login screen is alive
//    and useless, and an agent deep in a long task is alive, unresponsive, and perfectly healthy.
//    A convenience surface that collapses them destroys the distinction the whole lead design rests
//    on, so this one does not.
//
// 2. `reassign` is a HANDOFF, not an eviction. The incumbent is probed and, if it does not answer,
//    that is REPORTED — never read as death. What is detached is the RECORD; the outgoing holder's
//    session keeps running, its conversation, cwd and task claim are untouched, and its privileges
//    are unchanged, because it stops being *the* lead without stopping being an agent. The one
//    library change is the role tag, and that is not optional: findLead raises
//    TOPOLOGY_MULTIPLE_LEADS the moment two agents claim `role: "lead"`, so a successor could not be
//    assigned and routing could not run until the outgoing tag is released.
//
// In-flight standing mail is handed over, not migrated. Delivered envelopes stay addressed to the
// outgoing holder — rewriting them would break recordStandingReply's ownership check and orphan
// every reply in flight — while new unvouched contact reaches the successor from the moment the
// record flips, because routeMessage re-reads findLead on every message. Both sides are told what
// is outstanding so neither has to discover it.
import { appendFile, mkdir, readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { agentDirs, createAgent, listAgents, requireAgent } from "./agents.mjs";
import { displayName, titleForRole } from "./identity.mjs";
import { openRoleSession, roleSessionName, roleSessionPath } from "./launch.mjs";
import { assignLead, detachLead, ensureLead, leadState, readLeadRegistration } from "./lead.mjs";
import { leadQueueDepth } from "./mailbox.mjs";
import { adapterFor, buildArgv, loadAdapters, providerDirs } from "./providers.mjs";
import { refreshPrompt } from "./prompt-lifecycle.mjs";
import { promptErrorDetail } from "./prompts.mjs";
import { canonicalRepoId, repoKey, stateRoot } from "./repoid.mjs";
import { assignReviewer, detachReviewer, ensureReviewer, readReviewerRecord, reviewerStanding } from "./reviewer.mjs";
import { readStandingInbox, sendStandingMessage } from "./standing-mailbox.mjs";
import * as tmux from "./tmux.mjs";
import { exists, invariant, nowIso, readJson, writeJson } from "./util.mjs";

/**
 * The standing roles, and whether a repository may have more than one holder.
 *
 * At-most-one is NOT a general property of roles — it is two specific guarantees. The lead is the
 * cross-repo front door every unvouched message is routed to, so a second one is a second front
 * door. The reviewer is the independence guarantee, so a second one halves the meaning of
 * "independent review". Neither reason generalises to a designer, and a repo can plausibly want
 * two, so `role show designer` returns a LIST and `role assign designer` never refuses on
 * multiplicity.
 */
export const ROLE_KINDS = {
  lead: { singleton: true, why: "the cross-repo front door: routeMessage sends every unvouched contact to the lead, so a second lead is a second front door" },
  reviewer: { singleton: true, why: "the independence guarantee: the reviewer is never the author and never the lead" },
  worker: { singleton: false, why: null },
  designer: { singleton: false, why: null },
  "image-gen": { singleton: false, why: null },
};

function kindOf(role) {
  const entry = ROLE_KINDS[role];
  invariant(entry, "TOPOLOGY_ROLE_UNKNOWN", `Unknown standing role ${JSON.stringify(role)}. Known roles: ${Object.keys(ROLE_KINDS).join(", ")}.`, { role });
  return entry;
}

// ── History ──────────────────────────────────────────────────────────────────
// A log, never a second authority. The CURRENT holder is always the existing per-role registry
// record (leads/<key>.json, reviewers/<key>.json) or the agent library's role tag, so there is
// exactly one source of truth and this file only says how it got that way.

export function roleHistoryPath(role, key, env = process.env, home = homedir()) {
  return join(stateRoot(env, home), "roles", key, `${role}.history.jsonl`);
}

async function appendHistory({ consumer, role, env = process.env, home = homedir(), ...entry }) {
  const identity = await canonicalRepoId(consumer);
  const path = roleHistoryPath(role, repoKey(identity.id), env, home);
  await mkdir(dirname(path), { recursive: true });
  await appendFile(path, `${JSON.stringify({ at: nowIso(), repo_id: identity.id, role, ...entry })}\n`, "utf8");
  return path;
}

/** Read the transitions back, oldest first. An unreadable line is skipped, never fatal. */
export async function roleHistory({ role, consumer, env = process.env, home = homedir(), limit = 0 }) {
  kindOf(role);
  const identity = await canonicalRepoId(consumer);
  const path = roleHistoryPath(role, repoKey(identity.id), env, home);
  const text = await readFile(path, "utf8").catch((error) => { if (error.code === "ENOENT") return ""; throw error; });
  const entries = text.split("\n").filter(Boolean).map((line) => { try { return JSON.parse(line); } catch { return null; } }).filter(Boolean);
  return { role, path, entries: limit > 0 ? entries.slice(-limit) : entries };
}

// ── Library helpers for the non-singleton roles ──────────────────────────────

const dirsFor = (o) => agentDirs({ pluginRoot: o.pluginRoot, consumer: o.consumer, home: o.home });

async function holdersOf(role, o) {
  return (await listAgents(dirsFor(o))).filter((agent) => agent.role === role);
}

/** Persist a role change on an agent definition, dropping the loader's underscore-prefixed fields. */
async function retag(agent, role) {
  await writeJson(agent._file, { ...Object.fromEntries(Object.entries(agent).filter(([key]) => !key.startsWith("_"))), role });
  return { ...agent, role };
}

/**
 * Which of these agents has a live role-session right now: `listServerPanes` plus the library.
 * TM-167: asks about each agent's own named session, never enumerates the whole implicit server.
 */
async function aliveSessions(agents, { env = process.env, listPanesFn = tmux.listServerPanes } = {}) {
  const live = new Set();
  for (const agent of agents) {
    const session = roleSessionName(agent.id);
    // A session is not a server. When the agent's own session record names its server, ask THAT server;
    // with no record the server is implicit ($TMUX or the default socket), which this advisory status accepts.
    const tmuxServer = agent._dir ? (await readJson(join(agent._dir, "session.json")).catch(() => null))?.binding?.serverKey : undefined;
    const panes = await listPanesFn({ session, env, ...(tmuxServer ? { tmuxServer } : {}) });
    if (panes.some((pane) => pane.alive !== false && pane.sessionName === session)) live.add(agent.id);
  }
  return live;
}

/**
 * Open a non-singleton holder's durable session. The twin of the CLI's `session open`: same argv
 * construction, same cwd rule (the agent's own directory is what gives it memory), same explicit
 * repo grant. `open` is injectable so the whole lifecycle tests with no tmux server.
 * ponytail: the argv block is duplicated from cli.mjs `session open` rather than extracted —
 * extracting it means editing cli.mjs, which is integrator-owned this cycle.
 */
async function openAgentSession({ agent, consumer, home, pluginRoot, env = process.env, log = () => {}, open = openRoleSession }) {
  const adapters = await loadAdapters(providerDirs({ pluginRoot, consumer, home }));
  const adapter = adapterFor(agent, adapters);
  const session = roleSessionName(agent.id);
  const prompt = await refreshPrompt({ agent, consumer, home, pluginRoot, env, live: false });
  invariant(prompt.status !== "invalid-config", "TOPOLOGY_PROMPT_INVALID", `Prompt config is invalid; the existing session is preserved.${promptErrorDetail(prompt.errors)}`, { errors: prompt.errors ?? [] });
  const vars = {
    session,
    agent_id: agent.id,
    agent_role: agent.role,
    bootstrap_file: join(agent._dir, "prompt.md"),
    system_prompt: `You are ${displayName(agent)} (id "${agent.id}", role: ${agent.role}), the standing ${agent.role} for ${consumer}. Read ${join(agent._dir, "prompt.md")} and follow it.`,
  };
  const argv = buildArgv(adapter, { ...agent, add_dirs: agent.coordinates_only === true ? [] : [consumer] }, vars);
  return open({
    agentsDir: dirname(agent._dir),
    agentId: agent.id,
    adapter,
    argv,
    env: { AO_AGENT_ID: agent.id, AO_AGENT_ROLE: agent.role, AO_SESSION: session, AO_CONSUMER: consumer, ...agent.env },
    role: agent.role,
    log,
  });
}

// ── status ───────────────────────────────────────────────────────────────────

/**
 * Three fields, never one. `registered` is "a record names a holder"; `alive` is "a pane
 * incarnation is running"; `responsive` is "a nonce was acknowledged". They are different
 * questions with different answers, and the raw `state` enum rides alongside rather than being
 * replaced by the booleans.
 *
 * For the non-singleton roles `responsive` is `null`, not `false`: there is no readiness handshake
 * for a designer, and reporting "not responsive" for a protocol that does not exist would be a
 * different lie from the one this function exists to avoid.
 */
export async function roleStatus({ role, consumer, home = homedir(), env = process.env, pluginRoot = null, probes = null, ackTimeoutMs = undefined, listPanesFn = tmux.listServerPanes, log = () => {} }) {
  const entry = kindOf(role);
  if (role === "lead") {
    const state = await leadState({ consumer, home, env, pluginRoot, probes, log, ...(ackTimeoutMs === undefined ? {} : { ackTimeoutMs }) });
    return {
      role, singleton: true, state: state.status,
      registered: state.status !== "none",
      alive: state.status === "unresponsive" || state.status === "responsive",
      responsive: state.status === "responsive",
      holder: state.record?.agent_id ?? null,
      holder_name: state.record?.agent_name ?? null,
      record: state.record,
      library_lead: state.library_lead,
      identity: state.identity,
    };
  }
  if (role === "reviewer") {
    const standing = await reviewerStanding({ consumer, env, home, probes });
    return {
      role, singleton: true,
      state: !standing.registered ? "none" : !standing.alive ? "registered" : standing.responsive ? "responsive" : "unresponsive",
      registered: standing.registered, alive: standing.alive, responsive: standing.responsive,
      holder: standing.record?.agent_id ?? null,
      holder_name: standing.record?.agent_id ?? null,
      record: standing.record, reason: standing.reason,
    };
  }
  const agents = await holdersOf(role, { consumer, home, pluginRoot });
  const live = await aliveSessions(agents, { env, listPanesFn });
  return {
    role, singleton: entry.singleton,
    holders: agents.map((agent) => ({
      id: agent.id, name: displayName(agent), title: agent.title ?? titleForRole(role),
      registered: true, alive: live.has(agent.id), responsive: null,
      responsive_reason: "this role has no readiness handshake; alive is all that is proven",
      session: roleSessionName(agent.id),
    })),
  };
}

// ── list / show ──────────────────────────────────────────────────────────────

/** Every role and who holds it. Cheap on purpose: nothing here rings a pane or probes a nonce. */
export async function roleList({ consumer, home = homedir(), env = process.env, pluginRoot = null }) {
  const roster = await listAgents(dirsFor({ consumer, home, pluginRoot }));
  const [lead, reviewer] = await Promise.all([
    readLeadRegistration({ consumer, env, home }).catch(() => null),
    readReviewerRecord(consumer, env, home).catch(() => null),
  ]);
  const named = (id) => {
    const agent = roster.find((a) => a.id === id);
    return agent ? { id, name: displayName(agent), title: agent.title ?? titleForRole(agent.role) } : { id, name: null, title: null };
  };
  const roles = Object.entries(ROLE_KINDS).map(([role, entry]) => {
    if (role === "lead") return { role, singleton: true, why_singleton: entry.why, holders: lead?.record ? [named(lead.record.agent_id)] : [] };
    if (role === "reviewer") return { role, singleton: true, why_singleton: entry.why, holders: reviewer ? [named(reviewer.agent_id)] : [] };
    return {
      role, singleton: false, why_singleton: null,
      holders: roster.filter((a) => a.role === role).map((a) => ({ id: a.id, name: displayName(a), title: a.title ?? titleForRole(role) })),
    };
  });
  return { consumer, roles };
}

/** One role's holder(s). A singleton returns one record; every other role returns a LIST. */
export async function roleShow({ role, consumer, home = homedir(), env = process.env, pluginRoot = null }) {
  const entry = kindOf(role);
  const listed = (await roleList({ consumer, home, env, pluginRoot })).roles.find((r) => r.role === role);
  return entry.singleton
    ? { role, singleton: true, why_singleton: entry.why, holder: listed.holders[0] ?? null }
    : { role, singleton: false, holders: listed.holders };
}

// ── assign / ensure / detach ─────────────────────────────────────────────────

async function assignInternal({ role, agentRef, session = null, consumer, home = homedir(), env = process.env, pluginRoot = null, probes = null, ackTimeoutMs = undefined, notAgentIds = [], log = () => {} }) {
  kindOf(role);
  const shared = { consumer, home, env, pluginRoot, probes, log, ...(ackTimeoutMs === undefined ? {} : { ackTimeoutMs }) };
  if (role === "lead") return { ...(await assignLead({ ...shared, agentRef, session })), role };
  if (role === "reviewer") return { ...(await assignReviewer({ ...shared, agentRef, session, notAgentIds })), role };
  // A non-singleton role is a tag on an agent, not a registry slot: enrol the named agent, or mint
  // one when no reference is given. Either way multiplicity is allowed and never refused.
  if (agentRef) {
    const agent = await requireAgent(agentRef, dirsFor({ consumer, home, pluginRoot }));
    const tagged = await retag(agent, role);
    return { action: "assigned", role, agent_id: tagged.id, agent: displayName(tagged), created: false, previous_role: agent.role, privileges: "unchanged" };
  }
  const created = await createAgent(consumer, { role }, null, { home, pluginRoot, env });
  return { action: "assigned", role, agent_id: created.id, agent: displayName(created), created: true, previous_role: null, privileges: "unchanged" };
}

export async function roleAssign(options) {
  const result = await assignInternal(options);
  const { role, consumer, env, home } = options;
  await appendHistory({ role, consumer, env, home, verb: "assign", from: null, to: result.agent_id ?? result.record?.agent_id ?? null });
  return result;
}

export async function roleEnsure({ role, agentRef = null, consumer, home = homedir(), env = process.env, pluginRoot = null, probes = null, ackTimeoutMs = undefined, notAgentIds = [], open = openRoleSession, log = () => {} }) {
  kindOf(role);
  const shared = { consumer, home, env, pluginRoot, probes, log, ...(ackTimeoutMs === undefined ? {} : { ackTimeoutMs }) };
  let result;
  if (role === "lead") result = { ...(await ensureLead(shared)), role };
  else if (role === "reviewer") result = { ...(await ensureReviewer({ ...shared, notAgentIds })), role, action: "ensured" };
  else {
    invariant(agentRef, "TOPOLOGY_ROLE_AGENT_REQUIRED", `Name the agent whose session to open: role ensure ${role} <id|"Full Name">.`);
    const agent = await requireAgent(agentRef, dirsFor({ consumer, home, pluginRoot }));
    invariant(agent.role === role, "TOPOLOGY_ROLE_MISMATCH", `${displayName(agent)} holds role "${agent.role}", not "${role}". Assign the role first.`, { agent_id: agent.id, role: agent.role });
    const opened = await openAgentSession({ agent, consumer, home, pluginRoot, env, log, open });
    result = { action: "ensured", role, agent_id: agent.id, agent: displayName(agent), session: opened.session, pane: opened.pane ?? null, created: opened.created === true, reattached: opened.reattached === true };
  }
  if (["created", "restarted", "ensured"].includes(result.action)) {
    await appendHistory({ role, consumer, env, home, verb: "ensure", to: result.agent_id ?? result.record?.agent_id ?? null, from: null, outcome: result.action });
  }
  return result;
}

async function detachInternal({ role, agentRef = null, kill = false, consumer, home = homedir(), env = process.env, pluginRoot = null, probes = null, log = () => {} }) {
  kindOf(role);
  const shared = { consumer, home, env, probes, log };
  if (role === "lead") return { ...(await detachLead({ ...shared, kill })), role };
  if (role === "reviewer") return { ...(await detachReviewer({ ...shared, kill })), role };
  invariant(agentRef, "TOPOLOGY_ROLE_AGENT_REQUIRED", `Name the holder to detach: role detach ${role} <id|"Full Name">.`);
  const agent = await requireAgent(agentRef, dirsFor({ consumer, home, pluginRoot }));
  invariant(agent.role === role, "TOPOLOGY_ROLE_MISMATCH", `${displayName(agent)} holds role "${agent.role}", not "${role}".`, { agent_id: agent.id, role: agent.role });
  let killed = false;
  if (kill === true) {
    // detachLead's managed-only rule, kept: a session this module never opened has no record beside
    // the agent, and an externally-owned pane is never killed however dead it looks.
    const owned = await exists(roleSessionPath(dirname(agent._dir), agent.id));
    invariant(owned, "TOPOLOGY_ROLE_OWNERSHIP_UNKNOWN", `No managed role-session record for ${displayName(agent)}; refusing to kill a session this repository did not open.`, { agent_id: agent.id });
    const session = roleSessionName(agent.id);
    if (await tmux.hasSession(session)) { await tmux.killSession(session); killed = true; }
  }
  // The agent and its directory survive: detaching ends a standing role, not an identity.
  const demoted = role === "worker" ? agent : await retag(agent, "worker");
  return { action: "detached", detached: true, role, agent_id: agent.id, agent: displayName(agent), killed, now_role: demoted.role };
}

export async function roleDetach(options) {
  const result = await detachInternal(options);
  const { role, consumer, env, home } = options;
  if (result.detached) {
    await appendHistory({ role, consumer, env, home, verb: "detach", from: result.agent_id ?? result.record?.agent_id ?? null, to: null, killed: result.killed === true });
  }
  return result;
}

// ── reassign: the handoff ────────────────────────────────────────────────────

/** Delivered-but-unanswered standing mail addressed to this agent, plus run queue depth if asked. */
async function outstandingFor({ agent, consumer, env, home, pluginRoot, runDir = null }) {
  const inbox = await readStandingInbox({ consumer, agent, env, home }).catch(() => []);
  const unanswered = inbox.filter((record) => !record.reply).map((record) => ({
    id: record.envelope.id, from: record.envelope.from, from_project: record.envelope.fromProject,
    subject: record.envelope.subject, task: record.envelope.task, delivered_at: record.delivered_at ?? null,
  }));
  const queues = runDir ? await leadQueueDepth(runDir, { consumer, pluginRoot, home }).catch(() => []) : [];
  return { standing_unanswered: unanswered, run_queues: queues };
}

async function tell({ consumer, from, to, subject, body, env, home, pluginRoot }) {
  try {
    const record = await sendStandingMessage({ consumer, fromProject: consumer, from, to, subject, body }, { env, home, pluginRoot });
    return { to, id: record.envelope.id, status: record.status, reason: record.reason ?? null };
  } catch (error) {
    // A handoff that already happened is not undone by a notification that did not land — but it is
    // not hidden either, because "nothing silently orphaned" is the whole point of writing it.
    return { to, id: null, status: "failed", reason: error.code ?? "ERROR", message: error.message };
  }
}

/**
 * Hand a singleton role from its current holder to a successor.
 *
 * 1. Probe the incumbent. Alive-and-unresponsive is REPORTED and refused without `--force`: it may
 *    be mid-task, and "did not answer" has never meant "is dead".
 * 2. Detach the RECORD, not the session. The outgoing holder's pane keeps running, its
 *    conversation, cwd and task claim are untouched. Its library role tag is released, because
 *    findLead refuses two leads and the successor could not be assigned otherwise.
 * 3. Assign the successor — nonce handshake for a live session (`agentRef`), `ensure` for a new one.
 * 4. Report privileges as unchanged. Promotion cannot grant OS isolation a provider does not have.
 * 5. Tell both sides what is outstanding. Delivered mail stays addressed to the outgoing holder;
 *    new unvouched contact reaches the successor from the moment the record flips.
 */
export async function roleReassign({ role, agentRef = null, force = false, session = null, runDir = null, consumer, home = homedir(), env = process.env, pluginRoot = null, probes = null, ackTimeoutMs = undefined, notAgentIds = [], log = () => {} }) {
  const entry = kindOf(role);
  invariant(entry.singleton, "TOPOLOGY_ROLE_NOT_SINGULAR", `A repository may have several ${role} holders, so there is no role to hand over — use role assign and role detach.`, { role });
  const shared = { consumer, home, env, pluginRoot, probes, log, ...(ackTimeoutMs === undefined ? {} : { ackTimeoutMs }) };

  const before = await roleStatus({ ...shared, role });
  invariant(before.registered, "TOPOLOGY_ROLE_VACANT", `No ${role} is registered for this repository; use role assign or role ensure rather than reassign.`, { role });
  invariant(
    !before.alive || before.responsive || force === true,
    "TOPOLOGY_ROLE_INCUMBENT_UNRESPONSIVE",
    `The current ${role} (${before.holder}) has a live session that did not acknowledge a probe. That is a report, not a death certificate — it may be mid-task. Re-run with --force to hand the role over anyway; either way its session is preserved and never killed.`,
    { role, holder: before.holder, registered: before.registered, alive: before.alive, responsive: before.responsive },
  );
  const outgoing = before.holder;
  const outstanding = await outstandingFor({ agent: outgoing, consumer, env, home, pluginRoot, runDir });

  const detached = role === "lead" ? await detachLead({ ...shared, kill: false }) : await detachReviewer({ ...shared, kill: false });
  const outgoingAgent = (await listAgents(dirsFor({ consumer, home, pluginRoot }))).find((a) => a.id === outgoing);
  if (outgoingAgent && outgoingAgent.role === role) await retag(outgoingAgent, "worker");

  const assigned = agentRef
    ? await assignInternal({ ...shared, role, agentRef, session, notAgentIds })
    : role === "lead"
      ? { ...(await ensureLead(shared)), role }
      : { ...(await ensureReviewer({ ...shared, notAgentIds })), role, action: "ensured" };
  const successor = assigned.record?.agent_id ?? assigned.agent_id ?? null;

  const outstandingNote = outstanding.standing_unanswered.length
    ? `Still outstanding and still addressed to ${outgoing}: ${outstanding.standing_unanswered.map((m) => m.id).join(", ")}.`
    : `Nothing is outstanding in ${outgoing}'s standing inbox.`;
  const notified = [
    await tell({ consumer, from: successor, to: outgoing, subject: `${role} handed over to ${successor}`, env, home, pluginRoot,
      body: `You are no longer the standing ${role} for ${consumer}; ${successor} is. Your session, conversation, working directory and task claim are untouched and nothing was killed. Delivered standing mail stays yours to answer — rewriting an envelope's addressee would break the reply's ownership check. ${outstandingNote} New unvouched contact now routes to ${successor}.` }),
    await tell({ consumer, from: outgoing, to: successor, subject: `you are now the ${role}`, env, home, pluginRoot,
      body: `You are the standing ${role} for ${consumer} from now on; new unvouched cross-repository contact routes to you. Mail already delivered to me stays addressed to me and I will answer it. ${outstandingNote} Your privileges are unchanged by this handover — it grants no isolation your provider did not already give you.` }),
  ];

  await appendHistory({ role, consumer, env, home, verb: "reassign", from: outgoing, to: successor, forced: force === true,
    incumbent: { registered: before.registered, alive: before.alive, responsive: before.responsive },
    outstanding: outstanding.standing_unanswered.map((m) => m.id) });

  return {
    action: "reassigned", role, from: outgoing, to: successor, forced: force === true,
    incumbent: { registered: before.registered, alive: before.alive, responsive: before.responsive, session_killed: false },
    detached: detached.detached === true, assigned,
    privileges: "unchanged",
    preserved: {
      outgoing: { conversation: true, task: "kept", cwd: "kept", session: "running", library_role: "worker" },
      incoming: assigned.preserved ?? { conversation: true, task: "kept", cwd: "kept" },
    },
    note: "Promotion changes who holds the role, not what the holder may do: it cannot grant OS isolation the provider does not have.",
    outstanding, notified,
  };
}

// ── One entry point, so the CLI verb stays three lines ───────────────────────

const VERBS = { list: roleList, show: roleShow, status: roleStatus, assign: roleAssign, ensure: roleEnsure, detach: roleDetach, reassign: roleReassign, history: roleHistory };

export async function roleCommand({ verb = "list", ...options }) {
  const handler = VERBS[verb];
  invariant(handler, "TOPOLOGY_SUBCOMMAND_UNKNOWN", `Use role ${Object.keys(VERBS).join("|")}.`, { verb });
  if (verb !== "list") invariant(options.role, "TOPOLOGY_ROLE_REQUIRED", `Name the role: role ${verb} <${Object.keys(ROLE_KINDS).join("|")}>.`);
  return handler(options);
}
