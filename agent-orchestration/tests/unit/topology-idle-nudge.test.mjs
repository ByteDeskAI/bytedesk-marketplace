// TM-408: the supervisor's idle nudge. No real tmux anywhere: the bell's own safe-to-ring logic
// (wakeForProbe -> checkBellSafe -> decideBell / styledRescue) runs against an injected fake, and the
// needs-input handoff is driven through the real census classification (takeCensus).
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { boardFingerprint, createIdleNudge, idleNudgeTick, readBoard } from '../../topology/lib/idle-nudge.mjs';
import { readStandingInbox, sendStandingMessage } from '../../topology/lib/standing-mailbox.mjs';
import { repoConfigPath } from '../../topology/lib/config.mjs';
import { generatedPrompt } from '../../topology/lib/prompts.mjs';
import { takeCensus } from '../../topology/lib/census.mjs';

const PLUGIN = fileURLToPath(new URL('../../', import.meta.url));
const MIN = 60_000;
const SINCE = '2026-10-05T00:00:00.000Z';
const T0 = Date.parse(SINCE);
const later = (ms) => new Date(T0 + ms).toISOString();
const bindingOf = (paneId, panePid) => ({ serverKey: 'fixture-server', serverPid: 1, sessionId: '$1', sessionCreated: 2, paneId, panePid });
const WORKER = bindingOf('%1', 11);
const LEAD = bindingOf('%2', 12);
const adapters = new Map([['fixture', { id: 'fixture', command: 'fixture', composer: { empty_tmux_pattern: '^ready$' }, failure_patterns: [] }]]);
const panes = [WORKER, LEAD].map((binding) => ({ ...binding, title: '✳ task', command: 'fixture', alive: true }));
const readLead = async () => ({ record: { agent_id: 'lead1' } });

const row = (agentId, binding, over = {}) => ({ agentId, repoRole: 'member', runId: null, state: 'idle', dispatchable: true, since: SINCE, needsInputAt: null, binding, ...over });
// Unit tests of the gates below run with no minimum idle time; the minimum has its own test.
const cfg = (extra = {}) => ({ idle_nudge: { min_idle_ms: 0, lead_min_idle_ms: 0, ...extra } });
const opts = (over = {}) => ({ consumer: '/fixture/repo', env: {}, home: '/nonexistent', readLead,
  readBoard: async () => ({ fingerprint: 'board-1', problem: null }), ...over });

// The fake tmux the REAL bell reads. `composer` is 'empty' or 'draft'; every look and send is counted.
function fakeTmux(composer = 'empty') {
  const fake = {
    composer, looks: 0, sent: [],
    tmux: async () => {
      fake.looks += 1;
      return { code: 0, stdout: fake.composer === 'empty' ? '1|0|0|' : '0|0|0|' };
    },
    listServerPanes: async () => panes,
    // A bright (not dim) character after the prompt glyph: a real draft, so the styled rescue refuses.
    capture: async () => '❯ \x1b[38;5;231mhalf-typed operator draft\x1b[0m',
    sendText: async (pane, text) => {
      fake.sent.push({ pane, text });
    },
  };
  return fake;
}

const tick = (input) => idleNudgeTick(input.options ?? opts(), { panes, adapters, config: cfg(), now: T0, ...input });

// Minimal POSIX word split: single quotes and whitespace, which is all shellQuote emits here.
const SQ = '\x27';
function shellWords(text) {
  const words = [];
  let word = null;
  let quoted = false;
  for (const ch of text) {
    if (quoted) {
      if (ch === SQ) quoted = false;
      else word += ch;
    } else if (ch === SQ) {
      quoted = true;
      word = word ?? '';
    } else if (/\s/.test(ch)) {
      if (word !== null) words.push(word);
      word = null;
    } else {
      word = (word ?? '') + ch;
    }
  }
  if (word !== null) words.push(word);
  return words;
}

test('an idle worker is told to ask its lead, and the mail that exact command sends reaches the lead', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'ao-idle-nudge-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const consumer = join(root, 'repo');
  await mkdir(consumer);
  const fake = fakeTmux();
  const out = await tick({ options: opts({ consumer, home: root }), census: { agents: [row('w1', WORKER)] }, tmux: fake });
  assert.deepEqual(out, [{ agent: 'w1', lead: false, rang: true }]);
  assert.equal(fake.sent.length, 1);
  assert.equal(fake.sent[0].pane, '%1');
  const text = fake.sent[0].text;
  assert.doesNotMatch(text, /tm next/);
  const argv = shellWords(text.slice(text.indexOf('ao-topology mailbox send'), text.indexOf(' then wait on your inbox')));
  const flag = (name) => argv[argv.indexOf(`--${name}`) + 1];
  assert.deepEqual(argv.slice(0, 3), ['ao-topology', 'mailbox', 'send']);
  assert.equal(flag('to'), 'lead1');
  assert.equal(flag('from'), 'w1');
  assert.equal(flag('consumer'), consumer);
  // Run what the nudge names through the real standing mailbox (file transport, no NATS).
  const env = { AGENT_ORCHESTRATION_STATE_HOME: join(root, 'state'), AO_TRANSPORT: 'file' };
  const mail = { env, router: async (query) => ({ resolved: query.to, deliver_to: query.to }) };
  await sendStandingMessage({ consumer: flag('consumer'), fromProject: flag('consumer'), from: flag('from'), to: flag('to'), subject: flag('subject'), body: flag('body') }, mail);
  const inbox = await readStandingInbox({ consumer, agent: 'lead1', ...mail });
  assert.equal(inbox.length, 1);
  assert.equal(inbox[0].envelope.to, 'lead1');
  assert.equal(inbox[0].envelope.from, 'w1');
  assert.match(inbox[0].envelope.body, /next assignment/);
  assert.equal((await readStandingInbox({ consumer, agent: 'w1', ...mail })).length, 0);
});

test('an idle lead is told to take the next ready task from its own board, not to mail anyone', async () => {
  const fake = fakeTmux();
  // repoRole 'member' on purpose: the registered lead id alone must make this agent the lead.
  const out = await tick({ census: { agents: [row('lead1', LEAD)] }, tmux: fake });
  assert.deepEqual(out, [{ agent: 'lead1', lead: true, rang: true }]);
  assert.equal(fake.sent[0].pane, '%2');
  assert.match(fake.sent[0].text, /pick the next ready task with tm next/);
  assert.match(fake.sent[0].text, /assign or dispatch it yourself/);
  assert.match(fake.sent[0].text, /report the board state once and stay idle/);
  assert.doesNotMatch(fake.sent[0].text, /mailbox send/);
});

test('an agent that just stopped (perhaps to ask a human) waits min_idle_ms from the end of its work; a lead waits lead_min_idle_ms', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'ao-idle-nudge-census-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const env = { AGENT_ORCHESTRATION_STATE_HOME: join(root, 'state') };
  const identity = { id: root, kind: 'path', git_common_dir: null };
  const roster = [{ agentId: 'w1', repoRole: 'member', session: { ...panes[0] } }, { agentId: 'lead1', repoRole: 'lead', session: { ...panes[1] } }];
  const BUSY = '✻ Whirlpooling… (8m 45s · ↓ 37.1k tokens)';
  const IDLE = '✻ Worked for 12m 29s · done 3:36 AM';
  let tail = BUSY;
  let doc = null;
  const look = async (ms) => {
    doc = await takeCensus({ env, home: root, consumer: root }, { identity, panes, agents: roster, memo: new Map(), memoMs: 0, previous: doc, capture: async () => tail, now: T0 + ms });
    return Object.fromEntries(doc.agents.map((agent) => [agent.agentId, agent]));
  };
  const fake = fakeTmux();
  const state = createIdleNudge();
  // The shipped defaults: 10 minutes for a worker, 30 for a lead.
  const nudge = (ms) => idleNudgeTick(opts(), { census: doc, panes, adapters, tmux: fake, state, now: T0 + ms, config: {} });
  assert.equal((await look(0)).w1.state, 'working');
  tail = IDLE;
  await look(2000);
  const asking = await look(4000);
  assert.equal(asking.w1.state, 'needs-input', 'the one tick in which a question and a finish look alike');
  const after = await look(6000);
  assert.equal(after.w1.state, 'idle');
  assert.equal(after.w1.dispatchable, true, 'two seconds later the census already calls it dispatchable');
  assert.equal(after.w1.needsInputAt, later(4000));
  assert.deepEqual(await nudge(6000), [], 'so the nudge must not trust dispatchable alone');
  await look(4000 + 10 * MIN - 1000);
  assert.deepEqual(await nudge(4000 + 10 * MIN - 1000), []);
  await look(4000 + 10 * MIN);
  assert.deepEqual(await nudge(4000 + 10 * MIN), [{ agent: 'w1', lead: false, rang: true }], 'the worker, once; the lead not yet');
  await look(4000 + 30 * MIN - 1000);
  assert.deepEqual(await nudge(4000 + 30 * MIN - 1000), []);
  await look(4000 + 30 * MIN);
  assert.deepEqual(await nudge(4000 + 30 * MIN), [{ agent: 'lead1', lead: true, rang: true }]);
  assert.equal(fake.sent.length, 2);
});

test('no nudge while busy, waiting on a human, not dispatchable, owned by a run, or a reviewer', async () => {
  const fake = fakeTmux();
  const agents = [
    row('busy', WORKER, { state: 'working', dispatchable: false }),
    row('asking', WORKER, { state: 'needs-input', dispatchable: false }),
    row('mail', WORKER, { dispatchable: false }),
    row('run', WORKER, { runId: 'run-1' }),
    row('rev', WORKER, { repoRole: 'reviewer' }),
  ];
  assert.deepEqual(await tick({ census: { agents }, tmux: fake }), []);
  assert.equal(fake.looks, 0);
  assert.equal(fake.sent.length, 0);
});

test('a draft in the composer types nothing, and the refusal is retried only after retry_ms', async () => {
  const fake = fakeTmux('draft');
  const state = createIdleNudge();
  const census = { agents: [row('w1', WORKER)] };
  const config = cfg({ retry_ms: 60_000 });
  const first = await tick({ census, tmux: fake, state, now: T0 + 1_000, config });
  assert.equal(first[0].rang, false);
  assert.match(first[0].reason, /composer is not empty/);
  assert.equal(fake.sent.length, 0);
  const looks = fake.looks;
  assert.deepEqual(await tick({ census, tmux: fake, state, now: T0 + 30_000, config }), []);
  assert.equal(fake.looks, looks, 'inside retry_ms the pane is not even looked at');
  fake.composer = 'empty';
  const retried = await tick({ census, tmux: fake, state, now: T0 + 61_000, config });
  assert.equal(retried[0].rang, true);
  assert.equal(fake.sent.length, 1);
});

test('after a ring, a steady board gives no repeat ring and a changed board gives exactly one', async () => {
  const fake = fakeTmux();
  const state = createIdleNudge();
  let board = 'board-1';
  const options = opts({ readBoard: async () => ({ fingerprint: board, problem: null }) });
  const at = (ms) => tick({ options, census: { agents: [row('w1', WORKER, { since: later(ms) })] }, tmux: fake, state, now: T0 + ms, config: cfg({ backoff_ms: 10 * MIN }) });
  assert.equal((await at(0))[0].rang, true);
  board = 'board-moved-while-it-sat-there';
  assert.deepEqual(await tick({ options, census: { agents: [row('w1', WORKER)] }, tmux: fake, state, now: T0 + 600 * MIN, config: cfg() }), [], 'the same idle period, however late, even if the board moved');
  board = 'board-1';
  assert.deepEqual(await at(60 * MIN), [], 'a new idle period, past the backoff, but nothing changed');
  assert.deepEqual(await at(120 * MIN), [], 'still nothing changed');
  board = 'board-2';
  assert.equal((await at(180 * MIN))[0].rang, true, 'the ready set moved');
  assert.deepEqual(await at(240 * MIN), [], 'and is steady again');
  assert.equal(fake.sent.length, 2);
});

// The loop the first rework let through: the nudge's own exchange is mail, so a mail-gated nudge
// re-armed itself every backoff. Real standing mailbox, real task store, real readBoard.
async function nudgeLoop(t, { reply }) {
  const root = await mkdtemp(join(tmpdir(), 'ao-idle-nudge-loop-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const consumer = join(root, 'repo');
  const tasks = join(consumer, '.bytedesk', 'task-management', 'tasks');
  await mkdir(tasks, { recursive: true });
  const task = (id) => writeFile(join(tasks, `${id}.md`), `---\nid: "${id}"\nstatus: "todo"\nlabels: ["ready-for-agent"]\n---\n`);
  await task('TM-1');
  const env = { AGENT_ORCHESTRATION_STATE_HOME: join(root, 'state'), AO_TRANSPORT: 'file' };
  const mail = { env, router: async (query) => ({ resolved: query.to, deliver_to: query.to }) };
  const options = opts({ consumer, env, home: root, readBoard: undefined });
  const fake = fakeTmux();
  const state = createIdleNudge({ path: join(root, 'state', 'nudge.json') });
  const config = cfg({ backoff_ms: 30 * MIN });
  const at = (ms) => idleNudgeTick(options, { census: { agents: [row('w1', WORKER, { since: later(ms) })] }, panes, adapters, tmux: fake, state, now: T0 + ms, config });
  const rings = [];
  const run = async (ms) => {
    if ((await at(ms)).some((item) => item.rang)) rings.push(ms / MIN);
  };
  await run(0);
  // The worker does what it was told, and the lead answers: two pieces of mail, board unchanged.
  await sendStandingMessage({ consumer, fromProject: consumer, from: 'w1', to: 'lead1', body: 'what is my next assignment?' }, mail);
  if (reply) await sendStandingMessage({ consumer, fromProject: consumer, from: 'lead1', to: 'w1', body: 'nothing ready' }, mail);
  for (let minute = 30; minute <= 360; minute += 30) await run(minute * MIN);
  assert.deepEqual(rings, [0], 'six hours of a steady board: exactly one ring');
  await task('TM-2');
  await run(390 * MIN);
  await task('TM-3');
  await run(400 * MIN);
  await run(420 * MIN);
  await run(450 * MIN);
  return rings;
}

test('the worker asks, the lead replies "nothing ready", the board is steady: no second ring; a later board change gets one, then the floor doubles', async (t) => {
  assert.deepEqual(await nudgeLoop(t, { reply: true }), [0, 390, 450], 'after ring two the floor is 60 minutes, not 30');
});

test('control: with no reply at all, the same steady board also gets exactly one ring', async (t) => {
  assert.deepEqual(await nudgeLoop(t, { reply: false }), [0, 390, 450]);
});

test('a ring that can never succeed reads neither the task store nor anything else', async () => {
  let reads = 0;
  const readBoardCounted = async () => {
    reads += 1;
    return { fingerprint: 'b', problem: null };
  };
  const fake = fakeTmux();
  const noLead = opts({ readLead: async () => null, readBoard: readBoardCounted });
  for (let minute = 0; minute < 10; minute += 1) await tick({ options: noLead, census: { agents: [row('w1', WORKER)] }, tmux: fake, now: T0 + minute * MIN });
  const bare = new Map([['fixture', { id: 'fixture', command: 'fixture' }]]);
  const state = createIdleNudge();
  for (let minute = 0; minute < 10; minute += 1) await idleNudgeTick(opts({ readBoard: readBoardCounted }), { census: { agents: [row('w1', WORKER)] }, panes, adapters: bare, tmux: fake, state, now: T0 + minute * MIN, config: cfg() });
  assert.equal(reads, 0);
  assert.equal(fake.looks + fake.sent.length, 0);
});

test('a restarted supervisor reloads who it rang and does not re-ring; a corrupt file reads as empty', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'ao-idle-nudge-state-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const path = join(root, 'supervision', 'repo.idle-nudge.json');
  const fake = fakeTmux();
  const at = (state, ms, since = SINCE) => tick({ census: { agents: [row('w1', WORKER, { since })] }, tmux: fake, state, now: T0 + ms });
  assert.equal((await at(createIdleNudge({ path }), 0))[0].rang, true);
  const saved = JSON.parse(await readFile(path, 'utf8'));
  assert.equal(saved.agents.w1.rangSince, SINCE);
  assert.deepEqual(await at(createIdleNudge({ path }), 60 * MIN), [], 'restart, same idle period');
  assert.deepEqual(await at(createIdleNudge({ path }), 120 * MIN, later(100 * MIN)), [], 'restart, new period, nothing changed');
  assert.equal(fake.sent.length, 1);
  await writeFile(path, '{not json');
  assert.equal((await at(createIdleNudge({ path }), 180 * MIN))[0].rang, true, 'a corrupt file is an empty memory, not a crash');
});

test('the same refusal is reported once per idle period', async () => {
  const fake = fakeTmux();
  const state = createIdleNudge();
  const options = opts({ readLead: async () => null });
  const at = (ms, since = SINCE) => tick({ options, census: { agents: [row('w1', WORKER, { since })] }, tmux: fake, state, now: T0 + ms, config: cfg({ retry_ms: MIN }) });
  const first = await at(0);
  assert.equal(first.length, 1);
  assert.match(first[0].reason, /no registered repository lead/);
  assert.deepEqual(await at(2 * MIN), [], 'retried, refused the same way, not reported again');
  assert.equal((await at(4 * MIN, later(3 * MIN))).length, 1, 'a new idle period reports it again');
  assert.equal(fake.looks + fake.sent.length, 0);
});

test('the board fingerprint moves with the ready set, not with body edits, and matches the label exactly', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'ao-idle-nudge-board-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const dir = join(root, '.bytedesk', 'task-management', 'tasks');
  await mkdir(dir, { recursive: true });
  const task = (id, status, labels, body = '') => writeFile(join(dir, `${id}.md`), `---\nid: "${id}"\nstatus: "${status}"\nlabels: ${JSON.stringify(labels)}\n---\n${body}\n`);
  assert.deepEqual(await readBoard(join(root, 'no-store')), { fingerprint: null, problem: null });
  await task('TM-1', 'todo', ['ready-for-agent']);
  await task('TM-2', 'todo', ['needs-triage']);
  const first = await boardFingerprint(root);
  assert.equal(typeof first, 'string');
  await task('TM-1', 'todo', ['ready-for-agent'], 'a new comment\nstatus: "done"');
  await task('TM-2', 'in_progress', ['needs-triage']);
  assert.equal(await boardFingerprint(root), first, 'a comment, and a task that is not ready, move nothing');
  await writeFile(join(dir, 'TM-3.md'), '---\nid: "TM-3"\n---\nquoted from another task:\nstatus: "todo"\nlabels: ["ready-for-agent"]\n');
  assert.equal(await boardFingerprint(root), first, 'only the frontmatter is read: a body that quotes one is not a ready task');
  await task('TM-2', 'todo', ['not-ready-for-agent']);
  assert.equal(await boardFingerprint(root), first, 'a label that merely contains the words is not the label');
  await task('TM-2', 'todo', ['ready-for-agent']);
  const second = await boardFingerprint(root);
  assert.notEqual(second, first, 'a task became ready');
  await task('TM-2', 'blocked', ['ready-for-agent']);
  assert.notEqual(await boardFingerprint(root), second, 'a ready task changed status');
  await task('TM-2', 'todo', ['ready-for-agent']);
  assert.equal(await boardFingerprint(root), second);
  await task('TM-1', 'done', ['ready-for-agent']);
  assert.notEqual(await boardFingerprint(root), second, 'a ready task finished');
});

test('task files with no status line at all are a format change: null, and reported once', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'ao-idle-nudge-format-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const dir = join(root, '.bytedesk', 'task-management', 'tasks');
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, 'TM-1.md'), '+++\nstate = "todo"\n+++\n');
  const read = await readBoard(root);
  assert.equal(read.fingerprint, null);
  assert.match(read.problem, /no status: line|has a status: line/);
  const fake = fakeTmux();
  const state = createIdleNudge();
  const options = opts({ consumer: root, readBoard: undefined });
  const at = (ms) => tick({ options, census: { agents: [row('w1', WORKER, { since: later(ms) })] }, tmux: fake, state, now: T0 + ms, config: cfg({ backoff_ms: MIN }) });
  assert.deepEqual(await at(0), [{ agent: 'w1', lead: false, rang: true }]);
  const second = await at(10 * MIN);
  assert.deepEqual(second, [{ board: read.problem }], 'reported, and an unreadable board never reopens the gate');
  assert.deepEqual(await at(20 * MIN), []);
  assert.equal(fake.sent.length, 1);
});

test('the shipped default is on, and idle_nudge.enabled false in the repo layer turns it off', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'ao-idle-nudge-config-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const consumer = join(root, 'repo');
  await mkdir(consumer);
  const options = opts({ consumer, env: { XDG_CONFIG_HOME: join(root, 'xdg') }, home: join(root, 'home'), pluginRoot: PLUGIN });
  const census = { agents: [row('w1', WORKER)] };
  const shipped = JSON.parse(await readFile(join(PLUGIN, 'config.defaults.json'), 'utf8'));
  assert.equal(shipped.idle_nudge.enabled, true);
  assert.equal(shipped.idle_nudge.min_idle_ms, 10 * MIN);
  assert.equal(shipped.idle_nudge.lead_min_idle_ms, 30 * MIN);
  const on = fakeTmux();
  assert.equal((await idleNudgeTick(options, { census, panes, adapters, tmux: on, now: T0 + 11 * MIN }))[0].rang, true);
  await mkdir(dirname(repoConfigPath(consumer)), { recursive: true });
  await writeFile(repoConfigPath(consumer), JSON.stringify({ idle_nudge: { enabled: false } }));
  const off = fakeTmux();
  assert.deepEqual(await idleNudgeTick(options, { census, panes, adapters, tmux: off, now: T0 + 11 * MIN }), []);
  assert.equal(off.looks, 0);
  assert.equal(off.sent.length, 0);
});

test('the pull rule is stated in the common protocols, the lead template, every role pack and the generated protocol', async () => {
  const read = (path) => readFile(join(PLUGIN, path), 'utf8');
  const RULE = /never ask the\s+operator\s+what is next/i;
  const packs = (await readdir(join(PLUGIN, 'roles'))).filter((name) => name.endsWith('.md')).map((name) => `roles/${name}`);
  assert.ok(packs.length >= 9, `found ${packs.length} role packs`);
  for (const path of ['prompts/common.md', 'prompts/common-reviewer.md', 'prompts/lead.md', ...packs]) assert.match(await read(path), RULE, path);
  assert.match(await read('prompts/common.md'), /ao-topology mailbox send --consumer/);
  assert.match(await read('prompts/common.md'), /ao-topology lead status --consumer/);
  assert.match(await read('prompts/lead.md'), /tm next/);
  assert.match(await read('prompts/lead.md'), /report the board state once/);
  const agent = (role, extra = {}) => ({ id: 'a1', full_name: 'A One', title: 'Agent', role, ...extra });
  const worker = generatedPrompt(agent('worker'), '/c', '/d');
  assert.match(worker, /ao-topology mailbox send --consumer \/c --to \x3clead-id\x3e/);
  assert.match(worker, /ao-topology lead status --consumer \/c/);
  assert.match(generatedPrompt(agent('lead'), '/c', '/d'), /never ask the operator what is next\. Take the next ready task/);
  assert.match(generatedPrompt(agent('reviewer'), '/c', '/d'), RULE);
  assert.doesNotMatch(generatedPrompt(agent('worker', { _prompt_vars: { run_dir: '/r' } }), '/c', '/d'), /mailbox send/);
});

test('memory for an agent gone from the census and untried for 7 days is pruned; a recent one is kept', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'ao-idle-nudge-prune-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const path = join(root, 'nudge.json');
  const DAY = 24 * 60 * MIN;
  await writeFile(path, JSON.stringify({ version: 1, agents: { ghost: { triedAt: T0 - 8 * DAY }, recent: { triedAt: T0 - DAY } } }));
  const state = createIdleNudge({ path });
  assert.equal((await tick({ census: { agents: [row('w1', WORKER)] }, tmux: fakeTmux(), state }))[0].rang, true);
  const saved = JSON.parse(await readFile(path, 'utf8'));
  assert.deepEqual(Object.keys(saved.agents).sort(), ['recent', 'w1']);
});

// Cost: a supervisor ticks every few seconds for days. These pin how often it touches disk.
const TICK = 15_000;

test('a rung agent sitting idle for a day reads the board at most once per retry_ms', async () => {
  let reads = 0;
  const options = opts({ readBoard: async () => {
    reads += 1;
    return { fingerprint: 'steady', problem: null };
  } });
  const fake = fakeTmux();
  const state = createIdleNudge();
  const config = cfg({ retry_ms: MIN, backoff_ms: 30 * MIN });
  let ticks = 0;
  let rings = 0;
  for (let ms = 0; ms <= 24 * 60 * MIN; ms += TICK) {
    // After the ring the agent answered and went idle again: a new idle period from minute 1 on.
    const since = ms < MIN ? SINCE : later(MIN);
    const out = await tick({ options, census: { agents: [row('w1', WORKER, { since })] }, tmux: fake, state, now: T0 + ms, config });
    rings += out.filter((item) => item.rang).length;
    ticks += 1;
  }
  assert.equal(rings, 1);
  assert.ok(reads <= ticks / (MIN / TICK) + 1, `${reads} board reads in ${ticks} ticks`);
});

test('a refusal repeated every retry_ms does not rewrite the state file', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'ao-idle-nudge-writes-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const path = join(root, 'nudge.json');
  const state = createIdleNudge({ path });
  const options = opts({ readLead: async () => null });
  const at = (ms) => tick({ options, census: { agents: [row('w1', WORKER)] }, tmux: fakeTmux(), state, now: T0 + ms, config: cfg({ retry_ms: MIN }) });
  assert.equal((await at(0)).length, 1, 'the first refusal is reported, and written');
  await readFile(path, 'utf8');
  await rm(path);
  for (let ms = TICK; ms <= 60 * MIN; ms += TICK) assert.deepEqual(await at(ms), []);
  await assert.rejects(readFile(path, 'utf8'), { code: 'ENOENT' }, 'an hour of identical refusals wrote nothing');
});

test('the lead registration is read at most once per retry_ms', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'ao-idle-nudge-cache-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const consumer = join(root, 'repo');
  await mkdir(dirname(repoConfigPath(consumer)), { recursive: true });
  await writeFile(repoConfigPath(consumer), JSON.stringify(cfg({ retry_ms: MIN })));
  let leadReads = 0;
  const options = opts({ consumer, env: { XDG_CONFIG_HOME: join(root, 'xdg') }, home: join(root, 'home'), pluginRoot: PLUGIN,
    readLead: async () => {
      leadReads += 1;
      return null;
    } });
  const state = createIdleNudge();
  const at = (ms) => idleNudgeTick(options, { census: { agents: [row('w1', WORKER)] }, panes, adapters, tmux: fakeTmux(), state, now: T0 + ms });
  let ticks = 0;
  for (let ms = 0; ms < 10 * MIN; ms += TICK) {
    await at(ms);
    ticks += 1;
  }
  assert.ok(leadReads <= ticks / (MIN / TICK) + 1, `${leadReads} lead reads in ${ticks} ticks`);
  assert.ok(leadReads >= 2, 'and it is re-read once the cache expires');
});

test('config is read at most once per retry_ms, so the off switch lands within one retry_ms', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'ao-idle-nudge-config-cache-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const consumer = join(root, 'repo');
  await mkdir(dirname(repoConfigPath(consumer)), { recursive: true });
  await writeFile(repoConfigPath(consumer), JSON.stringify(cfg({ retry_ms: MIN })));
  const options = opts({ consumer, env: { XDG_CONFIG_HOME: join(root, 'xdg') }, home: join(root, 'home'), pluginRoot: PLUGIN });
  const state = createIdleNudge();
  const fake = fakeTmux();
  const at = (agentId, ms) => idleNudgeTick(options, { census: { agents: [row(agentId, WORKER)] }, panes, adapters, tmux: fake, state, now: T0 + ms });
  assert.equal((await at('w1', 0))[0].rang, true);
  await writeFile(repoConfigPath(consumer), JSON.stringify(cfg({ retry_ms: MIN, enabled: false })));
  assert.equal((await at('w2', 30_000))[0].rang, true, 'inside retry_ms the cached config still says on');
  assert.deepEqual(await at('w3', 61_000), [], 're-read after retry_ms: off');
  assert.equal(fake.sent.length, 2);
});
