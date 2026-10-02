// TM-277: a NATS outage must degrade a supervisor tick, never end the supervisor.
//
// Before the fix, killing the managed nats-server made the presence heartbeat's JetStream request
// time out; the NatsError TIMEOUT became heartbeatError, superviseRepository rejected, and the CLI's
// top-level await died with exit 1. The unit tests here drive the loop with a counted transport
// opener so they can say WHICH connection each call used; the integration test kills and restarts a
// real throwaway nats-server under a supervisor running in a child process.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import net from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { NatsError } from 'nats';
import { run, sleep } from '../../topology/lib/util.mjs';
import { superviseRepository, SLEEP_LADDER_MS } from '../../topology/lib/supervision.mjs';
import { canonicalRepoId, repoKey } from '../../topology/lib/repoid.mjs';
import { findNatsServer } from '../../topology/lib/nats-local.mjs';
import {
  discardLiveTransports, isTransportFailure, openNatsTransport, resolveTransport, useTransportOpener,
} from '../../topology/lib/orch-transport.mjs';

/** Isolated three ways per .claude/rules/tmux-test-isolation.md, and pinned to NATS with an
 * explicit URL so nothing can autostart a server in the operator's ~/.bytedesk. */
function isolatedEnv(root, home, extra = {}) {
  const tmux = join(root, 'tmux');
  mkdirSync(tmux, { recursive: true });
  return { ...process.env, TMUX: '', TMUX_TMPDIR: tmux, HOME: home, XDG_CONFIG_HOME: join(home, '.config'),
    AGENT_ORCHESTRATION_STATE_HOME: join(root, 'state'), AGENT_ORCHESTRATION_SERVICES: '0',
    AO_NATS_HOME: join(root, 'nats-home'), AO_NATS_AUTOSTART: '0', AO_TRANSPORT: 'nats',
    AO_NATS_URL: 'nats://127.0.0.1:1', ...extra };
}

async function quietRepo(t, label) {
  const root = await mkdtemp(join(tmpdir(), `ao-supervise-nats-${label}-`));
  t.after(() => rm(root, { recursive: true, force: true }));
  const repo = join(root, 'repo'), home = join(root, 'home');
  await run('git', ['init', '-q', repo]);
  const env = isolatedEnv(root, home);
  return { root, repo, home, env, options: { consumer: repo, home, env, tmuxServer: `ao-absent-${process.pid}-${Date.now()}` } };
}

/** A transport opener whose Nth connection fails every presence write with plan[N-1] (a NatsError
 * code, or 'BOOM' for a plain programming error); connections past the plan succeed. Every open,
 * write and close is logged with the connection's id. */
function countedOpener(plan) {
  const log = [];
  let opened = 0;
  const open = async () => {
    const id = ++opened;
    const mode = plan[id - 1] ?? 'ok';
    log.push({ id, op: 'open' });
    const transport = {
      kind: 'nats',
      closed: false,
      stats: () => ({ kind: 'nats', closed: transport.closed }),
      async putPresence() {
        log.push({ id, op: 'put', after_close: transport.closed });
        if (mode === 'BOOM') throw Object.assign(new Error('programming error'), { code: 'BOOM' });
        if (mode !== 'ok') throw NatsError.errorForCode(mode);
        return { via: 'nats' };
      },
      async close({ force = false } = {}) { transport.closed = true; log.push({ id, op: 'close', force }); },
    };
    return transport;
  };
  return { open, log };
}

function useOpener(t, plan) {
  const opener = countedOpener(plan);
  const restore = useTransportOpener(opener.open);
  t.after(async () => { restore(); await discardLiveTransports(); });
  return opener;
}

test('only NATS outages are classified as transport failures', () => {
  for (const code of ['TIMEOUT', 'CONNECTION_CLOSED', 'CONNECTION_REFUSED', 'DISCONNECT', '503']) {
    assert.equal(isTransportFailure(NatsError.errorForCode(code)), true, code);
  }
  assert.equal(isTransportFailure(Object.assign(new Error('x'), { code: 'TOPOLOGY_NATS_UNAVAILABLE' })), true);
  // The same word on a non-NatsError is not an outage, and neither is a NatsError for a bad payload.
  assert.equal(isTransportFailure(Object.assign(new Error('x'), { code: 'TIMEOUT' })), false);
  assert.equal(isTransportFailure(NatsError.errorForCode('BAD_JSON')), false);
  assert.equal(isTransportFailure(new TypeError('undefined is not a function')), false);
});

test('a cached connection that reports closed is replaced, not reused', async t => {
  const opener = useOpener(t, []);
  const env = { AO_TRANSPORT: 'nats', AO_NATS_URL: 'nats://127.0.0.1:1' };
  const first = await resolveTransport({ env });
  assert.equal(await resolveTransport({ env }), first, 'a live cached connection is reused');
  first.closed = true;
  const second = await resolveTransport({ env });
  assert.notEqual(second, first);
  assert.deepEqual(opener.log.filter(e => e.op === 'open').map(e => e.id), [1, 2]);
});

test('a JetStream TIMEOUT and a closed connection each degrade one tick, and the next tick dials a fresh connection', async t => {
  const { options } = await quietRepo(t, 'timeout');
  const opener = useOpener(t, ['TIMEOUT', 'CONNECTION_CLOSED']);
  const controller = new AbortController();
  t.after(() => controller.abort());
  const ticks = [];
  const report = await superviseRepository(options, {
    signal: controller.signal, reconcileMinMs: 0, sleepFn: async () => {},
    onTick: tick => {
      ticks.push(tick);
      if ((tick.reconciled && tick.transport_failures >= 2) || ticks.length > 200) controller.abort();
    },
  });

  // The loop came back on abort; before TM-277 this call rejected with the TIMEOUT.
  assert.ok(report, 'superviseRepository must return, not throw, on a NATS outage');
  const opens = opener.log.filter(e => e.op === 'open').map(e => e.id);
  const puts = opener.log.filter(e => e.op === 'put');
  const closes = opener.log.filter(e => e.op === 'close');
  // Connections 1 and 2 failed, were force-closed (not drained), and were never written to again.
  assert.ok(opens.length >= 3, `expected at least three dials, got ${JSON.stringify(opener.log)}`);
  assert.deepEqual(opens, opens.map((_, i) => i + 1));
  for (const id of [1, 2]) {
    assert.ok(closes.some(c => c.id === id && c.force === true), `connection ${id} must be discarded with force: ${JSON.stringify(opener.log)}`);
  }
  assert.equal(puts.filter(p => p.after_close).length, 0, 'no write may reach a discarded connection');
  // The write that finally succeeded went over a connection opened after both failures.
  assert.ok(puts.at(-1).id >= 3, `last write used connection ${puts.at(-1).id}`);
  const failedWrites = puts.filter(p => p.id <= 2).length;
  // The tick record says what happened: how many outages, the latest code, and the degraded tick.
  const last = ticks.at(-1);
  assert.equal(last.reconciled, true);
  assert.equal(last.transport_failures, failedWrites, 'every failed write is counted exactly once');
  assert.ok(['TIMEOUT', 'CONNECTION_CLOSED'].includes(last.transport_error.code));
  const degraded = ticks.filter(tick => tick.degraded === 'transport-unavailable');
  assert.ok(degraded.length >= 1, `expected a degraded tick, got ${JSON.stringify(ticks.map(tick => tick.degraded ?? tick.reconciled))}`);
  assert.ok(degraded.every(tick => tick.reconciled === false && SLEEP_LADDER_MS.includes(tick.sleep_ms)));
});

test('a programming error in the transport path is still fatal', async t => {
  const { options } = await quietRepo(t, 'boom');
  useOpener(t, ['BOOM']);
  const controller = new AbortController();
  t.after(() => controller.abort());
  await assert.rejects(
    superviseRepository(options, { signal: controller.signal, reconcileMinMs: 0, sleepFn: async () => {} }),
    { code: 'BOOM' },
  );
});

test('a one-shot supervise still reports a NATS outage as its answer', async t => {
  const { options } = await quietRepo(t, 'once');
  useOpener(t, ['TIMEOUT']);
  await assert.rejects(superviseRepository(options, { once: true }), { code: 'TIMEOUT' });
});

// ── Integration: a real nats-server killed and restarted under a running supervisor ───────────────

function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => { const { port } = server.address(); server.close(() => resolve(port)); });
  });
}

function startBroker(bin, port, storeDir) {
  return spawn(bin, ['-js', '-a', '127.0.0.1', '-p', String(port), '-sd', storeDir], { stdio: 'ignore' });
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

/** Kill one process by its own PID, never by name, and wait until it is gone. */
async function killPid(child) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  const exited = new Promise(resolve => child.once('exit', resolve));
  try { process.kill(child.pid, 'SIGKILL'); } catch { return; }
  await exited;
}

test('a supervisor keeps its pid across a real nats-server kill -9 and restart, and publishes again', { timeout: 90_000 }, async t => {
  const bin = await findNatsServer({ ...process.env, AO_NATS_SERVER: process.env.AO_NATS_SERVER ?? '' });
  if (!bin) { t.skip('no working nats-server binary'); return; }
  const { root, repo, home } = await quietRepo(t, 'live');
  const port = await freePort();
  const url = `nats://127.0.0.1:${port}`;
  const storeDir = join(root, 'jetstream');
  mkdirSync(storeDir, { recursive: true });
  let broker = startBroker(bin, port, storeDir);
  t.after(() => killPid(broker));
  await untilConnect(port);

  const env = isolatedEnv(root, home, { AO_NATS_URL: url });
  const supervision = fileURLToPath(new URL('../../topology/lib/supervision.mjs', import.meta.url));
  const script = join(root, 'supervise.mjs');
  // A 1s presence contract makes the heartbeat beat every 333ms, so an outage is seen quickly.
  await writeFile(script, `import { superviseRepository } from ${JSON.stringify(supervision)};
await superviseRepository({ consumer: ${JSON.stringify(repo)}, home: ${JSON.stringify(home)}, env: process.env,
  tmuxServer: ${JSON.stringify(`ao-absent-${process.pid}-${Date.now()}`)}, staleAfterMs: 1000, clockSkewToleranceMs: 500 },
  { intervalMs: 100, reconcileMinMs: 0, onTick: r => process.stdout.write(JSON.stringify({ pid: process.pid,
    reconciled: r.reconciled, revision: r.revision ?? null, failures: r.transport_failures ?? 0,
    code: r.transport_error?.code ?? null, beats: r.presence_beats_degraded ?? 0 }) + '\\n') });
`);
  const child = spawn(process.execPath, [script], { env, stdio: ['ignore', 'pipe', 'pipe'] });
  t.after(() => killPid(child));
  const ticks = [];
  let stderr = '', buffer = '';
  child.stderr.on('data', chunk => { stderr += chunk; });
  child.stdout.on('data', chunk => {
    buffer += chunk;
    const lines = buffer.split('\n');
    buffer = lines.pop();
    for (const line of lines) if (line.trim()) ticks.push(JSON.parse(line));
  });
  const until = async (predicate, what, ms = 30_000) => {
    const deadline = Date.now() + ms;
    while (Date.now() < deadline) {
      if (child.exitCode !== null) assert.fail(`supervisor exited ${child.exitCode} while waiting for ${what}: ${stderr}`);
      const hit = ticks.find(predicate);
      if (hit) return hit;
      await sleep(100);
    }
    assert.fail(`timed out waiting for ${what}; last tick ${JSON.stringify(ticks.at(-1))}; stderr ${stderr}`);
  };

  const healthy = await until(tick => tick.reconciled && tick.revision !== null, 'a first healthy tick');
  const pid = healthy.pid;
  assert.equal(pid, child.pid);

  await killPid(broker);
  const outage = await until(tick => tick.failures >= 1, 'a tick that recorded the outage');
  assert.ok(['TIMEOUT', 'CONNECTION_CLOSED', 'CONNECTION_REFUSED', 'DISCONNECT', 'TOPOLOGY_NATS_UNAVAILABLE', '503'].includes(outage.code), `outage code ${outage.code}`);

  const restartedAt = new Date();
  broker = startBroker(bin, port, storeDir);
  await untilConnect(port);
  const seenAt = ticks.length;
  // Recovery means a NEW presence write landed: the revision moved past every revision seen so far.
  const highest = Math.max(...ticks.map(tick => Number(tick.revision ?? -1)));
  const recovered = await until((tick, i) => i >= seenAt && tick.reconciled && Number(tick.revision) > highest, 'a presence write after the restart');

  assert.equal(child.exitCode, null, 'the supervisor process is still running');
  assert.equal(recovered.pid, pid, 'same supervisor pid before and after the restart');
  assert.ok(ticks.every(tick => tick.pid === pid));

  // And the write reached the restarted server, not just the supervisor's own bookkeeping.
  const reader = await openNatsTransport({ servers: url, name: 'ao-tm277-reader' });
  t.after(() => reader.close({ force: true }));
  const presence = await reader.getPresence({ repo: repoKey((await canonicalRepoId(repo)).id) });
  assert.ok(presence, 'presence must be in the restarted server');
  assert.ok(new Date(JSON.parse(presence.body).generatedAt) >= restartedAt, 'the stored presence was written after the restart');
});
