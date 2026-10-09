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
  assert.deepEqual(driverOverrides(listing), { refusal: null, overrides: [['filter.a.b.clean', ''], ['filter.a.b.smudge', ''], ['filter.a.b.process', ''], ['filter.a.b.required', 'false'], ['merge.m.driver', 'false'],
    ['credential.helper', ''], ['credential.https://github.com.helper', '!gh auth git-credential']] });
  assert.ok(SAFE_GIT_CONFIG.includes('credential.helper='), 'helpers are reset before the global ones are re-added');
  assert.deepEqual(hardenArgs(['diff', 'a', 'b']), ['diff', '--no-ext-diff', '--no-textconv', 'a', 'b']);
  assert.deepEqual(hardenArgs(['fetch', 'origin']), ['fetch', '--upload-pack=git-upload-pack', 'origin']);
  assert.deepEqual(hardenArgs(['status']), ['status']);
});

// ── PR #226 review: driver names containing `=`, worker-chosen transports, LFS ─────────────────────
const exists = path => readFile(path).then(() => true, () => false);
test('TM-443 review HIGH-1: a filter or merge driver whose name contains `=` never runs (exact repro)', async t => {
  const { dir, repo } = await repoWithOrigin(t);
  const pwned = join(dir, 'PWNED');
  raw(repo, 'config', 'filter.a=b.smudge', `sh -c 'touch ${pwned}'`);
  raw(repo, 'config', 'merge.a=b.driver', `sh -c 'touch ${pwned}-merge'`);
  await writeFile(join(repo, '.git', 'info', 'attributes'), '* filter=a=b merge=a=b\n');
  const added = safeGitSync(repo, ['worktree', 'add', '--detach', join(dir, 'wt'), 'HEAD']);
  assert.equal(added.status, 0, added.stderr);
  assert.equal(await exists(pwned), false, 'filter.a=b.smudge ran during worktree add');
  raw(repo, 'checkout', '-q', 'feature'); await writeFile(join(repo, 'a.txt'), 'one\nfeature\n'); raw(repo, 'commit', '-qam', 'conflicting'); raw(repo, 'checkout', '-q', 'main');
  await safeGit(repo, ['merge-tree', '--write-tree', 'side', 'feature'], { allowFailure: true });
  assert.equal(await exists(`${pwned}-merge`), false, 'merge.a=b.driver ran during merge-tree');
});

test('TM-443 review MEDIUM: a worker-chosen remote helper (`evil::`) is never run, and URL rewriting refuses the call', async t => {
  const { dir, repo } = await repoWithOrigin(t);
  const bin = join(dir, 'bin'), pwned = join(dir, 'PWNED-helper');
  execFileSync('mkdir', ['-p', bin]);
  await writeFile(join(bin, 'git-remote-evil'), `#!/bin/sh\ntouch ${pwned}\n`, { mode: 0o755 });
  const env = { ...process.env, PATH: `${bin}:${process.env.PATH}` };
  raw(repo, 'remote', 'set-url', 'origin', 'evil::x');
  const fetched = await safeGit(repo, ['fetch', 'origin', 'main'], { allowFailure: true, env });
  assert.notEqual(fetched.code, 0); assert.match(fetched.stderr, /transport 'evil' not allowed/);
  assert.equal(await exists(pwned), false, 'git-remote-evil ran');
  // A file:// origin still fetches (local origins are legitimate), but insteadOf/vcs rewriting is refused outright.
  raw(repo, 'remote', 'set-url', 'origin', `file://${join(dir, 'origin.git')}`);
  assert.equal((await safeGit(repo, ['fetch', 'origin', 'main'], { allowFailure: true })).code, 0);
  raw(repo, 'config', `url.evil::x.insteadOf`, `file://${join(dir, 'origin.git')}`);
  const rewritten = await safeGit(repo, ['fetch', 'origin', 'main'], { allowFailure: true, env });
  assert.equal(rewritten.code, 128); assert.match(rewritten.stderr, /safe-git refused .*url\.evil::x\.insteadof/);
  assert.equal(await exists(pwned), false);
  raw(repo, 'config', '--unset-all', 'url.evil::x.insteadOf'); raw(repo, 'config', 'remote.origin.vcs', 'evil');
  assert.match((await safeGit(repo, ['status'], { allowFailure: true })).stderr, /remote\.origin\.vcs/);
});

test('TM-443 review LOW: LFS never smudges, and a repository-scope LFS transfer agent refuses the call', async t => {
  const { repo } = await repoWithOrigin(t);
  const env = (await import('../../topology/lib/safe-git.mjs')).safeGitEnv({});
  assert.equal(env.GIT_LFS_SKIP_SMUDGE, '1');
  raw(repo, 'config', 'lfs.customtransfer.evil.path', '/tmp/evil');
  assert.equal(safeGitSync(repo, ['status']).status, 128);
  raw(repo, 'config', '--remove-section', 'lfs.customtransfer.evil'); raw(repo, 'config', 'lfs.standalonetransferagent', 'evil');
  assert.equal(safeGitSync(repo, ['status']).status, 128);
});

// ── PR #226 follow-up: environment allowlist and a root-owned gh ───────────────────────────────────
test('TM-443 follow-up: a caller-supplied GIT_CONFIG_GLOBAL, GIT_DIR, GIT_SSH_COMMAND or GIT_EXEC_PATH never reaches host git', async t => {
  const { dir, repo } = await repoWithOrigin(t);
  const { safeGitEnv } = await import('../../topology/lib/safe-git.mjs');
  const pwned = join(dir, 'PWNED-global'), cfg = join(dir, 'evil-global');
  await writeFile(cfg, `[filter "g"]\n\tsmudge = sh -c 'touch ${pwned}'\n\trequired = true\n`);
  await writeFile(join(repo, '.git', 'info', 'attributes'), '* filter=g\n');
  const env = { ...process.env, GIT_CONFIG_GLOBAL: cfg, GIT_DIR: join(dir, 'nowhere'), GIT_SSH_COMMAND: `touch ${pwned}-ssh`, GIT_EXEC_PATH: join(dir, 'nowhere'), GIT_ASKPASS: `touch ${pwned}-ask`, GIT_AUTHOR_NAME: 'Kept' };
  const added = safeGitSync(repo, ['worktree', 'add', '--detach', join(dir, 'wt-global'), 'HEAD'], { env });
  assert.equal(added.status, 0, added.stderr);
  assert.equal(await exists(pwned), false, 'a filter from a caller-supplied GIT_CONFIG_GLOBAL ran');
  const pinned = safeGitEnv(env);
  for (const name of ['GIT_DIR', 'GIT_SSH_COMMAND', 'GIT_EXEC_PATH', 'GIT_ASKPASS']) assert.equal(pinned[name], undefined, name);
  assert.equal(pinned.GIT_CONFIG_GLOBAL, join((await import('node:os')).homedir(), '.gitconfig'));
  assert.equal(pinned.GIT_AUTHOR_NAME, 'Kept', 'commit identity passes through');
});

test('TM-443 follow-up: host gh is the root-owned binary at a pinned path; a gh planted first on PATH never runs', async t => {
  const { dir } = await repoWithOrigin(t);
  const { GH_PATHS, rootOwnedChain, trustedGh } = await import('../../topology/lib/safe-git.mjs');
  const { hostGh } = await import('../../topology/lib/management.mjs');
  const bin = join(dir, 'home-bin'), marker = join(dir, 'PLANTED-GH');
  execFileSync('mkdir', ['-p', bin]);
  await writeFile(join(bin, 'gh'), `#!/bin/sh\ntouch ${marker}\necho planted\n`, { mode: 0o755 });
  const savedPath = process.env.PATH; process.env.PATH = `${bin}:${savedPath}`; t.after(() => { process.env.PATH = savedPath; });
  const resolved = trustedGh();
  assert.ok(resolved === null || GH_PATHS.includes(resolved), `resolved ${resolved}`);
  const answer = await hostGh(dir)(['--version']);
  assert.equal(await exists(marker), false, 'the planted ~/bin gh ran');
  if (resolved) assert.match(answer.stdout, /gh version/); else assert.equal(answer.code, 127);
  // The rule itself, on injected stats: pinned path only, root-owned, not group/world-writable, all the way up.
  const rootStat = () => ({ uid: 0, mode: 0o755 });
  assert.equal(rootOwnedChain('/usr/bin/gh', GH_PATHS, rootStat), true);
  assert.equal(rootOwnedChain(join(bin, 'gh'), GH_PATHS, rootStat), false, 'not a pinned path, even if root-owned');
  assert.equal(rootOwnedChain('/usr/bin/gh', GH_PATHS, p => ({ uid: p === '/usr/bin/gh' ? 1000 : 0, mode: 0o755 })), false, 'user-owned file');
  assert.equal(rootOwnedChain('/usr/bin/gh', GH_PATHS, p => ({ uid: 0, mode: p === '/usr/bin' ? 0o777 : 0o755 })), false, 'world-writable directory');
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
