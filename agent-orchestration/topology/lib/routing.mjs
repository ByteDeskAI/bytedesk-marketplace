// Cross-repo routing. A repo's lead is its front door: an agent from another repo reaches the lead,
// not an individual member — unless the lead has already delegated the task they are coordinating
// on. That exception depends on live state, so it cannot be static config and it cannot be prose in
// a prompt: the check runs here, at the mailbox, where messages actually arrive.
//
// A blocked contact is REDIRECTED to the lead rather than rejected to the sender. Redirect is the
// friendlier behaviour but it is also the quieter one, so every redirect is journalled, is
// acknowledged to the sender, and keeps the original addressee in the envelope. A message that
// silently changes recipient is the failure mode this whole layer exists to avoid.
import { randomBytes } from "node:crypto";
import { mkdir, readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { consumerResourceDirs, invariant, nowIso, readJson, writeJson } from "./util.mjs";
import { agentDirs, findLead, resolveAgentRef } from "./agents.mjs";
import { displayName } from "./identity.mjs";
import { canonicalRepoId, repoKey, stateRoot } from "./repoid.mjs";

export const DELEGATIONS_KIND = "delegations";
const DEFAULT_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export function delegationsRoot(consumer) {
  return consumerResourceDirs(consumer, DELEGATIONS_KIND)[0];
}

/**
 * A lead issues a delegation when it hands work to one of its own agents and expects an outside
 * agent to coordinate directly on it. The record lives in THIS repo — the one that owns the local
 * agent — so validation never requires reading another repo's state.
 */
export async function issueDelegation(consumer, { task, external_agent, local_agent, issued_by, agent = null, ttlMs = DEFAULT_TTL_MS }) {
  invariant(task, "TOPOLOGY_DELEGATION_INVALID", "A delegation must name a task.");
  invariant(local_agent, "TOPOLOGY_DELEGATION_INVALID", "A delegation must name the local agent doing the work.");
  // A coordinator is not a worker. Delegating the work itself to one is the mistake the
  // coordinates_only flag exists to prevent, and it has to be refused here rather than described in
  // a prompt, because the token is what the outside repo will later present.
  invariant(
    !(agent && agent.coordinates_only),
    "TOPOLOGY_COORDINATOR_NOT_A_WORKER",
    `${displayName(agent)} coordinates and does not implement, so work cannot be delegated to them. Delegate to whoever they hand it to.`,
  );
  // The store gets the last word at issue time too: a token minted against a task this repo does
  // not hold would be inert at every later check, and failing here says so while it can be fixed.
  const verdict = await verifyAgainstStore(consumer, { task, local_agent }, { agent });
  invariant(verdict.ok, "TOPOLOGY_DELEGATION_UNBACKED", `Cannot issue a delegation: ${verdict.reason}.`);
  const token = randomBytes(8).toString("hex");
  const record = {
    token,
    task: String(task),
    external_agent: external_agent ? String(external_agent) : null,
    local_agent: String(local_agent),
    issued_by: issued_by ? String(issued_by) : null,
    issued_at: nowIso(),
    expires_at: new Date(Date.now() + ttlMs).toISOString(),
    // What the store said when the token was minted. Informational only — every use re-reads it.
    issued_against: verdict.reason,
  };
  const dir = delegationsRoot(consumer);
  await mkdir(dir, { recursive: true });
  await writeJson(join(dir, `${token}.json`), record);
  return record;
}

export async function listDelegations(consumer) {
  const out = [];
  for (const dir of consumerResourceDirs(consumer, DELEGATIONS_KIND)) {
    const entries = await readdir(dir).catch(() => []);
    for (const name of entries.filter((n) => n.endsWith(".json"))) {
      const rec = await readJson(join(dir, name)).catch(() => null);
      if (rec) out.push(rec);
    }
  }
  return out;
}

// ── the receiving repo's task-management store ───────────────────────────────
// A delegation token is a pointer, not a permission. The permission is the tm claim it names, and
// that claim lives in the RECEIVING repo's own store — the one store that cannot be forged by the
// sender. So the local delegation record is only a ledger of what was issued; every question of
// whether a token still authorises anything is answered by re-reading `.bytedesk/task-management/`
// off disk at the moment the message arrives. Deliberately no second delegation store: tasks,
// claims and assignees already exist there, and the store gets the last word.

export const TASK_STORE = ".bytedesk/task-management";
const TERMINAL = new Set(["done", "closed", "cancelled", "canceled", "dropped", "wontfix", "rejected"]);

export function taskStoreRoot(consumer) {
  return join(consumer, ...TASK_STORE.split("/"));
}

/** Frontmatter parsing that mirrors task-management's own: JSON values, one `key: value` per line. */
export function parseFrontmatter(text) {
  if (!text.startsWith("---\n")) return {};
  const end = text.indexOf("\n---", 4);
  if (end === -1) return {};
  const data = {};
  for (const line of text.slice(4, end).split("\n")) {
    const m = /^([A-Za-z0-9_]+):\s*(.*)$/.exec(line);
    if (!m) continue;
    try {
      data[m[1]] = m[2] === "" ? "" : JSON.parse(m[2]);
    } catch {
      data[m[1]] = m[2];
    }
  }
  return data;
}

/** One task record from the receiving repo's store, or null when the store has never heard of it. */
export async function readStoreTask(consumer, taskId) {
  const id = String(taskId || "").trim();
  if (!consumer || !id) return null;
  const dir = join(taskStoreRoot(consumer), "tasks");
  const entries = await readdir(dir).catch(() => null);
  if (!entries) return null;
  // Files are `<ID>-<slug>.md`; match on the id segment rather than a prefix, so TM-9 never
  // matches TM-90.
  const file = entries.find((name) => name.endsWith(".md") && (name === `${id}.md` || name.startsWith(`${id}-`)));
  if (!file) return null;
  const text = await readFile(join(dir, file), "utf8").catch(() => null);
  if (text == null) return null;
  return { ...parseFrontmatter(text), _file: join(dir, file) };
}

/** The live claim on a task in the receiving repo, or null. */
export async function readStoreClaim(consumer, taskId, env = process.env) {
  if (!consumer || !taskId) return null;
  const { resolveTransport } = await import('./orch-transport.mjs');
  const { repoKey } = await import('./repoid.mjs');
  const transport = await resolveTransport({ env });
  const claim = await transport.getClaim({ repo: repoKey(consumer), task: String(taskId), storeDir: taskStoreRoot(consumer) });
  if (!claim) return null;
  const config = await readJson(join(taskStoreRoot(consumer), "config.json")).catch(() => null);
  const ttlMinutes = config?.claimTtlMinutes ?? 240;
  if (!claim.ts) return null;
  if (ttlMinutes && Date.now() - Date.parse(claim.ts) > ttlMinutes * 60_000) return null;
  return claim;
}

function names(agent, id) {
  const set = new Set([String(id || "")].filter(Boolean));
  if (agent?.id) set.add(agent.id);
  if (agent?.full_name) set.add(agent.full_name);
  return [...set].map((value) => value.toLowerCase());
}

/**
 * Does the receiving repo's own store still back this delegation?
 *
 * Fails closed. A token naming a task the store does not have, a task that is finished, or a task
 * nobody is holding for the named local agent authorises nothing — the message is not rejected, it
 * simply falls through to the lead like any other unvouched external contact.
 */
export async function verifyAgainstStore(consumer, record, { agent = null } = {}) {
  const taskId = record?.task ? String(record.task) : null;
  if (!taskId) return { ok: false, reason: "the delegation names no task, so there is no claim to check" };

  const task = await readStoreTask(consumer, taskId);
  if (!task) {
    return {
      ok: false,
      reason: `${taskId} is not in this repo's task-management store, so nothing here vouches for the delegation`,
    };
  }
  const status = String(task.status || "").toLowerCase();
  if (TERMINAL.has(status)) return { ok: false, reason: `${taskId} is ${status} in this repo's store` };

  const holders = names(agent, record.local_agent);
  const claim = await readStoreClaim(consumer, taskId);
  const claimed = claim && holders.includes(String(claim.actor || "").toLowerCase());
  const assigned = holders.includes(String(task.assignee || "").toLowerCase()) || holders.includes(String(task.actor || "").toLowerCase());
  if (!claimed && !assigned) {
    const held = claim?.actor || task.assignee || task.actor || "nobody";
    return { ok: false, reason: `${taskId} is held by ${held} in this repo's store, not by ${record.local_agent}` };
  }
  return { ok: true, reason: `${taskId} is ${claimed ? "claimed" : "assigned"} to ${record.local_agent} in this repo's store`, task, claim };
}

function live(record) {
  if (!record?.expires_at) return true;
  return Date.parse(record.expires_at) > Date.now();
}

/**
 * Is there an open delegation letting `from` talk straight to `to` about `task`?
 * A token may be presented explicitly; otherwise the store is searched, which is what makes the
 * exception work when an agent simply names the task it is coordinating on.
 */
export async function delegationAllows(consumer, { from, to, task, token, agent = null }) {
  const all = (await listDelegations(consumer)).filter(live);
  const candidates = all.filter((d) => {
    if (token && d.token !== token) return false;
    if (d.local_agent !== to) return false;
    if (task && d.task !== String(task)) return false;
    if (d.external_agent && from && d.external_agent !== from) return false;
    return true;
  });
  // The ledger says a token was issued; the store says whether it still means anything. A record
  // whose task has been closed, reassigned, or never existed here authorises nothing.
  const rejected = [];
  for (const record of candidates) {
    const verdict = await verifyAgainstStore(consumer, record, { agent });
    if (verdict.ok) return { ok: true, delegation: { ...record, verified: verdict.reason }, rejected };
    rejected.push({ token: record.token, task: record.task, reason: verdict.reason });
  }
  return { ok: false, delegation: null, rejected };
}

/**
 * Are two project paths the same repo?
 *
 * A raw string compare calls a trailing slash, a symlinked temp dir (/tmp vs /private/tmp) or a
 * worktree reached by two names a different project — which either invents an external contact
 * between an agent and its own teammates, or worse, hides a real one. Resolve both, through
 * symlinks where the path exists.
 */
export async function sameProject(a, b) {
  if (!a || !b) return false;
  return (await canonicalRepoId(a)).id === (await canonicalRepoId(b)).id;
}

// -- task:<TM-id> addresses ---------------------------------------------------
// TM-384 / ADR-0041. A worker a lead bound to a task is usually NOT a library agent (a Codex worker
// tm dispatched, a pane the lead adopted), so naming it by id fails closed as an unknown recipient.
// "task:<TM-id>" names it by the one thing everybody already knows: the task it is bound to. The
// binding is the management record bindTaskWorker writes; nothing here writes it.
const TASK_ADDRESS = /^task:(TM-[0-9]+)$/;

export function taskAddress(to) {
  return TASK_ADDRESS.exec(String(to ?? ""))?.[1] ?? null;
}

/** The live worker bound to taskId in the management record of this repository, or null. */
export async function boundTaskWorker(consumer, taskId, { env = process.env, home } = {}) {
  if (!consumer || !taskId) return null;
  const identity = await canonicalRepoId(consumer);
  // ponytail: mirrors management.mjs context(); export it from there when that file is free to edit.
  const file = join(stateRoot(env, home), "management", repoKey(identity.id), taskId + ".json");
  const record = await readJson(file).catch(() => null);
  const worker = record?.worker;
  if (!worker?.name || worker.stopped_at || record.state === "cleaned") return null;
  return worker;
}

async function routeTaskAddress({ consumer, home, env, from, task, token, external, taskId, toLead, decision }) {
  decision.task_address = taskId;
  const worker = await boundTaskWorker(consumer, taskId, { env, home });
  if (worker) {
    decision.worker = { name: worker.name, kind: worker.kind ?? null, run: worker.run ?? null, session_name: worker.session_name ?? null };
  }
  if (!external) {
    if (!worker) {
      // Not unknown_recipient: the address is well formed and names a task; nobody is bound to it yet.
      decision.blocked = "task_worker_unbound";
      decision.reason = "no worker is bound to " + taskId + " in the management record of this repository";
      return decision;
    }
    decision.resolved = worker.name;
    decision.deliver_to = worker.name;
    decision.reason = "same project; " + taskId + " is bound to " + worker.name;
    return decision;
  }
  // Cross-repo: the lead stays the front door unless it delegated THIS task to THIS worker.
  if (!worker) return toLead("external contact for " + taskId + ", which has no bound worker", null);
  if (task && String(task) !== taskId) return toLead("external contact for " + taskId + " while naming task " + task, null);
  const allowed = await delegationAllows(consumer, { from, to: worker.name, task: taskId, token });
  if (allowed.ok) {
    decision.resolved = worker.name;
    decision.deliver_to = worker.name;
    decision.delegation = allowed.delegation.token;
    decision.reason = "delegation " + allowed.delegation.token + " covers task " + taskId + " - " + allowed.delegation.verified;
    return decision;
  }
  if (allowed.rejected.length > 0) decision.delegation_rejected = allowed.rejected;
  return toLead("external contact for the worker " + worker.name + " bound to " + taskId + " with no open delegation", null);
}

/**
 * Decide where a message actually goes.
 *
 * Same repo, or addressed to the lead, or covered by a delegation -> straight through.
 * Otherwise -> the lead, with the intended recipient preserved so the lead knows what was meant.
 */
export async function routeMessage({ consumer, pluginRoot, home, env = process.env, from, fromProject, to, task, token, via = [] }) {
  const dirs = agentDirs({ pluginRoot, consumer, home });
  const taskId = taskAddress(to);
  const target = taskId ? null : await resolveAgentRef(to, dirs);
  const decision = {
    requested: to,
    resolved: target ? target.id : null,
    deliver_to: target ? target.id : to,
    redirected: false,
    reason: null,
    delegation: null,
    coordinates_only: false,
  };
  if (target) decision.coordinates_only = coordinatesOnly(target);

  // An omitted source is UNVOUCHED, and unvouched is external. A message that cannot name the repo
  // it came from must not bypass admission: letting `fromProject: undefined` pass as same-project
  // meant any sender could reach a member directly simply by declining to say where it was from —
  // the one route this layer exists to close.
  const external = !fromProject || !consumer || !(await sameProject(fromProject, consumer));

  // Send it to the lead, unless doing so would send it back where it has already been. Shared by
  // the unresolvable-recipient case and the no-delegation case, because both are the same answer:
  // this repo's front door decides, not the sender.
  const toLead = async (because, intended) => {
    const lead = await findLead(dirs);
    if (!lead) {
      // Fail closed. Delivering as addressed when there is no lead hands an unvouched outsider a
      // member of this repo precisely when nobody exists to vouch for the contact — the absence of
      // the front door is exactly when the door matters.
      decision.blocked = "no_lead";
      decision.reason = `${because}; admission refused the unvouched contact because this repo has no lead to vouch for it`;
      return decision;
    }
    if (wouldLoop(via, lead.id)) {
      decision.blocked = "loop";
      decision.reason = `${displayName(lead)} has already handled this message (via ${via.join(" → ")}); refusing to forward it back`;
      return decision;
    }
    decision.redirected = true;
    decision.deliver_to = lead.id;
    decision.coordinates_only = coordinatesOnly(lead);
    decision.intended_for = intended ? intended.id : to;
    decision.intended_display = intended ? displayName(intended) : to;
    decision.lead_display = displayName(lead);
    decision.reason = `${because}; routed to ${displayName(lead)}`;
    return decision;
  };

  if (taskId) return routeTaskAddress({ consumer, home, env, from, task, token, external, taskId, toLead, decision });

  if (!external) {
    // Inside the repo an unknown ref is not a routing question — sendMessage validates it against
    // the run's own roster and says so.
    decision.reason = "same project";
    return decision;
  }

  // Fail closed on a name this repo's library does not know. Passing it through left the run's pane
  // list as the only gate, and that is a different set: a spec written with inline agent ids has
  // panes that were never library agents, so an outsider naming one reached a non-lead directly
  // with no delegation and no redirect.
  if (!target) {
    return toLead(`external contact for "${to}", which is not in this repo's agent library`, null);
  }

  if (target.role === "lead") {
    decision.reason = "addressed to the lead";
    return decision;
  }

  const allowed = await delegationAllows(consumer, { from, to: target.id, task, token, agent: target });
  if (allowed.ok) {
    decision.reason = `delegation ${allowed.delegation.token} covers task ${allowed.delegation.task} — ${allowed.delegation.verified}`;
    decision.delegation = allowed.delegation.token;
    return decision;
  }
  // A token that exists but no longer holds is worth naming. Silently treating it as absent is how
  // an operator ends up certain the delegation is working while every message goes to the lead.
  if (allowed.rejected.length > 0) decision.delegation_rejected = allowed.rejected;

  await toLead(`external contact for ${displayName(target)} with no open delegation`, target);
  if (decision.delegation_rejected) {
    decision.reason += ` (a delegation record exists but the store does not back it: ${decision.delegation_rejected[0].reason})`;
  }
  return decision;
}

/** The loop guard: never forward a message that has already passed through this repo's lead. */
export function wouldLoop(via = [], leadId) {
  return Array.isArray(via) && leadId ? via.includes(leadId) : false;
}

export const MAX_HOPS = 4;

export function hopExceeded(via = []) {
  return Array.isArray(via) && via.length >= MAX_HOPS;
}

/**
 * The chain a message has travelled, extended by one hop. Appending here — rather than passing the
 * caller's `via` through unchanged — is what makes the hop limit and the loop guard mean anything:
 * a chain that never grows never trips either.
 */
export function nextVia(via = [], hop) {
  const chain = Array.isArray(via) ? via.filter(Boolean).map(String) : [];
  if (!hop) return chain;
  return [...chain, String(hop)];
}

/**
 * Stages that hand somebody work. A coordinator may be briefed, asked, or reported to; it may not
 * be given the implementation. The list is the enforceable half of `coordinates_only` at this
 * layer — callers that know better pass `assignment` explicitly.
 */
export const ASSIGNMENT_STAGES = new Set([
  "assign", "implement", "build", "code", "fix", "patch", "refactor", "task", "work", "deliver",
]);

export function isAssignmentStage(stage) {
  return ASSIGNMENT_STAGES.has(String(stage || "").toLowerCase());
}

/** Does this agent record say "coordinates, does not implement"? Lead is the default case. */
export function coordinatesOnly(agent) {
  if (!agent) return false;
  if (typeof agent.coordinates_only === "boolean") return agent.coordinates_only;
  return agent.role === "lead";
}
