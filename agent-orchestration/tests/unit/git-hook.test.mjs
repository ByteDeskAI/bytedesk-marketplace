import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { gitHookStatus, installGitHook, uninstallGitHook } from '../../topology/lib/git-hook.mjs';

const exec = promisify(execFile);
const PLUGIN_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const GIT = ['-c', 'user.name=t', '-c', 'user.email=t@example.invalid'];

async function fixture(t, { installed = true } = {}) {
  const root = await mkdtemp(join(os.tmpdir(), 'ao-git-hook-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const home = join(root, 'home'), repo = join(root, 'repo');
  await mkdir(join(home, '.claude', 'plugins'), { recursive: true });
  if (installed) {
    await writeFile(join(home, '.claude', 'plugins', 'installed_plugins.json'),
      JSON.stringify({ plugins: { 'agent-orchestration@bytedesk': [{ scope: 'user', installPath: PLUGIN_ROOT }] } }));
  }
  await exec('git', ['init', '-q', repo]);
  await mkdir(join(repo, '.claude'), { recursive: true });
  const setPlugins = (enabledPlugins) => writeFile(join(repo, '.claude', 'settings.json'), JSON.stringify({ enabledPlugins }));
  // A real `git commit` from a plain process: no Claude session, HOME pointed at the fixture.
  const commit = (message = 'x') => exec('git', ['-C', repo, ...GIT, 'commit', '--allow-empty', '-q', '-m', message],
    { env: { ...process.env, HOME: home } }).then(() => ({ code: 0 }), (error) => ({ code: error.code, stderr: error.stderr }));
  return { root, home, repo, setPlugins, commit };
}

test('installed hook blocks a terminal commit that enables the plugin, and allows it once removed', async (t) => {
  const f = await fixture(t);
  assert.equal((await installGitHook({ repo: f.repo })).state, 'installed');
  assert.equal(((await stat(join(f.repo, '.git', 'hooks', 'pre-commit'))).mode & 0o111) !== 0, true, 'hook is executable');
  await f.setPlugins({ 'agent-orchestration@bytedesk': true });
  const blocked = await f.commit();
  assert.equal(blocked.code, 1, blocked.stderr);
  assert.match(blocked.stderr, /agent-orchestration/);
  await f.setPlugins({ 'fleet@bytedesk': true });
  assert.equal((await f.commit()).code, 0);
});

test('hook fails open when the plugin cannot be found', async (t) => {
  const f = await fixture(t, { installed: false });
  await installGitHook({ repo: f.repo });
  await f.setPlugins({ 'agent-orchestration@bytedesk': true });
  assert.equal((await f.commit()).code, 0);
});

test('install is idempotent, refuses a foreign hook, and uninstall removes only its own', async (t) => {
  const f = await fixture(t);
  assert.equal((await installGitHook({ repo: f.repo })).changed, true);
  assert.equal((await installGitHook({ repo: f.repo })).changed, false);
  assert.equal((await uninstallGitHook({ repo: f.repo })).state, 'absent');
  assert.equal((await gitHookStatus({ repo: f.repo })).state, 'absent');
  const path = join(f.repo, '.git', 'hooks', 'pre-commit');
  await writeFile(path, '#!/bin/sh\necho mine\n');
  await assert.rejects(installGitHook({ repo: f.repo }), (error) => error.code === 'TOPOLOGY_GIT_HOOK_EXISTS');
  await assert.rejects(uninstallGitHook({ repo: f.repo }), (error) => error.code === 'TOPOLOGY_GIT_HOOK_EXISTS');
  assert.equal(await readFile(path, 'utf8'), '#!/bin/sh\necho mine\n', 'the foreign hook is untouched');
});

test('a linked worktree shares the main repository hook', async (t) => {
  const f = await fixture(t);
  await exec('git', ['-C', f.repo, ...GIT, 'commit', '--allow-empty', '-q', '-m', 'init']);
  const tree = join(f.root, 'wt');
  await exec('git', ['-C', f.repo, 'worktree', 'add', '-q', '--detach', tree]);
  const installed = await installGitHook({ repo: tree });
  assert.equal(installed.path, join(f.repo, '.git', 'hooks', 'pre-commit'));
});

test('ao-topology git-hook reports a non-repository clearly', async (t) => {
  const f = await fixture(t);
  await assert.rejects(exec(join(PLUGIN_ROOT, 'bin', 'ao-topology'), ['git-hook', 'status', '--consumer', f.root]),
    (error) => /TOPOLOGY_NOT_A_GIT_REPO/.test(error.stderr));
});
