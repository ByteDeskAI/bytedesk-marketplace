// TM-311: handoff idempotency, ORCH_EVENTS, watch-based wait, fenced claims, ORCH_TASKS work queue.
// A temp nats-server per test file; ambient NATS env is cleared so nothing reaches the operator's broker.
import { natsServerBin } from '../helpers/nats-server.mjs';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import net from 'node:net';
import os from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { canonicalRepoId, repoKey } from '../../topology/lib/repoid.mjs';
import { writeJson } from '../../topology/lib/util.mjs';
import { agentsRoot } from '../../topology/lib/agents.mjs';
import { ORCH_LAYOUT, createFileTransport, openNatsTransport } from '../../topology/lib/orch-transport.mjs';
import { handoff } from '../../topology/lib/handoff.mjs';
import { claimFenced, writeFenced } from '../../topology/lib/claims-fenced.mjs';
import { publishWork, takeWork } from '../../topology/lib/work-queue.mjs';
import { diagnose, readRepoEvents } from '../../topology/lib/events.mjs';
import { sendMessage, waitForReplies } from '../../topology/lib/mailbox.mjs';

for (const name of ['NATS_URL', 'AO_NATS_URL', 'AO_ORCH_SOCKET', 'AO_ORCH_CREDS', 'AO_NATS_JS_DOMAIN']) delete process.env[name];
process.env.AO_NATS_AUTOSTART = '0';
const DUP_WINDOW_MS = 1000;
const aoTopology = fileURLToPath(new URL('../../bin/ao-topology', import.meta.url));

function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => { const { port } = server.address(); server.close(() => resolve(port)); });
  });
}

async function startBroker() {
  const port = await freePort();
  const dir = await mkdtemp(join(os.tmpdir(), 'ao-feat-nats-'));
  const child = spawn(await natsServerBin(), ['-js', '-a', '127.0.0.1', '-p', String(port), '-sd', dir], { stdio: 'ignore' });
  const url = `nats://127.0.0.1:${port}`;
  for (let attempt = 0; attempt < 50; attempt += 1) {
    try {
      const probe = await openNatsTransport({ servers: url, name: 'ao-feat-ready' });
      await probe.close();
      return { url, child, dir };
    } catch { await new Promise((resolve) => setTimeout(resolve, 100)); }
  }
  child.kill('SIGKILL');
  throw new Error(`nats-server did not start on ${url}`);
}

async function stopBroker(broker) {
  const exited = new Promise((resolve) => broker.child.once('exit', resolve));
  broker.child.kill('SIGTERM');
  const timer = setTimeout(() => broker.child.kill('SIGKILL'), 2000);
  await exited;
  clearTimeout(timer);
  await rm(broker.dir, { recursive: true, force: true });
}

const open = (broker) => openNatsTransport({ servers: broker.url, env: { AO_ORCH_DUPLICATE_WINDOW_MS: String(DUP_WINDOW_MS) }, name: 'ao-feat' });
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const mailCount = async (transport, subject) => {
  const info = await (await transport.nc.jetstreamManager()).streams.info(ORCH_LAYOUT.mailStream, { subjects_filter: subject });
  return info.state.subjects?.[subject] ?? 0;
};

test('duplicate handoff id at +0s and past the dedupe window yields exactly one successor', async () => {
  const broker = await startBroker();
  const transport = await open(broker);
  try {
    const repo = 'repoa';
    const sends = [];
    const send = async ({ body, to }) => {
      sends.push(to);
      await transport.publishMail({ repo, agent: to, messageId: 'handoff-msg-1', body });
      return { id: 'successor-1' };
    };
    const closes = [];
    const run = () => handoff({ transport, repo, messageId: 'msg-1', from: 'agent-a', reason: 'handed_off_to', to: 'agent-b', send, close: async ({ body }) => { closes.push(body); } });
    const first = await run();
    await sleep(DUP_WINDOW_MS + 600); // stands in for +150s against the real 120s window
    const second = await run();
    const successors = await mailCount(transport, ORCH_LAYOUT.mailSubject(repo, 'agent-b'));
    const kv = await transport.getHandoff({ repo, messageId: 'msg-1' });
    console.log(`HANDOFF first.duplicate=${first.duplicate} second.duplicate=${second.duplicate} stream ORCH_MAIL msgs on ${ORCH_LAYOUT.mailSubject(repo, 'agent-b')}=${successors} sends=${sends.length} kv=${kv.key}@rev${kv.revision} state=${JSON.parse(kv.body).data.state} successor_id=${JSON.parse(kv.body).data.successor_id}`);
    assert.equal(successors, 1);
    assert.equal(sends.length, 1);
    assert.equal(second.duplicate, true);
    assert.equal(JSON.parse(kv.body).data.state, 'closed');

    // Control: with only Nats-Msg-Id, the same two publishes across the window make TWO messages.
    // This proves the window really expired, so the KV key is what stopped the duplicate above.
    for (let i = 0; i < 2; i += 1) {
      await transport.publishMail({ repo, agent: 'agent-c', messageId: 'control-1', body: 'x' });
      if (i === 0) await sleep(DUP_WINDOW_MS + 600);
    }
    const control = await mailCount(transport, ORCH_LAYOUT.mailSubject(repo, 'agent-c'));
    console.log(`HANDOFF control (Nats-Msg-Id only, same gap) msgs=${control}`);
    assert.equal(control, 2);
  } finally { await transport.close(); await stopBroker(broker); }
});

test('handoff: reasons, required target, unknown fields kept, held send does not close the source', async () => {
  const transport = createFileTransport();
  const closed = [];
  const base = { transport, repo: 'repob', from: 'agent-a', close: async ({ body }) => { closed.push(body); } };
  await assert.rejects(handoff({ ...base, messageId: 'm1', reason: 'bogus', send: async () => ({ id: 'x' }) }), { code: 'TOPOLOGY_HANDOFF_REASON' });
  for (const reason of ['handed_off_to', 'blocked_on', 'denied']) {
    await assert.rejects(handoff({ ...base, messageId: 'm2', reason, send: async () => ({ id: 'x' }) }), { code: 'TOPOLOGY_HANDOFF_TARGET' });
  }
  const noTarget = await handoff({ ...base, messageId: 'm3', reason: 'no-follow-on', extra: { custom_field: { keep: 1 } }, send: async () => { throw new Error('no successor expected'); } });
  const stored = JSON.parse((await transport.getHandoff({ repo: 'repob', messageId: 'm3' })).body);
  console.log(`HANDOFF no-follow-on type=${stored.type} schema=${stored.schema} data=${JSON.stringify(stored.data)}`);
  assert.deepEqual([stored.type, stored.schema, stored.data.custom_field], ['ao/handoff', 1, { keep: 1 }]);
  assert.equal(noTarget.successorId, null);
  const before = closed.length;
  const held = await handoff({ ...base, messageId: 'm4', reason: 'handed_off_to', to: 'agent-z', send: async () => ({ id: null, holds: [{ reason: 'leads_not_ready' }] }) });
  assert.equal(held.held, true);
  assert.equal(closed.length, before, 'a held successor must not close the source');
  const resumed = await handoff({ ...base, messageId: 'm4', reason: 'handed_off_to', to: 'agent-z', send: async () => ({ id: 'ok-1' }) });
  assert.deepEqual([resumed.held, resumed.successorId, closed.length], [false, 'ok-1', before + 1], 'a retry resumes the interrupted handoff');
});

async function crossRepoFixture(t) {
  const root = await mkdtemp(join(os.tmpdir(), 'ao-gate-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const source = join(root, 'source');
  const destination = join(root, 'destination');
  const runDir = join(root, 'run');
  await Promise.all([source, destination, runDir].map((dir) => mkdir(dir, { recursive: true })));
  for (const [id, role] of [['lead0001', 'lead'], ['work0001', 'worker']]) await writeJson(join(agentsRoot(destination), id, 'agent.json'), { id, role, full_name: id });
  await writeJson(join(runDir, 'run.json'), { version: 1, run_id: 'gate-run', consumer: destination, sequence: 0, agents: [{ id: 'conductor', role: 'orchestrator' }] });
  const env = { ...process.env, AGENT_ORCHESTRATION_STATE_HOME: join(root, 'state'), AO_CONSUMER: source };
  const fileTransport = createFileTransport();
  const crossRepoSend = (standingOptions) => ({ body, to }) => sendMessage({ runDir, from: 'send0001', to: [to], stage: 'handoff', body, fromProject: source,
    idempotencyKey: 'handoff:gate-1', standingOptions: { ...standingOptions, transport: fileTransport }, transport: fileTransport, env });
  return { crossRepoSend };
}

test('readiness gate: a handoff with no lead ack is held (leads_not_ready) and the source stays open', async (t) => {
  const { crossRepoSend } = await crossRepoFixture(t);
  const transport = createFileTransport();
  const closed = [];
  const held = await handoff({ transport, repo: 'gate', messageId: 'gate-1', from: 'send0001', reason: 'handed_off_to', to: 'work0001',
    send: crossRepoSend({ readiness: async () => ({ status: 'unresponsive' }), enrollment: async () => ({ enrolled: true }) }), close: async () => { closed.push(1); } });
  console.log(`GATE no lead ack: held=${held.held} reason=${held.reason} closed=${closed.length} kv.state=${JSON.parse((await transport.getHandoff({ repo: 'gate', messageId: 'gate-1' })).body).data.state}`);
  assert.deepEqual([held.held, held.reason, closed.length], [true, 'leads_not_ready', 0]);
});

test('readiness gate: gate bypassed by hand ack (readiness stubbed responsive) proceeds', async (t) => {
  const { crossRepoSend } = await crossRepoFixture(t);
  const transport = createFileTransport();
  const closed = [];
  const done = await handoff({ transport, repo: 'gate', messageId: 'gate-1', from: 'send0001', reason: 'handed_off_to', to: 'work0001',
    send: crossRepoSend({ readiness: async () => ({ status: 'responsive', record: { agent_id: 'lead0001' }, library_lead: 'lead0001' }), enrollment: async () => ({ enrolled: true }) }),
    close: async () => { closed.push(1); } });
  console.log(`GATE bypassed by hand ack: held=${done.held} successor=${done.successorId} closed=${closed.length}`);
  assert.deepEqual([done.held, closed.length], [false, 1]);
  assert.ok(done.successorId);
});

for (const kind of ['nats', 'file']) {
  test(`fenced claim (${kind}): a worker that stalls past expiry is refused after a second worker takes over`, async () => {
    const broker = kind === 'nats' ? await startBroker() : null;
    const transport = broker ? await open(broker) : createFileTransport();
    try {
      const repo = 'fence';
      const t0 = 1_000_000;
      const a = await claimFenced({ transport, repo, task: 'TM-1', owner: 'worker-a', ttlMs: 1000, now: t0 });
      const early = await claimFenced({ transport, repo, task: 'TM-1', owner: 'worker-b', ttlMs: 1000, now: t0 + 500 });
      const b = await claimFenced({ transport, repo, task: 'TM-1', owner: 'worker-b', ttlMs: 1000, now: t0 + 2000 });
      await assert.rejects(writeFenced({ transport, repo, task: 'TM-1', token: a.token, owner: 'worker-a', patch: { result: 'stale' }, now: t0 + 2100 }), { code: 'TOPOLOGY_CLAIM_FENCED' });
      const entry = await transport.getClaimEntry({ repo, task: 'TM-1' });
      console.log(`FENCE ${kind}: a.won=${a.won}@rev${a.token.revision} b-before-expiry.won=${early.won}(owner ${early.owner}) b-after-expiry.won=${b.won}@rev${b.token.revision} stale write by worker-a refused; winner=${entry.body.owner} rev=${entry.revision} result=${entry.body.result}`);
      assert.deepEqual([a.won, early.won, b.won, entry.body.owner, entry.body.result], [true, false, true, 'worker-b', undefined]);
      const ok = await writeFenced({ transport, repo, task: 'TM-1', token: b.token, owner: 'worker-b', patch: { result: 'done' }, now: t0 + 2200 });
      assert.ok(ok.revision > b.token.revision);
      await assert.rejects(writeFenced({ transport, repo, task: 'TM-1', token: null, owner: 'worker-b' }), { code: 'TOPOLOGY_CLAIM_FENCED' });
    } finally { await transport.close(); if (broker) await stopBroker(broker); }
  });

  test(`work queue (${kind}): two workers race one ready task, exactly one wins and the loser is nak'd and retried`, async () => {
    const broker = kind === 'nats' ? await startBroker() : null;
    const transport = broker ? await open(broker) : createFileTransport();
    try {
      const repo = 'queue';
      // The same task enqueued twice (a re-publish): both workers hold an item for it, so the claim decides.
      await publishWork({ transport, repo, task: 'TM-9', messageId: 'ready-1' });
      await publishWork({ transport, repo, task: 'TM-9', messageId: 'ready-2' });
      const [x, y] = await Promise.all(['worker-x', 'worker-y'].map((worker) => takeWork({ transport, repo, worker, ttlMs: 60_000, nakDelayMs: 2000, attempts: 1 })));
      const winners = [x, y].filter((r) => r.took);
      const losers = [x, y].filter((r) => !r.took);
      const winnerId = winners[0] && (x.took ? 'worker-x' : 'worker-y');
      console.log(`QUEUE ${kind}: winner=${winnerId} winners=${winners.length} loser=${JSON.stringify(losers[0]?.lost)}`);
      assert.equal(winners.length, 1);
      assert.equal(losers[0].lost.owner, winnerId);
      assert.equal(losers[0].lost.naked, true);
      // The nak'd item comes back after its delay: that is the retry.
      const early = await transport.pullReady({ repo, timeoutMs: 100 });
      assert.equal(early, null, 'held back during the nak delay');
      await sleep(2200);
      const again = await transport.pullReady({ repo, timeoutMs: 1500 });
      console.log(`QUEUE ${kind}: redelivered after nak: ${again?.body}`);
      assert.equal(JSON.parse(again.body).task, 'TM-9');
      await again.ack();
      // Empty queue is reported as empty, not as a loss.
      assert.deepEqual(await takeWork({ transport, repo, worker: 'worker-z', attempts: 1, timeoutMs: 100 }), { took: false, empty: true });
    } finally { await transport.close(); if (broker) await stopBroker(broker); }
  });
}

test('ORCH_EVENTS mirrors journal events; PARKED and DONE-UNSEEN are computed on read and not stored', async () => {
  const broker = await startBroker();
  const transport = await open(broker);
  try {
    const { mirrorJournalEvent } = await import('../../topology/lib/events.mjs');
    const dir = await mkdtemp(join(os.tmpdir(), 'ao-ev-repo-'));
    const repo = repoKey((await canonicalRepoId(dir)).id);
    const ts = (n) => `2026-10-02T00:00:0${n}.000Z`;
    for (const record of [
      { ts: ts(1), type: 'message.sent', id: '001-brief', from: 'conductor', to: ['agent-a'] },
      { ts: ts(2), type: 'message.sent', id: '002-brief', from: 'conductor', to: ['agent-b'] },
      { ts: ts(3), type: 'message.sent', id: '003-brief', from: 'conductor', to: ['agent-c'] },
      { ts: ts(4), type: 'message.replied', id: '002-brief', from: 'agent-b' },
      { ts: ts(5), type: 'message.replied', id: '003-brief', from: 'agent-c' },
      { ts: ts(6), type: 'wait.satisfied', agents: ['agent-c'], message: '003-brief' },
    ]) assert.equal(await mirrorJournalEvent(transport, dir, record), true);
    const events = await readRepoEvents(transport, repo);
    const info = await (await transport.nc.jetstreamManager()).streams.info(ORCH_LAYOUT.eventsStream);
    console.log(`EVENTS stream=${ORCH_LAYOUT.eventsStream} subjects=${JSON.stringify(info.config.subjects)} retention=${info.config.retention} max_age_days=${info.config.max_age / 86_400_000_000_000} msgs=${info.state.messages} read=${events.map((e) => e.type).join(',')}`);
    assert.equal(events.length, 6);
    assert.equal(info.config.retention, 'limits');
    assert.equal(info.config.max_age, 90 * 86_400_000_000_000);
    const findings = diagnose(events, { idleAgents: ['agent-a'] });
    console.log(`DIAGNOSE ${JSON.stringify(findings.map((f) => [f.diagnosis, f.agent, f.id]))}`);
    assert.deepEqual(findings.map((f) => [f.diagnosis, f.agent, f.id]), [['PARKED', 'agent-a', '001-brief'], ['DONE-UNSEEN', 'agent-b', '002-brief']]);
    // Never stored: no diagnosis token appears in any stream message or KV bucket.
    assert.equal(events.some((e) => /PARKED|DONE-UNSEEN/.test(JSON.stringify(e))), false);
    await rm(dir, { recursive: true, force: true });
  } finally { await transport.close(); await stopBroker(broker); }
});

async function waitFixture() {
  const runDir = await mkdtemp(join(os.tmpdir(), 'ao-feat-run-'));
  const stateHome = await mkdtemp(join(os.tmpdir(), 'ao-feat-state-'));
  await writeJson(join(runDir, 'run.json'), { consumer: runDir, version: 1, name: 't', run_id: 'r1', session: 't-r1', sequence: 0,
    agents: [{ id: 'conductor', role: 'orchestrator' }, { id: 'agent-b', role: 'worker' }] });
  const env = { ...process.env, AO_TRANSPORT: 'nats', AO_NATS_AUTOSTART: '0', AGENT_ORCHESTRATION_STATE_HOME: stateHome, AO_CONSUMER: runDir, TMUX: '', TMUX_TMPDIR: stateHome };
  return { runDir, stateHome, env };
}

function cli(args, env) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [aoTopology, ...args], { env, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = ''; let stderr = '';
    child.stdout.on('data', (c) => { stdout += c; }); child.stderr.on('data', (c) => { stderr += c; });
    child.on('exit', (code) => resolve({ code, stdout, stderr }));
  });
}

for (const mode of ['watch', 'poll fallback']) {
  test(`waitForReplies returns via ${mode}`, async () => {
    const broker = await startBroker();
    const { runDir, stateHome, env } = await waitFixture();
    const cliEnv = { ...env, AO_NATS_URL: broker.url };
    const prior = process.env.AGENT_ORCHESTRATION_STATE_HOME;
    process.env.AGENT_ORCHESTRATION_STATE_HOME = stateHome;
    const transport = await openNatsTransport({ servers: broker.url, name: 'ao-feat-wait' });
    try {
      const sent = await cli(['send', '--run', runDir, '--from', 'conductor', '--to', 'agent-b', '--from-project', runDir, '--stage', 'brief', '--body', 'go', '--no-ring'], cliEnv);
      assert.equal(sent.code, 0, sent.stderr || sent.stdout);
      const messageId = JSON.parse(sent.stdout).id;
      const useWatch = mode === 'watch';
      // pollMs is far longer than the test: only a wake-up (watch) can finish early; the fallback uses a short poll.
      const waiting = waitForReplies({ runDir, agentIds: ['agent-b'], messageId, timeoutMs: 20_000, pollMs: useWatch ? 15_000 : 200, transport, watch: useWatch });
      await sleep(2500); // past the first (blocking ~1s) reply fetch, so only a wake-up or a poll can notice it
      const replied = await cli(['reply', '--run', runDir, '--agent', 'agent-b', '--message', messageId, '--body', 'done'], cliEnv);
      assert.equal(replied.code, 0, replied.stderr || replied.stdout);
      // Bounded: a missing watch or poll must FAIL this test with a rejection, not hang it.
      let guard;
      const result = await Promise.race([waiting, new Promise((_, reject) => { guard = setTimeout(() => reject(new Error(`waitForReplies did not return within 9s via ${mode}`)), 9000); })]).finally(() => clearTimeout(guard));
      console.log(`WAIT ${mode}: ok=${result.ok} elapsed_ms=${result.elapsed_ms} reply=${result.replies?.[0]?.body?.trim()} (pollMs=${useWatch ? 15000 : 200}, replier fired at ~2500ms)`);
      assert.equal(result.ok, true);
      assert.equal(result.replies[0].body.trim(), 'done');
      assert.ok(result.elapsed_ms < 6000, `returned in ${result.elapsed_ms}ms`);
    } finally {
      if (prior === undefined) delete process.env.AGENT_ORCHESTRATION_STATE_HOME; else process.env.AGENT_ORCHESTRATION_STATE_HOME = prior;
      await transport.close();
      await stopBroker(broker);
      await rm(runDir, { recursive: true, force: true });
      await rm(stateHome, { recursive: true, force: true });
    }
  });
}

test('crash between sending the successor and recording it: a retry after the dedupe window sends nothing more', async () => {
  const broker = await startBroker();
  const transport = await open(broker);
  try {
    const repo = 'crash';
    const subject = ORCH_LAYOUT.mailSubject(repo, 'agent-b');
    const sends = [];
    const crashingSend = async ({ body, to, plannedId }) => {
      sends.push(plannedId);
      await transport.publishMail({ repo, agent: to, messageId: plannedId, body }); // published ...
      throw new Error('simulated crash before the successor id is recorded'); // ... then the process dies
    };
    const args = { transport, repo, messageId: 'msg-c', from: 'agent-a', reason: 'handed_off_to', to: 'agent-b', close: async () => {} };
    await assert.rejects(handoff({ ...args, send: crashingSend, probe: ({ plannedId, to }) => transport.hasMailMessage({ repo, agent: to, messageId: plannedId }) }), /simulated crash/);
    const intent = JSON.parse((await transport.getHandoff({ repo, messageId: 'msg-c' })).body).data;
    await sleep(DUP_WINDOW_MS + 600);
    const retry = await handoff({ ...args, probe: ({ plannedId, to }) => transport.hasMailMessage({ repo, agent: to, messageId: plannedId }),
      send: async ({ body, to, plannedId }) => { sends.push(plannedId); await transport.publishMail({ repo, agent: to, messageId: plannedId, body }); return { id: plannedId }; } });
    const count = await mailCount(transport, subject);
    console.log(`CRASH intent before send: state=${intent.state} planned_successor=${intent.planned_successor}; retry after ${DUP_WINDOW_MS + 600}ms: state=${retry.state} successor=${retry.successorId} sends=${sends.length} stream msgs on ${subject}=${count}`);
    assert.equal(count, 1);
    assert.equal(sends.length, 1);
    assert.equal(retry.state, 'closed');
    // Control: without the probe the same retry sends again, and the window no longer hides it.
    const control = 'msg-d';
    const controlArgs = { ...args, messageId: control };
    await assert.rejects(handoff({ ...controlArgs, send: crashingSend }), /simulated crash/);
    await sleep(DUP_WINDOW_MS + 600);
    await handoff({ ...controlArgs, send: async ({ body, to, plannedId }) => { await transport.publishMail({ repo, agent: to, messageId: plannedId, body }); return { id: plannedId }; } });
    console.log(`CRASH control (no probe) stream msgs for msg-d: ${await mailCount(transport, subject)} total on subject (expected 3 = 1 + 2)`);
    assert.equal(await mailCount(transport, subject), 3);
  } finally { await transport.close(); await stopBroker(broker); }
});

test('CLI verbs handoff, diagnose and work run for real against a temp nats-server', async () => {
  const broker = await startBroker();
  const { runDir, stateHome, env } = await waitFixture();
  const cliEnv = { ...env, AO_NATS_URL: broker.url };
  try {
    const sent = await cli(['send', '--run', runDir, '--from', 'conductor', '--to', 'agent-b', '--from-project', runDir, '--stage', 'brief', '--body', 'go', '--no-ring'], cliEnv);
    assert.equal(sent.code, 0, sent.stderr || sent.stdout);
    const messageId = JSON.parse(sent.stdout).id;
    const handoffArgs = ['handoff', '--run', runDir, '--agent', 'agent-b', '--message', messageId, '--reason', 'handed_off_to', '--to', 'conductor', '--from-project', runDir, '--json'];
    const first = await cli(handoffArgs, cliEnv);
    console.log(`CLI handoff #1 code=${first.code} out=${first.stdout.trim().replace(/\s+/g, ' ').slice(0, 600)} err=${first.stderr.trim().slice(0, 300)}`);
    assert.equal(first.code, 0, first.stderr);
    const second = await cli(handoffArgs, cliEnv);
    console.log(`CLI handoff #2 (same message) code=${second.code} out=${second.stdout.trim().replace(/\s+/g, ' ').slice(0, 300)}`);
    const a = JSON.parse(first.stdout); const b = JSON.parse(second.stdout);
    assert.deepEqual([a.ok, a.duplicate, a.state, b.duplicate, b.state], [true, false, 'closed', true, 'closed']);
    assert.equal(a.successorId, b.successorId);
    const bad = await cli(['handoff', '--run', runDir, '--agent', 'agent-b', '--message', messageId, '--reason', 'handed_off_to', '--json'], cliEnv);
    console.log(`CLI handoff without --to code=${bad.code} out=${(bad.stdout + bad.stderr).trim().replace(/\s+/g, ' ').slice(0, 200)}`);
    assert.equal(bad.code, 1);
    assert.match(bad.stdout, /TOPOLOGY_HANDOFF_TARGET/);
    assert.doesNotMatch(bad.stderr, /at .*\.mjs:\d+/, 'a refusal, not a stack trace');

    const diag = await cli(['diagnose', '--run', runDir, '--json'], cliEnv);
    console.log(`CLI diagnose code=${diag.code} out=${diag.stdout.trim().replace(/\s+/g, ' ').slice(0, 500)} err=${diag.stderr.trim().slice(0, 200)}`);
    assert.equal(diag.code, 0, diag.stderr);
    const parsed = JSON.parse(diag.stdout);
    assert.ok(parsed.events >= 3, `events mirrored from the CLI processes: ${parsed.events}`);

    const pub = await cli(['work', 'publish', '--run', runDir, '--task', 'TM-77'], cliEnv);
    const take1 = await cli(['work', 'take', '--run', runDir, '--agent', 'agent-b', '--ttl', '1m'], cliEnv);
    const take2 = await cli(['work', 'take', '--run', runDir, '--agent', 'agent-b'], cliEnv);
    console.log(`CLI work publish=${pub.stdout.trim().replace(/\s+/g, ' ')} take#1 code=${take1.code} ${take1.stdout.trim().replace(/\s+/g, ' ')} take#2(empty) code=${take2.code} ${take2.stdout.trim().replace(/\s+/g, ' ')}`);
    assert.equal(JSON.parse(take1.stdout).took, true);
    assert.equal(JSON.parse(take1.stdout).task, 'TM-77');
    assert.equal(take2.code, 2);
    assert.equal(JSON.parse(take2.stdout).empty, true);
  } finally {
    await stopBroker(broker);
    await rm(runDir, { recursive: true, force: true });
    await rm(stateHome, { recursive: true, force: true });
  }
});
