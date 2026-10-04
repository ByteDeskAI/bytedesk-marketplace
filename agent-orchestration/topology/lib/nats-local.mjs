// Local NATS fallback: when no gateway listener and no explicit server is reachable, start one
// JetStream nats-server for this user, detached, and hand back its URL and credentials.
//
// Port (TM-308 / ADR-0032): `nats.port` in the developer's ao user config, chosen once from what is
// free on this machine and never moved silently. A port held by something else is a refusal naming
// the holder, not a reason to pick another.
//
// Security posture: loopback only, no system account (so no $SYS access), permissions
// limited to the orch subject space plus the JetStream/KV API the transport needs.
// TM-310: no password exists anywhere. The host identity is an nkey whose seed lives only in an admin
// holder process (agent-creds.mjs) and is handed only to processes outside every agent's tree; agents
// are separate nkey users with narrowed permissions (public keys in agent-users.json).
// A pre-TM-310 state.json that still carries a password is migrated away on the next ensure.
import { spawn } from 'node:child_process';
import { existsSync, openSync, readFileSync, readdirSync, readlinkSync } from 'node:fs';
import { chmod, mkdir, unlink, writeFile } from 'node:fs/promises';
import net from 'node:net';
import { homedir } from 'node:os';
import { delimiter, isAbsolute, join } from 'node:path';
import { holderIdentity, requestSocket, serverPidFor, socketPath, loadAgentUsers, renderAgentUser, startHolder } from './agent-creds.mjs';
import { globalConfigPath, mergeConfig, readConfigLayer, writeConfigLayer } from './config.mjs';
import { withLock } from './lockfile.mjs';
import { fail } from './util.mjs';
import { runServicesEnsure, servicesEnabled } from './services-client.mjs';

export function localNatsHome(env = process.env) {
  if (env.AO_NATS_HOME) return env.AO_NATS_HOME;
  // A test run (the helper that loads suite-leaks sets AO_TEST_RUN) that reaches here has lost AO_NATS_HOME, for example
  // through a scrubbed child env. Falling back would provision test users into the operator's live server.
  // NODE_TEST_CONTEXT is set by `node --test` in every test child, with or without our preflight, so a test file run on its own is covered too.
  if (env.AO_TEST_RUN || env.NODE_TEST_CONTEXT) throw Object.assign(new Error('AO_NATS_HOME is not set in a test run (AO_TEST_RUN or node --test): refusing to use the operator\'s real local NATS home.'), { code: 'TOPOLOGY_TEST_REAL_NATS_HOME' });
  return join(homedir(), '.bytedesk', 'agent-orchestration', 'nats');
}

/** AO_NATS_SERVER, then the ao-orch cache, then PATH. A snap shim with no snap behind it is skipped by running --version. */
export async function findNatsServer(env = process.env) {
  const { execFile } = await import('node:child_process');
  const candidates = [env.AO_NATS_SERVER, join(homedir(), '.cache', 'ao-orch', 'nats-server'), 'nats-server'].filter(Boolean);
  for (const bin of candidates) {
    const ok = await new Promise((resolve) => execFile(bin, ['--version'], { timeout: 5000 }, (error) => resolve(!error)));
    if (ok) return bin;
  }
  return null;
}

function canConnect(port) {
  return new Promise((resolve) => {
    const socket = net.connect({ host: '127.0.0.1', port }, () => { socket.destroy(); resolve(true); });
    socket.once('error', () => resolve(false));
    socket.setTimeout(1000, () => { socket.destroy(); resolve(false); });
  });
}

// Clear of ao's session host (45000–45032) and process-compose (45100–45199).
export const NATS_PORT_RANGE = [45200, 45999];
const SERVER_NAME = 'ao-orch-local';

export const validNatsPort = (port) => Number.isInteger(port) && port >= 1024 && port <= 65535;

function canBind(port) {
  return new Promise((resolve) => {
    const probe = net.createServer();
    probe.once('error', () => resolve(false));
    probe.listen(port, '127.0.0.1', () => probe.close(() => resolve(true)));
  });
}

/** The INFO a nats-server sends on accept, or null for anything that is not one. */
function natsInfo(port) {
  return new Promise((resolve) => {
    let text = '';
    const socket = net.connect({ host: '127.0.0.1', port });
    const done = (value) => { socket.destroy(); resolve(value); };
    socket.on('data', (chunk) => {
      text += chunk;
      const end = text.indexOf('\r\n');
      if (end < 0) return;
      try { done(text.startsWith('INFO ') ? JSON.parse(text.slice(5, end)) : null); } catch { done(null); }
    });
    socket.once('error', () => done(null));
    socket.setTimeout(1000, () => done(null));
  });
}

/** Linux: the process listening on `port`, found by socket inode. null when it cannot be named. */
export function portHolder(port) {
  if (process.platform !== 'linux') return null;
  const hex = port.toString(16).toUpperCase().padStart(4, '0');
  const inodes = new Set();
  for (const table of ['/proc/net/tcp', '/proc/net/tcp6']) {
    let lines = [];
    try { lines = readFileSync(table, 'utf8').trim().split('\n').slice(1); } catch { continue; }
    for (const line of lines) {
      const cols = line.trim().split(/\s+/);
      if (cols[1]?.endsWith(`:${hex}`) && cols[3] === '0A') inodes.add(`socket:[${cols[9]}]`);
    }
  }
  if (inodes.size === 0) return null;
  // ponytail: a full /proc scan, run only on a conflict; another user's process stays unnamed.
  for (const pid of readdirSync('/proc').filter((name) => /^\d+$/.test(name))) {
    let fds = [];
    try { fds = readdirSync(`/proc/${pid}/fd`); } catch { continue; }
    for (const fd of fds) {
      let link = null;
      try { link = readlinkSync(`/proc/${pid}/fd/${fd}`); } catch { continue; }
      if (inodes.has(link)) {
        let command = null;
        try { command = readFileSync(`/proc/${pid}/comm`, 'utf8').trim(); } catch { /* exited */ }
        return { pid: Number(pid), command };
      }
    }
  }
  return { pid: null, command: null };
}

/** False when `port` is free, true when ao's own server is on it. Throws TOPOLOGY_NATS_PORT_CONFLICT otherwise. */
export async function checkNatsPort(port, env = process.env) {
  if (await canBind(port)) return false;
  if ((await natsInfo(port))?.server_name === SERVER_NAME) return true;
  const holder = portHolder(port);
  const who = holder?.pid ? `${holder.command ?? 'a process'} (pid ${holder.pid})` : holder ? 'a process this user cannot inspect' : 'another process';
  return fail('TOPOLOGY_NATS_PORT_CONFLICT', `ao's NATS port 127.0.0.1:${port} (nats.port in ${globalConfigPath(configHome(env), env)}) is held by ${who}. `
    + 'ao does not move to another port: stop that process, or set a different nats.port and run `agent-orchestration services ensure`.', { port, holder });
}

const configHome = (env) => env.HOME || homedir();

/** nats.port as configured, without choosing one: a number, or null when unset or invalid. */
export async function configuredNatsPort(env = process.env) {
  const layer = await readConfigLayer('global', { env, home: configHome(env) }).catch(() => null);
  const port = layer?.document?.nats?.port;
  return validNatsPort(port) ? port : null;
}

/**
 * nats.port from the user config. On the first managed start it is chosen and written: the port
 * state.json already records when it is free or ours (migration), else the first free one in
 * NATS_PORT_RANGE. Every later start uses exactly that value.
 */
export async function managedNatsPort({ env = process.env, natsHome = localNatsHome(env) } = {}) {
  const options = { env, home: configHome(env) };
  for (let attempt = 0; ; attempt += 1) {
    const layer = await readConfigLayer('global', options);
    if (layer.present && !layer.document) fail('TOPOLOGY_CONFIG_INVALID', layer.errors.join('; '));
    const configured = layer.document?.nats?.port;
    if (configured !== undefined) {
      if (!validNatsPort(configured)) fail('TOPOLOGY_CONFIG_INVALID', `nats.port in ${layer.path} must be an integer from 1024 to 65535; it is ${JSON.stringify(configured)}.`);
      return configured;
    }
    const recorded = readState(natsHome)?.port;
    const ours = async (port) => await canBind(port) || (await natsInfo(port))?.server_name === SERVER_NAME;
    let port = validNatsPort(recorded) && await ours(recorded) ? recorded : null;
    for (let p = NATS_PORT_RANGE[0]; !port && p <= NATS_PORT_RANGE[1]; p += 1) if (await canBind(p)) port = p;
    if (!port) fail('TOPOLOGY_NATS_UNAVAILABLE', `No free port in ${NATS_PORT_RANGE.join('-')} for ao's NATS; set nats.port in ${layer.path}.`);
    try {
      await writeConfigLayer('global', mergeConfig(layer.document ?? {}, { nats: { port } }), { ...options, ifRevision: layer.revision });
      return port;
    } catch (error) {
      // Another start wrote the file first: read what it chose.
      if (error?.code !== 'TOPOLOGY_CONFIG_STALE' || attempt >= 3) throw error;
    }
  }
}

export function serverConfig({ port, user, password, adminNkey = null, storeDir, agentUsers = [] }) {
  const allow = ['orch.>', '_INBOX.>', '$JS.API.>', '$JS.ACK.>', '$JS.FC.>', '$KV.>', '$O.>'];
  const list = allow.map((subject) => JSON.stringify(subject)).join(', ');
  return `listen: 127.0.0.1:${port}
server_name: ao-orch-local
jetstream { store_dir: ${JSON.stringify(storeDir)} }
accounts {
  ORCH {
    jetstream: enabled
    users = [ { ${adminNkey ? `nkey: ${adminNkey}` : `user: ${JSON.stringify(user)}, password: ${JSON.stringify(password)}`},
      permissions: { publish: { allow: [${list}] }, subscribe: { allow: [${list}] } } }${agentUsers.map((entry) => `,\n      ${renderAgentUser(entry)}`).join('')} ]
  }
}
`;
}

function unavailable(message) {
  const error = new Error(message);
  error.code = 'TOPOLOGY_NATS_UNAVAILABLE';
  return error;
}

const NO_BINARY = 'No working nats-server found. Set AO_NATS_SERVER, put one on PATH (the snap shim does not count), or set AO_TRANSPORT=file.';

/** state.json layout version. 1 = the password format (no stamp); 2 = nkey admin identity (TM-310). */
export const STATE_SCHEMA = 2;

function readState(home) {
  let state = null;
  try { state = JSON.parse(readFileSync(join(home, 'state.json'), 'utf8')); } catch { return null; }
  if (state?.schema > STATE_SCHEMA) throw unavailable(`${join(home, 'state.json')} is schema ${state.schema}; this agent-orchestration understands up to ${STATE_SCHEMA}. Upgrade this installation instead of letting it rewrite the file.`);
  return state;
}

/** Writes the server config and returns its path. Credentials are generated once and kept, so a
 * restart reuses the JetStream data they guard. */
async function writeServerConfig(home, { port, user, pass, adminPub = null }) {
  const confPath = join(home, 'nats-server.conf');
  const text = serverConfig({ port, user, password: pass, adminNkey: adminPub, storeDir: join(home, 'jetstream'), agentUsers: loadAgentUsers(home) });
  // TM-316: every config write in this module goes through here, so this is the one place the admin holder is told what
  // the file should say. Announced BEFORE the write: the watcher must never see a new file it was not told about.
  if (adminPub) {
    const pre = await requestSocket(socketPath(home, 'admin.sock'), { op: 'expect', conf: text, confPath }, 2000).catch(() => null);
    if (pre?.tampered) process.stderr.write(`[ao] WARNING: ${confPath} was changed by something other than ao; it is being rewritten (see ${join(home, 'tamper.jsonl')}).\n`);
  }
  await chmod(home, 0o700).catch(() => {}); // mode only keeps other users out; a same-uid process is what the watcher is for
  await writeFile(confPath, text, { mode: 0o600 });
  await chmod(confPath, 0o600);
  return confPath;
}

/** TM-310: re-render the config from state.json plus the current agent registry; the caller reloads the server. */
export async function rewriteServerConfig(home) {
  const state = readState(home);
  if (!state) throw unavailable(`No local NATS state in ${home}; nothing to rewrite.`);
  return writeServerConfig(home, { port: state.port, user: state.user, pass: state.pass, adminPub: state.adminPub });
}

/**
 * TM-310: the host identity is an nkey whose seed exists only in a holder process's memory. The seed is
 * never on disk (state.json carries the PUBLIC key and the holder's socket path), and the holder gives it
 * only to a process outside every agent's tree. A legacy state with a password is migrated away.
 * Returns state with adminPub/adminSock; the caller rewrites the config when `changed`.
 */
export async function ensureAdminIdentity(home, state) {
  const sock = socketPath(home, 'admin.sock');
  // Ask the socket itself, not state.json: another process may own a live holder that this state does not name.
  const live = await holderIdentity(sock);
  if (live?.admin) {
    const same = state?.adminPub === live.publicKey && state?.adminSock === sock;
    const next = { ...state, adminPub: live.publicKey, adminSock: sock, adminPid: live.pid };
    delete next.user; delete next.pass;
    return { state: next, changed: !same, reused: true };
  }
  // Nothing answers: any file at the path is a stale leftover.
  try { await unlink(sock); } catch { /* none */ }
  const holder = await startHolder({}, { home, sock, admin: true });
  const next = { ...state, adminPub: holder.publicKey, adminSock: sock, adminPid: holder.pid };
  delete next.user; delete next.pass;
  return { state: next, changed: true };
}

/**
 * Under the lock, make sure the admin holder the server trusts is the one that is alive. If it changed (the holder died
 * and was replaced), rewrite the config and reload the running server so the new key is accepted.
 */
async function revalidateAdminLocked(home) {
  {
    const state = readState(home);
    if (!state) return state;
    const legacy = Boolean(state.user || state.pass);
    const { state: admin, changed, reused } = await ensureAdminIdentity(home, state);
    if (!changed) return state;
    // A live admin holder next to a password-format state.json means an older ao-topology rewrote the file after this version
    // had migrated it. It will do so again each time it runs; the older version has no schema check to stop it.
    if (legacy && reused) process.stderr.write(`[ao] WARNING: ${join(home, 'state.json')} was rewritten in the old password format by an older agent-orchestration (no schema stamp) sharing this home. Upgrade or stop it: it also restarts the NATS server. Repaired for now.\n`);
    // Upgrade from a version that stored a password: retire it. Processes it started still hold the password connection,
    // which the reload below drops; they need a restart to pick up the new identity.
    if (legacy) process.stderr.write(`[ao] local NATS: replaced the stored admin password with an nkey identity held in memory. Processes started by an earlier version lose their NATS connection until restarted.\n`);
    await writeState(home, admin);
    const confPath = await writeServerConfig(home, { port: admin.port, adminPub: admin.adminPub });
    const pid = serverPidFor(admin.pid, confPath);
    if (pid) { try { process.kill(pid, 'SIGHUP'); } catch { /* gone */ } await new Promise((resolve) => setTimeout(resolve, 300)); }
    return admin;
  }
}
const revalidateAdmin = (home) => withLock(join(home, 'lock'), () => revalidateAdminLocked(home));

async function writeState(home, state) {
  const statePath = join(home, 'state.json');
  await writeFile(statePath, JSON.stringify({ ...state, schema: STATE_SCHEMA }), { mode: 0o600 });
  await chmod(statePath, 0o600);
}

/** A PATH name is useless to a service manager whose PATH is not ours, so resolve it once here. */
function absoluteBinary(bin, env) {
  if (isAbsolute(bin)) return bin;
  for (const dir of String(env.PATH || '').split(delimiter).filter(Boolean)) {
    const candidate = join(dir, bin);
    if (existsSync(candidate)) return candidate;
  }
  return bin;
}

/** A pre-TM-272 detached server (or one on a port nats.port no longer names) holding the store is
 * stopped first, because two servers on one JetStream store_dir corrupt it. Only a pid we recorded. */
async function stopDetached(state, keepPort = null) {
  if (!state || state.managed || !state.pid || state.port === keepPort) return;
  if (!(await canConnect(state.port)) || !namesNatsServer(state.pid)) return;
  try { process.kill(state.pid, 'SIGTERM'); } catch { /* already gone */ }
  for (let i = 0; i < 50 && await canConnect(state.port); i += 1) await new Promise((resolve) => setTimeout(resolve, 100));
}

/**
 * TM-272: the config a process manager runs, without starting anything. Returns null when no
 * working nats-server exists. The port is nats.port (TM-308), so the generated process definition
 * is stable across ensures and reboots; a port held by another process throws
 * TOPOLOGY_NATS_PORT_CONFLICT.
 */
export async function prepareLocalNats({ env = process.env } = {}) {
  const home = localNatsHome(env);
  await mkdir(home, { recursive: true, mode: 0o700 });
  return withLock(join(home, 'lock'), async () => {
    const bin = await findNatsServer(env);
    if (!bin) return null;
    const state = readState(home);
    await stopDetached(state);
    const port = await managedNatsPort({ env, natsHome: home });
    await checkNatsPort(port, env);
    const { state: admin, changed } = await ensureAdminIdentity(home, { adminPub: state?.adminPub, adminSock: state?.adminSock });
    const confPath = await writeServerConfig(home, { port, adminPub: admin.adminPub });
    const absolute = absoluteBinary(bin, env);
    await writeState(home, { managed: true, pid: null, port, bin: absolute, adminPub: admin.adminPub, adminSock: admin.adminSock, adminPid: admin.adminPid });
    // A new admin key means the running server still trusts the old one: reload it.
    if (changed && await canConnect(port)) { const pid = serverPidFor(null, confPath); if (pid) process.kill(pid, 'SIGHUP'); }
    return { bin: absolute, args: ['-c', confPath], confPath, port, adminSock: admin.adminSock, home, log: join(home, 'nats-server.log') };
  });
}

// ponytail: cmdline is Linux-only; elsewhere a recorded pid is trusted only when its port answers.
function namesNatsServer(pid) {
  try { return readFileSync(`/proc/${pid}/cmdline`, 'utf8').includes('nats-server'); }
  catch { return process.platform !== 'linux'; }
}

async function waitForPort(port, attempts = 50) {
  for (let i = 0; i < attempts && !(await canConnect(port)); i += 1) await new Promise((resolve) => setTimeout(resolve, 100));
  return canConnect(port);
}

/** Returns { servers, user, pass, port, started } or throws TOPOLOGY_NATS_UNAVAILABLE / TOPOLOGY_NATS_PORT_CONFLICT. Idempotent and safe under concurrency. */
export async function ensureLocalNats({ env = process.env } = {}) {
  const home = localNatsHome(env);
  await mkdir(home, { recursive: true, mode: 0o700 });
  if (servicesEnabled(env)) {
    // TM-272: the managed services own the server. A process the manager started must not ask the
    // manager to start it again, so it only waits; anyone else runs `services ensure` once.
    const port = await managedNatsPort({ env, natsHome: home });
    let state = readState(home);
    const up = async () => state?.managed && state.port === port && await checkNatsPort(port, env);
    if (!(await up()) && env.AGENT_ORCHESTRATION_SERVICES_MANAGED !== '1') {
      await runServicesEnsure({ env });
      state = readState(home);
    }
    if (state?.managed && state.port === port && await waitForPort(port) && await up()) {
      state = await revalidateAdmin(home) ?? state;
      return { servers: `nats://127.0.0.1:${port}`, user: state.user, pass: state.pass, adminSock: state.adminSock, port, started: false, managed: true };
    }
    // TM-277: a managed process that finds the managed server down is watching the manager restart
    // it. Starting a detached server here would put a second server on the same JetStream store and
    // rewrite state.json away from the managed port; the caller retries on its next tick instead.
    if (env.AGENT_ORCHESTRATION_SERVICES_MANAGED === '1') throw unavailable(`The managed nats-server on port ${port} is not answering; the service manager is expected to restart it.`);
    // Services could not bring it up (no binary, offline install, no service manager): fall
    // through to the detached server below rather than failing the transport.
  }
  return withLock(join(home, 'lock'), async () => {
    const port = await managedNatsPort({ env, natsHome: home });
    let state = readState(home);
    await stopDetached(state, port);
    if (await checkNatsPort(port, env)) {
      if (state?.port === port && (state.adminSock || state.user)) {
        state = (await revalidateAdminLocked(home)) ?? state;
        return { servers: `nats://127.0.0.1:${port}`, user: state.user, pass: state.pass, adminSock: state.adminSock, port, started: false };
      }
      throw unavailable(`An ao nats-server answers on 127.0.0.1:${port} but ${join(home, 'state.json')} holds no credentials for it.`);
    }
    // A manager owns this server (state.managed): a CLI that finds it down is watching the manager restart it. Starting a detached
    // one beside it is what produced a new server on a new port every few seconds, each stopped by the manager's next tick.
    if (state?.managed && servicesEnabled(env)) throw unavailable(`The managed nats-server on port ${port} is not answering; the service manager is expected to restart it.`);
    // Services are off in this process's view but state says a manager ran here: give a manager that is mid-start a moment before starting a second server.
    if (state?.managed && await waitForPort(port, 30)) return { servers: `nats://127.0.0.1:${port}`, adminSock: state.adminSock, port, started: false, managed: true };
    const bin = await findNatsServer(env);
    if (!bin) throw unavailable(NO_BINARY);
    const { state: admin } = await ensureAdminIdentity(home, { adminPub: state?.adminPub, adminSock: state?.adminSock });
    const confPath = await writeServerConfig(home, { port, adminPub: admin.adminPub });
    const log = openSync(join(home, 'nats-server.log'), 'a', 0o600);
    const child = spawn(bin, ['-c', confPath], { detached: true, stdio: ['ignore', log, log] });
    child.unref();
    if (!(await waitForPort(port))) throw unavailable(`nats-server (${bin}) did not open 127.0.0.1:${port}; see ${join(home, 'nats-server.log')}`);
    // `managed` is kept as found: dropping it made the manager's next tick treat this server as a stray and stop it.
    await writeState(home, { ...(state?.managed ? { managed: true } : {}), pid: child.pid, port, bin, adminPub: admin.adminPub, adminSock: admin.adminSock, adminPid: admin.adminPid });
    return { servers: `nats://127.0.0.1:${port}`, adminSock: admin.adminSock, port, started: true };
  });
}

export const localNatsEnabled = (env = process.env) => env.AO_NATS_AUTOSTART !== '0' && !env.AO_NATS_URL;
