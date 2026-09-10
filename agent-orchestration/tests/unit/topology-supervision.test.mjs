import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {run,writeJson,readJson,sleep as sleepMs} from '../../topology/lib/util.mjs';
import {listServerPanes} from '../../topology/lib/tmux.mjs';
import {refreshPrompt} from '../../topology/lib/prompt-lifecycle.mjs';
import {superviseRepository,nextRung,SLEEP_LADDER_MS} from '../../topology/lib/supervision.mjs';
import {censusPath,withStaleness} from '../../topology/lib/census.mjs';
import {canonicalRepoId,repoKey} from '../../topology/lib/repoid.mjs';
import {mkdirSync} from 'node:fs';

/** Env for a test that may reach tmux, isolated the three ways .claude/rules/tmux-test-isolation.md
 * requires. Every test in this file built its own env literal, and not one of them blanked TMUX —
 * so a `supervise` daemon spawned here inherited the operator's server and watched it. An observed
 * run wrote a watcher record for serverKey /tmp/tmux-1000/default and pending enrollments for three
 * unrelated repositories. All read-only, and that is luck rather than design.
 *
 * One function rather than five literals, because the previous arrangement is exactly how four of
 * them stayed wrong while the fifth looked fine: a guard present in one caller and absent in its
 * siblings. TMUX_TMPDIR is created eagerly — tmux refuses a directory that does not exist, and a
 * refusal here would read as "no server", which is the answer we want for the wrong reason. */
const isolatedEnv = (root, home, extra = {}) => {
  const tmux = join(root, 'tmux');
  mkdirSync(tmux, { recursive: true });
  return { ...process.env, TMUX: '', TMUX_TMPDIR: tmux, AGENT_ORCHESTRATION_STATE_HOME: join(root, 'state'), XDG_CONFIG_HOME: join(home, '.config'), ...extra };
};

test('supervision refreshes a live workflow instance and publishes exact membership without applying an unacknowledged change',async t=>{
 const root=await mkdtemp(join(tmpdir(),'ao-supervision-'));t.after(()=>rm(root,{recursive:true,force:true}));
 const repo=join(root,'repo'),home=join(root,'home'),env=isolatedEnv(root,home);
 await run('git',['init',repo]);
 const server=`ao-supervise-${process.pid}-${Date.now()}`;t.after(()=>run('tmux',['-L',server,'kill-server'],{allowFailure:true}));
 await run('tmux',['-L',server,'new-session','-d','-s','workflow','-c',repo,'sleep','60']);
 const binding=(await listServerPanes({tmuxServer:server}))[0];
 const conf=join(repo,'.bytedesk/agent-orchestration');await mkdir(conf,{recursive:true});
 await writeJson(join(conf,'config.json'),{prompts:{common:'./policy.md'}});await writeFile(join(conf,'policy.md'),'initial policy');
 const runDir=join(conf,'runs','run-one'),dir=join(runDir,'agents','runagent');await mkdir(dir,{recursive:true});
 const agent={id:'runagent',role:'worker',full_name:'Workflow Worker',instructions:'work',_dir:dir};
 await writeJson(join(dir,'prompt-agent.json'),agent);
 await writeJson(join(runDir,'run.json'),{run_id:'run-one',name:'workflow',run_dir:runDir,consumer:repo,session:'workflow',depth:0,parent:null,agents:[{id:agent.id,role:'worker',binding}]});
 const staged=await refreshPrompt({agent,consumer:repo,home,env});assert.equal(staged.status,'awaiting-ack');
 await writeFile(join(conf,'policy.md'),'changed policy');
 const report=await superviseRepository({consumer:repo,home,env,tmuxServer:server},{once:true});
 assert.equal(report.prompts.find(p=>p.agent===agent.id).status,'queued');
 assert.match(await readFile(join(dir,'prompt.pending.md'),'utf8'),/changed policy/);
 const state=JSON.parse(await readFile(join(dir,'prompt-state.json'),'utf8'));assert.equal(state.applied_revision,undefined);
});

// ── Phase 0.5: the tick must be safe as a `"when": "always"` monitor ────────────────────────────
// Every assertion below is about a property that makes eight concurrent supervisors on one machine
// correct rather than merely survivable.

/** SIGKILL a supervisor and wait until it is actually gone.
 *  A test that removes a state directory while a real daemon is still writing into it fails in
 *  teardown with ENOTEMPTY, which reads like a product bug and is not one. Reap first, then clean. */
async function reap(pid) {
  try { process.kill(pid, 'SIGKILL'); } catch { return; }
  for (let i = 0; i < 100; i++) {
    try { process.kill(pid, 0); } catch { return; }
    await sleepMs(50);
  }
}

/** A repo with no tmux server and no agents: enough for the loop, cheap enough to run in a test. */
async function quietRepo(t, label) {
  const root = await mkdtemp(join(tmpdir(), `ao-supervise-${label}-`));
  t.after(() => rm(root, { recursive: true, force: true }));
  const repo = join(root, 'repo'), home = join(root, 'home');
  const env = isolatedEnv(root, home);
  await run('git', ['init', repo]);
  return { root, repo, home, env, options: { consumer: repo, home, env, tmuxServer: `ao-absent-${process.pid}-${Date.now()}` } };
}

test('a second supervisor for the same repository exits on the lock instead of double-publishing', async t => {
  const { options } = await quietRepo(t, 'lock');
  let firstIsInside, releaseFirst;
  const inside = new Promise(resolve => { firstIsInside = resolve; });
  const held = new Promise(resolve => { releaseFirst = resolve; });
  // The first supervisor parks inside the lock; the second must not get in behind it.
  const first = superviseRepository(options, { once: true, onTick: async () => { firstIsInside(); await held; } });
  await inside;
  await assert.rejects(
    superviseRepository(options, { once: true }),
    error => error.code === 'TOPOLOGY_LOCK_TIMEOUT',
    'the loser must fail closed on the lock, never proceed to publish a second snapshot',
  );
  releaseFirst();
  const report = await first;
  assert.equal(report.reconciled, true);
});

test('the expensive reconcile body runs at most once per AO_RECONCILE_MIN_MS across many cheap ticks', async t => {
  const { options } = await quietRepo(t, 'floor');
  const ticks = [];
  const controller = new AbortController();
  // A generous floor and a no-op sleep: every tick after the first is inside the window, so exactly
  // one reconcile may happen however many times the loop goes round.
  await superviseRepository(options, {
    signal: controller.signal,
    reconcileMinMs: 3_600_000,
    sleepFn: async () => {},
    onTick: report => { ticks.push(report); if (ticks.length === 12) controller.abort(); },
  });
  assert.equal(ticks.length, 12);
  assert.equal(ticks.filter(tick => tick.reconciled).length, 1, 'only the first tick may pay for git + readdir + refreshPrompt');
  assert.equal(ticks[0].reconciled, true);
  // A cheap tick still carries the last reconcile's answer forward rather than inventing an empty one.
  assert.equal(ticks[11].repo_id, ticks[0].repo_id);
  assert.equal(ticks[11].generation, ticks[0].generation);
});

test('the tick sleep walks 2s / 5s / 15s while quiet', async t => {
  const { options } = await quietRepo(t, 'ladder');
  const slept = [];
  const controller = new AbortController();
  await superviseRepository(options, {
    signal: controller.signal,
    reconcileMinMs: 0,
    sleepFn: async ms => { slept.push(ms); if (slept.length >= 5) controller.abort(); },
    onTick: () => {},
  });
  assert.deepEqual(slept, [2000, 5000, 15000, 15000, 15000], 'a quiet repo must back off and stay backed off, not poll the filesystem every second');
});

test('any activity snaps the ladder back to its busy rung rather than stepping down it', () => {
  assert.equal(nextRung(-1, false), 0, 'the first tick sleeps at the busy rung');
  assert.equal(nextRung(0, false), 1);
  assert.equal(nextRung(1, false), 2);
  assert.equal(nextRung(2, false), 2, 'the slow rung is the floor, never an unbounded backoff');
  for (const rung of [0, 1, 2]) assert.equal(nextRung(rung, true), 0);
  assert.deepEqual(SLEEP_LADDER_MS, [2000, 5000, 15000]);
});

test('the supervisor records where it went and how often it has been restarted', async t => {
  const { options, env, home, repo } = await quietRepo(t, 'restart');
  const { startRepositorySupervision, supervisionStatus } = await import('../../topology/lib/supervision.mjs');
  const first = await startRepositorySupervision(options);
  t.after(() => { try { process.kill(first.pid, 'SIGKILL'); } catch {} });
  assert.equal(first.restarts, 0);
  assert.match(first.log, /\.log$/);
  // An already-running supervisor is never spawned twice.
  const again = await startRepositorySupervision(options);
  assert.equal(again.pid, first.pid);
  assert.equal(again.state, 'running-or-ownership-unknown');
  const status = await supervisionStatus({ consumer: repo, env, home });
  assert.equal(status.pid, first.pid);
  assert.equal(status.state, 'running-or-ownership-unknown');
});

test('the census rides every tick, including the cheap ones, and is told its cadence', async t => {
  const { repo, home, env, options } = await quietRepo(t, 'census');
  const ticks = [];
  const controller = new AbortController();
  // A floor so generous that only the first tick reconciles: the census must still run on the
  // eleven cheap ticks after it, because that is the cadence it exists at. If it lived inside the
  // reconcile body it would be pegged to the 10s floor and the 2s rung would buy nothing.
  await superviseRepository(options, {
    signal: controller.signal,
    reconcileMinMs: 3_600_000,
    sleepFn: async () => {},
    onTick: report => { ticks.push(report); if (ticks.length === 12) controller.abort(); },
  });
  assert.equal(ticks.filter(tick => tick.reconciled).length, 1);
  assert.equal(ticks.filter(tick => tick.census).length, 12, 'the census runs on cheap ticks too');
  assert.ok(ticks.every(tick => Number.isInteger(tick.census.tick_ms)), 'tickMs makes a regression visible rather than felt');

  // The document lands where a scheduler will look for it, and carries what the loop told it.
  const key = repoKey((await canonicalRepoId(repo)).id);
  const document = await readJson(censusPath({ env, home, key }));
  assert.equal(document.repoId, (await canonicalRepoId(repo)).id);
  // Staleness is bound to the SLOWEST rung, not the rung we happen to be on: a document must not
  // read stale merely because the loop backed off.
  assert.equal(document.staleAfterMs, 3 * SLEEP_LADDER_MS[SLEEP_LADDER_MS.length - 1]);
  assert.ok(SLEEP_LADDER_MS.includes(document.intervalMs), 'the census records the cadence it was told');
  assert.equal(withStaleness(document, Date.parse(document.at) + 1000).stale, false);
  assert.equal(withStaleness(document, Date.parse(document.at) + document.staleAfterMs + 1).stale, true);
});

test('a quiet census does not pin the sleep ladder to its busy rung', async t => {
  const { options } = await quietRepo(t, 'census-ladder');
  const slept = [];
  const controller = new AbortController();
  await superviseRepository(options, {
    signal: controller.signal,
    reconcileMinMs: 0,
    sleepFn: async ms => { slept.push(ms); if (slept.length >= 5) controller.abort(); },
    onTick: () => {},
  });
  // Same expectation as the ladder test above, asserted again WITH the census in the loop: its
  // `activity` must mean the world moved, never that it looked.
  assert.deepEqual(slept, [2000, 5000, 15000, 15000, 15000]);
});

// ── TM-139: a supervisor must not die because its working directory went away ───────────────────

test('absolutize never consults the cwd for an already-absolute path', async () => {
  const { absolutize } = await import('../../topology/lib/util.mjs');
  const real = process.cwd;
  // Exactly what Node does inside a process whose cwd has been unlinked.
  process.cwd = () => { throw Object.assign(new Error('ENOENT: no such file or directory, uv_cwd'), { code: 'ENOENT', syscall: 'uv_cwd' }); };
  try {
    assert.equal(absolutize('/tmp/somewhere'), '/tmp/somewhere');
    assert.equal(absolutize('/tmp/a/../b'), '/tmp/b');
    assert.equal(absolutize('/tmp/x', '/ignored'), '/tmp/x');
    // A RELATIVE path genuinely needs a cwd, so it must still fail rather than invent one.
    assert.throws(() => absolutize('relative/path'), { syscall: 'uv_cwd' });
    // ...unless the caller supplied the base, which is the whole point of the parameter.
    assert.equal(absolutize('relative/path', '/base'), '/base/relative/path');
  } finally { process.cwd = real; }
});

test('a supervisor started with an absolute --consumer survives losing its working directory', async t => {
  const { spawn } = await import('node:child_process');
  const { fileURLToPath } = await import('node:url');
  const root = await mkdtemp(join(tmpdir(), 'ao-supervise-cwd-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const repo = join(root, 'repo'), home = join(root, 'home'), cwd = join(root, 'ephemeral');
  const env = isolatedEnv(root, home);
  await run('git', ['init', repo]);
  await mkdir(cwd, { recursive: true });

  // The exact shape of the real failure: the daemon's WORKING DIRECTORY is a task-owned worktree
  // that `tm` removes after a verified merge, while --consumer is an absolute path that is still
  // perfectly valid. Deleting the cwd before the child has bootstrapped means its first
  // process.cwd() is uncached, which is what made absolutize's eager default throw ENOENT/uv_cwd.
  const cli = fileURLToPath(new URL('../../topology/cli.mjs', import.meta.url));
  const log = [];
  // `--json` because the daemon stopped streaming every tick to stdout at 1de163b ("quiet the
  // supervise daemon in the console"). That change is right — a monitor should not print a JSON
  // blob every 2s — but it deleted this test's only signal and the suite merged red: green at
  // 1de163b^, red at 1de163b, verified by running the file at both. The contract that commit
  // documents is "a reader wanting per-tick detail passes --json", so this reader asks for it.
  const child = spawn(process.execPath, [cli, 'supervise', '--json', '--consumer', repo], { cwd, env, stdio: ['ignore', 'pipe', 'pipe'] });
  t.after(() => reap(child.pid));
  child.stdout.on('data', d => log.push(String(d)));
  child.stderr.on('data', d => log.push(String(d)));
  await new Promise((resolve, reject) => { child.once('spawn', resolve); child.once('error', reject); });
  await rm(cwd, { recursive: true, force: true });

  // It must reach a tick. Before TM-139 it exited immediately with `ENOENT ... uv_cwd` from
  // absolutize(), while its record still claimed `state: "starting"`.
  let ticked = false;
  for (let i = 0; i < 120 && !ticked; i++) { await sleepMs(100); ticked = log.join('').includes('"reconciled": true'); }
  assert.ok(ticked, `the supervisor must tick with its cwd gone; it said instead:\n${log.join('')}`);
  assert.equal(child.exitCode, null, 'and must still be running, not dead');
  assert.doesNotMatch(log.join(''), /uv_cwd/, 'no cwd syscall may be reached for an absolute --consumer');
  // Stop it HERE, not only in a hook: the daemon writes into <root>/state and cleanup removes <root>.
  await reap(child.pid);
});

test('a supervisor that died during startup is not reported as a healthy one', async t => {
  const { supervisionStatus } = await import('../../topology/lib/supervision.mjs');
  const { repoKey, canonicalRepoId } = await import('../../topology/lib/repoid.mjs');
  const root = await mkdtemp(join(tmpdir(), 'ao-supervise-states-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const repo = join(root, 'repo'), home = join(root, 'home');
  const env = isolatedEnv(root, home);
  await run('git', ['init', repo]);
  const key = repoKey((await canonicalRepoId(repo)).id);
  const recordPath = join(root, 'state', 'supervision', `${key}.process.json`);
  const write = record => writeJson(recordPath, record);
  const base = { pid: 2147480000, repo_id: (await canonicalRepoId(repo)).id, consumer: repo, started_at: new Date().toISOString(), restarts: 0 };

  await write({ ...base, state: 'starting' });
  assert.equal((await supervisionStatus({ consumer: repo, env, home })).state, 'died-before-first-tick');

  await write({ ...base, state: 'running', first_tick_at: new Date().toISOString() });
  assert.equal((await supervisionStatus({ consumer: repo, env, home })).state, 'down');

  // A record naming a directory that no longer exists can never be reclaimed by a restart.
  await write({ ...base, consumer: join(root, 'gone'), state: 'starting' });
  const orphan = await supervisionStatus({ consumer: repo, env, home });
  assert.equal(orphan.state, 'orphaned');
  assert.equal(orphan.consumer_exists, false);
  assert.match(orphan.record_path, /\.process\.json$/);
});

test('a supervisor retires itself when the repository it supervises is removed', async t => {
  const { superviseRepository } = await import('../../topology/lib/supervision.mjs');
  const root = await mkdtemp(join(tmpdir(), 'ao-supervise-retire-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const repo = join(root, 'repo'), home = join(root, 'home');
  const env = isolatedEnv(root, home);
  await run('git', ['init', repo]);
  let ticks = 0;
  // Once the crash is fixed, "the repo went away" must not become an immortal daemon spinning on a
  // deleted path. The loop has to end on its own, without a signal.
  const report = await superviseRepository({ consumer: repo, home, env, tmuxServer: `ao-absent-${process.pid}` }, {
    reconcileMinMs: 0,
    sleepFn: async () => { if (++ticks === 2) await rm(repo, { recursive: true, force: true }); },
    onTick: () => {},
  });
  assert.equal(report.stopped, 'consumer-gone', 'the supervisor must stop, and record why');
  assert.ok(ticks >= 2 && ticks < 20, `it must stop promptly, not spin (ticks: ${ticks})`);
});
