// TM-289: `ao-topology supervise` runs under process-compose with `restart: on_failure`, so its exit
// code IS its restart policy. These tests run the real CLI as a child process and read the code:
//   retired (repository removed)  → SUPERVISE_EXIT.RETIRED (0), and the repo leaves repos.json
//   lost the per-repo lock        → SUPERVISE_EXIT.TRY_LATER (75), and a later start takes over
//   crashed                       → non-zero
// The first also covers TM-186: retirement stops the watcher, so the process actually exits.
// tmux: every child points --server at an isolated socket with no server on it (rules in
// .claude/rules/tmux-test-isolation.md), and the repository opts out of enrollment so no lead —
// and so no tmux server — is ever started.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { run, readJson, sleep } from '../../topology/lib/util.mjs';
import { SUPERVISE_EXIT } from '../../topology/lib/supervision.mjs';
import { addServiceRepo, readServiceRepos } from '../../topology/lib/services-client.mjs';
import { withLock } from '../../topology/lib/lockfile.mjs';
import { canonicalRepoId, repoKey } from '../../topology/lib/repoid.mjs';
import { isolatedTmux } from '../helpers/isolated-tmux.mjs';

const CLI = fileURLToPath(new URL('../../topology/cli.mjs', import.meta.url));

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'ao-supervise-exit-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const repo = join(root, 'repo'), home = join(root, 'home');
  await run('git', ['init', '-q', repo]);
  // Opt out of enrollment: a Git repository is enrolled by default, and an enrolled supervisor
  // starts a real lead provider in its first tick. These tests are about the exit code only.
  await mkdir(join(repo, '.bytedesk', 'agent-orchestration'), { recursive: true });
  await writeFile(join(repo, '.bytedesk', 'agent-orchestration', 'config.json'), JSON.stringify({ enabled: false }));
  const { env: tmuxEnv, socket } = isolatedTmux(t);
  const env = { ...tmuxEnv, HOME: home, XDG_CONFIG_HOME: join(home, '.config'), AGENT_ORCHESTRATION_STATE_HOME: join(root, 'state') };
  delete env.AGENT_ORCHESTRATION_SERVICES_MANAGED; // never let a test reach the live services
  const key = repoKey((await canonicalRepoId(repo)).id);
  return { root, repo, home, env, socket, key, supervision: join(root, 'state', 'supervision') };
}

/** Starts `supervise` and resolves with its exit; kills only this child if it outlives `ms`. */
function supervise({ env, repo, socket }, ms = 45_000) {
  const child = spawn(process.execPath, [CLI, 'supervise', '--consumer', repo, '--server', socket], { env, stdio: ['ignore', 'pipe', 'pipe'] });
  let output = '';
  child.stdout.on('data', (d) => { output += d; });
  child.stderr.on('data', (d) => { output += d; });
  const timer = setTimeout(() => child.kill('SIGKILL'), ms);
  const exited = new Promise((resolve) => child.once('exit', (code, signal) => { clearTimeout(timer); resolve({ code, signal, output }); }));
  return { child, exited };
}

async function until(check, ms) {
  const end = Date.now() + ms;
  for (;;) { const value = await check(); if (value || Date.now() > end) return value; await sleep(100); }
}

const firstTick = (f, pid) => until(async () => {
  const record = await readJson(join(f.supervision, `${f.key}.process.json`)).catch(() => null);
  return record?.pid === pid && record.state === 'running';
}, 20_000);

test('a retired supervisor exits 0 within seconds and leaves repos.json', { timeout: 60_000 }, async (t) => {
  const f = await fixture(t);
  await addServiceRepo(f.repo, { env: f.env, home: f.home });
  await addServiceRepo(join(f.root, 'other'), { env: f.env, home: f.home }).catch(() => {});
  const before = await readServiceRepos(f.env, f.home);
  assert.ok(before.some((r) => r.consumer === f.repo), 'the repository starts registered');

  const { child, exited } = supervise(f);
  assert.ok(await firstTick(f, child.pid), 'the supervisor owns the repository and has ticked');
  await rm(f.repo, { recursive: true, force: true });
  const removedAt = Date.now();
  const { code, signal, output } = await exited;
  t.diagnostic(`exited ${Date.now() - removedAt}ms after removal: code=${code} signal=${signal}`);
  assert.equal(signal, null, `the process exits on its own (TM-186), not by the test's kill:\n${output}`);
  assert.equal(code, SUPERVISE_EXIT.RETIRED, output);
  assert.match(output, /retired-consumer-gone/);
  const after = await readServiceRepos(f.env, f.home);
  assert.ok(!after.some((r) => r.consumer === f.repo || r.key === f.key), 'the retired repository is deregistered');
  assert.equal(after.length, before.length - 1, 'only that repository is removed');
});

test('a supervisor that loses the per-repo lock exits TRY_LATER, and a later start takes over', { timeout: 60_000 }, async (t) => {
  const f = await fixture(t);
  assert.notEqual(SUPERVISE_EXIT.TRY_LATER, 0, 'a lock loser must be retried by on_failure');
  // The test holds the repository's lifetime lock, standing in for a live supervisor.
  const lost = await withLock(join(f.supervision, `${f.key}.lock`), async () => supervise(f).exited);
  assert.equal(lost.signal, null, lost.output);
  assert.equal(lost.code, SUPERVISE_EXIT.TRY_LATER, lost.output);
  assert.match(lost.output, /another-supervisor-owns-this-repository/);
  // The holder is gone: the retry process-compose would make now wins and ticks.
  const { child, exited } = supervise(f);
  t.after(() => { if (child.exitCode === null) child.kill('SIGKILL'); });
  assert.ok(await firstTick(f, child.pid), 'the retry owns the repository once the holder released it');
  child.kill('SIGTERM');
  await exited;
});

test('a crashing supervisor still exits non-zero', { timeout: 60_000 }, async (t) => {
  const f = await fixture(t);
  // A state root that is a regular file: the daemon cannot create its lock directory, which is an
  // unexpected error rather than a lock loss or a retirement — a crash, as process-compose sees it.
  const stateFile = join(f.root, 'state-is-a-file');
  await writeFile(stateFile, '');
  const { code, signal, output } = await supervise({ ...f, env: { ...f.env, AGENT_ORCHESTRATION_STATE_HOME: stateFile } }).exited;
  assert.equal(signal, null, output);
  assert.notEqual(code, SUPERVISE_EXIT.RETIRED, output);
  assert.notEqual(code, SUPERVISE_EXIT.TRY_LATER, `a crash must not look like a lock loss:\n${output}`);
});
