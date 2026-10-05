// TM-351 / TM-352: the receive side of standing mail. No tmux server is touched: every tmux call
// goes through a stub, so nothing here can ring a real pane.
import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import { mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readStandingInbox, ringStandingMail, sendStandingMessage } from '../../topology/lib/standing-mailbox.mjs';
import { listMailboxReceipts } from '../../topology/lib/mailbox-receipts.mjs';
import { loadAdapters } from '../../topology/lib/providers.mjs';
import { agentsRoot } from '../../topology/lib/agents.mjs';
import { writeJson } from '../../topology/lib/util.mjs';
import { superviseRepository } from '../../topology/lib/supervision.mjs';
import { initTempRepo } from '../helpers/temp-repo.mjs';

const READY = { status: 'responsive', record: { agent_id: 'lead0001' }, library_lead: 'lead0001' };
const BINDING = { serverKey: '/tmp/ao-test-never-a-real-socket', serverPid: 1, sessionId: '$1', sessionCreated: 1, paneId: '%9', panePid: 2 };

async function fixture(t) {
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
  return { consumer, env, home, opts, send, adapters, panes };
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

test('TM-351: the supervisor tick rings delivered standing mail (wiring, no tmux server)', async t => {
  const root = await mkdtemp(join(tmpdir(), 'standing-ring-supervise-')); t.after(() => rm(root, { recursive: true, force: true }));
  const repo = join(root, 'repo'), home = join(root, 'home');
  // tmux-test-isolation: TMUX blank, a per-test TMUX_TMPDIR, and a server name that never exists.
  mkdirSync(join(root, 'tmux'), { recursive: true });
  const env = { ...process.env, TMUX: '', TMUX_TMPDIR: join(root, 'tmux'), AGENT_ORCHESTRATION_STATE_HOME: join(root, 'state'), XDG_CONFIG_HOME: join(home, '.config') };
  await initTempRepo(repo);
  await writeJson(join(agentsRoot(repo), 'lead0001', 'agent.json'), { id: 'lead0001', role: 'lead', full_name: 'lead0001' });
  const sent = await sendStandingMessage({ id: 'm-tick', consumer: repo, fromProject: repo, from: 'lead0001', to: 'lead0001', body: 'body' }, { env, home });
  assert.equal(sent.status, 'delivered');
  const report = await superviseRepository({ consumer: repo, home, env, tmuxServer: `ao-absent-${process.pid}-${Date.now()}` }, { once: true });
  assert.deepEqual(report.mail_rings?.map(r => [r.id, r.agent, r.state, r.reason]), [['m-tick', 'lead0001', 'held', 'the recipient has no live pane']]);
});
