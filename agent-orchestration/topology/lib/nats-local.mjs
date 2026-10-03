// Local NATS fallback: when no gateway listener and no explicit server is reachable, start one
// JetStream nats-server for this user, detached, and hand back its URL and credentials.
//
// Security posture: loopback only, random port, one generated user whose password lives in a 0600
// file, no system account (so no $SYS access), permissions limited to the orch subject space plus
// the JetStream/KV API the transport needs. It is a single-user dev fallback, not the gateway's
// per-agent credential model (docs/contracts/orch-listener.md).
// TM-310: that shared user is now the HOST user only (supervisor, router). Agents are nkey users added
// through agent-creds.mjs (public keys in agent-users.json, narrowed permissions per agent).
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync, openSync, readFileSync } from 'node:fs';
import { chmod, mkdir, writeFile } from 'node:fs/promises';
import net from 'node:net';
import { homedir } from 'node:os';
import { delimiter, isAbsolute, join } from 'node:path';
import { loadAgentUsers, renderAgentUser } from './agent-creds.mjs';
import { withLock } from './lockfile.mjs';
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

function freePort() {
  return new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.once('error', reject);
    probe.listen(0, '127.0.0.1', () => { const { port } = probe.address(); probe.close(() => resolve(port)); });
  });
}

export function serverConfig({ port, user, password, storeDir, agentUsers = [] }) {
  const allow = ['orch.>', '_INBOX.>', '$JS.API.>', '$JS.ACK.>', '$JS.FC.>', '$KV.>', '$O.>'];
  const list = allow.map((subject) => JSON.stringify(subject)).join(', ');
  return `listen: 127.0.0.1:${port}
server_name: ao-orch-local
jetstream { store_dir: ${JSON.stringify(storeDir)} }
accounts {
  ORCH {
    jetstream: enabled
    users = [ { user: ${JSON.stringify(user)}, password: ${JSON.stringify(password)},
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

function readState(home) {
  try { return JSON.parse(readFileSync(join(home, 'state.json'), 'utf8')); } catch { return null; }
}

/** Writes the server config and returns its path. Credentials are generated once and kept, so a
 * restart reuses the JetStream data they guard. */
async function writeServerConfig(home, { port, user, pass }) {
  const confPath = join(home, 'nats-server.conf');
  await writeFile(confPath, serverConfig({ port, user, password: pass, storeDir: join(home, 'jetstream'), agentUsers: loadAgentUsers(home) }), { mode: 0o600 });
  await chmod(confPath, 0o600);
  return confPath;
}

/** TM-310: re-render the config from state.json plus the current agent registry; the caller reloads the server. */
export async function rewriteServerConfig(home) {
  const state = readState(home);
  if (!state) throw unavailable(`No local NATS state in ${home}; nothing to rewrite.`);
  return writeServerConfig(home, { port: state.port, user: state.user, pass: state.pass });
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

/**
 * TM-272: the config a process manager runs, without starting anything. Returns null when no
 * working nats-server exists. The port is kept across calls so the generated process definition is
 * stable; a pre-TM-272 detached server still holding the port and store is stopped first, because
 * two servers on one JetStream store_dir corrupt it.
 */
export async function prepareLocalNats({ env = process.env } = {}) {
  const home = localNatsHome(env);
  await mkdir(home, { recursive: true, mode: 0o700 });
  return withLock(join(home, 'lock'), async () => {
    const bin = await findNatsServer(env);
    if (!bin) return null;
    const state = readState(home);
    if (state && !state.managed && state.pid && await canConnect(state.port) && namesNatsServer(state.pid)) {
      try { process.kill(state.pid, 'SIGTERM'); } catch { /* already gone */ }
      for (let i = 0; i < 50 && await canConnect(state.port); i += 1) await new Promise((resolve) => setTimeout(resolve, 100));
    }
    const user = state?.user || 'ao-orch';
    const pass = state?.pass || randomBytes(24).toString('hex');
    const port = state?.managed && state.port ? state.port : await freePort();
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

/** Returns { servers, user, pass, port, started } or throws TOPOLOGY_NATS_UNAVAILABLE. Idempotent and safe under concurrency. */
export async function ensureLocalNats({ env = process.env } = {}) {
  if (servicesEnabled(env)) {
    // TM-272: the managed services own the server. A process the manager started must not ask the
    // manager to start it again, so it only waits; anyone else runs `services ensure` once.
    const home = localNatsHome(env);
    let state = readState(home);
    if (!(state?.managed && await canConnect(state.port)) && env.AGENT_ORCHESTRATION_SERVICES_MANAGED !== '1') {
      await runServicesEnsure({ env });
      state = readState(home);
    }
    if (state?.managed && await waitForPort(state.port)) {
      return { servers: `nats://127.0.0.1:${state.port}`, user: state.user, pass: state.pass, port: state.port, started: false, managed: true };
    }
    // TM-277: a managed process that finds the managed server down is watching the manager restart
    // it. Starting a detached server here would put a second server on the same JetStream store and
    // rewrite state.json away from the managed port; the caller retries on its next tick instead.
    if (env.AGENT_ORCHESTRATION_SERVICES_MANAGED === '1') throw unavailable(`The managed nats-server on port ${state?.port ?? 'unknown'} is not answering; the service manager is expected to restart it.`);
    // Services could not bring it up (no binary, offline install, no service manager): fall
    // through to the detached server below rather than failing the transport.
  }
  const home = localNatsHome(env);
  await mkdir(home, { recursive: true, mode: 0o700 });
  return withLock(join(home, 'lock'), async () => {
    const state = readState(home);
    if (state && await canConnect(state.port)) {
      return { servers: `nats://127.0.0.1:${state.port}`, user: state.user, pass: state.pass, port: state.port, started: false };
    }
    const bin = await findNatsServer(env);
    if (!bin) throw unavailable(NO_BINARY);
    const user = state?.user || 'ao-orch';
    const pass = state?.pass || randomBytes(24).toString('hex');
    const port = await freePort();
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
