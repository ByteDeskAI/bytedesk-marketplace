// TM-276 / ADR-0031: an unreachable configured NATS falls back to the managed local server AND is
// reported to the repository lead, once per outage plus once on recovery. Driven through the real
// connect path: a dead ambient NATS_URL, a real local fallback server, then a real server coming up
// on the configured port.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import net from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { run, sleep } from '../../topology/lib/util.mjs';
import { findNatsServer } from '../../topology/lib/nats-local.mjs';
import { closeLiveTransports, readTransportState, redactUrl, resolveTransport, transportStatePath } from '../../topology/lib/orch-transport.mjs';
import { natsOutageTick } from '../../topology/lib/nats-outage.mjs';
import { readStandingMessage } from '../../topology/lib/standing-mailbox.mjs';

function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => { const { port } = server.address(); server.close(() => resolve(port)); });
  });
}

async function untilConnect(port, deadlineMs = 10_000) {
  const until = Date.now() + deadlineMs;
  while (Date.now() < until) {
    const ok = await new Promise(resolve => {
      const socket = net.connect({ host: '127.0.0.1', port }, () => { socket.destroy(); resolve(true); });
      socket.once('error', () => resolve(false));
    });
    if (ok) return;
    await sleep(100);
  }
  throw new Error(`nats-server did not open port ${port}`);
}

test('redactUrl drops credentials and keeps host and port', () => {
  assert.equal(redactUrl('nats://user:secret@example.com:4222'), 'nats://example.com:4222');
  assert.equal(redactUrl(''), null);
});

test('a dead ambient NATS_URL falls back to managed local and mails the lead once, then once on recovery', { timeout: 60_000 }, async t => {
  const bin = await findNatsServer({ ...process.env, AO_NATS_SERVER: process.env.AO_NATS_SERVER ?? '' });
  if (!bin) { t.skip('no working nats-server binary'); return; }
  const root = await mkdtemp(join(tmpdir(), 'ao-nats-outage-'));
  const repo = join(root, 'repo'), home = join(root, 'home'), natsHome = join(root, 'nats-home');
  await run('git', ['init', '-q', repo]);
  // Opt the temp repo out of enrollment so nothing can start a real provider lead.
  mkdirSync(join(repo, '.bytedesk', 'agent-orchestration'), { recursive: true });
  await writeFile(join(repo, '.bytedesk', 'agent-orchestration', 'config.json'), '{"enabled":false}\n');
  const configuredPort = await freePort();
  const configured = `nats://127.0.0.1:${configuredPort}`;
  const env = { ...process.env, TMUX: '', TMUX_TMPDIR: join(root, 'tmux'), HOME: home, XDG_CONFIG_HOME: join(home, '.config'),
    AGENT_ORCHESTRATION_STATE_HOME: join(root, 'state'), AGENT_ORCHESTRATION_SERVICES: '0', AO_NATS_HOME: natsHome,
    AO_NATS_SERVER: bin, AO_TRANSPORT: 'nats', NATS_URL: configured, AO_NATS_URL: '', AO_ORCH_SOCKET: join(root, 'no-orch.sock') };
  delete env.AO_NATS_URL;
  delete env.AO_NATS_AUTOSTART;
  let broker = null;
  t.after(async () => {
    await closeLiveTransports();
    if (broker && broker.exitCode === null) broker.kill('SIGKILL');
    // The fallback server ensureLocalNats started for this test, by the pid it recorded.
    try { process.kill(JSON.parse(readFileSync(join(natsHome, 'state.json'), 'utf8')).pid, 'SIGKILL'); } catch { /* gone */ }
    await rm(root, { recursive: true, force: true });
  });
  const mail = [];
  const lead = async () => ({ record: { agent_id: 'lead-1' } });
  const deliver = async (input, options) => {
    mail.push(input);
    const { sendStandingMessage } = await import('../../topology/lib/standing-mailbox.mjs');
    return sendStandingMessage(input, options);
  };
  const tick = () => natsOutageTick({ consumer: repo, env, home, lead, deliver });

  // 1. The configured NATS is down: the real connect path falls back and names why.
  const local = await resolveTransport({ env });
  assert.equal(local.selection.source, 'managed-local');
  assert.equal(local.selection.fallback.source, 'NATS_URL');
  assert.equal(local.selection.fallback.url, configured);
  const down = await readTransportState(env, home);
  assert.equal(down.outage.url, configured);
  assert.equal(down.outage.recovered_at, null);

  // 2. One durable message to the lead naming URL, source, error and fallback, and only one.
  const first = await tick();
  assert.equal(first.kind, 'outage');
  assert.equal(first.to, 'lead-1');
  assert.equal(mail.length, 1);
  assert.match(mail[0].body, new RegExp(`${configured.replace(/[.]/g, '\\.')} \\(NATS_URL\\)`));
  assert.match(mail[0].body, /Error: /);
  assert.match(mail[0].body, new RegExp(`managed local NATS ${local.selection.url.replace(/[.]/g, '\\.')}`));
  assert.ok(await readStandingMessage({ id: first.message_id, env, home }), 'the outage message is a durable standing record');
  assert.equal(await tick(), null, 'a second tick in the same outage sends nothing');
  // A reopen during the same outage keeps its identity, so it is still one outage.
  await closeLiveTransports();
  await resolveTransport({ env });
  assert.equal((await readTransportState(env, home)).outage.since, down.outage.since);
  assert.equal(await tick(), null);
  assert.equal(mail.length, 1);

  // 3. The configured NATS comes back: the tick sees it, drops the local connection, and the next
  //    open dials the configured server for real, which closes the outage.
  const storeDir = join(root, 'jetstream');
  mkdirSync(storeDir, { recursive: true });
  broker = spawn(bin, ['-js', '-a', '127.0.0.1', '-p', String(configuredPort), '-sd', storeDir], { stdio: 'ignore' });
  await untilConnect(configuredPort);
  const probe = await tick();
  assert.equal(probe.probed, true);
  const back = await resolveTransport({ env });
  assert.equal(back.selection.source, 'NATS_URL');
  assert.equal(back.selection.fallback, null);
  assert.ok((await readTransportState(env, home)).outage.recovered_at, 'a fallback-free open closes the outage');

  // 4. Exactly one recovery message, then silence.
  const recovered = await tick();
  assert.equal(recovered.kind, 'recovered');
  assert.equal(mail.length, 2);
  assert.match(mail[1].body, /NATS RECOVERED/);
  assert.match(mail[1].body, /back on it/);
  assert.equal(await tick(), null);
  assert.equal(mail.length, 2);
});

// Shared fixture for the faro round-4 tests: a temp repo opted out of enrollment, a dead configured
// port, and an env whose state lives under `home` unless the caller says otherwise.
async function outageFixture(t, prefix) {
  const root = await mkdtemp(join(tmpdir(), prefix));
  const repo = join(root, 'repo'), home = join(root, 'home'), natsHome = join(root, 'nats-home');
  await run('git', ['init', '-q', repo]);
  mkdirSync(join(repo, '.bytedesk', 'agent-orchestration'), { recursive: true });
  await writeFile(join(repo, '.bytedesk', 'agent-orchestration', 'config.json'), '{"enabled":false}\n');
  const configured = `nats://127.0.0.1:${await freePort()}`;
  const env = { ...process.env, TMUX: '', TMUX_TMPDIR: join(root, 'tmux'), HOME: home, XDG_CONFIG_HOME: join(home, '.config'),
    AGENT_ORCHESTRATION_STATE_HOME: join(root, 'state'), AGENT_ORCHESTRATION_SERVICES: '0', AO_NATS_HOME: natsHome,
    AO_TRANSPORT: 'nats', NATS_URL: configured, AO_ORCH_SOCKET: join(root, 'no-orch.sock') };
  delete env.AO_NATS_URL;
  delete env.AO_NATS_AUTOSTART;
  t.after(async () => {
    await closeLiveTransports();
    try { process.kill(JSON.parse(readFileSync(join(natsHome, 'state.json'), 'utf8')).pid, 'SIGKILL'); } catch { /* gone */ }
    await rm(root, { recursive: true, force: true });
  });
  const mail = [];
  const deliver = async (input, options) => {
    mail.push(input);
    const { sendStandingMessage } = await import('../../topology/lib/standing-mailbox.mjs');
    return sendStandingMessage(input, options);
  };
  return { root, repo, home, env, configured, mail, deliver, lead: async () => ({ record: { agent_id: 'lead-1' } }) };
}

test('an open from an env without NATS_URL does not close the dead NATS_URL outage: one outage mail, no recovery mail', { timeout: 60_000 }, async t => {
  const bin = await findNatsServer({ ...process.env, AO_NATS_SERVER: process.env.AO_NATS_SERVER ?? '' });
  if (!bin) { t.skip('no working nats-server binary'); return; }
  const f = await outageFixture(t, 'ao-nats-src-');
  const env = { ...f.env, AO_NATS_SERVER: bin };
  const other = { ...env };
  delete other.NATS_URL;
  const tick = () => natsOutageTick({ consumer: f.repo, env, home: f.home, lead: f.lead, deliver: f.deliver, reachable: async () => false });

  await resolveTransport({ env });
  const since = (await readTransportState(env, f.home)).outage.since;
  assert.equal((await tick()).kind, 'outage');

  // Another process on this host, with no NATS_URL, goes straight to managed local without a fallback.
  const plain = await resolveTransport({ env: other });
  assert.equal(plain.selection.source, 'managed-local');
  assert.equal(plain.selection.fallback, null);
  const between = await readTransportState(env, f.home);
  assert.equal(between.outage.recovered_at, null, 'an open that never dialled the configured server leaves its outage open');
  assert.equal(between.outage.since, since);
  assert.equal(await tick(), null);

  await closeLiveTransports();
  await resolveTransport({ env });
  assert.equal((await readTransportState(env, f.home)).outage.since, since, 'still the same outage');
  assert.equal(await tick(), null);
  assert.deepEqual(f.mail.map(m => m.subject), [`NATS outage: ${f.configured}`]);
});

test('openNatsTransport records the selection under the caller\'s home, not the process home', { timeout: 60_000 }, async t => {
  const bin = await findNatsServer({ ...process.env, AO_NATS_SERVER: process.env.AO_NATS_SERVER ?? '' });
  if (!bin) { t.skip('no working nats-server binary'); return; }
  const f = await outageFixture(t, 'ao-nats-home-');
  const env = { ...f.env, AO_NATS_SERVER: bin };
  delete env.AGENT_ORCHESTRATION_STATE_HOME;
  delete env.XDG_STATE_HOME;
  // os.homedir() follows process HOME; point it at a decoy so a dropped `home` is visible.
  const decoy = join(f.root, 'decoy'), previousHome = process.env.HOME;
  process.env.HOME = decoy;
  t.after(() => { process.env.HOME = previousHome; });
  await resolveTransport({ env, home: f.home });
  const expected = transportStatePath(env, f.home);
  assert.ok(expected.startsWith(f.home), expected);
  assert.ok(existsSync(expected), 'transport.json is written under the caller\'s home');
  assert.equal(existsSync(transportStatePath(env, decoy)), false, 'and not under the process home');
  assert.equal((await readTransportState(env, f.home)).outage.url, f.configured);
});

test('a configured server that accepts TCP but refuses NATS is re-dialled with backoff, not every tick', async t => {
  const f = await outageFixture(t, 'ao-nats-backoff-');
  const { mkdir } = await import('node:fs/promises');
  const statePath = transportStatePath(f.env, f.home);
  await mkdir(join(statePath, '..'), { recursive: true });
  await writeFile(statePath, JSON.stringify({ kind: 'nats', source: 'managed-local', url: 'nats://127.0.0.1:1', fallback: null,
    outage: { source: 'NATS_URL', url: f.configured, error: 'Authorization Violation', since: new Date().toISOString(), recovered_at: null } }));
  let clock = 0, discards = 0;
  const tick = () => natsOutageTick({ consumer: f.repo, env: f.env, home: f.home, lead: f.lead, deliver: f.deliver,
    reachable: async () => true, discard: async () => { discards += 1; }, now: () => clock });
  const at = async (ms) => { clock = ms; await tick(); return discards; };
  assert.equal(await at(0), 1, 'the first reachable tick re-dials');
  assert.equal(await at(1_000), 1, 'the next tick inside the window does not');
  assert.equal(await at(29_000), 1);
  assert.equal(await at(30_000), 2, 'after 30 s it tries again');
  assert.equal(await at(60_000), 2, 'and then waits twice as long');
  assert.equal(await at(90_000), 3);
  assert.equal(f.mail.length, 1, 'the outage itself is still reported once');
});

async function doctorFlags(f, env) {
  const { doctor } = await import('../../topology/lib/doctor.mjs');
  const report = await doctor({ adapters: new Map(), workflowDirs: [], skillDirs: [], roleDirs: [], providerDirs: [], consumer: f.repo, env, home: f.home });
  return report.problems.some(p => p.code === 'NATS_CONFIGURED_UNREACHABLE');
}

test('an outage nothing falls back from any more is retired after the bound: one closing mail, doctor clears, no re-dials', { timeout: 60_000 }, async t => {
  const bin = await findNatsServer({ ...process.env, AO_NATS_SERVER: process.env.AO_NATS_SERVER ?? '' });
  if (!bin) { t.skip('no working nats-server binary'); return; }
  const f = await outageFixture(t, 'ao-nats-retire-');
  const env = { ...f.env, AO_NATS_SERVER: bin };
  const fixed = { ...env };
  delete fixed.NATS_URL; // the operator applied doctor's fix
  const bound = 60_000, start = Date.now();
  let clock = start, discards = 0;
  const tick = () => natsOutageTick({ consumer: f.repo, env, home: f.home, lead: f.lead, deliver: f.deliver, retireAfterMs: bound,
    reachable: async () => true, discard: async () => { discards += 1; }, now: () => clock });

  await resolveTransport({ env });
  assert.equal((await tick()).kind, 'outage');
  assert.equal(await doctorFlags(f, fixed), true, 'control: doctor reports the open outage');
  // While this process still holds the fallback, the outage is in use and is not retired.
  clock = start + 3 * bound;
  await tick();
  assert.equal((await readTransportState(env, f.home, { now: clock, retireAfterMs: bound })).outage.recovered_at, null, 'a held fallback keeps the outage open');

  await closeLiveTransports();
  const plain = await resolveTransport({ env: fixed });
  assert.equal(plain.selection.fallback, null);
  discards = 0;
  clock = start + 5 * bound;
  const closing = await tick();
  assert.equal(closing.kind, 'retired');
  const retired = (await readTransportState(env, f.home, { retireAfterMs: Infinity })).outage;
  assert.equal(retired.retired, true, 'retirement is persisted, not only derived');
  assert.ok(retired.recovered_at);
  assert.match(retired.note, /retired: no open has fallen back/);
  assert.equal(discards, 0, 'a retired outage is never re-dialled');

  assert.equal(await doctorFlags(f, fixed), false, 'doctor no longer reports the outage');

  clock += 10 * bound;
  assert.equal(await tick(), null);
  assert.equal(discards, 0);
  assert.deepEqual(f.mail.map(m => m.subject), [`NATS outage: ${f.configured}`, `NATS retired: ${f.configured}`]);
  assert.match(f.mail[1].body, /NATS OUTAGE RETIRED/);
});
