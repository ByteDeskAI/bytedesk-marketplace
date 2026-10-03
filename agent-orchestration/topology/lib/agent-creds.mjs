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
import { chmodSync, existsSync, readdirSync, readFileSync, readlinkSync, unlinkSync } from 'node:fs';
import { chmod, mkdir, mkdtemp, rename, writeFile } from 'node:fs/promises';
import net from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { withLock } from './lockfile.mjs';
import { ORCH_LAYOUT, orchName } from './orch-transport.mjs';

/** nkeys ships inside the nats client; the installed plugin has only the bundle. */
async function natsClient() {
  try { return await import('nats'); } catch (error) {
    if (error?.code !== 'ERR_MODULE_NOT_FOUND') throw error;
    const client = await import(new URL('../../dist/nats-client.cjs', import.meta.url).href);
    return client.default || client;
  }
}

export const DEFAULT_TTL_MS = 24 * 60 * 60 * 1000;
const REGISTRY = 'agent-users.json';

// ---- permissions -------------------------------------------------------------------------------

/** What one agent may do on the wire. Role `lead` additionally writes claims; no agent role may create,
 * delete or purge a stream, touch another agent's durable, or reach $SYS. */
export function agentPermissions({ repo, agent, role = 'worker', mailTo = [], inboxPrefix }) {
  const r = orchName(repo);
  const a = orchName(agent);
  const mail = ORCH_LAYOUT.mailDurable(r, a);
  const reply = ORCH_LAYOUT.replyDurable(r, a);
  const buckets = [ORCH_LAYOUT.agentsBucket, ORCH_LAYOUT.claimsBucket, ORCH_LAYOUT.presenceBucket, ORCH_LAYOUT.personasBucket];
  const publish = [
    '$JS.API.INFO',
    `$JS.API.STREAM.INFO.${ORCH_LAYOUT.mailStream}`,
    ...buckets.flatMap((b) => [`$JS.API.STREAM.INFO.KV_${b}`, `$JS.API.DIRECT.GET.KV_${b}.>`]),
    `$JS.API.STREAM.INFO.OBJ_${ORCH_LAYOUT.reviewsBucket}`,
    ...[mail, reply].flatMap((d) => [`$JS.API.CONSUMER.INFO.${ORCH_LAYOUT.mailStream}.${d}`, `$JS.API.CONSUMER.MSG.NEXT.${ORCH_LAYOUT.mailStream}.${d}`, `$JS.ACK.${ORCH_LAYOUT.mailStream}.${d}.>`]),
    `$KV.${ORCH_LAYOUT.agentsBucket}.${r}.${a}`,
    `$KV.${ORCH_LAYOUT.presenceBucket}.${r}`,
    ...mailTo.map((target) => ORCH_LAYOUT.mailSubject(r, orchName(target))),
  ];
  if (role === 'lead') publish.push(`$KV.${ORCH_LAYOUT.claimsBucket}.${r}.>`, ORCH_LAYOUT.tasksSubject(r));
  if (role === 'reviewer' || role === 'lead') publish.push(`orch.${r}.review.>`);
  return {
    publish: { allow: publish, deny: ['$SYS.>', '$JS.API.STREAM.CREATE.>', '$JS.API.STREAM.UPDATE.>', '$JS.API.STREAM.DELETE.>', '$JS.API.STREAM.PURGE.>',
      '$JS.API.STREAM.MSG.DELETE.>', '$JS.API.STREAM.SNAPSHOT.>', '$JS.API.STREAM.RESTORE.>', '$JS.API.CONSUMER.CREATE.>',
      '$JS.API.CONSUMER.DURABLE.CREATE.>', '$JS.API.CONSUMER.DELETE.>'] },
    subscribe: { allow: [`${inboxPrefix}.>`, `orch.${r}.probe.${a}`], deny: ['$SYS.>'] },
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

// ---- issuing -----------------------------------------------------------------------------------

export class CredStore {
  /** home: the local NATS home (state.json, registry). serverPid: optional, else looked up from the config. */
  constructor({ home, serverPid = null, ttlMs = DEFAULT_TTL_MS, now = () => Date.now() } = {}) {
    this.home = home;
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
      const pid = this.serverPid ?? (() => { try { return JSON.parse(readFileSync(join(this.home, 'state.json'), 'utf8')).pid; } catch { return null; } })() ?? findServerPid(confPath);
      if (pid) process.kill(pid, 'SIGHUP');
      return result;
    });
  }

  /** Mint a new identity for (repo, agent). Returns the seed ONCE, in memory; only the public key is stored. */
  async issue({ repo, agent, role = 'worker', mailTo = [], ttlMs = this.ttlMs }) {
    const key = `${orchName(repo)}/${orchName(agent)}`;
    const user = (await natsClient()).nkeys.createUser();
    const publicKey = user.getPublicKey();
    const seed = new TextDecoder().decode(user.getSeed());
    const previous = (await readRegistry(this.home)).users[key];
    const entry = { repo: orchName(repo), agent: orchName(agent), role, mailTo, publicKey, expiresAt: this.now() + ttlMs,
      inboxPrefix: previous?.inboxPrefix ?? `_INBOX.${orchName(agent)}_${randomBytes(6).toString('hex')}` };
    await this.#mutate((registry) => { registry.users[key] = entry; });
    return { ...entry, seed };
  }

  /** New key, same identity and inbox; the old key is refused from the moment the server reloads. */
  async rotate({ repo, agent }) {
    const key = `${orchName(repo)}/${orchName(agent)}`;
    const current = (await readRegistry(this.home)).users[key];
    if (!current) throw new Error(`No credential issued for ${key}; nothing to rotate.`);
    const next = await this.issue({ repo, agent, role: current.role, mailTo: current.mailTo });
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
  async provision({ repo, agent, role, mailTo, ttlMs, extra = {} }) {
    const issued = await this.issue({ repo, agent, role, mailTo, ttlMs });
    const holder = await startHolder({ seed: issued.seed, inboxPrefix: issued.inboxPrefix, expiresAt: issued.expiresAt, ...extra });
    this.holders.set(`${issued.repo}/${issued.agent}`, holder);
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

/** Spawn the holder. Secrets cross an IPC channel (a socketpair), never argv, env or disk. */
export async function startHolder(secrets) {
  const dir = await mkdtemp(join(tmpdir(), 'ao-creds-'));
  await chmod(dir, 0o700);
  const sock = join(dir, 'c.sock');
  const child = spawn(process.execPath, [fileURLToPath(import.meta.url), '--holder'], {
    detached: true, stdio: ['ignore', 'ignore', 'ignore', 'ipc'], env: { PATH: process.env.PATH ?? '' },
  });
  const send = (message) => new Promise((resolve, reject) => {
    const onMessage = (reply) => { child.off('exit', onExit); resolve(reply); };
    const onExit = () => reject(new Error('credential holder exited'));
    child.once('message', onMessage); child.once('exit', onExit);
    child.send(message, (error) => { if (error) reject(error); });
  });
  const ready = await send({ type: 'init', sock, secrets });
  if (!ready.ok) throw new Error(`credential holder failed: ${ready.error}`);
  child.unref();
  child.channel?.unref();
  return {
    sock, pid: child.pid,
    attach: (rootPid) => send({ type: 'attach', rootPid }),
    install: (next) => send({ type: 'install', secrets: next }),
    revoke: () => send({ type: 'revoke' }),
  };
}

function holderMain() {
  let secrets = null;
  let root = null;
  let server = null;
  let sockPath = null;
  const stop = () => { secrets = null; server?.close(); try { if (sockPath) unlinkSync(sockPath); } catch { /* gone */ } setTimeout(() => process.exit(0), 50); };
  const watch = setInterval(() => { if (root && !existsSync(`/proc/${root}`)) stop(); }, 2000);
  watch.unref?.();
  process.on('message', (message) => {
    const reply = (body) => process.send(body);
    if (message.type === 'init') {
      secrets = message.secrets; sockPath = message.sock;
      server = net.createServer((socket) => {
        socket.once('data', () => {
          const live = secrets && (!secrets.expiresAt || secrets.expiresAt > Date.now());
          const allowed = live && root && peerPids(socket, sockPath).some((pid) => isDescendant(pid, root));
          socket.end(JSON.stringify(allowed ? secrets : { error: 'not the owner of this credential' }));
        });
        socket.on('error', () => {});
      });
      server.listen(sockPath, () => { try { chmodSync(sockPath, 0o600); } catch { /* best effort */ } reply({ ok: true }); });
      server.on('error', (error) => reply({ ok: false, error: error.message }));
    } else if (message.type === 'attach') { root = Number(message.rootPid); reply({ ok: true }); }
    else if (message.type === 'install') { secrets = message.secrets; reply({ ok: true }); }
    else if (message.type === 'revoke') { reply({ ok: true }); stop(); }
  });
  process.on('disconnect', () => {});
}

/**
 * Launch-time entry: a holder for this agent's reply token and, when this machine runs the local
 * NATS server, a per-agent NATS identity. AO_AGENT_CREDS=env opts out (the token then stays in the
 * launcher, the pre-TM-310 behaviour). Returns a holder handle, or null when opted out.
 */
export async function provisionForLaunch({ env = process.env, repo, agent, role, mailTo, token }) {
  if (env.AO_AGENT_CREDS === 'env') return null;
  const { localNatsHome } = await import('./nats-local.mjs');
  const home = localNatsHome(env);
  if (!env.AO_NATS_URL && existsSync(join(home, 'state.json'))) {
    const { holder } = await new CredStore({ home }).provision({ repo, agent, role, mailTo, extra: { token } });
    return holder;
  }
  return startHolder({ token });
}

/** Client side: the secrets for this process, or null when it was not launched with a holder (compat path). */
export async function fetchAgentSecrets(env = process.env) {
  const sock = env.AO_CREDS_SOCK;
  if (!sock) return null;
  return new Promise((resolve, reject) => {
    const socket = net.connect(sock);
    let body = '';
    socket.setTimeout(5000, () => { socket.destroy(); reject(new Error('credential holder did not answer')); });
    socket.on('data', (chunk) => { body += chunk; });
    socket.on('error', reject);
    socket.on('end', () => {
      try {
        const parsed = JSON.parse(body);
        if (parsed.error) reject(Object.assign(new Error(`credential holder refused: ${parsed.error}`), { code: 'TOPOLOGY_CREDS_REFUSED' }));
        else resolve(parsed);
      } catch (error) { reject(error); }
    });
    socket.write('get\n');
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href && process.argv[2] === '--holder') holderMain();
