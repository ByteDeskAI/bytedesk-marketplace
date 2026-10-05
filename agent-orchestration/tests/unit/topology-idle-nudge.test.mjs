// TM-408: the supervisor's idle nudge. No real tmux anywhere: the bell's own safe-to-ring logic
// (wakeForProbe -> checkBellSafe -> decideBell / styledRescue) runs against an injected fake.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createIdleNudge, idleNudgeTick } from '../../topology/lib/idle-nudge.mjs';
import { readStandingInbox, sendStandingMessage } from '../../topology/lib/standing-mailbox.mjs';
import { repoConfigPath } from '../../topology/lib/config.mjs';
import { generatedPrompt } from '../../topology/lib/prompts.mjs';

const PLUGIN = fileURLToPath(new URL('../../', import.meta.url));
const SINCE = '2026-10-05T00:00:00.000Z';
const bindingOf = (paneId, panePid) => ({ serverKey: 'fixture-server', serverPid: 1, sessionId: '$1', sessionCreated: 2, paneId, panePid });
const WORKER = bindingOf('%1', 11);
const LEAD = bindingOf('%2', 12);
const adapters = new Map([['fixture', { id: 'fixture', command: 'fixture', composer: { empty_tmux_pattern: '^ready$' }, failure_patterns: [] }]]);
const panes = [WORKER, LEAD].map((binding) => ({ ...binding, command: 'fixture', alive: true }));
const readLead = async () => ({ record: { agent_id: 'lead1' } });

const row = (agentId, binding, over = {}) => ({ agentId, repoRole: 'member', runId: null, state: 'idle', dispatchable: true, since: SINCE, binding, ...over });

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

const tick = (input) => idleNudgeTick(input.options ?? { consumer: '/fixture/repo', env: {}, home: '/nonexistent', readLead }, { panes, adapters, config: {}, ...input });

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
  const out = await tick({ options: { consumer, env: {}, home: root, readLead }, census: { agents: [row('w1', WORKER)] }, tmux: fake });
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
  const mail = { env: { AGENT_ORCHESTRATION_STATE_HOME: join(root, 'state'), AO_TRANSPORT: 'file' }, router: async (query) => ({ resolved: query.to, deliver_to: query.to }) };
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

test('no nudge while busy, waiting on a human, holding undelivered mail, owned by a run, or a reviewer', async () => {
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
  const config = { idle_nudge: { retry_ms: 60_000 } };
  const first = await tick({ census, tmux: fake, state, now: 1_000, config });
  assert.equal(first[0].rang, false);
  assert.match(first[0].reason, /composer is not empty/);
  assert.equal(fake.sent.length, 0);
  const looks = fake.looks;
  assert.deepEqual(await tick({ census, tmux: fake, state, now: 30_000, config }), []);
  assert.equal(fake.looks, looks, 'inside retry_ms the pane is not even looked at');
  fake.composer = 'empty';
  const later = await tick({ census, tmux: fake, state, now: 61_000, config });
  assert.equal(later[0].rang, true);
  assert.equal(fake.sent.length, 1);
});

test('once per idle period, and never again inside the backoff', async () => {
  const fake = fakeTmux();
  const state = createIdleNudge();
  const config = { idle_nudge: { backoff_ms: 600_000 } };
  const at = (since, now) => tick({ census: { agents: [row('w1', WORKER, { since })] }, tmux: fake, state, now, config });
  assert.equal((await at(SINCE, 0))[0].rang, true);
  assert.deepEqual(await at(SINCE, 10_000_000), [], 'same idle period, however late');
  const next = '2026-10-05T01:00:00.000Z';
  assert.deepEqual(await at(next, 300_000), [], 'a new idle period inside the backoff');
  assert.equal((await at(next, 600_000))[0].rang, true, 'a new idle period after the backoff');
  assert.equal(fake.sent.length, 2);
});

test('the shipped default is on, and idle_nudge.enabled false in the repo layer turns it off', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'ao-idle-nudge-config-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const consumer = join(root, 'repo');
  await mkdir(consumer);
  const options = { consumer, env: { XDG_CONFIG_HOME: join(root, 'xdg') }, home: join(root, 'home'), pluginRoot: PLUGIN, readLead };
  const census = { agents: [row('w1', WORKER)] };
  const shipped = JSON.parse(await readFile(join(PLUGIN, 'config.defaults.json'), 'utf8'));
  assert.equal(shipped.idle_nudge.enabled, true);
  const on = fakeTmux();
  assert.equal((await idleNudgeTick(options, { census, panes, adapters, tmux: on }))[0].rang, true);
  await mkdir(dirname(repoConfigPath(consumer)), { recursive: true });
  await writeFile(repoConfigPath(consumer), JSON.stringify({ idle_nudge: { enabled: false } }));
  const off = fakeTmux();
  assert.deepEqual(await idleNudgeTick(options, { census, panes, adapters, tmux: off }), []);
  assert.equal(off.looks, 0);
  assert.equal(off.sent.length, 0);
});

test('the pull rule is stated in the common protocols, the lead template, every role pack and the generated protocol', async () => {
  const read = (path) => readFile(join(PLUGIN, path), 'utf8');
  const RULE = /never ask the\s+operator\s+what is next/i;
  const packs = (await readdir(join(PLUGIN, 'roles'))).filter((name) => name.endsWith('.md')).map((name) => `roles/${name}`);
  assert.ok(packs.length >= 9, `found ${packs.length} role packs`);
  for (const path of ['prompts/common.md', 'prompts/common-reviewer.md', 'prompts/lead.md', ...packs]) assert.match(await read(path), RULE, path);
  assert.match(await read('prompts/common.md'), /ao-topology mailbox send/);
  assert.match(await read('prompts/lead.md'), /tm next/);
  assert.match(await read('prompts/lead.md'), /report the board state once/);
  const agent = (role, extra = {}) => ({ id: 'a1', full_name: 'A One', title: 'Agent', role, ...extra });
  assert.match(generatedPrompt(agent('worker'), '/c', '/d'), /ask your repository lead with\s+`ao-topology mailbox send --to \x3clead-id\x3e`/i);
  assert.match(generatedPrompt(agent('lead'), '/c', '/d'), /never ask the operator what is next\. Take the next ready task/);
  assert.match(generatedPrompt(agent('reviewer'), '/c', '/d'), RULE);
  assert.doesNotMatch(generatedPrompt(agent('worker', { _prompt_vars: { run_dir: '/r' } }), '/c', '/d'), /mailbox send/);
});
