// AO owns durable delivery obligations. Broker ACK means this ledger accepted the
// envelope, never that an agent finished it or acquired a Task Management claim.
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, open, readFile, readdir, rename, rm, stat } from 'node:fs/promises';
import { dirname, isAbsolute, join } from 'node:path';
import { homedir } from 'node:os';
import { canonicalRepoId, repoKey, repoSlug, stateRoot } from './repoid.mjs';
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

/** TM-482 F2: a receipt is keyed by its sender too, so a message from another sender that reuses an
 * ID (a predictable `<id>.reply.<agent>`, say) is a separate receipt and can never squat the real
 * one. Receipts written before this used recordPath and are still found by the readers below. */
function receiptPath(envelope, options) {
  return join(mailboxLedgerRoot(options), repoKey(envelope.repositoryId), 'receipts',
    hash(canonical(['receipt', envelope.kind, envelope.to, envelope.from ?? null, envelope.id])) + '.json');
}

/** Every receipt for (agent, kind, messageId), one per sender, with the file each lives in.
 * ponytail: a directory scan per lookup; index by message ID if receipt counts grow large. */
async function receiptsFor({ repositoryId, agent, kind, messageId, from }, options) {
  const matches = record => record?.agent === agent && record.kind === kind && record.messageId === messageId
    && (from === undefined || (record.envelope?.from ?? null) === from);
  // TM-482 N1: a named sender has at most two possible files, its own and the pre-F2 one; read
  // those directly so an unrelated corrupt file in the directory cannot get in the way.
  if (from !== undefined) {
    const key = { repositoryId, kind, to: agent, id: messageId, from };
    for (const path of [receiptPath(key, options), recordPath(key, 'receipts', options)]) {
      const record = await read(path);
      if (matches(record)) return [{ path, record }];
    }
  }
  const dir = join(mailboxLedgerRoot(options), repoKey(repositoryId), 'receipts'), found = [];
  for (const file of await readdir(dir).catch(error => { if (error.code === 'ENOENT') return []; throw error; })) {
    if (!file.endsWith('.json')) continue;
    // N1: the scan skips a file it cannot parse; that file is not this message's receipt.
    const record = await read(join(dir, file)).catch(error => { if (error instanceof SyntaxError) return null; throw error; });
    if (matches(record)) found.push({ path: join(dir, file), record });
  }
  return found;
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

/** TM-482: a message that can never be accepted: not an envelope, a bad digest, a body over 1 MiB,
 * another recipient's mail, an ID reused for different content. Redelivery cannot fix it, and the
 * broker redelivers a NAKed message first, so a NAK would block every message behind it forever. */
const poison = error => typeof error?.code === 'string' && (error.code.startsWith('TOPOLOGY_MAILBOX_') || error.code === 'TOPOLOGY_MESSAGE_ID_CONFLICT');

const PAGE_INTERVAL_MS = 60 * 60_000;
const DEAD_LETTER_MAX = 500;

/** TM-482 F3/F6: at most one operator page per key (for example repository, agent and error code)
 * per hour. A suppressed page is counted and the count rides on the next page that goes out.
 * Never throws: paging is reporting, and a failed page must not become a second failure. */
export async function pageOperator({ key, title, body, ...options }) {
  try {
    const path = join(mailboxLedgerRoot(options), 'pages', hash(canonical(key)) + '.json');
    await ensureDirectory(dirname(path));
    const now = (options.now ?? Date.now)();
    const decision = await withLock(`${path}.lock`, async () => {
      const state = await read(path).catch(() => null) ?? { lastPagedAt: null, suppressed: 0 };
      if (state.lastPagedAt && now - Date.parse(state.lastPagedAt) < PAGE_INTERVAL_MS) {
        await write(path, { ...state, suppressed: state.suppressed + 1 }); return { send: false };
      }
      await write(path, { lastPagedAt: new Date(now).toISOString(), suppressed: 0 });
      return { send: true, suppressed: state.suppressed };
    });
    if (!decision.send) return { sent: false, reason: 'rate_limited' };
    const notify = options.notify ?? (await import('./ntfy.mjs')).page;
    const more = decision.suppressed ? `\n(${decision.suppressed} more like this in the last hour were not paged)` : '';
    return await notify({ title, body: body + more, env: options.env ?? process.env });
  } catch (error) { return { sent: false, reason: error.code ?? String(error.message) }; }
}

/** Keep the newest DEAD_LETTER_MAX records; the oldest go first. */
async function pruneDeadLetters(dir) {
  const names = (await readdir(dir)).filter(name => name.endsWith('.json'));
  if (names.length <= DEAD_LETTER_MAX) return;
  const aged = await Promise.all(names.map(async name => ({ name, at: (await stat(join(dir, name)).catch(() => null))?.mtimeMs ?? 0 })));
  for (const { name } of aged.sort((x, y) => x.at - y.at).slice(0, names.length - DEAD_LETTER_MAX)) await rm(join(dir, name), { force: true });
}

/** Dead-letter the delivery with its reason, page the operator, then term it (ACK where the
 * transport has no term) so the inbox moves on. F4: the record says when it was paged; a crash
 * before that leaves the message unsettled, so its redelivery pages. */
async function quarantine({ identity, agent, kind, delivery, error, options }) {
  const raw = String(delivery.rawBody ?? delivery.body ?? '');
  const dir = join(mailboxLedgerRoot(options), repoKey(identity.id), 'dead-letter');
  const path = join(dir, hash(canonical([kind, agent, raw])) + '.json');
  await ensureDirectory(dir);
  const record = await withLock(`${path}.lock`, async () => {
    const existing = await read(path).catch(() => null);
    if (existing) return existing;
    const next = { schemaVersion: 1, kind, agent, repositoryId: identity.id, code: error.code, reason: String(error.message).slice(0, 2000),
      subject: delivery.subject ?? null, messageId: delivery.messageId ?? null, rawBody: raw, quarantinedAt: nowIso(), notifiedAt: null };
    await write(path, next); await pruneDeadLetters(dir); return next;
  });
  let notified = null;
  if (!record.notifiedAt) {
    notified = await pageOperator({ ...options, key: ['dead-letter', identity.id, agent, error.code],
      title: `AO mailbox: quarantined a message for ${agent}`,
      body: `${error.code}: ${record.reason}\nrepository: ${identity.id}\nsubject: ${record.subject ?? '-'}\ndead letter: ${path}` });
    await withLock(`${path}.lock`, async () => write(path, { ...record, notifiedAt: nowIso(), page: notified }));
  }
  await (delivery.term ?? delivery.ack)();
  return { quarantined: true, code: error.code, reason: record.reason, deadLetter: path, messageId: record.messageId, notified };
}

/** F6: an unreadable mailbox record the resume sweep skipped is escalated once per file, through
 * the same hourly limit. */
export async function escalateUnreadable(errors, options = {}) {
  for (const { file, code } of errors.filter(error => error.file)) {
    const marker = join(mailboxLedgerRoot(options), 'escalated', hash(file) + '.json');
    if (await read(marker).catch(() => null)) continue;
    const page = await pageOperator({ ...options, key: ['unreadable-record', code], title: 'AO mailbox: skipping an unreadable record',
      body: `${code}: ${file}\nThe resume sweep skips it until it is repaired or removed.` });
    await ensureDirectory(dirname(marker)); await write(marker, { file, code, escalatedAt: nowIso(), page });
  }
}

/** Accept and fsync before ACK. A failure before or during ACK leaves replayable
 * evidence; a later delivery verifies the digest and retains the disposition.
 * TM-482: a message that fails validation is quarantined and termed, never thrown for a NAK. Only a
 * local failure (I/O, a corrupt local receipt) still throws, so the caller NAKs and retries it. */
export async function acceptMailboxDelivery({ consumer, agent, kind = 'mail', delivery, ...options }) {
  const identity = await identityOf(consumer);
  bounded(agent, 'recipient');
  let envelope;
  try { envelope = deliveredEnvelope({ identity, agent, kind, delivery }); }
  catch (error) { if (poison(error)) return quarantine({ identity, agent, kind, delivery, error, options }); throw error; }
  const path = receiptPath(envelope, options);
  await ensureDirectory(dirname(path));
  const record = await withLock(`${path}.lock`, async () => {
    let existing = await read(path);
    // A receipt from before F2 lives at the sender-less path; it is the same obligation only when
    // the same sender wrote it.
    if (!existing) {
      const legacy = await read(recordPath(envelope, 'receipts', options));
      if (legacy && (legacy.envelope?.from ?? null) === (envelope.from ?? null)) existing = legacy;
    }
    if (existing) {
      verifyReceipt(existing);
      try { samePayload(existing, envelope); } catch (error) { return { conflict: error }; }
      return { ...existing, deduplicated: true };
    }
    const at = nowIso();
    const next = { schemaVersion: 1, messageId: envelope.id, kind, repositoryId: identity.id, agent,
      payloadDigest: envelope.payloadDigest, envelope, status: 'accepted', acceptedAt: at, updatedAt: at,
      subject: delivery.subject ?? null, disposition: null };
    await write(path, next);
    return next;
  });
  if (record.conflict) return quarantine({ identity, agent, kind, delivery, error: record.conflict, options });
  await delivery.ack();
  return verifyReceipt(record);
}

function deliveredEnvelope({ identity, agent, kind, delivery }) {
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
  return envelope;
}

export async function getMailboxReceipt({ consumer, agent, messageId, kind = 'mail', from, ...options }) {
  const identity = await identityOf(consumer); bounded(agent, 'recipient'); bounded(messageId, 'message ID');
  const found = await receiptsFor({ repositoryId: identity.id, agent, kind, messageId, from }, options);
  invariant(found.length <= 1, 'TOPOLOGY_MAILBOX_AMBIGUOUS', `${found.length} senders used message ID ${messageId}; name the sender (from) to pick one.`);
  const record = found[0]?.record;
  if (record) invariant(record.repositoryId === identity.id && record.agent === agent && record.messageId === messageId && record.kind === kind,
    'TOPOLOGY_MAILBOX_IDENTITY', 'Stored receipt does not match its requested identity.');
  return record ? verifyReceipt(record) : null;
}

/** TM-464 F1: every reader that returns mail or receipt bodies is scoped. It names one bound
 * `agent`, or says `allAgents: true` explicitly, which only an operator-only path may do (the
 * workflow console, gated by workflow-control's assertOperatorReader, and the publication
 * resume loop, which returns no body). A missing agent fails closed instead of meaning "everyone". */
function readerScope(agent, allAgents) {
  invariant(allAgents === true ? agent === undefined || agent === null : typeof agent === 'string' && agent.length > 0,
    'TOPOLOGY_MAILBOX_SCOPE_REQUIRED', 'Reading mailbox records requires the bound agent, or allAgents: true from an operator-only path. Nothing was read.');
}

/** Nondestructive view of one agent's receipts. No transport connection, broker pull, or ACK. */
export async function listMailboxReceipts({ consumer, agent, allAgents = false, kind, status, workflowId, runId, taskId, ...options }) {
  readerScope(agent, allAgents);
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

export async function setMailboxDisposition({ consumer, agent, messageId, kind = 'mail', from, disposition, reason = null, retryAt = null, resultRef = null, ...options }) {
  const identity = await identityOf(consumer); bounded(agent, 'recipient'); bounded(messageId, 'message ID');
  invariant(['handled', 'deferred', 'rejected'].includes(disposition), 'TOPOLOGY_MAILBOX_DISPOSITION', 'Disposition must be handled, deferred or rejected.');
  invariant(reason === null || typeof reason === 'string' && reason.length <= 8192, 'TOPOLOGY_MAILBOX_DISPOSITION', 'Reason must be bounded text.');
  invariant(resultRef === null || typeof resultRef === 'string' && resultRef.length <= 8192, 'TOPOLOGY_MAILBOX_DISPOSITION', 'Result reference must be bounded text.');
  invariant(retryAt === null || disposition === 'deferred' && Number.isFinite(Date.parse(retryAt)), 'TOPOLOGY_MAILBOX_DISPOSITION', 'Retry time is only valid for deferred mail.');
  const env = options.env ?? process.env;
  invariant(!env.AO_AGENT_ID || env.AO_AGENT_ID === agent, 'TOPOLOGY_AGENT_UNAUTHORIZED', 'An agent may only dispose its own obligations.');
  if (env.AO_CONSUMER) invariant((await identityOf(env.AO_CONSUMER)).id === identity.id, 'TOPOLOGY_AGENT_UNAUTHORIZED', 'Caller repository differs from the mailbox.');
  let located = await receiptsFor({ repositoryId: identity.id, agent, kind, messageId, from }, options);
  // TM-532: standing mail already delivered to this agent but not yet pulled into a receipt is still
  // its obligation; accept it here rather than refuse, so a duplicate delivery cannot fail dispose.
  if (!located.length && kind === 'mail') {
    const { acceptDeliveredStanding } = await import('./standing-mailbox.mjs');
    if (await acceptDeliveredStanding({ consumer, agent, messageId, from, ...options })) located = await receiptsFor({ repositoryId: identity.id, agent, kind, messageId, from }, options);
  }
  invariant(located.length <= 1, 'TOPOLOGY_MAILBOX_AMBIGUOUS', `${located.length} senders used message ID ${messageId}; name the sender (from) to pick one.`);
  invariant(located.length === 1, 'TOPOLOGY_MAILBOX_RECEIPT_MISSING', 'No accepted obligation exists for this message.');
  const { path } = located[0];
  return withLock(`${path}.lock`, async () => {
    const current = verifyReceipt(await read(path));
    invariant(current.repositoryId === identity.id && current.agent === agent && current.messageId === messageId && current.kind === kind,
      'TOPOLOGY_MAILBOX_IDENTITY', 'Stored receipt does not match its requested identity.');
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
      const result = await publish({ repo: repoKey(envelope.repositoryId), slug: repoSlug(envelope.repositoryId), agent: envelope.to, messageId: envelope.id, body: JSON.stringify(envelope) });
      const next = { ...record, status: 'published', publishedAt: nowIso(), result, lastError: null, nextRetryAt: null };
      await write(path, next); return next;
    } catch (error) {
      // TM-483: the failure and its backoff are durable, so the resume loop waits before retrying.
      const { retryDelayMs } = await import('./lead-recovery.mjs');
      await write(path, { ...record, lastError: error.code || 'TOPOLOGY_PUBLICATION_FAILED',
        nextRetryAt: new Date((options.now ?? Date.now)() + retryDelayMs(record.attempts)).toISOString() });
      throw error;
    }
  });
}

/** TM-483: one bad publication never stops the others, or the supervisor tick that called this. A
 * failed retry or an unreadable record (in any repository's ledger) is reported into `errors` and
 * skipped; a failed retry is tried again once its backoff is due (`force` skips the wait). */
export async function resumeMailboxPublications({ consumer, transport, force = false, errors = [], ...options }) {
  const resumed = [], now = options.now ?? Date.now;
  for (const record of await listMailboxPublications({ ...options, consumer, status: 'pending', allAgents: true, invalid: errors })) {
    // Standing mail retains its own admission and retry deadline. Replies have
    // no standing delivery record and use this generic publication recovery.
    if (record.kind === 'mail' && record.envelope.context.standing === true) continue;
    if (!force && record.nextRetryAt && Date.parse(record.nextRetryAt) > now()) continue;
    try {
      transport ??= await (await import('./orch-transport.mjs')).resolveTransport({ env: options.env ?? process.env });
      if (transport.kind !== 'nats') continue;
      resumed.push(await publishMailboxEnvelope({ ...options, envelope: record.envelope, transport }));
    } catch (error) {
      errors.push({ messageId: record.messageId, kind: record.kind, code: error?.code || 'TOPOLOGY_PUBLICATION_FAILED' });
    }
  }
  return resumed;
}

/** Nondestructive sender view. A publication says only whether the broker
 * accepted it; recipient acceptance/disposition remains a separate receipt. */
export async function listMailboxPublications({ consumer, agent, allAgents = false, kind, status, workflowId, runId, taskId, invalid = null, ...options }) {
  readerScope(agent, allAgents);
  const identity = await identityOf(consumer), root = mailboxLedgerRoot(options), records = [];
  invariant(!status || ['pending', 'published'].includes(status), 'TOPOLOGY_MAILBOX_PUBLICATION', 'Unknown publication status.');
  for (const repository of await readdir(root).catch(error => { if (error.code === 'ENOENT') return []; throw error; })) {
    const dir = join(root, repository, 'publications');
    for (const file of await readdir(dir).catch(error => {
      if (error.code === 'ENOENT' || error.code === 'ENOTDIR') return [];
      if (!invalid) throw error;
      invalid.push({ file: dir, code: error.code || 'TOPOLOGY_MAILBOX_UNREADABLE' }); return [];
    })) {
      if (!file.endsWith('.json')) continue;
      let record, envelope;
      try {
        record = await read(join(dir, file)); envelope = verifiedEnvelope(record?.envelope);
        invariant(record.schemaVersion === 1 && record.repositoryId === envelope.repositoryId && repository === repoKey(envelope.repositoryId)
          && record.messageId === envelope.id && record.kind === envelope.kind && record.payloadDigest === envelope.payloadDigest
          && ['pending', 'published'].includes(record.status), 'TOPOLOGY_MAILBOX_IDENTITY', 'Invalid publication identity or schema.');
      } catch (error) {
        // TM-483: an operator-only sweep (`invalid` given) reports and skips an unreadable record,
        // which may sit in another repository's ledger; a scoped reader still fails closed.
        if (!invalid) throw error;
        invalid.push({ file: join(dir, file), code: error.code || 'TOPOLOGY_MAILBOX_UNREADABLE' }); continue;
      }
      const context = envelope.context;
      if ((context.sourceRepositoryId || envelope.repositoryId) !== identity.id || agent && envelope.from !== agent
        || kind && record.kind !== kind || status && record.status !== status || workflowId && context.workflowId !== workflowId
        || runId && context.runId !== runId || taskId && context.taskId !== taskId) continue;
      records.push(record);
    }
  }
  return records.sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.messageId.localeCompare(b.messageId));
}
