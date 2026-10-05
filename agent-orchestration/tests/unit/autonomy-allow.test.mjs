// TM-369: the plugin-shipped PreToolUse allowlist approves routine orchestration commands and nothing else.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { autonomyDecision } from '../../scripts/autonomy-allow.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const SCRIPT = join(ROOT, 'scripts', 'autonomy-allow.mjs');

const ALLOWED = [
  'ao-topology launch --workflow solo --consumer /repo --input task=TM-1',
  'ao-topology agent new --role worker --reports-to lead',
  'ao-topology session open "Ada Lovelace"',
  'ao-topology manage start-worker --task TM-123 --backend tmux --summary',
  'ao-topology manage report --task TM-123 --file /abs/report.json --summary',
  'ao-topology capture --run /r --agent w1 --lines 60',
  'agent-orchestration doctor',
  'agent-orchestration services status',
  'tm task new "Fix the guard" --epic EP-028',
  '.bytedesk/task-management/bin/tm board',
  '/home/u/repo/.bytedesk/task-management/bin/tm show TM-1',
  "tm task new \"x\" --body - <<'EOF'\nline with ; and | and $(not run)\nEOF",
  'tmux capture-pane -p -t %3 -S -60',
  'tmux -L ao-team list-panes -a -F "#{pane_id} #{pane_title}"',
  'tmux -S /tmp/ao/sock display-message -p "#{session_name}"',
];

const REFUSED = [
  // Gated: merge, landing, cleanup, delegation and permission rules.
  'ao-topology manage integrate --task TM-1',
  'ao-topology manage record-landing --task TM-1 --landed abc --authorized',
  'ao-topology manage cleanup --task TM-1',
  'ao-topology delegate grant --to lead --repo . --scope integrate',
  'ao-topology permissions install',
  'agent-orchestration services uninstall',
  // Repo-destructive and external actions are never on the list.
  'git push --force origin main',
  'git push origin --delete feature',
  'git branch -D feature',
  'git reset --hard HEAD~3',
  'git rebase -i main',
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
  '/tmp/evil/tm board',
  '',
];

test('TM-369: routine orchestration commands are approved', () => {
  for (const command of ALLOWED) assert.ok(autonomyDecision(command), `should approve: ${command}`);
});

test('TM-369: gated, destructive, external and compound commands fall through to the normal permission flow', () => {
  for (const command of REFUSED) assert.equal(autonomyDecision(command), null, `must not approve: ${command}`);
});

test('TM-369: the hook prints an allow decision, or nothing, and never blocks', () => {
  const run = (input) => spawnSync(process.execPath, [SCRIPT], { input, encoding: 'utf8' });
  const allowed = run(JSON.stringify({ tool_name: 'Bash', tool_input: { command: 'tmux capture-pane -p -t %1' } }));
  assert.equal(allowed.status, 0);
  const decision = JSON.parse(allowed.stdout).hookSpecificOutput;
  assert.equal(decision.hookEventName, 'PreToolUse');
  assert.equal(decision.permissionDecision, 'allow');
  for (const input of [JSON.stringify({ tool_name: 'Bash', tool_input: { command: 'git push --force' } }), 'not json', '']) {
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
