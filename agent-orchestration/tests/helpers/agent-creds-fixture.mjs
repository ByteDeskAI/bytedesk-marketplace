// Shared fixture for the per-agent credential tests: a temp nats-server started from the REAL local
// config path (prepareLocalNats), whose host identity is the admin holder's nkey and whose agents are
// issued through CredStore. Nothing here reads a password, because none exists.
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import { join } from 'node:path';
import { natsServerBin } from './nats-server.mjs';
import { CredStore } from '../../topology/lib/agent-creds.mjs';
import { prepareLocalNats } from '../../topology/lib/nats-local.mjs';
import { ORCH_LAYOUT, openNatsTransport } from '../../topology/lib/orch-transport.mjs';

for (const name of ['AO_NATS_URL', 'NATS_URL', 'AO_CREDS_SOCK', 'AO_ORCH_SOCKET', 'AO_ORCH_CREDS']) delete process.env[name];
export const nats = await import('nats');
export const REPO = 'repoK';
export const enc = new TextEncoder();

export async function startServer({ agents = ['agentA', 'agentB', 'boss'] } = {}) {
  const home = await mkdtemp(join(os.tmpdir(), 'ao-creds-home-'));
  const bin = await natsServerBin();
  const hostEnv = { ...process.env, AO_NATS_HOME: home, AO_NATS_SERVER: bin, AO_NATS_AUTOSTART: '1', AGENT_ORCHESTRATION_SERVICES: '0' };
  const prepared = await prepareLocalNats({ env: hostEnv });
  const child = spawn(bin, prepared.args, { stdio: ['ignore', 'ignore', 'ignore'] });
  const url = `nats://127.0.0.1:${prepared.port}`;
  for (let i = 0; i < 100; i += 1) {
    const up = await new Promise((resolve) => { const s = net.connect(prepared.port, '127.0.0.1', () => { s.destroy(); resolve(true); }); s.once('error', () => resolve(false)); });
    if (up) break;
    await new Promise((r) => setTimeout(r, 50));
  }
  const store = new CredStore({ home, serverPid: child.pid, graceMs: 120_000 });
  // The host reaches the server through the real transport path: local state -> admin holder -> nkey.
  const transport = await openNatsTransport({ env: hostEnv, name: 'ao-test-host' });
  const admin = transport.nc;
  const jsm = await admin.jetstreamManager();
  const js = admin.jetstream();
  await transport.ensure({ repo: REPO, agents, replies: agents });
  const state = JSON.parse(readFileSync(join(home, 'state.json'), 'utf8'));
  return { home, port: prepared.port, url, child, store, transport, admin, jsm, js, conf: prepared.confPath, hostEnv, state,
    async stop() {
      await transport.close().catch(() => {});
      child.kill('SIGKILL');
      try { process.kill(state.adminPid, 'SIGKILL'); } catch { /* gone */ }
      await rm(home, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
    } };
}

/** An agent connection that records every server -ERR (a publish violation is only ever reported there). */
export async function connectAgent(server, issued, { retries = 0 } = {}) {
  const refusals = [];
  for (let attempt = 0; ; attempt += 1) {
    try {
      const nc = await nats.connect({ servers: server.url, authenticator: nats.nkeyAuthenticator(enc.encode(issued.seed)), inboxPrefix: issued.inboxPrefix,
        maxReconnectAttempts: 0, timeout: 3000, name: issued.agent });
      (async () => { for await (const status of nc.status()) if (status.type === 'error') refusals.push(String(status.error?.message ?? status.data)); })();
      return { nc, refusals };
    } catch (error) {
      // SIGHUP is asynchronous: a key issued a moment ago may not be loaded yet. Only fixture setup retries; a revoked-key probe must not.
      if (attempt >= retries) throw error;
      await new Promise((resolve) => setTimeout(resolve, 150));
    }
  }
}

/** Run an operation; report whether it succeeded and every refusal text the server produced. */
export async function attempt({ nc, refusals }, operation) {
  const before = refusals.length;
  try { await operation(nc); } catch (error) { refusals.push(`thrown: ${error.message}`); }
  await new Promise((r) => setTimeout(r, 150));
  const text = refusals.slice(before);
  return { ok: text.length === 0, refusal: text.join(' | ') };
}


const lib = (name) => JSON.stringify(new URL(`../../topology/lib/${name}`, import.meta.url).href);

/**
 * Run `body` as an agent: a child process whose only credential is AO_CREDS_SOCK. The holder is attached to
 * the child before it is told to go, so the child is "inside the agent's tree" exactly as a pane process is.
 * `body` sees: t (transport), step(name, fn), and the real modules. Returns { results, stdout, stderr }.
 */
export async function asAgent(server, holder, body, { env = {} } = {}) {
  const source = `
import { openNatsTransport } from ${lib('orch-transport.mjs')};
import { handoff } from ${lib('handoff.mjs')};
import { claimFenced, writeFenced } from ${lib('claims-fenced.mjs')};
import { publishWork, takeWork } from ${lib('work-queue.mjs')};
import { diagnose, readRepoEvents } from ${lib('events.mjs')};
await new Promise((resolve) => process.stdin.once('data', resolve));
const t = await openNatsTransport({ servers: ${JSON.stringify(server.url)}, env: process.env, name: 'agent' });
const refusals = [];
(async () => { for await (const s of t.nc.status()) if (s.type === 'error') refusals.push(String(s.error?.message ?? s.data)); })();
const results = {};
const step = async (name, fn) => {
  const before = refusals.length;
  try { results[name] = { ok: true, value: await fn() }; } catch (e) { results[name] = { ok: false, error: String(e.message).slice(0, 200) }; }
  await new Promise((r) => setTimeout(r, 100));
  results[name].refusals = refusals.slice(before);
};
${body}
console.log('RESULT ' + JSON.stringify(results));
await t.close().catch(() => {});
process.exit(0);`;
  const child = spawn(process.execPath, ['--input-type=module', '-e', source], {
    env: { PATH: process.env.PATH, HOME: server.home, AO_CREDS_SOCK: holder.sock, AO_TRANSPORT: 'nats', ...env }, stdio: ['pipe', 'pipe', 'pipe'] });
  let stdout = ''; let stderr = '';
  child.stdout.on('data', (c) => { stdout += c; }); child.stderr.on('data', (c) => { stderr += c; });
  await holder.attach(child.pid);
  child.stdin.write('go\n');
  await new Promise((resolve) => child.on('exit', resolve));
  const line = stdout.split('\n').find((l) => l.startsWith('RESULT '));
  if (!line) throw new Error(`agent produced no result: ${stdout} ${stderr.slice(0, 500)}`);
  return { results: JSON.parse(line.slice(7)), stdout, stderr };
}

/** "The protection removed": give one agent key everything, in place of its narrowed entry, and reload. */
export async function openUpPermissions(server, issued, { serverConfig, loadAgentUsers }) {
  const state = JSON.parse(readFileSync(join(server.home, 'state.json'), 'utf8'));
  const open = `{ nkey: ${issued.publicKey}, permissions: { publish: { allow: [">"] }, subscribe: { allow: [">"] } } }`;
  const base = serverConfig({ port: state.port, adminNkey: state.adminPub, storeDir: join(server.home, 'jetstream'),
    agentUsers: loadAgentUsers(server.home).filter((entry) => entry.publicKey !== issued.publicKey) });
  const { writeFile } = await import('node:fs/promises');
  await writeFile(server.conf, base.replace('users = [ ', `users = [ ${open}, `));
  server.child.kill('SIGHUP');
  await new Promise((r) => setTimeout(r, 500));
}
