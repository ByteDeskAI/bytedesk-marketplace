// TM-308 / ADR-0032: managed NATS runs on nats.port from the developer's ao user config — chosen
// once, kept across starts and process-compose re-renders, never moved when something else holds
// it — and the generic NATS_URL is not an ao source. Every path here is a temp dir; any real
// nats-server is started by the code under test and killed by the pid it recorded.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync } from 'node:fs';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import net from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { run } from '../../topology/lib/util.mjs';
import { validateConfigShape } from '../../topology/lib/config.mjs';
import { NATS_PORT_RANGE, ensureLocalNats, findNatsServer, managedNatsPort, prepareLocalNats } from '../../topology/lib/nats-local.mjs';
import { closeLiveTransports, ignoredNatsEnv, readTransportState, resolveTransport } from '../../topology/lib/orch-transport.mjs';
import { natsOutageTick } from '../../topology/lib/nats-outage.mjs';
import { renderProject, servicesStatus } from '../../src/services/services.mjs';

const pluginRoot = dirname(dirname(dirname(fileURLToPath(import.meta.url))));

async function fixture(t, prefix, extra = {}) {
  const root = await mkdtemp(join(tmpdir(), prefix));
  const home = join(root, 'home'), natsHome = join(root, 'nats-home'), repo = join(root, 'repo');
  mkdirSync(home, { recursive: true });
  const env = { ...process.env, TMUX: '', TMUX_TMPDIR: join(root, 'tmux'), HOME: home, XDG_CONFIG_HOME: join(home, '.config'),
    AGENT_ORCHESTRATION_STATE_HOME: join(root, 'state'), AGENT_ORCHESTRATION_SERVICES: '0', AO_NATS_HOME: natsHome,
    AO_TRANSPORT: 'nats', AO_ORCH_SOCKET: join(root, 'no-orch.sock'), ...extra };
  for (const key of ['AO_NATS_URL', 'AO_NATS_AUTOSTART', 'NATS_URL', 'NATS_USER', 'NATS_PASSWORD']) if (!(key in extra)) delete env[key];
  t.after(async () => {
    await closeLiveTransports();
    try { const { pid } = JSON.parse(readFileSync(join(natsHome, 'state.json'), 'utf8')); if (pid) process.kill(pid, 'SIGKILL'); } catch { /* none started */ }
    await rm(root, { recursive: true, force: true });
  });
  const configPath = join(home, '.config', 'agent-orchestration', 'config.json');
  const config = async () => JSON.parse(await readFile(configPath, 'utf8'));
  return { root, home, natsHome, repo, env, configPath, config };
}

const inAoRange = (port) => (port >= 45000 && port <= 45032) || (port >= 45100 && port <= 45199);

function listen(port = 0) {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => resolve(server));
  });
}

test('nats.port validation rejects 80, 70000 and "abc", and accepts 45200', async t => {
  for (const port of [80, 70000, 'abc', 1023.5]) {
    assert.match(validateConfigShape({ nats: { port } }, 'c.json').join(';'), /"nats\.port" must be an integer from 1024 to 65535/, String(port));
  }
  assert.deepEqual(validateConfigShape({ nats: { port: 45200, domain: 'hub' } }, 'c.json'), []);
  const f = await fixture(t, 'ao-nats-port-valid-');
  mkdirSync(dirname(f.configPath), { recursive: true });
  await writeFile(f.configPath, JSON.stringify({ nats: { port: 80 } }));
  await assert.rejects(managedNatsPort({ env: f.env }), { code: 'TOPOLOGY_CONFIG_INVALID', message: /nats\.port/ });
});

test('first managed start writes nats.port in the high range; later starts and a re-rendered project reuse it', { timeout: 60_000 }, async t => {
  const bin = await findNatsServer({ ...process.env, AO_NATS_SERVER: process.env.AO_NATS_SERVER ?? '' });
  if (!bin) { t.skip('no working nats-server binary'); return; }
  const f = await fixture(t, 'ao-nats-port-first-', { AO_NATS_SERVER: bin });
  mkdirSync(dirname(f.configPath), { recursive: true });
  await writeFile(f.configPath, JSON.stringify({ lead: { template: 'mine' } }));

  const first = await ensureLocalNats({ env: f.env });
  assert.equal(first.started, true);
  const written = await f.config();
  assert.equal(written.nats.port, first.port, 'the chosen port is written to the user config');
  assert.equal(written.lead.template, 'mine', 'other keys are preserved');
  assert.ok(first.port >= NATS_PORT_RANGE[0] && first.port <= NATS_PORT_RANGE[1], `port ${first.port} in range`);
  assert.equal(inAoRange(first.port), false);

  const second = await ensureLocalNats({ env: f.env });
  assert.deepEqual([second.started, second.port], [false, first.port], 'a second start reuses the running server on that port');

  // The services path: a process-compose render after a restart or reboot uses exactly that port.
  process.kill(JSON.parse(readFileSync(join(f.natsHome, 'state.json'), 'utf8')).pid, 'SIGKILL');
  await new Promise(resolve => setTimeout(resolve, 300));
  for (let i = 0; i < 2; i += 1) {
    const prepared = await prepareLocalNats({ env: f.env });
    assert.equal(prepared.port, first.port);
    assert.match(readFileSync(prepared.confPath, 'utf8'), new RegExp(`listen: 127\\.0\\.0\\.1:${first.port}\\n`));
    const { project } = renderProject({ platform: 'linux', node: process.execPath, launcher: '/l', stateRoot: f.root, logs: f.root, nats: prepared, repos: [] });
    assert.deepEqual(project.processes.nats.entrypoint, [prepared.bin, '-c', prepared.confPath]);
  }
  assert.equal((await f.config()).nats.port, first.port, 'nats.port never moves');
});

test('a nats.port held by another process is refused with the holder named, reported in status, doctor and to the lead', { timeout: 60_000 }, async t => {
  const f = await fixture(t, 'ao-nats-port-held-');
  await run('git', ['init', '-q', f.repo]);
  mkdirSync(join(f.repo, '.bytedesk', 'agent-orchestration'), { recursive: true });
  await writeFile(join(f.repo, '.bytedesk', 'agent-orchestration', 'config.json'), '{"enabled":false}\n');
  const holder = await listen();
  t.after(() => holder.close());
  const { port } = holder.address();
  mkdirSync(dirname(f.configPath), { recursive: true });
  await writeFile(f.configPath, JSON.stringify({ nats: { port } }));

  const refused = await resolveTransport({ env: f.env }).catch(error => error);
  assert.equal(refused.code, 'TOPOLOGY_NATS_PORT_CONFLICT');
  assert.match(refused.message, new RegExp(`127\\.0\\.0\\.1:${port}`));
  if (process.platform === 'linux') assert.match(refused.message, new RegExp(`\\(pid ${process.pid}\\)`), 'the holder is named');
  assert.throws(() => readFileSync(join(f.natsHome, 'state.json')), { code: 'ENOENT' }, 'no NATS was started anywhere');
  assert.equal((await f.config()).nats.port, port, 'the configured port is not replaced');

  const state = await readTransportState(f.env, f.home);
  assert.equal(state.outage.conflict.port, port);
  const { doctor } = await import('../../topology/lib/doctor.mjs');
  const report = await doctor({ adapters: new Map(), workflowDirs: [], skillDirs: [], roleDirs: [], providerDirs: [], consumer: f.repo, env: f.env, home: f.home });
  assert.ok(report.problems.some(p => p.code === 'NATS_PORT_CONFLICT' && p.message.includes(String(port))), 'doctor names the conflict');
  const status = await servicesStatus({ pluginRoot, stateRoot: join(f.root, 'svc'), env: f.env, home: f.home, platform: 'linux', deps: { mode: 'detached', lock: {} } });
  assert.equal(status.nats.port, port);
  assert.match(status.nats.conflict.message, new RegExp(String(port)), 'services status shows the conflict live');

  const mail = [], probed = [];
  const sent = await natsOutageTick({ consumer: f.repo, env: f.env, home: f.home, lead: async () => ({ record: { agent_id: 'lead-1' } }),
    deliver: async (input) => { mail.push(input); return { status: 'sent' }; }, reachable: async (url) => { probed.push(url); return true; } });
  assert.equal(sent.kind, 'outage');
  assert.equal(mail.length, 1, 'the lead is told through the ADR-0031 outage path');
  assert.match(mail[0].subject, /NATS port conflict/);
  assert.match(mail[0].body, new RegExp(`port ${port} is held`));
  assert.deepEqual(probed, [], 'a conflict is not re-dialled');
});

test('NATS_URL is not an ao source: an unreachable one causes no fallback and no outage, and is named once as ignored', { timeout: 60_000 }, async t => {
  const bin = await findNatsServer({ ...process.env, AO_NATS_SERVER: process.env.AO_NATS_SERVER ?? '' });
  if (!bin) { t.skip('no working nats-server binary'); return; }
  const f = await fixture(t, 'ao-nats-port-ambient-', { AO_NATS_SERVER: bin, NATS_URL: 'nats://localhost:1', NATS_USER: 'someone' });
  await run('git', ['init', '-q', f.repo]);
  const opened = await resolveTransport({ env: f.env });
  assert.equal(opened.selection.source, 'managed-local');
  assert.equal(opened.selection.fallback, null, 'no fallback warning');
  assert.equal(opened.selection.url, `nats://127.0.0.1:${(await f.config()).nats.port}`);
  assert.equal((await readTransportState(f.env, f.home)).outage, null);
  const mail = [];
  assert.equal(await natsOutageTick({ consumer: f.repo, env: f.env, home: f.home, lead: async () => ({ record: { agent_id: 'lead-1' } }),
    deliver: async (input) => { mail.push(input); return { status: 'sent' }; } }), null, 'no outage report');
  assert.equal(mail.length, 0);
  const ignored = ignoredNatsEnv(f.env);
  assert.deepEqual(ignored.variables, ['NATS_URL', 'NATS_USER']);
  assert.match(ignored.message, /ignored/);
  assert.equal(ignoredNatsEnv({ AO_NATS_URL: 'nats://x:1' }), null, 'nothing to say without the generic variables');
});

test('migration adopts a free state.json port; an invalid or foreign-held one is not adopted', async t => {
  const f = await fixture(t, 'ao-nats-port-migrate-');
  mkdirSync(f.natsHome, { recursive: true });
  const spare = await listen();
  const { port: recorded } = spare.address();
  await new Promise(resolve => spare.close(resolve));
  await writeFile(join(f.natsHome, 'state.json'), JSON.stringify({ managed: true, pid: null, port: recorded, user: 'ao-orch', pass: 'p' }), { mode: 0o600 });
  assert.equal(await managedNatsPort({ env: f.env }), recorded);
  assert.equal((await f.config()).nats.port, recorded, 'adopted into the user config');

  await rm(f.configPath);
  const held = await listen();
  t.after(() => held.close());
  await writeFile(join(f.natsHome, 'state.json'), JSON.stringify({ managed: true, pid: null, port: held.address().port, user: 'ao-orch', pass: 'p' }), { mode: 0o600 });
  const chosen = await managedNatsPort({ env: f.env });
  assert.notEqual(chosen, held.address().port, 'a held state port is not adopted');
  assert.ok(chosen >= NATS_PORT_RANGE[0] && chosen <= NATS_PORT_RANGE[1]);

  await rm(f.configPath);
  await writeFile(join(f.natsHome, 'state.json'), JSON.stringify({ managed: true, pid: null, port: 80 }), { mode: 0o600 });
  assert.ok((await managedNatsPort({ env: f.env })) >= NATS_PORT_RANGE[0], 'a port below 1024 is not adopted');
});
