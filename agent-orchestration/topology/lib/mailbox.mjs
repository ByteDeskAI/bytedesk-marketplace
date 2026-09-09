// File-first messaging. A message is a Markdown file in the recipient's inbox; the reply is a file in
// the recipient's outbox with the same sequence number. tmux only ever delivers a one-line pointer.
// Every send and reply is appended to run_dir/journal.jsonl.
import { createHash, randomUUID, timingSafeEqual } from "node:crypto";
import { appendFile, readdir, readFile, stat, open, rename, rm } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { exists, invariant, nowIso, readJson, sleep, writeJson, writeText } from "./util.mjs";
import { MAX_HOPS, hopExceeded, isAssignmentStage, nextVia, sameProject } from "./routing.mjs";
import { agentDirs, findLead } from "./agents.mjs";
import { withLock } from "./lockfile.mjs";

export const RUN_FILE = "run.json";
export const JOURNAL_FILE = "journal.jsonl";

export function agentDir(runDir, agentId) {
  return join(runDir, "agents", agentId);
}

export async function loadRun(runDir) {
  const path = join(runDir, RUN_FILE);
  invariant(await exists(path), "TOPOLOGY_RUN_NOT_FOUND", `No ${RUN_FILE} in ${runDir}. Pass --run <run_dir> from \`ao-topology launch\` output.`);
  return readJson(path);
}

export async function saveRun(runDir, run) {
  run.updated = nowIso();
  const file = join(runDir, RUN_FILE);
  const temp = `${file}.${randomUUID()}.tmp`;
  try {
    const handle = await open(temp, 'wx', 0o600);
    try { await handle.writeFile(`${JSON.stringify(run, null, 2)}\n`); await handle.sync(); }
    finally { await handle.close(); }
    await rename(temp, file);
    if (process.platform !== 'win32') {
      const directory = await open(runDir, 'r');
      try { await directory.sync(); } finally { await directory.close(); }
    }
  } finally { await rm(temp, { force: true }); }
}

/**
 * Note that a message addressed to one agent was actually delivered to another, so a wait on the
 * original addressee is satisfied by the answer from whoever received it. Without this a correctly
 * handled redirect still times the sender out.
 */
export async function recordRedirect(runDir, { messageId, intended, deliveredTo, reason }) {
  return withLock(join(runDir, '.mailbox-sequence.lock'), async () => {
    const run = await loadRun(runDir);
    run.redirects = run.redirects || {};
    run.redirects[`${messageId}:${intended}`] = deliveredTo;
    await saveRun(runDir, run);
    await appendJournal(runDir, { type: "route.redirect", id: messageId, intended, delivered_to: deliveredTo, reason: reason || null });
    return run.redirects;
  });
}

export async function appendJournal(runDir, event) {
  const record = { ts: nowIso(), ...event };
  await appendFile(join(runDir, JOURNAL_FILE), `${JSON.stringify(record)}\n`, "utf8");
  return record;
}

export async function readJournal(runDir, limit = 50) {
  const path = join(runDir, JOURNAL_FILE);
  if (!(await exists(path))) return [];
  const lines = (await readFile(path, "utf8")).trim().split(/\r?\n/).filter(Boolean);
  return lines.slice(-limit).map((line) => {
    try {
      return JSON.parse(line);
    } catch {
      return { ts: null, type: "unparseable", raw: line };
    }
  });
}

async function nextSequence(runDir, idempotencyKey, fingerprint) {
  return withLock(join(runDir, '.mailbox-sequence.lock'), async () => {
    const run = await loadRun(runDir);
    const key = idempotencyKey === undefined ? null : createHash('sha256').update(String(idempotencyKey)).digest('hex');
    if (key && run.message_keys?.[key]) {
      const prior = run.message_keys[key];
      invariant(prior.fingerprint === fingerprint, 'TOPOLOGY_MESSAGE_ID_CONFLICT', 'Idempotency key already identifies different content or provenance.');
      return { seq: prior.seq, run };
    }
    run.sequence = (run.sequence ?? 0) + 1;
    const seq = String(run.sequence).padStart(3, '0');
    if (key) { run.message_keys ??= {}; run.message_keys[key] = { seq, fingerprint }; }
    await saveRun(runDir, run);
    return { seq, run };
  });
}

export function messageFileName(seq, stage) {
  return `${seq}-${stage}.md`;
}

/** A reply file counts only when it has content. */
async function hasAnswer(path) {
  if (!(await exists(path))) return false;
  try {
    return (await readFile(path, "utf8")).trim().length > 0;
  } catch {
    return false;
  }
}

export function replyFileName(seq, stage) {
  return `${seq}-${stage}.reply.md`;
}

function frontmatter(fields) {
  const lines = Object.entries(fields)
    .filter(([, value]) => value !== undefined && value !== null && value !== "")
    .map(([key, value]) => `${key}: ${Array.isArray(value) ? value.join(", ") : value}`);
  return `---\n${lines.join("\n")}\n---\n`;
}

/**
 * Write one message into each recipient's inbox. Returns the message id and the list of
 * { agent, inbox, outbox } paths so the caller can deliver a pointer through tmux.
 */
export async function sendMessage({ runDir, from, to, stage, body, contract, round, subject, route, fromProject, task, via = [], assignment, consumer, idempotencyKey, token, provenance, parentId, standingOptions = {}, addressing = {}, env = process.env }) {
  invariant(Array.isArray(to) && to.length > 0, "TOPOLOGY_RECIPIENT_REQUIRED", "A message needs at least one recipient (--to <agent-id>).");
  invariant(typeof body === "string" && body.trim(), "TOPOLOGY_BODY_REQUIRED", "A message needs a body (--file <path> or --body <text>).");
  // The hop limit is enforced here, on the send path, because this is the only place every hop
  // passes through. A guard that is only consulted by the router would not see a message that a
  // lead forwards by hand, which is exactly the hop that runs away.
  const chain = Array.isArray(via) ? via.filter(Boolean).map(String) : [];
  invariant(
    !hopExceeded(chain),
    "TOPOLOGY_HOP_LIMIT",
    `This message has already been forwarded ${chain.length} times (${chain.join(" → ")}); the limit is ${MAX_HOPS}. Answer it or drop it rather than passing it on again.`,
  );
  const isAssignment = assignment === undefined ? isAssignmentStage(stage) : assignment === true;
  invariant(idempotencyKey === undefined || (typeof idempotencyKey === 'string' && idempotencyKey.length > 0 && idempotencyKey.length <= 256), 'TOPOLOGY_MESSAGE_ID_INVALID', 'Idempotency key must be a nonempty string of at most 256 characters.');
  const declaredSource = fromProject || env.AO_CONSUMER || null;
  const sourceProject = declaredSource ? resolve(declaredSource) : null;
  const existing = await loadRun(runDir);
  const destination = existing.consumer || consumer;
  invariant(destination, 'TOPOLOGY_RUN_CONSUMER_REQUIRED', 'Legacy run has no destination repository; pass explicit consumer context before sending.');
  const external = !sourceProject || !(await sameProject(sourceProject, destination));
  // THE one expansion point. A fan-out is addressed collectively by the id that produced it
  // (`--to per-file` reaches every `per-file.<item>`), and an `@` audience names a whole room —
  // both resolve to concrete agent ids here, before the per-recipient loop and before the
  // external/standing branch below, so a broadcast is N ordinary sends each individually admitted
  // through the identical path. `forwardMessageToWorkflow` routes back through this function, so
  // there is no way around it by control flow, never mind by convention.
  //
  // It sits BELOW the `external` computation because TOPOLOGY_BROADCAST_EXTERNAL depends on it, and
  // ABOVE `nextSequence` because every reason a broadcast is refused — an unknown audience, an
  // audience that names nobody, one wider than the limit, an outsider addressing a room — is
  // knowable from the run roster the `loadRun` above already produced. Refusing here consumes no
  // sequence number and writes no envelope, so a refused broadcast leaves run.json byte-identical.
  // The alternative, allocating and rolling back, cannot be made safe: `nextSequence` hands numbers
  // out under `.mailbox-sequence.lock` and a second sender can already hold the next one, so a
  // rollback either reuses a live number or leaves the gap it meant to close.
  const { expandAddresses } = await import('./addressing.mjs');
  const recipients = await expandAddresses({ run: existing, to, from, external, consumer: destination,
    env, home: standingOptions.home, ...addressing });
  const fingerprint = createHash('sha256').update(JSON.stringify({ from, to, stage, body, contract, round, subject, sourceProject, destination, task, chain, isAssignment, token, provenance, parentId })).digest('hex');
  const { seq, run } = await nextSequence(runDir, idempotencyKey, fingerprint);
  const known = new Set(run.agents.map((agent) => agent.id));
  const id = `${seq}-${stage}`;
  // Persist the original content/source once. Child workflow forwarding reads
  // this envelope, never mutable CLI flags or the forwarding process's cwd/env.
  const envelope = JSON.parse(JSON.stringify({ id, from, to, stage, body,
    contract: contract ?? null, round: round ?? null, subject: subject ?? null,
    fromProject: sourceProject, consumer: destination, task: task ?? null,
    token: token ?? null, via: chain, assignment: isAssignment,
    provenance: provenance ?? null, parentId: parentId ?? null }));
  await withLock(join(runDir, '.mailbox-sequence.lock'), async () => {
    const current = await loadRun(runDir);
    current.message_envelopes ??= {};
    const old = current.message_envelopes[id];
    invariant(!old || JSON.stringify(old) === JSON.stringify(envelope), 'TOPOLOGY_MESSAGE_ID_CONFLICT', 'Stored message envelope differs from retry.');
    current.message_envelopes[id] = envelope;
    await saveRun(runDir, current);
  });
  const deliveries = [];
  const notices = [];
  const holds = [];

  to = recipients.map((entry) => entry.id);

  for (const address of recipients) {
    const requested = address.id;
    // `route` is the policy hook. When supplied it decides where this message actually lands; the
    // intended recipient is preserved either way so the receiver knows what was meant.
    let decision;
    // The envelope path is chosen PER RECIPIENT, not per message. A standing lead or reviewer is
    // normally not in `run.agents`, so writing into `agentDir(runDir, …)` for one would trip
    // TOPOLOGY_UNKNOWN_AGENT for exactly the agents `@repo` exists to reach. The durable mailbox is
    // already correct for intra-repo standing mail: `advance()` skips the lead-readiness gate when
    // source and destination are the same repository, and still runs `routeMessage`.
    if (external || address.delivery === 'standing') {
      const { sendStandingMessage, standingMailboxRoot } = await import('./standing-mailbox.mjs');
      const standingId = createHash('sha256').update(JSON.stringify([resolve(runDir), id, requested])).digest('hex');
      // A legacy callback is never cross-repo authority. Shared durable admission
      // independently invokes canonical routing and both read-only lead probes.
      const { router: _ignoredRouter, ...admissionOptions } = standingOptions;
      const mailboxOptions = { env, ...admissionOptions };
      // Persist bridge intent BEFORE admission so interruption never makes a
      // delivered or held request disappear from its original run barrier.
      await withLock(join(runDir, '.mailbox-sequence.lock'), async () => {
        const current = await loadRun(runDir);
        current.standing_messages ??= {};
        current.standing_messages[standingId] = { messageId: id, requested,
          consumer: destination, stateHome: dirname(standingMailboxRoot(mailboxOptions)) };
        await saveRun(runDir, current);
      });
      const record = await sendStandingMessage({ id: standingId, consumer: destination,
        fromProject: sourceProject, from, to: requested, body, contract, round, subject,
        stage, task, token, parentId, via: chain, assignment: isAssignment,
        provenance: { runDir: resolve(runDir), runId: run.run_id ?? null, messageId: id, source: provenance ?? null, parent: run.parent ?? null, depth: run.depth ?? 0, parentRunId: run.parent?.run_id ?? run.parent_run_id ?? null, rootRunId: run.parent?.root_run_id ?? run.root_run_id ?? null },
      }, mailboxOptions);
      if (record.status !== 'delivered') {
        holds.push({ requested, id: standingId, reason: record.reason });
        continue;
      }
      decision = record.decision;
      if (!known.has(record.delivered_to)) {
        deliveries.push({ agent: record.delivered_to, requested, standing: true,
          standingId, redirected: Boolean(decision.redirected), via: record.delivered_via });
        if (decision.redirected) notices.push({ requested, delivered_to: record.delivered_to, reason: decision.reason, via: record.delivered_via });
        continue;
      }
    } else {
      decision = route ? await route({ from, fromProject: sourceProject, to: requested, task, via: chain }) : { deliver_to: requested, redirected: false };
    }
    invariant(
      decision.blocked !== "loop",
      "TOPOLOGY_ROUTE_LOOP",
      decision.reason || `Routing ${requested} would send this message back through an agent that already handled it.`,
    );
    // A router's refusal is final: ANY truthy `blocked` stops the send here rather than falling
    // through to delivery. A no-lead refusal used to be delivered as addressed — fail-open — which
    // let an unvouched external contact reach a member exactly when no lead existed to vouch.
    invariant(
      decision.blocked !== "no_lead",
      "TOPOLOGY_ROUTE_NO_LEAD",
      decision.reason || `Routing ${requested} was refused: this repo has no lead to vouch for the contact.`,
    );
    invariant(
      !decision.blocked,
      "TOPOLOGY_ROUTE_BLOCKED",
      decision.reason || `Routing ${requested} was blocked (${decision.blocked}).`,
    );
    const recipient = decision.deliver_to || requested;
    invariant(known.has(recipient), "TOPOLOGY_UNKNOWN_AGENT", `Unknown agent "${recipient}". Agents in this run: ${[...known].join(", ")}.`);

    // `coordinates_only` as a capability rather than an instruction: a coordinator can be briefed,
    // asked and reported to, but the mailbox will not carry it a work assignment. Refusing here is
    // what makes the flag a fact — a line in a prompt is only a request.
    const entry = run.agents.find((agent) => agent.id === recipient);
    const coordinator = typeof entry?.coordinates_only === "boolean" ? entry.coordinates_only : decision.coordinates_only === true;
    invariant(
      !(isAssignment && coordinator),
      "TOPOLOGY_COORDINATOR_NOT_A_WORKER",
      `${recipient} coordinates and does not implement, so stage "${stage}" cannot be assigned to them. Ask them who should take it, or address the worker directly.`,
    );

    // The chain grows by exactly one hop per delivery, and the hop recorded is where the message
    // actually landed — not where it was addressed.
    const hops = decision.redirected ? nextVia(chain, recipient) : chain;

    const inbox = join(agentDir(runDir, recipient), "inbox", messageFileName(seq, stage));
    const outbox = join(agentDir(runDir, recipient), "outbox", replyFileName(seq, stage));
    const header = frontmatter({
      id,
      from,
      to: recipient,
      intended_for: decision.redirected ? requested : undefined,
      redirected: decision.redirected ? "true" : undefined,
      stage,
      round,
      contract,
      subject,
      task,
      via: hops.length > 0 ? hops : undefined,
      created: nowIso(),
      reply_to: outbox,
    });
    const redirectNote = decision.redirected
      ? `\n> This message was addressed to ${decision.intended_display || requested} and routed to you because it came from outside this project with no open delegation. Handle it or delegate it.\n`
      : "";
    const instructions = `\n\n<!-- Write your complete reply to: ${outbox} -->\n`;
    await writeText(inbox, `${header}${redirectNote}\n${body.trim()}\n${instructions}`);
    deliveries.push({ agent: recipient, requested, redirected: Boolean(decision.redirected), via: hops, inbox, outbox });

    if (decision.redirected) {
      await recordRedirect(runDir, { messageId: id, intended: requested, deliveredTo: recipient, reason: decision.reason });
      notices.push({ requested, delivered_to: recipient, reason: decision.reason, via: hops });
      // A redirect adds to somebody's queue. Recording the depth at the moment it grows is what
      // turns "the lead is slow" into a number an operator can look at.
      await observeQueueDepth(runDir, recipient, { cause: `redirect of ${id}` });
    }
  }

  await withLock(join(runDir, '.mailbox-sequence.lock'), async () => {
    const current = await loadRun(runDir);
    current.message_deliveries ??= {};
    current.message_deliveries[id] = deliveries;
    await saveRun(runDir, current);
  });
  await appendJournal(runDir, { type: holds.length ? "message.held" : "message.sent", id, from, to, stage, round, contract, subject, task, holds });
  // The sender is told when a message did not go where it was addressed. A redirect is not an
  // error, but a silent one is indistinguishable from a message that vanished.
  return { id, seq, deliveries, redirects: notices, holds };
}

/** Host-resolved workflow forwarding from the immutable parent envelope. The
 * caller names only the delivered parent participant, not a new child target,
 * body, source, task, or ancestry. Admission is rerun against the child's repo. */
export async function forwardMessageToWorkflow({ runDir, messageId, recipient, env = process.env, standingOptions = {} }) {
  const run = await loadRun(runDir);
  const parent = run.message_envelopes?.[messageId];
  const delivered = run.message_deliveries?.[messageId]?.find(item => item.agent === recipient);
  const workflow = run.agents.find(agent => agent.id === recipient)?.workflow;
  invariant(parent && delivered && workflow?.run_dir && workflow.conductor,
    'TOPOLOGY_WORKFLOW_FORWARD_INVALID', 'Forwarding requires a persisted delivery to a declared child workflow.');
  const childDir = resolve(workflow.run_dir);
  const hops = delivered.via ?? parent.via ?? [];
  const via = hops.at(-1) === recipient ? [...hops] : nextVia(hops, recipient);
  const idempotencyKey = createHash('sha256').update(JSON.stringify([resolve(runDir), messageId, recipient, childDir, workflow.conductor])).digest('hex');
  return sendMessage({ runDir: childDir, from: parent.from, fromProject: parent.fromProject,
    to: [workflow.conductor], body: parent.body, stage: parent.stage,
    contract: parent.contract, round: parent.round, subject: parent.subject,
    task: parent.task, token: parent.token, via, assignment: parent.assignment,
    parentId: parent.id, provenance: { original: parent.provenance, lineage: run.parent ?? null, depth: run.depth ?? 0,
      parent: { runDir: resolve(runDir), messageId, recipient } },
    idempotencyKey, standingOptions,
    // An unknown original source stays unknown. The forwarding shell's startup
    // environment is never a substitute for the original sender's provenance.
    env: { ...env, AO_CONSUMER: undefined },
  });
}

/**
 * Every message one agent still owes an answer for.
 *
 * An obligation is not the same thing as an inbox file. A redirected message never reaches the
 * addressee's inbox at all, so listing files alone reported nothing pending and released a barrier
 * the instant it was set — the sender was told "answered" before anybody had read the question.
 * The redirect map is therefore consulted in both directions: it says which of an agent's inbox
 * files somebody else will answer, and which messages addressed to it landed elsewhere.
 */
async function obligations(runDir, run, agentId) {
  const redirects = run.redirects || {};
  const inboxDir = join(agentDir(runDir, agentId), "inbox");
  const own = (await readdir(inboxDir).catch(() => []))
    .filter((name) => name.endsWith(".md") && !name.endsWith(".reply.md"))
    .map((name) => name.replace(/\.md$/, ""));
  const elsewhere = Object.keys(redirects)
    .filter((key) => key.slice(key.lastIndexOf(":") + 1) === agentId)
    .map((key) => key.slice(0, key.lastIndexOf(":")));
  const standing = [];
  const { readStandingMessage } = await import('./standing-mailbox.mjs');
  for (const [standingId, ref] of Object.entries(run.standing_messages ?? {})) {
    let record = null;
    let state = 'missing';
    try {
      record = await readStandingMessage({ id: standingId, env: { AGENT_ORCHESTRATION_STATE_HOME: ref.stateHome } });
      state = record?.status === 'held' ? 'held' : record?.status === 'delivered' ? (record.reply ? 'answered' : 'delivered-unanswered') : 'missing';
    } catch { state = 'unknown'; }
    if (ref.requested !== agentId && record?.delivered_to !== agentId) continue;
    standing.push({ id: ref.messageId, answerer: record?.delivered_to ?? ref.requested,
      standingId, status: state, reason: record?.reason ?? null,
      replyBody: state === 'answered' ? record.reply.body : null,
      created_at: record?.created_at, inbox: null, outbox: null, addressee_outbox: null });
  }
  const covered = new Set(standing.map(item => item.id));
  const ids = [...new Set([...own, ...elsewhere])].filter(id => !covered.has(id)).sort();
  return [...standing, ...ids.map((id) => {
    const answerer = redirects[`${id}:${agentId}`] || agentId;
    return {
      id, answerer,
      inbox: join(agentDir(runDir, own.includes(id) ? agentId : answerer), "inbox", `${id}.md`),
      outbox: join(agentDir(runDir, answerer), "outbox", replyFileNameFor(id)),
      addressee_outbox: join(agentDir(runDir, agentId), "outbox", replyFileNameFor(id)),
    };
  })];
}

function replyFileNameFor(messageId) {
  return `${messageId}.reply.md`;
}

/** Messages an agent still owes an answer for, optionally filtered by agent ids. */
/** Resolve a collective fan-out id to its members; anything else is returned unchanged. */
export function expandFanout(run, ids) {
  const known = new Set(run.agents.map((agent) => agent.id));
  return ids.flatMap((id) => {
    if (known.has(id)) return [id];
    const members = run.agents.filter((agent) => agent.fanout_of === id).map((agent) => agent.id);
    return members.length > 0 ? members : [id];
  });
}

/**
 * The barrier resolves addresses through the SAME function the send did. That is what makes
 * `wait --from @run` cover the room the broadcast covered rather than a set that has quietly
 * drifted — with the one honest difference that an audience expands LIVE, so `@run` means everyone
 * in the run *now*, while `wait --message <id>` barriers over exactly who that message reached.
 */
async function expandTargets(run, agentIds, addressing = {}) {
  const { expandAddresses } = await import('./addressing.mjs');
  return (await expandAddresses({ run, to: agentIds, consumer: run.consumer, external: false, ...addressing }))
    .map((entry) => entry.id);
}

export async function pendingReplies(runDir, agentIds, { addressing = {} } = {}) {
  const run = await loadRun(runDir);
  const ids = agentIds && agentIds.length > 0 ? await expandTargets(run, agentIds, addressing) : [...new Set([...run.agents.map((agent) => agent.id), ...Object.values(run.standing_messages ?? {}).map(ref => ref.requested)])];
  const pending = [];
  for (const agentId of ids) {
    for (const item of await obligations(runDir, run, agentId)) {
      // The outbox reported is the one the answer must actually appear in. Naming the addressee's
      // box on a redirected message sends whoever is debugging the wait to an empty directory.
      if (item.standingId ? item.replyBody !== null : await hasAnswer(item.outbox)) continue;
      pending.push({
        standingId: item.standingId,
        status: item.status ?? "delivered-unanswered",
        reason: item.reason,
        created_at: item.created_at,
        agent: agentId,
        answered_by: item.answerer,
        id: item.id,
        inbox: item.inbox,
        outbox: item.outbox,
        addressee_outbox: item.addressee_outbox,
      });
    }
  }
  return pending;
}

/** Wait until every named agent has replied to the message id (or to all pending messages). */
export async function waitForReplies({ runDir, agentIds, messageId, timeoutMs, pollMs = 3000, onTick, addressing = {} }) {
  const started = Date.now();
  const run = await loadRun(runDir);
  const targets = agentIds && agentIds.length > 0 ? await expandTargets(run, agentIds, addressing) : [...new Set([...run.agents.filter((agent) => agent.role !== "orchestrator").map((agent) => agent.id), ...Object.values(run.standing_messages ?? {}).map(ref => ref.requested)])];
  for (;;) {
    const pending = (await pendingReplies(runDir, targets)).filter((item) => !messageId || item.id === messageId);
    if (pending.length === 0) {
      // Collect the answers the same way the barrier decided it was satisfied: through the redirect
      // map. Reading only each target's own outbox reports "all replies received" and then prints
      // nothing, because a redirected message was answered from somebody else's box.
      const current = await loadRun(runDir);
      const replies = [];
      const seen = new Set();
      for (const agentId of targets) {
        for (const item of await obligations(runDir, current, agentId)) {
          if (messageId && item.id !== messageId) continue;
          const answerKey = item.standingId ?? item.outbox;
          if (seen.has(answerKey) || (item.standingId ? item.replyBody === null : !(await hasAnswer(item.outbox)))) continue;
          seen.add(answerKey);
          replies.push({
            agent: item.answerer,
            on_behalf_of: item.answerer === agentId ? undefined : agentId,
            id: item.id,
            path: item.outbox,
            standingId: item.standingId,
            body: item.standingId ? item.replyBody : await readFile(item.outbox, "utf8"),
          });
        }
      }
      await appendJournal(runDir, { type: "wait.satisfied", agents: targets, message: messageId ?? null, elapsed_ms: Date.now() - started });
      return { ok: true, replies, elapsed_ms: Date.now() - started };
    }
    if (Date.now() - started > timeoutMs) {
      await appendJournal(runDir, { type: "wait.timeout", agents: targets, message: messageId ?? null, pending: pending.map((item) => `${item.agent}:${item.id}`) });
      return { ok: false, pending, elapsed_ms: Date.now() - started };
    }
    if (onTick) await onTick(pending, Date.now() - started);
    await sleep(pollMs);
  }
}

/**
 * Record a reply written by an agent (agents call this through `ao-topology reply`).
 *
 * Two things are checked that previously were not. The agent's identity is verified against the
 * token its own launcher exported, so `--agent <id>` can no longer be asserted on trust and one
 * agent can no longer satisfy another's barrier. And an empty body is refused, because a zero-byte
 * file used to satisfy a wait exactly as well as a real answer did.
 */
export async function recordReply({ runDir, agentId, messageId, body, token = process.env.AO_AGENT_TOKEN }) {
  const [seq, ...stageParts] = messageId.split("-");
  const stage = stageParts.join("-");
  invariant(seq && stage, "TOPOLOGY_MESSAGE_ID_INVALID", `Message id must look like 003-brief (got "${messageId}").`);

  const text = typeof body === "string" ? body : "";
  invariant(
    text.trim().length > 0,
    "TOPOLOGY_REPLY_EMPTY",
    `A reply to ${messageId} must have content. An empty file satisfies nothing.`,
  );

  const run = await loadRun(runDir);
  const known = (run.agents || []).find((agent) => agent.id === agentId);
  invariant(known, "TOPOLOGY_AGENT_UNKNOWN", `No agent ${agentId} in this run.`);
  // The launcher exported a secret into this agent's environment and the run recorded it. Prefer
  // the hash: run.json is world-readable to anything on the box, so storing the secret itself makes
  // the record enough to forge with, while a digest is only enough to check with.
  if (known.token_sha256 || known.token) {
    invariant(
      typeof token === "string" && token.length > 0,
      "TOPOLOGY_AGENT_UNAUTHORIZED",
      `Reply for ${agentId} carried no agent token. Set AO_AGENT_TOKEN (the launcher exports it) or pass --token; an agent may only write its own outbox.`,
    );
    const presented = known.token_sha256 ? createHash("sha256").update(token).digest("hex") : token;
    const expected = known.token_sha256 || known.token;
    const a = Buffer.from(String(presented));
    const b = Buffer.from(String(expected));
    invariant(
      a.length === b.length && timingSafeEqual(a, b),
      "TOPOLOGY_AGENT_UNAUTHORIZED",
      `Reply for ${agentId} did not carry that agent's token. An agent may only write its own outbox.`,
    );
  }

  const { readStandingMessage, recordStandingReply } = await import('./standing-mailbox.mjs');
  const standingRefs = Object.entries(run.standing_messages ?? {}).filter(([, ref]) => ref.messageId === messageId);
  let standingAnswered = false;
  for (const [standingId, ref] of standingRefs) {
    const bridgeEnv = { AGENT_ORCHESTRATION_STATE_HOME: ref.stateHome };
    const standing = await readStandingMessage({ id: standingId, env: bridgeEnv });
    if (standing?.delivered_to !== agentId) continue;
    if (!(known.token_sha256 || known.token)) {
      invariant(process.env.AO_AGENT_ID === agentId && process.env.AO_CONSUMER && await sameProject(process.env.AO_CONSUMER, ref.consumer),
        'TOPOLOGY_AGENT_UNAUTHORIZED', 'A legacy run without reply tokens must prove the receiving launcher identity for standing replies.');
    }
    await recordStandingReply({ consumer: ref.consumer, messageId: standingId, agentId, body: text,
      env: { ...bridgeEnv, AO_AGENT_ID: agentId, AO_CONSUMER: ref.consumer } });
    standingAnswered = true;
  }
  invariant(standingRefs.length === 0 || standingAnswered, "TOPOLOGY_AGENT_UNAUTHORIZED", "Only the actual receiving agent can answer this standing request.");
  const outbox = join(agentDir(runDir, agentId), "outbox", replyFileName(seq, stage));
  await writeText(outbox, text.endsWith("\n") ? text : `${text}\n`);
  await appendJournal(runDir, { type: "message.replied", id: messageId, from: agentId, bytes: Buffer.byteLength(text) });
  return outbox;
}

/**
 * How deep is an agent's inbox right now?
 *
 * The lead is a bottleneck by design and a single point of failure by accident: every unvouched
 * cross-repo contact lands on it. Congestion there does not raise an error, it just makes everyone
 * else slower, so the depth has to be a number somebody can read rather than a feeling.
 */
export async function queueDepth(runDir, agentIds) {
  const run = await loadRun(runDir);
  const ids = agentIds && agentIds.length > 0 ? agentIds : run.agents.map((agent) => agent.id);
  const pending = await pendingReplies(runDir, ids);
  const byAnswerer = new Map(ids.map((id) => [id, []]));
  const counted = new Set();
  for (const item of pending) {
    const who = item.answered_by || item.agent;
    // One message is one item of work even when several agents are waiting on the same answer.
    if (counted.has(`${who}:${item.id}`)) continue;
    counted.add(`${who}:${item.id}`);
    if (!byAnswerer.has(who)) byAnswerer.set(who, []);
    byAnswerer.get(who).push(item);
  }
  const out = [];
  for (const [agent, items] of byAnswerer) {
    let oldest = null;
    for (const item of items) {
      const at = item.standingId ? (item.created_at ? Date.parse(item.created_at) : null) : await stat(item.inbox).then((s) => s.mtimeMs).catch(() => null);
      if (at != null && (oldest == null || at < oldest)) oldest = at;
    }
    out.push({
      agent,
      role: run.agents.find((a) => a.id === agent)?.role ?? null,
      depth: items.length,
      oldest_age_ms: oldest == null ? null : Math.max(0, Date.now() - oldest),
      messages: items.map((item) => item.id),
    });
  }
  return out.sort((a, b) => b.depth - a.depth);
}

/**
 * The lead's queue — the one that matters, because every unvouched cross-repo contact lands there.
 *
 * Who the lead is comes from the agent LIBRARY, not from the run record. A run agent's `role` is
 * the spec's role, and a spec has exactly one `orchestrator` and no `lead` role pack, so a repo's
 * lead appears in its own run as `role: "orchestrator"`. Filtering the run on `role === "lead"`
 * therefore matched nothing, ever, and returned `[]` — which reads as "no congestion" and is the
 * precise failure this function exists to catch. The library is the same source `routeMessage`
 * redirects against, so the queue being measured is the queue being filled.
 */
export async function leadQueueDepth(runDir, { consumer, pluginRoot, home } = {}) {
  const run = await loadRun(runDir);
  const ids = new Set(run.agents.map((agent) => agent.id));
  // A malformed library (two leads) must not crash a status read, but it must not vanish either —
  // routeMessage throws on it, so a queue that quietly fell back would disagree with routing.
  let lead = null;
  let leadError = null;
  try {
    lead = await findLead(agentDirs({ consumer: consumer ?? run.consumer, pluginRoot, home }));
  } catch (error) {
    leadError = error.message;
  }
  // Fall back to the run record only when the library cannot answer — a run launched outside a
  // repo that keeps an agent library still deserves a reading rather than silence.
  const leads = lead && ids.has(lead.id)
    ? [lead.id]
    : run.agents.filter((agent) => agent.role === "lead" || agent.coordinates_only === true).map((agent) => agent.id);
  if (leads.length === 0) return [];
  const readings = await queueDepth(runDir, leads);
  return readings.map((reading) => ({
    ...reading,
    lead_from: lead && ids.has(lead.id) ? "library" : "run",
    ...(leadError ? { lead_error: leadError } : {}),
  }));
}

/** Measure one agent's queue and journal it, so depth over time is in the record, not inferred. */
export async function observeQueueDepth(runDir, agentId, extra = {}) {
  const [reading] = await queueDepth(runDir, [agentId]);
  const record = reading || { agent: agentId, depth: 0, oldest_age_ms: null, messages: [] };
  await appendJournal(runDir, {
    type: "queue.depth",
    agent: record.agent,
    depth: record.depth,
    oldest_age_ms: record.oldest_age_ms,
    ...extra,
  });
  return record;
}
