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
import { canonicalRepoId, repoKey } from '../../topology/lib/repoid.mjs';
import { sendMessage } from '../../topology/lib/mailbox.mjs';
import { readStandingInbox } from '../../topology/lib/standing-mailbox.mjs';
import { awaitReviewerVerdict, listenForReviewer, publishReviewerVerdict, reviewerProbeReady } from '../../topology/lib/reviewer.mjs';
import { writeJson } from '../../topology/lib/util.mjs';
import {
  ORCH_LAYOUT,
  closeLiveTransports,
  createFileTransport,
  openNatsTransport,
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
  const repo = repoKey((await canonicalRepoId(runDir)).id);
  const env = { AO_TRANSPORT: 'nats', AO_NATS_URL: transport.nc.getServer() };
  try {
    const message = await sendMessage({
      runDir,
      fromProject: runDir,
      from: 'conductor',
      to: ['agent-b'],
      stage: 'brief',
      body: `case-mail-${label}`,
      transport,
      env,
    });
    assert.equal(message.deliveries[0].transport, 'nats');
    assert.equal(message.deliveries[0].inbox, null);
    const inboxFile = join(runDir, 'agents', 'agent-b', 'inbox', '001-brief.md');
    await assert.rejects(stat(inboxFile), { code: 'ENOENT' });
    const inbox = await readStandingInbox({ consumer: runDir, agent: 'agent-b', transport, env });
    assert.equal(inbox.length, 1);
    assert.equal(inbox[0].transport, 'nats');
    assert.match(inbox[0].body, new RegExp(`case-mail-${label}`));
    assert.equal(inbox[0].subject, ORCH_LAYOUT.mailSubject(repo, 'agent-b'));
    await assert.rejects(stat(inboxFile), { code: 'ENOENT' });
    console.log(`CASE mail subject=${inbox[0].subject} bucket=${ORCH_LAYOUT.mailStream} body=${label}`);

    const record = {
      agent_id: 'reviewer-1',
      repo_id: (await canonicalRepoId(runDir)).id,
      session: 'review-session',
      binding: { serverKey: '/tmp/sock', serverPid: 1, sessionId: '$1', sessionCreated: 1, paneId: '%1', panePid: 2 },
    };
    const listening = await listenForReviewer({ consumer: runDir, record, env, transport });
    assert.equal(listening.listening, true);
    const ready = await reviewerProbeReady({
      consumer: runDir,
      record,
      env,
      transport,
      timeoutMs: 2000,
      alive: async () => true,
      wake: async () => ({ rang: false }),
      output: async () => '',
    });
    assert.equal(ready, true);
    console.log(`CASE probe subject=${listening.subject}`);

    const nonce = `nonce-${label}`;
    const waiting = await awaitReviewerVerdict({ repo, nonce, timeoutMs: 3000, transport, env });
    const published = await publishReviewerVerdict({
      repo,
      nonce,
      verdict: { verdict: 'approve', findings: [] },
      transport,
      env,
    });
    const verdict = await waiting.received;
    assert.equal(published.subject, ORCH_LAYOUT.verdictSubject(repo, nonce));
    assert.equal(verdict.subject, published.subject);
    assert.match(verdict.body, /approve/);
    console.log(`CASE verdict subject=${verdict.subject}`);
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
      console.log(`CASE gap subject=${held.subject}`);
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
