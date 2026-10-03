// TM-276 / ADR-0031 and TM-324 / ADR-0035: an unreachable configured NATS is reported to the repository
// lead, once per outage plus once when it ends. An explicit AO_NATS_URL is never replaced: every open
// fails until it answers, and no managed local server is started for it (ADR-0035). A stale gateway
// orch.sock still falls back to the managed local server (ADR-0031). Driven through the real connect
// path with real nats-server processes.
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
import { readStandingInbox, readStandingMessage, resumeStandingMessages } from '../../topology/lib/standing-mailbox.mjs';
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

test('a dead AO_NATS_URL fails every open and starts no local server; the lead gets one outage mail when it answers again, then one recovery mail', { timeout: 60_000 }, async t => {
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
    // A managed server would have recorded its pid here; ADR-0035 says none is started for AO_NATS_URL.
    try { process.kill(JSON.parse(readFileSync(join(natsHome, 'state.json'), 'utf8')).pid, 'SIGKILL'); } catch { /* none */ }
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

  const localState = join(natsHome, 'state.json');

  // 1. The configured NATS is down: the open fails, nothing falls back, and the outage is recorded as blocking.
  await assert.rejects(resolveTransport({ env }), (error) => {
    assert.equal(error.code, 'TOPOLOGY_NATS_UNAVAILABLE');
    assert.match(error.message, /does not fall back from an explicit AO_NATS_URL/);
    return true;
  });
  assert.equal(existsSync(localState), false, 'no managed local server was started for it');
  const down = await readTransportState(env, home);
  assert.equal(down.source, 'AO_NATS_URL');
  assert.equal(down.url, configured);
  assert.equal(down.fallback, null);
  assert.equal(down.outage.source, 'AO_NATS_URL');
  assert.equal(down.outage.url, configured);
  assert.equal(down.outage.blocking, true);
  assert.equal(down.outage.recovered_at, null);

  // 2. One durable message to the lead naming URL, source and error. The only configured server is
  //    down, so it cannot be published yet: it is held, and later ticks neither re-send nor re-record it.
  const first = await tick();
  assert.equal(first.kind, 'outage');
  assert.equal(first.to, 'lead-1');
  assert.equal(mail.length, 1);
  assert.match(mail[0].body, new RegExp(`${configured.replace(/[.]/g, '\\.')} \\(AO_NATS_URL\\)`));
  assert.match(mail[0].body, /Error: /);
  assert.match(mail[0].body, /does not fall back from an explicit AO_NATS_URL/);
  assert.doesNotMatch(mail[0].body, /^Fallback:/m);
  assert.notEqual(first.status, 'delivered', 'nothing can be delivered while the only server is down');
  const held = await readStandingMessage({ id: first.message_id, env, home });
  assert.ok(held, 'the outage message is a durable standing record');
  assert.notEqual(held.status, 'delivered');
  const again = await tick();
  assert.equal(again.kind, 'outage');
  assert.equal(again.message_id, first.message_id);
  assert.notEqual(again.status, 'delivered');
  assert.equal(mail.length, 1, 'a second tick in the same outage re-sends nothing');
  // A retried open during the same outage fails the same way and keeps the outage's identity.
  await assert.rejects(resolveTransport({ env }), { code: 'TOPOLOGY_NATS_UNAVAILABLE' });
  assert.equal((await readTransportState(env, home)).outage.since, down.outage.since);
  assert.equal(existsSync(localState), false, 'still no managed local server');

  // 3. The configured NATS comes back: the tick sees it, and the next open dials the configured
  //    server for real, which closes the outage.
  const storeDir = join(root, 'jetstream');
  mkdirSync(storeDir, { recursive: true });
  broker = spawn(bin, ['-js', '-a', '127.0.0.1', '-p', String(configuredPort), '-sd', storeDir], { stdio: 'ignore' });
  await untilConnect(configuredPort);
  const probe = await tick();
  assert.equal(probe.probed, true);
  const back = await resolveTransport({ env });
  assert.equal(back.selection.source, 'AO_NATS_URL');
  assert.equal(back.selection.fallback, null);
  const closed = await readTransportState(env, home);
  assert.ok(closed.outage.recovered_at, 'the first open that reaches the server closes the outage');
  assert.equal(closed.outage.since, down.outage.since);

  // 4. The supervisor's reconcile resumes held mail before its outage tick (supervision.mjs): the
  //    outage mail lands now, then exactly one recovery mail, then silence.
  const resumed = await resumeStandingMessages({ consumer: repo, env, home, force: true });
  assert.deepEqual(resumed.map(m => [m.envelope.id, m.status]), [[first.message_id, 'delivered']]);
  const recovered = await tick();
  assert.equal(recovered.kind, 'recovered');
  assert.equal(recovered.status, 'delivered', `the recovery notice is delivered (${recovered.reason})`);
  assert.equal(mail.length, 2);
  assert.match(mail[1].body, /NATS RECOVERED/);
  assert.match(mail[1].body, /back on it/);
  assert.equal(await tick(), null);
  assert.equal(mail.length, 2);
  // TM-309 C1: what the lead actually receives, read from its inbox over the real transport.
  const inboxSubjects = async () => (await readStandingInbox({ consumer: repo, agent: 'lead-1', env, home })).map(m => m.envelope.context?.subject);
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

  await assert.rejects(resolveTransport({ env }), { code: 'TOPOLOGY_NATS_UNAVAILABLE' });
  const since = (await readTransportState(env, f.home)).outage.since;
  assert.equal((await tick()).kind, 'outage');

  // Another process on this host, with no AO_NATS_URL, goes straight to managed local without a fallback.
  const plain = await resolveTransport({ env: other });
  assert.equal(plain.selection.source, 'managed-local');
  assert.equal(plain.selection.fallback, null);
  const between = await readTransportState(env, f.home);
  assert.equal(between.outage.recovered_at, null, 'an open that never dialled the configured server leaves its outage open');
  assert.equal(between.outage.since, since);
  assert.equal((await tick()).kind, 'outage', 'still the same open outage');

  await closeLiveTransports();
  await assert.rejects(resolveTransport({ env }), { code: 'TOPOLOGY_NATS_UNAVAILABLE' });
  assert.equal((await readTransportState(env, f.home)).outage.since, since, 'still the same outage');
  assert.equal((await tick()).kind, 'outage');
  assert.deepEqual(f.mail.map(m => m.subject), [`NATS outage: ${f.configured}`], 'one outage mail, no recovery mail');
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
  await assert.rejects(resolveTransport({ env, home: f.home }), { code: 'TOPOLOGY_NATS_UNAVAILABLE' });
  const expected = transportStatePath(env, f.home);
  assert.ok(expected.startsWith(f.home), expected);
  assert.ok(existsSync(expected), 'transport.json is written under the caller\'s home');
  assert.equal(existsSync(transportStatePath(env, decoy)), false, 'and not under the process home');
  assert.equal((await readTransportState(env, f.home)).outage.url, f.configured);
  assert.equal((await readTransportState(env, f.home)).outage.blocking, true);
});

test('a configured server that accepts TCP but refuses NATS is re-dialled with backoff, not every tick', async t => {
  const f = await outageFixture(t, 'ao-nats-backoff-');
  const { mkdir } = await import('node:fs/promises');
  const statePath = transportStatePath(f.env, f.home);
  await mkdir(join(statePath, '..'), { recursive: true });
  await writeFile(statePath, JSON.stringify({ kind: 'nats', source: 'AO_NATS_URL', url: f.configured, fallback: null,
    outage: { source: 'AO_NATS_URL', url: f.configured, error: 'Authorization Violation', blocking: true, since: new Date().toISOString(), recovered_at: null } }));
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

test('an outage nothing retries any more is retired after the bound: one closing mail, doctor clears, no re-dials', { timeout: 60_000 }, async t => {
  const bin = await findNatsServer({ ...process.env, AO_NATS_SERVER: process.env.AO_NATS_SERVER ?? '' });
  if (!bin) { t.skip('no working nats-server binary'); return; }
  const f = await outageFixture(t, 'ao-nats-retire-');
  const env = { ...f.env, AO_NATS_SERVER: bin };
  const fixed = { ...env };
  delete fixed.AO_NATS_URL; // the operator applied doctor's fix
  const bound = 60_000, start = Date.now();
  let clock = start, discards = 0;
  // The supervisor's own env: the dead URL until the operator's fix, then the fixed one. A supervisor
  // still configured with the dead URL cannot deliver anything (ADR-0035), so its notice stays held.
  let supervisorEnv = env;
  const tick = () => natsOutageTick({ consumer: f.repo, env: supervisorEnv, home: f.home, lead: f.lead, deliver: f.deliver, retireAfterMs: bound,
    reachable: async () => true, discard: async () => { discards += 1; }, now: () => clock });

  await assert.rejects(resolveTransport({ env }), { code: 'TOPOLOGY_NATS_UNAVAILABLE' });
  const outage = await tick();
  assert.equal(outage.kind, 'outage');
  assert.notEqual(outage.status, 'delivered', 'held: the only configured server is down');
  assert.equal(await doctorFlags(f, fixed), true, 'control: doctor reports the open outage');
  // A retried open inside a quarter of the retire bound, failing the same way, rewrites nothing: the
  // record keeps its identity and its timestamps (the refresh that keeps an outage alive is in the main test).
  const recorded = await readTransportState(env, f.home, { retireAfterMs: Infinity });
  await assert.rejects(resolveTransport({ env }), { code: 'TOPOLOGY_NATS_UNAVAILABLE' });
  assert.deepEqual(await readTransportState(env, f.home, { retireAfterMs: Infinity }), recorded, 'a quiet retry does not rewrite transport.json');
  clock = start + 3 * bound;

  // The operator removes the variable: opens go straight to managed local and never try the dead server
  // again, and the held outage mail lands over the transport that replaced AO_NATS_URL.
  await closeLiveTransports();
  const plain = await resolveTransport({ env: fixed });
  assert.equal(plain.selection.source, 'managed-local');
  assert.equal(plain.selection.fallback, null);
  supervisorEnv = fixed;
  assert.deepEqual((await resumeStandingMessages({ consumer: f.repo, env: fixed, home: f.home, force: true })).map(m => m.status), ['delivered']);
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

// TM-295: a long-lived process that is not a supervisor (an MCP server behind a stale gateway socket)
// and never runs the tick keeps its outage open while it holds the fallback, through its own heartbeat.
// ADR-0035 took AO_NATS_URL out of the fallback path; the stale orch.sock is the fallback that remains.
test('a non-supervisor holding the orch.sock fallback keeps its outage open; closing it lets the outage retire', { timeout: 60_000 }, async t => {
  const bin = await findNatsServer({ ...process.env, AO_NATS_SERVER: process.env.AO_NATS_SERVER ?? '' });
  if (!bin) { t.skip('no working nats-server binary'); return; }
  const f = await outageFixture(t, 'ao-nats-held-');
  const bound = 800;
  const stale = join(f.root, 'stale-orch.sock');
  await writeFile(stale, ''); // exists, so it is tried; a regular file refuses the connection
  const env = { ...f.env, AO_NATS_SERVER: bin, AO_NATS_OUTAGE_RETIRE_MS: String(bound), AO_ORCH_SOCKET: stale };
  delete env.AO_NATS_URL;
  const read = () => readTransportState(env, f.home, { retireAfterMs: bound });

  const held = await resolveTransport({ env });
  assert.equal(held.selection.fallback?.source, 'orch.sock', 'control: the open fell back from the stale socket');
  assert.equal(held.selection.source, 'managed-local');
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
