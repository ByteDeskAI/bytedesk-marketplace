/**
 * The agent registry: which workers this machine has running, right now.
 *
 * Dispatch hands a task to a backend and gets a run handle back; nothing recorded
 * WHO that worker is as a process — its pid, its run id, whether it is still
 * alive. The registry is that record. It answers the questions a board full of
 * dispatched work cannot: what is running, and what only looks like it is.
 *
 * Two rules this module never breaks:
 *   1. It is per-machine runtime state, like state.json. `agents.json` is in the
 *      store's gitignore contract for the same reason the claims are: whose
 *      workers, on whose laptop, is not the shared record.
 *   2. It must never fail the thing it observes. Dispatch wraps every call here
 *      in try/catch; a broken registry is a missing dashboard panel, not a
 *      failed hand-off.
 */
import { readFileSync, renameSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { config, logEvent, now, read, state, update, withLock } from "./store.mjs";
import { ensureDirs, paths } from "./paths.mjs";
import { releaseClaim } from "./claims.mjs";

/** The registry file. A sibling of state.json — same lifetime, same gitignore rule. */
export function agentsFile(p = paths()) {
  return join(p.base, "agents.json");
}

/**
 * Same discipline as the store's writeAtomic: stage at `.tm-tmp-<pid>-<name>` (a
 * name no reader or id-prefix matcher can pick up), then rename over the target.
 * A crash between the two leaves a staging file, never a torn agents.json.
 */
function writeAtomic(file, text) {
  const tmp = join(dirname(file), `.tm-tmp-${process.pid}-${basename(file)}`);
  writeFileSync(tmp, text);
  renameSync(tmp, file);
}

function readRegistry(p) {
  try {
    const reg = JSON.parse(readFileSync(agentsFile(p), "utf8"));
    return reg && typeof reg === "object" && reg.agents ? reg : { agents: {} };
  } catch {
    return { agents: {} };
  }
}

/**
 * Register (or re-register) an agent. Upsert keyed on name: re-registering a
 * name the registry marked dead revives it, because the alternative — a worker
 * that came back and stayed "dead" in the panel — is the worse lie. registeredAt
 * survives the upsert; heartbeatAt is refreshed by the act of registering.
 */
export function registerAgent(
  { name, harness = null, capabilities = [], backend = null, runId = null, pid = null, session = null },
  p = paths(),
) {
  if (!name) throw new Error("registerAgent needs a name");
  const agent = withLock(p, () => {
    ensureDirs(p);
    const reg = readRegistry(p);
    const existing = reg.agents[name];
    const ts = now();
    const record = {
      name,
      harness: harness ?? existing?.harness ?? null,
      capabilities: capabilities ?? existing?.capabilities ?? [],
      backend: backend ?? existing?.backend ?? null,
      runId: runId ?? existing?.runId ?? null,
      pid: pid ?? existing?.pid ?? null,
      session: session ?? existing?.session ?? null,
      registeredAt: existing?.registeredAt ?? ts,
      heartbeatAt: ts,
      status: "active",
    };
    reg.agents = { ...reg.agents, [name]: record };
    writeAtomic(agentsFile(p), `${JSON.stringify(reg, null, 2)}\n`);
    return record;
  });
  logEvent("agent_registered", { agent: name, backend: agent.backend, runId: agent.runId }, p);
  return agent;
}

/**
 * Refresh one agent's heartbeat. Logs nothing on purpose: a heartbeat is a
 * pulse, and an event per pulse is the write stream that makes people switch
 * the log off.
 */
export function heartbeatAgent(name, p = paths()) {
  return withLock(p, () => {
    const reg = readRegistry(p);
    const rec = reg.agents[name];
    if (!rec) return null;
    reg.agents = { ...reg.agents, [name]: { ...rec, heartbeatAt: now() } };
    writeAtomic(agentsFile(p), `${JSON.stringify(reg, null, 2)}\n`);
    return reg.agents[name];
  });
}

/**
 * Mark a worker done on purpose: its run reached a terminal state and the
 * collector recorded it. Distinct from reaping — nothing went quiet here, the
 * ending was observed — so it logs nothing (the task_result event is the
 * record) and the entry stops counting against pool capacity immediately
 * instead of whenever the heartbeat TTL would have noticed.
 * Idempotent: retiring a dead or unknown agent changes nothing.
 */
export function retireAgent(name, p = paths()) {
  return withLock(p, () => {
    const reg = readRegistry(p);
    const rec = reg.agents[name];
    if (!rec || rec.status === "dead") return null;
    reg.agents = { ...reg.agents, [name]: { ...rec, status: "dead" } };
    writeAtomic(agentsFile(p), `${JSON.stringify(reg, null, 2)}\n`);
    return reg.agents[name];
  });
}

/**
 * A pid that answers signal 0 belongs to a live process. EPERM means it exists
 * and is somebody else's — still alive, just not ours to signal.
 */
function pidAlive(pid) {
  if (!pid || typeof pid !== "number") return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return err.code === "EPERM";
  }
}

/**
 * Alive means: the pid is live, OR the heartbeat is fresher than the TTL.
 * Two signals because neither alone is enough — a backend that reports no pid
 * still heartbeats, and a pid that never heartbeats is still a live process.
 * `agentTtlMinutes: 0` disables expiry, same convention as claimTtlMinutes.
 */
function alive(rec, p, at = Date.now()) {
  if (pidAlive(rec.pid)) return true;
  if (!rec.heartbeatAt) return false;
  const ttl = (config(p).agentTtlMinutes ?? 30) * 60_000;
  if (!ttl) return true;
  return at - Date.parse(rec.heartbeatAt) <= ttl;
}

/** Every registered agent, with liveness derived rather than trusted from disk. */
export function listAgents(p = paths()) {
  const at = Date.now();
  return Object.values(readRegistry(p).agents)
    .map((rec) => ({ ...rec, alive: rec.status !== "dead" && alive(rec, p, at) }))
    .sort((a, b) => String(a.name).localeCompare(String(b.name)));
}

/**
 * Mark every agent that has gone quiet as dead. Returns the names it reaped.
 * Idempotent: an agent already marked dead is not re-reaped and not re-logged —
 * a reaper that runs on a timer must not write the same event every pass.
 */
export function reapAgents(p = paths()) {
  const reaped = withLock(p, () => {
    const reg = readRegistry(p);
    const agents = { ...reg.agents };
    const dead = [];
    for (const [name, rec] of Object.entries(agents)) {
      if (rec.status === "dead" || alive(rec, p)) continue;
      agents[name] = { ...rec, status: "dead" };
      dead.push(name);
    }
    if (dead.length) writeAtomic(agentsFile(p), `${JSON.stringify({ ...reg, agents }, null, 2)}\n`);
    return dead;
  });
  if (reaped.length) logEvent("agent_reaped", { names: reaped }, p);
  return reaped;
}

/**
 * Reap dead agents, then unpark the board behind them.
 *
 * Marking a worker dead is only half the job: the task it held stays
 * `in_progress` with a claim nobody will ever release, which is exactly the lie
 * the SessionEnd parking path exists to prevent. So for every task claimed by a
 * dead agent's session this parks the task (the same update SessionEnd
 * performs), releases the claim, and logs one `worker_reaped` per task.
 *
 * Idempotent: the second pass finds no claims held by dead sessions, so it
 * parks nothing and logs nothing. Null-session claims are unowned — they belong
 * to no agent and are left alone.
 */
export function reapDeadWorkers(p = paths()) {
  const reaped = reapAgents(p);
  const deadBySession = new Map();
  for (const a of listAgents(p)) {
    if (!a.alive && a.session) deadBySession.set(a.session, a.name);
  }
  const parked = [];
  if (!deadBySession.size) return { reaped, parked };
  for (const [id, claim] of Object.entries(state(p).claims || {})) {
    const agent = claim.session ? deadBySession.get(claim.session) : null;
    if (!agent) continue;
    const task = read(id, p);
    if (task && task.status === "in_progress") {
      update(id, { status: "parked", parkedReason: `agent ${agent} died` }, p);
    }
    releaseClaim(id, p);
    logEvent("worker_reaped", { id, agent, session: claim.session }, p);
    parked.push({ id, agent, session: claim.session });
  }
  return { reaped, parked };
}

/**
 * Human-readable listing for the CLI surface (wired by the lead in a later task).
 * One line per agent; dead agents say so first, because that is the question
 * someone running `tm agents` is asking.
 */
export function renderAgents(list) {
  if (!list.length) return "(no agents registered)";
  return list
    .map((a) =>
      [
        a.alive ? "alive " : "dead  ",
        a.name,
        a.backend ? `backend=${a.backend}` : "",
        a.runId ? `run=${a.runId}` : "",
        a.pid ? `pid=${a.pid}` : "",
        a.session ? `session=${a.session}` : "",
        `heartbeat=${a.heartbeatAt || "never"}`,
      ]
        .filter(Boolean)
        .join("  "),
    )
    .join("\n");
}
