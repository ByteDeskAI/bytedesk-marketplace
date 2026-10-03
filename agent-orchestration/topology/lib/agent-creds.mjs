// TM-310: one NATS credential per agent, delivered without a file or environment variable.
//
// Local sandbox server: each agent is an nkey user whose permissions name only its own mail
// durable, reply durable, inbox prefix and presence/agent keys. The server config holds public keys
// only. The seed lives in memory of a small holder process; the agent's `ao-topology` commands ask
// that holder over a unix socket. The holder identifies the asker from the KERNEL (the socket's peer
// inode, mapped to owning pids through /proc) and answers only a descendant of the agent's pane, so
// a sibling agent of the same OS user who finds the socket path gets a refusal, not the seed.
//
// Gateway path: the same holder can serve the text of an AO_ORCH_CREDS file instead of a seed, so
// the gateway's per-agent creds file need not sit on disk next to the launcher either.
//
// Residual, stated plainly: the local ADMIN user's password (state.json, 0600) and anything else a
// same-uid process can read is still readable by a sibling. This module closes the per-agent
// secret; the admin secret needs the provider sandbox (TM-282) or the gateway's separate issuer.
// ponytail: Linux only (/proc + ss); macOS needs LOCAL_PEERPID. Expiry is enforced by the holder and
// by registry pruning on the next apply, since nkey users carry no expiry; JWT users would.
import { spawn, execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { chmodSync, existsSync, readdirSync, readFileSync, readlinkSync, renameSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { chmod, mkdir, mkdtemp, rename, writeFile } from 'node:fs/promises';
import { mkdirSync } from 'node:fs';
import net from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { withLock } from './lockfile.mjs';
import { ORCH_LAYOUT, orchName } from './orch-transport.mjs';
import { TAMPER_INTERVAL_MS, journalTamper, sha256, summarizeChange } from './nats-tamper.mjs';

/** nkeys ships inside the nats client; the installed plugin has only the bundle. */
async function natsClient() {
  try { return await import('nats'); } catch (error) {
    if (error?.code !== 'ERR_MODULE_NOT_FOUND') throw error;
    const client = await import(new URL('../../dist/nats-client.cjs', import.meta.url).href);
    return client.default || client;
  }
}

// A unix socket path holds at most 107 bytes. Node does NOT refuse a longer one: it truncates it, binds the truncated
// name (a stray socket file in some parent directory) and a later bind of the same path then fails with EADDRINUSE.
const SOCKET_PATH_MAX = 100;

/** A socket path that fits: `<home>/<name>` when short enough, else a short per-user directory keyed by the home. */
export function socketPath(home, name) {
  const direct = join(home, name);
  if (Buffer.byteLength(direct) <= SOCKET_PATH_MAX) return direct;
  const dir = join('/tmp', `ao-sock-${process.getuid?.() ?? 0}`);
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  chmodSync(dir, 0o700); // mkdir's mode does not apply to a directory that already existed
  return join(dir, `${createHash('sha1').update(home).digest('hex').slice(0, 12)}-${name}`);
}

export const DEFAULT_TTL_MS = 24 * 60 * 60 * 1000;
const REGISTRY = 'agent-users.json';

// ---- permissions -------------------------------------------------------------------------------

/** What one agent may do on the wire. Role `lead` additionally writes claims; no agent role may create,
 * delete or purge a stream, touch another agent's durable, or reach $SYS. */
export function agentPermissions({ repo, agent, role = 'worker', mailTo = [], inboxPrefix, takesWork = false }) {
  const r = orchName(repo);
  const a = orchName(agent);
  const mail = ORCH_LAYOUT.mailDurable(r, a);
  const reply = ORCH_LAYOUT.replyDurable(r, a);
  const buckets = [ORCH_LAYOUT.agentsBucket, ORCH_LAYOUT.claimsBucket, ORCH_LAYOUT.presenceBucket, ORCH_LAYOUT.personasBucket, ORCH_LAYOUT.handoffsBucket];
  const overseer = role === 'lead' || role === 'reviewer';
  const publish = [
    '$JS.API.INFO',
    `$JS.API.STREAM.INFO.${ORCH_LAYOUT.mailStream}`,
    ...buckets.flatMap((b) => [`$JS.API.STREAM.INFO.KV_${b}`, ...(b === ORCH_LAYOUT.handoffsBucket && role !== 'lead' ? [] : [`$JS.API.DIRECT.GET.KV_${b}.>`])]),
    `$JS.API.STREAM.INFO.OBJ_${ORCH_LAYOUT.reviewsBucket}`,
    ...[mail, reply].flatMap((d) => [`$JS.API.CONSUMER.INFO.${ORCH_LAYOUT.mailStream}.${d}`, `$JS.API.CONSUMER.MSG.NEXT.${ORCH_LAYOUT.mailStream}.${d}`, `$JS.ACK.${ORCH_LAYOUT.mailStream}.${d}.>`]),
    `$KV.${ORCH_LAYOUT.agentsBucket}.${r}.${a}`,
    `$KV.${ORCH_LAYOUT.presenceBucket}.${r}`,
    // A reply goes to the sender's reply subject; the same peers that may be mailed may be replied to.
    ...mailTo.flatMap((target) => [ORCH_LAYOUT.mailSubject(r, orchName(target)), ORCH_LAYOUT.replySubject(r, orchName(target))]),
  ];
  const E = ORCH_LAYOUT.eventsStream;
  const tasks = ORCH_LAYOUT.tasksDurable(r);
  const handoffs = ORCH_LAYOUT.handoffsBucket;
  // Events: every agent journals; only an overseer reads them back (diagnose) or watches them.
  publish.push(`orch.${r}.events.>`);
  if (overseer) publish.push(`$JS.API.STREAM.INFO.${E}`, `$JS.API.STREAM.MSG.GET.${E}`);
  // Handoff records: an agent writes and reads only keys under its own identity; the lead reads any.
  publish.push(`$KV.${handoffs}.${r}.${a}.>`);
  if (role !== 'lead') publish.push(`$JS.API.DIRECT.GET.KV_${handoffs}.$KV.${handoffs}.${r}.${a}.>`);
  // TM-315: a retrying sender reads the recipient's delivered record (ids only), and nothing else of the recipient's.
  if (role !== 'lead') publish.push(`$JS.API.DIRECT.GET.KV_${handoffs}.$KV.${handoffs}.${r}.*.delivered.>`);
  // Work queue: the lead publishes ready items; a worker that takes work pulls them and writes fenced claims.
  if (role === 'lead') publish.push(ORCH_LAYOUT.tasksSubject(r), `$KV.${ORCH_LAYOUT.claimsBucket}.${r}.>`, `$JS.API.STREAM.MSG.GET.${ORCH_LAYOUT.mailStream}`, `orch.${r}.probe.*`);
  if (role === 'lead' || takesWork) publish.push(`$JS.API.CONSUMER.INFO.${ORCH_LAYOUT.tasksStream}.${tasks}`, `$JS.API.CONSUMER.MSG.NEXT.${ORCH_LAYOUT.tasksStream}.${tasks}`, `$JS.ACK.${ORCH_LAYOUT.tasksStream}.${tasks}.>`, `$JS.API.STREAM.INFO.${ORCH_LAYOUT.tasksStream}`);
  if (takesWork) publish.push(`$KV.${ORCH_LAYOUT.claimsBucket}.${r}.>`);
  if (overseer) publish.push(`orch.${r}.review.>`);
  return {
    publish: { allow: publish, deny: ['$SYS.>', '$JS.API.STREAM.CREATE.>', '$JS.API.STREAM.UPDATE.>', '$JS.API.STREAM.DELETE.>', '$JS.API.STREAM.PURGE.>',
      '$JS.API.STREAM.MSG.DELETE.>', '$JS.API.STREAM.SNAPSHOT.>', '$JS.API.STREAM.RESTORE.>', '$JS.API.CONSUMER.CREATE.>',
      '$JS.API.CONSUMER.DURABLE.CREATE.>', '$JS.API.CONSUMER.DELETE.>'] },
    subscribe: { allow: [`${inboxPrefix}.>`, `orch.${r}.probe.${a}`, ...(overseer ? [`orch.${r}.events.>`] : [])], deny: ['$SYS.>'] },
    allow_responses: true,
  };
}

const list = (subjects) => `[${subjects.map((s) => JSON.stringify(s)).join(', ')}]`;

/** One nkey user block for nats-server.conf. */
export function renderAgentUser(entry) {
  const p = agentPermissions(entry);
  return `{ nkey: ${entry.publicKey}, permissions: { publish: { allow: ${list(p.publish.allow)}, deny: ${list(p.publish.deny)} },`
    + ` subscribe: { allow: ${list(p.subscribe.allow)}, deny: ${list(p.subscribe.deny)} }, allow_responses: true } }`;
}

// ---- registry (public keys only; no secret is ever written) --------------------------------------

export function loadAgentUsers(home, now = Date.now()) {
  try {
    const users = JSON.parse(readFileSync(join(home, REGISTRY), 'utf8')).users ?? {};
    return Object.values(users).filter((entry) => !entry.expiresAt || entry.expiresAt > now);
  } catch { return []; }
}

async function readRegistry(home) {
  try { return JSON.parse(readFileSync(join(home, REGISTRY), 'utf8')); } catch { return { version: 1, users: {} }; }
}

async function writeRegistry(home, registry) {
  const path = join(home, REGISTRY);
  await writeFile(`${path}.tmp`, JSON.stringify(registry), { mode: 0o600 });
  await rename(`${path}.tmp`, path);
}

/** Linux: the nats-server whose command line names this config. Used when the server was started by a service manager. */
export function findServerPid(confPath) {
  for (const dir of readdirSync('/proc')) {
    if (!/^\d+$/.test(dir)) continue;
    try {
      const argv = readFileSync(`/proc/${dir}/cmdline`, 'utf8').split('\0');
      if (argv[0].includes('nats-server') && argv.includes(confPath)) return Number(dir);
    } catch { /* gone or not ours */ }
  }
  return null;
}

/** A recorded server pid is trusted only if that pid is still a nats-server; a reused pid would otherwise receive our SIGHUP. */
export function serverPidFor(recorded, confPath) {
  if (recorded) {
    try { if (readFileSync(`/proc/${recorded}/cmdline`, 'utf8').includes('nats-server')) return recorded; } catch { /* gone */ }
  }
  return findServerPid(confPath);
}

// ---- issuing -----------------------------------------------------------------------------------

export class CredStore {
  /** home: the local NATS home (state.json, registry). serverPid: optional, else looked up from the config. */
  constructor({ home, serverPid = null, ttlMs = DEFAULT_TTL_MS, graceMs, now = () => Date.now() } = {}) {
    this.home = home;
    this.graceMs = graceMs;
    this.serverPid = serverPid;
    this.ttlMs = ttlMs;
    this.now = now;
    this.holders = new Map();
  }

  async #mutate(change) {
    await mkdir(this.home, { recursive: true, mode: 0o700 });
    return withLock(join(this.home, 'users.lock'), async () => {
      const registry = await readRegistry(this.home);
      const result = change(registry);
      for (const [key, entry] of Object.entries(registry.users)) if (entry.expiresAt && entry.expiresAt <= this.now()) delete registry.users[key];
      await writeRegistry(this.home, registry);
      const { rewriteServerConfig } = await import('./nats-local.mjs');
      const confPath = await rewriteServerConfig(this.home);
      const pid = this.serverPid ?? serverPidFor((() => { try { return JSON.parse(readFileSync(join(this.home, 'state.json'), 'utf8')).pid; } catch { return null; } })(), confPath);
      if (pid) process.kill(pid, 'SIGHUP');
      return result;
    });
  }

  // Where this agent's holder listens (not a secret), so a later provision can retire it. Config is untouched: no reload.
  async #noteHolder(issued, sock) {
    await withLock(join(this.home, 'users.lock'), async () => {
      const registry = await readRegistry(this.home);
      const entry = registry.users[`${issued.repo}/${issued.agent}`];
      if (entry) { entry.holderSock = sock; await writeRegistry(this.home, registry); }
    });
  }

  /** Mint a new identity for (repo, agent). Returns the seed ONCE, in memory; only the public key is stored. */
  async issue({ repo, agent, role = 'worker', mailTo = [], takesWork = false, ttlMs = this.ttlMs }) {
    const key = `${orchName(repo)}/${orchName(agent)}`;
    const user = (await natsClient()).nkeys.createUser();
    const publicKey = user.getPublicKey();
    const seed = new TextDecoder().decode(user.getSeed());
    const previous = (await readRegistry(this.home)).users[key];
    const entry = { repo: orchName(repo), agent: orchName(agent), role, mailTo, takesWork, publicKey, expiresAt: this.now() + ttlMs,
      inboxPrefix: previous?.inboxPrefix ?? `_INBOX.${orchName(agent)}_${randomBytes(6).toString('hex')}` };
    await this.#mutate((registry) => { registry.users[key] = entry; });
    return { ...entry, seed };
  }

  /** New key, same identity and inbox; the old key is refused from the moment the server reloads. */
  async rotate({ repo, agent }) {
    const key = `${orchName(repo)}/${orchName(agent)}`;
    const current = (await readRegistry(this.home)).users[key];
    if (!current) throw new Error(`No credential issued for ${key}; nothing to rotate.`);
    const next = await this.issue({ repo, agent, role: current.role, mailTo: current.mailTo, takesWork: current.takesWork });
    await this.holders.get(key)?.install({ seed: next.seed, inboxPrefix: next.inboxPrefix, expiresAt: next.expiresAt });
    return next;
  }

  /** Remove the identity: the server drops its open connection on reload and refuses the key afterwards. */
  async revoke({ repo, agent }) {
    const key = `${orchName(repo)}/${orchName(agent)}`;
    await this.#mutate((registry) => { delete registry.users[key]; });
    await this.holders.get(key)?.revoke();
    this.holders.delete(key);
  }

  /** issue + a holder for the secrets. `extra` rides along (the reply token). */
  async provision({ repo, agent, role, mailTo, takesWork, ttlMs, extra = {} }) {
    // A relaunch of the same agent supersedes its previous holder; retire it so holders do not accumulate.
    const previous = (await readRegistry(this.home)).users[`${orchName(repo)}/${orchName(agent)}`]?.holderSock;
    if (previous && await holderAlive(previous)) await requestSocket(previous, { op: 'revoke' }, 2000).catch(() => {});
    const issued = await this.issue({ repo, agent, role, mailTo, takesWork, ttlMs });
    const holder = await startHolder({ seed: issued.seed, inboxPrefix: issued.inboxPrefix, expiresAt: issued.expiresAt, agent: issued.agent, ...extra }, { home: this.home, graceMs: this.graceMs });
    this.holders.set(`${issued.repo}/${issued.agent}`, holder);
    await this.#noteHolder(issued, holder.sock);
    return { issued, holder };
  }
}

// ---- holder (the only place a seed lives) ---------------------------------------------------------

function ppidOf(pid) {
  try { return Number(readFileSync(`/proc/${pid}/stat`, 'utf8').replace(/^.*\) \S+ /, '').split(' ')[0]); } catch { return 0; }
}

export function isDescendant(pid, root) {
  for (let hops = 0, p = pid; p > 1 && hops < 64; hops += 1, p = ppidOf(p)) if (p === root) return true;
  return false;
}

/** Pids holding the other end of this accepted unix socket, from the kernel's own pairing. Empty when it cannot be proven. */
export function peerPids(socket, sockPath) {
  try {
    const inode = readlinkSync(`/proc/self/fd/${socket._handle.fd}`).slice('socket:['.length, -1);
    const rows = execFileSync('ss', ['-xnH', 'src', sockPath], { encoding: 'utf8', maxBuffer: 1 << 26 }).split('\n');
    const row = rows.map((line) => line.trim().split(/\s+/)).find((fields) => fields.includes(inode));
    if (!row) return [];
    const peer = row[row.indexOf(inode) + 2];
    const found = [];
    for (const dir of readdirSync('/proc')) {
      if (!/^\d+$/.test(dir)) continue;
      try { for (const fd of readdirSync(`/proc/${dir}/fd`)) if (readlinkSync(`/proc/${dir}/fd/${fd}`) === `socket:[${peer}]`) found.push(Number(dir)); } catch { /* not ours */ }
    }
    return found;
  } catch { return []; }
}

// Pids that root an agent's tree, written by each agent holder when it is attached. Not secret; read by
// every holder to tell "an agent's process" from "the operator's process".
const rootsFile = (home) => join(home, 'roots.json');
export function agentRoots(home) {
  if (!home) return [];
  try { return Object.values(JSON.parse(readFileSync(rootsFile(home), 'utf8'))).filter((pid) => existsSync(`/proc/${pid}`)); } catch { return []; }
}
async function registerRoot(home, sock, pid) {
  await withLock(join(home, 'roots.lock'), async () => {
    let roots = {};
    try { roots = JSON.parse(readFileSync(rootsFile(home), 'utf8')); } catch { /* first */ }
    for (const [key, value] of Object.entries(roots)) if (!existsSync(`/proc/${value}`)) delete roots[key];
    roots[sock] = pid;
    await writeFile(`${rootsFile(home)}.tmp`, JSON.stringify(roots), { mode: 0o600 });
    await rename(`${rootsFile(home)}.tmp`, rootsFile(home));
  });
}

/** Ask a holder to re-attach to a new pane root, from any process of the operator's (not an agent's) tree. */
export async function attachViaSocket(sock, rootPid) {
  const reply = await requestSocket(sock, { op: 'attach', pid: rootPid });
  if (!reply.ok) throw Object.assign(new Error(`credential holder at ${sock} refused attach: ${reply.error}`), { code: 'TOPOLOGY_CREDS_REFUSED' });
  return reply;
}

/** A handle on an existing holder from another process: attach only, over its socket (operator tree only). */
export function remoteHolder(sock) {
  return sock ? { sock, attach: (rootPid) => attachViaSocket(sock, rootPid) } : null;
}

/**
 * The file that runs a holder. From source it is credential-holder.mjs next to this file; from a bundle (dist/*.cjs, where
 * import.meta.url names the bundle, not this module) it is dist/credential-holder.cjs. Spawning the bundle itself would run
 * that bundle's own main, so the holder has an entry point of its own.
 */
function holderScript() {
  const here = fileURLToPath(import.meta.url);
  return join(dirname(here), here.endsWith('.mjs') ? 'credential-holder.mjs' : 'credential-holder.cjs');
}

/**
 * Spawn a holder. Secrets cross an IPC channel (a socketpair) during the handshake only, never argv, env or disk.
 * admin: the holder GENERATES an nkey, never reveals the seed to its spawner, and hands it only to
 * a process outside every agent tree. home: where roots.json lives (needed for admin and cross-process attach).
 */
export async function startHolder(secrets, { home = null, sock: fixedSock = null, admin = false, graceMs = Number(process.env.AO_CREDS_GRACE_MS) || 20_000 } = {}) {
  let sock = fixedSock;
  if (!sock) {
    // tmpdir() can itself be long (a sandbox TMPDIR); fall back to /tmp rather than overflow the socket path.
    const base = Buffer.byteLength(join(tmpdir(), 'ao-creds-XXXXXX', 'c.sock')) <= SOCKET_PATH_MAX ? tmpdir() : '/tmp';
    const dir = await mkdtemp(join(base, 'ao-creds-'));
    await chmod(dir, 0o700);
    sock = join(dir, 'c.sock');
  }
  if (Buffer.byteLength(sock) > 107) throw Object.assign(new Error(`credential holder socket path is ${Buffer.byteLength(sock)} bytes; the limit is 107 (${sock})`), { code: 'HOLDER_SOCKET_PATH_TOO_LONG' });
  const child = spawn(process.execPath, [holderScript()], {
    detached: true, stdio: ['ignore', 'ignore', 'ignore', 'ipc'], env: { PATH: process.env.PATH ?? '', ...(process.env.AO_TEST_RUN ? { AO_TEST_RUN: process.env.AO_TEST_RUN } : {}) },
  });
  // The IPC channel carries only the init handshake. Once the holder reports ready it is closed: a Node parent with an open
  // IPC child cannot exit, and a launcher must. From then on the unix socket is the only channel, authorised by `ctl` (held
  // in this process's memory) or, from another process, by being outside every agent's tree.
  const ctl = randomBytes(16).toString('hex');
  const ready = await new Promise((resolve, reject) => {
    child.once('message', resolve);
    child.once('exit', () => reject(new Error('credential holder exited')));
    child.send({ type: 'init', sock, secrets, home, admin, graceMs, ctl, spawnerPid: process.pid, tamperMs: Number(process.env.AO_TAMPER_INTERVAL_MS) || TAMPER_INTERVAL_MS }, (error) => { if (error) reject(error); });
  });
  if (!ready.ok) { child.kill('SIGKILL'); throw Object.assign(new Error(`credential holder failed: ${ready.error}`), { code: ready.code ?? 'HOLDER_FAILED' }); }
  child.disconnect();
  child.unref();
  const control = async (request) => {
    const reply = await requestSocket(sock, { ...request, ctl }, 5000);
    if (reply?.ok === false) throw Object.assign(new Error(`credential holder refused ${request.op}: ${reply.error}`), { code: 'TOPOLOGY_CREDS_REFUSED' });
    return reply;
  };
  return {
    sock, pid: child.pid, publicKey: ready.publicKey ?? null,
    attach: (rootPid) => control({ op: 'attach', pid: rootPid }),
    install: (next) => control({ op: 'install', secrets: next }),
    revoke: () => control({ op: 'revoke' }),
  };
}

export function holderMain() {
  let secrets = null;
  let root = null;
  let server = null;
  let sockPath = null;
  let home = null;
  let admin = false;
  let publicKey = null;
  let ctl = null;
  let spawnerPid = null;
  const startedAt = Date.now();
  // TM-316 (admin holder only): the expected server config lives here, in memory, and is compared with the file.
  let expected = null; // { conf, confPath, at }
  let tamperMs = TAMPER_INTERVAL_MS;
  let seen = { pid: undefined, exe: null };
  let repairs = 0;
  const tamperTick = () => {
    if (!admin || !expected || !home) return { watching: false };
    const { conf, confPath } = expected;
    // A write announced a moment ago may not have reached the disk yet; do not "repair" it into itself.
    if (Date.now() - expected.at < Math.min(1500, 2 * tamperMs)) return { watching: true, skipped: 'announce-grace' };
    let actual = null;
    try { actual = readFileSync(confPath, 'utf8'); } catch { /* missing counts as changed */ }
    const out = { watching: true, inSync: actual === conf };
    if (actual !== conf) {
      let repaired = false; let error = null; let reloaded = null;
      try { writeFileSync(`${confPath}.repair`, conf, { mode: 0o600 }); renameSync(`${confPath}.repair`, confPath); repaired = true; } catch (e) { error = e.message; }
      const pid = serverPidFor(null, confPath);
      if (repaired && pid) { try { process.kill(pid, 'SIGHUP'); reloaded = pid; } catch { /* gone */ } }
      repairs += 1;
      journalTamper(home, { kind: 'conf-changed', severity: 'tamper', confPath, ...summarizeChange(conf, actual), repaired, reloaded, ...(error ? { error } : {}) });
      out.repaired = repaired;
    } else {
      try { if ((statSync(confPath).mode & 0o077) !== 0) { chmodSync(confPath, 0o600); journalTamper(home, { kind: 'conf-mode', severity: 'tamper', confPath, repaired: true }); } } catch { /* raced */ }
    }
    // The server process: a new pid or a new executable behind the same pid is reported (a service-manager restart is a notice, not an alarm).
    const pid = serverPidFor(null, confPath);
    let exe = null;
    if (pid) { try { exe = readlinkSync(`/proc/${pid}/exe`); } catch { /* not ours to read */ } }
    if (seen.pid !== undefined && (pid !== seen.pid || (exe && seen.exe && exe !== seen.exe))) {
      journalTamper(home, { kind: pid === seen.pid ? 'server-exe-changed' : 'server-pid-changed', severity: pid === seen.pid ? 'tamper' : 'notice', before: { pid: seen.pid, exe: seen.exe }, after: { pid, exe } });
    }
    seen = { pid, exe };
    return out;
  };
  const tamperTimer = { current: null };
  const stop = () => { secrets = null; server?.close(); try { if (sockPath) unlinkSync(sockPath); } catch { /* gone */ } setTimeout(() => process.exit(0), 50); };
  // The root dying is not the end: a failover or restart re-attaches within the grace window.
  let rootGoneSince = null;
  let graceMs = 20_000;
  const watch = setInterval(() => {
    // Nothing left to serve: its socket was removed, or the home it belongs to is gone (a deleted test directory, an uninstall).
    if (sockPath && (!existsSync(sockPath) || (home && !existsSync(home)))) return stop();
    // Its spawner is gone and it was never attached to a pane: nothing will attach it now.
    if (!root && !admin && spawnerPid && !existsSync(`/proc/${spawnerPid}`) && Date.now() - startedAt > Math.min(5000, graceMs)) return stop();
    if (!root || existsSync(`/proc/${root}`)) { rootGoneSince = null; return; }
    rootGoneSince ??= Date.now();
    if (Date.now() - rootGoneSince > graceMs) stop();
  }, 1000);
  watch.unref?.();
  // A holder nobody attached (launch failed, test aborted) must not outlive its purpose. The admin holder is long-lived by design.
  setTimeout(() => { if (!root && !admin) stop(); }, 120_000).unref?.();
  const serve = (socket, request) => {
    const peers = peerPids(socket, sockPath);
    const roots = agentRoots(home);
    // Outside every agent tree. Fails closed when the kernel cannot name the peer.
    const operator = peers.length > 0 && !peers.some((pid) => roots.some((rootPid) => isDescendant(pid, rootPid)));
    const owner = Boolean(root) && peers.some((pid) => isDescendant(pid, root));
    const live = secrets && (!secrets.expiresAt || secrets.expiresAt > Date.now());
    // The public key is not a secret: anyone who can reach the socket may learn whose holder this is.
    if (request.op === 'pub') return { publicKey, pid: process.pid, admin };
    // Digests are not secret: anyone may ask whether the admin holder is watching and whether the file still matches.
    if (request.op === 'tamper') {
      let current = null;
      try { current = sha256(readFileSync(expected.confPath, 'utf8')); } catch { /* none */ }
      return { admin, watching: Boolean(expected), intervalMs: tamperMs, repairs, expectedSha: expected ? sha256(expected.conf) : null, currentSha: current };
    }
    // Control is the spawner's (it holds `ctl`) or, from another process, the operator tree's (outside every agent tree, with a registry to judge by).
    const controller = (Boolean(ctl) && request.ctl === ctl) || (Boolean(home) && operator);
    if (request.op === 'install') {
      if (!controller) return { ok: false, error: 'install is for the spawner or the operator process tree only' };
      secrets = { ...secrets, ...request.secrets };
      return { ok: true };
    }
    if (request.op === 'expect' || request.op === 'check') {
      if (!controller || !admin) return { ok: false, error: `${request.op} is for the operator process tree, on the admin holder only` };
      if (request.op === 'check') { expected && (expected.at = 0); return { ok: true, ...tamperTick() }; }
      // Anything on disk that is neither the config we last expected nor the one about to be written was put there by someone else.
      let pre = null;
      if (expected) { try { pre = readFileSync(expected.confPath, 'utf8'); } catch { /* missing */ } }
      const tampered = Boolean(expected) && expected.confPath === request.confPath && pre !== expected.conf && pre !== request.conf;
      if (tampered) { journalTamper(home, { kind: 'conf-changed-before-update', severity: 'tamper', confPath: request.confPath, ...summarizeChange(expected.conf, pre), repaired: true, reloaded: null }); repairs += 1; }
      expected = { conf: String(request.conf), confPath: String(request.confPath), at: Date.now() };
      return { ok: true, tampered };
    }
    if (request.op === 'revoke') {
      if (!controller) return { ok: false, error: 'revoke is for the spawner or the operator process tree only' };
      setTimeout(stop, 20);
      return { ok: true };
    }
    if (request.op === 'attach') {
      if (!controller || admin) return { ok: false, error: `attach is for the spawner or the operator process tree only (peers=${JSON.stringify(peers)} roots=${JSON.stringify(roots)} home=${Boolean(home)} ctl=${Boolean(ctl)} admin=${admin} operator=${operator})` };
      root = Number(request.pid);
      if (home) registerRoot(home, sockPath, root).catch(() => {});
      return { ok: true };
    }
    if (!live) return { error: 'credential expired or revoked' };
    return (admin ? operator : owner) ? secrets : { error: admin ? 'not an operator process' : 'not the owner of this credential' };
  };
  process.on('message', async (message) => {
    const reply = (body) => process.send(body);
    if (message.type === 'init') {
      secrets = message.secrets; sockPath = message.sock; home = message.home; admin = message.admin; graceMs = message.graceMs ?? graceMs; ctl = message.ctl; spawnerPid = message.spawnerPid;
      if (admin) {
        tamperMs = message.tamperMs ?? tamperMs;
        tamperTimer.current = setInterval(() => { try { tamperTick(); } catch { /* the watcher must not die of one bad read */ } }, tamperMs);
        tamperTimer.current.unref?.();
        const user = (await natsClient()).nkeys.createUser();
        publicKey = user.getPublicKey();
        secrets = { seed: new TextDecoder().decode(user.getSeed()) };
      }
      server = net.createServer((socket) => {
        socket.once('data', (data) => {
          let request = { op: 'get' };
          try { request = JSON.parse(String(data)); } catch { /* legacy "get" */ }
          socket.end(JSON.stringify(serve(socket, request)));
        });
        socket.on('error', () => {});
      });
      const listen = (retry) => {
        server.once('error', async (error) => {
          if (error.code !== 'EADDRINUSE' || !retry) return reply({ ok: false, error: error.message });
          // Someone's socket is already there: a live holder keeps it (we are the duplicate); a dead one's file is removed.
          if (await holderAlive(sockPath)) return reply({ ok: false, code: 'HOLDER_LIVE', error: `a live holder already owns ${sockPath}` });
          try { unlinkSync(sockPath); } catch { /* raced */ }
          listen(false);
        });
        server.listen(sockPath, () => { try { chmodSync(sockPath, 0o600); } catch { /* best effort */ } reply({ ok: true, publicKey }); });
      };
      listen(true);
    }
  });
}

/**
 * Launch-time entry: a holder for this agent's reply token and, when this machine runs the local
 * NATS server, a per-agent NATS identity. AO_AGENT_CREDS=env opts out (the token then stays in the
 * launcher, the pre-TM-310 behaviour). Returns a holder handle, or null when opted out.
 */
export async function provisionForLaunch({ env = process.env, repo, agent, role, mailTo, token }) {
  if (env.AO_AGENT_CREDS === 'env') return null;
  const { localNatsHome, localNatsEnabled, ensureLocalNats } = await import('./nats-local.mjs');
  const { transportMode } = await import('./orch-transport.mjs');
  const home = localNatsHome(env);
  // The NATS transport is the default, so the identity must exist before the pane starts; bring the local server up if this machine uses one.
  if (transportMode(env) !== 'file' && localNatsEnabled(env)) await ensureLocalNats({ env }).catch(() => null);
  if (!env.AO_NATS_URL && existsSync(join(home, 'state.json'))) {
    const { holder } = await new CredStore({ home }).provision({ repo, agent, role, mailTo, extra: { token } });
    // An agent may not create streams or consumers, so the host makes the agent's durables before its pane starts.
    const { resolveTransport } = await import('./orch-transport.mjs');
    const host = await resolveTransport({ env }).catch(() => null);
    await host?.ensure?.({ repo, agents: [agent], replies: [agent] }).catch(() => {});
    return holder;
  }
  // No local NATS (file transport, or an external server): the holder still needs the shared registry of agent trees to
  // tell the operator from an agent, or a failover from another process could never re-attach it (it would be refused as
  // "not the operator" because nothing can be judged). The registry is just roots.json beside the NATS home.
  await mkdir(home, { recursive: true, mode: 0o700 });
  return startHolder({ token }, { home });
}

/** One request to a holder socket; resolves the parsed reply. */
export function requestSocket(sock, request, timeoutMs = 5000) {
  return new Promise((resolve, reject) => {
    const socket = net.connect(sock);
    let body = '';
    socket.setTimeout(timeoutMs, () => { socket.destroy(); reject(new Error('credential holder did not answer')); });
    socket.on('data', (chunk) => { body += chunk; });
    socket.on('error', reject);
    socket.on('end', () => { try { resolve(JSON.parse(body)); } catch (error) { reject(error); } });
    socket.write(`${JSON.stringify(request)}\n`);
  });
}

function secretsOrRefusal(reply, sock) {
  if (reply.error) throw Object.assign(new Error(`credential holder refused: ${reply.error}`), { code: 'TOPOLOGY_CREDS_REFUSED', sock });
  return reply;
}

/** Client side: the secrets for this process, or null when it was not launched with a holder (compat path). */
export async function fetchAgentSecrets(env = process.env) {
  return env.AO_CREDS_SOCK ? secretsOrRefusal(await requestSocket(env.AO_CREDS_SOCK, { op: 'get' }), env.AO_CREDS_SOCK) : null;
}

/** The local admin identity's seed, from the admin holder; refused to any process inside an agent's tree. */
export async function fetchAdminSecrets(sock) {
  return secretsOrRefusal(await requestSocket(sock, { op: 'get' }), sock);
}

/** Who owns this socket right now: { publicKey, pid, admin }, or null when nothing answers (absent or stale file). */
export async function holderIdentity(sock) {
  try {
    const reply = await requestSocket(sock, { op: 'pub' }, 2000);
    return reply?.pid ? reply : null;
  } catch { return null; }
}

export async function holderAlive(sock) {
  return new Promise((resolve) => {
    const probe = net.connect(sock, () => { probe.destroy(); resolve(true); });
    probe.once('error', () => resolve(false));
  });
}
