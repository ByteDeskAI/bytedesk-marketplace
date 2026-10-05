// TM-276 / ADR-0031: an unreachable configured NATS falls back to the managed local server AND is
// reported to the repository lead, once per outage plus once on recovery. Driven through the real
// connect path: a dead AO_NATS_URL, a real local fallback server, then a real server coming up
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
import { closeLiveTransports, readTransportState, redactUrl, resolveTransport, selectionView, transportStatePath, updateTransportState } from '../../topology/lib/orch-transport.mjs';
import { summary } from '../../src/services/cli.mjs';
import { natsOutageTick } from '../../topology/lib/nats-outage.mjs';
import { readStandingInbox, readStandingMessage } from '../../topology/lib/standing-mailbox.mjs';
import { agentsRoot } from '../../topology/lib/agents.mjs';
import { writeJson } from '../../topology/lib/util.mjs';

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

// TM-309 A1: the list form NATS accepts and anything new URL() rejects must never come back raw.
test('redactUrl fails closed on server lists and malformed URLs', () => {
  assert.equal(redactUrl('nats://a:secret1@h1:4222,nats://b:secret2@h2:4222'), 'nats://h1:4222,nats://h2:4222');
  assert.equal(redactUrl('tls://x:secret@h:1, nats://h2:2'), 'tls://h:1,nats://h2:2');
  for (const raw of ['nats://u:secret@[not-a-host', 'u:secret@host:4222', 'nats://u:p@secret@[bad', 'nats://ok:4222,nats://u:secret@[bad']) {
    const out = redactUrl(raw);
    assert.doesNotMatch(out, /secret/, `${raw} -> ${out}`);
    assert.match(out, /\[redacted\]@/, `${raw} -> ${out}`);
  }
  assert.equal(redactUrl('nats://h:4222'), 'nats://h:4222', 'a credential-free URL is unchanged');
});

test('a dead AO_NATS_URL falls back to managed local and mails the lead once, then once on recovery', { timeout: 60_000 }, async t => {
  const bin = await findNatsServer({ ...process.env, AO_NATS_SERVER: process.env.AO_NATS_SERVER ?? '' });
  if (!bin) { t.skip('no working nats-server binary'); return; }
  const root = await mkdtemp(join(tmpdir(), 'ao-nats-outage-'));
  const repo = join(root, 'repo'), home = join(root, 'home'), natsHome = join(root, 'nats-home');
  await run('git', ['init', '-q', repo]);
  // Opt the temp repo out of enrollment so nothing can start a real provider lead.
  mkdirSync(join(repo, '.bytedesk', 'agent-orchestration'), { recursive: true });
  await writeFile(join(repo, '.bytedesk', 'agent-orchestration', 'config.json'), '{"enabled":false}\n');
  // TM-309 C1: a real library lead, so admission routes the notice to it and the inbox can be read.
  await writeJson(join(agentsRoot(repo), 'lead-1', 'agent.json'), { id: 'lead-1', role: 'lead', full_name: 'lead-1' });
  const configuredPort = await freePort();
  const configured = `nats://127.0.0.1:${configuredPort}`;
  const env = { ...process.env, TMUX: '', TMUX_TMPDIR: join(root, 'tmux'), HOME: home, XDG_CONFIG_HOME: join(home, '.config'),
    AGENT_ORCHESTRATION_STATE_HOME: join(root, 'state'), AGENT_ORCHESTRATION_SERVICES: '0', AO_NATS_HOME: natsHome,
    AO_NATS_SERVER: bin, AO_TRANSPORT: 'nats', AO_NATS_URL: configured, AO_ORCH_SOCKET: join(root, 'no-orch.sock') };
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
  assert.equal(local.selection.fallback.source, 'AO_NATS_URL');
  assert.equal(local.selection.fallback.url, configured);
  const down = await readTransportState(env, home);
  assert.equal(down.outage.url, configured);
  assert.equal(down.outage.recovered_at, null);

  // 2. One durable message to the lead naming URL, source, error and fallback, and only one.
  const first = await tick();
  assert.equal(first.kind, 'outage');
  assert.equal(first.to, 'lead-1');
  assert.equal(mail.length, 1);
  assert.match(mail[0].body, new RegExp(`${configured.replace(/[.]/g, '\\.')} \\(AO_NATS_URL\\)`));
  assert.match(mail[0].body, /Error: /);
  assert.match(mail[0].body, new RegExp(`managed local NATS ${local.selection.url.replace(/[.]/g, '\\.')}`));
  assert.equal(first.status, 'delivered', `the outage notice is delivered, not held (${first.reason})`);
  assert.equal((await readStandingMessage({ id: first.message_id, env, home })).status, 'delivered');
  // TM-309 C1: what the lead actually receives, read from its inbox over the real transport.
  const inboxSubjects = async () => (await readStandingInbox({ consumer: repo, agent: 'lead-1', env, home })).map(m => m.envelope.context?.subject);
  assert.deepEqual(await inboxSubjects(), [`NATS outage: ${configured}`]);
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
  assert.equal(back.selection.source, 'AO_NATS_URL');
  assert.equal(back.selection.fallback, null);
  assert.ok((await readTransportState(env, home)).outage.recovered_at, 'a fallback-free open closes the outage');

  // 4. Exactly one recovery message, then silence.
  const recovered = await tick();
  assert.equal(recovered.kind, 'recovered');
  assert.equal(mail.length, 2);
  assert.match(mail[1].body, /NATS RECOVERED/);
  assert.match(mail[1].body, /back on it/);
  assert.equal(recovered.status, 'delivered');
  assert.equal(await tick(), null);
  assert.equal(mail.length, 2);
  assert.deepEqual(await inboxSubjects(), [`NATS outage: ${configured}`, `NATS recovered: ${configured}`], 'exactly one outage and one recovery reach the lead');
});

// Shared fixture for the faro round-4 tests: a temp repo opted out of enrollment, a dead configured
// port, and an env whose state lives under `home` unless the caller says otherwise.
async function outageFixture(t, prefix) {
  const root = await mkdtemp(join(tmpdir(), prefix));
  const repo = join(root, 'repo'), home = join(root, 'home'), natsHome = join(root, 'nats-home');
  await run('git', ['init', '-q', repo]);
  mkdirSync(join(repo, '.bytedesk', 'agent-orchestration'), { recursive: true });
  await writeFile(join(repo, '.bytedesk', 'agent-orchestration', 'config.json'), '{"enabled":false}\n');
  await writeJson(join(agentsRoot(repo), 'lead-1', 'agent.json'), { id: 'lead-1', role: 'lead', full_name: 'lead-1' });
  const configured = `nats://127.0.0.1:${await freePort()}`;
  const env = { ...process.env, TMUX: '', TMUX_TMPDIR: join(root, 'tmux'), HOME: home, XDG_CONFIG_HOME: join(home, '.config'),
    AGENT_ORCHESTRATION_STATE_HOME: join(root, 'state'), AGENT_ORCHESTRATION_SERVICES: '0', AO_NATS_HOME: natsHome,
    AO_TRANSPORT: 'nats', AO_NATS_URL: configured, AO_ORCH_SOCKET: join(root, 'no-orch.sock') };
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

test('an open from an env without AO_NATS_URL does not close the dead AO_NATS_URL outage: one outage mail, no recovery mail', { timeout: 60_000 }, async t => {
  const bin = await findNatsServer({ ...process.env, AO_NATS_SERVER: process.env.AO_NATS_SERVER ?? '' });
  if (!bin) { t.skip('no working nats-server binary'); return; }
  const f = await outageFixture(t, 'ao-nats-src-');
  const env = { ...f.env, AO_NATS_SERVER: bin };
  const other = { ...env };
  delete other.AO_NATS_URL;
  const tick = () => natsOutageTick({ consumer: f.repo, env, home: f.home, lead: f.lead, deliver: f.deliver, reachable: async () => false });

  await resolveTransport({ env });
  const since = (await readTransportState(env, f.home)).outage.since;
  assert.equal((await tick()).kind, 'outage');

  // Another process on this host, with no AO_NATS_URL, goes straight to managed local without a fallback.
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
    outage: { source: 'AO_NATS_URL', url: f.configured, error: 'Authorization Violation', since: new Date().toISOString(), recovered_at: null } }));
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
  delete fixed.AO_NATS_URL; // the operator applied doctor's fix
  const bound = 60_000, start = Date.now();
  let clock = start, discards = 0;
  // The supervisor's own env: the dead URL until the operator's fix, then the fixed one. Delivering a
  // notice opens a transport with it, so a supervisor still configured with the dead URL would
  // (correctly) fall back again and reopen the outage.
  let supervisorEnv = env;
  const tick = () => natsOutageTick({ consumer: f.repo, env: supervisorEnv, home: f.home, lead: f.lead, deliver: f.deliver, retireAfterMs: bound,
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
  supervisorEnv = fixed;
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

// TM-295: a long-lived process that is not a supervisor (an MCP server with the dead AO_NATS_URL) and
// never runs the tick keeps its outage open while it holds the fallback, through its own heartbeat.
test('a non-supervisor holding the fallback keeps its outage open; closing it lets the outage retire', { timeout: 60_000 }, async t => {
  const bin = await findNatsServer({ ...process.env, AO_NATS_SERVER: process.env.AO_NATS_SERVER ?? '' });
  if (!bin) { t.skip('no working nats-server binary'); return; }
  const f = await outageFixture(t, 'ao-nats-held-');
  const bound = 800;
  const env = { ...f.env, AO_NATS_SERVER: bin, AO_NATS_OUTAGE_RETIRE_MS: String(bound) };
  const read = () => readTransportState(env, f.home, { retireAfterMs: bound });

  const held = await resolveTransport({ env });
  assert.ok(held.selection.fallback, 'control: the open fell back');
  const since = (await read()).outage.since;
  await sleep(3 * bound);
  const during = (await read()).outage;
  assert.equal(during.recovered_at, null, 'a held fallback is refreshed by its holder, not only by a supervisor');
  assert.equal(during.since, since);
  assert.ok(Date.parse(during.last_fallback_at) > Date.parse(since), 'last_fallback_at advanced');

  await closeLiveTransports();
  await sleep(2 * bound);
  assert.equal((await read()).outage.retired, true, 'control: once nothing holds it, the outage retires');
});

// ---- TM-309 follow-ups (C2–C6, B2, B3, credential sinks) ----

const natsBin = () => findNatsServer({ ...process.env, AO_NATS_SERVER: process.env.AO_NATS_SERVER ?? '' });
const portOf = (url) => Number(new URL(url).port);
// A broker on the configured port, killed in teardown (TM-326/TM-330: no leaked nats-server).
function startBroker(t, bin, port, root, { jetstream = true } = {}) {
  const storeDir = join(root, `js-${port}`);
  mkdirSync(storeDir, { recursive: true });
  const child = spawn(bin, [...(jetstream ? ['-js', '-sd', storeDir] : []), '-a', '127.0.0.1', '-p', String(port)], { stdio: 'ignore' });
  t.after(() => { if (child.exitCode === null) child.kill('SIGKILL'); });
  return child;
}
const leadInbox = (f, env) => readStandingInbox({ consumer: f.repo, agent: 'lead-1', env, home: f.home });

test('C2: recovery waits for the last fallback holder; the lead gets one outage and one recovery, read from its inbox', { timeout: 90_000 }, async t => {
  const bin = await natsBin();
  if (!bin) { t.skip('no working nats-server binary'); return; }
  const f = await outageFixture(t, 'ao-nats-holders-');
  const env = { ...f.env, AO_NATS_SERVER: bin };
  const tick = () => natsOutageTick({ consumer: f.repo, env, home: f.home, lead: f.lead, deliver: f.deliver });
  const subjects = async () => (await leadInbox(f, env)).map(m => [m.envelope.context?.subject, m.status]);

  await resolveTransport({ env });
  assert.equal((await tick()).status, 'delivered');
  // The lead reads it while on the fallback, which is the only server that carries it.
  assert.deepEqual(await subjects(), [[`NATS outage: ${f.configured}`, 'accepted']]);
  // A second process on this host (an MCP server) also fell back and still holds it.
  const other = spawn('sleep', ['120'], { stdio: 'ignore' });
  t.after(() => { if (other.exitCode === null) other.kill('SIGKILL'); });
  await updateTransportState(env, f.home, s => ({ ...s, outage: { ...s.outage, holders: { ...s.outage.holders, [other.pid]: new Date().toISOString() } } }), { read: { retireAfterMs: Infinity } });

  startBroker(t, bin, portOf(f.configured), f.root);
  await untilConnect(portOf(f.configured));
  assert.equal((await tick()).probed, true, 'control: the real NATS + JetStream probe sees the server');
  const back = await resolveTransport({ env });
  assert.equal(back.selection.source, 'AO_NATS_URL', 'the supervisor moved back');
  const held = (await readTransportState(env, f.home, { retireAfterMs: Infinity })).outage;
  assert.equal(held.recovered_at, null, 'only the supervisor moved back: the outage is still open');
  assert.ok(held.reachable_at);
  assert.deepEqual(Object.keys(held.holders), [String(other.pid)]);
  await tick();
  assert.deepEqual(await subjects(), [[`NATS outage: ${f.configured}`, 'accepted']], 'no recovery while a holder remains');

  other.kill('SIGKILL');
  await new Promise(resolve => other.once('exit', resolve));
  const recovered = await tick();
  assert.equal(recovered.kind, 'recovered');
  assert.equal(recovered.status, 'delivered');
  assert.equal(await tick(), null);
  assert.deepEqual((await subjects()).map(([s]) => s), [`NATS outage: ${f.configured}`, `NATS recovered: ${f.configured}`],
    'exactly one outage and one recovery reached the lead');
  assert.deepEqual(f.mail.map(m => m.subject), [`NATS outage: ${f.configured}`, `NATS recovered: ${f.configured}`]);
});

test('C3/C6: a configured server without JetStream is neither probed as back nor recorded as recovered', { timeout: 90_000 }, async t => {
  const bin = await natsBin();
  if (!bin) { t.skip('no working nats-server binary'); return; }
  const f = await outageFixture(t, 'ao-nats-nojs-');
  const env = { ...f.env, AO_NATS_SERVER: bin };
  let discards = 0;
  const tick = () => natsOutageTick({ consumer: f.repo, env, home: f.home, lead: f.lead, deliver: f.deliver, discard: async () => { discards += 1; } });
  await resolveTransport({ env });
  await tick();
  startBroker(t, bin, portOf(f.configured), f.root, { jetstream: false });
  await untilConnect(portOf(f.configured));
  await tick();
  assert.equal(discards, 0, 'C6: a server that answers TCP and NATS but not JetStream costs no re-dial');
  // C3: the open itself reaches the server, then fails JetStream init; nothing is recorded.
  await closeLiveTransports();
  await assert.rejects(resolveTransport({ env, home: f.home }));
  const outage = (await readTransportState(env, f.home, { retireAfterMs: Infinity })).outage;
  assert.equal(outage.recovered_at, null, 'recovery is not recorded before JetStream init succeeds');
  assert.equal(outage.reachable_at, undefined);
});

test('C6: a configured port that only accepts TCP is never re-dialled', { timeout: 30_000 }, async t => {
  const f = await outageFixture(t, 'ao-nats-tcp-');
  const sockets = new Set();
  const server = net.createServer(socket => { sockets.add(socket); socket.on('error', () => {}); });
  await new Promise(resolve => server.listen(portOf(f.configured), '127.0.0.1', resolve));
  t.after(() => { for (const s of sockets) s.destroy(); server.close(); });
  const statePath = transportStatePath(f.env, f.home);
  mkdirSync(join(statePath, '..'), { recursive: true });
  await writeFile(statePath, JSON.stringify({ kind: 'nats', source: 'managed-local', url: 'nats://127.0.0.1:1', fallback: null,
    outage: { source: 'AO_NATS_URL', url: f.configured, error: 'CONNECTION_REFUSED', since: new Date().toISOString(), recovered_at: null } }));
  let discards = 0;
  const result = await natsOutageTick({ consumer: f.repo, env: f.env, home: f.home, lead: f.lead, deliver: async () => ({ status: 'delivered' }),
    discard: async () => { discards += 1; } });
  assert.ok(sockets.size >= 1, 'control: the probe did reach the port');
  assert.equal(discards, 0);
  assert.equal(result.probed, undefined);
});

test('C4/C5: a transport.json write that fails is surfaced on the selection and in the start-log view', { timeout: 60_000 }, async t => {
  const bin = await natsBin();
  if (!bin) { t.skip('no working nats-server binary'); return; }
  const f = await outageFixture(t, 'ao-nats-write-');
  const env = { ...f.env, AO_NATS_SERVER: bin };
  delete env.AO_NATS_URL;
  // A directory where the file belongs: every rename onto it fails.
  mkdirSync(transportStatePath(env, f.home), { recursive: true });
  const opened = await resolveTransport({ env, home: f.home });
  assert.equal(opened.selection.source, 'managed-local');
  assert.match(opened.selection.state_write_error ?? '', /EISDIR|ENOTEMPTY|EEXIST/);
  const view = selectionView(opened);
  assert.equal(view.source, 'managed-local');
  assert.equal(view.state_write_error, opened.selection.state_write_error);
});

test('C5: the start-log view is this connection\'s selection, not whatever transport.json says now', () => {
  const view = selectionView({ selection: { kind: 'nats', source: 'managed-local', url: 'nats://127.0.0.1:4333',
    fallback: { source: 'AO_NATS_URL', url: 'nats://h:4222', error: 'CONNECTION_REFUSED' } } });
  assert.deepEqual(view.outage, { source: 'AO_NATS_URL', url: 'nats://h:4222', error: 'CONNECTION_REFUSED', recovered_at: null });
  assert.equal(selectionView({}), null);
});

test('B2: concurrent read-modify-writes of transport.json lose nothing', async t => {
  const root = await mkdtemp(join(tmpdir(), 'ao-nats-lock-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const env = { AGENT_ORCHESTRATION_STATE_HOME: join(root, 'state') };
  await Promise.all(Array.from({ length: 25 }, () => updateTransportState(env, root,
    async (s) => { await sleep(1); return { kind: 'nats', source: 'managed-local', url: null, n: (s?.n ?? 0) + 1 }; })));
  assert.equal((await readTransportState(env, root)).n, 25);
});

test('B3: text services status names the transport and an open outage', () => {
  const text = summary({ processCompose: { alive: true }, registration: { mode: 'user', active: 'active' }, processes: [], unsupported: [],
    transport: { kind: 'nats', source: 'managed-local', url: 'nats://127.0.0.1:4333',
      outage: { source: 'AO_NATS_URL', url: 'nats://h:4222', error: 'CONNECTION_REFUSED', since: '2026-10-05T00:00:00.000Z', recovered_at: null } } });
  assert.match(text, /transport: nats managed-local nats:\/\/127\.0\.0\.1:4333/);
  assert.match(text, /NATS outage: nats:\/\/h:4222 \(AO_NATS_URL\) since 2026-10-05T00:00:00\.000Z: CONNECTION_REFUSED/);
  const recovered = summary({ processCompose: { alive: true }, registration: { mode: 'user' }, processes: [], unsupported: [],
    transport: { kind: 'nats', source: 'AO_NATS_URL', url: 'nats://h:4222', outage: { url: 'nats://h:4222', recovered_at: 'x' } } });
  assert.doesNotMatch(recovered, /NATS outage/);
});

test('no credential from a single, list or malformed AO_NATS_URL reaches transport.json, doctor, status, the start log or lead mail', { timeout: 120_000 }, async t => {
  const bin = await natsBin();
  if (!bin) { t.skip('no working nats-server binary'); return; }
  const dead = [await freePort(), await freePort()];
  const forms = {
    single: `nats://u:SECRETa1@127.0.0.1:${dead[0]}`,
    list: `nats://a:SECRETb1@127.0.0.1:${dead[0]},nats://b:SECRETb2@127.0.0.1:${dead[1]}`,
    malformed: 'nats://u:SECRETc1@[not-a-host',
  };
  const { doctor } = await import('../../topology/lib/doctor.mjs');
  for (const [form, url] of Object.entries(forms)) {
    const f = await outageFixture(t, `ao-nats-creds-${form}-`);
    const env = { ...f.env, AO_NATS_SERVER: bin, AO_NATS_URL: url };
    const opened = await resolveTransport({ env, home: f.home });
    assert.ok(opened.selection.fallback, `${form}: control, the open fell back`);
    const sent = await natsOutageTick({ consumer: f.repo, env, home: f.home, lead: f.lead, deliver: f.deliver });
    assert.equal(sent.status, 'delivered', `${form}: control, the notice was delivered`);
    const sinks = {
      'transport.json': readFileSync(transportStatePath(env, f.home), 'utf8'),
      doctor: JSON.stringify(await doctor({ adapters: new Map(), workflowDirs: [], skillDirs: [], roleDirs: [], providerDirs: [], consumer: f.repo, env, home: f.home })),
      'services status': summary({ processCompose: { alive: true }, registration: { mode: 'user' }, processes: [], unsupported: [],
        transport: await (await import('../../topology/lib/orch-transport.mjs')).describeTransport(env, f.home) }),
      'start log': JSON.stringify(selectionView(opened)),
      'lead mail': JSON.stringify(await leadInbox(f, env)),
    };
    assert.match(sinks['lead mail'], /NATS OUTAGE/, `${form}: control, the inbox holds the notice`);
    assert.match(sinks['services status'], /NATS outage/, `${form}: control, status names the outage`);
    for (const [sink, text] of Object.entries(sinks)) assert.doesNotMatch(text, /SECRET/, `${form} leaked into ${sink}`);
    await closeLiveTransports();
  }
});
