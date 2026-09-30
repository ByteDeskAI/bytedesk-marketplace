// Local NATS fallback: when no gateway listener and no explicit server is reachable, start one
// JetStream nats-server for this user, detached, and hand back its URL and credentials.
//
// Security posture: loopback only, random port, one generated user whose password lives in a 0600
// file, no system account (so no $SYS access), permissions limited to the orch subject space plus
// the JetStream/KV API the transport needs. It is a single-user dev fallback, not the gateway's
// per-agent credential model (docs/contracts/orch-listener.md).
// ponytail: one shared user for every agent; per-agent creds need the gateway's IssueOrch.
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { openSync, readFileSync } from 'node:fs';
import { chmod, mkdir, writeFile } from 'node:fs/promises';
import net from 'node:net';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { withLock } from './lockfile.mjs';

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

/** Returns { servers, user, pass, port, started } or throws TOPOLOGY_NATS_UNAVAILABLE. Idempotent and safe under concurrency. */
export async function ensureLocalNats({ env = process.env } = {}) {
  const home = localNatsHome(env);
  await mkdir(home, { recursive: true, mode: 0o700 });
  return withLock(join(home, 'lock'), async () => {
    const statePath = join(home, 'state.json');
    let state = null;
    try { state = JSON.parse(readFileSync(statePath, 'utf8')); } catch { /* first run */ }
    if (state && await canConnect(state.port)) {
      return { servers: `nats://127.0.0.1:${state.port}`, user: state.user, pass: state.pass, port: state.port, started: false };
    }
    const bin = await findNatsServer(env);
    if (!bin) {
      const error = new Error('No working nats-server found. Set AO_NATS_SERVER, put one on PATH (the snap shim does not count), or set AO_TRANSPORT=file.');
      error.code = 'TOPOLOGY_NATS_UNAVAILABLE';
      throw error;
    }
    // Credentials are generated once and kept, so a restart reuses the JetStream data they guard.
    const user = state?.user || 'ao-orch';
    const pass = state?.pass || randomBytes(24).toString('hex');
    const port = await freePort();
    const confPath = join(home, 'nats-server.conf');
    await writeFile(confPath, serverConfig({ port, user, password: pass, storeDir: join(home, 'jetstream') }), { mode: 0o600 });
    await chmod(confPath, 0o600);
    const log = openSync(join(home, 'nats-server.log'), 'a', 0o600);
    const child = spawn(bin, ['-c', confPath], { detached: true, stdio: ['ignore', log, log] });
    child.unref();
    for (let i = 0; i < 50 && !(await canConnect(port)); i += 1) await new Promise((resolve) => setTimeout(resolve, 100));
    if (!(await canConnect(port))) {
      const error = new Error(`nats-server (${bin}) did not open 127.0.0.1:${port}; see ${join(home, 'nats-server.log')}`);
      error.code = 'TOPOLOGY_NATS_UNAVAILABLE';
      throw error;
    }
    await writeFile(statePath, JSON.stringify({ pid: child.pid, port, user, pass, bin }), { mode: 0o600 });
    await chmod(statePath, 0o600);
    return { servers: `nats://127.0.0.1:${port}`, user, pass, port, started: true };
  });
}

export const localNatsEnabled = (env = process.env) => env.AO_NATS_AUTOSTART !== '0' && !env.AO_NATS_URL;
