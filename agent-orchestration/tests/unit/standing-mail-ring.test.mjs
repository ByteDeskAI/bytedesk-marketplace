// TM-351 / TM-352: the receive side of standing mail. No tmux server is touched: every tmux call
// goes through a stub, so nothing here can ring a real pane.
import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import { mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readStandingInbox, recordStandingReply, ringStandingMail, sendStandingMessage, waitForStandingReply } from '../../topology/lib/standing-mailbox.mjs';
import { listMailboxReceipts, setMailboxDisposition } from '../../topology/lib/mailbox-receipts.mjs';
import { loadAdapters } from '../../topology/lib/providers.mjs';
import { agentsRoot } from '../../topology/lib/agents.mjs';
import { writeJson } from '../../topology/lib/util.mjs';
import { superviseRepository } from '../../topology/lib/supervision.mjs';
import { initTempRepo } from '../helpers/temp-repo.mjs';

const READY = { status: 'responsive', record: { agent_id: 'lead0001' }, library_lead: 'lead0001' };
const BINDING = { serverKey: '/tmp/ao-test-never-a-real-socket', serverPid: 1, sessionId: '$1', sessionCreated: 1, paneId: '%9', panePid: 2 };

async function fixture(t, { seed = true } = {}) {
  const root = await mkdtemp(join(tmpdir(), 'standing-ring-')); t.after(() => rm(root, { recursive: true, force: true }));
  const source = join(root, 'source'), consumer = join(root, 'destination'), home = join(root, 'home');
  await Promise.all([source, consumer, home].map(p => mkdir(p, { recursive: true })));
  const env = { AGENT_ORCHESTRATION_STATE_HOME: join(root, 'state'), AGENT_ORCHESTRATION_SERVICES: '0' };
  const opts = { env, home, readiness: async () => READY, enrollment: async () => ({ enrolled: true }),
    requestRecovery: async () => {}, activate: async () => ({}) };
  for (const [id, role] of [['lead0001', 'lead']]) await writeJson(join(agentsRoot(consumer), id, 'agent.json'), { id, role, full_name: id });
  const send = id => sendStandingMessage({ id, consumer, fromProject: source, from: 'send0001', to: 'lead0001', body: 'SECRET full request body' }, opts);
  const adapters = await loadAdapters([join(process.cwd(), 'providers')]);
  const panes = [{ agentId: 'lead0001', command: 'claude', ...BINDING }];
  // TM-419: the ring only rings mail delivered after it first ran here, so seed it unless a test
  // wants the backlog case.
  if (seed) assert.deepEqual(await ringStandingMail({ consumer, env, home, adapters, panes, ringDeps: forbidden }), []);
  return { consumer, source, env, home, opts, send, adapters, panes };
}

/** A pane whose composer is empty unless `full()` says otherwise; records every typed pointer. */
function pane({ full = () => false } = {}) {
  const typed = [];
  return { typed, deps: {
    tmux: {
      tmux: async () => ({ code: 0, stdout: full() ? '0|0|0|\n' : '3|0|0|\n' }),
      captureAll: async () => '❯  \n',
      capture: async () => '',
      listServerPanes: async () => [BINDING],
      sendKeys: async () => { throw new Error('nothing but the pointer may be sent'); },
    },
    deliverPointer: async (_pane, _adapter, pointer) => { typed.push(pointer); return { delivered: true, attempts: 1 }; },
  } };
}
const forbidden = { tmux: new Proxy({}, { get(_t, prop) { throw new Error(`tmux.${String(prop)} touched on a path that must not ring`); } }),
  deliverPointer: () => { throw new Error('rang twice'); } };

test('TM-351: delivered standing mail rings an idle recipient once, with no inbox call', async t => {
  const { consumer, env, home, send, adapters, panes } = await fixture(t);
  const sent = await send('m-idle');
  assert.equal(sent.status, 'delivered');
  const bell = pane();
  const [first] = await ringStandingMail({ consumer, env, home, adapters, panes, ringDeps: bell.deps });
  assert.equal(first.state, 'submitted');
  assert.equal(first.done, true);
  assert.equal(bell.typed.length, 1);
  assert.match(bell.typed[0], /m-idle/);
  assert.match(bell.typed[0], /ao-topology mailbox inbox --consumer \S+ --agent lead0001/);
  assert.doesNotMatch(bell.typed[0], /SECRET/, 'the ring is a pointer, never the body');
  assert.deepEqual(await listMailboxReceipts({ consumer, env, home }), [], 'the recipient never read its inbox');
  // Idempotent across ticks and across a supervisor restart: the marker is on disk.
  assert.deepEqual(await ringStandingMail({ consumer, env, home, adapters, panes, ringDeps: forbidden }), []);
});

test('TM-351: a held ring never types into a full composer and is retried next tick', async t => {
  const { consumer, env, home, send, adapters, panes } = await fixture(t);
  await send('m-busy');
  let composerFull = true;
  const bell = pane({ full: () => composerFull });
  const [held] = await ringStandingMail({ consumer, env, home, adapters, panes, windowMs: 200, ringDeps: bell.deps });
  assert.deepEqual([held.state, held.done, bell.typed.length], ['held', false, 0]);
  composerFull = false;
  const [rung] = await ringStandingMail({ consumer, env, home, adapters, panes, ringDeps: bell.deps });
  assert.deepEqual([rung.state, rung.done, rung.attempts, bell.typed.length], ['submitted', true, 2, 1]);
});

test('TM-351: mail with no live pane is held, and mail already read is never rung', async t => {
  const { consumer, env, home, send, adapters, panes } = await fixture(t);
  await send('m-nopane');
  const [held] = await ringStandingMail({ consumer, env, home, adapters, panes: [], ringDeps: forbidden });
  assert.deepEqual([held.state, held.done], ['held', false]);
  await readStandingInbox({ consumer, agent: 'lead0001', env, home });
  const [read] = await ringStandingMail({ consumer, env, home, adapters, panes, ringDeps: forbidden });
  assert.deepEqual([read.state, read.done], ['read', true]);
});

test('TM-352: wait returns the reply, times out naming the message, and refuses an unknown id', async t => {
  const { consumer, source, env, home, send } = await fixture(t);
  await send('m-wait');
  const caller = { agent: 'send0001', consumer: source }; // TM-465: the sender is the one who waits
  await assert.rejects(waitForStandingReply({ id: 'm-wait', timeoutMs: 50, env, home }), { code: 'TOPOLOGY_SOURCE_IDENTITY_REQUIRED' });
  await assert.rejects(waitForStandingReply({ id: 'm-wait', caller: { ...caller, agent: 'someone-else' }, timeoutMs: 50, env, home }), { code: 'TOPOLOGY_SENDER_MISMATCH' });
  const timeout = await waitForStandingReply({ id: 'm-wait', caller, timeoutMs: 50, pollMs: 10, env, home });
  assert.equal(timeout.ok, false);
  assert.equal(timeout.code, 'TOPOLOGY_MAILBOX_WAIT_TIMEOUT');
  assert.match(timeout.message, /m-wait/);
  await assert.rejects(waitForStandingReply({ id: 'no-such-id', caller, timeoutMs: 50, env, home }), { code: 'TOPOLOGY_MESSAGE_NOT_FOUND' });
  const waiting = waitForStandingReply({ id: 'm-wait', caller, timeoutMs: 5000, pollMs: 20, env, home });
  await recordStandingReply({ consumer, messageId: 'm-wait', agentId: 'lead0001', body: 'the answer', home,
    env: { ...env, AO_AGENT_ID: 'lead0001', AO_CONSUMER: consumer } });
  const answered = await waiting;
  assert.equal(answered.ok, true);
  assert.equal(answered.reply.body, 'the answer');
});

test('TM-351: the supervisor tick rings delivered standing mail (wiring, no tmux server)', async t => {
  const root = await mkdtemp(join(tmpdir(), 'standing-ring-supervise-')); t.after(() => rm(root, { recursive: true, force: true }));
  const repo = join(root, 'repo'), home = join(root, 'home');
  // tmux-test-isolation: TMUX blank, a per-test TMUX_TMPDIR, and a server name that never exists.
  mkdirSync(join(root, 'tmux'), { recursive: true });
  const env = { ...process.env, TMUX: '', TMUX_TMPDIR: join(root, 'tmux'), AGENT_ORCHESTRATION_STATE_HOME: join(root, 'state'), XDG_CONFIG_HOME: join(home, '.config') };
  await initTempRepo(repo);
  await writeJson(join(agentsRoot(repo), 'lead0001', 'agent.json'), { id: 'lead0001', role: 'lead', full_name: 'lead0001' });
  await ringStandingMail({ consumer: repo, env, home, panes: [] }); // TM-419 seed: m-tick is new mail, not backlog
  const sent = await sendStandingMessage({ id: 'm-tick', consumer: repo, fromProject: repo, from: 'lead0001', to: 'lead0001', body: 'body' }, { env, home });
  assert.equal(sent.status, 'delivered');
  const report = await superviseRepository({ consumer: repo, home, env, tmuxServer: `ao-absent-${process.pid}-${Date.now()}` }, { once: true });
  assert.deepEqual(report.mail_rings?.map(r => [r.id, r.agent, r.state, r.reason]), [['m-tick', 'lead0001', 'held', 'the recipient has no live pane']]);
});

test('TM-352: ao-topology mailbox wait exits 2 naming the message on timeout, 1 on an unknown id, 0 with the reply', async t => {
  const { consumer, source, env, home, send } = await fixture(t);
  await send('m-cli');
  const { spawnSync } = await import('node:child_process');
  const cli = (...args) => spawnSync(process.execPath, [join(process.cwd(), 'topology/cli.mjs'), 'mailbox', 'wait', ...args, '--consumer', consumer, '--json'],
    { env: { ...process.env, ...env, HOME: home, TMUX: '', AO_AGENT_ID: 'send0001', AO_CONSUMER: source }, encoding: 'utf8' });
  const timeout = cli('m-cli', '--timeout', '100ms', '--poll', '20ms');
  assert.equal(timeout.status, 2, timeout.stderr);
  assert.equal(JSON.parse(timeout.stdout).code, 'TOPOLOGY_MAILBOX_WAIT_TIMEOUT');
  assert.match(JSON.parse(timeout.stdout).message, /m-cli/);
  const unknown = cli('no-such-id', '--timeout', '100ms');
  assert.equal(unknown.status, 1);
  assert.equal(JSON.parse(unknown.stdout).ok, false);
  assert.equal(JSON.parse(unknown.stdout).code, 'TOPOLOGY_MESSAGE_NOT_FOUND');
  await recordStandingReply({ consumer, messageId: 'm-cli', agentId: 'lead0001', body: 'cli answer', home, env: { ...env, AO_AGENT_ID: 'lead0001', AO_CONSUMER: consumer } });
  const answered = cli('m-cli', '--timeout', '5s');
  assert.equal(answered.status, 0, answered.stderr);
  assert.equal(JSON.parse(answered.stdout).reply.body, 'cli answer');
});

test('TM-351: the ring pointer never carries control characters from the sender', async () => {
  const { standingRingPointer } = await import('../../topology/lib/standing-mailbox.mjs');
  const pointer = standingRingPointer({ envelope: { id: 'm1', from: 'evil\x1b[2J\rrm -rf ~\n' }, delivered_to: 'a1' }, '/repo');
  assert.doesNotMatch(pointer, /[\x00-\x1f\x7f]/);
});

// TM-419: on 2026-10-05 the first live tick rang a lead about 20 times for mail it had handled weeks
// earlier, or that its inbox could not show (records from before NATS publication existed).
test('TM-419: a replayed backlog of old handled mail rings nothing; one new unread message rings once across a restart', async t => {
  const { consumer, env, home, send, adapters, panes } = await fixture(t, { seed: false });
  for (const id of ['old-1', 'old-2', 'old-3']) assert.equal((await send(id)).status, 'delivered');
  await readStandingInbox({ consumer, agent: 'lead0001', env, home });
  await setMailboxDisposition({ consumer, agent: 'lead0001', messageId: 'old-1', disposition: 'handled', env, home });
  await setMailboxDisposition({ consumer, agent: 'lead0001', messageId: 'old-2', disposition: 'deferred', env, home });
  await send('old-unread'); // never read, but it predates the ring: backlog, not news
  assert.deepEqual(await ringStandingMail({ consumer, env, home, adapters, panes, ringDeps: forbidden }), [], 'the backlog rang');
  assert.deepEqual(await ringStandingMail({ consumer, env, home, adapters, panes, ringDeps: forbidden }), [], 'the backlog rang on a second tick');
  await send('m-new');
  const bell = pane();
  const rung = await ringStandingMail({ consumer, env, home, adapters, panes, ringDeps: bell.deps });
  assert.deepEqual(rung.map(r => [r.id, r.state]), [['m-new', 'submitted']]);
  assert.equal(bell.typed.length, 1);
  // A restarted supervisor is a fresh call over the same disk state.
  assert.deepEqual(await ringStandingMail({ consumer, env, home, adapters, panes, ringDeps: forbidden }), []);
});

test('TM-419: mail delivered after the seed is still not rung once handled or deferred, or when the inbox cannot show it', async t => {
  const { consumer, env, home, send, adapters, panes } = await fixture(t);
  for (const id of ['h-1', 'd-1', 'f-1']) await send(id);
  // Under NATS the inbox is fed by the broker; a record never published there is invisible to it.
  assert.deepEqual(await ringStandingMail({ consumer, env, home, adapters, panes, transport: { kind: 'nats' }, ringDeps: forbidden }), []);
  await readStandingInbox({ consumer, agent: 'lead0001', env, home });
  await setMailboxDisposition({ consumer, agent: 'lead0001', messageId: 'h-1', disposition: 'handled', env, home });
  await setMailboxDisposition({ consumer, agent: 'lead0001', messageId: 'd-1', disposition: 'deferred', env, home });
  const results = await ringStandingMail({ consumer, env, home, adapters, panes, ringDeps: forbidden });
  assert.deepEqual(results.map(r => [r.id, r.state]).sort(), [['d-1', 'read'], ['f-1', 'read'], ['h-1', 'read']]);
});

test('TM-419: the inbox and the ring share one membership predicate', async () => {
  const { standingInboxShows, standingUnread } = await import('../../topology/lib/standing-mailbox.mjs');
  const record = { status: 'delivered', delivered_to: 'a1', envelope: { destinationRepoId: 'r' }, publication: { status: 'file' } };
  const scope = { repoId: 'r', agent: 'a1', transportKind: 'file' };
  assert.equal(standingInboxShows(record, scope), true);
  assert.equal(standingInboxShows(record, { ...scope, agent: 'a2' }), false, 'mail for another agent');
  assert.equal(standingInboxShows(record, { ...scope, transportKind: 'nats' }), false, 'unpublished under NATS');
  assert.equal(standingInboxShows({ ...record, publication: { status: 'published' } }, { ...scope, transportKind: 'nats' }), true);
  assert.equal(standingUnread(record, { ...scope, receipt: null }), true);
  assert.equal(standingUnread(record, { ...scope, receipt: { status: 'deferred' } }), false);
  assert.equal(standingUnread({ ...record, reply: { body: 'x' } }, { ...scope, receipt: null }), false);
});
