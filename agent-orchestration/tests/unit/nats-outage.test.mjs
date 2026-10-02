// TM-276 / ADR-0031: an unreachable configured NATS falls back to the managed local server AND is
// reported to the repository lead, once per outage plus once on recovery. Driven through the real
// connect path: a dead ambient NATS_URL, a real local fallback server, then a real server coming up
// on the configured port.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdirSync, readFileSync } from 'node:fs';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import net from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { run, sleep } from '../../topology/lib/util.mjs';
import { findNatsServer } from '../../topology/lib/nats-local.mjs';
import { closeLiveTransports, readTransportState, redactUrl, resolveTransport } from '../../topology/lib/orch-transport.mjs';
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
