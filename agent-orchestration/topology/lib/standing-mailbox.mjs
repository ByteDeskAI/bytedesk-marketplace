// Durable standing mail is independent of run rosters. One atomic envelope is
// the source of truth for both inbox and outbox; uncertain retries retain the
// original envelope ID and never send terminal input. Readiness checks do not
// create or restart leads.
//
// TM-167. Readiness here is READ-ONLY (cached proof only): it never rings a pane,
// and it runs under a message lock, so it must not wait for a model turn. When a
// cross-repository message is held because a lead is not proven ready, the
// message is already on disk; this module then asks each non-ready side's OWN
// supervisor to recover its lead (a durable request plus activation) and never
// launches anything itself. A held message carries attempts, last_error and
// next_retry_at on the lead-recovery backoff; a hold no retry can change is
// marked permanent and is not retried by resume.
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, open, readFile, readdir, rename, rm } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { leadState, readLeadRegistration } from './lead.mjs';
import { requestLeadRecovery, retryDelayMs } from './lead-recovery.mjs';
import { activateRepository, resolveEnrollment } from './repo-enrollment.mjs';
import { withLock } from './lockfile.mjs';
import { canonicalRepoId, stateRoot } from './repoid.mjs';
import { hopExceeded, isAssignmentStage, nextVia, routeMessage } from './routing.mjs';
import { callerIdentity, resolvePresentRecipient } from './session-identity.mjs';
import { invariant, nowIso, shellQuote, sleep } from './util.mjs';
import { createMailboxEnvelope, publishMailboxEnvelope, acceptMailboxDelivery, listMailboxReceipts, resumeMailboxPublications, getMailboxReceipt } from './mailbox-receipts.mjs';

export function standingMailboxRoot({ env = process.env, home = homedir() } = {}) {
  return join(stateRoot(env, home), 'standing-mailbox');
}
function paths(id, opts) {
  const root = standingMailboxRoot(opts);
  const key = createHash('sha256').update(id).digest('hex');
  return { root, file: join(root, 'messages', `${key}.json`), lock: join(root, 'locks', `${key}.lock`) };
}
async function read(path) {
  try { return JSON.parse(await readFile(path, 'utf8')); }
  catch (error) { if (error.code === 'ENOENT') return null; throw error; }
}
async function atomicWrite(file, record) {
  const temp = `${file}.${randomUUID()}.tmp`;
  try {
    const handle = await open(temp, 'wx', 0o600);
    try { await handle.writeFile(`${JSON.stringify(record)}\n`); await handle.sync(); }
    finally { await handle.close(); }
    await rename(temp, file);
    // Persist the directory entry as well as the envelope on platforms that
    // support directory fsync. Windows does not expose this operation.
    if (process.platform !== 'win32') {
      const directory = await open(dirname(file), 'r');
      try { await directory.sync(); } finally { await directory.close(); }
    }
  } finally { await rm(temp, { force: true }); }
}
function responsive(state) {
  return state?.status === 'responsive' && Boolean(state.record?.agent_id) && state.library_lead === state.record.agent_id;
}
function readinessOf(state) {
  return responsive(state) ? 'responsive' : state?.status === 'responsive' ? 'library_lead_mismatch' : state?.status ?? 'unknown';
}

// Holds no retry can change. The envelope is immutable, so its declared source, its repository
// identities and its ancestry stay what they are, and so does the routing verdict built from them.
// TM-354: holds a lead can end. Each asks the side's own supervisor to launch or recover its lead
// (recoverLead, under the registration lock, so repeated asks never start a second lead).
const RECOVERABLE_HOLDS = new Set(['leads_not_ready', 'no_lead']);
const PERMANENT_HOLDS = new Set(['source_identity_required', 'repository_identity_changed', 'hop_limit', 'loop', 'coordinator_not_worker']);

function due(record, now, force) {
  return ['held', 'publishing'].includes(record.status) && !record.permanent && (force || !record.next_retry_at || Date.parse(record.next_retry_at) <= now());
}

async function advance(record, opts) {
  if (record.status === 'delivered') return record;
  const next = await attempt(record, opts);
  if (next.status === 'delivered') return { ...next, permanent: false, last_error: null, next_retry_at: null };
  const permanent = PERMANENT_HOLDS.has(next.reason);
  return { ...next, permanent,
    last_error: next.reason === 'admission_error' ? `admission_error: ${next.error_code}` : next.reason,
    next_retry_at: permanent ? null : new Date((opts.now ?? Date.now)() + retryDelayMs(next.attempts)).toISOString() };
}

/** Ask each side whose lead is not proven ready to recover it, through its own supervisor. Runs after
 * the message lock is released; a failure here leaves the durable hold exactly as it is. */
async function scheduleRecovery(record, opts) {
  const request = opts.requestRecovery ?? requestLeadRecovery;
  const activate = opts.activate ?? activateRepository;
  const sides = {};
  // TM-354: no_lead is the destination's alone: its library has no lead to vouch for the contact.
  const candidates = record.reason === 'no_lead' ? [['destination', record.envelope.consumer]]
    : [['source', record.envelope.fromProject], ['destination', record.envelope.consumer]];
  for (const [side, consumer] of candidates) {
    if (record.readiness?.[side] === 'responsive') continue;
    try {
      await request({ consumer, env: opts.env, home: opts.home, reason: record.reason, messageId: record.envelope.id });
      const activation = await activate({ consumer, env: opts.env, home: opts.home, reason: 'held-standing-mail' });
      sides[side] = { requested: true, enrolled: activation?.enrollment?.enrolled ?? null, supervision: activation?.supervision ?? null };
    } catch (error) {
      sides[side] = { requested: false, error: error?.code ?? String(error?.message ?? error) };
    }
  }
  return sides;
}
async function withRecovery(record, opts) {
  if (record.status !== 'held' || !RECOVERABLE_HOLDS.has(record.reason)) return record;
  return { ...record, recovery: await scheduleRecovery(record, opts) };
}

function standingEnvelope(record) {
  const e = record.envelope;
  return createMailboxEnvelope({ id: e.id, repositoryId: e.destinationRepoId, from: e.from, to: record.delivered_to, body: e.body,
    context: { ...(e.context || {}), sourceRepositoryId: e.sourceRepoId, standing: true,
      intendedFor: e.to, taskId: e.task ?? e.context?.taskId ?? null, stage: e.stage,
      subject: e.subject, contract: e.contract, round: e.round, parentId: e.parentId,
      via: record.delivered_via, provenance: e.provenance,
      runId: e.context?.runId ?? e.provenance?.runId ?? null,
      workflowId: e.context?.workflowId ?? (e.provenance?.runId ? `topology:${e.provenance.runId}` : null) } });
}

// Admission and broker publication are distinct. Persist the chosen recipient
// before publish so a crash does not silently reroute an uncertain delivery.
async function publishAdmitted(record, p, opts) {
  if (!['delivered', 'publishing'].includes(record.status)) {
    await atomicWrite(p.file, record); return record;
  }
  const pending = { ...record, status: 'publishing', reason: 'publication_pending',
    publication: { status: 'pending', attempts: (record.publication?.attempts || 0) + 1 } };
  delete pending.delivered_at;
  await atomicWrite(p.file, pending);
  try {
    const { resolveTransport } = await import('./orch-transport.mjs');
    const transport = opts.transport ?? await resolveTransport({ env: opts.env ?? process.env });
    let publication = null;
    if (transport.kind === 'nats') {
      publication = await publishMailboxEnvelope({ ...opts, transport, envelope: standingEnvelope(record) });
    }
    const next = { ...record, status: 'delivered', reason: null, delivered_at: nowIso(),
      publication: publication ? { status: 'published', publishedAt: publication.publishedAt, subject: publication.result?.subject } : { status: 'file' },
      permanent: false, last_error: null, next_retry_at: null };
    await atomicWrite(p.file, next); return next;
  } catch (error) {
    const next = { ...pending, last_error: error.code || 'TOPOLOGY_PUBLICATION_FAILED',
      next_retry_at: new Date((opts.now ?? Date.now)() + retryDelayMs(pending.publication.attempts)).toISOString() };
    await atomicWrite(p.file, next); return next;
  }
}

async function attempt(record, opts) {
  const { envelope: e } = record;
  const updated = { ...record, attempts: record.attempts + 1, updated_at: nowIso(), status: 'held', reason: null };
  if (!e.fromProject || !e.from) return { ...updated, reason: 'source_identity_required' };
  if (hopExceeded(e.via)) return { ...updated, reason: 'hop_limit' };
  const readiness = opts.readiness ?? leadState;
  try {
    const destination = await canonicalRepoId(e.consumer);
    const source = await canonicalRepoId(e.fromProject);
    // A repository moving to a different identity cannot inherit this message.
    if (destination.id !== e.destinationRepoId || source.id !== e.sourceRepoId) return { ...updated, reason: 'repository_identity_changed' };
    const sameRepo = source.id === destination.id;
    if (!sameRepo) {
      const [src, dst] = await Promise.all([
        // Cached proof only: this runs under the message lock, once per held message. Proving a lead
        // (ringing it) is lead recovery's job, once per backoff window, with no lock held.
        readiness({ ...opts, consumer: e.fromProject, ackTimeoutMs: 0 }),
        readiness({ ...opts, consumer: e.consumer, ackTimeoutMs: 0 }),
      ]);
      if (!responsive(src) || !responsive(dst)) {
        const detail = { source: readinessOf(src), destination: readinessOf(dst) };
        // TM-167: only an enrolled repository is ever given a lead, so a side that is not ready and
        // not enrolled can never become ready through recovery. The hold names enrollment and
        // schedules nothing. Enrollment decides who is given a lead, not whether a lead already
        // proven responsive may receive mail. A resolver that cannot answer reads as not enrolled.
        const enrollment = opts.enrollment ?? resolveEnrollment;
        const enrolled = async (consumer) => (await (async () => enrollment({ consumer, env: opts.env, home: opts.home }))().catch(() => null))?.enrolled === true;
        if (!responsive(dst) && !(await enrolled(e.consumer))) return { ...updated, reason: 'destination_not_enrolled', readiness: detail };
        if (!responsive(src) && !(await enrolled(e.fromProject))) return { ...updated, reason: 'source_not_enrolled', readiness: detail };
        return { ...updated, reason: 'leads_not_ready', readiness: detail };
      }
    }
    // This is intentionally rerun, including delegationAllows/verifyAgainstStore,
    // for EACH resume. A held record contains no cached grant.
    let decision = await (opts.router ?? routeMessage)({
      consumer: e.consumer, pluginRoot: opts.pluginRoot, home: opts.home,
      from: e.from, fromProject: sameRepo ? e.consumer : e.fromProject,
      to: e.to, task: e.task, token: e.token, via: e.via,
    });
    if (decision.blocked) return { ...updated, reason: decision.blocked, decision };
    // TM-353: a name the library does not know may still be a live session here (a Codex pane, a
    // session's minted identity). Routing only leaves it unresolved for a same-repository sender.
    if (!decision.resolved && !decision.redirected) {
      const present = await resolvePresentRecipient({ consumer: e.consumer, to: e.to, env: opts.env, home: opts.home, presence: opts.presence });
      if (present) decision = { ...decision, resolved: present.agentId, deliver_to: present.agentId, resolved_via: present.source };
    }
    if (!decision.resolved && !decision.redirected) return { ...updated, reason: 'unknown_recipient', decision };
    if (e.assignment && decision.coordinates_only) return { ...updated, reason: 'coordinator_not_worker', decision };
    const recipient = decision.deliver_to;
    if (!recipient) return { ...updated, reason: 'unknown_recipient', decision };
    return { ...updated, status: 'delivered', reason: null, delivered_at: nowIso(), decision,
      delivered_to: recipient, delivered_via: decision.redirected ? nextVia(e.via, recipient) : [...e.via] };
  } catch (error) {
    // The full immutable request was already persisted before admission. Errors
    // preserve it for recovery, without persisting possibly sensitive error text.
    return { ...updated, reason: 'admission_error', error_code: error.code ?? 'ERROR' };
  }
}

/** TM-278: the admission a send would get, computed and reported, with nothing written, published,
 * rung or recovered. Readiness is cached proof read-only, exactly as a real attempt reads it. */
async function dryRunVerdict(envelope, p, opts) {
  const existing = await read(p.file);
  const verdict = await attempt({ version: 1, envelope, status: 'held', attempts: 0 }, { ...opts, readOnly: true });
  const lead = await readLeadRegistration({ consumer: envelope.consumer, env: opts.env, home: opts.home }).catch(() => null);
  return { dry_run: true, written: false, envelope,
    destination: { consumer: envelope.consumer, repo_id: envelope.destinationRepoId, lead: lead?.record?.agent_id ?? null },
    would: verdict.status === 'delivered' ? 'deliver' : 'hold',
    delivered_to: verdict.delivered_to ?? null, reason: verdict.reason ?? null,
    permanent: PERMANENT_HOLDS.has(verdict.reason), readiness: verdict.readiness ?? null,
    // The same id already on disk is what a real send would dedupe to, or refuse as a conflict.
    existing: existing ? { status: existing.status, same_content: isDeepStrictEqual({ context: {}, ...existing.envelope }, envelope) } : null };
}

/** Caller-generated IDs provide retry identity. Reusing an ID with changed
 * content, source, destination, or forwarding ancestry is rejected. */
export async function sendStandingMessage(input, options = {}) {
  const opts = { ...options, home: options.home ?? homedir() };
  invariant(input?.consumer && input?.to, 'TOPOLOGY_RECIPIENT_REQUIRED', 'Standing mail requires destination repository and agent.');
  invariant(typeof input.body === 'string' && input.body.trim(), 'TOPOLOGY_BODY_REQUIRED', 'Standing mail requires a body.');
  invariant(input.via === undefined || (Array.isArray(input.via) && input.via.every(x => typeof x === 'string' && x)), 'TOPOLOGY_VIA_INVALID', 'Forwarding ancestry must be an array of agent IDs.');
  const id = input.id ?? randomUUID();
  invariant(typeof id === 'string' && id.length > 0 && id.length <= 256, 'TOPOLOGY_MESSAGE_ID_INVALID', 'Message ID must be a nonempty string of at most 256 characters.');
  const destination = await canonicalRepoId(input.consumer);
  const source = input.fromProject ? await canonicalRepoId(input.fromProject) : null;
  // A JSON roundtrip freezes the durable data; undefined optional fields become null.
  const envelope = JSON.parse(JSON.stringify({ id, consumer: resolve(input.consumer),
    destinationRepoId: destination.id, fromProject: input.fromProject ? resolve(input.fromProject) : null,
    sourceRepoId: source?.id ?? null, from: input.from ?? null, to: input.to,
    body: input.body, task: input.task ?? null, token: input.token ?? null,
    subject: input.subject ?? null, stage: input.stage ?? null, contract: input.contract ?? null,
    round: input.round ?? null, provenance: input.provenance ?? null,
    context: input.context ?? {},
    parentId: input.parentId ?? null, via: input.via ?? [],
    assignment: input.assignment === undefined ? isAssignmentStage(input.stage) : input.assignment === true,
  }));
  const p = paths(id, opts);
  if (opts.dryRun) return dryRunVerdict(envelope, p, opts);
  await mkdir(join(p.root, 'messages'), { recursive: true, mode: 0o700 });
  const settled = await withLock(p.lock, async () => {
    let record = await read(p.file);
    if (record) invariant(isDeepStrictEqual({ context: {}, ...record.envelope }, envelope), 'TOPOLOGY_MESSAGE_ID_CONFLICT', 'Message ID already names different content or provenance.');
    else {
      record = { version: 1, envelope, status: 'held', reason: 'pending_admission', attempts: 0, created_at: nowIso() };
      await atomicWrite(p.file, record);
    }
    if (record.status === 'delivered') return { ...record, deduplicated: true };
    if (record.status !== 'publishing') record = await advance(record, opts);
    return publishAdmitted(record, p, opts);
  });
  // The envelope is durable before anything is asked of any lead.
  return withRecovery(settled, opts);
}

async function records(opts) {
  const dir = join(standingMailboxRoot(opts), 'messages');
  let names;
  try { names = await readdir(dir); } catch (error) { if (error.code === 'ENOENT') return []; throw error; }
  const results = [];
  for (const name of names.filter(n => /^[0-9a-f]{64}\.json$/.test(n)).sort()) {
    try {
      const record = await read(join(dir, name));
      invariant(record?.version === 1 && record.envelope?.id, 'TOPOLOGY_STANDING_STATE_INVALID', 'Invalid standing mailbox record.');
      results.push(record);
    } catch (error) {
      // TM-483: the store is host-wide, so the resume sweep (`errors` given) reports and skips an
      // unreadable record, possibly another repository's, instead of failing the whole tick.
      if (!opts.errors) throw error;
      opts.errors.push({ file: join(dir, name), code: error.code || 'TOPOLOGY_STANDING_STATE_INVALID' });
    }
  }
  return results;
}

/** Safe-boundary watcher calls this without a run. Delivered records are final;
 * each held request rechecks both leads and the live receiving task store. */
export async function resumeStandingMessages({ consumer, force = false, errors = [], ...options }) {
  const identity = await canonicalRepoId(consumer);
  const now = options.now ?? Date.now;
  const resumed = [];
  for (const old of await records({ ...options, errors })) {
    // TM-167: a held message is retried when it is due, not on every tick. `force` skips backoff
    // for a human who asked; nothing retries a permanent hold.
    if (old.envelope.destinationRepoId !== identity.id || !due(old, now, force)) continue;
    const p = paths(old.envelope.id, options);
    // TM-483: one message that fails is reported into `errors`; the others still resume.
    try {
      const settled = await withLock(p.lock, async () => {
        const current = await read(p.file);
        invariant(current, 'TOPOLOGY_STANDING_STATE_INVALID', 'Standing message disappeared during resume.');
        if (current.status === 'delivered') return current;
        // Re-checked under the lock: a concurrent resumer may have just attempted and re-held it.
        if (!due(current, now, force)) return null;
        const next = current.status === 'publishing' ? current : await advance(current, { ...options, now });
        return publishAdmitted(next, p, { ...options, now });
      });
      if (settled) resumed.push(await withRecovery(settled, options));
    } catch (error) { errors.push({ messageId: old.envelope.id, code: error?.code || 'TOPOLOGY_STANDING_RESUME_FAILED' }); }
  }
  await resumeMailboxPublications({ consumer, force, errors, ...options });
  return resumed;
}

/** A lead proven responsive makes the mail that asked for it due now, instead of at its backoff.
 * Nothing is delivered here: the next resume re-runs full admission under the message lock. */
export async function wakeStandingMessages({ ids = [], ...options }) {
  const woken = [];
  for (const id of new Set(ids)) {
    const p = paths(id, options);
    if (!(await read(p.file))) continue;
    await withLock(p.lock, async () => {
      const current = await read(p.file);
      if (current?.status !== 'held' || current.permanent || !current.next_retry_at) return;
      await atomicWrite(p.file, { ...current, next_retry_at: null });
      woken.push(id);
    });
  }
  return woken;
}

/**
 * TM-356: who this session is, for every mailbox entry that acts as an agent (CLI send and forward,
 * MCP send, receive and dispose). The identity is the launcher's — AO_AGENT_ID and AO_CONSUMER, the
 * same proof `recordStandingReply` requires — never a `--from` flag or a tool's `from` field. A
 * claimed agent or repository that differs is refused, so naming another agent cannot impersonate
 * it. Host-local protocol enforcement, as for replies: not isolation from a user who rewrites their
 * own environment.
 */
export async function sessionIdentity({ env = process.env, agent = null, consumer = null } = {}) {
  // TM-353: a launcher identity (AO_AGENT_ID) wins; otherwise the identity SessionStart minted.
  const caller = callerIdentity(env);
  invariant(caller?.agentId && caller?.consumer, 'TOPOLOGY_SOURCE_IDENTITY_REQUIRED',
    'source_identity_required: this session has no agent-orchestration identity (neither AO_AGENT_ID/AO_CONSUMER from a launcher nor the session identity minted at SessionStart), so it cannot act on standing mail as any agent, and --from or a from field cannot supply one. Nothing was done.');
  invariant(agent === null || agent === undefined || agent === caller.agentId, 'TOPOLOGY_SENDER_MISMATCH',
    `This session is ${caller.agentId}; it cannot act as ${JSON.stringify(agent)}. Drop the explicit sender, or run as that agent. Nothing was done.`);
  if (consumer !== null && consumer !== undefined) {
    const [mine, claimed] = await Promise.all([canonicalRepoId(caller.consumer), canonicalRepoId(String(consumer))]);
    invariant(mine.id === claimed.id, 'TOPOLOGY_SENDER_MISMATCH',
      `This session belongs to ${caller.consumer}; it cannot act for ${consumer}. Nothing was done.`);
  }
  return { agent: caller.agentId, consumer: resolve(caller.consumer), source: caller.source };
}

/**
 * TM-419: the one definition of which standing records `mailbox inbox` shows agent X, and of which
 * of those are unread. The inbox listing and the arrival ring both call these, so a ring can never
 * point at mail the inbox would not show. Under NATS the inbox is fed by the broker, so only records
 * actually published there belong to it; a file record from before publication existed never will.
 */
export function standingInboxShows(record, { repoId, agent, transportKind }) {
  return record.status === 'delivered' && record.envelope.destinationRepoId === repoId && Boolean(agent) && record.delivered_to === agent
    && (transportKind !== 'nats' || record.publication?.status === 'published');
}
/** Unread: the inbox would show it, nobody answered it, and the agent holds no receipt for it — any
 * receipt (accepted, deferred, handled, rejected) means the agent already took it from the inbox. */
export function standingUnread(record, { receipt, ...scope }) {
  return standingInboxShows(record, scope) && !record.reply && !receipt;
}

// These are host-local mailbox views, not an authorization boundary. API/CLI
// callers must establish the current agent identity before returning bodies.
export async function readStandingInbox({ consumer, agent, transport = null, env = process.env, limit = 100, ...options }) {
  invariant(agent, 'TOPOLOGY_AGENT_REQUIRED', 'Inbox requires an agent.');
  const { resolveTransport, orchName } = await import('./orch-transport.mjs');
  const { repoKey } = await import('./repoid.mjs');
  const active = transport ?? options.transport ?? await resolveTransport({ env: options.env ?? env });
  if (active.kind === 'nats') {
    const repo = repoKey((await canonicalRepoId(consumer)).id);
    invariant(Number.isInteger(limit) && limit > 0 && limit <= 1000, 'TOPOLOGY_MAILBOX_LIMIT', 'Receive limit must be between 1 and 1000.');
    for (let i = 0; i < limit; i += 1) {
      const mail = await active.pullMail({ repo, agent: orchName(agent), timeoutMs: 1000 });
      if (!mail) break;
      try { await acceptMailboxDelivery({ consumer, agent, delivery: mail, env, ...options }); }
      catch (error) { await mail.nak?.(); throw error; }
    }
    return (await listMailboxReceipts({ consumer, agent, kind: 'mail', env, ...options }))
      .filter(record => ['accepted', 'deferred'].includes(record.status))
      .map(record => ({ ...record, delivered_to: agent, transport: 'nats', body: record.envelope.body }));
  }
  const identity = await canonicalRepoId(consumer);
  const received = [];
  const scope = { repoId: identity.id, agent, transportKind: active.kind };
  for (const record of (await records({ ...options, env })).filter(r => standingInboxShows(r, scope))) {
    const receipt = await acceptMailboxDelivery({ consumer, agent, env, ...options,
      delivery: { body: JSON.stringify(standingEnvelope(record)), ack: async () => {} } });
    // Keep the legacy file envelope/admission fields, adding the receipt without
    // changing its original requested recipient or admission attempt history.
    if (['accepted', 'deferred'].includes(receipt.status)) received.push({ ...record, receiptStatus: receipt.status, receipt });
  }
  return received;
}
export async function readStandingOutbox({ consumer, agent, ...options }) {
  invariant(agent, 'TOPOLOGY_AGENT_REQUIRED', 'Outbox requires an agent.');
  const identity = await canonicalRepoId(consumer);
  return (await records(options)).filter(r => r.envelope.sourceRepoId === identity.id && r.envelope.from === agent);
}

/** Forward a delivered standing envelope without trusting callers to reconstruct
 * or shorten its ancestry. The original remains immutable and addressable. */
export async function forwardStandingMessage({ parentId, from, fromProject, ...input }, options = {}) {
  invariant(typeof parentId === 'string' && parentId, 'TOPOLOGY_PARENT_REQUIRED', 'Forwarding requires the original message ID.');
  const parent = await read(paths(parentId, options).file);
  invariant(parent?.status === 'delivered', 'TOPOLOGY_PARENT_UNDELIVERED', 'Only delivered standing mail can be forwarded.');
  const source = await canonicalRepoId(fromProject);
  invariant(source.id === parent.envelope.destinationRepoId && from === parent.delivered_to,
    'TOPOLOGY_FORWARD_OWNER', 'Only the receiving agent may forward its standing mail.');
  const prior = parent.delivered_via ?? parent.envelope.via;
  const via = prior.at(-1) === from ? [...prior] : nextVia(prior, from);
  return sendStandingMessage({ ...input, from, fromProject, parentId,
    body: input.body ?? parent.envelope.body, task: input.task ?? parent.envelope.task,
    provenance: parent.envelope.provenance, via,
  }, options);
}

/** Read one durable envelope; absence remains unknown/pending to bridge callers. */
export async function readStandingMessage({ id, ...options }) {
  invariant(typeof id === 'string' && id, 'TOPOLOGY_MESSAGE_ID_INVALID', 'Message ID is required.');
  const record = await read(paths(id, options).file);
  if (record) {
    invariant(record.version === 1 && record.envelope?.id === id && ['held', 'publishing', 'delivered'].includes(record.status), 'TOPOLOGY_STANDING_STATE_INVALID', 'Invalid standing mailbox record.');
    if (record.reply) invariant(record.status === 'delivered' && record.reply.agent === record.delivered_to &&
      record.reply.repositoryId === record.envelope.destinationRepoId && typeof record.reply.body === 'string' && record.reply.body.trim(),
      'TOPOLOGY_STANDING_STATE_INVALID', 'Invalid standing reply record.');
  }
  return record;
}

/** The launcher-provided identity is required; a caller-supplied recipient flag
 * alone must never authorize a reply. This is host-local protocol enforcement,
 * not process isolation against a user who can rewrite their own environment. */
export async function recordStandingReply({ consumer, messageId, agentId, body, env = process.env, home = homedir() }) {
  invariant(typeof messageId === 'string' && messageId, 'TOPOLOGY_MESSAGE_ID_INVALID', 'Standing reply requires a message ID.');
  invariant(typeof body === 'string' && body.trim(), 'TOPOLOGY_REPLY_EMPTY', 'A standing reply must have content.');
  invariant(agentId && env.AO_AGENT_ID === agentId && env.AO_CONSUMER, 'TOPOLOGY_AGENT_UNAUTHORIZED', 'Standing replies require the receiving launcher identity and repository.');
  const destination = await canonicalRepoId(consumer);
  const current = await canonicalRepoId(env.AO_CONSUMER);
  invariant(current.id === destination.id, 'TOPOLOGY_AGENT_UNAUTHORIZED', 'Launcher repository does not match the receiving repository.');
  const p = paths(messageId, { env, home });
  const settled = await withLock(p.lock, async () => {
    const record = await read(p.file);
    invariant(record?.status === 'delivered', 'TOPOLOGY_MESSAGE_UNDELIVERED', 'A held or missing message cannot be answered.');
    invariant(record.delivered_to === agentId && record.envelope.destinationRepoId === destination.id,
      'TOPOLOGY_AGENT_UNAUTHORIZED', 'Only the actual receiving agent can answer this standing message.');
    if (record.reply) {
      invariant(record.reply.agent === agentId && record.reply.body === body, 'TOPOLOGY_REPLY_CONFLICT', 'This standing message already has a different reply.');
      return { record, reply: { ...record.reply, deduplicated: true } };
    }
    record.reply = { agent: agentId, repositoryId: destination.id, body, created_at: nowIso() };
    await atomicWrite(p.file, record);
    return { record, reply: record.reply };
  });
  const { resolveTransport } = await import('./orch-transport.mjs');
  const transportEnv = env === process.env ? env : { ...process.env, ...env };
  const transport = await resolveTransport({ env: transportEnv });
  if (transport.kind === 'nats' && settled.record?.envelope?.from) {
    const e = settled.record.envelope;
    await publishMailboxEnvelope({ env: transportEnv, home, transport, envelope: createMailboxEnvelope({
      kind: 'reply', id: `${messageId}.reply.${agentId}`, repositoryId: e.sourceRepoId || destination.id,
      from: agentId, to: e.from, body, replyTo: messageId,
      context: { ...(e.context || {}), sourceRepositoryId: destination.id, standing: true, taskId: e.task ?? e.context?.taskId ?? null },
    }) });
  }
  return settled.reply;
}

// TM-351. Delivered standing mail rings its recipient's pane once, so an idle agent learns of it
// without polling its inbox. The ring is a pointer (message id + the exact read command), never the
// body, and it goes through `ringMessage`, which holds rather than type into an unsafe composer. A
// held ring is retried on the next supervisor tick; a marker under rings/ makes it once per message
// across ticks and restarts. Only mail `standingUnread` admits is rung (TM-419), and only mail
// delivered after the ring first ran for this repository: the first run writes a per-repository
// watermark, so a backlog that predates the feature never rings.
export const STANDING_RING_WINDOW_MS = Number(process.env.AO_STANDING_RING_WINDOW_MS ?? 3000);

export function standingRingPointer(record, consumer) {
  const e = record.envelope;
  // The sender is caller-asserted text typed into a terminal: keep printable characters only.
  const from = String(e.from ?? 'unknown').replace(/[^\x20-\x7e]/g, '?').slice(0, 80);
  return `[ao] Standing message ${e.id} from ${from}: read it with ao-topology mailbox inbox --consumer ${shellQuote(consumer)} --agent ${shellQuote(record.delivered_to)}`;
}

/** `panes`: live panes of this repository, `{ agentId, command, ...binding }`. One ring per agent
 * per call, so a backlog reaches an agent one pointer per tick rather than as a burst. */
export async function ringStandingMail({ consumer, panes = [], adapters = null, windowMs = STANDING_RING_WINDOW_MS, ringDeps = {}, ...options }) {
  const identity = await canonicalRepoId(consumer);
  const { ringMessage } = await import('./delivery.mjs');
  const { deliverPointer, tmuxFailureTrigger } = await import('./launch.mjs');
  const { adapterForPane } = await import('./census.mjs');
  const { withServer } = await import('./tmux.mjs');
  const { selectedTransportEnv, transportMode } = await import('./orch-transport.mjs');
  const ringsDir = join(standingMailboxRoot(options), 'rings');
  const env = options.env ?? process.env;
  const transportKind = options.transport?.kind ?? transportMode(selectedTransportEnv(env));
  const seedFile = join(ringsDir, `seed-${createHash('sha256').update(identity.id).digest('hex')}.json`);
  let seed = await read(seedFile);
  if (!seed) {
    seed = { repoId: identity.id, since: nowIso() };
    await mkdir(ringsDir, { recursive: true, mode: 0o700 });
    await atomicWrite(seedFile, seed);
  }
  const since = Date.parse(seed.since);
  const busy = new Set(), results = [];
  for (const record of await records(options)) {
    const id = record.envelope.id, agent = record.delivered_to;
    const scope = { repoId: identity.id, agent, transportKind };
    // Missing delivered_at reads as NaN, which is never >= since: an undated record is backlog.
    if (!standingInboxShows(record, scope) || !(Date.parse(record.delivered_at) >= since) || busy.has(agent)) continue;
    const marker = join(ringsDir, `${createHash('sha256').update(id).digest('hex')}.json`);
    const prior = await read(marker);
    if (prior?.done) continue;
    const settle = async (fields) => {
      const next = { id, agent, attempts: (prior?.attempts ?? 0) + (fields.rung ? 1 : 0), at: nowIso(), ...fields };
      delete next.rung;
      await mkdir(ringsDir, { recursive: true, mode: 0o700 });
      await atomicWrite(marker, next);
      results.push(next);
    };
    const receipt = await getMailboxReceipt({ consumer, agent, messageId: id, env: options.env, home: options.home }).catch(() => null);
    if (!standingUnread(record, { ...scope, receipt })) { await settle({ state: 'read', done: true, reason: 'the recipient already read or answered it' }); continue; }
    const pane = panes.find(p => p.agentId === agent);
    if (!pane?.paneId || !pane.serverKey) { await settle({ state: 'held', done: false, reason: 'the recipient has no live pane' }); continue; }
    busy.add(agent);
    const binding = Object.fromEntries(['serverKey', 'serverPid', 'sessionId', 'sessionCreated', 'paneId', 'panePid'].map(k => [k, pane[k]]));
    const outcome = await withServer(pane.serverKey, () => ringMessage({ runDir: null, agentId: agent,
      agent: { id: agent, pane: pane.paneId, binding }, adapter: adapterForPane(adapters, pane),
      pointer: standingRingPointer(record, consumer), messageId: id, session: null, windowMs,
      deliverPointer, tmuxFailureTrigger, ...ringDeps }));
    // Escalated means something was typed and did not land; retyping would double it, so it is final.
    await settle({ rung: true, state: outcome.delivery.state, notification: outcome.notification,
      reason: outcome.delivery.reason, done: outcome.rang || outcome.delivery.escalated === true });
  }
  return results;
}

// TM-352. Block until a standing message has a reply. Unknown ids are an error, never ok:true; a
// permanent hold returns at once, since no reply can ever come. Polls; KV watch is TM-311.
// TM-465: `caller` is the waiter's sessionIdentity() and is required. Only the message's own sender,
// in its own source repository, is told anything about it; anyone else gets TOPOLOGY_SENDER_MISMATCH
// and no status, recipient or body. Message ids are often guessable (caller-chosen --id, nonces).
export async function waitForStandingReply({ id, caller, timeoutMs = 20 * 60_000, pollMs = 2000, ...options }) {
  invariant(caller?.agent && caller?.consumer, 'TOPOLOGY_SOURCE_IDENTITY_REQUIRED', 'Waiting on a standing reply requires the waiting session\'s identity. Nothing was read.');
  const callerRepo = (await canonicalRepoId(caller.consumer)).id;
  const started = Date.now();
  for (;;) {
    const record = await readStandingMessage({ id, ...options });
    // F4: an unknown id and another sender's id are one answer, so waiting cannot probe which ids exist.
    invariant(record && record.envelope.from === caller.agent && record.envelope.sourceRepoId === callerRepo, 'TOPOLOGY_SENDER_MISMATCH',
      `This session (${caller.agent}) sent no standing message ${id}; only its sender may wait on its reply. Nothing was read.`);
    const base = { id, status: record.status, delivered_to: record.delivered_to ?? null, elapsed_ms: Date.now() - started };
    if (record.reply) return { ok: true, ...base, reply: record.reply };
    if (record.permanent) return { ok: false, code: 'TOPOLOGY_MESSAGE_UNDELIVERABLE', ...base, reason: record.reason,
      message: `Standing message ${id} is permanently held (${record.reason}); no reply can arrive.` };
    if (Date.now() - started >= timeoutMs) return { ok: false, code: 'TOPOLOGY_MAILBOX_WAIT_TIMEOUT', ...base,
      message: `No reply to standing message ${id} within ${timeoutMs}ms.` };
    await sleep(Math.max(0, Math.min(pollMs, timeoutMs - (Date.now() - started))));
  }
}
