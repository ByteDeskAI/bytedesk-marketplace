// TM-392: a repository may enable agent-orchestration and task-management in its own
// .claude/settings.json (~/.agents/AGENTS.md), so nothing in this plugin blocks a commit for it.
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { gitHookStatus, installGitHook, uninstallGitHook } from '../../topology/lib/git-hook.mjs';

const exec = promisify(execFile);
const PLUGIN_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const IDENT = ['-c', 'user.name=t', '-c', 'user.email=t@example.invalid'];

// The pre-commit hook that `ao-topology git-hook install` wrote before TM-392, verbatim. Repositories
// still carry copies of it; they resolve the check script from the installed plugin at commit time.
const OLD_HOOK = `#!/bin/sh
# ao-topology git-hook: project-install guard
# Managed by \`ao-topology git-hook install\`. Remove with \`ao-topology git-hook uninstall\`.
root=$(git rev-parse --show-toplevel) || exit 0
check=$(node -e '
const fs = require("fs"), os = require("os"), path = require("path");
try {
  const all = JSON.parse(fs.readFileSync(path.join(os.homedir(), ".claude/plugins/installed_plugins.json"), "utf8")).plugins;
  const user = (all["agent-orchestration@bytedesk"] || []).find((e) => e.scope === "user");
  const file = path.join(user.installPath, "scripts", "check-no-project-plugin-installs.mjs");
  if (fs.existsSync(file)) process.stdout.write(file);
} catch {}
' 2>/dev/null)
[ -n "$check" ] || exit 0
node "$check" "$root" || { echo "pre-commit blocked: enable these plugins in ~/.claude/settings.json only, not in the repo." >&2; exit 1; }
`;

async function fixture(t) {
  const root = await mkdtemp(join(os.tmpdir(), 'ao-git-hook-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const home = join(root, 'home'), repo = join(root, 'repo');
  await mkdir(join(home, '.claude', 'plugins'), { recursive: true });
  await writeFile(join(home, '.claude', 'plugins', 'installed_plugins.json'),
    JSON.stringify({ plugins: { 'agent-orchestration@bytedesk': [{ scope: 'user', installPath: PLUGIN_ROOT }] } }));
  await exec('git', ['init', '-q', repo]);
  await mkdir(join(repo, '.claude'), { recursive: true });
  await writeFile(join(repo, '.claude', 'settings.json'),
    JSON.stringify({ enabledPlugins: { 'agent-orchestration@bytedesk': true, 'task-management@bytedesk': true } }));
  const hook = join(repo, '.git', 'hooks', 'pre-commit');
  // A real commit from a plain process: no Claude session, HOME pointed at the fixture.
  const commit = () => exec('git', ['-C', repo, ...IDENT, 'commit', '--allow-empty', '-q', '-m', 'x'],
    { env: { ...process.env, HOME: home } }).then(() => ({ code: 0 }), (error) => ({ code: error.code, stderr: error.stderr }));
  return { root, repo, hook, commit };
}

test('TM-392: a hook installed before the retirement lets a real commit through in a repo that enables the plugins at project scope', async (t) => {
  const f = await fixture(t);
  await writeFile(f.hook, OLD_HOOK);
  await chmod(f.hook, 0o755);
  const result = await f.commit();
  assert.equal(result.code, 0, result.stderr);
});

test('TM-392: no PreToolUse hook gates Bash, so no command text (a heredoc that mentions a commit included) can be blocked', async () => {
  const hooks = JSON.parse(await readFile(join(PLUGIN_ROOT, 'hooks', 'hooks.json'), 'utf8')).hooks;
  // TM-369's autonomy allowlist is the only PreToolUse hook: it can only allow or fall through,
  // never block (autonomy-allow.test.mjs), so nothing here gates a command.
  const commands = (hooks.PreToolUse ?? []).flatMap((entry) => entry.hooks.map((h) => h.command));
  assert.deepEqual(commands, ['node "${CLAUDE_PLUGIN_ROOT}/scripts/autonomy-allow.mjs"']);
  assert.doesNotMatch(JSON.stringify(hooks), /guard-project-install|check-no-project-plugin-installs/);
});

test('install is retired; status finds an old hook and uninstall removes only its own', async (t) => {
  const f = await fixture(t);
  await assert.rejects(installGitHook({ repo: f.repo }), (error) => error.code === 'TOPOLOGY_GIT_HOOK_RETIRED');
  assert.equal((await gitHookStatus({ repo: f.repo })).state, 'absent');
  await writeFile(f.hook, OLD_HOOK);
  assert.equal((await gitHookStatus({ repo: f.repo })).state, 'installed');
  assert.equal((await uninstallGitHook({ repo: f.repo })).changed, true);
  assert.equal((await gitHookStatus({ repo: f.repo })).state, 'absent');
  await writeFile(f.hook, '#!/bin/sh\necho mine\n');
  await assert.rejects(uninstallGitHook({ repo: f.repo }), (error) => error.code === 'TOPOLOGY_GIT_HOOK_EXISTS');
  assert.equal(await readFile(f.hook, 'utf8'), '#!/bin/sh\necho mine\n', 'the foreign hook is untouched');
});

test('ao-topology git-hook reports a non-repository clearly', async (t) => {
  const f = await fixture(t);
  await assert.rejects(exec(join(PLUGIN_ROOT, 'bin', 'ao-topology'), ['git-hook', 'status', '--consumer', f.root]),
    (error) => /TOPOLOGY_NOT_A_GIT_REPO/.test(error.stderr));
});
