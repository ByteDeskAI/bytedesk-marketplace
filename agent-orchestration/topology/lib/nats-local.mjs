// Local NATS fallback: when no gateway listener and no explicit server is reachable, start one
// JetStream nats-server for this user, detached, and hand back its URL and credentials.
//
// Port (TM-308 / ADR-0032): `nats.port` in the developer's ao user config, chosen once from what is
// free on this machine and never moved silently. A port held by something else is a refusal naming
// the holder, not a reason to pick another.
//
// Security posture: loopback only, one generated user whose password lives in a 0600
// file, no system account (so no $SYS access), permissions limited to the orch subject space plus
// the JetStream/KV API the transport needs. It is a single-user dev fallback, not the gateway's
// per-agent credential model (docs/contracts/orch-listener.md).
// ponytail: one shared user for every agent; per-agent creds need the gateway's IssueOrch.
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync, openSync, readFileSync, readdirSync, readlinkSync } from 'node:fs';
import { chmod, mkdir, writeFile } from 'node:fs/promises';
import net from 'node:net';
import { homedir } from 'node:os';
import { delimiter, isAbsolute, join } from 'node:path';
import { globalConfigPath, mergeConfig, readConfigLayer, writeConfigLayer } from './config.mjs';
import { withLock } from './lockfile.mjs';
import { fail } from './util.mjs';
import { runServicesEnsure, servicesEnabled } from './services-client.mjs';

export function localNatsHome(env = process.env) {
  return env.AO_NATS_HOME || join(homedir(), '.bytedesk', 'agent-orchestration', 'nats');
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

export function serverConfig({ port, user, password, storeDir }) {
  const allow = ['orch.>', '_INBOX.>', '$JS.API.>', '$JS.ACK.>', '$JS.FC.>', '$KV.>', '$O.>'];
  const list = allow.map((subject) => JSON.stringify(subject)).join(', ');
  return `listen: 127.0.0.1:${port}
server_name: ao-orch-local
jetstream { store_dir: ${JSON.stringify(storeDir)} }
accounts {
  ORCH {
    jetstream: enabled
    users = [ { user: ${JSON.stringify(user)}, password: ${JSON.stringify(password)},
      permissions: { publish: { allow: [${list}] }, subscribe: { allow: [${list}] } } } ]
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

function readState(home) {
  try { return JSON.parse(readFileSync(join(home, 'state.json'), 'utf8')); } catch { return null; }
}

/** Writes the server config and returns its path. Credentials are generated once and kept, so a
 * restart reuses the JetStream data they guard. */
async function writeServerConfig(home, { port, user, pass }) {
  const confPath = join(home, 'nats-server.conf');
  await writeFile(confPath, serverConfig({ port, user, password: pass, storeDir: join(home, 'jetstream') }), { mode: 0o600 });
  await chmod(confPath, 0o600);
  return confPath;
}

async function writeState(home, state) {
  const statePath = join(home, 'state.json');
  await writeFile(statePath, JSON.stringify(state), { mode: 0o600 });
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
    const user = state?.user || 'ao-orch';
    const pass = state?.pass || randomBytes(24).toString('hex');
    const confPath = await writeServerConfig(home, { port, user, pass });
    const absolute = absoluteBinary(bin, env);
    await writeState(home, { managed: true, pid: null, port, user, pass, bin: absolute });
    return { bin: absolute, args: ['-c', confPath], confPath, port, user, pass, home, log: join(home, 'nats-server.log') };
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
      return { servers: `nats://127.0.0.1:${port}`, user: state.user, pass: state.pass, port, started: false, managed: true };
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
    const state = readState(home);
    await stopDetached(state, port);
    if (await checkNatsPort(port, env)) {
      if (state?.port === port && state.user) return { servers: `nats://127.0.0.1:${port}`, user: state.user, pass: state.pass, port, started: false };
      throw unavailable(`An ao nats-server answers on 127.0.0.1:${port} but ${join(home, 'state.json')} holds no credentials for it.`);
    }
    const bin = await findNatsServer(env);
    if (!bin) throw unavailable(NO_BINARY);
    const user = state?.user || 'ao-orch';
    const pass = state?.pass || randomBytes(24).toString('hex');
    const confPath = await writeServerConfig(home, { port, user, pass });
    const log = openSync(join(home, 'nats-server.log'), 'a', 0o600);
    const child = spawn(bin, ['-c', confPath], { detached: true, stdio: ['ignore', log, log] });
    child.unref();
    if (!(await waitForPort(port))) throw unavailable(`nats-server (${bin}) did not open 127.0.0.1:${port}; see ${join(home, 'nats-server.log')}`);
    await writeState(home, { pid: child.pid, port, user, pass, bin });
    return { servers: `nats://127.0.0.1:${port}`, user, pass, port, started: true };
  });
}

export const localNatsEnabled = (env = process.env) => env.AO_NATS_AUTOSTART !== '0' && !env.AO_NATS_URL;
