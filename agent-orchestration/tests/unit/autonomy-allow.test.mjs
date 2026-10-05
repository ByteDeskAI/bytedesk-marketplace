// TM-369: the plugin-shipped PreToolUse allowlist approves routine orchestration commands and nothing else.
// TM-432/433/434: an explicit allowlist, parsed with the CLI's own rule, and a tm launcher that must BE the
// plugin's sibling, not merely look like it.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { AO_ALLOW, autonomyDecision, trustedTmux } from '../../scripts/autonomy-allow.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const SCRIPT = join(ROOT, 'scripts', 'autonomy-allow.mjs');

const ALLOWED = [
  // read
  'ao-topology status --run /r',
  'ao-topology capture --run /r --agent w1 --lines 60',
  'ao-topology wait --run /r --from w1 --timeout 20m',
  'ao-topology doctor --json',
  'ao-topology repos list',
  'ao-topology manage status --task TM-123',
  'ao-topology manage --task TM-123 assignment',
  'ao-topology --summary=1 manage eligible --task TM-123',
  'ao-topology mailbox outbox',
  'ao-topology mailbox receipts --consumer /repo',
  'ao-topology mailbox wait abc --timeout 5m',
  'ao-topology lead status --cached',
  // report
  'ao-topology ack --run /r --agent w1 --message 003-brief',
  'ao-topology reply --run /r --agent w1 --message 003-brief --file /abs/reply.md',
  'ao-topology prompt ack w1 --revision 3 --nonce abc',
  'ao-topology mailbox inbox',
  'ao-topology mailbox --to lead send --subject "status" --body "done"',
  // agent-orchestration CLI
  'agent-orchestration doctor',
  'agent-orchestration status --run-id r1',
  'agent-orchestration services status',
  'agent-orchestration services probe nats',
  'agent-orchestration services wait --until healthy --timeout 60',
  "ao-topology mailbox send --to lead --subject s <<'EOF'\nline with ; and | and $(not run)\nEOF",
  // own identity (AO_AGENT_ID=w1 in TEST_ENV)
  'ao-topology mailbox inbox --agent w1',
  'ao-topology ack --run /r --message 003-brief',
  // tm: read-only verbs
  ...['board', 'show TM-1', 'find guard status:open', 'next', 'why TM-1', 'graph --epic EP-1', 'log 20', 'events --since 2026-10-01T00:00:00Z',
    'standup', 'stale', 'where', 'doctor', 'pool status'].map((v) => `tm ${v}`),
  'tm --json board',
  'tm doctor --json',
  `${ROOT}/../task-management/bin/tm show TM-1`,
  `${ROOT}/bin/ao-topology status --run /r`,
  // tmux
  'tmux capture-pane -p -t %3 -S -60',
  'tmux capture-pane -pJ -t %3',
  'tmux -L ao-team list-panes -a -F "#{pane_id} #{pane_title}"',
  'tmux -S /tmp/ao/sock display-message -p "#{session_name}"',
];

// A fixed PATH, so results do not depend on the machine: this plugin's bin, its sibling task-management,
// and a stand-in tmux (trusted only where a test says so; see the root-owned test for the real rule).
const FAKE_TMUX_DIR = mkdtempSync(join(tmpdir(), 'autonomy-tmux-'));
writeFileSync(join(FAKE_TMUX_DIR, 'tmux'), '#!/bin/sh\n', { mode: 0o755 });
process.on('exit', () => rmSync(FAKE_TMUX_DIR, { recursive: true, force: true }));
const TEST_ENV = { PATH: [join(ROOT, 'bin'), join(ROOT, '..', 'task-management', 'bin'), FAKE_TMUX_DIR].join(':'), AO_AGENT_ID: 'w1' };
const decide = (command, opts = {}) => autonomyDecision(command, { env: TEST_ENV, tmuxTrusted: () => true, ...opts });

// Every gated ao-topology verb (the review's list plus the old denylist), as [verb, sub].
const GATED = [
  ['review', 'submit'], ['config', 'set'], ['startup', 'install-hooks'], ['git-hook', 'install'],
  ['send', null], ['launch', null], ['nudge', null],
  ...['land', 'integrate', 'close', 'transfer', 'assign', 'rework', 'rebind', 'record-landing', 'cleanup', 'cutover', 'cut-release'].map((s) => ['manage', s]),
  ['delegate', 'grant'], ['delegate', 'revoke'], ['permissions', 'install'], ['permissions', 'uninstall'],
];
// Flags before, between and after the subcommand, in both `--k v` and `--k=v` forms (TM-432).
const placements = ([verb, sub]) => {
  const s = sub ? ` ${sub}` : '';
  return [
    `ao-topology ${verb}${s} --task TM-1 --authorized`,
    `ao-topology --task TM-1 ${verb}${s}`,
    `ao-topology --summary=1 ${verb}${s}`,
    `ao-topology --run /r --json ${verb}${s} --authorized`,
    ...(sub ? [`ao-topology ${verb} --task TM-1 ${sub} --authorized`, `ao-topology ${verb} --id=x ${sub}`] : []),
  ];
};

// Every tm verb the review found approved, plus operator policy, the pool's loop, and the read verbs'
// writing modes. Each writes the store or config, writes a file, spawns or executes something.
const TM_WRITES = [
  'dispatch TM-1', 'export --out /home/u/.zshrc', 'export md', 'ntfy on writes', 'worktree new TM-1', 'collect TM-1', 'agent list',
  'hook post-tool-use', 'migrate', 'review-sweep', 'done TM-1', 'govern TM-1', 'task new "x" --epic EP-1', 'start TM-1', 'comment TM-1 hi',
  'caps', 'doctor --fix', 'doctor --all', 'doctor --json --fix', 'override "skip the gate"', 'config dispatch.enabled true', 'init', 'reindex',
  'pool', 'pool start', 'pool stop', 'pool resume', 'pool run', 'pool ensure', 'pool --dry-run', 'pool status --x',
];

const REFUSED = [
  ...GATED.flatMap(placements),
  // Not on the allowlist: they launch, start a supervisor, publish files, ring a pane or queue a review.
  'ao-topology launch --workflow solo --consumer /repo --input task=TM-1',
  'ao-topology agent new --role worker --reports-to lead',
  'ao-topology session open "Ada Lovelace"',
  'ao-topology manage start-worker --task TM-123 --backend tmux --summary',
  'ao-topology manage report --task TM-123 --file /abs/report.json --summary',
  'ao-topology census',
  'ao-topology presence publish',
  'ao-topology lead status',
  'ao-topology lead --cached status', // the CLI reads --cached="status", then runs the ringing default
  'ao-topology lead ensure',
  'ao-topology mailbox resume --force',
  'ao-topology mailbox dispose --message x',
  'ao-topology mailbox',
  'ao-topology manage',
  'ao-topology future-verb --whatever',
  // The shell would build a different argv than the one checked.
  'ao-topology lead status #--cached',
  'ao-topology --task * status',
  'ao-topology manage {status,land}',
  'ao-topology "sta"tus',
  'ao-topology manage "status"land',
  'ao-topology status ~',
  'agent-orchestration session-open',
  'agent-orchestration services ensure',
  'agent-orchestration services uninstall',
  'agent-orchestration services --json ensure',
  // Acting as another agent (TEST_ENV is w1).
  'ao-topology mailbox inbox --agent lead',
  'ao-topology mailbox --agent=lead inbox',
  'ao-topology ack --run /r --agent lead --message 003-brief',
  'ao-topology reply --run /r --agent lead --message 003-brief --file /abs/reply.md',
  // tm: everything but the read-only verbs.
  ...TM_WRITES.map((v) => `tm ${v}`),
  'tm --json config set x',
  'tm --help',
  // tm: only bare tm or the sibling launcher's realpath (TM-434).
  '/tmp/evil/tm board',
  '/tmp/x/.bytedesk/task-management/bin/tm board',
  './.bytedesk/task-management/bin/tm board',
  '.bytedesk/task-management/bin/tm board',
  '/home/u/repo/.bytedesk/task-management/bin/tm show TM-1',
  // Repo-destructive and external actions are never on the list.
  'git push --force origin main',
  'git push origin --delete feature',
  'git branch -D feature',
  'git reset --hard HEAD~3',
  'gh pr merge 12 --merge',
  'gh release create v1.0.0',
  'kubectl apply -f deploy.yaml',
  'infisical secrets get TOKEN',
  // A listed program cannot smuggle a second command.
  'tm board; git push --force',
  'tm board && rm -rf ~',
  'tm board | sh',
  'ao-topology status --run $(rm -rf ~)',
  'ao-topology status --run `id`',
  'tm board > ~/.bashrc',
  "tm task new x --body - <<'EOF'\nbody\nEOF\ngit push --force\nEOF",
  'tm task new x --body - <<EOF\n$(id)\nEOF',
  'AO_AGENT_ID=x ao-topology status',
  // tmux: only read-only subcommands, no format shell-outs, no config loading, no pane input.
  'tmux kill-server',
  'tmux -L ao kill-session -t lead',
  'tmux send-keys -t %3 "rm -rf ~" Enter',
  'tmux capture-pane -p -t "#(rm -rf ~)"',
  'tmux -f /tmp/evil.conf list-sessions',
  'tmux display-message -I -t %3',
  'tmux display-message -pI -t %3',
  'tmux capture-pane -p -b buf -t %3',
  'tmux capture-pane -pb buf -t %3',
  'tmux capturep -b buf',
  'tmux display-message "hi"',
  'tmux capture-pane -p \\; kill-server',
  // Look-alikes.
  'tmx capture-pane',
  'ao-topology',
  'tm',
  '',
];

test('TM-369: routine read and report commands are approved', () => {
  for (const command of ALLOWED) assert.ok(decide(command), `should approve: ${command}`);
});

test('TM-432/433: every gated verb falls through with flags before, between and after the subcommand', () => {
  const cases = GATED.flatMap(placements);
  assert.ok(cases.length >= GATED.length * 4, 'the placement matrix ran');
  for (const command of cases) assert.equal(decide(command), null, `must not approve: ${command}`);
});

test('TM-369/432/433/434: gated, unlisted, destructive and compound commands fall through', () => {
  for (const command of REFUSED) assert.equal(decide(command), null, `must not approve: ${command}`);
});

test('TM-433: the explicit deny list wins even if the allowlist is edited to include a gated verb', () => {
  const saved = { ...AO_ALLOW };
  try {
    Object.assign(AO_ALLOW, { send: true, launch: true, nudge: true, delegate: true, permissions: true,
      review: ['submit'], config: ['set'], startup: ['install-hooks'], 'git-hook': ['install'],
      manage: [...saved.manage, 'land', 'integrate', 'close', 'transfer', 'assign', 'rework', 'rebind'] });
    assert.ok(decide('ao-topology manage status'), 'the edited allowlist is in force');
    for (const command of GATED.flatMap(placements)) assert.equal(decide(command), null, `deny must win: ${command}`);
  } finally {
    for (const key of Object.keys(AO_ALLOW)) delete AO_ALLOW[key];
    Object.assign(AO_ALLOW, saved);
  }
});

test('TM-432: the hook parses argv with the ao-topology CLI\'s own parseArgs, not a copy', () => {
  assert.match(readFileSync(SCRIPT, 'utf8'), /import \{ parseArgs \} from '\.\.\/topology\/lib\/util\.mjs'/);
});

test('TM-434: only the realpath of the sibling launcher is approved, never a prefix look-alike', (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'autonomy-tm-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const pluginRoot = join(dir, 'root', 'agent-orchestration');
  const launcher = join(dir, 'root', 'task-management', 'bin', 'tm');
  const evil = join(dir, 'root-evil', 'task-management', 'bin', 'tm');
  for (const file of [launcher, evil]) { mkdirSync(dirname(file), { recursive: true }); writeFileSync(file, '#!/bin/sh\n', { mode: 0o755 }); }
  mkdirSync(pluginRoot, { recursive: true });
  symlinkSync(launcher, join(dir, 'link-to-tm'));
  const env = { PATH: dirname(launcher) };
  const tm = (prog, root = pluginRoot) => autonomyDecision(`${prog} board`, { pluginRoot: root, env });
  assert.ok(tm(launcher), 'the sibling launcher');
  assert.ok(tm(join(pluginRoot, '..', 'task-management', 'bin', 'tm')), 'the sibling launcher via ..');
  assert.ok(tm(join(dir, 'link-to-tm')), 'a symlink that resolves to it runs the same script');
  assert.ok(tm('tm'), 'bare tm whose PATH resolution is the sibling launcher');
  assert.equal(tm(evil), null, 'a path that starts with the plugin root\'s prefix is not the launcher');
  assert.equal(tm(join(dir, 'root', 'task-management', 'bin', 'tm-evil')), null);
  assert.equal(tm(join(dir, 'missing', 'tm')), null);
  assert.equal(tm(launcher, join(dir, 'nowhere', 'agent-orchestration')), null, 'no sibling installed: nothing named tm is trusted');
  assert.equal(tm('tm', join(dir, 'nowhere', 'agent-orchestration')), null);
});

test('TM-432 review: a look-alike earlier on PATH is never approved, for any program', (t) => {
  const planted = mkdtempSync(join(tmpdir(), 'autonomy-plant-'));
  t.after(() => rmSync(planted, { recursive: true, force: true }));
  for (const name of ['ao-topology', 'agent-orchestration', 'tm', 'tmux']) writeFileSync(join(planted, name), '#!/bin/sh\n', { mode: 0o755 });
  const cases = ['ao-topology status --run /r', 'agent-orchestration doctor', 'tm board', 'tmux list-sessions'];
  // Control: the same commands are approved when the real launchers come first.
  for (const command of cases.slice(0, 3)) assert.ok(decide(command), `control approves: ${command}`);
  const plantedEnv = { ...TEST_ENV, PATH: `${planted}:${TEST_ENV.PATH}` };
  for (const command of cases) {
    assert.equal(autonomyDecision(command, { env: plantedEnv }), null, `planted look-alike must not be approved: ${command}`);
  }
  // A PATH entry the shell would resolve against the cwd: empty, '.', or relative.
  for (const prefix of ['', '.', 'bin']) {
    assert.equal(decide('ao-topology status --run /r', { env: { ...TEST_ENV, PATH: `${prefix}:${TEST_ENV.PATH}` } }), null, `PATH entry ${JSON.stringify(prefix)}`);
  }
  assert.equal(decide('bin/ao-topology status --run /r'), null, 'a relative path is cwd-dependent');
});

test('TM-432 review: tmux is approved only at a pinned system path with a root-owned chain up to /', () => {
  // The stand-in tmux is outside the pinned paths and owned by the test user, so the real rule refuses it.
  assert.equal(autonomyDecision('tmux list-sessions', { env: TEST_ENV }), null, 'a planted tmux falls through');
  assert.equal(trustedTmux(join(FAKE_TMUX_DIR, 'tmux')), false);
  // Pinned paths only, even for a root-owned file: a FUSE mount can present root-owned files anywhere.
  const rootStat = () => ({ uid: 0, mode: 0o40755 });
  assert.equal(trustedTmux('/opt/fuse/tmux', rootStat), false, 'root-owned but not a pinned path');
  assert.equal(trustedTmux('/usr/sbin/tmux', rootStat), false);
  for (const pinned of ['/usr/bin/tmux', '/bin/tmux', '/usr/local/bin/tmux']) assert.equal(trustedTmux(pinned, rootStat), true, pinned);
  // Every ancestor is checked, not just the file and its directory.
  const walked = [];
  const statWith = (bad) => (p) => { walked.push(p); return p === bad.path ? { uid: 0, mode: 0o40755, ...bad } : rootStat(); };
  assert.equal(trustedTmux('/usr/local/bin/tmux', statWith({ path: '/usr', uid: 1000 })), false, 'a user-owned /usr');
  assert.equal(trustedTmux('/usr/local/bin/tmux', statWith({ path: '/usr', mode: 0o40777 })), false, 'a world-writable /usr');
  assert.equal(trustedTmux('/usr/local/bin/tmux', statWith({ path: '/', mode: 0o40775 })), false, 'a group-writable /');
  walked.length = 0;
  trustedTmux('/usr/local/bin/tmux', statWith({ path: 'none' }));
  assert.deepEqual(walked, ['/usr/local/bin/tmux', '/usr/local/bin', '/usr/local', '/usr', '/'], 'the walk reaches /');
  const system = ['/usr/bin/tmux', '/bin/tmux'].find((p) => { try { return trustedTmux(realpathSync(p)); } catch { return false; } });
  if (system) assert.ok(autonomyDecision('tmux list-sessions', { env: { PATH: dirname(system) } }), `system ${system} is approved`);
});

test('TM-432 review: an approval pins the program to the realpath it judged (no TOCTOU)', () => {
  const ao = realpathSync(join(ROOT, 'bin', 'ao-topology'));
  const tm = realpathSync(join(ROOT, '..', 'task-management', 'bin', 'tm'));
  const tmux = realpathSync(join(FAKE_TMUX_DIR, 'tmux'));
  for (const [input, expected] of [
    ['ao-topology status --run /r', `command ${ao} status --run /r`],
    ['  tm --json board', `  command ${tm} --json board`],
    ['"tm" show TM-1', `command ${tm} show TM-1`],
    [`${ROOT}/bin/ao-topology status --run /r`, `${ao} status --run /r`],
    ['tmux capture-pane -p -t %3', `command ${tmux} capture-pane -p -t %3`],
    ["ao-topology mailbox send --to lead <<'EOF'\nbody ao-topology\nEOF", `command ${ao} mailbox send --to lead <<'EOF'\nbody ao-topology\nEOF`],
  ]) assert.equal(decide(input)?.command, expected, input);
});

test('TM-432 review: prompt ack approves only the caller\'s own agent, positional or --agent', () => {
  const env = (extra) => ({ PATH: TEST_ENV.PATH, ...extra });
  for (const [ids, command, expected] of [
    [{ AO_AGENT_ID: 'w1' }, 'ao-topology prompt ack w1 --nonce n', true],
    [{ AO_SESSION_AGENT_ID: 'w1' }, 'ao-topology prompt ack --agent w1 --nonce n', true],
    [{ AO_AGENT_ID: 'w1' }, 'ao-topology prompt ack lead --nonce n', false],
    [{ AO_AGENT_ID: 'w1' }, 'ao-topology prompt --agent lead ack --nonce n', false],
    [{ AO_AGENT_ID: 'w1' }, 'ao-topology prompt ack lead --agent w1', false], // the CLI takes the positional
    [{}, 'ao-topology prompt ack w1', false],
  ]) assert.equal(Boolean(decide(command, { env: env(ids) })), expected, `${JSON.stringify(ids)}: ${command}`);
});

test('TM-432 review: identity-bound verbs approve only the caller\'s own --agent', () => {
  const env = (extra) => ({ PATH: TEST_ENV.PATH, ...extra });
  for (const [ids, agent, expected] of [
    [{ AO_AGENT_ID: 'w1' }, 'w1', true], [{ AO_SESSION_AGENT_ID: 'w1' }, 'w1', true], [{ AO_AGENT_ID: 'w1' }, 'lead', false],
    [{}, 'w1', false], [{ AO_AGENT_ID: 'w1' }, null, true], [{}, null, true],
  ]) {
    const flag = agent ? ` --agent ${agent}` : '';
    for (const command of [`ao-topology mailbox inbox${flag}`, `ao-topology ack --run /r --message m${flag}`]) {
      assert.equal(Boolean(decide(command, { env: env(ids) })), expected, `${JSON.stringify(ids)}: ${command}`);
    }
  }
});

test('TM-369: the hook prints an allow decision, or nothing, and never blocks', () => {
  const run = (input) => spawnSync(process.execPath, [SCRIPT], { input, encoding: 'utf8', env: { ...process.env, PATH: TEST_ENV.PATH } });
  const allowed = run(JSON.stringify({ tool_name: 'Bash', tool_input: { command: 'ao-topology status --run /r', timeout: 60000, description: 'run status' } }));
  assert.equal(allowed.status, 0);
  const decision = JSON.parse(allowed.stdout).hookSpecificOutput;
  assert.equal(decision.hookEventName, 'PreToolUse');
  assert.equal(decision.permissionDecision, 'allow');
  // The approved command is the one that runs: its program pinned to the absolute realpath that was judged,
  // and `command ` in front because the input began with a bare name. Other arguments are kept.
  assert.deepEqual(decision.updatedInput, { command: `command ${realpathSync(join(ROOT, 'bin', 'ao-topology'))} status --run /r`, timeout: 60000, description: 'run status' });
  for (const input of [JSON.stringify({ tool_name: 'Bash', tool_input: { command: 'ao-topology manage --task TM-1 land --authorized' } }), 'not json', '']) {
    const r = run(input);
    assert.deepEqual([r.status, r.stdout], [0, ''], `falls through silently for ${JSON.stringify(input)}`);
  }
});

test('TM-369: hooks.json wires the allowlist on Bash beside the project-install guard', () => {
  const pre = JSON.parse(readFileSync(join(ROOT, 'hooks', 'hooks.json'), 'utf8')).hooks.PreToolUse;
  const bash = pre.find((entry) => entry.matcher === 'Bash');
  const commands = bash.hooks.map((h) => h.command);
  assert.ok(commands.some((c) => c.includes('scripts/autonomy-allow.mjs')));
  assert.ok(commands.some((c) => c.includes('scripts/guard-project-install.mjs')));
});
