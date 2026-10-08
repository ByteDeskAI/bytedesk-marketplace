// One transport for mailbox, claims, presence, probes, and reviewer verdicts.
//
// The live default is NATS on the gateway orch layout. `AO_TRANSPORT=file` selects the
// file double used by the pre-NATS suite. NATS delivery is accepted into AO's
// durable receipt ledger before ACK; a consumer must never ACK merely on read.
//
// Gateway layout (EnsureOrchLayout / docs/contracts/orch-file-mapping.md):
//   mail      orch.<repo>.mail.<agent>     stream ORCH_MAIL, durable mail_<repo>_<agent>
//   reply     orch.<repo>.mail.<agent>.reply  same stream, durable reply_<repo>_<agent>
// The mail consumer filter is the exact mail subject, so an inbox ack cannot take a reply.
//   tasks     orch.<repo>.tasks.ready      stream ORCH_TASKS, durable tasks_<repo>
//   claims    KV ORCH_CLAIMS key <repo>.<task>     revision is the compare-and-set
//   presence  KV ORCH_PRESENCE key <repo>          TTL 45s, JSON body unchanged
//   agents    KV ORCH_AGENTS key <repo>.<agent>
//   reviews   object store ORCH_REVIEWS named by content hash
//   personas  KV ORCH_PERSONAS key <scope>.<persona>   create/update/delete are revision checked (TM-279)
//   probe     orch.<repo>.probe.<agent>            core request/reply, no file
//   verdict   orch.<repo>.review.<nonce>           core publish, not a pane capture
//
// Repo and agent segments are letters, digits, hyphen, and underscore, 1–64 chars.
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import net from 'node:net';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { readJson, writeJson, writeText } from './util.mjs';
import { ensureLocalNats } from './nats-local.mjs';
import { withLock } from './lockfile.mjs';
import { stateRoot } from './repoid.mjs';

// `nats` is loaded only when the NATS transport opens. A copied plugin tree that
// uses the file double does not carry node_modules, and a top-level import would
// fail that copy before it could deliver mail.

export const ORCH_LAYOUT = Object.freeze({
  mailStream: 'ORCH_MAIL',
  tasksStream: 'ORCH_TASKS',
  claimsBucket: 'ORCH_CLAIMS',
  presenceBucket: 'ORCH_PRESENCE',
  agentsBucket: 'ORCH_AGENTS',
  reviewsBucket: 'ORCH_REVIEWS',
  personasBucket: 'ORCH_PERSONAS',
  presenceTtlMs: 45_000,
  duplicateWindowMs: 120_000,
  // TM-371: a header, not a subject change, so deployed peers keep matching `orch.<key>.…`.
  repoSlugHeader: 'Orch-Repo-Slug',
  mailSubject: (repo, agent) => `orch.${repo}.mail.${agent}`,
  replySubject: (repo, agent) => `orch.${repo}.mail.${agent}.reply`,
  tasksSubject: (repo) => `orch.${repo}.tasks.ready`,
  probeSubject: (repo, agent) => `orch.${repo}.probe.${agent}`,
  verdictSubject: (repo, nonce) => `orch.${repo}.review.${nonce}`,
  claimKey: (repo, task) => `${repo}.${task}`,
  agentKey: (repo, agent) => `${repo}.${agent}`,
  mailDurable: (repo, agent) => `mail_${repo}_${agent}`,
  replyDurable: (repo, agent) => `reply_${repo}_${agent}`,
  tasksDurable: (repo) => `tasks_${repo}`,
});

export function orchName(value) {
  const cleaned = String(value ?? '').replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 64);
  if (!/^[A-Za-z0-9_-]+$/.test(cleaned)) {
    const error = new Error(`Orch name is empty after sanitizing ${JSON.stringify(value)}`);
    error.code = 'TOPOLOGY_ORCH_NAME';
    throw error;
  }
  return cleaned;
}

export function orchSocketPath(env = process.env) {
  if (env.AO_ORCH_SOCKET) return env.AO_ORCH_SOCKET;
  const home = env.GATEWAY_HOME || join(homedir(), '.bytedesk', 'remote-gateway');
  return join(home, 'nats', 'orch.sock');
}

function fail(code, message) {
  const error = new Error(message);
  error.code = code;
  throw error;
}

/** `file` only when AO_TRANSPORT=file. Everything else is NATS. */
export function transportMode(env = process.env) {
  return env.AO_TRANSPORT === 'file' ? 'file' : 'nats';
}

// The env transport selection reads: a partial env inherits AO_TRANSPORT from the process. Shared by
// resolveTransport and by callers that need the mode without opening a connection (TM-419).
export function selectedTransportEnv(env = process.env) {
  return env === process.env ? env : { ...env, AO_TRANSPORT: env.AO_TRANSPORT ?? process.env.AO_TRANSPORT };
}

const liveTransports = new Map();
// Test seam (TM-277): lets a unit test count opens and hand out failing transports.
let openTransport = openNatsTransport;
export function useTransportOpener(open) {
  const previous = openTransport;
  openTransport = open ?? openNatsTransport;
  return () => { openTransport = previous; };
}

export async function resolveTransport({ env = process.env, transport, home } = {}) {
  if (transport) return transport;
  // Callers pass a partial env for the repo under test. Transport selection still
  // inherits AO_TRANSPORT from the process when that partial env does not set it,
  // so the file double stays selected for the existing suite.
  const selected = selectedTransportEnv(env);
  if (transportMode(selected) === 'file') return createFileTransport();
  const key = `${selected.AO_NATS_URL || ''}|${selected.AO_ORCH_SOCKET || ''}|${selected.AO_ORCH_CREDS || ''}|${orchSocketPath(selected)}|${selected.AO_NATS_JS_DOMAIN || ''}`;
  const existing = liveTransports.get(key);
  if (existing && existing.stats?.().closed === false) return existing;
  const opened = await openTransport({ env: selected, home });
  liveTransports.set(key, opened);
  const originalClose = opened.close.bind(opened);
  opened.close = async (options) => {
    if (liveTransports.get(key) === opened) liveTransports.delete(key);
    await originalClose(options);
  };
  return opened;
}

export async function closeLiveTransports() {
  const open = [...liveTransports.values()];
  liveTransports.clear();
  for (const transport of open) await transport.close();
}

// TM-277. Errors that mean "the NATS server is not answering right now", as opposed to a bug or a
// refusal: a request that timed out (TIMEOUT, JetStream 408), no JetStream responder yet (503, the
// window while a restarted server loads its store), and a connection that is gone or going. The
// nats codes are only trusted on a NatsError, so a TopologyError that happens to reuse a word is
// never mistaken for an outage.
const NATS_OUTAGE_CODES = new Set([
  'TIMEOUT', '408', '503', 'CONNECTION_CLOSED', 'CONNECTION_DRAINING', 'CONNECTION_REFUSED',
  'CONNECTION_TIMEOUT', 'DISCONNECT',
]);
export function isTransportFailure(error) {
  if (error?.code === 'TOPOLOGY_NATS_UNAVAILABLE' || error?.code === 'TOPOLOGY_NATS_PORT_CONFLICT') return true;
  return error?.name === 'NatsError' && NATS_OUTAGE_CODES.has(error.code);
}

/** Drop every cached connection without draining it (a drain waits on a server that is not there),
 * so the next resolveTransport dials again — and re-resolves the local server's port — instead of
 * reusing a connection stuck reconnecting to a server that moved. */
export async function discardLiveTransports() {
  const open = [...liveTransports.values()];
  liveTransports.clear();
  await Promise.all(open.map((transport) => transport.close({ force: true }).catch(() => {})));
}

/** One helper for every long-running loop: true when the error was a NATS outage and the cached
 * connections were discarded, so the caller records it and retries on its next tick; false for
 * anything else, which the caller must keep treating as the failure it was.
 * ponytail: discards every cached connection, not just the failing one; a process holds one. */
export async function absorbTransportFailure(error) {
  if (!isTransportFailure(error)) return false;
  await discardLiveTransports();
  return true;
}

export async function selectLiveTransport(options = {}) {
  return resolveTransport(options);
}

export const JS_DOMAIN_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

/**
 * TM-279. The JetStream domain this node's js context addresses: `AO_NATS_JS_DOMAIN`, else
 * `nats.domain` in the ao user config, else none. A leaf node whose own server runs JetStream names
 * the hub's domain here so the shared buckets (ORCH_PERSONAS above all) resolve on the hub; a leaf
 * without its own JetStream, and a single server, need none.
 */
export async function jetStreamDomain(env = process.env, home = homedir()) {
  let domain = env.AO_NATS_JS_DOMAIN;
  if (!domain) {
    const { globalConfigPath } = await import('./config.mjs');
    domain = (await readJson(globalConfigPath(home, env)).catch(() => null))?.nats?.domain;
  }
  if (domain === undefined || domain === null || domain === '') return null;
  if (typeof domain !== 'string' || !JS_DOMAIN_PATTERN.test(domain)) {
    fail('TOPOLOGY_NATS_DOMAIN', `JetStream domain ${JSON.stringify(domain)} is invalid: use 1-64 letters, digits, hyphen or underscore (AO_NATS_JS_DOMAIN or nats.domain).`);
  }
  return domain;
}

const MAX_PENDING = 10_000;

function pruneAcked(queue) {
  const pending = queue.filter((entry) => !entry.acked);
  queue.length = 0;
  queue.push(...pending);
  return queue;
}

export function createFileTransport() {
  const mail = new Map();
  const seen = new Map();
  const claims = new Map();
  const presence = new Map();
  const agents = new Map();
  const reviews = new Map();
  const tasks = new Map();
  const probes = new Map();
  const verdictWaiters = new Map();
  const timers = new Set();
  const takeQueue = (map, subject) => {
    const queue = map.get(subject) ?? [];
    if (queue.length > MAX_PENDING) fail('TOPOLOGY_TRANSPORT_BOUND', `Pending queue for ${subject} exceeded ${MAX_PENDING}. Ack delivered messages.`);
    map.set(subject, queue);
    return queue;
  };
  const api = {
    kind: 'file',
    selection: { kind: 'file', source: 'AO_TRANSPORT', url: null, fallback: null },
    stats() {
      let pendingMail = 0;
      let retainedAcked = 0;
      for (const queue of mail.values()) {
        for (const entry of queue) {
          if (entry.acked) retainedAcked += 1;
          else pendingMail += 1;
        }
      }
      let verdictWaitersOpen = 0;
      for (const list of verdictWaiters.values()) verdictWaitersOpen += list.length;
      return { kind: 'file', pendingMail, retainedAcked, claims: claims.size, probes: probes.size, verdictWaiters: verdictWaitersOpen, timers: timers.size };
    },
    async publishMail({ repo, agent, messageId, body, inboxPath }) {
      const subject = ORCH_LAYOUT.mailSubject(orchName(repo), orchName(agent));
      const now = Date.now();
      const dedupeKey = messageId ? `${subject}:${messageId}` : '';
      for (const [id, expiry] of seen) if (expiry <= now) seen.delete(id);
      if (dedupeKey && (seen.get(dedupeKey) ?? 0) > now) {
        return { via: 'file', subject, duplicate: true, inboxPath: inboxPath ?? null };
      }
      if (dedupeKey) seen.set(dedupeKey, now + ORCH_LAYOUT.duplicateWindowMs);
      const queue = pruneAcked(takeQueue(mail, subject));
      queue.push({ messageId: messageId ?? null, body, acked: false });
      if (inboxPath) await writeText(inboxPath, body);
      return { via: 'file', subject, duplicate: false, inboxPath: inboxPath ?? null };
    },
    async pullMail({ repo, agent, timeoutMs = 1000 }) {
      const subject = ORCH_LAYOUT.mailSubject(orchName(repo), orchName(agent));
      const deadline = Date.now() + timeoutMs;
      for (;;) {
        const queue = mail.get(subject) ?? [];
        const item = queue.find((entry) => !entry.acked);
        if (item) {
          return {
            via: 'file',
            subject,
            messageId: item.messageId,
            body: item.body,
            ack: async () => { item.acked = true; pruneAcked(queue); },
          };
        }
        if (Date.now() >= deadline) return null;
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
    },
    async compareAndSetClaim({ repo, task, body, expectedRevision = 0 }) {
      const key = ORCH_LAYOUT.claimKey(orchName(repo), orchName(task));
      const current = claims.get(key);
      const revision = current?.revision ?? 0;
      if (revision !== expectedRevision) {
        fail('TOPOLOGY_CLAIM_CONFLICT', `Stale claim revision ${expectedRevision}; current is ${revision}.`);
      }
      const next = revision + 1;
      claims.set(key, { body, revision: next });
      return { via: 'file', bucket: ORCH_LAYOUT.claimsBucket, key, revision: next };
    },
    async getClaim({ repo, task, storeDir }) {
      const key = ORCH_LAYOUT.claimKey(orchName(repo), orchName(task));
      if (claims.has(key)) return claims.get(key).body;
      if (!storeDir) return null;
      const state = await readJson(join(storeDir, 'state.json')).catch(() => null);
      return state?.claims?.[String(task)] ?? null;
    },
    async putPresence({ repo, body, persist, ttlMs = ORCH_LAYOUT.presenceTtlMs }) {
      const key = orchName(repo);
      const encoded = typeof body === 'string' ? body : JSON.stringify(body);
      presence.set(key, { body: encoded, expires: Date.now() + ttlMs });
      if (persist) await persist();
      return { via: 'file', bucket: ORCH_LAYOUT.presenceBucket, key };
    },
    async getPresence({ repo }) {
      const key = orchName(repo);
      const entry = presence.get(key);
      if (!entry || entry.expires <= Date.now()) return null;
      return { via: 'file', bucket: ORCH_LAYOUT.presenceBucket, key, body: entry.body };
    },
    async putAgent({ repo, agent, body }) {
      const key = ORCH_LAYOUT.agentKey(orchName(repo), orchName(agent));
      agents.set(key, typeof body === 'string' ? body : JSON.stringify(body));
      return { via: 'file', bucket: ORCH_LAYOUT.agentsBucket, key };
    },
    async getAgent({ repo, agent }) {
      const key = ORCH_LAYOUT.agentKey(orchName(repo), orchName(agent));
      const body = agents.get(key);
      return body === undefined ? null : { via: 'file', bucket: ORCH_LAYOUT.agentsBucket, key, body };
    },
    async putReview({ bytes }) {
      const data = typeof bytes === 'string' ? Buffer.from(bytes) : Buffer.from(bytes);
      const name = createHash('sha256').update(data).digest('hex');
      reviews.set(name, data);
      return { via: 'file', bucket: ORCH_LAYOUT.reviewsBucket, name };
    },
    async getReview({ name }) {
      const data = reviews.get(name);
      return data ? { via: 'file', bucket: ORCH_LAYOUT.reviewsBucket, name, bytes: data } : null;
    },
    async publishReady({ repo, messageId, body }) {
      const subject = ORCH_LAYOUT.tasksSubject(orchName(repo));
      const queue = pruneAcked(takeQueue(tasks, subject));
      queue.push({ messageId: messageId ?? null, body, acked: false });
      return { via: 'file', subject };
    },
    async pullReady({ repo, timeoutMs = 200 }) {
      const subject = ORCH_LAYOUT.tasksSubject(orchName(repo));
      const queue = tasks.get(subject) ?? [];
      const item = queue.find((entry) => !entry.acked);
      if (!item) return null;
      return {
        via: 'file',
        subject,
        body: item.body,
        ack: async () => { item.acked = true; pruneAcked(queue); },
      };
    },
    async serveProbe({ repo, agent, handler }) {
      const subject = ORCH_LAYOUT.probeSubject(orchName(repo), orchName(agent));
      probes.set(subject, handler);
      return { via: 'file', subject, stop: () => probes.delete(subject) };
    },
    async requestProbe({ repo, agent, body, timeoutMs = 2000 }) {
      const subject = ORCH_LAYOUT.probeSubject(orchName(repo), orchName(agent));
      const handler = probes.get(subject);
      if (!handler) fail('TOPOLOGY_PROBE_TIMEOUT', `No probe responder on ${subject}.`);
      const reply = await handler(body);
      return { via: 'file', subject, body: reply };
    },
    beginVerdictWait({ repo, nonce, timeoutMs = 2000 }) {
      return beginFileVerdict(
        ORCH_LAYOUT.verdictSubject(orchName(repo), orchName(nonce)),
        timeoutMs,
        verdictWaiters,
        timers,
      );
    },
    async publishVerdict({ repo, nonce, body }) {
      const subject = ORCH_LAYOUT.verdictSubject(orchName(repo), orchName(nonce));
      const waiters = verdictWaiters.get(subject) ?? [];
      verdictWaiters.delete(subject);
      for (const deliver of waiters) deliver(body);
      return { via: 'file', subject };
    },
    async saveProbe({ filePath, body }) {
      await writeJson(filePath, body);
      return { via: 'file', filePath };
    },
    async close() {
      for (const timer of timers) clearTimeout(timer);
      timers.clear();
      verdictWaiters.clear();
      probes.clear();
      mail.clear();
      tasks.clear();
      seen.clear();
    },
  };
  return api;
}

function beginFileVerdict(subject, timeoutMs, verdictWaiters, timers) {
  let deliver;
  const received = new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      timers.delete(timer);
      const list = verdictWaiters.get(subject) ?? [];
      verdictWaiters.set(subject, list.filter((item) => item !== deliver));
      if ((verdictWaiters.get(subject) ?? []).length === 0) verdictWaiters.delete(subject);
      const error = new Error(`No verdict on ${subject}`);
      error.code = 'TOPOLOGY_VERDICT_TIMEOUT';
      reject(error);
    }, timeoutMs);
    timers.add(timer);
    deliver = (body) => {
      clearTimeout(timer);
      timers.delete(timer);
      resolve({ via: 'file', subject, body });
    };
  });
  const list = verdictWaiters.get(subject) ?? [];
  list.push(deliver);
  verdictWaiters.set(subject, list);
  return { via: 'file', subject, received };
}

async function bridgeUnixSocket(socketPath) {
  const server = net.createServer((client) => {
    const upstream = net.createConnection(socketPath);
    const closeBoth = () => { client.destroy(); upstream.destroy(); };
    client.on('error', closeBoth);
    upstream.on('error', closeBoth);
    upstream.on('close', () => client.destroy());
    client.on('close', () => upstream.destroy());
    client.pipe(upstream);
    upstream.pipe(client);
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const { port } = server.address();
  return { server, servers: `nats://127.0.0.1:${port}` };
}

/**
 * Drops user:password from a URL, or each URL of a comma-separated server list, before it is
 * logged, stored or mailed. TM-309: fails closed — a part that does not parse loses everything up
 * to its last '@' by regex, and never comes back raw.
 */
export function redactUrl(url) {
  if (!url) return null;
  const strip = (text) => text.replace(/^([a-z][a-z0-9+.-]*:\/\/)?.*@/i, (_, scheme = '') => `${scheme}[redacted]@`);
  return String(url).split(',').map((part) => part.trim()).filter(Boolean).map((part) => {
    let out;
    try { const parsed = new URL(part); parsed.username = ''; parsed.password = ''; out = parsed.toString().replace(/\/$/, ''); }
    catch { out = part; }
    // A form URL parses without a host ('u:secret@host' is scheme 'u:') keeps its '@'; strip it too.
    return out.includes('@') ? strip(out) : out;
  }).join(',') || null;
}

export const transportStatePath = (env = process.env, home = homedir()) => join(stateRoot(env, home), 'transport.json');

// TM-276: an outage nobody has fallen back from for this long is retired, not recovered: the operator
// removed the dead URL (the fix doctor names), so nothing on this host is configured to use it any more.
export const OUTAGE_RETIRE_MS = 60 * 60_000;

/** An open outage whose last fallback is older than the bound, closed with `retired: true`. Pure. */
export function retireStaleOutage(state, { now = Date.now(), retireAfterMs = OUTAGE_RETIRE_MS } = {}) {
  const outage = state?.outage;
  if (!outage || outage.recovered_at) return state;
  const last = outage.last_fallback_at ?? outage.since;
  if (now - Date.parse(last) < retireAfterMs) return state;
  return { ...state, outage: { ...outage, recovered_at: new Date(now).toISOString(), retired: true,
    note: `retired: no open has fallen back from ${outage.url} (${outage.source}) since ${last}; it was not proven reachable` } };
}

/** TM-276: the last selection on this host, plus the configured NATS outage it fell back from, if any. */
// ADR-0032: the sources this ao writes. transport.json is a host-wide last-writer file, so an older
// ao still running (a long-lived MCP server with NATS_URL in its env) can write a NATS_URL selection,
// fallback or outage after an upgrade. Every reader drops those, and the next open rewrites the file.
const AO_SOURCES = new Set(['AO_NATS_URL', 'orch.sock', 'managed-local']);
const foreign = (entry) => Boolean(entry?.source) && !AO_SOURCES.has(entry.source);

/** The state with every selection, fallback and outage from a source ao no longer reads removed. Pure. */
export function withoutForeignSources(state) {
  if (!state || !(foreign(state) || foreign(state.fallback) || foreign(state.outage))) return state;
  return { ...state, ...(foreign(state) ? { source: null, url: null } : {}), fallback: foreign(state.fallback) ? null : state.fallback ?? null,
    outage: foreign(state.outage) ? null : state.outage ?? null, foreign_dropped: true };
}

export async function readTransportState(env = process.env, home = homedir(), { now = Date.now(), retireAfterMs = Number(env.AO_NATS_OUTAGE_RETIRE_MS) || OUTAGE_RETIRE_MS } = {}) {
  return retireStaleOutage(withoutForeignSources(await readJson(transportStatePath(env, home)).catch(() => null)), { now, retireAfterMs });
}

/** Writes a state as-is. Read-modify-write callers go through updateTransportState. */
export async function writeTransportState(env, home, state) {
  const { foreign_dropped: _dropped, ...clean } = state ?? {};
  await writeJson(transportStatePath(env, home), clean);
}

/**
 * TM-309 B2: every read-modify-write of transport.json runs under one lock, so two racing opens can
 * no longer mint two `since`s or drop each other's holder. `change` gets the current state and
 * returns the next one; returning the same object writes nothing. A failed write throws.
 */
export async function updateTransportState(env, home, change, { read = {} } = {}) {
  return withLock(`${transportStatePath(env, home)}.lock`, async () => {
    const previous = await readTransportState(env, home, read);
    const next = await change(previous);
    if (next && next !== previous) await writeTransportState(env, home, next);
    return next ?? previous;
  }, { timeoutMs: 10_000 });
}

// TM-309 C2: an outage is held per pid. Every process that fell back is a holder until it closes,
// dies, or reopens on the configured server, and recovery waits for the last one.
// ponytail: liveness is kill(pid, 0); a reused pid keeps an outage open until that process exits too.
const alive = (pid) => { try { process.kill(Number(pid), 0); return true; } catch (error) { return error.code === 'EPERM'; } };
const liveHolders = (holders, drop) => Object.fromEntries(Object.entries(holders ?? {}).filter(([pid]) => Number(pid) !== drop && alive(pid)));

/** Drops dead holders (and `drop`), and closes an outage whose configured server an open already
 * proved (`reachable_at`) once no holder remains. An outage written before TM-309 has no holders and is left alone. */
export function settleOutage(state, { now = Date.now(), drop } = {}) {
  const outage = state?.outage;
  if (!outage || outage.recovered_at || !outage.holders) return state;
  const holders = liveHolders(outage.holders, drop);
  const recovered = Boolean(outage.reachable_at) && Object.keys(holders).length === 0;
  if (!recovered && Object.keys(holders).length === Object.keys(outage.holders).length) return state;
  return { ...state, outage: { ...outage, holders, ...(recovered ? { recovered_at: new Date(now).toISOString() } : {}) } };
}

/**
 * TM-295: keeps an open outage live for a holder of its fallback, so a long-lived process that is not
 * a supervisor (an MCP server with a dead AO_NATS_URL) does not see its outage retired and then mint a
 * second one on reconnect. Writes when last_fallback_at is over a quarter bound old, or when this pid
 * is not yet a holder. Returns whether it wrote.
 */
export async function touchFallback(env, home, { source, url }, { now = Date.now(), retireAfterMs = Number(env.AO_NATS_OUTAGE_RETIRE_MS) || OUTAGE_RETIRE_MS } = {}) {
  let wrote = false;
  await updateTransportState(env, home, (state) => {
    const outage = state?.outage;
    if (!outage || outage.recovered_at || outage.source !== source || outage.url !== url) return state;
    const stale = now - Date.parse(outage.last_fallback_at ?? outage.since) > retireAfterMs / 4;
    if (!stale && outage.holders?.[process.pid]) return state;
    wrote = true;
    const at = new Date(now).toISOString();
    return { ...state, outage: { ...outage, last_fallback_at: stale ? at : outage.last_fallback_at, holders: { ...outage.holders, [process.pid]: at } } };
  }, { read: { retireAfterMs: Infinity } });
  return wrote;
}

/** True when a connection this process holds fell back from `source`+`url`: the outage is still in use here. */
export function holdsFallbackFrom({ source, url }) {
  return [...liveTransports.values()].some((t) => t.selection?.fallback?.source === source && t.selection.fallback.url === url
    && t.stats?.().closed === false);
}

/** What status, doctor and the supervisor log report: the file double, or the last NATS selection. */
export async function describeTransport(env = process.env, home = homedir()) {
  if (transportMode(env) === 'file') return { kind: 'file', source: 'AO_TRANSPORT', url: null, fallback: null, outage: null };
  const state = await readTransportState(env, home);
  return state ? { kind: state.kind, source: state.source, url: state.url, fallback: state.fallback ?? null, outage: state.outage ?? null, at: state.at,
    ...(state.foreign_dropped ? { note: 'ignored a NATS_URL entry written by an older ao; NATS_URL is not an ao source (ADR-0032)' } : {}) }
    : { kind: 'nats', source: null, url: null, fallback: null, outage: null, note: 'no NATS connection recorded on this host yet' };
}

/** TM-309 C5: what THIS connection selected, in describeTransport's shape, for a log line that must
 * not read the host-wide file another process may have just rewritten. */
export function selectionView(transport) {
  const s = transport?.selection;
  if (!s) return null;
  return { kind: s.kind, source: s.source, url: s.url, fallback: s.fallback ?? null,
    outage: s.fallback ? { ...s.fallback, recovered_at: null } : null, ...(s.state_write_error ? { state_write_error: s.state_write_error } : {}) };
}

const describeError = (error) => `${error?.code ?? 'ERROR'}: ${String(error?.message ?? error).slice(0, 300)}`;

/**
 * Writes transport.json only when the answer changed. A fallback opens an outage (its `since` is
 * the outage identity the lead is told about, kept across reopens) and makes this pid a holder. An
 * open that needs no fallback AND dialled that outage's own source and url proves the server back
 * (`reachable_at`) and stops this pid holding it; the outage closes with `recovered_at` only once no
 * live holder remains (TM-309 C2). The file is host-wide and processes differ in env, so an open
 * that never tried the configured server proves nothing about it and leaves the outage open. Every
 * fallback, and every holder's heartbeat (touchFallback), refreshes `last_fallback_at`;
 * readTransportState retires an outage once that is older than OUTAGE_RETIRE_MS.
 */
async function recordTransportSelection(env, selection, home = homedir()) {
  await updateTransportState(env, home, (raw) => {
    const previous = settleOutage(raw);
    const at = new Date().toISOString();
    let outage = previous?.outage ?? null;
    const open = outage && !outage.recovered_at ? outage : null;
    if (selection.fallback) {
      const same = open && open.url === selection.fallback.url;
      outage = { source: selection.fallback.source, url: selection.fallback.url, error: selection.fallback.error,
        since: same ? open.since : at, last_fallback_at: at, recovered_at: null, holders: { ...(same ? liveHolders(open.holders) : {}), [process.pid]: at } };
    } else if (open && open.source === selection.source && open.url === selection.url) {
      const holders = liveHolders(open.holders, process.pid);
      outage = Object.keys(holders).length ? { ...open, holders, reachable_at: at } : { ...open, holders, recovered_at: at };
    }
    // A record that held a foreign source is always rewritten, so the stale entry leaves the file.
    const same = previous && !previous.foreign_dropped && previous.source === selection.source && previous.url === selection.url
      && JSON.stringify(previous.outage ?? null) === JSON.stringify(outage);
    if (same) return previous;
    return { kind: selection.kind, source: selection.source, url: selection.url, fallback: selection.fallback, at, pid: process.pid, outage };
  });
}

/**
 * TM-308 / ADR-0032: a managed NATS port held by another process is an outage of its own. It is
 * recorded where ADR-0031 outages live, so doctor, `services status` and the lead's mail all see
 * it, and the next managed open that succeeds on that port closes it.
 */
async function recordPortConflict(env, home, error) {
  const url = `nats://127.0.0.1:${error.details?.port}`;
  await updateTransportState(env, home, (previous) => {
    const at = new Date().toISOString();
    const open = previous?.outage && !previous.outage.recovered_at && previous.outage.url === url ? previous.outage : null;
    return { kind: 'nats', source: previous?.source ?? null, url: previous?.url ?? null,
      fallback: null, at, pid: process.pid, outage: { source: 'managed-local', url, error: String(error.message).slice(0, 500),
        conflict: { port: error.details?.port ?? null, holder: error.details?.holder ?? null }, since: open?.since ?? at, last_fallback_at: at, recovered_at: null } };
  });
}

/** ADR-0032: the generic NATS variables are not ao sources. One line for a supervisor to log at start, or null. */
export function ignoredNatsEnv(env = process.env) {
  const names = ['NATS_URL', 'NATS_USER', 'NATS_PASSWORD'].filter((name) => env[name]);
  return names.length ? { event: 'nats-env-ignored', variables: names,
    message: `${names.join(', ')} ${names.length > 1 ? 'are' : 'is'} set but ignored: ao uses AO_NATS_URL, the gateway orch.sock, or its managed NATS on nats.port (ADR-0032).` } : null;
}

const loadNats = () => import('nats').catch(async (error) => {
  // Installed topology remains ESM and has no node_modules. Ship the same
  // pinned client as a standalone bundle instead of requiring an install step.
  if (error?.code !== 'ERR_MODULE_NOT_FOUND') throw error;
  try {
    const client = await import(new URL('../../dist/nats-client.cjs', import.meta.url).href);
    return client.default || client;
  } catch {
    return fail('TOPOLOGY_NATS_UNAVAILABLE', 'The installed NATS client bundle is missing or invalid. Refresh the agent-orchestration plugin installation.');
  }
});

/**
 * TM-309 C6: true only when an outage's configured server accepts a NATS connection AND answers
 * JetStream, on a short-lived connection of its own. A TCP accept (auth refused, TLS, not NATS) is
 * not enough, so the supervisor no longer force-closes its live connections for a server that would
 * refuse the re-dial. False when this process cannot address it (another env's AO_NATS_URL).
 */
export async function probeConfiguredNats(outage, env = process.env, home = homedir(), { timeoutMs = 2000 } = {}) {
  let servers = null, bridge = null, nc = null;
  if (outage?.source === 'AO_NATS_URL' && env.AO_NATS_URL && redactUrl(env.AO_NATS_URL) === outage.url) servers = env.AO_NATS_URL;
  else if (outage?.source === 'orch.sock' && outage.url && existsSync(outage.url)) { bridge = await bridgeUnixSocket(outage.url).catch(() => null); servers = bridge?.servers; }
  if (!servers) return false;
  try {
    const { connect, credsAuthenticator } = await loadNats();
    const options = { servers, name: 'ao-outage-probe', timeout: timeoutMs, maxReconnectAttempts: 0, reconnect: false };
    if (env.AO_ORCH_CREDS) options.authenticator = credsAuthenticator(readFileSync(env.AO_ORCH_CREDS));
    nc = await connect(options);
    const domain = await jetStreamDomain(env, home);
    await nc.jetstreamManager(domain ? { domain } : {});
    return true;
  } catch { return false; }
  finally { await nc?.close().catch(() => {}); bridge?.server.close(); }
}

export async function openNatsTransport({ env = process.env, home = homedir(), servers, credsFile, name = 'ao-orch' } = {}) {
  const {
    AckPolicy,
    DeliverPolicy,
    RetentionPolicy,
    StorageType,
    StringCodec,
    connect,
    credsAuthenticator,
    headers,
    nanos,
  } = await loadNats();
  const sc = StringCodec();
  const publishOptions = (msgID, slug) => {
    if (!msgID && !slug) return undefined;
    const options = msgID ? { msgID } : {};
    if (slug) { options.headers = headers(); options.headers.set(ORCH_LAYOUT.repoSlugHeader, String(slug)); }
    return options;
  };
  // ADR-0032: AO_NATS_URL, then the gateway orch.sock, then managed local NATS on nats.port. The
  // generic NATS_URL belongs to other tools and is never read here.
  const url = servers || env.AO_NATS_URL || '';
  // TM-276 / ADR-0031: which NATS this is and why, so supervisor start, status and doctor can say.
  const configuredSource = servers ? 'servers' : env.AO_NATS_URL ? 'AO_NATS_URL' : null;
  let selection = { kind: 'nats', source: configuredSource, url: redactUrl(url), fallback: null };
  let bridge = null;
  let target = url;
  // An explicit `servers` argument (a test reader, a probe) is never replaced. AO_NATS_URL and the
  // gateway socket fall back to the managed local server and report the outage (ADR-0031).
  const autostart = !servers && env.AO_NATS_AUTOSTART !== '0';
  let local = null;
  const useLocal = async () => {
    try { local = await ensureLocalNats({ env }); }
    catch (error) {
      // TM-309 C4: the conflict is still what is thrown, but a record that did not land says so.
      if (error?.code === 'TOPOLOGY_NATS_PORT_CONFLICT' && !servers) await recordPortConflict(env, home, error).catch((e) => { error.state_write_error = describeError(e); });
      throw error;
    }
    target = local.servers;
    selection = { ...selection, source: 'managed-local', url: local.servers };
  };
  if (!target) {
    const socketPath = orchSocketPath(env);
    if (existsSync(socketPath)) {
      bridge = await bridgeUnixSocket(socketPath);
      target = bridge.servers;
      selection = { ...selection, source: 'orch.sock', url: socketPath };
    } else if (autostart) {
      await useLocal();
    } else {
      fail('TOPOLOGY_NATS_UNAVAILABLE', `NATS is the default transport and neither AO_NATS_URL nor ${socketPath} is available. Set AO_NATS_URL, start the gateway orch listener, or set AO_TRANSPORT=file for the file double.`);
    }
  }
  const creds = credsFile || env.AO_ORCH_CREDS;
  const domain = await jetStreamDomain(env).catch((error) => { bridge?.server.close(); throw error; });
  const dial = () => {
    const options = { servers: target, name, timeout: 4000, maxReconnectAttempts: -1, reconnectTimeWait: 200 };
    if (local) Object.assign(options, { user: local.user, pass: local.pass });
    else if (creds) options.authenticator = credsAuthenticator(readFileSync(creds));
    return connect(options);
  };
  let nc;
  try {
    nc = await dial();
  } catch (error) {
    bridge?.server.close();
    bridge = null;
    if (!autostart || local) fail('TOPOLOGY_NATS_UNAVAILABLE', `NATS connect failed: ${error.message}`);
    // The configured target (AO_NATS_URL or a stale gateway socket) is down: start the local one.
    const unreachable = { source: selection.source, url: selection.url, error: String(error.message).slice(0, 500) };
    try {
      await useLocal();
      selection = { ...selection, fallback: unreachable };
      nc = await dial();
    } catch (second) {
      if (second?.code === 'TOPOLOGY_NATS_PORT_CONFLICT') throw second;
      fail('TOPOLOGY_NATS_UNAVAILABLE', `NATS connect failed: ${error.message}; local fallback failed: ${second.message}`);
    }
  }
  const jsOptions = domain ? { domain } : {};
  const js = nc.jetstream(jsOptions);
  let jsm;
  try { jsm = await nc.jetstreamManager(jsOptions); }
  catch (error) {
    await nc.close().catch(() => {});
    if (bridge) bridge.server.close();
    throw error;
  }
  // TM-309 C3: recorded only once JetStream answers, so a server that takes the connection but not
  // JetStream never closes an outage. An explicit `servers` caller (a test reader, a probe) is not
  // this host's selection; record only the rest. C4: a write that fails is carried on the selection,
  // where the supervisor start log and the tick report it, never swallowed.
  const surface = (error) => { selection.state_write_error = describeError(error); };
  if (!servers) await recordTransportSelection(env, selection, home).catch(surface);
  // TM-295: every process holding a fallback refreshes its outage, not only a repository supervisor.
  let heartbeat = null;
  if (!servers && selection.fallback) {
    const retireAfterMs = Number(env.AO_NATS_OUTAGE_RETIRE_MS) || OUTAGE_RETIRE_MS;
    heartbeat = setInterval(async () => {
      if (nc.isClosed()) return;
      try {
        await touchFallback(env, home, selection.fallback, { retireAfterMs });
        // TM-309 C2: another process proved the configured server back and is waiting on the last
        // holder. Re-dial so this one moves too (or falls back again, which reopens the outage).
        const outage = (await readTransportState(env, home, { retireAfterMs: Infinity }))?.outage;
        if (outage?.reachable_at && !outage.recovered_at && outage.url === selection.fallback.url) await transport.close({ force: true });
      } catch (error) { surface(error); }
    }, retireAfterMs / 4);
    heartbeat.unref();
  }
  const ensured = new Set();
  const subscriptions = new Set();
  const timers = new Set();
  const transport = {
    kind: 'nats',
    nc,
    domain,
    selection,
    stats() {
      return { kind: 'nats', closed: nc.isClosed(), subscriptions: subscriptions.size, ensured: ensured.size, timers: timers.size };
    },
    async ensure({ repo, agents = [], replies = [] }) {
      const nameRepo = orchName(repo);
      if (!ensured.has('layout')) {
      await ensureStream(jsm, {
        name: ORCH_LAYOUT.mailStream,
        subjects: ['orch.*.mail.>'],
        retention: RetentionPolicy.Workqueue,
        storage: StorageType.File,
        max_age: nanos(7 * 24 * 60 * 60 * 1000),
        max_bytes: 256 * 1024 * 1024,
        duplicate_window: nanos(ORCH_LAYOUT.duplicateWindowMs),
      });
      await ensureStream(jsm, {
        name: ORCH_LAYOUT.tasksStream,
        subjects: ['orch.*.tasks.ready'],
        retention: RetentionPolicy.Workqueue,
        storage: StorageType.File,
        max_age: nanos(24 * 60 * 60 * 1000),
        max_bytes: 64 * 1024 * 1024,
        duplicate_window: nanos(ORCH_LAYOUT.duplicateWindowMs),
      });
      await js.views.kv(ORCH_LAYOUT.agentsBucket, { storage: StorageType.File });
      await js.views.kv(ORCH_LAYOUT.claimsBucket, { storage: StorageType.File, history: 16 });
      await js.views.kv(ORCH_LAYOUT.presenceBucket, { storage: StorageType.File, ttl: ORCH_LAYOUT.presenceTtlMs });
      await js.views.os(ORCH_LAYOUT.reviewsBucket, { storage: StorageType.File });
      ensured.add('layout');
      }
      const tasksKey = `tasks:${nameRepo}`;
      if (!ensured.has(tasksKey)) {
      await ensureConsumer(jsm, ORCH_LAYOUT.tasksStream, {
        durable_name: ORCH_LAYOUT.tasksDurable(nameRepo),
        filter_subject: ORCH_LAYOUT.tasksSubject(nameRepo),
        ack_policy: AckPolicy.Explicit,
        deliver_policy: DeliverPolicy.All,
      });
      ensured.add(tasksKey);
      }
      for (const agent of agents) {
        const nameAgent = orchName(agent);
        const mailKey = `mail:${nameRepo}:${nameAgent}`;
        if (ensured.has(mailKey)) continue;
        await ensureConsumer(jsm, ORCH_LAYOUT.mailStream, {
          durable_name: ORCH_LAYOUT.mailDurable(nameRepo, nameAgent),
          filter_subject: ORCH_LAYOUT.mailSubject(nameRepo, nameAgent),
          ack_policy: AckPolicy.Explicit,
          deliver_policy: DeliverPolicy.All,
        });
        ensured.add(mailKey);
      }
      for (const agent of replies) {
        const nameAgent = orchName(agent);
        const replyKey = `reply:${nameRepo}:${nameAgent}`;
        if (ensured.has(replyKey)) continue;
        await ensureConsumer(jsm, ORCH_LAYOUT.mailStream, {
          durable_name: ORCH_LAYOUT.replyDurable(nameRepo, nameAgent),
          filter_subject: ORCH_LAYOUT.replySubject(nameRepo, nameAgent),
          ack_policy: AckPolicy.Explicit,
          deliver_policy: DeliverPolicy.All,
        });
        ensured.add(replyKey);
      }
    },
    async publishMail({ repo, agent, messageId, body, slug = null }) {
      const nameRepo = orchName(repo);
      const nameAgent = orchName(agent);
      await transport.ensure({ repo: nameRepo, agents: [nameAgent] });
      const subject = ORCH_LAYOUT.mailSubject(nameRepo, nameAgent);
      const ack = await js.publish(subject, sc.encode(body), publishOptions(messageId && `${nameRepo}.${nameAgent}.${messageId}`, slug));
      return { via: 'nats', subject, duplicate: ack.duplicate === true, inboxPath: null, seq: ack.seq };
    },
    async pullMail({ repo, agent, timeoutMs = 1000 }) {
      const nameRepo = orchName(repo);
      const nameAgent = orchName(agent);
      await transport.ensure({ repo: nameRepo, agents: [nameAgent] });
      const subject = ORCH_LAYOUT.mailSubject(nameRepo, nameAgent);
      const consumer = await js.consumers.get(ORCH_LAYOUT.mailStream, ORCH_LAYOUT.mailDurable(nameRepo, nameAgent));
      const msg = await consumer.next({ expires: Math.max(1000, timeoutMs) }).catch(() => null);
      if (!msg) return null;
      return {
        via: 'nats',
        subject: msg.subject || subject,
        messageId: msg.headers?.get?.('Nats-Msg-Id') ?? null,
        repoSlug: msg.headers?.get?.(ORCH_LAYOUT.repoSlugHeader) || null,
        body: sc.decode(msg.data),
        ack: async () => { msg.ack(); await nc.flush(); },
        nak: async () => { msg.nak(); },
        // TM-482: a message that can never be accepted is termed, so it is not redelivered.
        term: async () => { msg.term(); await nc.flush(); },
      };
    },
    async publishReply({ repo, agent, messageId, body, slug = null }) {
      const nameRepo = orchName(repo);
      const nameAgent = orchName(agent);
      await transport.ensure({ repo: nameRepo, replies: [nameAgent] });
      const subject = ORCH_LAYOUT.replySubject(nameRepo, nameAgent);
      const ack = await js.publish(subject, sc.encode(body), publishOptions(messageId && `${nameRepo}.${nameAgent}.reply.${messageId}`, slug));
      return { via: 'nats', subject, duplicate: ack.duplicate === true, inboxPath: null, seq: ack.seq };
    },
    async pullReply({ repo, agent, replyTo, from, timeoutMs = 1000 }) {
      const nameRepo = orchName(repo);
      const nameAgent = orchName(agent);
      await transport.ensure({ repo: nameRepo, replies: [nameAgent] });
      const subject = ORCH_LAYOUT.replySubject(nameRepo, nameAgent);
      const consumer = await js.consumers.get(ORCH_LAYOUT.mailStream, ORCH_LAYOUT.replyDurable(nameRepo, nameAgent));
      const iter = await consumer.fetch({ max_messages: 32, expires: Math.max(1000, timeoutMs) });
      const batch = [];
      for await (const msg of iter) batch.push(msg);
      let found = null;
      for (const msg of batch) {
        let parsed = null;
        try { parsed = JSON.parse(sc.decode(msg.data)); } catch { parsed = null; }
        const correlation = parsed?.replyTo ?? parsed?.reply_to;
        if (!found && (!replyTo || correlation === replyTo) && (!from || parsed?.from === from)) {
          // The caller persists a receipt before invoking ACK. Returning bytes
          // is not acceptance, including for a matched reply.
          found = { via: 'nats', subject: msg.subject || subject, body: String(parsed?.body ?? sc.decode(msg.data)),
            rawBody: sc.decode(msg.data), messageId: msg.headers?.get?.('Nats-Msg-Id') ?? null,
            replyTo: correlation ?? null, from: parsed?.from ?? null,
            ack: async () => { msg.ack(); await nc.flush(); }, nak: async () => { msg.nak(); },
            term: async () => { msg.term(); await nc.flush(); } };
        } else {
          msg.nak();
        }
      }
      return found;
    },
    async compareAndSetClaim({ repo, task, body, expectedRevision = 0 }) {
      const nameRepo = orchName(repo);
      await transport.ensure({ repo: nameRepo });
      const kv = await js.views.kv(ORCH_LAYOUT.claimsBucket);
      const key = ORCH_LAYOUT.claimKey(nameRepo, orchName(task));
      const payload = JSON.stringify(body);
      try {
        const revision = expectedRevision
          ? await kv.update(key, payload, expectedRevision)
          : await kv.create(key, payload);
        return { via: 'nats', bucket: ORCH_LAYOUT.claimsBucket, key, revision };
      } catch (error) {
        fail('TOPOLOGY_CLAIM_CONFLICT', `Claim compare-and-set failed for ${key}: ${error.message}`);
      }
    },
    async getClaim({ repo, task, storeDir }) {
      const nameRepo = orchName(repo);
      await transport.ensure({ repo: nameRepo });
      const kv = await js.views.kv(ORCH_LAYOUT.claimsBucket);
      const key = ORCH_LAYOUT.claimKey(nameRepo, orchName(String(task)));
      const entry = await kv.get(key).catch(() => null);
      if (!entry || entry.operation === 'DEL' || entry.operation === 'PURGE') {
        if (!storeDir) return null;
        const state = await readJson(join(storeDir, 'state.json')).catch(() => null);
        return state?.claims?.[String(task)] ?? null;
      }
      return entry.json();
    },
    async putPresence({ repo, body }) {
      const nameRepo = orchName(repo);
      await transport.ensure({ repo: nameRepo });
      const kv = await js.views.kv(ORCH_LAYOUT.presenceBucket, { ttl: ORCH_LAYOUT.presenceTtlMs });
      const payload = typeof body === 'string' ? body : JSON.stringify(body);
      await kv.put(nameRepo, payload);
      return { via: 'nats', bucket: ORCH_LAYOUT.presenceBucket, key: nameRepo };
    },
    async getPresence({ repo }) {
      const nameRepo = orchName(repo);
      await transport.ensure({ repo: nameRepo });
      const kv = await js.views.kv(ORCH_LAYOUT.presenceBucket);
      const entry = await kv.get(nameRepo).catch(() => null);
      if (!entry || entry.operation === 'DEL' || entry.operation === 'PURGE') return null;
      return { via: 'nats', bucket: ORCH_LAYOUT.presenceBucket, key: nameRepo, body: entry.string() };
    },
    async putAgent({ repo, agent, body }) {
      const nameRepo = orchName(repo);
      const key = ORCH_LAYOUT.agentKey(nameRepo, orchName(agent));
      await transport.ensure({ repo: nameRepo });
      const kv = await js.views.kv(ORCH_LAYOUT.agentsBucket);
      await kv.put(key, typeof body === 'string' ? body : JSON.stringify(body));
      return { via: 'nats', bucket: ORCH_LAYOUT.agentsBucket, key };
    },
    async getAgent({ repo, agent }) {
      const nameRepo = orchName(repo);
      const key = ORCH_LAYOUT.agentKey(nameRepo, orchName(agent));
      await transport.ensure({ repo: nameRepo });
      const kv = await js.views.kv(ORCH_LAYOUT.agentsBucket);
      const entry = await kv.get(key).catch(() => null);
      if (!entry || entry.operation === 'DEL') return null;
      return { via: 'nats', bucket: ORCH_LAYOUT.agentsBucket, key, body: entry.string() };
    },
    /** TM-279: the team persona bucket, on the same js context (and so the same domain) as the rest. */
    async personaKv() {
      return js.views.kv(ORCH_LAYOUT.personasBucket, { storage: StorageType.File, history: 1 });
    },
    async putReview({ bytes }) {
      const data = typeof bytes === 'string' ? Buffer.from(bytes) : Buffer.from(bytes);
      const name = createHash('sha256').update(data).digest('hex');
      const store = await js.views.os(ORCH_LAYOUT.reviewsBucket);
      await store.putBlob({ name }, data);
      return { via: 'nats', bucket: ORCH_LAYOUT.reviewsBucket, name };
    },
    async getReview({ name }) {
      const store = await js.views.os(ORCH_LAYOUT.reviewsBucket);
      const bytes = await store.getBlob(name).catch(() => null);
      return bytes ? { via: 'nats', bucket: ORCH_LAYOUT.reviewsBucket, name, bytes: Buffer.from(bytes) } : null;
    },
    async publishReady({ repo, messageId, body }) {
      const nameRepo = orchName(repo);
      await transport.ensure({ repo: nameRepo });
      const subject = ORCH_LAYOUT.tasksSubject(nameRepo);
      await js.publish(subject, sc.encode(body), messageId ? { msgID: messageId } : undefined);
      return { via: 'nats', subject };
    },
    async pullReady({ repo, timeoutMs = 1000 }) {
      const nameRepo = orchName(repo);
      await transport.ensure({ repo: nameRepo });
      const subject = ORCH_LAYOUT.tasksSubject(nameRepo);
      const consumer = await js.consumers.get(ORCH_LAYOUT.tasksStream, ORCH_LAYOUT.tasksDurable(nameRepo));
      const msg = await consumer.next({ expires: Math.max(1000, timeoutMs) }).catch(() => null);
      if (!msg) return null;
      return { via: 'nats', subject: msg.subject || subject, body: sc.decode(msg.data), ack: async () => { msg.ack(); } };
    },
    async serveProbe({ repo, agent, handler }) {
      const subject = ORCH_LAYOUT.probeSubject(orchName(repo), orchName(agent));
      const sub = nc.subscribe(subject);
      subscriptions.add(sub);
      await nc.flush();
      (async () => {
        for await (const msg of sub) {
          try {
            const reply = await handler(sc.decode(msg.data));
            if (msg.respond(sc.encode(String(reply)))) continue;
          } catch {
            msg.respond(sc.encode(''));
          }
        }
      })().catch(() => {});
      return { via: 'nats', subject, stop: () => { sub.unsubscribe(); subscriptions.delete(sub); } };
    },
    async requestProbe({ repo, agent, body, timeoutMs = 2000 }) {
      const subject = ORCH_LAYOUT.probeSubject(orchName(repo), orchName(agent));
      try {
        const msg = await nc.request(subject, sc.encode(body), { timeout: timeoutMs });
        return { via: 'nats', subject, body: sc.decode(msg.data) };
      } catch (error) {
        fail('TOPOLOGY_PROBE_TIMEOUT', `Probe ${subject} failed: ${error.message}`);
      }
    },
    async beginVerdictWait({ repo, nonce, timeoutMs = 2000 }) {
      const subject = ORCH_LAYOUT.verdictSubject(orchName(repo), orchName(nonce));
      const sub = nc.subscribe(subject, { max: 1 });
      subscriptions.add(sub);
      await nc.flush();
      const received = new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          timers.delete(timer);
          sub.unsubscribe();
          subscriptions.delete(sub);
          const error = new Error(`No verdict on ${subject}`);
          error.code = 'TOPOLOGY_VERDICT_TIMEOUT';
          reject(error);
        }, timeoutMs);
        timers.add(timer);
        (async () => {
          for await (const msg of sub) {
            clearTimeout(timer);
            timers.delete(timer);
            subscriptions.delete(sub);
            resolve({ via: 'nats', subject: msg.subject || subject, body: sc.decode(msg.data) });
            break;
          }
        })().catch((error) => {
          clearTimeout(timer);
          reject(error);
        });
      });
      return { via: 'nats', subject, received };
    },
    async publishVerdict({ repo, nonce, body }) {
      const subject = ORCH_LAYOUT.verdictSubject(orchName(repo), orchName(nonce));
      nc.publish(subject, sc.encode(body));
      await nc.flush();
      return { via: 'nats', subject };
    },
    async saveProbe() {
      fail('TOPOLOGY_NATS_UNAVAILABLE', 'Probe files are the file transport. NATS probes use request/reply.');
    },
    async close({ force = false } = {}) {
      if (transport.closed) return;
      transport.closed = true;
      clearInterval(heartbeat);
      for (const timer of timers) clearTimeout(timer);
      timers.clear();
      for (const sub of subscriptions) {
        try { sub.unsubscribe(); } catch { /* already closed */ }
      }
      subscriptions.clear();
      await (force ? nc.close() : nc.drain().catch(() => nc.close())).catch(() => {});
      if (bridge) await new Promise((resolve) => bridge.server.close(resolve));
      // TM-309 C2: this pid stops holding the outage once no connection here still falls back from it.
      if (!servers && selection.fallback && !holdsFallbackFrom(selection.fallback)) {
        await updateTransportState(env, home, (state) => settleOutage(state, { drop: process.pid }), { read: { retireAfterMs: Infinity } }).catch(surface);
      }
    },
  };
  return transport;
}

async function ensureStream(jsm, config) {
  try {
    await jsm.streams.info(config.name);
  } catch {
    await jsm.streams.add(config);
  }
}

async function ensureConsumer(jsm, stream, config) {
  try {
    await jsm.consumers.info(stream, config.durable_name);
  } catch {
    await jsm.consumers.add(stream, config);
  }
}

export async function publishReviewVerdict({ repo, nonce, verdict, transport, env = process.env }) {
  const active = transport ?? await resolveTransport({ env });
  const body = typeof verdict === 'string' ? verdict : JSON.stringify(verdict);
  return active.publishVerdict({ repo, nonce, body });
}
