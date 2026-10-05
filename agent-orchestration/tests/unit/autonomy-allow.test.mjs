// TM-369: the plugin-shipped PreToolUse allowlist approves routine orchestration commands and nothing else.
// TM-432/433/434: an explicit allowlist, parsed with the CLI's own rule, and a tm launcher that must BE the
// plugin's sibling, not merely look like it.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { AO_ALLOW, autonomyDecision } from '../../scripts/autonomy-allow.mjs';

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
  'ao-topology prompt ack lead --revision 3 --nonce abc',
  'ao-topology mailbox inbox',
  'ao-topology mailbox --to lead send --subject "status" --body "done"',
  // agent-orchestration CLI
  'agent-orchestration doctor',
  'agent-orchestration status --run-id r1',
  'agent-orchestration services status',
  'agent-orchestration services probe nats',
  'agent-orchestration services wait --until healthy --timeout 60',
  // tm
  'tm task new "Fix the guard" --epic EP-028',
  'tm --json board',
  'tm pool status',
  `${ROOT}/../task-management/bin/tm show TM-1`,
  "tm task new \"x\" --body - <<'EOF'\nline with ; and | and $(not run)\nEOF",
  // tmux
  'tmux capture-pane -p -t %3 -S -60',
  'tmux -L ao-team list-panes -a -F "#{pane_id} #{pane_title}"',
  'tmux -S /tmp/ao/sock display-message -p "#{session_name}"',
];

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
  // tm: operator policy, gate bypass, init and the pool's loop.
  'tm override "skip the gate"',
  'tm config dispatch.enabled true',
  'tm --json config set x',
  'tm init',
  'tm pool',
  'tm pool start',
  'tm pool stop',
  'tm pool resume',
  'tm pool run',
  'tm pool --dry-run',
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
  'tmux display-message "hi"',
  'tmux capture-pane -p \\; kill-server',
  // Look-alikes.
  'tmx capture-pane',
  'ao-topology',
  'tm',
  '',
];

test('TM-369: routine read and report commands are approved', () => {
  for (const command of ALLOWED) assert.ok(autonomyDecision(command), `should approve: ${command}`);
});

test('TM-432/433: every gated verb falls through with flags before, between and after the subcommand', () => {
  const cases = GATED.flatMap(placements);
  assert.ok(cases.length >= GATED.length * 4, 'the placement matrix ran');
  for (const command of cases) assert.equal(autonomyDecision(command), null, `must not approve: ${command}`);
});

test('TM-369/432/433/434: gated, unlisted, destructive and compound commands fall through', () => {
  for (const command of REFUSED) assert.equal(autonomyDecision(command), null, `must not approve: ${command}`);
});

test('TM-433: the explicit deny list wins even if the allowlist is edited to include a gated verb', () => {
  const saved = { ...AO_ALLOW };
  try {
    Object.assign(AO_ALLOW, { send: true, launch: true, nudge: true, delegate: true, permissions: true,
      review: ['submit'], config: ['set'], startup: ['install-hooks'], 'git-hook': ['install'],
      manage: [...saved.manage, 'land', 'integrate', 'close', 'transfer', 'assign', 'rework', 'rebind'] });
    assert.ok(autonomyDecision('ao-topology manage status'), 'the edited allowlist is in force');
    for (const command of GATED.flatMap(placements)) assert.equal(autonomyDecision(command), null, `deny must win: ${command}`);
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
  for (const file of [launcher, evil]) { mkdirSync(dirname(file), { recursive: true }); writeFileSync(file, '#!/bin/sh\n'); }
  mkdirSync(pluginRoot, { recursive: true });
  symlinkSync(launcher, join(dir, 'link-to-tm'));
  const decide = (prog) => autonomyDecision(`${prog} board`, { pluginRoot });
  assert.ok(decide(launcher), 'the sibling launcher');
  assert.ok(decide(join(pluginRoot, '..', 'task-management', 'bin', 'tm')), 'the sibling launcher via ..');
  assert.ok(decide(join(dir, 'link-to-tm')), 'a symlink that resolves to it runs the same script');
  assert.ok(decide('tm'), 'bare tm on PATH');
  assert.equal(decide(evil), null, 'a path that starts with the plugin root\'s prefix is not the launcher');
  assert.equal(decide(join(dir, 'root', 'task-management', 'bin', 'tm-evil')), null);
  assert.equal(decide(join(dir, 'missing', 'tm')), null);
  assert.equal(autonomyDecision(`${launcher} board`, { pluginRoot: join(dir, 'nowhere', 'agent-orchestration') }), null, 'no sibling installed: only bare tm');
});

test('TM-369: the hook prints an allow decision, or nothing, and never blocks', () => {
  const run = (input) => spawnSync(process.execPath, [SCRIPT], { input, encoding: 'utf8' });
  const allowed = run(JSON.stringify({ tool_name: 'Bash', tool_input: { command: 'tmux capture-pane -p -t %1' } }));
  assert.equal(allowed.status, 0);
  const decision = JSON.parse(allowed.stdout).hookSpecificOutput;
  assert.equal(decision.hookEventName, 'PreToolUse');
  assert.equal(decision.permissionDecision, 'allow');
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
