// Receiver-owned lead recovery (TM-167). Each enrolled repository's OWN supervisor keeps its lead
// alive; nobody else's process ever launches it.
//
// The policy, and why each branch is what it is:
//
//   responsive              reuse. Attempts, last error and backoff reset.
//   alive, unresponsive     leave it exactly as found. A busy agent is alive and unanswering; a
//                           restart would kill its work and a second session would give the repo two
//                           leads. Reported, backed off, never touched.
//   dead, externally owned  hold. A human's session is theirs to reopen or reassign; the alert names
//                           the command, is journalled once, and nothing is started in its place.
//   dead, managed           restart, but only through ensureLead, which re-reads the record and
//                           re-observes the RECORDED incarnation under the registration lock. A record
//                           with no exact binding cannot prove absence, and a tmux observation failure
//                           throws rather than reading as dead: both fail closed.
//   missing                 create, through the ordinary ensureLead create path.
//
// PROBING DISCIPLINE. A read-only look (ackTimeoutMs 0: cached proof only) costs a tmux listing. An
// active probe rings the pane and costs the agent a turn, so it happens only when someone needs the
// proof — a durable recovery request from held mail, or verification of a lead we just launched —
// at most once per backoff window, and outside every registration and message lock.
//
// Backoff is 10s, 30s, 2m, then 10m, keyed on consecutive attempts, and resets only when the lead is
// proven responsive. A successful launch counts as an attempt: a provider that starts and dies must
// not be relaunched every reconcile.
import { createHash } from "node:crypto";
import { appendFile, mkdir, readdir, rm } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { ensureLead, leadRegistryDir, leadState } from "./lead.mjs";
import { resolveEnrollment } from "./repo-enrollment.mjs";
import { canonicalRepoId, repoKey } from "./repoid.mjs";
import { nowIso, readJson, writeJson } from "./util.mjs";

export const RETRY_DELAYS_MS = Object.freeze([10_000, 30_000, 120_000, 600_000]);

/** Delay after the Nth consecutive attempt: 10s, 30s, 2m, then capped at 10m. */
export function retryDelayMs(attempts) {
  const n = Math.max(1, Math.trunc(Number(attempts)) || 1);
  return RETRY_DELAYS_MS[Math.min(n, RETRY_DELAYS_MS.length) - 1];
}

async function recoveryPaths({ consumer, env, home }) {
  const identity = await canonicalRepoId(consumer);
  const key = repoKey(identity.id), dir = leadRegistryDir(env, home);
  return {
    identity,
    state: join(dir, `${key}.recovery.json`),
    journal: join(dir, `${key}.recovery.jsonl`),
    requests: join(dir, "recovery-requests", key),
  };
}

async function readRequests(dir) {
  const names = (await readdir(dir).catch(() => [])).filter((name) => /^[0-9a-f]{64}\.json$/.test(name)).sort();
  const rows = await Promise.all(names.map(async (name) => ({ name, ...(await readJson(join(dir, name)).catch(() => ({}))) })));
  return rows;
}

/**
 * Ask this repository's own supervisor to recover its lead. Writes one durable marker and returns;
 * it never observes, probes or launches anything in the caller's process. The marker is keyed on
 * (message, reason), so a message that is resumed many times leaves one request, not many.
 */
export async function requestLeadRecovery({ consumer, reason = "unspecified", messageId = null, env = process.env, home = homedir() }) {
  const p = await recoveryPaths({ consumer, env, home });
  const name = createHash("sha256").update(`${messageId ?? ""}\0${reason}`).digest("hex");
  const file = join(p.requests, `${name}.json`);
  await writeJson(file, { repo_id: p.identity.id, consumer, reason, message_id: messageId, requested_at: nowIso() });
  return { requested: true, repo_id: p.identity.id, file };
}

function view(record) {
  return {
    action: record.action ?? null, attempts: record.attempts ?? 0, last_error: record.last_error ?? null,
    next_retry_at: record.next_retry_at ?? null, alert: record.alert ?? null,
    ...(record.verify ? { verify: true } : {}), ...(record.reverified_alive ? { reverified_alive: true } : {}),
  };
}

/** What `lead status` and `doctor` show: the last recovery decision and anything waiting on it. */
export async function leadRecoveryStatus({ consumer, env = process.env, home = homedir() }) {
  const p = await recoveryPaths({ consumer, env, home });
  const record = await readJson(p.state).catch(() => null);
  return { repo_id: p.identity.id, ...view(record ?? {}), pending_requests: (await readRequests(p.requests)).length,
    updated_at: record?.updated_at ?? null, state_path: p.state };
}

function deadExternalAlert(record, root) {
  const who = record.agent_name ? `${record.agent_name} (${record.agent_id})` : record.agent_id;
  const assign = `ao-topology lead assign ${record.agent_id} --session ${record.session} --consumer ${root}`;
  const replace = `ao-topology lead detach --consumer ${root} && ao-topology lead ensure --consumer ${root}`;
  return {
    code: "TOPOLOGY_LEAD_DEAD_EXTERNAL", agent_id: record.agent_id, session: record.session ?? null,
    message: `The externally owned lead ${who} for ${root} is dead. It is never replaced automatically; held mail waits until a human reassigns the repository.`,
    command: assign,
    alternatives: [replace],
  };
}

/**
 * One recovery step for the repository containing `consumer`. The supervisor calls this once per
 * reconcile; it is safe to call more often, because backoff and the registration lock bound what it
 * can do. Returns { action, attempts, last_error, next_retry_at, alert? }.
 */
export async function recoverLead({ consumer, env = process.env, home = homedir(), pluginRoot = null, now = Date.now,
  probes = null, enrollment = resolveEnrollment, ackTimeoutMs, log = () => {} }) {
  const enrolled = await enrollment({ consumer, env, home });
  if (!enrolled?.enrolled) return { ...view({ action: "not-enrolled" }), enrollment: enrolled ?? null };
  const root = enrolled.root ?? consumer;
  const p = await recoveryPaths({ consumer: root, env, home });
  const prior = (await readJson(p.state).catch(() => null)) ?? {};
  const attempts = prior.attempts ?? 0;
  const at = now();
  if (prior.next_retry_at && at < Date.parse(prior.next_retry_at)) return view({ ...prior, action: "backoff" });

  const pending = await readRequests(p.requests);
  const active = pending.length > 0 || prior.verify === true;
  // A supervisor started from inside a dedicated lead's session inherits AO_LEAD_ID, and ensureLead
  // would answer "self" and never recover anything. The supervisor is not the lead.
  const { AO_LEAD_ID: _lead, ...leadEnv } = env ?? {};
  const base = { consumer: root, env: leadEnv, home, pluginRoot, probes, log };

  const save = async (fields) => {
    const record = { version: 1, repo_id: p.identity.id, consumer: root, alert: null, verify: false, ...fields, updated_at: nowIso() };
    await writeJson(p.state, record);
    return view(record);
  };
  const failure = (action, error, extra = {}) => save({ action, attempts: attempts + 1, last_error: error,
    next_retry_at: new Date(at + retryDelayMs(attempts + 1)).toISOString(), verify: prior.verify === true, ...extra });
  // Not a failure and not a success: a lead that is alive and nobody asked to prove. Nothing to
  // retry, so nothing is backed off; the record is rewritten only when the answer changes.
  const neutral = async (action, extra = {}) => {
    if (prior.action === action && !extra.reverified_alive) return view(prior);
    return save({ action, attempts, last_error: prior.last_error ?? null, next_retry_at: null, verify: prior.verify === true, ...extra });
  };
  const success = async () => {
    const ids = [...new Set(pending.map((request) => request.message_id).filter(Boolean))];
    // Wake the held mail that asked for this proof BEFORE dropping the requests: if waking fails the
    // requests survive, and the next tick answers from the cached proof without ringing again.
    let woken = [];
    if (ids.length) woken = await (await import("./standing-mailbox.mjs")).wakeStandingMessages({ ids, env, home });
    await Promise.all(pending.map((request) => rm(join(p.requests, request.name), { force: true })));
    return { ...(await save({ action: "reused", attempts: 0, last_error: null, next_retry_at: null })), ...(woken.length ? { woken } : {}) };
  };
  const heldExternal = async (record) => {
    const alert = deadExternalAlert(record, root);
    const same = prior.alert?.code === alert.code && prior.alert?.agent_id === alert.agent_id && prior.alert?.session === alert.session;
    if (same && prior.alert?.journalled_at) alert.journalled_at = prior.alert.journalled_at;
    else {
      alert.journalled_at = nowIso();
      await mkdir(dirname(p.journal), { recursive: true });
      await appendFile(p.journal, `${JSON.stringify({ at: alert.journalled_at, event: "lead.dead_external", ...alert })}\n`);
    }
    return failure("held-dead-external", alert.message, { alert });
  };

  let result;
  try {
    // The only place a probe can ring, and it runs with no lock held.
    const observed = await leadState({ ...base, ...(active ? { ackTimeoutMs } : { ackTimeoutMs: 0 }) });
    if (observed.status === "responsive") return success();
    if (observed.status === "unresponsive") {
      return active ? failure("kept-unresponsive", "TOPOLOGY_LEAD_UNRESPONSIVE: the lead is alive but did not acknowledge a probe; it is left running and untouched")
        : neutral("kept-unresponsive");
    }
    if (observed.status === "registered" && (!observed.record.managed || observed.record.externally_owned)) return heldExternal(observed.record);
    // Missing, or dead and managed. ensureLead re-reads the record and re-observes the incarnation
    // under the registration lock; only if it is still gone does anything open.
    result = await ensureLead({ ...base, ackTimeoutMs: 0, restartRequiresBinding: true });
  } catch (error) {
    return failure("failed", `${error?.code ?? "ERROR"}: ${error?.message ?? String(error)}`);
  }
  if (result.action === "created" || result.action === "restarted") {
    return save({ action: result.action, attempts: attempts + 1, last_error: null, verify: true,
      next_retry_at: new Date(at + retryDelayMs(attempts + 1)).toISOString() });
  }
  if (result.action === "reused") return success();
  if (result.action === "dead-external") return heldExternal(result.record);
  // The in-lock re-observation found the lead alive after all: somebody restarted it, or the first
  // look was wrong. Either way nothing was opened.
  return neutral(result.action, { reverified_alive: true });
}
