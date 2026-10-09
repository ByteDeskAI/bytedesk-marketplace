// TM-378: `ao-topology repos list|add|remove` registers repositories for a supervisor explicitly.
// Services are off (AGENT_ORCHESTRATION_SERVICES=0), so nothing is started or reloaded; the
// registry file and the supervisor state each row reports are what is under test.
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readFile, realpath, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const exec = promisify(execFile);
const CLI = fileURLToPath(new URL('../../topology/cli.mjs', import.meta.url));
const GIT_ID = ['-c', 'user.name=t', '-c', 'user.email=t@example.invalid'];

async function fixture(t) {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'ao-repos-')));
  t.after(() => rm(root, { recursive: true, force: true }));
  const repo = join(root, 'repo'), plain = join(root, 'plain'), state = join(root, 'state');
  await mkdir(repo); await mkdir(plain);
  await exec('git', ['init', '-q', repo]);
  await exec('git', ['-C', repo, ...GIT_ID, 'commit', '-q', '--allow-empty', '-m', 'init']);
  await exec('git', ['-C', repo, 'worktree', 'add', '-q', join(root, 'wt'), '-b', 'wt']);
  const env = { ...process.env, HOME: root, AGENT_ORCHESTRATION_STATE_HOME: state, AGENT_ORCHESTRATION_SERVICES: '0', TMUX: '', TMUX_TMPDIR: root };
  const ao = async (...args) => {
    const r = await exec(process.execPath, [CLI, 'repos', ...args], { env, cwd: root }).catch((error) => error);
    return { code: r.code ?? 0, stdout: r.stdout, json: (() => { try { return JSON.parse(r.stdout); } catch { return null; } })() };
  };
  return { root, repo, plain, wt: join(root, 'wt'), state, ao };
}

const registry = async (state) => JSON.parse(await readFile(join(state, 'services', 'repos.json'), 'utf8')).repos;

test('TM-378: add registers a repository once, list reports its supervisor state, remove keeps the repository', async (t) => {
  const { repo, wt, state, ao } = await fixture(t);
  assert.deepEqual((await ao('list', '--json')).json.repos, []);

  const added = await ao('add', wt); // a linked worktree registers its main checkout
  assert.equal(added.code, 0);
  assert.equal(added.json.registered, true);
  assert.equal(added.json.consumer, repo);
  assert.equal((await ao('add', repo)).json.registered, false, 'the same repository twice is one entry');
  assert.deepEqual((await registry(state)).map((r) => r.consumer), [repo]);

  const listed = (await ao('list', '--json')).json.repos;
  assert.equal(listed.length, 1);
  assert.equal(listed[0].consumer, repo);
  assert.equal(listed[0].supervisor, 'never-started');
  assert.equal(listed[0].ready, false);
  assert.match((await ao('list')).stdout, new RegExp(`${repo}.*supervisor never-started`));

  const removed = await ao('remove', wt); // by a worktree path: same repository key
  assert.equal(removed.code, 0);
  assert.equal(removed.json.removed, true);
  assert.deepEqual(await registry(state), []);
  assert.ok((await stat(join(repo, '.git'))).isDirectory(), 'remove never deletes the repository');
  assert.equal((await ao('remove', repo)).code, 1, 'removing what is not registered says so');
});

test('TM-378: a directory that is not a git checkout is refused; a deleted checkout is removed by key', async (t) => {
  const { repo, plain, state, ao } = await fixture(t);
  const refused = await ao('add', plain, '--json');
  assert.equal(refused.code, 1);
  assert.equal(refused.json.code, 'TOPOLOGY_REPO_NOT_GIT');

  const { key } = (await ao('add', repo)).json;
  await rm(repo, { recursive: true, force: true });
  assert.equal((await ao('list', '--json')).json.repos[0].supervisor, 'repository-missing');
  assert.equal((await ao('remove', key)).json.removed, true);
  assert.deepEqual(await registry(state), []);
});
