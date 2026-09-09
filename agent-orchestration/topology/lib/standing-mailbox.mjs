// Durable standing mail is independent of run rosters. One atomic envelope is
// the source of truth for both inbox and outbox; retries never publish a second
// copy or send terminal input. Readiness checks do not create or restart leads.
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, open, readFile, readdir, rename, rm } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { leadState } from './lead.mjs';
import { withLock } from './lockfile.mjs';
import { canonicalRepoId, stateRoot } from './repoid.mjs';
import { hopExceeded, isAssignmentStage, nextVia, routeMessage } from './routing.mjs';
import { invariant, nowIso } from './util.mjs';

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

async function advance(record, opts) {
  if (record.status === 'delivered') return record;
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
        readiness({ ...opts, consumer: e.fromProject }),
        readiness({ ...opts, consumer: e.consumer }),
      ]);
      if (!responsive(src) || !responsive(dst)) return { ...updated, reason: 'leads_not_ready', readiness: { source: src?.status ?? 'unknown', destination: dst?.status ?? 'unknown' } };
    }
    // This is intentionally rerun, including delegationAllows/verifyAgainstStore,
    // for EACH resume. A held record contains no cached grant.
    const decision = await (opts.router ?? routeMessage)({
      consumer: e.consumer, pluginRoot: opts.pluginRoot, home: opts.home,
      from: e.from, fromProject: sameRepo ? e.consumer : e.fromProject,
      to: e.to, task: e.task, token: e.token, via: e.via,
    });
    if (decision.blocked) return { ...updated, reason: decision.blocked, decision };
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
    parentId: input.parentId ?? null, via: input.via ?? [],
    assignment: input.assignment === undefined ? isAssignmentStage(input.stage) : input.assignment === true,
  }));
  const p = paths(id, opts);
  await mkdir(join(p.root, 'messages'), { recursive: true, mode: 0o700 });
  return withLock(p.lock, async () => {
    let record = await read(p.file);
    if (record) invariant(isDeepStrictEqual(record.envelope, envelope), 'TOPOLOGY_MESSAGE_ID_CONFLICT', 'Message ID already names different content or provenance.');
    else {
      record = { version: 1, envelope, status: 'held', reason: 'pending_admission', attempts: 0, created_at: nowIso() };
      await atomicWrite(p.file, record);
    }
    if (record.status === 'delivered') return { ...record, deduplicated: true };
    record = await advance(record, opts);
    await atomicWrite(p.file, record);
    return record;
  });
}

async function records(opts) {
  const dir = join(standingMailboxRoot(opts), 'messages');
  let names;
  try { names = await readdir(dir); } catch (error) { if (error.code === 'ENOENT') return []; throw error; }
  const results = [];
  for (const name of names.filter(n => /^[0-9a-f]{64}\.json$/.test(n)).sort()) {
    const record = await read(join(dir, name));
    invariant(record?.version === 1 && record.envelope?.id, 'TOPOLOGY_STANDING_STATE_INVALID', 'Invalid standing mailbox record.');
    results.push(record);
  }
  return results;
}

/** Safe-boundary watcher calls this without a run. Delivered records are final;
 * each held request rechecks both leads and the live receiving task store. */
export async function resumeStandingMessages({ consumer, ...options }) {
  const identity = await canonicalRepoId(consumer);
  const resumed = [];
  for (const old of await records(options)) {
    if (old.envelope.destinationRepoId !== identity.id || old.status !== 'held') continue;
    const p = paths(old.envelope.id, options);
    resumed.push(await withLock(p.lock, async () => {
      const current = await read(p.file);
      invariant(current, 'TOPOLOGY_STANDING_STATE_INVALID', 'Standing message disappeared during resume.');
      if (current.status === 'delivered') return current;
      const next = await advance(current, options);
      await atomicWrite(p.file, next);
      return next;
    }));
  }
  return resumed;
}

// These are host-local mailbox views, not an authorization boundary. API/CLI
// callers must establish the current agent identity before returning bodies.
export async function readStandingInbox({ consumer, agent, ...options }) {
  invariant(agent, 'TOPOLOGY_AGENT_REQUIRED', 'Inbox requires an agent.');
  const identity = await canonicalRepoId(consumer);
  return (await records(options)).filter(r => r.status === 'delivered' && r.envelope.destinationRepoId === identity.id && r.delivered_to === agent);
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
    invariant(record.version === 1 && record.envelope?.id === id && ['held', 'delivered'].includes(record.status), 'TOPOLOGY_STANDING_STATE_INVALID', 'Invalid standing mailbox record.');
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
  return withLock(p.lock, async () => {
    const record = await read(p.file);
    invariant(record?.status === 'delivered', 'TOPOLOGY_MESSAGE_UNDELIVERED', 'A held or missing message cannot be answered.');
    invariant(record.delivered_to === agentId && record.envelope.destinationRepoId === destination.id,
      'TOPOLOGY_AGENT_UNAUTHORIZED', 'Only the actual receiving agent can answer this standing message.');
    if (record.reply) {
      invariant(record.reply.agent === agentId && record.reply.body === body, 'TOPOLOGY_REPLY_CONFLICT', 'This standing message already has a different reply.');
      return { ...record.reply, deduplicated: true };
    }
    record.reply = { agent: agentId, repositoryId: destination.id, body, created_at: nowIso() };
    await atomicWrite(p.file, record);
    return record.reply;
  });
}
