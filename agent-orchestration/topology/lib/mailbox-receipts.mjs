// AO owns durable delivery obligations. Broker ACK means this ledger accepted the
// envelope, never that an agent finished it or acquired a Task Management claim.
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, open, readFile, readdir, rename, rm } from 'node:fs/promises';
import { dirname, isAbsolute, join } from 'node:path';
import { homedir } from 'node:os';
import { canonicalRepoId, repoKey, stateRoot } from './repoid.mjs';
import { withLock } from './lockfile.mjs';
import { invariant, nowIso } from './util.mjs';

const hash = value => createHash('sha256').update(value).digest('hex');
const canonical = value => JSON.stringify(value, (_, item) => item && typeof item === 'object' && !Array.isArray(item)
  ? Object.fromEntries(Object.keys(item).sort().map(key => [key, item[key]])) : item);
const STATES = new Set(['accepted', 'handled', 'deferred', 'rejected']);
const TERMINAL = new Set(['handled', 'rejected']);
const bounded = (value, name, max = 512) => invariant(typeof value === 'string' && value.length > 0 && value.length <= max,
  'TOPOLOGY_MAILBOX_ENVELOPE', `${name} must be a nonempty bounded string.`);

export function createMailboxEnvelope({ id, kind = 'mail', repositoryId, from = null, to, body, replyTo = null, context = {} }) {
  bounded(id, 'message ID'); bounded(repositoryId, 'repository ID', 8192); bounded(to, 'recipient');
  invariant(['mail', 'reply'].includes(kind), 'TOPOLOGY_MAILBOX_ENVELOPE', 'Unknown envelope kind.');
  invariant(from === null || typeof from === 'string' && from.length > 0 && from.length <= 512, 'TOPOLOGY_MAILBOX_ENVELOPE', 'Invalid sender.');
  invariant(typeof body === 'string' && body.trim() && Buffer.byteLength(body) <= 1024 * 1024, 'TOPOLOGY_MAILBOX_ENVELOPE', 'Message body must contain at most 1 MiB.');
  invariant(replyTo === null || typeof replyTo === 'string' && replyTo.length > 0 && replyTo.length <= 512, 'TOPOLOGY_MAILBOX_ENVELOPE', 'Invalid reply correlation.');
  invariant(context && typeof context === 'object' && !Array.isArray(context), 'TOPOLOGY_MAILBOX_ENVELOPE', 'Envelope context must be an object.');
  const envelope = JSON.parse(canonical({ protocol: 'ao.mailbox-envelope', schemaVersion: 1, id, kind, repositoryId, from, to, body, replyTo, context }));
  invariant(Buffer.byteLength(canonical(envelope)) <= 2 * 1024 * 1024, 'TOPOLOGY_MAILBOX_ENVELOPE', 'Envelope is too large.');
  return { ...envelope, payloadDigest: hash(canonical(envelope)) };
}

function verifiedEnvelope(envelope) {
  invariant(envelope && typeof envelope === 'object' && !Array.isArray(envelope), 'TOPOLOGY_MAILBOX_ENVELOPE', 'Stored envelope is missing or invalid.');
  const verified = createMailboxEnvelope(envelope);
  invariant(envelope.protocol === 'ao.mailbox-envelope' && envelope.schemaVersion === 1 && envelope.payloadDigest === verified.payloadDigest,
    'TOPOLOGY_MAILBOX_DIGEST', 'Envelope schema or immutable payload digest does not match.');
  return verified;
}

export function mailboxLedgerRoot({ env = process.env, home = homedir() } = {}) {
  return join(stateRoot(env, home), 'mailbox', 'v1');
}

async function identityOf(consumer) {
  invariant(typeof consumer === 'string' && isAbsolute(consumer), 'TOPOLOGY_REPO_REQUIRED', 'Mailbox operations require an absolute consumer repository.');
  return canonicalRepoId(consumer);
}

function recordPath(envelope, area, options) {
  return join(mailboxLedgerRoot(options), repoKey(envelope.repositoryId), area,
    hash(canonical([envelope.kind, envelope.to, envelope.id])) + '.json');
}

async function read(path) {
  try { return JSON.parse(await readFile(path, 'utf8')); }
  catch (error) { if (error.code === 'ENOENT') return null; throw error; }
}

async function syncDirectory(path) {
  if (process.platform === 'win32') return;
  const directory = await open(path, 'r');
  try { await directory.sync(); } finally { await directory.close(); }
}

// Sync newly created parent entries too; syncing only the final file directory
// would not make a first-use ledger survive loss of its new parent directories.
async function ensureDirectory(path) {
  try { await mkdir(path, { mode: 0o700 }); }
  catch (error) {
    if (error.code === 'EEXIST') return;
    if (error.code !== 'ENOENT') throw error;
    await ensureDirectory(dirname(path));
    return ensureDirectory(path);
  }
  await syncDirectory(dirname(path));
}

async function write(path, record) {
  await ensureDirectory(dirname(path));
  const temp = `${path}.${randomUUID()}.tmp`;
  try {
    const file = await open(temp, 'wx', 0o600);
    try { await file.writeFile(JSON.stringify(record) + '\n'); await file.sync(); } finally { await file.close(); }
    await rename(temp, path);
    await syncDirectory(dirname(path));
  } finally { await rm(temp, { force: true }); }
}

function samePayload(record, envelope) {
  invariant(record.payloadDigest === envelope.payloadDigest && record.envelope?.repositoryId === envelope.repositoryId,
    'TOPOLOGY_MESSAGE_ID_CONFLICT', 'Message ID already identifies different immutable content or provenance.');
}

function verifyReceipt(record) {
  const envelope = verifiedEnvelope(record.envelope);
  invariant(record.schemaVersion === 1 && record.repositoryId === envelope.repositoryId && record.agent === envelope.to
    && record.messageId === envelope.id && record.kind === envelope.kind && record.payloadDigest === envelope.payloadDigest && STATES.has(record.status),
  'TOPOLOGY_MAILBOX_IDENTITY', 'Receipt identity or payload differs from its envelope.');
  return record;
}

/** Accept and fsync before ACK. A failure before or during ACK leaves replayable
 * evidence; a later delivery verifies the digest and retains the disposition. */
export async function acceptMailboxDelivery({ consumer, agent, kind = 'mail', delivery, ...options }) {
  const identity = await identityOf(consumer);
  bounded(agent, 'recipient');
  let parsed;
  try { parsed = JSON.parse(delivery.rawBody ?? delivery.body); } catch { parsed = null; }
  let envelope;
  if (parsed?.protocol === 'ao.mailbox-envelope') envelope = verifiedEnvelope(parsed);
  else {
    // Previously published messages have no versioned envelope. Their broker ID
    // is the immutable migration identity; the original bytes remain the body.
    const body = kind === 'reply' && typeof parsed?.body === 'string' ? parsed.body : delivery.body;
    envelope = createMailboxEnvelope({ id: delivery.messageId || `legacy:${hash(delivery.rawBody ?? delivery.body)}`,
      repositoryId: identity.id, to: agent, kind, body, from: parsed?.from ?? null,
      replyTo: parsed?.reply_to ?? null, context: { legacy: true } });
  }
  invariant(envelope.repositoryId === identity.id && envelope.to === agent && envelope.kind === kind,
    'TOPOLOGY_MAILBOX_IDENTITY', 'Envelope does not belong to the requested repository, recipient and mailbox.');
  const path = recordPath(envelope, 'receipts', options);
  await ensureDirectory(dirname(path));
  const record = await withLock(`${path}.lock`, async () => {
    const existing = await read(path);
    if (existing) { verifyReceipt(existing); samePayload(existing, envelope); return { ...existing, deduplicated: true }; }
    const at = nowIso();
    const next = { schemaVersion: 1, messageId: envelope.id, kind, repositoryId: identity.id, agent,
      payloadDigest: envelope.payloadDigest, envelope, status: 'accepted', acceptedAt: at, updatedAt: at,
      subject: delivery.subject ?? null, disposition: null };
    await write(path, next);
    return next;
  });
  await delivery.ack();
  return record ? verifyReceipt(record) : null;
}

export async function getMailboxReceipt({ consumer, agent, messageId, kind = 'mail', ...options }) {
  const identity = await identityOf(consumer); bounded(agent, 'recipient'); bounded(messageId, 'message ID');
  const record = await read(recordPath({ repositoryId: identity.id, to: agent, id: messageId, kind }, 'receipts', options));
  if (record) invariant(record.repositoryId === identity.id && record.agent === agent && record.messageId === messageId && record.kind === kind,
    'TOPOLOGY_MAILBOX_IDENTITY', 'Stored receipt does not match its requested identity.');
  return record ? verifyReceipt(record) : null;
}

/** Nondestructive operator view. No transport connection, broker pull, or ACK. */
export async function listMailboxReceipts({ consumer, agent, kind, status, workflowId, runId, taskId, ...options }) {
  const identity = await identityOf(consumer);
  invariant(!status || STATES.has(status), 'TOPOLOGY_MAILBOX_DISPOSITION', 'Unknown receipt status.');
  const dir = join(mailboxLedgerRoot(options), repoKey(identity.id), 'receipts');
  const records = [];
  for (const file of await readdir(dir).catch(error => { if (error.code === 'ENOENT') return []; throw error; })) {
    if (!file.endsWith('.json')) continue;
    const record = await read(join(dir, file));
    invariant(record?.schemaVersion === 1 && record.repositoryId === identity.id, 'TOPOLOGY_MAILBOX_IDENTITY', 'Invalid receipt repository or schema.');
    verifyReceipt(record);
    if (agent && record.agent !== agent || kind && record.kind !== kind || status && record.status !== status) continue;
    const context = record.envelope.context;
    if (workflowId && context.workflowId !== workflowId || runId && context.runId !== runId || taskId && context.taskId !== taskId) continue;
    records.push(record);
  }
  return records.sort((a, b) => a.acceptedAt.localeCompare(b.acceptedAt) || a.messageId.localeCompare(b.messageId));
}

export async function setMailboxDisposition({ consumer, agent, messageId, kind = 'mail', disposition, reason = null, retryAt = null, resultRef = null, ...options }) {
  const identity = await identityOf(consumer); bounded(agent, 'recipient'); bounded(messageId, 'message ID');
  invariant(['handled', 'deferred', 'rejected'].includes(disposition), 'TOPOLOGY_MAILBOX_DISPOSITION', 'Disposition must be handled, deferred or rejected.');
  invariant(reason === null || typeof reason === 'string' && reason.length <= 8192, 'TOPOLOGY_MAILBOX_DISPOSITION', 'Reason must be bounded text.');
  invariant(resultRef === null || typeof resultRef === 'string' && resultRef.length <= 8192, 'TOPOLOGY_MAILBOX_DISPOSITION', 'Result reference must be bounded text.');
  invariant(retryAt === null || disposition === 'deferred' && Number.isFinite(Date.parse(retryAt)), 'TOPOLOGY_MAILBOX_DISPOSITION', 'Retry time is only valid for deferred mail.');
  const env = options.env ?? process.env;
  invariant(!env.AO_AGENT_ID || env.AO_AGENT_ID === agent, 'TOPOLOGY_AGENT_UNAUTHORIZED', 'An agent may only dispose its own obligations.');
  if (env.AO_CONSUMER) invariant((await identityOf(env.AO_CONSUMER)).id === identity.id, 'TOPOLOGY_AGENT_UNAUTHORIZED', 'Caller repository differs from the mailbox.');
  const path = recordPath({ repositoryId: identity.id, to: agent, id: messageId, kind }, 'receipts', options);
  await ensureDirectory(dirname(path));
  return withLock(`${path}.lock`, async () => {
    const current = await getMailboxReceipt({ consumer, agent, messageId, kind, ...options });
    invariant(current, 'TOPOLOGY_MAILBOX_RECEIPT_MISSING', 'No accepted obligation exists for this message.');
    const details = { reason, retryAt, resultRef };
    if (current.status === disposition && canonical(current.disposition) === canonical(details)) return current;
    invariant(!TERMINAL.has(current.status), 'TOPOLOGY_MAILBOX_TERMINAL', 'A handled or rejected receipt is immutable.');
    const next = { ...current, status: disposition, updatedAt: nowIso(), disposition: details };
    await write(path, next); return next;
  });
}

/** Durable sender outbox: write intent before publish, and published only after
 * PubAck. Repeating a completed send never relies on the broker dedup window. */
export async function publishMailboxEnvelope({ envelope, transport, ...options }) {
  envelope = verifiedEnvelope(envelope);
  const path = recordPath(envelope, 'publications', options);
  await ensureDirectory(dirname(path));
  return withLock(`${path}.lock`, async () => {
    let record = await read(path);
    if (record) samePayload(record, envelope);
    else {
      record = { schemaVersion: 1, messageId: envelope.id, kind: envelope.kind, repositoryId: envelope.repositoryId,
        payloadDigest: envelope.payloadDigest, envelope, status: 'pending', createdAt: nowIso(), attempts: 0 };
      await write(path, record);
    }
    if (record.status === 'published') return { ...record, deduplicated: true };
    record = { ...record, attempts: record.attempts + 1, updatedAt: nowIso() };
    await write(path, record);
    try {
      const publish = envelope.kind === 'reply' ? transport.publishReply.bind(transport) : transport.publishMail.bind(transport);
      const result = await publish({ repo: repoKey(envelope.repositoryId), agent: envelope.to, messageId: envelope.id, body: JSON.stringify(envelope) });
      const next = { ...record, status: 'published', publishedAt: nowIso(), result, lastError: null };
      await write(path, next); return next;
    } catch (error) {
      await write(path, { ...record, lastError: error.code || 'TOPOLOGY_PUBLICATION_FAILED' });
      throw error;
    }
  });
}

export async function resumeMailboxPublications({ consumer, transport, ...options }) {
  const resumed = [];
  for (const record of await listMailboxPublications({ ...options, consumer, status: 'pending' })) {
    // Standing mail retains its own admission and retry deadline. Replies have
    // no standing delivery record and use this generic publication recovery.
    if (record.kind === 'mail' && record.envelope.context.standing === true) continue;
    transport ??= await (await import('./orch-transport.mjs')).resolveTransport({ env: options.env ?? process.env });
    if (transport.kind !== 'nats') continue;
    resumed.push(await publishMailboxEnvelope({ ...options, envelope: record.envelope, transport }));
  }
  return resumed;
}

/** Nondestructive sender view. A publication says only whether the broker
 * accepted it; recipient acceptance/disposition remains a separate receipt. */
export async function listMailboxPublications({ consumer, agent, kind, status, workflowId, runId, taskId, ...options }) {
  const identity = await identityOf(consumer), root = mailboxLedgerRoot(options), records = [];
  invariant(!status || ['pending', 'published'].includes(status), 'TOPOLOGY_MAILBOX_PUBLICATION', 'Unknown publication status.');
  for (const repository of await readdir(root).catch(error => { if (error.code === 'ENOENT') return []; throw error; })) {
    const dir = join(root, repository, 'publications');
    for (const file of await readdir(dir).catch(error => { if (error.code === 'ENOENT' || error.code === 'ENOTDIR') return []; throw error; })) {
      if (!file.endsWith('.json')) continue;
      const record = await read(join(dir, file)), envelope = verifiedEnvelope(record?.envelope);
      invariant(record.schemaVersion === 1 && record.repositoryId === envelope.repositoryId && repository === repoKey(envelope.repositoryId)
        && record.messageId === envelope.id && record.kind === envelope.kind && record.payloadDigest === envelope.payloadDigest
        && ['pending', 'published'].includes(record.status), 'TOPOLOGY_MAILBOX_IDENTITY', 'Invalid publication identity or schema.');
      const context = envelope.context;
      if ((context.sourceRepositoryId || envelope.repositoryId) !== identity.id || agent && envelope.from !== agent
        || kind && record.kind !== kind || status && record.status !== status || workflowId && context.workflowId !== workflowId
        || runId && context.runId !== runId || taskId && context.taskId !== taskId) continue;
      records.push(record);
    }
  }
  return records.sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.messageId.localeCompare(b.messageId));
}
