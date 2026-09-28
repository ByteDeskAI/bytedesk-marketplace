import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { access, mkdtemp, rm, stat } from 'node:fs/promises';
import { createWriteStream } from 'node:fs';
import { pipeline } from 'node:stream/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import net from 'node:net';
import os from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { repoKey } from '../../topology/lib/repoid.mjs';
import { sendMessage } from '../../topology/lib/mailbox.mjs';
import { writeJson } from '../../topology/lib/util.mjs';
import {
  ORCH_LAYOUT,
  closeLiveTransports,
  createFileTransport,
  openNatsTransport,
  publishReviewVerdict,
  transportMode,
} from '../../topology/lib/orch-transport.mjs';

async function fakeRun() {
  const runDir = await mkdtemp(join(os.tmpdir(), 'ao-orch-run-'));
  await writeJson(join(runDir, 'run.json'), {
    consumer: runDir,
    version: 1,
    name: 't',
    run_id: 'r1',
    session: 't-r1',
    sequence: 0,
    agents: [
      { id: 'conductor', role: 'orchestrator' },
      { id: 'agent-a', role: 'worker' },
      { id: 'agent-b', role: 'worker' },
    ],
  });
  return runDir;
}

function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
  });
}

const execFileAsync = promisify(execFile);

async function natsServerBin() {
  if (process.env.AO_NATS_SERVER) return process.env.AO_NATS_SERVER;
  const cached = join(os.homedir(), '.cache', 'ao-orch', 'nats-server');
  try {
    await access(cached);
    return cached;
  } catch { /* download */ }
  const version = 'v2.15.0';
  const archive = join(os.tmpdir(), `nats-server-${version}.tar.gz`);
  const response = await fetch(`https://github.com/nats-io/nats-server/releases/download/${version}/nats-server-${version}-linux-amd64.tar.gz`);
  if (!response.ok) throw new Error(`nats-server download failed: ${response.status}`);
  await pipeline(response.body, createWriteStream(archive));
  await execFileAsync('tar', ['-xzf', archive, '-C', os.tmpdir()]);
  const unpacked = join(os.tmpdir(), `nats-server-${version}-linux-amd64`, 'nats-server');
  await execFileAsync('mkdir', ['-p', join(os.homedir(), '.cache', 'ao-orch')]);
  await execFileAsync('install', ['-m', '755', unpacked, cached]);
  return cached;
}

async function startBroker() {
  const port = await freePort();
  const dir = await mkdtemp(join(os.tmpdir(), 'ao-orch-nats-'));
  const bin = await natsServerBin();
  const child = spawn(bin, ['-js', '-a', '127.0.0.1', '-p', String(port), '-sd', dir], { stdio: ['ignore', 'ignore', 'pipe'] });
  let log = '';
  child.stderr.on('data', (chunk) => { log += chunk.toString(); });
  const url = `nats://127.0.0.1:${port}`;
  let opened = null;
  for (let attempt = 0; attempt < 50; attempt += 1) {
    try {
      opened = await openNatsTransport({ servers: url, name: 'ao-orch-ready' });
      break;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }
  if (!opened) {
    child.kill('SIGKILL');
    throw new Error(`nats-server did not accept connections on ${url}: ${log}`);
  }
  await opened.close();
  return { url, child, dir };
}

async function stopBroker(broker) {
  if (!broker) return;
  const exited = new Promise((resolve) => broker.child.once('exit', resolve));
  broker.child.kill('SIGTERM');
  const timer = setTimeout(() => broker.child.kill('SIGKILL'), 2000);
  await exited;
  clearTimeout(timer);
  await rm(broker.dir, { recursive: true, force: true });
}

test('unset AO_TRANSPORT selects NATS, not the file double', () => {
  assert.equal(transportMode({}), 'nats');
  assert.equal(transportMode({ AO_TRANSPORT: 'file' }), 'file');
  assert.equal(ORCH_LAYOUT.mailSubject('repo', 'agent-b'), 'orch.repo.mail.agent-b');
  assert.equal(ORCH_LAYOUT.verdictSubject('repo', 'nonce-1'), 'orch.repo.review.nonce-1');
  assert.equal(ORCH_LAYOUT.claimsBucket, 'ORCH_CLAIMS');
});

test('file transport drops acked mail and verdict timers', async () => {
  const transport = createFileTransport();
  for (let i = 0; i < 40; i += 1) {
    await transport.publishMail({ repo: 'repo', agent: 'agent-a', messageId: `id-${i}`, body: `body-${i}` });
    const mail = await transport.pullMail({ repo: 'repo', agent: 'agent-a', timeoutMs: 50 });
    assert.equal(mail.body, `body-${i}`);
    await mail.ack();
  }
  const after = transport.stats();
  assert.equal(after.pendingMail, 0);
  assert.equal(after.retainedAcked, 0);
  const wait = transport.beginVerdictWait({ repo: 'repo', nonce: 'nonce-1', timeoutMs: 30 });
  await assert.rejects(wait.received, { code: 'TOPOLOGY_VERDICT_TIMEOUT' });
  assert.equal(transport.stats().verdictWaiters, 0);
  assert.equal(transport.stats().timers, 0);
  await transport.close();
});

async function threeCases(transport, label) {
  const runDir = await fakeRun();
  const repo = repoKey(runDir);
  try {
    const message = await sendMessage({
      runDir,
      fromProject: runDir,
      from: 'conductor',
      to: ['agent-b'],
      stage: 'brief',
      body: `case-mail-${label}`,
      transport,
      env: { AO_TRANSPORT: 'nats' },
    });
    assert.equal(message.deliveries[0].transport, 'nats');
    assert.equal(message.deliveries[0].inbox, null);
    await assert.rejects(stat(join(runDir, 'agents', 'agent-b', 'inbox', '001-brief.md')), { code: 'ENOENT' });
    const mail = await transport.pullMail({ repo, agent: 'agent-b', timeoutMs: 2000 });
    assert.ok(mail, 'mail was not waiting on the NATS subject');
    assert.match(mail.body, new RegExp(`case-mail-${label}`));
    assert.equal(mail.subject, ORCH_LAYOUT.mailSubject(repo, 'agent-b'));
    console.log(`CASE mail subject=${mail.subject} bucket=${ORCH_LAYOUT.mailStream} fileInboxRead=false body=${label}`);
    await mail.ack();

    const claim = await transport.compareAndSetClaim({
      repo,
      task: 'TM-1',
      body: { holder: 'agent-a', ts: new Date().toISOString() },
      expectedRevision: 0,
    });
    console.log(`CASE claim bucket=${claim.bucket} key=${claim.key} revision=${claim.revision}`);
    await assert.rejects(
      transport.compareAndSetClaim({ repo, task: 'TM-1', body: { holder: 'other' }, expectedRevision: 0 }),
      { code: 'TOPOLOGY_CLAIM_CONFLICT' },
    );
    const probe = await transport.serveProbe({ repo, agent: 'agent-b', handler: async (body) => `probe:${body}` });
    const roundTrip = await transport.requestProbe({ repo, agent: 'agent-b', body: 'ping', timeoutMs: 2000 });
    assert.equal(roundTrip.subject, probe.subject);
    assert.equal(roundTrip.body, 'probe:ping');
    console.log(`CASE probe subject=${roundTrip.subject}`);
    probe.stop();

    const nonce = `nonce-${label}`;
    const waiting = await transport.beginVerdictWait({ repo, nonce, timeoutMs: 3000 });
    const published = await publishReviewVerdict({
      repo,
      nonce,
      verdict: { verdict: 'approve', findings: [] },
      transport,
    });
    const verdict = await waiting.received;
    assert.equal(published.subject, ORCH_LAYOUT.verdictSubject(repo, nonce));
    assert.equal(verdict.subject, published.subject);
    assert.match(verdict.body, /approve/);
    console.log(`CASE verdict subject=${verdict.subject} fileInboxRead=false`);
  } finally {
    await rm(runDir, { recursive: true, force: true });
  }
}

test('NATS cases pass twice, survive a reconnect, and release the client', async () => {
  const broker = await startBroker();
  const before = process.memoryUsage().heapUsed;
  let first = null;
  try {
    first = await openNatsTransport({ servers: broker.url, name: 'ao-orch-cases' });
    await threeCases(first, 'one');
    await threeCases(first, 'two');
    await first.publishMail({ repo: 'gaprepo', agent: 'agent-b', messageId: 'gap-1', body: 'held-across-close' });
    const ensured = first.stats().ensured;
    await first.publishMail({ repo: 'gaprepo', agent: 'agent-b', messageId: 'gap-2', body: 'second' });
    assert.equal(first.stats().ensured, ensured, 'a second publish must reuse the consumer');
    await first.close();
    assert.equal(first.stats().closed, true);
    assert.equal(first.stats().subscriptions, 0);
    const second = await openNatsTransport({ servers: broker.url, name: 'ao-orch-gap' });
    try {
      const held = await second.pullMail({ repo: 'gaprepo', agent: 'agent-b', timeoutMs: 2000 });
      assert.equal(held?.body, 'held-across-close');
      console.log(`CASE gap subject=${held.subject} fileInboxRead=false`);
      await held.ack();
    } finally {
      await second.close();
      assert.equal(second.stats().closed, true);
    }
    const grew = process.memoryUsage().heapUsed - before;
    console.log(`CASE memory heapDeltaBytes=${grew}`);
    assert.ok(grew < 80 * 1024 * 1024, `heap grew ${grew} bytes`);
  } finally {
    await first?.close();
    await closeLiveTransports();
    await stopBroker(broker);
    assert.equal(broker.child.exitCode !== null || broker.child.signalCode !== null, true);
  }
});
