// TM-443: every host-side git runs through topology/lib/safe-git.mjs, which neutralises config a
// worker can plant in the shared .git/config. These tests plant each vector and prove none fires.
import assert from 'node:assert/strict';
import test from 'node:test';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { driverOverrides, hardenArgs, safeGit, safeGitSync, SAFE_GIT_CONFIG } from '../../topology/lib/safe-git.mjs';
import { plantGitVectors } from '../helpers/plant-git-vectors.mjs';

const AO = fileURLToPath(new URL('../../', import.meta.url));
const TM = fileURLToPath(new URL('../../../task-management/', import.meta.url));
const raw = (cwd, ...args) => execFileSync('git', ['-C', cwd, '-c', 'user.name=T', '-c', 'user.email=t@example.invalid', ...args], { encoding: 'utf8' });

async function repoWithOrigin(t) {
  const dir = await mkdtemp(join(tmpdir(), 'ao-safe-git-')); t.after(() => rm(dir, { recursive: true, force: true }));
  const repo = join(dir, 'repo'), origin = join(dir, 'origin.git');
  execFileSync('git', ['init', '-q', '-b', 'main', repo]);
  await writeFile(join(repo, 'a.txt'), 'one\n'); raw(repo, 'add', '.'); raw(repo, 'commit', '-qm', 'base');
  execFileSync('git', ['clone', '-q', '--bare', repo, origin]); raw(repo, 'remote', 'add', 'origin', origin);
  // A side branch and a feature commit, for merge-tree and a fast-forward checkout.
  raw(repo, 'checkout', '-qb', 'side'); await writeFile(join(repo, 'a.txt'), 'one\nside\n'); raw(repo, 'commit', '-qam', 'side');
  raw(repo, 'checkout', '-q', 'main'); raw(repo, 'checkout', '-qb', 'feature'); await writeFile(join(repo, 'b.txt'), 'b\n'); raw(repo, 'add', 'b.txt'); raw(repo, 'commit', '-qm', 'feature');
  raw(repo, 'checkout', '-q', 'main');
  return { dir, repo };
}

test('TM-443 control: the planted vectors DO fire under a plain git, so their absence below is meaningful', async t => {
  const { dir, repo } = await repoWithOrigin(t);
  const planted = await plantGitVectors(repo, dir);
  await writeFile(join(repo, 'a.txt'), 'changed\n');
  spawnSync('git', ['-C', repo, 'status', '--porcelain'], { encoding: 'utf8' });
  spawnSync('git', ['-C', repo, 'diff'], { encoding: 'utf8' });
  const fired = await planted.fired();
  assert.ok(fired.some(line => line.includes('planted')), `plain git ran nothing planted: ${fired}`);
});

test('TM-443 safe-git runs status, diff, log -p, show, merge-tree, fetch, stash, ff-merge and ls-remote without firing a planted vector', async t => {
  const { dir, repo } = await repoWithOrigin(t);
  await writeFile(join(repo, 'a.txt'), 'changed\n');
  const planted = await plantGitVectors(repo, dir);
  await safeGit(repo, ['status', '--porcelain']);
  await safeGit(repo, ['diff']); await safeGit(repo, ['log', '-p', '-1']); await safeGit(repo, ['show', 'side']);
  await safeGit(repo, ['merge-tree', '--write-tree', 'side', 'feature'], { allowFailure: true });
  await safeGit(repo, ['fetch', 'origin', 'main'], { allowFailure: true, timeoutMs: 10_000 });
  await safeGit(repo, ['stash', '-q'], { allowFailure: true });
  await safeGit(repo, ['merge', '--ff-only', 'feature'], { allowFailure: true });
  await safeGit(repo, ['ls-remote', 'origin'], { allowFailure: true, timeoutMs: 10_000 });
  const diff = (await safeGit(repo, ['diff', '--binary', 'main~1', 'main'])).stdout;
  assert.match((await safeGit(repo, ['patch-id', '--stable'], { input: diff })).stdout, /^[0-9a-f]{40} /, 'stdin input reaches git');
  assert.equal((await safeGit(repo, ['rev-parse', 'HEAD'])).stdout.trim(), raw(repo, 'rev-parse', 'feature').trim(), 'the fast-forward ran');
  assert.deepEqual(await planted.fired(), []);
});

test('TM-443 a merge driver planted in repository config is a conflict under safe-git, never a program', async t => {
  const { dir, repo } = await repoWithOrigin(t);
  raw(repo, 'checkout', '-q', 'feature'); await writeFile(join(repo, 'a.txt'), 'one\nfeature\n'); raw(repo, 'commit', '-qam', 'conflicting'); raw(repo, 'checkout', '-q', 'main');
  const planted = await plantGitVectors(repo, dir);
  const merged = await safeGit(repo, ['merge-tree', '--write-tree', 'side', 'feature'], { allowFailure: true });
  assert.equal(merged.code, 1, 'the neutralised driver reports a conflict');
  assert.deepEqual(await planted.fired(), []);
});

test('TM-443 driverOverrides neutralises repository-scope drivers and re-adds only global credential helpers', () => {
  const listing = ['global', 'credential.https://github.com.helper\n!gh auth git-credential', 'local', 'credential.helper\n!evil',
    'local', 'filter.a.b.clean\nevil', 'worktree', 'merge.m.driver\nevil', 'global', 'filter.lfs.clean\ngit-lfs clean'].join('\0') + '\0';
  assert.deepEqual(driverOverrides(listing), ['filter.a.b.clean=', 'filter.a.b.smudge=', 'filter.a.b.process=', 'filter.a.b.required=false', 'merge.m.driver=false', 'credential.https://github.com.helper=!gh auth git-credential']);
  assert.ok(SAFE_GIT_CONFIG.includes('credential.helper='), 'helpers are reset before the global ones are re-added');
  assert.deepEqual(hardenArgs(['diff', 'a', 'b']), ['diff', '--no-ext-diff', '--no-textconv', 'a', 'b']);
  assert.deepEqual(hardenArgs(['fetch', 'origin']), ['fetch', '--upload-pack=git-upload-pack', 'origin']);
  assert.deepEqual(hardenArgs(['status']), ['status']);
});

test('TM-443 conformance: task-management carries a byte-identical copy of the helper', async () => {
  assert.equal(await readFile(join(TM, 'lib/safe-git.mjs'), 'utf8'), await readFile(join(AO, 'topology/lib/safe-git.mjs'), 'utf8'),
    'task-management/lib/safe-git.mjs and agent-orchestration/topology/lib/safe-git.mjs differ; the same guard must apply to every caller (rule 3)');
});

// A direct spawn of git: run('git', ...), execFileSync("git", ...), spawn('/usr/bin/git', ...), etc.
const RAW_GIT = /\b\w+\(\s*(['"])(?:\/usr\/bin\/)?git(?:\.exe)?\1\s*,/g;
// Each exception names why it is not a host-side git that can run planted config.
const ALLOWED = new Map([
  ['agent-orchestration/topology/lib/reviewer.mjs', 'owned by another session during the 0.16.1 freeze; routing it through safe-git is the TM-443 follow-up'],
  ['agent-orchestration/src/diagnostics.mjs', "the deps.run test seam is called as exec('git', ...); its default routes to safeGit"],
  ['task-management/lib/launcher.mjs', 'the generated bin/tm launcher template: it locates lib/ (so cannot import safe-git) and runs only rev-parse --git-common-dir, which reads no index and runs no driver'],
]);
async function sources(root, dir) {
  const out = [];
  for (const entry of await readdir(join(root, dir), { withFileTypes: true }).catch(() => [])) {
    const rel = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...await sources(root, rel));
    else if (/\.(mjs|js)$/.test(entry.name) || dir.endsWith('bin')) out.push(join(root, rel));
  }
  return out;
}

test('TM-443 grep: no raw git spawn outside safe-git in the governance paths', async () => {
  const files = [...await sources(AO, 'topology/lib'), ...await sources(AO, 'src'), ...await sources(TM, 'lib'), ...await sources(TM, 'bin')];
  assert.ok(files.length >= 100, `scanned only ${files.length} files; the walk is broken`);
  const hits = [];
  for (const file of files) {
    if (file.endsWith('safe-git.mjs')) continue;
    const rel = relative(join(AO, '..'), file), text = await readFile(file, 'utf8');
    for (const match of text.matchAll(RAW_GIT)) hits.push({ rel, line: text.slice(0, match.index).split('\n').length, call: match[0] });
  }
  // Coverage: the pattern must actually find the known exception, or a clean result means nothing.
  assert.ok(hits.some(hit => hit.rel.endsWith('reviewer.mjs')), 'the pattern no longer matches the known reviewer.mjs calls');
  const violations = hits.filter(hit => !ALLOWED.has(hit.rel));
  assert.deepEqual(violations, [], `route these through safe-git: ${violations.map(v => `${v.rel}:${v.line} ${v.call}`).join('; ')}`);
});
