// TM-408: the supervisor's idle nudge. No real tmux anywhere: the bell's own safe-to-ring logic
// (wakeForProbe -> checkBellSafe -> decideBell / styledRescue) runs against an injected fake, and the
// needs-input handoff is driven through the real census classification (takeCensus).
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { boardFingerprint, createIdleNudge, idleNudgeTick, mailMark } from '../../topology/lib/idle-nudge.mjs';
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
  boardFingerprint: async () => 'board-1', mailMark: async () => '0:', ...over });

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
  const before = await mailMark('lead1', { env, home: root });
  await sendStandingMessage({ consumer: flag('consumer'), fromProject: flag('consumer'), from: flag('from'), to: flag('to'), subject: flag('subject'), body: flag('body') }, mail);
  const inbox = await readStandingInbox({ consumer, agent: 'lead1', ...mail });
  assert.equal(inbox.length, 1);
  assert.equal(inbox[0].envelope.to, 'lead1');
  assert.equal(inbox[0].envelope.from, 'w1');
  assert.match(inbox[0].envelope.body, /next assignment/);
  assert.equal((await readStandingInbox({ consumer, agent: 'w1', ...mail })).length, 0);
  // That mail is what reopens the lead's change gate, and the worker's stays shut.
  assert.notEqual(await mailMark('lead1', { env, home: root }), before);
  assert.equal(await mailMark('w1', { env, home: root }), '0:');
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
  const options = opts({ boardFingerprint: async () => board });
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

test('new mail reopens the gate, the backoff floor still holds, and it doubles per ring', async () => {
  const fake = fakeTmux();
  const state = createIdleNudge();
  let mail = '0:';
  let board = 'b0';
  const options = opts({ mailMark: async () => mail, boardFingerprint: async () => board });
  const at = (ms) => tick({ options, census: { agents: [row('w1', WORKER, { since: later(ms) })] }, tmux: fake, state, now: T0 + ms, config: cfg({ backoff_ms: 10 * MIN, max_backoff_ms: 100 * MIN }) });
  assert.equal((await at(0))[0].rang, true);
  mail = '1:x';
  assert.deepEqual(await at(5 * MIN), [], 'new mail, but inside the 10-minute floor');
  assert.equal((await at(10 * MIN))[0].rang, true, 'new mail, floor over');
  board = 'b1';
  assert.equal((await at(20 * MIN))[0].rang, true, 'second ring since the mail: floor was 10 minutes');
  board = 'b2';
  assert.deepEqual(await at(30 * MIN), [], 'third ring would need 20 minutes');
  assert.equal((await at(40 * MIN))[0].rang, true);
  assert.equal(fake.sent.length, 4);
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

test('the board fingerprint moves with the ready set, not with body edits', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'ao-idle-nudge-board-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const dir = join(root, '.bytedesk', 'task-management', 'tasks');
  await mkdir(dir, { recursive: true });
  const task = (id, status, labels, body = '') => writeFile(join(dir, `${id}.md`), `---\nid: "${id}"\nstatus: "${status}"\nlabels: ${JSON.stringify(labels)}\n---\n${body}\n`);
  assert.equal(await boardFingerprint(join(root, 'no-store')), null);
  await task('TM-1', 'todo', ['ready-for-agent']);
  await task('TM-2', 'todo', ['needs-triage']);
  const first = await boardFingerprint(root);
  await task('TM-1', 'todo', ['ready-for-agent'], 'a new comment');
  await task('TM-2', 'in_progress', ['needs-triage']);
  assert.equal(await boardFingerprint(root), first, 'a comment, and a task that is not ready, move nothing');
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
