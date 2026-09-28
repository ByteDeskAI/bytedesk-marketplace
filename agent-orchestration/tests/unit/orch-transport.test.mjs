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
import { fileURLToPath } from 'node:url';
import { canonicalRepoId, repoKey } from '../../topology/lib/repoid.mjs';
import { reviewerPaths } from '../../topology/lib/reviewer.mjs';
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

const aoTopology = fileURLToPath(new URL('../../bin/ao-topology', import.meta.url));

function spawnCli(args, env) {
  const child = spawn(process.execPath, [aoTopology, ...args], {
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let stdout = '';
  let stderr = '';
  child.stdout.on('data', (chunk) => { stdout += chunk.toString(); });
  child.stderr.on('data', (chunk) => { stderr += chunk.toString(); });
  child.output = () => ({ stdout, stderr });
  return child;
}

function runCli(args, env, timeoutMs = 30000) {
  const child = spawnCli(args, env);
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error(`ao-topology timed out: ${args.join(' ')}\n${child.output().stdout}\n${child.output().stderr}`));
    }, timeoutMs);
    child.once('exit', (code, signal) => {
      clearTimeout(timer);
      resolve({ code, signal, ...child.output() });
    });
  });
}

async function waitForText(child, pattern, timeoutMs = 10000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (pattern.test(child.output().stdout)) return child.output();
    if (child.exitCode !== null || child.signalCode !== null) {
      throw new Error(`ao-topology exited before ${pattern}: code=${child.exitCode} signal=${child.signalCode}\n${child.output().stdout}\n${child.output().stderr}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`timed out waiting for ${pattern}\n${child.output().stdout}\n${child.output().stderr}`);
}

function stopChild(child) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return Promise.resolve();
  return new Promise((resolve) => {
    const timer = setTimeout(() => child.kill('SIGKILL'), 2000);
    child.once('exit', () => { clearTimeout(timer); resolve(); });
    child.kill('SIGTERM');
  });
}

async function inboxStat(path) {
  try {
    await stat(path);
    return 'present';
  } catch (error) {
    return error.code ?? 'error';
  }
}

async function threeCases(brokerUrl, stateHome, label) {
  const runDir = await fakeRun();
  const repo = repoKey((await canonicalRepoId(runDir)).id);
  const tmuxDir = await mkdtemp(join(os.tmpdir(), 'ao-orch-tmux-'));
  const socket = join(tmuxDir, 'sock');
  const env = {
    ...process.env,
    AO_TRANSPORT: 'nats',
    AO_NATS_URL: brokerUrl,
    AO_CONSUMER: runDir,
    AGENT_ORCHESTRATION_STATE_HOME: stateHome,
    TMUX: '',
    TMUX_TMPDIR: tmuxDir,
  };
  let listener = null;
  try {
    const sent = await runCli([
      'send', '--run', runDir, '--from', 'conductor', '--to', 'agent-b',
      '--from-project', runDir, '--stage', 'brief', '--body', `case-mail-${label}`, '--no-ring',
    ], env);
    assert.equal(sent.code, 0, sent.stderr || sent.stdout);
    const message = JSON.parse(sent.stdout);
    assert.equal(message.deliveries[0].transport, 'nats');
    assert.equal(message.deliveries[0].inbox, null);
    const inboxFile = join(runDir, 'agents', 'agent-b', 'inbox', '001-brief.md');
    const beforeRead = await inboxStat(inboxFile);
    assert.equal(beforeRead, 'ENOENT');
    const received = await runCli([
      'mailbox', 'inbox', '--consumer', runDir, '--agent', 'agent-b',
    ], env);
    assert.equal(received.code, 0, received.stderr || received.stdout);
    const inbox = JSON.parse(received.stdout);
    assert.equal(inbox.length, 1);
    assert.equal(inbox[0].transport, 'nats');
    assert.match(inbox[0].body, new RegExp(`case-mail-${label}`));
    assert.equal(inbox[0].subject, ORCH_LAYOUT.mailSubject(repo, 'agent-b'));
    const afterRead = await inboxStat(inboxFile);
    assert.equal(afterRead, 'ENOENT');
    console.log(`CASE mail subject=${inbox[0].subject} bucket=${ORCH_LAYOUT.mailStream} inboxStat=${afterRead} body=${label}`);

    const listed = await execFileAsync('tmux', [
      '-S', socket, 'new-session', '-d', '-s', 'revcase', '-P', '-F',
      '#{socket_path}\t#{pid}\t#{session_id}\t#{session_created}\t#{pane_id}\t#{pane_pid}',
    ], { env });
    const [serverKey, serverPid, sessionId, sessionCreated, paneId, panePid] = listed.stdout.trim().split('\t');
    const { recordPath } = await reviewerPaths(runDir, env);
    await writeJson(recordPath, {
      version: 1,
      repo_id: (await canonicalRepoId(runDir)).id,
      consumer: runDir,
      agent_id: 'reviewer-1',
      session: 'revcase',
      binding: {
        serverKey,
        serverPid: Number(serverPid),
        sessionId,
        sessionCreated: Number(sessionCreated),
        paneId,
        panePid: Number(panePid),
      },
    });
    listener = spawnCli(['review', 'listen', '--consumer', runDir], env);
    const listeningText = await waitForText(listener, /"listening":true/);
    const listening = JSON.parse(listeningText.stdout);
    assert.equal(listening.listening, true);
    assert.equal(listening.subject, ORCH_LAYOUT.probeSubject(repo, 'reviewer-1'));
    const probed = await runCli(['review', 'probe', '--consumer', runDir, '--timeout', '5s'], env);
    assert.equal(probed.code, 0, probed.stderr || probed.stdout);
    const probe = JSON.parse(probed.stdout);
    assert.equal(probe.ready, true);
    assert.equal(probe.transport, 'nats');
    console.log(`CASE probe subject=${listening.subject} ready=${probe.ready}`);

    const nonce = `nonce-${label}`;
    const waiter = spawnCli(['review', 'await', '--consumer', runDir, '--nonce', nonce, '--timeout', '8s'], env);
    await waitForText(waiter, /"waiting":true/);
    const published = await runCli([
      'review', 'publish', '--consumer', runDir, '--nonce', nonce, '--verdict', 'approve',
    ], env);
    assert.equal(published.code, 0, published.stderr || published.stdout);
    const publish = JSON.parse(published.stdout);
    const verdictExit = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        waiter.kill('SIGKILL');
        reject(new Error(`verdict waiter hung\n${waiter.output().stdout}\n${waiter.output().stderr}`));
      }, 10000);
      if (waiter.exitCode !== null) {
        clearTimeout(timer);
        resolve(waiter.exitCode);
        return;
      }
      waiter.once('exit', (code) => { clearTimeout(timer); resolve(code); });
    });
    assert.equal(verdictExit, 0, waiter.output().stderr || waiter.output().stdout);
    assert.equal(publish.subject, ORCH_LAYOUT.verdictSubject(repo, nonce));
    assert.match(waiter.output().stdout, new RegExp(publish.subject.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
    assert.match(waiter.output().stdout, /approve/);
    console.log(`CASE verdict subject=${publish.subject}`);
    return { runDir, repo };
  } finally {
    await stopChild(listener);
    await execFileAsync('tmux', ['-S', socket, 'kill-server'], { env }).catch(() => {});
    await rm(runDir, { recursive: true, force: true });
    await rm(tmuxDir, { recursive: true, force: true });
  }
}

test('NATS cases pass twice, survive a reconnect, and release the client', async () => {
  const broker = await startBroker();
  const before = process.memoryUsage().heapUsed;
  let first = null;
  try {
    const stateHome = await mkdtemp(join(os.tmpdir(), 'ao-orch-state-'));
    try {
      await threeCases(broker.url, stateHome, 'one');
      await threeCases(broker.url, stateHome, 'two');
      const replyRun = await fakeRun();
      const replyEnv = {
        ...process.env,
        AO_TRANSPORT: 'nats',
        AO_NATS_URL: broker.url,
        AO_CONSUMER: replyRun,
        AGENT_ORCHESTRATION_STATE_HOME: stateHome,
        TMUX: '',
      };
      const replySent = await runCli([
        'send', '--run', replyRun, '--from', 'conductor', '--to', 'agent-b',
        '--from-project', replyRun, '--stage', 'brief', '--body', 'need-a-reply', '--no-ring',
      ], replyEnv);
      assert.equal(replySent.code, 0, replySent.stderr || replySent.stdout);
      const replyMessage = JSON.parse(replySent.stdout);
      const early = await runCli([
        'wait', '--run', replyRun, '--from', 'agent-b', '--message', replyMessage.id,
        '--timeout', '4s', '--poll', '500ms', '--json',
      ], replyEnv);
      assert.equal(early.code, 2, early.stderr || early.stdout);
      const earlyView = JSON.parse(early.stdout);
      assert.equal(earlyView.ok, false);
      assert.equal(earlyView.pending.some((item) => item.id === replyMessage.id && item.agent === 'agent-b'), true);
      const replied = await runCli([
        'reply', '--run', replyRun, '--agent', 'agent-b', '--message', replyMessage.id, '--body', 'nats-reply-body',
      ], replyEnv);
      assert.equal(replied.code, 0, replied.stderr || replied.stdout);
      const outbox = join(replyRun, 'agents', 'agent-b', 'outbox', `${replyMessage.id}.reply.md`);
      assert.equal(await inboxStat(outbox), 'ENOENT');
      const done = await runCli([
        'wait', '--run', replyRun, '--from', 'agent-b', '--message', replyMessage.id,
        '--timeout', '8s', '--poll', '200ms', '--json',
      ], replyEnv);
      assert.equal(done.code, 0, done.stderr || done.stdout);
      const doneView = JSON.parse(done.stdout);
      assert.equal(doneView.ok, true);
      assert.equal(doneView.replies.length, 1);
      assert.equal(doneView.replies[0].body, 'nats-reply-body');
      assert.equal(doneView.replies[0].path, null);
      assert.equal(doneView.replies[0].transport, 'nats');
      assert.equal(await inboxStat(outbox), 'ENOENT');
      console.log(`CASE reply subject=${doneView.replies[0].subject} outboxStat=ENOENT`);
      await rm(replyRun, { recursive: true, force: true });
      const gapEnv = {
        ...process.env,
        AO_TRANSPORT: 'nats',
        AO_NATS_URL: broker.url,
        AO_CONSUMER: '',
        AGENT_ORCHESTRATION_STATE_HOME: stateHome,
        TMUX: '',
      };
      const gapRun = await fakeRun();
      gapEnv.AO_CONSUMER = gapRun;
      const gapSent = await runCli([
        'send', '--run', gapRun, '--from', 'conductor', '--to', 'agent-b',
        '--from-project', gapRun, '--stage', 'brief', '--body', 'held-across-close', '--no-ring',
      ], gapEnv);
      assert.equal(gapSent.code, 0, gapSent.stderr || gapSent.stdout);
      const gapFile = join(gapRun, 'agents', 'agent-b', 'inbox', '001-brief.md');
      assert.equal(await inboxStat(gapFile), 'ENOENT');
      const gapIn = await runCli(['mailbox', 'inbox', '--consumer', gapRun, '--agent', 'agent-b'], gapEnv);
      assert.equal(gapIn.code, 0, gapIn.stderr || gapIn.stdout);
      const held = JSON.parse(gapIn.stdout);
      assert.equal(held[0]?.body?.includes('held-across-close'), true);
      assert.equal(await inboxStat(gapFile), 'ENOENT');
      console.log(`CASE gap subject=${held[0].subject} inboxStat=ENOENT`);
      await rm(gapRun, { recursive: true, force: true });
    } finally {
      await rm(stateHome, { recursive: true, force: true });
    }
    first = await openNatsTransport({ servers: broker.url, name: 'ao-orch-cases' });
    const ensured = first.stats().ensured;
    await first.publishMail({ repo: 'gaprepo', agent: 'agent-b', messageId: 'gap-2', body: 'second' });
    await first.publishMail({ repo: 'gaprepo', agent: 'agent-c', messageId: 'gap-3', body: 'third' });
    assert.equal(first.stats().ensured > ensured, true);
    const again = first.stats().ensured;
    await first.publishMail({ repo: 'gaprepo', agent: 'agent-b', messageId: 'gap-4', body: 'reuse' });
    assert.equal(first.stats().ensured, again, 'a later publish must reuse the consumer');
    await first.close();
    assert.equal(first.stats().closed, true);
    assert.equal(first.stats().subscriptions, 0);
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
