// Named serial slots: one holder at a time, a mechanical queue behind it.
//
// The conductor ran SERIAL SLOT REQUEST / GRANTED / RELEASED by hand across forty panes, plus a
// "cutover lock", a "deploy-safe lock" and a "no-restart hold". This is that protocol, with the
// hand-rolled heredocs deleted.
//
// `withLock` is the WRONG holder and the RIGHT mutex. It releases the moment its function returns,
// while a slot is held across many turns of a conversation by an agent that is not a running
// function. So withLock serialises every mutation of the record, and **the record is the holder**.
// Slot lifetime and lock lifetime are unrelated, deliberately.
//
// Grant is MECHANICAL. `reconcile()` is a pure function called from `slot request`, `slot status`
// and the supervise tick; `release` only clears the holder, and the next tick grants the head of
// the queue whether or not anybody looks. That is what makes a handover cost ZERO model turns on
// either side. `grantSlot` exists only as a lead-only override and records the tickets it jumped.
//
// Liveness is the tmux six-tuple, not a pid, so reclamation works identically on macOS. Age NEVER
// reclaims: `status` reports `held_for_ms` and flags a hold past its declared `--expect`, and that
// is all. The remedy for a long hold is a human.
//
// RESIDUAL GAP, documented rather than papered over: `lockfile.mjs`'s own reclamation of a crashed
// LOCK owner is Linux-only (it reads /proc for the process start time). On macOS `processIdentity`
// returns null, `dead()` is true only on ESRCH, and a lock whose owner cannot be identified fails
// closed with TOPOLOGY_LOCK_TIMEOUT. Slot RECLAMATION is unaffected — the six-tuple is portable —
// but a mutation blocked behind a crashed lock owner still needs an operator on macOS.
import { createHash, timingSafeEqual } from "node:crypto";
import { readdir } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { withLock } from "./lockfile.mjs";
import { PRESENCE_BINDING_FIELDS } from "./presence.mjs";
import { canonicalRepoId, repoKey, stateRoot } from "./repoid.mjs";
import { listServerPanes } from "./tmux.mjs";
import { invariant, nowIso, readJson, writeJson } from "./util.mjs";

export const SLOT_RECORD_VERSION = 1;
/** Three names, because they are names and not code. Any valid name works; these are the observed ones. */
export const SHIPPED_SLOTS = Object.freeze(["integration", "cutover", "deploy-safe"]);
/** Validated BEFORE the name is ever joined to a path. `/` and `..` never become a path. */
export const SLOT_NAME = /^[a-z0-9][a-z0-9-]{0,63}$/;
const HISTORY_LIMIT = 50;

const bindingKey = (binding) => JSON.stringify(PRESENCE_BINDING_FIELDS.map((field) => binding?.[field]));
const validBinding = (binding) => Boolean(binding)
  && ["serverKey", "sessionId", "paneId"].every((k) => typeof binding[k] === "string" && binding[k])
  && ["serverPid", "sessionCreated", "panePid"].every((k) => Number.isSafeInteger(binding[k]) && binding[k] > 0);
const sameBinding = (a, b) => validBinding(a) && validBinding(b) && bindingKey(a) === bindingKey(b);

export function assertSlotName(name) {
  invariant(typeof name === "string" && SLOT_NAME.test(name), "TOPOLOGY_SLOT_NAME_INVALID",
    `A slot name must match ${SLOT_NAME} (got ${JSON.stringify(name)}). Names are joined to a path, so this is checked first.`);
  return name;
}

/** One directory per repository, keyed by the git common directory: every linked worktree shares one slot. */
export function slotsDir(identity, env = process.env, home = homedir()) {
  return join(stateRoot(env, home), "slots", repoKey(identity.id));
}

function slotPaths(identity, name, env, home) {
  const dir = slotsDir(identity, env, home);
  return { dir, record: join(dir, `${assertSlotName(name)}.json`), lock: join(dir, `${name}.lock`) };
}

function emptyRecord(identity, name) {
  return { version: SLOT_RECORD_VERSION, name, repo_id: identity.id, next_ticket: "1", holder: null, queue: [], history: [] };
}

async function readRecord(path, identity, name) {
  const record = await readJson(path).catch((error) => { if (error.code === "ENOENT") return null; throw error; });
  if (!record) return emptyRecord(identity, name);
  return { ...emptyRecord(identity, name), ...record, queue: record.queue ?? [], history: record.history ?? [] };
}

/**
 * Fairness is a monotonic decimal STRING, allocated under the lock and never reset — not a
 * timestamp. Clocks tie and clocks skew; two requests in the same millisecond have no order, and a
 * queue ordered by time reorders itself when a machine's clock steps. BigInt so it never rounds.
 */
function allocate(record) {
  const ticket = String(BigInt(record.next_ticket || "1"));
  record.next_ticket = String(BigInt(ticket) + 1n);
  return ticket;
}

/**
 * Tri-state liveness over an already-taken pane listing.
 *
 *   true  — the six-tuple is present and the pane is alive
 *   false — the listing SUCCEEDED and the six-tuple is not in it: provably gone
 *   null  — no listing (tmux unreadable): nothing is provable, so nothing changes
 *
 * The null rung deliberately DEPARTS from the brief's "vacate a holder that is not provably
 * alive". For a mutual-exclusion primitive that wording is a correctness bug: a tmux hiccup would
 * vacate a live holder and grant the same cutover slot to a second agent. Reclamation therefore
 * requires proof of ABSENCE, exactly as `lockfile.mjs` fails closed on unknown ownership and the
 * census refuses to read a failed capture as an empty screen.
 */
export function liveness(panes) {
  if (!panes) return () => null;
  const index = new Set(panes.filter((pane) => pane.alive !== false).map(bindingKey));
  return (binding) => (validBinding(binding) ? index.has(bindingKey(binding)) : false);
}

/**
 * The whole point: grant is mechanical. Pure, idempotent, no I/O, no clock beyond `at`.
 * Returns the ORIGINAL record object when nothing moved, so a caller can skip the write and
 * "reconcile twice" is byte-identical by construction.
 */
export function reconcile(record, alive, at = nowIso()) {
  const events = [];
  let holder = record.holder;
  let queue = record.queue;
  if (holder && alive(holder.binding) === false) {
    events.push({ type: "vacated", at, name: record.name, agent_id: holder.agent_id, ticket: holder.ticket, reason: holder.reason, why: "binding-absent" });
    holder = null;
  }
  // The SAME liveness test as the holder, applied to queue entries. Without it the queue outlives
  // the agents in it: a dead ticket sits at the head forever, everyone behind starves, and
  // `status` cheerfully reports success.
  const dropped = queue.filter((entry) => alive(entry.binding) === false);
  if (dropped.length) {
    for (const entry of dropped) events.push({ type: "dropped", at, name: record.name, agent_id: entry.agent_id, ticket: entry.ticket, reason: entry.reason, why: "binding-absent" });
    queue = queue.filter((entry) => alive(entry.binding) !== false);
  }
  // FIFO by ticket, unconditionally. No policy, no scoring, nothing to disagree about.
  if (!holder && queue.length) {
    const head = queue[0];
    // The grant records the binding it was CHECKED against, so a grant nobody can prove is
    // reclaimed on the next tick rather than honoured.
    holder = { ...head, granted_at: at, granted_binding: head.binding };
    queue = queue.slice(1);
    events.push({ type: "granted", at, name: record.name, agent_id: holder.agent_id, ticket: holder.ticket, reason: holder.reason });
  }
  if (!events.length) return { record, events };
  return { record: { ...record, holder, queue, history: [...record.history, ...events].slice(-HISTORY_LIMIT) }, events };
}

function findEntry(record, agentId) {
  if (record.holder?.agent_id === agentId) return record.holder;
  return record.queue.find((entry) => entry.agent_id === agentId) ?? null;
}

async function panesFor(bindings, { env = process.env, listPanesFn = listServerPanes, panes } = {}) {
  if (panes !== undefined) return panes;
  const servers = [...new Set(bindings.map((binding) => binding?.serverKey).filter(Boolean))];
  if (!servers.length) return [];
  try { return (await Promise.all(servers.map((server) => listPanesFn({ tmuxServer: server, env })))).flat(); }
  catch (error) { if (error?.code !== "TOPOLOGY_TMUX_OBSERVATION_FAILED") throw error; return null; }
}

function recordBindings(record) {
  return [record.holder?.binding, ...record.queue.map((entry) => entry.binding)].filter(Boolean);
}

/** This process's own incarnation, from $TMUX plus the live listing. The proof of "I am here". */
export async function resolveBinding({ env = process.env, listPanesFn = listServerPanes } = {}) {
  const match = /^(.*),([0-9]+),[^,]+$/.exec(env.TMUX ?? "");
  invariant(match && env.TMUX_PANE, "TOPOLOGY_SLOT_BINDING_REQUIRED",
    "A slot request must come from inside a tmux pane: liveness is the tmux six-tuple, and a request with no incarnation could never be reclaimed, so it would starve the queue forever.");
  const panes = await listPanesFn({ tmuxServer: match[1], env });
  const pane = panes.find((row) => row.paneId === env.TMUX_PANE && row.serverKey === match[1] && row.serverPid === Number(match[2]));
  invariant(pane && pane.alive !== false, "TOPOLOGY_SLOT_BINDING_REQUIRED", `Pane ${env.TMUX_PANE} is not on server ${match[1]}; this incarnation cannot be identified.`);
  return Object.fromEntries(PRESENCE_BINDING_FIELDS.map((field) => [field, pane[field]]));
}

/** Write only when the bytes would actually differ: a polling agent must cost a read, not a write. */
async function commit(paths, next, previous) {
  if (JSON.stringify(next) !== JSON.stringify(previous)) await writeJson(paths.record, next);
  return next;
}

/**
 * Request the slot. Idempotent for a repeated request by the same agent: SAME ticket, SAME
 * position. A polling agent is never sent to the back of its own queue — and because it is
 * demonstrably alive while it is asking, its binding is re-stamped before reconcile runs, so a
 * poller cannot be dropped by the very call it is making.
 */
export async function requestSlot({ consumer, name, agentId = process.env.AO_AGENT_ID, reason, expectMs = null, runDir = null,
  env = process.env, home = homedir(), listPanesFn = listServerPanes, binding = null } = {}) {
  assertSlotName(name);
  invariant(typeof agentId === "string" && agentId, "TOPOLOGY_SLOT_AGENT_REQUIRED", "A slot request must name the requesting agent (AO_AGENT_ID or --agent).");
  invariant(typeof reason === "string" && reason.trim(), "TOPOLOGY_SLOT_REASON_REQUIRED",
    "--reason is required. Every observed transcript carried one, and it is the entire operator value of `slot status`.");
  const identity = await canonicalRepoId(consumer);
  const paths = slotPaths(identity, name, env, home);
  const mine = binding ?? await resolveBinding({ env, listPanesFn });
  const outcome = await withLock(paths.lock, async () => {
    const previous = await readRecord(paths.record, identity, name);
    let working = previous;
    const existing = findEntry(working, agentId);
    let ticket;
    if (existing) {
      ticket = existing.ticket;
      // Same ticket, same position; only the incarnation is refreshed. The reason of record is the
      // one the slot was first asked for with — a poll must not rewrite history.
      working = {
        ...working,
        holder: working.holder?.agent_id === agentId ? { ...working.holder, binding: mine } : working.holder,
        queue: working.queue.map((entry) => (entry.agent_id === agentId ? { ...entry, binding: mine } : entry)),
      };
    } else {
      working = { ...working, queue: [...working.queue] };
      ticket = allocate(working);
      working.queue.push({ agent_id: agentId, ticket, reason: reason.trim(), binding: mine, expect_ms: expectMs, run_dir: runDir, requested_at: nowIso() });
    }
    const alive = liveness(await panesFor([...recordBindings(working), mine], { env, listPanesFn }));
    const { record, events } = reconcile(working, alive);
    await commit(paths, record, previous);
    return { record, events, ticket };
  });
  return describe(outcome.record, { agentId, ticket: outcome.ticket, events: outcome.events });
}

/**
 * Release. Only clears the holder — it never grants. The grant happens on the next tick whether or
 * not anybody looks, which is what keeps a handover at zero model turns on both sides.
 *
 * Two accepted proofs, because AO_AGENT_TOKEN is minted per agent PER RUN and a standing lead or
 * reviewer has none. Neither proof → TOPOLOGY_SLOT_NOT_HOLDER with the record UNCHANGED: this
 * function does not reconcile, so a refused release cannot move a single byte.
 */
export async function releaseSlot({ consumer, name, agentId = process.env.AO_AGENT_ID, runDir = null, token = process.env.AO_AGENT_TOKEN,
  env = process.env, home = homedir(), listPanesFn = listServerPanes } = {}) {
  assertSlotName(name);
  const identity = await canonicalRepoId(consumer);
  const paths = slotPaths(identity, name, env, home);
  return withLock(paths.lock, async () => {
    const previous = await readRecord(paths.record, identity, name);
    const holder = previous.holder;
    invariant(holder, "TOPOLOGY_SLOT_NOT_HELD", `Slot ${name} has no holder to release.`);
    const proof = await proveHolder(holder, { identity, agentId, runDir, token, env, listPanesFn });
    invariant(proof, "TOPOLOGY_SLOT_NOT_HOLDER",
      `Release of ${name} was not proven to come from its holder (${holder.agent_id}). A run agent proves its AO_AGENT_TOKEN against the run record; a standing agent proves AO_AGENT_ID + AO_CONSUMER + the exact pane. The record is unchanged.`);
    const event = { type: "released", at: nowIso(), name, agent_id: holder.agent_id, ticket: holder.ticket, reason: holder.reason, proof };
    const record = { ...previous, holder: null, history: [...previous.history, event].slice(-HISTORY_LIMIT) };
    await writeJson(paths.record, record);
    return describe(record, { agentId, events: [event] });
  });
}

async function proveHolder(holder, { identity, agentId, runDir, token, env, listPanesFn }) {
  if (!agentId || holder.agent_id !== agentId) return null;
  // Proof 1 — a run agent. The launcher exported a secret into its environment and the run recorded
  // the digest; compare in constant time, exactly as `recordReply` does.
  const dir = runDir ?? holder.run_dir ?? null;
  if (dir && typeof token === "string" && token.length) {
    const run = await readJson(join(dir, "run.json")).catch(() => null);
    const entry = (run?.agents ?? []).find((agent) => agent.id === agentId);
    const expected = entry?.token_sha256 || entry?.token;
    if (expected) {
      const presented = entry.token_sha256 ? createHash("sha256").update(token).digest("hex") : token;
      const a = Buffer.from(String(presented)), b = Buffer.from(String(expected));
      if (a.length === b.length && timingSafeEqual(a, b)) return "run-token";
    }
  }
  // Proof 2 — a standing agent, which has no per-run token. Assigned identity, this repository, and
  // the EXACT challenged pane, exactly as `acknowledgeEnrollment` does.
  if (env.AO_AGENT_ID === agentId && env.AO_CONSUMER) {
    const consumerIdentity = await canonicalRepoId(env.AO_CONSUMER).catch(() => null);
    if (consumerIdentity?.id === identity.id) {
      const here = await resolveBinding({ env, listPanesFn }).catch(() => null);
      if (sameBinding(here, holder.binding)) return "standing-pane";
    }
  }
  return null;
}

/** Reconcile then report. Reading the status is enough to move the queue; nobody has to run a verb. */
export async function slotStatus({ consumer, name = null, env = process.env, home = homedir(), listPanesFn = listServerPanes, panes } = {}) {
  const identity = await canonicalRepoId(consumer);
  const names = name ? [assertSlotName(name)] : await listSlotNames(identity, env, home);
  const results = [];
  for (const slot of names) results.push(await reconcileOne(identity, slot, { env, home, listPanesFn, panes }));
  return name ? results[0] : { repo_id: identity.id, slots: results.map((result) => result) };
}

async function listSlotNames(identity, env, home) {
  const entries = await readdir(slotsDir(identity, env, home)).catch((error) => { if (error.code === "ENOENT") return []; throw error; });
  return entries.filter((entry) => entry.endsWith(".json")).map((entry) => entry.slice(0, -5)).filter((entry) => SLOT_NAME.test(entry)).sort();
}

async function reconcileOne(identity, name, { env, home, listPanesFn, panes, lockTimeoutMs = 30_000 }) {
  const paths = slotPaths(identity, name, env, home);
  const outcome = await withLock(paths.lock, async () => {
    const previous = await readRecord(paths.record, identity, name);
    const alive = liveness(await panesFor(recordBindings(previous), { env, listPanesFn, panes }));
    const { record, events } = reconcile(previous, alive);
    await commit(paths, record, previous);
    return { record, events };
  }, { timeoutMs: lockTimeoutMs });
  return describe(outcome.record, { events: outcome.events });
}

/**
 * The supervise tick's entry point. Reuses the pane listing the tick has ALREADY taken, so a
 * mechanical grant costs zero extra tmux calls and zero model turns.
 */
export async function reconcileSlots({ consumer, env = process.env, home = homedir(), listPanesFn = listServerPanes, panes, identity,
  lockTimeoutMs = 250 } = {}) {
  const id = identity ?? await canonicalRepoId(consumer);
  const names = await listSlotNames(id, env, home);
  const results = [];
  for (const name of names) {
    // A slot whose lock is busy is being mutated by the agent that owns the mutation, and THAT path
    // reconciles too — so the tick skips it rather than blocking the supervisor behind a lock whose
    // owner it cannot identify (on macOS `lockfile.mjs` fails closed after the full timeout).
    try { results.push(await reconcileOne(id, name, { env, home, listPanesFn, panes, lockTimeoutMs })); }
    catch (error) { if (error?.code !== "TOPOLOGY_LOCK_TIMEOUT") throw error; }
  }
  return results;
}

/**
 * Quota failover respawns an agent in the same pane with a new panePid, which makes its recorded
 * six-tuple provably absent — so without this call every failover silently forfeits that agent's
 * slot and its place in every queue. Called by `failoverAgent` after it re-stamps `entry.binding`.
 */
export async function restampSlotBindings({ consumer, agentId, binding, env = process.env, home = homedir() } = {}) {
  if (!agentId || !validBinding(binding)) return [];
  const identity = await canonicalRepoId(consumer);
  const touched = [];
  for (const name of await listSlotNames(identity, env, home)) {
    const paths = slotPaths(identity, name, env, home);
    await withLock(paths.lock, async () => {
      const previous = await readRecord(paths.record, identity, name);
      if (!findEntry(previous, agentId)) return;
      await writeJson(paths.record, {
        ...previous,
        holder: previous.holder?.agent_id === agentId ? { ...previous.holder, binding } : previous.holder,
        queue: previous.queue.map((entry) => (entry.agent_id === agentId ? { ...entry, binding } : entry)),
      });
      touched.push(name);
    });
  }
  return touched;
}

/**
 * LEAD-ONLY OVERRIDE. Not part of the protocol: the mechanical grant in `reconcile` is, and it
 * needs no verb. This exists for a human deciding to jump the queue, and it records every ticket it
 * jumped so that decision is visible afterwards. Nobody should wire this into a loop; the help
 * string says so.
 */
export async function grantSlot({ consumer, name, to, env = process.env, home = homedir(), listPanesFn = listServerPanes,
  leadFn = null } = {}) {
  assertSlotName(name);
  invariant(typeof to === "string" && to, "TOPOLOGY_SLOT_AGENT_REQUIRED", "grant requires --to <agent>.");
  const identity = await canonicalRepoId(consumer);
  const readLead = leadFn ?? (await import("./lead.mjs")).readLeadRegistration;
  const registration = await readLead({ consumer, env, home });
  invariant(registration?.record?.agent_id && env.AO_AGENT_ID === registration.record.agent_id,
    "TOPOLOGY_SLOT_NOT_LEAD",
    "`slot grant` is a lead-only override that jumps the queue. The ordinary handover is mechanical — `slot release`, then the next supervise tick grants the head of the queue with no verb and no model turn.");
  const paths = slotPaths(identity, name, env, home);
  const outcome = await withLock(paths.lock, async () => {
    const previous = await readRecord(paths.record, identity, name);
    const existing = previous.queue.find((entry) => entry.agent_id === to);
    invariant(existing, "TOPOLOGY_SLOT_NOT_QUEUED", `${to} is not in ${name}'s queue; an override promotes a waiting request, it does not invent one.`);
    const jumped = previous.queue.filter((entry) => byTicket(entry.ticket, existing.ticket) < 0).map((entry) => ({ agent_id: entry.agent_id, ticket: entry.ticket }));
    const event = { type: "granted", at: nowIso(), name, agent_id: to, ticket: existing.ticket, reason: existing.reason,
      why: "lead-override", by: env.AO_AGENT_ID, jumped };
    const record = { ...previous,
      holder: { ...existing, granted_at: event.at, granted_binding: existing.binding, override: { by: env.AO_AGENT_ID, jumped: event.jumped } },
      queue: previous.queue.filter((entry) => entry.agent_id !== to),
      history: [...previous.history, event].slice(-HISTORY_LIMIT) };
    await writeJson(paths.record, record);
    return { record, events: [event] };
  });
  return describe(outcome.record, { events: outcome.events });
}

/** Decimal-string ticket order, without ever turning a ticket into a float. */
export function byTicket(a, b) {
  const x = String(a), y = String(b);
  return x.length === y.length ? (x < y ? -1 : x > y ? 1 : 0) : x.length - y.length;
}

function describe(record, { agentId = null, ticket = null, events = [] } = {}) {
  const now = Date.now();
  const holder = record.holder ? {
    ...record.holder,
    held_for_ms: Math.max(0, now - Date.parse(record.holder.granted_at ?? record.holder.requested_at ?? nowIso())),
  } : null;
  // Age NEVER reclaims. `overdue` is a flag for a human, and nothing in reconcile reads it.
  if (holder && Number.isFinite(holder.expect_ms) && holder.expect_ms > 0) holder.overdue = holder.held_for_ms > holder.expect_ms;
  const mine = agentId ? (holder?.agent_id === agentId ? "holder" : record.queue.some((entry) => entry.agent_id === agentId) ? "queued" : "absent") : null;
  return {
    name: record.name, repo_id: record.repo_id, holder,
    queue: record.queue.map((entry, index) => ({ ...entry, position: index + 1 })),
    next_ticket: record.next_ticket,
    you: agentId ? { agent_id: agentId, ticket, status: mine, position: record.queue.findIndex((entry) => entry.agent_id === agentId) + 1 || null } : null,
    events, history: record.history,
  };
}

/**
 * The observed transcript lines, reproduced closely enough that the hand-rolled shell that
 * printed them gets DELETED rather than reworded.
 */
export function formatSlot(view) {
  const lines = [];
  for (const event of view.events ?? []) {
    if (event.type === "granted") lines.push(`SERIAL SLOT GRANTED: ${event.name} to ${event.agent_id} for ${event.reason}${event.why === "lead-override" ? ` (lead override by ${event.by}, jumping ${event.jumped.map((j) => j.ticket).join(", ") || "nobody"})` : ""}`);
    if (event.type === "released") lines.push(`SERIAL SLOT RELEASED: ${event.name} by ${event.agent_id}`);
    if (event.type === "vacated") lines.push(`SERIAL SLOT VACATED: ${event.name} from ${event.agent_id} — pane gone`);
    if (event.type === "dropped") lines.push(`SERIAL SLOT DROPPED: ${event.name} ticket ${event.ticket} (${event.agent_id}) — pane gone`);
  }
  if (view.you?.status === "queued") lines.push(`SERIAL SLOT REQUEST: ${view.name} by ${view.you.agent_id} — queued at position ${view.you.position}, ticket ${view.you.ticket ?? "?"}`);
  const holder = view.holder;
  lines.push(holder
    ? `${view.name}: held by ${holder.agent_id} for ${holder.reason} (${Math.round(holder.held_for_ms / 1000)}s${holder.overdue ? `, OVERDUE past its declared ${Math.round(holder.expect_ms / 1000)}s — a long hold is a human's call, never a reclamation` : ""})`
    : `${view.name}: free`);
  for (const entry of view.queue ?? []) lines.push(`  ${entry.position}. ${entry.agent_id} ticket ${entry.ticket} — ${entry.reason}`);
  return lines.join("\n");
}

/** Ring the new holder. Best effort and out of band: the grant already happened under the lock. */
export async function notifyGrants(events, { consumer, env = process.env, home = homedir() } = {}) {
  const rung = [];
  for (const event of events.filter((item) => item.type === "granted")) {
    const { sendStandingMessage } = await import("./standing-mailbox.mjs");
    // The id is derived from the grant, so a retried tick delivers nothing twice.
    const id = createHash("sha256").update(`slot-grant:${event.name}:${event.ticket}:${event.agent_id}`).digest("hex").slice(0, 32);
    const result = await sendStandingMessage({ consumer, to: event.agent_id, id, subject: `serial slot ${event.name}`,
      body: `SERIAL SLOT GRANTED: ${event.name} to ${event.agent_id} for ${event.reason}\n\nYou now hold the ${event.name} slot. Do the work in the same turn you read this. Release it with \`ao-topology slot release ${event.name}\` when you are done — the next holder is granted mechanically on the following tick, so nobody is waiting on you to hand it over by hand.`,
    }, { env, home }).catch((error) => ({ status: "failed", reason: error?.code ?? String(error) }));
    rung.push({ ticket: event.ticket, agent_id: event.agent_id, status: result.status });
  }
  return rung;
}

