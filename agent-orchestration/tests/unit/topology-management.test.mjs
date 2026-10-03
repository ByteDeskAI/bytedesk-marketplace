import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { readJson, run, writeJson } from '../../topology/lib/util.mjs';
import { canonicalRepoId, pinnedGithubRepo, repoKey } from '../../topology/lib/repoid.mjs';
import { admitTask, workerReport, integrationEligibility, integrateTask, cleanupTask, bindTaskWorker, taskWorkerState, managementStatus, recordLanding } from '../../topology/lib/management.mjs';
import { grantDelegation as rawGrant, agentMarkers, planDigest } from '../../topology/lib/delegation.mjs';
// TM-248: a grant names an approved plan (here epic EP-19, which the fixture task TM-1 belongs to) and an expiry.
// epicTasks stands in for the task store at grant time: the grant freezes whatever it returns.
const EPICS = { 'EP-19': ['TM-1'], 'EP-20': ['TM-3'] };
const grantDelegation = ({ epicTasks = async epic => EPICS[epic] || [], ...opts }) => rawGrant({ io: { ancestors: async () => ['zsh'], isTTY: () => true, ask: async q => q.match(/Type "([^"]+)"/)[1], epicTasks }, plan: { epic: 'EP-19' }, expires: '7d', ...opts });
// The fixture caller is an operator shell: no agent markers from the environment running the suite, no agent ancestor.
const operatorEnv = () => Object.fromEntries(Object.entries(process.env).filter(([k]) => !agentMarkers({ [k]: '1' }).length));
const SHELL_ANCESTRY = async () => ['zsh', 'tmux: server'];
import { topologyRunLocation } from '../../topology/lib/discovery.mjs';
import { listServerPanes } from '../../topology/lib/tmux.mjs';
import { isolatedTmux } from '../helpers/isolated-tmux.mjs';

const NO_SERVER_GH = async () => ({ code: 1, stdout: '', stderr: 'no server in the fixture' });
const NO_SERVER_COMPARE = async () => { throw new Error('no server in the fixture'); };
async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'ao-manage-')); t.after(() => rm(root, { recursive: true, force: true }));
  const consumer = join(root, 'repo'), worktree = join(root, 'task'), pluginRoot = join(root, 'plugin');
  await mkdir(consumer); await run('git', ['init', '-q', '-b', 'main', consumer]);
  const git = async (cwd, args) => run('git', ['-C', cwd, ...args]);
  await writeFile(join(consumer, 'code.txt'), 'base');
  await git(consumer, ['add', 'code.txt']);
  await git(consumer, ['-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', 'commit', '-m', 'base']);
  const doc = { id: 'TM-1', epic: 'EP-19', status: 'todo', labels: ['ready-for-agent'], touches: ['code.txt'], blockedBy: [] };
  const calls = []; let claim = null;
  const store = {
    root: consumer,
    show: async () => ({ ...doc }), claim: async () => claim,
    provision: async () => { calls.push('provision'); await git(consumer, ['worktree', 'add', '-b', 'tm/TM-1', worktree]); Object.assign(doc, { worktree, branch: 'tm/TM-1' }); claim = { session: 'author', worktree, branch: doc.branch }; },
    start: async () => { calls.push('start'); doc.status = 'in_progress'; },
    comment: async (_task, value) => { calls.push(JSON.parse(value).event); },
    evidence: async () => { calls.push('collect'); },
    removeWorktree: async () => { calls.push('remove'); await git(consumer, ['worktree', 'remove', worktree]); },
    done: async () => { calls.push('done'); doc.status = 'done'; },
  };
  await writeJson(join(pluginRoot, 'config.defaults.json'), { management: { auto_merge: true, target_branch: 'main', required_checks: [{ name: 'content', argv: [process.execPath, '-e', "if(require('fs').readFileSync('code.txt','utf8')!=='implemented') process.exit(1)"] }] } });
  const opts = { consumer, pluginRoot, home: join(root, 'home'), ancestors: SHELL_ANCESTRY, env: { ...operatorEnv(), XDG_CONFIG_HOME: join(root, 'config'), AGENT_ORCHESTRATION_STATE_HOME: join(root, 'state') }, store, task: 'TM-1', owner: 'author', intent: 'Implement file', boundaries: ['code.txt only'], dependencies: [], checks: ['content'], reviewerReady: async () => ({ available: true }),
    // No server in the fixture (TM-263): gh and the server compare answer "unavailable", so the lead-autonomy
    // policy is absent and a lead's record-landing cannot be server-verified unless a test injects a server.
    gh: NO_SERVER_GH, serverCompare: NO_SERVER_COMPARE, reviewGate: async () => ({ eligible: true, reasons: [], status: { review: { verdict: 'approve', reviewer_id: 'fixture-reviewer' } } }), workerState: async () => ({ owned: true, active: false, alive: false }) };
  const finish = async () => {
    await writeFile(join(worktree, 'code.txt'), 'implemented'); await git(worktree, ['add', 'code.txt']);
    await git(worktree, ['-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', 'commit', '-m', 'implementation']);
    const revision = (await git(worktree, ['rev-parse', 'HEAD'])).stdout.trim();
    return workerReport({ ...opts, kind: 'finish', report: { artifacts: ['code.txt'], checks: ['content'], risks: [], evidence: 'fixture result', revision } });
  };
  return { opts, doc, calls, finish, git, setClaim: value => { claim = value; } };
}

test('new admission requires reviewer, task scope, ownership and complete protocol before provisioning', async t => {
  const { opts, calls, setClaim } = await fixture(t);
  await assert.rejects(admitTask({ ...opts, reviewerReady: async () => ({ available: false, reason: 'nonce unanswered' }) }), { code: 'TOPOLOGY_MANAGEMENT_REVIEWER' });
  assert.deepEqual(calls, []);
  await assert.rejects(admitTask({ ...opts, checks: [] }), { code: 'TOPOLOGY_MANAGEMENT_START_PROTOCOL' });
  setClaim({ session: 'peer' });
  await assert.rejects(admitTask(opts), { code: 'TOPOLOGY_MANAGEMENT_OWNERSHIP' });
  assert.deepEqual(calls, []);
  setClaim(null); const result = await admitTask(opts);
  assert.equal(result.admitted, true); assert.deepEqual(calls, ['provision', 'start', 'start']);
  await admitTask(opts); assert.equal(calls.filter(c => c === 'provision').length, 1);
});

test('adopted active worker is preserved for migration review', async t => {
  const { opts, doc, calls } = await fixture(t); doc.status = 'in_progress';
  const result = await admitTask(opts);
  assert.equal(result.state, 'ownership-review-required'); assert.deepEqual(calls, ['ownership-review-required']);
});

test('finish survives reviewer outage but merge fails closed and task is never automatically done', async t => {
  const { opts, calls, finish } = await fixture(t);
  await assert.rejects(workerReport({ ...opts, kind: 'finish', report: {} }), { code: 'TOPOLOGY_MANAGEMENT_PROTOCOL' });
  await admitTask(opts); await finish();
  assert.equal(calls.includes('done'), false);
  const gate = await integrationEligibility({ ...opts, reviewGate: async () => ({ reasons: ['reviewer unavailable'] }) });
  assert.equal(gate.eligible, false); assert.ok(gate.reasons.includes('reviewer unavailable'));
  await assert.rejects(integrateTask({ ...opts, workerState: async () => ({ owned: true, active: true }) }), { code: 'TOPOLOGY_MANAGEMENT_INTEGRATION_BLOCKED' });
});

test('configured checks, verified local merge and tm cleanup close only the owned task in order', async t => {
  const { opts, calls, finish, git } = await fixture(t);
  await admitTask(opts); const report = await finish();
  assert.equal((await integrationEligibility(opts)).eligible, true);
  const integrated = await integrateTask(opts);
  assert.equal(integrated.merge.revision, report.finish.revision);
  assert.equal((await git(opts.consumer, ['rev-parse', 'HEAD'])).stdout.trim(), report.finish.revision);
  const cleaned = await cleanupTask(opts); assert.equal(cleaned.cleaned, true);
  assert.ok(calls.indexOf('collect') < calls.indexOf('remove')); assert.ok(calls.indexOf('remove') < calls.indexOf('done'));
  assert.equal((await git(opts.consumer, ['branch', '--list', 'tm/TM-1'])).stdout.trim(), '');
});

test('dirty, changed and unowned task cleanup preserves work with recovery reason', async t => {
  const { opts, finish, calls } = await fixture(t);
  await admitTask(opts); await finish(); await integrateTask(opts);
  await writeFile(join((await opts.store.show()).worktree, 'uncollected.txt'), 'keep me');
  const blocked = await cleanupTask(opts); assert.equal(blocked.cleaned, false); assert.match(blocked.recovery, /Preserve/);
  assert.equal(calls.includes('remove'), false); assert.equal(calls.includes('done'), false);
});

test('actual tm CLI provisions once, records worker claim, and enforces start before admission', async t => {
  const { opts } = await fixture(t);
  const { fileURLToPath } = await import('node:url');
  const tmBin = fileURLToPath(new URL('../../../task-management/bin/tm', import.meta.url));
  const env = { ...opts.env, TM_ROOT: opts.consumer, TM_SESSION_ID: 'author', CLAUDE_PROJECT_DIR: opts.consumer };
  const tm = async args => run(tmBin, args, { cwd: opts.consumer, env });
  await tm(['init']);
  await tm(['epic', 'new', 'Fixture integration']);
  await tm(['task', 'new', 'Implement scoped content change', '--body', 'Change code.txt to implemented and validate its exact contents.', '--ac', 'code.txt contains implemented']);
  await tm(['label', 'TM-001', 'ready-for-agent']);
  await tm(['touches', 'TM-001', 'code.txt']);
  const actual = { ...opts, store: undefined, task: 'TM-001', tmBin, env };
  const first = await admitTask(actual);
  assert.equal(first.admitted, true);
  const doc = JSON.parse((await tm(['show', 'TM-001', '--json'])).stdout);
  assert.equal(doc.status, 'in_progress');
  assert.equal(doc.worktree, first.record.worktree);

  const state = await readJson(join(opts.consumer, '.bytedesk/task-management/state.json'));
  assert.equal(state.claims['TM-001'].session, 'author');
  assert.equal(state.claims['TM-001'].worktree, doc.worktree);
  assert.equal((await admitTask(actual)).resumed, true);
  const worktrees = JSON.parse((await tm(['worktree', '--json'])).stdout);
  assert.equal(worktrees.filter(w => w.taskId === 'TM-001').length, 1);
});

test('TM-240: a standing reviewer refuses unadmitted tm dispatch; admit, dispatch, finish yields a reviewable revision', async t => {
  const { opts, git } = await fixture(t);
  const { fileURLToPath } = await import('node:url');
  const { reviewerPaths } = await import('../../topology/lib/reviewer.mjs');
  const tmBin = fileURLToPath(new URL('../../../task-management/bin/tm', import.meta.url));
  const env = { ...opts.env, TM_ROOT: opts.consumer, TM_SESSION_ID: 'author', CLAUDE_PROJECT_DIR: opts.consumer };
  delete env.TM_DISPATCH_WORKER; // the fixture plays the lead, even when the suite runs inside a worker
  const tm = async (args, allowFailure = false) => run(tmBin, args, { cwd: opts.consumer, env, allowFailure });
  await tm(['init']);
  await tm(['epic', 'new', 'Fixture integration']);
  await tm(['task', 'new', 'Implement scoped content change', '--body', 'Change code.txt to implemented and validate its exact contents.', '--ac', 'code.txt contains implemented']);
  await tm(['label', 'TM-001', 'ready-for-agent']);
  await tm(['touches', 'TM-001', 'code.txt']);
  // A standing reviewer for this repository, and dispatch.governed left unset.
  const reviewer = await reviewerPaths(opts.consumer, opts.env, opts.home);
  await writeJson(reviewer.recordPath, { agent_id: 'reviewer-1', repo_id: reviewer.identity.id, provider: 'claude', binding: { serverKey: '/tmp/s', serverPid: 1, sessionId: '$1', sessionCreated: 1, paneId: '%1', panePid: 2 } });

  const refused = await tm(['dispatch', 'TM-001', '--backend', 'manual'], true);
  assert.notEqual(refused.code, 0);
  assert.match(refused.stderr, /TM_GOVERNED_ADMISSION_REQUIRED: .*ao-topology manage admit --task TM-001/);
  assert.equal(JSON.parse((await tm(['show', 'TM-001', '--json'])).stdout).dispatched, undefined);

  const actual = { ...opts, store: undefined, task: 'TM-001', tmBin, env };
  assert.equal((await admitTask(actual)).admitted, true);
  // A real, observable worker process in the task worktree, through tm's own registry seam.
  const registry = join(opts.consumer, '..', 'registry.mjs');
  await writeFile(registry, `import { spawn } from 'node:child_process';
export default { proc: { name: 'proc', available: () => true, spawn: ({ worktree }) => {
  const child = spawn('sleep', ['60'], { cwd: worktree, detached: true, stdio: 'ignore' }); child.unref();
  return { ok: true, run: 'proc:' + child.pid, pid: child.pid };
} } };`);
  env.TM_DISPATCH_REGISTRY = registry;
  const dispatched = JSON.parse((await tm(['dispatch', 'TM-001', '--backend', 'proc', '--json'])).stdout);
  t.after(() => { try { process.kill(dispatched.detail?.pid ?? Number(dispatched.run.slice(5))); } catch {} });
  assert.equal(dispatched.ok, true); assert.equal(dispatched.ungoverned, undefined);

  const { worktree } = JSON.parse((await tm(['show', 'TM-001', '--json'])).stdout);
  await writeFile(join(worktree, 'code.txt'), 'implemented'); await git(worktree, ['add', 'code.txt']);
  await git(worktree, ['-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', 'commit', '-m', 'implementation']);
  const revision = (await git(worktree, ['rev-parse', 'HEAD'])).stdout.trim();
  const finished = await workerReport({ ...actual, kind: 'finish', report: { artifacts: ['code.txt'], checks: ['content'], risks: [], evidence: 'fixture result', revision }, wake: async () => ({ rang: false, reason: 'fixture' }) });
  assert.equal(finished.review_blocked, undefined, finished.review_blocked);
  assert.equal(finished.review_request?.revision, revision);
  assert.equal(finished.review_request.reviewer_id, 'reviewer-1');
});

test('TM-240: the reviewer accepts an admitted revision from an agent-orchestration copy with task-management absent', async t => {
  const { cp } = await import('node:fs/promises');
  const { existsSync } = await import('node:fs');
  const { fileURLToPath } = await import('node:url');
  const root = await mkdtemp(join(tmpdir(), 'ao-alone-')); t.after(() => rm(root, { recursive: true, force: true }));
  await cp(fileURLToPath(new URL('../../topology', import.meta.url)), join(root, 'agent-orchestration', 'topology'), { recursive: true });
  assert.equal(existsSync(join(root, 'task-management')), false);
  const { requestReview, reviewerPaths } = await import(join(root, 'agent-orchestration', 'topology', 'lib', 'reviewer.mjs'));
  const { canonicalRepoId, repoKey, stateRoot } = await import(join(root, 'agent-orchestration', 'topology', 'lib', 'repoid.mjs'));
  const consumer = join(root, 'repo'); await mkdir(consumer); await run('git', ['init', '-q', '-b', 'main', consumer]);
  const commit = async (text) => { await writeFile(join(consumer, 'code.txt'), text); await run('git', ['-C', consumer, 'add', 'code.txt']);
    await run('git', ['-C', consumer, '-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', 'commit', '-qm', text]);
    return (await run('git', ['-C', consumer, 'rev-parse', 'HEAD'])).stdout.trim(); };
  const base = await commit('base'), revision = await commit('implemented');
  const env = { ...process.env, AGENT_ORCHESTRATION_STATE_HOME: join(root, 'state'), PATH: '/usr/bin:/bin' }, home = join(root, 'home');
  const identity = await canonicalRepoId(consumer);
  await writeJson(join(stateRoot(env, home), 'management', repoKey(identity.id), 'TM-1.json'), { task: 'TM-1', repo_id: identity.id, started: true, owner: 'author', base_revision: base, finish: { revision } });
  const reviewer = await reviewerPaths(consumer, env, home);
  await writeJson(reviewer.recordPath, { agent_id: 'reviewer-1', repo_id: identity.id, binding: { serverKey: '/tmp/s', serverPid: 1, sessionId: '$1', sessionCreated: 1, paneId: '%1', panePid: 2 } });
  const request = await requestReview({ consumer, task: 'TM-1', revision, authorAgentIds: ['author'], env, home, wake: async () => ({ rang: false }) });
  assert.equal(request.base_revision, base); assert.equal(request.state, 'published');
});

test('failed required checks and out-of-scope files prevent integration', async t => {
  const { opts, finish, calls, git } = await fixture(t);
  await admitTask(opts); await finish();
  await writeJson(join(opts.pluginRoot, 'config.defaults.json'), { management: { auto_merge: true, target_branch: 'main', required_checks: [{ name: 'fails', argv: [process.execPath, '-e', 'process.exit(7)'] }] } });
  await assert.rejects(integrateTask(opts), { code: 'TOPOLOGY_MANAGEMENT_CHECK_FAILED' });
  assert.equal(calls.includes('merge'), false);
  const doc = await opts.store.show(); await writeFile(join(doc.worktree, 'unapproved.txt'), 'outside scope');
  await git(doc.worktree, ['add', 'unapproved.txt']); await git(doc.worktree, ['-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', 'commit', '-m', 'scope violation']);
  assert.equal((await integrationEligibility(opts)).eligible, false);
  const revision = (await git(doc.worktree, ['rev-parse', 'HEAD'])).stdout.trim();
  await workerReport({ ...opts, kind: 'finish', report: { revision, artifacts: ['unapproved.txt'], checks: ['check'], risks: [], evidence: 'fixture' } });
  const gate = await integrationEligibility(opts);
  assert.ok(gate.reasons.some(reason => reason.includes('outside the approved task scope')));
});

test('production worker proof uses actual tm registry and observed process exit before merge and cleanup', async t => {
  const { opts, git } = await fixture(t);
  const { fileURLToPath } = await import('node:url');
  const { spawn } = await import('node:child_process');
  const { once } = await import('node:events');
  const { taskWorkerState, bindTaskWorker, managementStatus } = await import('../../topology/lib/management.mjs');
  const { registerAgent, retireAgent } = await import('../../../task-management/lib/agents.mjs');
  const { update } = await import('../../../task-management/lib/store.mjs');
  const { paths } = await import('../../../task-management/lib/paths.mjs');
  const tmBin = fileURLToPath(new URL('../../../task-management/bin/tm', import.meta.url));
  const env = { ...opts.env, TM_ROOT: opts.consumer, TM_SESSION_ID: 'author', CLAUDE_PROJECT_DIR: opts.consumer };
  const tm = async args => run(tmBin, args, { cwd: opts.consumer, env });
  await tm(['init']); await tm(['epic', 'new', 'Runtime fixture']);
  await tm(['task', 'new', 'Change scoped content', '--body', 'Implement and verify code.txt.', '--ac', 'content matches']);
  await tm(['label', 'TM-001', 'ready-for-agent']); await tm(['touches', 'TM-001', 'code.txt']);
  // Fixture store is local-only so tm evidence writes do not dirty the integration branch.
  await writeFile(join(opts.consumer, '.git/info/exclude'), '.bytedesk/\n');
  // TM-248: TM_SESSION_ID marks a managed session, so the operator's own verbs run without it; taskStore sets it from owner for tm.
  const { TM_SESSION_ID: _session, ...operatorVerbEnv } = env;
  const actual = { ...opts, store: undefined, task: 'TM-001', tmBin, env: operatorVerbEnv, workerState: undefined };
  const admitted = await admitTask(actual), worktree = admitted.record.worktree;
  const child = spawn(process.execPath, ['-e', 'process.stdin.resume(); process.stdin.on("end",()=>process.exit(0));'], { cwd: worktree, stdio: ['pipe', 'ignore', 'ignore'] });
  await once(child, 'spawn');
  t.after(() => { if (child.exitCode === null) child.kill(); });
  const p = paths(opts.consumer), workerRun = 'fixture-process:implementation';
  update('TM-001', { dispatched: { backend: 'fixture-process', run: workerRun, session: 'author' } }, p);
  registerAgent({ name: 'fixture-task-worker', backend: 'fixture-process', runId: workerRun, pid: child.pid, session: 'author' }, p);
  await bindTaskWorker(actual);
  await writeFile(join(worktree, 'code.txt'), 'implemented'); await git(worktree, ['add', 'code.txt']);
  await git(worktree, ['-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', 'commit', '-m', 'implementation']);
  const revision = (await git(worktree, ['rev-parse', 'HEAD'])).stdout.trim();
  actual.authorized=true;actual.actor='fixture-human';
  actual.reviewGate=async()=>({eligible:true,reasons:[],status:{review:{task:'TM-001',repo_id:admitted.record.repo_id,revision,verified_commit:revision,
    verdict:'approve',findings:[],reviewer_id:'fixture-reviewer',author_agent_ids:['author'],request_nonce:'fixture-review-nonce',
    binding:{serverKey:'/fixture/socket',serverPid:1,sessionId:'$1',sessionCreated:1,paneId:'%1',panePid:2}}}});
  await workerReport({ ...actual, kind: 'finish', report: { revision, artifacts: ['code.txt'], checks: ['content'], evidence: 'actual registry fixture result', risks: [] } });
  const liveGate = await integrationEligibility(actual); assert.equal(liveGate.eligible, false); assert.ok(liveGate.reasons.some(reason => reason.includes('still alive')));
  retireAgent('fixture-task-worker', p);
  assert.equal((await taskWorkerState(actual, (await managementStatus(actual)).management)).active, true, 'a retired registry label never proves the process exited');
  const exited = once(child, 'exit'); child.stdin.end(); await exited;
  const state = await taskWorkerState(actual, (await managementStatus(actual)).management);
  assert.equal(state.owned, true); assert.equal(state.active, false); assert.equal(state.proof, 'observed-process-exited');
  await tm(['accept', 'TM-001', '1']);
  assert.equal((await integrationEligibility(actual)).eligible, true);
  await integrateTask(actual);
  const cleanup = await cleanupTask(actual);
  assert.equal(cleanup.cleaned, true, cleanup.reason);
  assert.equal(JSON.parse((await tm(['show', 'TM-001', '--json'])).stdout).status, 'done');
});

test('tmux default worker proof binds the real pane incarnation and waits for its exit', async t => {
  const available = await run('tmux', ['-V'], { allowFailure: true });
  if (available.code !== 0) return t.skip('tmux unavailable');
  const { opts, doc, finish } = await fixture(t);
  const { bindTaskWorker, taskWorkerState, managementStatus } = await import('../../topology/lib/management.mjs');
  await admitTask(opts);
  const iso = isolatedTmux(t), socket = iso.socket;
  await iso.tmux(['new-session', '-d', '-s', 'owned-worker', '-c', doc.worktree, 'sleep', '30']);
  const serverPid = (await run('tmux', ['-S', socket, 'display-message', '-p', '#{pid}'])).stdout.trim();
  doc.dispatched = { backend: 'tmux', run: 'tmux:owned-worker', session: 'author' };
  opts.store.workers = async () => [{ name: 'fixture-tmux-worker', backend: 'tmux', runId: doc.dispatched.run, session: 'author', registeredAt: 'fixture', status: 'active', pid: null }];
  const actual = { ...opts, workerState: undefined, env: { ...opts.env, TMUX: `${socket},${serverPid},0` } };
  const bound = await bindTaskWorker(actual);
  assert.equal(bound.worker.binding.serverKey, socket); assert.equal(bound.worker.binding.serverPid, Number(serverPid));
  await finish();
  const record = (await managementStatus(actual)).management;
  assert.equal((await taskWorkerState(actual, record)).active, true);
  await run('tmux', ['-S', socket, 'kill-pane', '-t', bound.worker.binding.paneId]);
  const state = await taskWorkerState(actual, record);
  assert.equal(state.proof, 'observed-pane-exited'); assert.equal(state.active, false);
});

async function nativeFixture(t, { members = 1, nested = false } = {}) {
  if ((await run('tmux', ['-V'], { allowFailure: true })).code !== 0) { t.skip('tmux unavailable'); return null; }
  const fixtureValue = await fixture(t), { opts, doc } = fixtureValue;
  await admitTask(opts);
  // Keep the sockets outside the Git fixture so teardown can always reach and stop only
  // these test-owned servers, even if the repository's earlier cleanup hook has run.
  const socket = isolatedTmux(t).socket, decoySocket = isolatedTmux(t).socket;
  const tmux = (args, server = socket) => run('tmux', ['-S', server, ...args]);
  async function createNative(id, session, count, parent = null) {
    await tmux(['new-session', '-d', '-s', session, '-c', doc.worktree, 'sleep', '120']);
    for (let n = 1; n < count; n++) await tmux(['split-window', '-d', '-h', '-t', session, '-c', doc.worktree, 'sleep', '120']);
    const observed = await listServerPanes({ tmuxServer: socket, session });
    const location = await topologyRunLocation({ consumer: opts.consumer, nativeRunId: id, stateHome: opts.env.AGENT_ORCHESTRATION_STATE_HOME });
    const agents = observed.map((binding, index) => ({ id: `writer-${index + 1}`, role: 'worker', pane: binding.paneId, binding, cwd: doc.worktree }));
    const native = { version: 1, run_id: id, name: `tm-${doc.id}`, task_id: doc.id, consumer: doc.worktree, workload_cwd: doc.worktree,
      repository: location.repository, run_dir: location.runDir, state: 'running', session, session_creation_attempted: true,
      write_authority: { task_id: doc.id, worktree: doc.worktree, branch: doc.branch, owner: 'author' },
      launch_spec: { agents: agents.map(agent => ({ id: agent.id })) }, agents, parent };
    await writeJson(join(location.runDir, 'run.json'), native);
    return { native, runDir: location.runDir };
  }
  const root = await createNative('native-parent', 'owned-native', members);
  const child = nested ? await createNative('native-child', 'owned-child', 1, { run_id: root.native.run_id, run_dir: root.runDir, agent_id: root.native.agents[0].id }) : null;
  if (child) await writeJson(join(root.runDir, 'children.json'), [{ run_id: child.native.run_id, run_dir: child.runDir, agent_id: root.native.agents[0].id }]);
  doc.dispatched = { backend: 'topology', run: `topology:${root.native.session}`, session: 'author', nativeRunId: root.native.run_id,
    workflowRunId: `topology:${root.native.run_id}`, recordPath: join(root.runDir, 'run.json') };
  const row = { name: 'fixture-native-worker', backend: 'topology', runId: doc.dispatched.run, session: 'author', registeredAt: 'fixture', status: 'active', pid: null };
  opts.store.workers = async () => [row];
  const actual = { ...opts, workerState: undefined, env: { ...opts.env, TMUX: `${decoySocket},1,0` } };
  return { ...fixtureValue, actual, root, child, row, socket, decoySocket, tmux };
}

test('native worker proof uses the durable producer binding and every member instead of an implicit same-named session', async t => {
  const f = await nativeFixture(t, { members: 2 }); if (!f) return;
  await f.tmux(['new-session', '-d', '-s', f.root.native.session, '-c', f.doc.worktree, 'sleep', '120'], f.decoySocket);
  const bound = await bindTaskWorker(f.actual);
  assert.equal(bound.worker.kind, 'topology');
  assert.equal(bound.worker.native_run_id, f.root.native.run_id);
  assert.equal(bound.worker.native_identity.members.length, 2);
  assert.ok(bound.worker.native_identity.members.every(member => member.binding.serverKey === f.socket));
  await f.finish();
  const record = (await managementStatus(f.actual)).management;
  await f.tmux(['kill-session', '-t', f.root.native.session], f.decoySocket);
  f.row.status = 'retired';
  assert.equal((await taskWorkerState(f.actual, record)).active, true, 'another server and a retired registry label cannot prove native workers exited');
  assert.equal((await integrationEligibility(f.actual)).eligible, false);
  await f.tmux(['kill-session', '-t', f.root.native.session]);
  const ended = await taskWorkerState(f.actual, record);
  assert.equal(ended.owned, true); assert.equal(ended.active, false); assert.equal(ended.proof, 'observed-native-workflow-exited');
});

test('native parent completion waits for every child and holds pending, unknown or missing runtime evidence', async t => {
  const f = await nativeFixture(t, { nested: true }); if (!f) return;
  await bindTaskWorker(f.actual); await f.finish();
  const record = (await managementStatus(f.actual)).management;
  assert.equal(record.worker.native_identity.children[0].run_id, f.child.native.run_id);
  await f.tmux(['kill-session', '-t', f.root.native.session]);
  const childStillLive = await taskWorkerState(f.actual, record);
  assert.equal(childStillLive.owned, true); assert.equal(childStillLive.active, true);
  await f.tmux(['kill-session', '-t', f.child.native.session]);
  assert.equal((await taskWorkerState(f.actual, record)).active, false);
  for (const state of ['starting', 'unknown-future-state']) {
    await writeJson(join(f.root.runDir, 'run.json'), { ...f.root.native, state });
    const held = await taskWorkerState(f.actual, record);
    assert.equal(held.owned, false); assert.equal(held.active, true); assert.equal(held.alive, null);
  }
  await writeJson(join(f.root.runDir, 'run.json'), f.root.native);
  await writeJson(join(f.child.runDir, 'run.json'), { ...f.child.native, parent: { ...f.child.native.parent, agent_id: 'another-member' } });
  assert.equal((await taskWorkerState(f.actual, record)).owned, false);
  await rm(join(f.child.runDir, 'run.json'));
  assert.equal((await taskWorkerState(f.actual, record)).active, true, 'missing child evidence never proves absence');
});

test('a native fallback requires a new verified finish and incomplete or foreign task handles remain held', async t => {
  const f = await nativeFixture(t); if (!f) return;
  await bindTaskWorker(f.actual); await f.finish();
  let record = (await managementStatus(f.actual)).management;
  const member = f.root.native.agents[0], oldPid = member.binding.panePid;
  await f.tmux(['respawn-pane', '-k', '-t', member.pane, '-c', f.doc.worktree, 'sleep', '120']);
  member.binding = (await listServerPanes({ tmuxServer: f.socket, session: f.root.native.session }))[0];
  assert.notEqual(member.binding.panePid, oldPid);
  await writeJson(join(f.root.runDir, 'run.json'), f.root.native);
  const changed = await taskWorkerState(f.actual, record);
  assert.equal(changed.owned, false); assert.match(changed.reason, /changed after the finish report/);
  await workerReport({ ...f.actual, kind: 'finish', report: record.finish });
  record = (await managementStatus(f.actual)).management;
  assert.equal(record.worker.native_identity.members[0].binding.panePid, member.binding.panePid);
  await f.tmux(['kill-session', '-t', f.root.native.session]);
  assert.equal((await taskWorkerState(f.actual, record)).active, false);
  await writeJson(join(f.root.runDir, 'run.json'), { ...f.root.native, task_id: 'TM-999' });
  assert.equal((await taskWorkerState(f.actual, record)).owned, false);
  await writeJson(join(f.root.runDir, 'run.json'), { ...f.root.native, workload_cwd: f.opts.consumer });
  assert.equal((await taskWorkerState(f.actual, record)).owned, false);
  await writeJson(join(f.root.runDir, 'run.json'), f.root.native);
  delete f.doc.dispatched.nativeRunId;
  const legacy = await taskWorkerState(f.actual, record);
  assert.equal(legacy.owned, false); assert.match(legacy.reason, /authentic native run ID/);
});

// TM-224: the tools' own store paths may be dirty in the integration checkout; nothing else may.
test('integration tolerates dirty tool store paths but refuses any other dirty path', async t => {
  const { opts, finish, git } = await fixture(t);
  await admitTask(opts); const report = await finish();
  await mkdir(join(opts.consumer, 'src'), { recursive: true });
  await writeFile(join(opts.consumer, 'src/stray.txt'), 'uncommitted source');
  await assert.rejects(integrateTask(opts), err => err.code === 'TOPOLOGY_MANAGEMENT_DIRTY' && /src\/stray\.txt/.test(err.message));
  await rm(join(opts.consumer, 'src'), { recursive: true });
  for (const dir of ['.bytedesk/task-management', '.bytedesk/agent-orchestration/agents/lead', '.bytedesk/knowledge/.km']) {
    await mkdir(join(opts.consumer, dir), { recursive: true }); await writeFile(join(opts.consumer, dir, 'state.json'), '{}');
  }
  const integrated = await integrateTask(opts);
  assert.equal(integrated.merge.landed, report.finish.revision);
  assert.equal((await git(opts.consumer, ['rev-parse', 'HEAD'])).stdout.trim(), report.finish.revision);
});

test('integration refuses a landing that would change tool store paths', async t => {
  const { opts, doc, git } = await fixture(t);
  doc.touches = ['code.txt', '.bytedesk/task-management/'];
  await admitTask(opts);
  const worktree = (await opts.store.show()).worktree;
  await writeFile(join(worktree, 'code.txt'), 'implemented');
  await mkdir(join(worktree, '.bytedesk/task-management'), { recursive: true }); await writeFile(join(worktree, '.bytedesk/task-management/x.md'), 'x');
  await git(worktree, ['add', '-A']); await git(worktree, ['-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', 'commit', '-m', 'impl']);
  const revision = (await git(worktree, ['rev-parse', 'HEAD'])).stdout.trim();
  await workerReport({ ...opts, kind: 'finish', report: { artifacts: ['code.txt'], checks: ['content'], risks: [], evidence: 'fixture', revision } });
  await assert.rejects(integrateTask(opts), { code: 'TOPOLOGY_MANAGEMENT_STORE_PATHS' });
});

// TM-224: a landing an operator already made is recorded, never performed, and only for the reviewed revision.
const fullReview = (record, revision) => async () => ({ eligible: true, reasons: [], status: { review: { task: record.task, repo_id: record.repo_id, revision, verified_commit: revision,
  verdict: 'approve', findings: [], reviewer_id: 'fixture-reviewer', author_agent_ids: ['author'], request_nonce: 'fixture-review-nonce',
  binding: { serverKey: '/fixture/socket', serverPid: 1, sessionId: '$1', sessionCreated: 1, paneId: '%1', panePid: 2 } } } });

test('record-landing records an operator landing that governed completion accepts, without merging', async t => {
  const { opts, finish, git, calls } = await fixture(t);
  const admitted = await admitTask(opts); const report = await finish(); const revision = report.finish.revision;
  const landing = { ...opts, actor: 'operator', reason: 'landed by hand before integrate was usable', reviewGate: fullReview(admitted.record, revision) };
  const before = (await git(opts.consumer, ['rev-parse', 'HEAD'])).stdout.trim();
  await assert.rejects(recordLanding({ ...landing, landed: revision }), { code: 'TOPOLOGY_MANAGEMENT_TARGET' }, 'not yet on main');
  assert.equal((await git(opts.consumer, ['rev-parse', 'HEAD'])).stdout.trim(), before, 'record-landing never merges');
  await git(opts.consumer, ['merge', '--ff-only', revision]); // the operator's own landing
  const recorded = await recordLanding({ ...landing, landed: 'main' });
  assert.equal(recorded.state, 'merged'); assert.equal(recorded.collected, true);
  assert.deepEqual({ ...recorded.merge, authorization: undefined }, { revision, landed: revision, checks: [], checks_skipped: true, target_branch: 'main', authorization: undefined });
  assert.equal(recorded.merge.authorization.decision, 'integrate'); assert.equal(recorded.merge.authorization.authorized, true);
  assert.equal(recorded.merge.authorization.actor, 'operator'); assert.equal(recorded.merge.authorization.revision, revision);
  assert.ok(calls.includes('recorded-landing') && calls.includes('collect'));
  await assert.rejects(recordLanding({ ...landing, landed: 'main' }), /already has a recorded landing/);

  const { governedCompletion } = await import('../../../task-management/lib/governance-check.mjs');
  const saved = process.env.AGENT_ORCHESTRATION_STATE_HOME; process.env.AGENT_ORCHESTRATION_STATE_HOME = opts.env.AGENT_ORCHESTRATION_STATE_HOME;
  t.after(() => { if (saved === undefined) delete process.env.AGENT_ORCHESTRATION_STATE_HOME; else process.env.AGENT_ORCHESTRATION_STATE_HOME = saved; });
  const task = { id: 'TM-1', worktree: recorded.worktree, branch: recorded.branch,
    governance: { version: 1, runtime: 'topology', workflowRunId: recorded.workflow_run_id, leadId: recorded.lead_id, revision, state: 'ready-for-review' } };
  const gate = governedCompletion(task, { root: opts.consumer });
  assert.equal(gate.allow, true, gate.reason); assert.equal(gate.actor, 'operator');
});

test('record-landing refuses without review, ancestry, target branch, actor or reason', async t => {
  const { opts, finish, git } = await fixture(t);
  const admitted = await admitTask(opts);
  const base = (await git(opts.consumer, ['rev-parse', 'HEAD'])).stdout.trim();
  const report = await finish(); const revision = report.finish.revision;
  const landing = { ...opts, actor: 'operator', reason: 'hand landing', reviewGate: fullReview(admitted.record, revision) };
  await git(opts.consumer, ['branch', 'side', revision]);
  await assert.rejects(recordLanding({ ...landing, landed: 'side' }), { code: 'TOPOLOGY_MANAGEMENT_TARGET' }, 'not on the target branch');
  await assert.rejects(recordLanding({ ...landing, landed: base }), { code: 'TOPOLOGY_MANAGEMENT_LANDING' }, 'finish revision not an ancestor');
  await git(opts.consumer, ['merge', '--ff-only', revision]);
  await assert.rejects(recordLanding({ ...landing, landed: revision, reviewGate: async () => ({ eligible: false, reasons: ['no review of TM-1 exists'] }) }), err => err.code === 'TOPOLOGY_MANAGEMENT_REVIEW' && /no review/.test(err.message));
  await assert.rejects(recordLanding({ ...landing, landed: revision, reviewGate: async () => ({ eligible: true, reasons: [], status: {} }) }), { code: 'TOPOLOGY_MANAGEMENT_REVIEW' });
  for (const bad of [{ actor: '' }, { actor: '  ' }, { reason: '' }, { reason: undefined }])
    await assert.rejects(recordLanding({ ...landing, landed: revision, ...bad }), { code: 'TOPOLOGY_MANAGEMENT_LANDING_AUTHORITY' });
  // Authority: without policy auto_merge, only an explicit --authorized records the landing.
  await writeJson(join(opts.pluginRoot, 'config.defaults.json'), { management: { auto_merge: false, target_branch: 'main', required_checks: [{ name: 'noop', argv: ['true'] }] } });
  await assert.rejects(recordLanding({ ...landing, landed: revision }), err => err.code === 'TOPOLOGY_MANAGEMENT_LANDING_AUTHORITY' && /authority/.test(err.message));
  assert.equal((await managementStatus(opts)).management.merge, undefined, 'nothing was recorded by a refusal');
  const explicit = await recordLanding({ ...landing, landed: revision, authorized: true });
  assert.equal(explicit.merge.authorization.authorized, true); assert.equal(explicit.merge.authorization.explicit, true);
  assert.equal(explicit.merge.authorization.policy_auto_merge, false);
});

// TM-234 review: a delegation counts only for a caller whose LIVE pane the census binds to the
// grantee. These inject the pane listing and census; no real tmux is touched.
const LEAD_PANE = { serverKey: '/tmp/ao-fake/default', serverPid: 4242, sessionId: '$1', sessionCreated: 1700000000, paneId: '%7', panePid: 5151 };
// Injected /proc (pid -> [comm, ppid]): the lead's node -> claude -> pane shell 5151; a worker's never reaches 5151.
const procTree = tree => ({ pid: Math.max(...Object.keys(tree).map(Number)), readStat: async p => {
  if (!tree[p]) throw Object.assign(new Error(`no /proc/${p}`), { code: 'ENOENT' });
  return `${p} (${tree[p][0]}) S ${tree[p][1]} 1 1 0 -1`;
} });
const LEAD_PROC = procTree({ 903: ['node', 902], 902: ['claude', 5151], 5151: ['zsh', 4242], 4242: ['tmux: server', 1] });
const WORKER_PROC = procTree({ 703: ['node', 702], 702: ['claude', 6161], 6161: ['zsh', 4242], 4242: ['tmux: server', 1] });
const paneOf = (agentId, boundTo = agentId) => ({
  listPanesFn: async () => [{ ...LEAD_PANE, alive: true }],
  readCensusFn: async () => ({ agents: [{ agentId: boundTo, binding: { ...LEAD_PANE } }] }),
  callerProc: LEAD_PROC,
  paneEnv: { AO_AGENT_ID: agentId, TMUX: `${LEAD_PANE.serverKey},${LEAD_PANE.serverPid},0`, TMUX_PANE: LEAD_PANE.paneId },
});
// A lead or worker is a managed session: AO_AGENT_ID in env and a Claude Code process above it.
const AGENT_ANCESTRY = async () => ['node', 'claude', 'zsh', 'tmux: server'];
const asCaller = (opts, agentId, boundTo) => { const { paneEnv, ...lookups } = paneOf(agentId, boundTo); return { ...opts, ...lookups, ancestors: AGENT_ANCESTRY, env: { ...opts.env, ...paneEnv } }; };
async function registerAgent(consumer, id) {
  await writeJson(join(consumer, '.bytedesk', 'agent-orchestration', 'agents', id, 'agent.json'), { id, full_name: id, role: 'lead' });
}
const operatorGrant = (opts, scopes) => grantDelegation({ consumer: opts.consumer, home: opts.home, env: { USER: 'operator', AGENT_ORCHESTRATION_STATE_HOME: opts.env.AGENT_ORCHESTRATION_STATE_HOME }, to: 'lead-1', scopes });

// TM-234: a standing delegation the operator granted stands in for --authorized, so the lead
// exercising it never attests to authority it grants itself.
test('record-landing accepts a standing delegation instead of --authorized, and records who granted it', async t => {
  const { opts, finish, git } = await fixture(t);
  await writeJson(join(opts.pluginRoot, 'config.defaults.json'), { management: { auto_merge: false, target_branch: 'main', required_checks: [{ name: 'noop', argv: ['true'] }] } });
  const admitted = await admitTask(opts); const report = await finish(); const revision = report.finish.revision;
  await git(opts.consumer, ['merge', '--ff-only', revision]);
  await registerAgent(opts.consumer, 'lead-1');
  const leadOpts = { ...asCaller(opts, 'lead-1'), reason: 'exercising a standing delegation', reviewGate: fullReview(admitted.record, revision), landed: 'main' };
  await assert.rejects(recordLanding(leadOpts), { code: 'TOPOLOGY_MANAGEMENT_LANDING_AUTHORITY', message: /repository lead lead-1 needs the server to confirm/ }, 'no grant yet');
  await grantDelegation({ consumer: opts.consumer, home: opts.home, env: { USER: 'operator', AGENT_ORCHESTRATION_STATE_HOME: opts.env.AGENT_ORCHESTRATION_STATE_HOME }, to: 'lead-1', scopes: ['record-landing'] });
  // TM-248: inside the lead's managed session any --actor is self-assertion and refused; the grant names the actor.
  for (const actor of ['operator', 'lead-1']) await assert.rejects(recordLanding({ ...leadOpts, actor }), { code: 'TOPOLOGY_MANAGEMENT_SELF_ASSERT' });
  const recorded = await recordLanding(leadOpts);
  assert.equal(recorded.merge.authorization.actor, 'lead-1', 'the recorded actor is the lead that exercised the grant');
  assert.equal(recorded.merge.authorization.authorized, true);
  assert.equal(recorded.merge.authorization.explicit, false);
  assert.equal(recorded.merge.authorization.delegated_by, 'operator');
  assert.ok(recorded.merge.authorization.delegation_id);
  // A grant scoped to a different verb never substitutes for this one.
  const { opts: opts2, finish: finish2, git: git2 } = await fixture(t);
  await writeJson(join(opts2.pluginRoot, 'config.defaults.json'), { management: { auto_merge: false, target_branch: 'main', required_checks: [{ name: 'noop', argv: ['true'] }] } });
  const admitted2 = await admitTask(opts2); const report2 = await finish2(); const revision2 = report2.finish.revision;
  await git2(opts2.consumer, ['merge', '--ff-only', revision2]);
  await registerAgent(opts2.consumer, 'lead-1');
  await grantDelegation({ consumer: opts2.consumer, home: opts2.home, env: { USER: 'operator', AGENT_ORCHESTRATION_STATE_HOME: opts2.env.AGENT_ORCHESTRATION_STATE_HOME }, to: 'lead-1', scopes: ['integrate'] });
  await assert.rejects(recordLanding({ ...asCaller(opts2, 'lead-1'), reason: 'wrong scope', reviewGate: fullReview(admitted2.record, revision2), landed: 'main' }), { code: 'TOPOLOGY_MANAGEMENT_LANDING_AUTHORITY', message: /repository lead lead-1 needs the server to confirm/ });
});

test('integrate accepts a standing delegation instead of --authorized, and records who granted it', async t => {
  const { opts, finish } = await fixture(t);
  await writeJson(join(opts.pluginRoot, 'config.defaults.json'), { management: { auto_merge: false, target_branch: 'main', required_checks: [{ name: 'content', argv: [process.execPath, '-e', "if(require('fs').readFileSync('code.txt','utf8')!=='implemented') process.exit(1)"] }] } });
  await admitTask(opts); await finish();
  await registerAgent(opts.consumer, 'lead-1');
  const leadOpts = asCaller(opts, 'lead-1');
  await assert.rejects(integrateTask(leadOpts), { code: 'TOPOLOGY_MANAGEMENT_INTEGRATION_BLOCKED' }, 'no grant yet');
  await grantDelegation({ consumer: opts.consumer, home: opts.home, env: { USER: 'operator', AGENT_ORCHESTRATION_STATE_HOME: opts.env.AGENT_ORCHESTRATION_STATE_HOME }, to: 'lead-1', scopes: ['integrate'] });
  await assert.rejects(integrateTask({ ...leadOpts, actor: 'operator' }), { code: 'TOPOLOGY_MANAGEMENT_SELF_ASSERT' });
  const integrated = await integrateTask(leadOpts);
  assert.equal(integrated.merge.authorization.actor, 'lead-1', 'the recorded actor is the lead that exercised the grant, not the OS user');
  assert.equal(integrated.merge.authorization.authorized, true);
  assert.equal(integrated.merge.authorization.channel, 'standing-delegation');
  assert.equal(integrated.merge.authorization.delegated_by, 'operator');
  assert.ok(integrated.merge.authorization.delegation_id);
});

test('a worker naming the lead in AO_AGENT_ID cannot use the lead\'s grant on integrate or record-landing', async t => {
  const { opts, finish, git } = await fixture(t);
  await writeJson(join(opts.pluginRoot, 'config.defaults.json'), { management: { auto_merge: false, target_branch: 'main', required_checks: [{ name: 'noop', argv: ['true'] }] } });
  const admitted = await admitTask(opts); const report = await finish(); const revision = report.finish.revision;
  await registerAgent(opts.consumer, 'lead-1');
  await operatorGrant(opts, ['integrate', 'record-landing']);
  const before = (await git(opts.consumer, ['rev-parse', 'HEAD'])).stdout.trim();
  // Spoofed from outside any pane, and spoofed from the worker's own live pane.
  for (const spoof of [{ ...opts, env: { ...opts.env, AO_AGENT_ID: 'lead-1' } }, asCaller(opts, 'lead-1', 'worker-7')]) {
    await assert.rejects(integrateTask(spoof), { code: 'TOPOLOGY_DELEGATION_ACTOR' });
    const gate = await integrationEligibility(spoof);
    assert.equal(gate.eligible, false); assert.ok(gate.reasons.some(r => r.startsWith('TOPOLOGY_DELEGATION_ACTOR')), gate.reasons.join('; '));
  }
  const attack = { ...asCaller(opts, 'lead-1'), callerProc: WORKER_PROC };
  await assert.rejects(integrateTask(attack), { code: 'TOPOLOGY_DELEGATION_ACTOR', message: /not an ancestor/ });
  const attackGate = await integrationEligibility(attack);
  assert.equal(attackGate.eligible, false); assert.ok(attackGate.reasons.some(r => r.startsWith('TOPOLOGY_DELEGATION_ACTOR') && /not an ancestor/.test(r)), attackGate.reasons.join('; '));
  assert.equal((await git(opts.consumer, ['rev-parse', 'HEAD'])).stdout.trim(), before, 'a refused integrate merges nothing');
  await git(opts.consumer, ['merge', '--ff-only', revision]);
  const landing = { reason: 'spoof attempt', reviewGate: fullReview(admitted.record, revision), landed: 'main' };
  await assert.rejects(recordLanding({ ...opts, env: { ...opts.env, AO_AGENT_ID: 'lead-1' }, ...landing }), { code: 'TOPOLOGY_DELEGATION_ACTOR' });
  await assert.rejects(recordLanding({ ...asCaller(opts, 'lead-1', 'worker-7'), ...landing }), { code: 'TOPOLOGY_DELEGATION_ACTOR' });
  assert.equal((await managementStatus(opts)).management.merge, undefined, 'nothing was recorded by a refusal');
  // THE ATTACK, now on record-landing: the lead's pane in env, but ancestry never reaches its process.
  await assert.rejects(recordLanding({ ...attack, ...landing }), { code: 'TOPOLOGY_DELEGATION_ACTOR', message: /not an ancestor/ });
  assert.equal((await managementStatus(opts)).management.merge, undefined, 'nothing was recorded by a refusal');
  // The genuinely bound lead is accepted.
  const recorded = await recordLanding({ ...asCaller(opts, 'lead-1'), ...landing, reason: 'lead in its own pane' });
  assert.equal(recorded.merge.authorization.actor, 'lead-1');
});

// TM-243: an installed allow rule removes the prompt, never the authority check. With the rules in
// the lead's settings file: lead-with-grant allowed, lead-without-grant, expired grant and a worker
// (its own live pane, or naming the lead) all refused, on both record-landing and integrate.
test('with permission rules installed, integrate and record-landing still need a live delegation proven for the caller', async t => {
  const { installPermissions } = await import('../../topology/lib/permissions.mjs');
  const { findActiveDelegation } = await import('../../topology/lib/delegation.mjs');
  const { opts, finish, git } = await fixture(t);
  await writeJson(join(opts.pluginRoot, 'config.defaults.json'), { management: { auto_merge: false, target_branch: 'main', required_checks: [{ name: 'noop', argv: ['true'] }] } });
  const admitted = await admitTask(opts); const report = await finish(); const revision = report.finish.revision;
  await registerAgent(opts.consumer, 'lead-1');
  const leadDir = join(opts.consumer, '.bytedesk', 'agent-orchestration', 'agents', 'lead-1');
  await writeJson(join(leadDir, 'session.json'), { agent_id: 'lead-1', cwd: leadDir });
  const installed = await installPermissions({ consumer: opts.consumer, home: opts.home, env: { USER: 'operator', AGENT_ORCHESTRATION_STATE_HOME: opts.env.AGENT_ORCHESTRATION_STATE_HOME }, ancestors: async () => ['zsh'] });
  assert.ok(installed.added.includes('Bash(ao-topology manage record-landing *)') && installed.added.includes('Bash(ao-topology manage integrate *)'));
  const before = (await git(opts.consumer, ['rev-parse', 'HEAD'])).stdout.trim();
  const lead = asCaller(opts, 'lead-1'), worker = asCaller(opts, 'lead-1', 'worker-7'), workerProc = { ...lead, callerProc: WORKER_PROC };
  const landing = { reason: 'rules installed', reviewGate: fullReview(admitted.record, revision), landed: 'main' };
  const expired = { findDelegation: o => findActiveDelegation({ ...o, now: Date.now() + 2 * 3600_000 }) };
  // Lead without a grant.
  await assert.rejects(integrateTask(lead), { code: 'TOPOLOGY_MANAGEMENT_INTEGRATION_BLOCKED' });
  // Expired grant.
  await operatorGrant(opts, ['integrate', 'record-landing']); // then revoked: a revoked grant is not live either
  const { listStandingDelegations, revokeDelegation } = await import('../../topology/lib/delegation.mjs');
  await revokeDelegation({ consumer: opts.consumer, home: opts.home, env: { USER: 'operator', AGENT_ORCHESTRATION_STATE_HOME: opts.env.AGENT_ORCHESTRATION_STATE_HOME }, io: { ancestors: async () => ['zsh'] }, id: (await listStandingDelegations({ consumer: opts.consumer, home: opts.home, env: opts.env }))[0].id });
  await grantDelegation({ consumer: opts.consumer, home: opts.home, env: { USER: 'operator', AGENT_ORCHESTRATION_STATE_HOME: opts.env.AGENT_ORCHESTRATION_STATE_HOME }, to: 'lead-1', scopes: ['integrate', 'record-landing'], expires: '1h' });
  await assert.rejects(integrateTask({ ...lead, ...expired }), { code: 'TOPOLOGY_MANAGEMENT_INTEGRATION_BLOCKED' }, 'expired grant');
  // Worker: its own pane naming the lead, or the lead's pane named without running in it.
  for (const w of [worker, workerProc, { ...opts, env: { ...opts.env, AO_AGENT_ID: 'lead-1', TM_DISPATCH_WORKER: '1' } }])
    await assert.rejects(integrateTask(w), { code: 'TOPOLOGY_DELEGATION_ACTOR' });
  assert.equal((await git(opts.consumer, ['rev-parse', 'HEAD'])).stdout.trim(), before, 'nothing merged by a refusal');
  await git(opts.consumer, ['merge', '--ff-only', revision]);
  await revokeDelegation({ consumer: opts.consumer, home: opts.home, env: { USER: 'operator', AGENT_ORCHESTRATION_STATE_HOME: opts.env.AGENT_ORCHESTRATION_STATE_HOME }, io: { ancestors: async () => ['zsh'] }, id: (await listStandingDelegations({ consumer: opts.consumer, home: opts.home, env: opts.env })).find(g => !g.revoked_at).id });
  await assert.rejects(recordLanding({ ...lead, ...landing }), { code: 'TOPOLOGY_MANAGEMENT_LANDING_AUTHORITY', message: /repository lead lead-1 needs the server to confirm/ }, 'lead without a live grant');
  await grantDelegation({ consumer: opts.consumer, home: opts.home, env: { USER: 'operator', AGENT_ORCHESTRATION_STATE_HOME: opts.env.AGENT_ORCHESTRATION_STATE_HOME }, to: 'lead-1', scopes: ['record-landing'], expires: '1h' });
  await assert.rejects(recordLanding({ ...lead, ...landing, ...expired }), { code: 'TOPOLOGY_MANAGEMENT_LANDING_AUTHORITY', message: /repository lead lead-1 needs the server to confirm/ }, 'expired grant');
  for (const w of [worker, workerProc, { ...opts, env: { ...opts.env, AO_AGENT_ID: 'lead-1', TM_DISPATCH_WORKER: '1' } }])
    await assert.rejects(recordLanding({ ...w, ...landing }), { code: 'TOPOLOGY_DELEGATION_ACTOR' });
  assert.equal((await managementStatus(opts)).management.merge, undefined, 'nothing recorded by a refusal');
  // Lead with a live grant, running in its own pane.
  const recorded = await recordLanding({ ...lead, ...landing });
  assert.equal(recorded.merge.authorization.actor, 'lead-1'); assert.ok(recorded.merge.authorization.delegation_id);
});

test('a corrupt delegations file makes eligibility false with a named reason instead of throwing', async t => {
  const { opts, finish } = await fixture(t);
  await writeJson(join(opts.pluginRoot, 'config.defaults.json'), { management: { auto_merge: false, target_branch: 'main', required_checks: [{ name: 'noop', argv: ['true'] }] } });
  await admitTask(opts); await finish();

  await writeJson(join(opts.env.AGENT_ORCHESTRATION_STATE_HOME, 'delegations', `${repoKey((await canonicalRepoId(opts.consumer)).id)}.json`), [{ id: 'hand-written', type: 'grant', grantee: 'lead-1', scopes: ['integrate'] }]);
  const gate = await integrationEligibility(asCaller(opts, 'lead-1'));
  assert.equal(gate.eligible, false);
  assert.ok(gate.reasons.some(r => r.startsWith('TOPOLOGY_DELEGATION_INTEGRITY') && /hand-written/.test(r)), gate.reasons.join('; '));
  assert.ok(await managementStatus(asCaller(opts, 'lead-1')), 'status still answers');
});

test('governed completion accepts a delegated integration record unchanged', async t => {
  const { opts, finish } = await fixture(t);
  await writeJson(join(opts.pluginRoot, 'config.defaults.json'), { management: { auto_merge: false, target_branch: 'main', required_checks: [{ name: 'noop', argv: ['true'] }] } });
  const admitted = await admitTask(opts); const report = await finish(); const revision = report.finish.revision;
  await registerAgent(opts.consumer, 'lead-1');
  await operatorGrant(opts, ['integrate']);
  const integrated = await integrateTask({ ...asCaller(opts, 'lead-1'), reviewGate: fullReview(admitted.record, revision) });
  assert.equal(integrated.merge.authorization.channel, 'standing-delegation');
  const { governedCompletion } = await import('../../../task-management/lib/governance-check.mjs');
  const saved = process.env.AGENT_ORCHESTRATION_STATE_HOME; process.env.AGENT_ORCHESTRATION_STATE_HOME = opts.env.AGENT_ORCHESTRATION_STATE_HOME;
  t.after(() => { if (saved === undefined) delete process.env.AGENT_ORCHESTRATION_STATE_HOME; else process.env.AGENT_ORCHESTRATION_STATE_HOME = saved; });
  const task = { id: 'TM-1', worktree: integrated.worktree, branch: integrated.branch,
    governance: { version: 1, runtime: 'topology', workflowRunId: integrated.workflow_run_id, leadId: integrated.lead_id, revision, state: 'ready-for-review' } };
  const gate = governedCompletion(task, { root: opts.consumer });
  assert.equal(gate.allow, true, gate.reason); assert.equal(gate.actor, 'lead-1');
});

test('integration refuses a task that cannot fast-forward the target branch', async t => {
  const { opts, finish, git } = await fixture(t);
  await admitTask(opts); await finish();
  await writeFile(join(opts.consumer, 'other.txt'), 'moved on');
  await git(opts.consumer, ['add', 'other.txt']); await git(opts.consumer, ['-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', 'commit', '-m', 'main moved']);
  const before = (await git(opts.consumer, ['rev-parse', 'HEAD'])).stdout.trim();
  await assert.rejects(integrateTask(opts), err => err.code === 'TOPOLOGY_MANAGEMENT_TARGET' && /Cannot fast-forward/.test(err.message));
  assert.equal((await git(opts.consumer, ['rev-parse', 'HEAD'])).stdout.trim(), before);
});

// TM-224 review: this repository's committed policy must satisfy the integration policy gate.
test("this repository's committed management policy raises no policy reasons", async t => {
  const { fileURLToPath } = await import('node:url');
  const { readFile } = await import('node:fs/promises');
  const { loadConfig } = await import('../../topology/lib/config.mjs');
  const repoRoot = fileURLToPath(new URL('../../../', import.meta.url));
  const pluginRoot = fileURLToPath(new URL('../../', import.meta.url));
  const { opts, finish } = await fixture(t);
  const loaded = await loadConfig({ consumer: repoRoot, pluginRoot, home: opts.home, env: opts.env });
  assert.deepEqual(loaded.errors, []);
  assert.equal(loaded.config.management.target_branch, 'main');
  assert.ok(loaded.config.management.required_checks.length >= 6);
  await mkdir(join(opts.consumer, '.bytedesk/agent-orchestration'), { recursive: true });
  await writeFile(join(opts.consumer, '.bytedesk/agent-orchestration/config.json'), await readFile(join(repoRoot, '.bytedesk/agent-orchestration/config.json')));
  const policyOpts = { ...opts, pluginRoot };
  await admitTask(policyOpts); await finish();
  const gate = await integrationEligibility(policyOpts);
  assert.deepEqual(gate.reasons.filter(r => /configure management|integration authority|configuration is invalid/.test(r)), []);
  assert.deepEqual(gate.policy, loaded.config.management);
});

// ── TM-218: lead-owned worker start, adoption and stop ──────────────────────────
async function paneServer(t, opts) {
  if ((await run('tmux', ['-V'], { allowFailure: true })).code !== 0) { t.skip('tmux unavailable'); return null; }
  await mkdir(opts.home, { recursive: true });
  const { socket, tmux } = isolatedTmux(t);
  await tmux(['new-session', '-d', '-s', 'keepalive', 'sleep', '120']);
  const serverPid = (await tmux(['display-message', '-p', '#{pid}'])).stdout.trim();
  const env = { ...opts.env, TMUX: `${socket},${serverPid},0`, TMUX_PANE: '' };
  const paneOf = async session => (await listServerPanes({ tmuxServer: socket, session })).find(p => p.alive)?.paneId;
  return { socket, tmux, env, paneOf };
}
const DISPATCH_REASON = 'Task dispatch must name the claim owner and worker run.';

test('start-worker dispatches through tm, records the pane binding and clears the dispatch-owner reason', async t => {
  const { opts, doc, finish } = await fixture(t);
  const s = await paneServer(t, opts); if (!s) return;
  const { startTaskWorker } = await import('../../topology/lib/management.mjs');
  const actual = { ...opts, workerState: undefined, env: s.env };
  await assert.rejects(startTaskWorker(actual), { code: 'TOPOLOGY_MANAGEMENT_WORKER' }, 'an unadmitted task cannot start a worker');
  await admitTask(actual); await finish();
  assert.ok((await integrationEligibility(actual)).reasons.includes(DISPATCH_REASON));
  let dispatches = 0;
  opts.store.dispatch = async (task, backend) => {
    dispatches++; assert.equal(backend, 'tmux');
    await s.tmux(['new-session', '-d', '-s', `tm-${task}`, '-c', doc.worktree, 'sleep', '120']);
    doc.dispatched = { backend: 'tmux', run: `tmux:tm-${task}`, session: 'author' };
    opts.store.workers = async () => [{ name: 'agent:TM-1', backend: 'tmux', runId: doc.dispatched.run, session: 'author', registeredAt: 'now', status: 'active', pid: null }];
    return { ok: true, backend: 'tmux', run: doc.dispatched.run };
  };
  const started = await startTaskWorker(actual);
  assert.equal(started.bound, true, started.reason);
  assert.equal(started.worker.binding.serverKey, s.socket);
  for (const key of ['sessionId', 'paneId', 'panePid', 'sessionCreated', 'serverPid']) assert.ok(started.worker.binding[key], key);
  const status = (await managementStatus(actual)).management;
  assert.ok(status.events.some(e => e.event === 'worker-started' && e.workflow_run_id === status.workflow_run_id));
  const gate = await integrationEligibility(actual);
  assert.ok(!gate.reasons.includes(DISPATCH_REASON), gate.reasons.join('; '));
  assert.ok(gate.reasons.some(r => r.includes('still alive')), 'the live worker still blocks integration');
  await assert.rejects(startTaskWorker(actual), /second writer/); assert.equal(dispatches, 1);
});

test('stop-worker refuses unowned, uncollected and active workers and closes an owned idle pane', async t => {
  const { opts, doc, finish } = await fixture(t);
  const s = await paneServer(t, opts); if (!s) return;
  const { stopTaskWorker } = await import('../../topology/lib/management.mjs');
  const actual = { ...opts, workerState: undefined, env: s.env };
  await admitTask(actual);
  const none = await stopTaskWorker(actual);
  assert.equal(none.stopped, false); assert.match(none.reason, /never closed/); assert.match(none.recovery, /Leave the worker running/);
  await s.tmux(['new-session', '-d', '-s', 'busy', '-c', doc.worktree, 'sleep', '120']);
  await bindTaskWorker({ ...actual, pane: await s.paneOf('busy') });
  const uncollected = await stopTaskWorker(actual);
  assert.equal(uncollected.stopped, false); assert.match(uncollected.reason, /finish protocol/);
  await finish();
  const active = await stopTaskWorker(actual);
  assert.equal(active.stopped, false); assert.match(active.reason, /still alive/);
  assert.ok(await s.paneOf('busy'), 'an active worker is never closed');
  const peer = await stopTaskWorker({ ...actual, owner: 'peer' });
  assert.equal(peer.stopped, false); assert.ok(await s.paneOf('busy'), 'another session never closes it');

  // Owned idle: a fresh admitted task whose adopted pane is a shell with no running harness.
  const f2 = await fixture(t); const s2 = await paneServer(t, f2.opts); if (!s2) return;
  const a2 = { ...f2.opts, workerState: undefined, env: s2.env };
  await admitTask(a2);
  await s2.tmux(['new-session', '-d', '-s', 'idle', '-c', f2.doc.worktree, 'sh']);
  await bindTaskWorker({ ...a2, pane: await s2.paneOf('idle') });
  await f2.finish();
  const stopped = await stopTaskWorker(a2);
  assert.equal(stopped.stopped, true, stopped.reason); assert.equal(stopped.closed, true); assert.equal(stopped.proof, 'observed-pane-idle-shell');
  assert.equal(await s2.paneOf('idle'), undefined);
  assert.ok((await managementStatus(a2)).management.events.some(e => e.event === 'worker-stopped'));
});

test('bind adopts a live worker only after verifying it and fails closed on unknown or reused identities', async t => {
  const { opts, doc } = await fixture(t);
  const s = await paneServer(t, opts); if (!s) return;
  const actual = { ...opts, workerState: undefined, env: s.env };
  await admitTask(actual);
  const code = { code: 'TOPOLOGY_MANAGEMENT_WORKER' };
  await assert.rejects(bindTaskWorker({ ...actual, pane: '%9999' }), code, 'unknown pane');
  await assert.rejects(bindTaskWorker({ ...actual, env: { ...opts.env, TMUX: '' }, pane: '%0' }), /Name the tmux server/, 'implicit server');
  await s.tmux(['new-session', '-d', '-s', 'elsewhere', '-c', opts.home, 'sleep', '120']);
  await assert.rejects(bindTaskWorker({ ...actual, pane: await s.paneOf('elsewhere') }), /task-owned worktree/, 'pane outside the worktree');
  await s.tmux(['new-session', '-d', '-s', 'split', '-c', doc.worktree, 'sleep', '120']);
  await s.tmux(['split-window', '-d', '-t', 'split', '-c', doc.worktree, 'sleep', '120']);
  await assert.rejects(bindTaskWorker({ ...actual, pane: await s.paneOf('split') }), /only live pane/, 'shared session');
  await assert.rejects(bindTaskWorker({ ...actual, pid: process.pid }), code, 'the caller itself');
  await s.tmux(['new-session', '-d', '-s', 'worker', '-c', doc.worktree, 'sleep', '120']);
  const pane = await s.paneOf('worker');
  const bound = await bindTaskWorker({ ...actual, pane });
  assert.equal(bound.worker.adopted, true); assert.equal(bound.worker.binding.paneId, pane);
  assert.equal((await bindTaskWorker({ ...actual, pane })).bound, true, 'rebinding the same incarnation is idempotent');
  await s.tmux(['respawn-pane', '-k', '-t', pane, '-c', doc.worktree, 'sleep', '120']);
  await assert.rejects(bindTaskWorker({ ...actual, pane }), /incarnation changed/, 'a reused pane is a successor, not the worker');
  doc.dispatched = { backend: 'tmux', run: 'tmux:x', session: 'author' };
  await assert.rejects(bindTaskWorker({ ...actual, pane }), /has a tm dispatch/);
});

test('a stopped worker is history: start-worker starts the next round and the old binding is kept', async t => {
  const { opts, doc, finish } = await fixture(t);
  const s = await paneServer(t, opts); if (!s) return;
  const { startTaskWorker, stopTaskWorker } = await import('../../topology/lib/management.mjs');
  const actual = { ...opts, workerState: undefined, env: s.env };
  let round = 0;
  opts.store.dispatch = async task => {
    round++;
    await s.tmux(['new-session', '-d', '-s', `tm-${task}`, '-c', doc.worktree, 'sh']);
    doc.dispatched = { backend: 'tmux', run: `tmux:tm-${task}`, session: 'author' };
    opts.store.workers = async () => [{ name: 'agent:TM-1', backend: 'tmux', runId: doc.dispatched.run, session: 'author', registeredAt: `round-${round}`, status: 'active', pid: null }];
    return { ok: true, backend: 'tmux', run: doc.dispatched.run };
  };
  await admitTask(actual);
  const first = await startTaskWorker(actual); assert.equal(first.bound, true, first.reason);
  await finish();
  const stopped = await stopTaskWorker(actual); assert.equal(stopped.stopped, true, stopped.reason);
  const second = await startTaskWorker(actual); assert.equal(second.bound, true, second.reason);
  assert.notEqual(second.worker.binding.paneId, first.worker.binding.paneId);
  const record = (await managementStatus(actual)).management;
  assert.equal(record.previous_workers.length, 1); assert.equal(record.previous_workers[0].binding.paneId, first.worker.binding.paneId);
  assert.equal(record.worker.stopped_at, undefined);
  await assert.rejects(startTaskWorker(actual), /second writer/, 'a live next-round worker still blocks a third');
});

test('bind never adopts an operator shell: pre-admission sessions and login shells are refused', async t => {
  const { opts, doc } = await fixture(t);
  const s = await paneServer(t, opts); if (!s) return;
  const { stopTaskWorker } = await import('../../topology/lib/management.mjs');
  const actual = { ...opts, workerState: undefined, env: s.env };
  await s.tmux(['new-session', '-d', '-s', 'early', '-c', opts.consumer, 'sleep', '120']);
  await new Promise(resolve => setTimeout(resolve, 1100));
  await admitTask(actual);
  // Same pre-admission session, now pointed at the worktree:
  await s.tmux(['respawn-pane', '-k', '-t', await s.paneOf('early'), '-c', doc.worktree, 'sleep', '120']);
  await assert.rejects(bindTaskWorker({ ...actual, pane: await s.paneOf('early') }), /created after the task was admitted/);
  await s.tmux(['new-session', '-d', '-s', 'login', '-c', doc.worktree, 'sh', '-l']);
  await assert.rejects(bindTaskWorker({ ...actual, pane: await s.paneOf('login') }), /login shell/);
  const refused = await stopTaskWorker({ ...actual, owner: 'peer' });
  assert.equal(refused.stopped, false);
  assert.ok(!((await managementStatus(actual)).management.events.some(e => e.event === 'worker-stop-refused')), 'a non-owner leaves no event in the owner record');
});

// TM-257: the server's default branch, held as a JS value so no local ref can move it; no network.
function fakeServer(main) {
  const server = { main, calls: 0, compare: async (dir, from, to) => {
    server.calls++;
    const a = from ?? server.main, b = to ?? server.main;
    const mb = (await run('git', ['-C', dir, 'merge-base', a, b])).stdout.trim();
    return { status: a === b ? 'identical' : mb === a ? 'ahead' : mb === b ? 'behind' : 'diverged', merge_base: mb };
  } };
  return server;
}

// worktree: [stray.txt] -> merge main (sibling.txt) -> code.txt; returns the merge commit and revision.
// TM-325: with `integration`, the sibling lands on that branch (not main), tm records it as the task's
// integrationBranch, and the worktree merges it; the server's main never moves past the admission.
async function mergedTask(t, { stray, integration = null }) {
  const { opts, git } = await fixture(t);
  await admitTask(opts);
  const worktree = (await opts.store.show()).worktree, id = ['-c', 'user.name=Test', '-c', 'user.email=test@example.invalid'];
  const admitted = (await git(worktree, ['rev-parse', 'HEAD'])).stdout.trim();
  if (stray) { await writeFile(join(worktree, 'stray.txt'), 'outside'); await git(worktree, ['add', 'stray.txt']); await git(worktree, [...id, 'commit', '-m', 'stray']); }
  if (integration) {
    await git(opts.consumer, ['checkout', '-q', '-b', integration]);
    await mkdir(join(opts.consumer, '.bytedesk/task-management/tasks'), { recursive: true });
    await writeFile(join(opts.consumer, '.bytedesk/task-management/tasks/TM-1-fixture.md'), `---\nid: "TM-1"\nintegrationBranch: ${JSON.stringify(integration)}\n---\n`);
  }
  await writeFile(join(opts.consumer, 'sibling.txt'), 'landed sibling'); await git(opts.consumer, ['add', 'sibling.txt']); await git(opts.consumer, [...id, 'commit', '-m', 'sibling task']);
  const sibling = (await git(opts.consumer, ['rev-parse', 'HEAD'])).stdout.trim();
  await git(worktree, [...id, 'merge', '--no-edit', '--no-ff', integration ?? 'main']);
  const merged = (await git(worktree, ['rev-parse', 'HEAD'])).stdout.trim();
  await writeFile(join(worktree, 'code.txt'), 'implemented'); await git(worktree, ['add', 'code.txt']); await git(worktree, [...id, 'commit', '-m', 'implementation']);
  const revision = (await git(worktree, ['rev-parse', 'HEAD'])).stdout.trim();
  await workerReport({ ...opts, kind: 'finish', report: { artifacts: ['code.txt'], checks: ['content'], risks: [], evidence: 'fixture', revision } });
  const server = fakeServer(integration ? admitted : sibling);
  // Coverage: from the admitted base the sibling IS in the diff, so the old check would refuse.
  assert.match((await git(worktree, ['diff', '--name-only', admitted, revision])).stdout, /sibling\.txt/);
  return { opts: { ...opts, serverCompare: server.compare }, git, merged, revision, server };
}

test('TM-257 (g) integration scope uses the review effective base, so a merged sibling is not out of scope', async t => {
  const { opts, server } = await mergedTask(t, { stray: false });
  assert.deepEqual((await integrationEligibility(opts)).reasons, []);
  assert.ok(server.calls > 0, 'the scope check asked the server');
});

test('TM-325 integration scope excludes what the task merged from its integration branch, not only main', async t => {
  const { opts, server } = await mergedTask(t, { stray: false, integration: 'fix/integration' });
  const asked = []; const compare = async (dir, from, to) => { asked.push(from); return server.compare(dir, from, to); };
  assert.deepEqual((await integrationEligibility({ ...opts, serverCompare: compare })).reasons, []);
  assert.ok(asked.includes('fix/integration'), `the scope check asked the server about the integration branch: ${JSON.stringify(asked)}`);
});

test('TM-325 an out-of-scope file is still refused when the task merged its integration branch', async t => {
  const { opts, server } = await mergedTask(t, { stray: true, integration: 'fix/integration' });
  const asked = []; const compare = async (dir, from, to) => { asked.push(from); return server.compare(dir, from, to); };
  assert.ok((await integrationEligibility({ ...opts, serverCompare: compare })).reasons.includes('implementation changed files outside the approved task scope'));
  assert.ok(asked.includes('fix/integration'), `refused over the integration-branch range, not the admitted one: ${JSON.stringify(asked)}`);
});

test('TM-257 (g) moving local main and origin/main does not hide an out-of-scope file from the scope check', async t => {
  const { opts, git, merged, revision } = await mergedTask(t, { stray: true });
  await git(opts.consumer, ['update-ref', 'refs/remotes/origin/main', merged]); await git(opts.consumer, ['update-ref', 'refs/heads/main', merged]);
  // Coverage: a base at the moved ref WOULD hide stray.txt.
  assert.doesNotMatch((await git(opts.consumer, ['diff', '--name-only', merged, revision])).stdout, /stray\.txt/);
  assert.ok((await integrationEligibility(opts)).reasons.includes('implementation changed files outside the approved task scope'));
});

// TM-248: an approved plan is a grant scoped to an epic or task list; every lead verb checks it covers
// the caller, the repository and the task, and a managed session cannot self-assert --authorized or --actor.
const noAutoMerge = opts => writeJson(join(opts.pluginRoot, 'config.defaults.json'), { management: { auto_merge: false, target_branch: 'main', required_checks: [{ name: 'noop', argv: ['true'] }] } });
async function landedTask(t) {
  const f = await fixture(t);
  await noAutoMerge(f.opts);
  const admitted = await admitTask(f.opts); const revision = (await f.finish()).finish.revision;
  await f.git(f.opts.consumer, ['merge', '--ff-only', revision]);
  await registerAgent(f.opts.consumer, 'lead-1');
  const landing = { reason: 'plan TM-248 landing', reviewGate: fullReview(admitted.record, revision), landed: 'main' };
  return { ...f, revision, landing };
}
const planGrant = (opts, extra = {}) => grantDelegation({ consumer: opts.consumer, home: opts.home, env: { USER: 'operator', AGENT_ORCHESTRATION_STATE_HOME: opts.env.AGENT_ORCHESTRATION_STATE_HOME }, to: 'lead-1', scopes: ['integrate', 'record-landing'], ...extra });

test('TM-248 in-plan: the lead lands a task in the approved plan, and the grant supplies actor, delegated_by, delegation_id and plan', async t => {
  const { opts, landing } = await landedTask(t);
  const grant = await planGrant(opts, { plan: { epic: 'EP-19' } });
  const recorded = await recordLanding({ ...asCaller(opts, 'lead-1'), ...landing });
  const auth = recorded.merge.authorization;
  assert.equal(auth.actor, 'lead-1'); assert.equal(auth.delegated_by, 'operator'); assert.equal(auth.delegation_id, grant.id);
  assert.deepEqual(auth.plan, { epic: 'EP-19', tasks: ['TM-1'], sha256: planDigest(['TM-1']) }); assert.equal(auth.explicit, false); assert.equal(auth.authorized, true);
  // integrate: a task listed by id is covered whatever its epic.
  const { opts: o2, finish } = await fixture(t); await noAutoMerge(o2);
  await admitTask(o2); await finish(); await registerAgent(o2.consumer, 'lead-1');
  const g2 = await planGrant(o2, { plan: { tasks: ['TM-1'] } });
  const integrated = await integrateTask(asCaller(o2, 'lead-1'));
  assert.equal(integrated.merge.authorization.actor, 'lead-1'); assert.equal(integrated.merge.authorization.delegation_id, g2.id);
  assert.equal(integrated.merge.authorization.delegated_by, 'operator'); assert.deepEqual(integrated.merge.authorization.plan, { epic: null, tasks: ['TM-1'], sha256: planDigest(['TM-1']) });
});

test('TM-248 out-of-plan: a grant for another epic or task list refuses the task with TOPOLOGY_DELEGATION_PLAN', async t => {
  const { opts, landing, git } = await landedTask(t);
  await planGrant(opts, { plan: { epic: 'EP-20', tasks: ['TM-2'] } });
  const lead = asCaller(opts, 'lead-1');
  // TM-263 (ADR-0027): a grant's plan no longer scopes the lead's record-landing; the lead path needs the server instead.
  await assert.rejects(recordLanding({ ...lead, ...landing }), { code: 'TOPOLOGY_MANAGEMENT_LANDING_AUTHORITY', message: /repository lead lead-1 needs the server to confirm/ });
  const before = (await git(opts.consumer, ['rev-parse', 'HEAD'])).stdout.trim();
  await assert.rejects(integrateTask(lead), { code: 'TOPOLOGY_DELEGATION_PLAN' });
  const gate = await integrationEligibility(lead);
  assert.equal(gate.eligible, false); assert.ok(gate.reasons.some(r => r.startsWith('TOPOLOGY_DELEGATION_PLAN')), gate.reasons.join('; '));
  assert.equal((await git(opts.consumer, ['rev-parse', 'HEAD'])).stdout.trim(), before);
  assert.equal((await managementStatus(opts)).management.merge, undefined, 'nothing was recorded by a refusal');
});

test('TM-248 expired grant: a plan grant past its expiry authorizes nothing', async t => {
  const { opts, landing } = await landedTask(t);
  await planGrant(opts, { expires: '1ms' });
  await new Promise(r => setTimeout(r, 10));
  await assert.rejects(recordLanding({ ...asCaller(opts, 'lead-1'), ...landing }), { code: 'TOPOLOGY_MANAGEMENT_LANDING_AUTHORITY', message: /repository lead lead-1 needs the server to confirm/ });
  await assert.rejects(integrateTask(asCaller(opts, 'lead-1')), { code: 'TOPOLOGY_MANAGEMENT_INTEGRATION_BLOCKED', message: /valid standing delegation/ });
});

test('TM-248 wrong repo: a plan grant for another repository authorizes nothing here', async t => {
  const { opts, landing } = await landedTask(t);
  const { opts: other } = await fixture(t);
  await registerAgent(other.consumer, 'lead-1');
  // Same state home, so only the repository key separates the two grants.
  await planGrant({ ...other, env: { ...other.env, AGENT_ORCHESTRATION_STATE_HOME: opts.env.AGENT_ORCHESTRATION_STATE_HOME }, home: opts.home });
  await assert.rejects(recordLanding({ ...asCaller(opts, 'lead-1'), ...landing }), { code: 'TOPOLOGY_MANAGEMENT_LANDING_AUTHORITY', message: /repository lead lead-1 needs the server to confirm/ });
  await assert.rejects(integrateTask(asCaller(opts, 'lead-1')), { code: 'TOPOLOGY_MANAGEMENT_INTEGRATION_BLOCKED' });
});

test('TM-248 worker session: a worker cannot use the lead\'s plan grant, nor self-assert --authorized', async t => {
  const { opts, landing } = await landedTask(t);
  await planGrant(opts);
  const worker = asCaller(opts, 'lead-1', 'worker-7'); // AO_AGENT_ID names the lead; the census binds the pane to worker-7
  await assert.rejects(recordLanding({ ...worker, ...landing }), { code: 'TOPOLOGY_DELEGATION_ACTOR' });
  const dispatched = { ...opts, ancestors: AGENT_ANCESTRY, env: { ...opts.env, TM_DISPATCH_WORKER: '1', TM_DISPATCH_TASK: 'TM-1' } };
  await assert.rejects(recordLanding({ ...dispatched, ...landing, authorized: true, actor: 'operator' }), { code: 'TOPOLOGY_MANAGEMENT_SELF_ASSERT', message: /TM_DISPATCH_WORKER/ });
  await assert.rejects(integrateTask({ ...dispatched, authorized: true }), { code: 'TOPOLOGY_MANAGEMENT_SELF_ASSERT' });
  assert.equal((await managementStatus(opts)).management.merge, undefined, 'nothing was recorded by a refusal');
});

test('TM-248 managed session passing --authorized is refused by the verb itself; an operator shell still may', async t => {
  const { opts, landing, git } = await landedTask(t);
  const before = (await git(opts.consumer, ['rev-parse', 'HEAD'])).stdout.trim();
  // A lead's session (AO_AGENT_ID, claude ancestor), a scrubbed env under a claude ancestor, and CLAUDECODE alone.
  const sessions = [asCaller(opts, 'lead-1'), { ...opts, ancestors: AGENT_ANCESTRY }, { ...opts, env: { ...opts.env, CLAUDECODE: '1' } }];
  for (const session of sessions) {
    await assert.rejects(recordLanding({ ...session, ...landing, authorized: true, actor: 'ryan' }), { code: 'TOPOLOGY_MANAGEMENT_SELF_ASSERT' });
    await assert.rejects(recordLanding({ ...session, ...landing, authorized: true }), { code: 'TOPOLOGY_MANAGEMENT_SELF_ASSERT', message: /--authorized cannot be self-asserted/ });
    await assert.rejects(integrateTask({ ...session, authorized: true }), { code: 'TOPOLOGY_MANAGEMENT_SELF_ASSERT' });
    const gate = await integrationEligibility({ ...session, authorized: true });
    assert.equal(gate.eligible, false); assert.ok(gate.reasons.some(r => r.startsWith('TOPOLOGY_MANAGEMENT_SELF_ASSERT')), gate.reasons.join('; '));
  }
  assert.equal((await git(opts.consumer, ['rev-parse', 'HEAD'])).stdout.trim(), before);
  assert.equal((await managementStatus(opts)).management.merge, undefined, 'nothing was recorded by a refusal');
  // The operator's shell (no marker, no agent ancestor) keeps --authorized and --actor.
  const recorded = await recordLanding({ ...opts, ...landing, authorized: true, actor: 'ryan' });
  assert.equal(recorded.merge.authorization.actor, 'ryan'); assert.equal(recorded.merge.authorization.explicit, true);
});

test('TM-304 an operator shell carrying only CODEX_BIN / CLAUDE_BIN records a landing; a session id is still refused', async t => {
  const { opts, landing } = await landedTask(t);
  const config = { ...opts.env, CODEX_BIN: 'codex', CLAUDE_BIN: '/home/u/.local/bin/claude' };
  await assert.rejects(recordLanding({ ...opts, env: { ...config, CODEX_THREAD_ID: 'x' }, ...landing, authorized: true, actor: 'ryan' }), { code: 'TOPOLOGY_MANAGEMENT_SELF_ASSERT', message: /CODEX_THREAD_ID/ });
  const recorded = await recordLanding({ ...opts, env: config, ...landing, authorized: true, actor: 'ryan' });
  assert.equal(recorded.merge.authorization.actor, 'ryan');
});

// TM-248 fix: management.auto_merge speaks only for an operator shell. A managed session always needs
// a live plan grant covering caller, repository and task, and the recorded actor comes from it.
test('TM-248 auto_merge: a managed session with no grant is refused on integrate and record-landing', async t => {
  const { opts, finish, git } = await fixture(t); // auto_merge: true
  const admitted = await admitTask(opts); const revision = (await finish()).finish.revision;
  await registerAgent(opts.consumer, 'lead-1');
  const lead = asCaller(opts, 'lead-1'), before = (await git(opts.consumer, ['rev-parse', 'HEAD'])).stdout.trim();
  const gate = await integrationEligibility(lead);
  assert.equal(gate.eligible, false); assert.ok(gate.reasons.some(r => /managed agent session needs a valid standing delegation/.test(r)), gate.reasons.join('; '));
  await assert.rejects(integrateTask({ ...lead, env: { ...lead.env, TM_ACTOR: 'lead-1' } }), { code: 'TOPOLOGY_MANAGEMENT_INTEGRATION_BLOCKED', message: /whatever management.auto_merge says/ });
  assert.equal((await git(opts.consumer, ['rev-parse', 'HEAD'])).stdout.trim(), before, 'nothing merged');
  await git(opts.consumer, ['merge', '--ff-only', revision]);
  const landing = { reason: 'auto-merge policy', reviewGate: fullReview(admitted.record, revision), landed: 'main' };
  // TM-263 (ADR-0027): the proven lead needs no grant to record a landing, only the server's confirmation.
  await assert.rejects(recordLanding({ ...lead, ...landing }), { code: 'TOPOLOGY_MANAGEMENT_LANDING_AUTHORITY', message: /repository lead lead-1 needs the server to confirm/ });
  // A scrubbed env under a claude ancestor is still a managed session.
  await assert.rejects(recordLanding({ ...opts, ancestors: AGENT_ANCESTRY, ...landing }), { code: 'TOPOLOGY_MANAGEMENT_LANDING_AUTHORITY', message: /managed agent session needs/ });
  assert.equal((await managementStatus(opts)).management.merge, undefined, 'nothing was recorded by a refusal');
});

test('TM-248 + TM-243 auto_merge: a bare verb from the lead\'s census-bound pane still needs a covering grant', async t => {
  const { opts, finish } = await fixture(t); // auto_merge: true
  await admitTask(opts); await finish(); await registerAgent(opts.consumer, 'lead-1');
  // What `ao-topology manage integrate` (bare) runs as: no marker in the shell env, no claude ancestor,
  // but its TMUX_PANE is the lead's census-bound pane. The CLI would also name it via bindingAgentId.
  const { paneEnv, ...lookups } = paneOf('lead-1');
  await writeJson(join(opts.env.AGENT_ORCHESTRATION_STATE_HOME, 'census', 'fixture.json'), { agents: [{ agentId: 'lead-1', binding: { ...LEAD_PANE } }] });
  const bare = { ...opts, ...lookups, env: { ...opts.env, TMUX: paneEnv.TMUX, TMUX_PANE: paneEnv.TMUX_PANE } };
  const gate = await integrationEligibility(bare);
  assert.equal(gate.eligible, false); assert.ok(gate.reasons.some(r => /managed agent session needs a valid standing delegation/.test(r)), gate.reasons.join('; '));
  const named = { ...bare, env: { ...bare.env, AO_AGENT_ID: 'lead-1' } }; // as bindingAgentId names it
  await assert.rejects(integrateTask(named), { code: 'TOPOLOGY_MANAGEMENT_INTEGRATION_BLOCKED', message: /whatever management.auto_merge says/ });
  const grant = await planGrant(opts);
  const integrated = await integrateTask(named);
  assert.equal(integrated.merge.authorization.delegation_id, grant.id); assert.equal(integrated.merge.authorization.actor, 'lead-1');
});

test('TM-248 auto_merge: the same managed session with a covering grant is allowed, and the grant names the actor', async t => {
  const { opts, finish } = await fixture(t); // auto_merge: true
  await admitTask(opts); await finish(); await registerAgent(opts.consumer, 'lead-1');
  const grant = await planGrant(opts);
  const integrated = await integrateTask({ ...asCaller(opts, 'lead-1'), env: { ...asCaller(opts, 'lead-1').env, TM_ACTOR: 'someone-else', USER: 'someone-else' } });
  const auth = integrated.merge.authorization;
  assert.equal(auth.actor, 'lead-1'); assert.equal(auth.delegated_by, 'operator'); assert.equal(auth.delegation_id, grant.id);
  assert.deepEqual(auth.plan, grant.plan); assert.equal(auth.channel, 'standing-delegation'); assert.equal(auth.policy_auto_merge, true);

  const f = await fixture(t);
  const admitted = await admitTask(f.opts); const revision = (await f.finish()).finish.revision;
  await f.git(f.opts.consumer, ['merge', '--ff-only', revision]); await registerAgent(f.opts.consumer, 'lead-1');
  const g2 = await planGrant(f.opts, { plan: { tasks: ['TM-1'] } });
  const recorded = await recordLanding({ ...asCaller(f.opts, 'lead-1'), reason: 'plan landing', reviewGate: fullReview(admitted.record, revision), landed: 'main' });
  const a2 = recorded.merge.authorization;
  assert.equal(a2.actor, 'lead-1'); assert.equal(a2.delegated_by, 'operator'); assert.equal(a2.delegation_id, g2.id); assert.deepEqual(a2.plan, g2.plan);
});

test('TM-248 auto_merge: an operator shell still integrates without a grant (documented operator path)', async t => {
  const { opts, finish } = await fixture(t); // auto_merge: true; opts is an operator shell
  await admitTask(opts); await finish();
  const integrated = await integrateTask({ ...opts, env: { ...opts.env, TM_ACTOR: '', USER: 'ryan' } });
  const auth = integrated.merge.authorization;
  assert.equal(auth.policy_auto_merge, true); assert.equal(auth.channel, 'local-operator'); assert.equal(auth.actor, 'ryan');
  assert.equal(auth.delegation_id, undefined);
});

// TM-248 fix: an epic plan is frozen at grant time. The fixture's store answers TM-1's epic from `doc`,
// which the grantee could edit; coverage must never read it.
async function frozenCase(t, { epicAtGrant, epicAfter, listed }) {
  const f = await fixture(t);
  await noAutoMerge(f.opts);
  f.doc.epic = epicAtGrant;
  const admitted = await admitTask(f.opts); const revision = (await f.finish()).finish.revision;
  await registerAgent(f.opts.consumer, 'lead-1');
  const grant = await planGrant(f.opts, { plan: { epic: 'EP-19' }, epicTasks: async () => listed });
  f.doc.epic = epicAfter;
  return { ...f, grant, lead: asCaller(f.opts, 'lead-1'), landing: { reason: 'frozen plan', reviewGate: fullReview(admitted.record, revision), landed: revision } };
}

test('TM-248 frozen plan (a): a task moved into the epic after the grant is refused', async t => {
  const { opts, lead, landing, git, grant } = await frozenCase(t, { epicAtGrant: 'EP-20', epicAfter: 'EP-19', listed: ['TM-2'] });
  assert.deepEqual(grant.plan.tasks, ['TM-2']);
  await assert.rejects(integrateTask(lead), { code: 'TOPOLOGY_DELEGATION_PLAN' });
  await git(opts.consumer, ['merge', '--ff-only', landing.landed]);
  // TM-263 (ADR-0027): record-landing by the lead is not plan-scoped; with no server it is still refused.
  await assert.rejects(recordLanding({ ...lead, ...landing }), { code: 'TOPOLOGY_MANAGEMENT_LANDING_AUTHORITY', message: /repository lead lead-1 needs the server to confirm/ });
});

test('TM-248 frozen plan (b): a task created in the epic after the grant is refused', async t => {
  // TM-1 did not exist when the store was asked; it is in EP-19 now.
  const { lead } = await frozenCase(t, { epicAtGrant: 'EP-19', epicAfter: 'EP-19', listed: ['TM-2', 'TM-3'] });
  await assert.rejects(integrateTask(lead), { code: 'TOPOLOGY_DELEGATION_PLAN' });
  const gate = await integrationEligibility(lead);
  assert.ok(gate.reasons.some(r => r.startsWith('TOPOLOGY_DELEGATION_PLAN')), gate.reasons.join('; '));
});

test('TM-248 frozen plan (c): a listed task moved out of the epic is still covered', async t => {
  const { lead, grant } = await frozenCase(t, { epicAtGrant: 'EP-19', epicAfter: 'EP-20', listed: ['TM-1', 'TM-2'] });
  const integrated = await integrateTask(lead);
  assert.equal(integrated.merge.authorization.delegation_id, grant.id); assert.equal(integrated.merge.authorization.actor, 'lead-1');
});

test('TM-248 frozen plan (d): a tampered plan.tasks or plan.sha256 is refused as TOPOLOGY_DELEGATION_INTEGRITY', async t => {
  const { opts, lead, landing, git } = await frozenCase(t, { epicAtGrant: 'EP-19', epicAfter: 'EP-19', listed: ['TM-2'] });

  const { readFile } = await import('node:fs/promises');
  const file = join(opts.env.AGENT_ORCHESTRATION_STATE_HOME, 'delegations', `${repoKey((await canonicalRepoId(opts.consumer)).id)}.json`);
  const [grant] = JSON.parse(await readFile(file, 'utf8'));
  await git(opts.consumer, ['merge', '--ff-only', landing.landed]);
  for (const plan of [{ ...grant.plan, tasks: ['TM-1', 'TM-2'] }, { ...grant.plan, sha256: planDigest(['TM-1']) }]) {
    await writeJson(file, [{ ...grant, plan }]);
    await assert.rejects(integrateTask(lead), { code: 'TOPOLOGY_DELEGATION_INTEGRITY', message: /plan\.sha256/ });
    await assert.rejects(recordLanding({ ...lead, ...landing }), { code: 'TOPOLOGY_DELEGATION_INTEGRITY' });
  }
  // Tampering both consistently is the documented same-user limit; the digest catches casual edits only.
  assert.equal((await managementStatus(opts)).management.merge, undefined, 'nothing was recorded by a refusal');
});

// TM-249: with management.integrate_via "pull-request", manage integrate merges the task's PR itself
// through ONE injected gh, and refuses each unmet condition by name. No network and no real gh: the
// fake answers from a PR object and performs the merge as a real merge commit in a local bare origin,
// so the local fast-forward and the store's governed-completion ancestry run for real.
const IDENTITY = ['-c', 'user.name=Test', '-c', 'user.email=test@example.invalid'];
async function prTask(t, { grant = {}, review, pr: prPatch = {}, checks, required, management = {}, criteria } = {}) {
  const f = await fixture(t);
  await writeJson(join(f.opts.pluginRoot, 'config.defaults.json'), { management: { auto_merge: false, target_branch: 'main', integrate_via: 'pull-request', ...management } });
  const admitted = await admitTask(f.opts); const revision = (await f.finish()).finish.revision;
  const base = (await f.git(f.opts.consumer, ['rev-parse', 'main'])).stdout.trim();
  const origin = join(f.opts.consumer, '..', 'origin.git');
  await run('git', ['clone', '-q', '--bare', f.opts.consumer, origin]);
  await f.git(f.opts.consumer, ['remote', 'add', 'origin', origin]);
  await f.git(f.opts.consumer, ['push', '-q', 'origin', 'tm/TM-1']);
  await registerAgent(f.opts.consumer, 'lead-1');
  const granted = grant === null ? null : await planGrant(f.opts, grant);
  const pr = { number: 7, state: 'OPEN', baseRefName: 'main', headRefOid: revision, mergeable: 'MERGEABLE', ...prPatch };
  const state = { pr, checks: checks || [{ name: 'unit', state: 'SUCCESS', bucket: 'pass' }, { name: 'docs-only', state: 'SKIPPED', bucket: 'skipping' }], required: required || [{ name: 'unit', state: 'SUCCESS', bucket: 'pass' }], argv: [], viewFails: false, repo: 'o/r' };
  const mergeInOrigin = async head => {
    const tree = (await run('git', ['-C', origin, 'rev-parse', `${head}^{tree}`])).stdout.trim();
    const oid = (await run('git', ['-C', origin, ...IDENTITY, 'commit-tree', tree, '-p', 'main', '-p', head, '-m', `Merge pull request #${pr.number}`])).stdout.trim();
    await run('git', ['-C', origin, 'update-ref', 'refs/heads/main', oid]);
    Object.assign(pr, { state: 'MERGED', mergeCommit: { oid } });
  };
  const ok = value => ({ code: 0, stdout: JSON.stringify(value), stderr: '' });
  const gh = async args => {
    state.argv.push(args);
    const [noun, verb] = args;
    if (noun === 'repo' && verb === 'view') return ok({ nameWithOwner: state.repo, defaultBranchRef: { name: 'main' } });
    if (noun !== 'pr') return { code: 1, stdout: '', stderr: 'unexpected' };
    if (!args.includes('--repo') || args[args.indexOf('--repo') + 1] !== 'o/r') return { code: 1, stdout: '', stderr: `gh pr ${verb} without --repo o/r` };
    if (verb === 'list') return ok([pr]);
    if (verb === 'checks') return ok(args.includes('--required') ? state.required : state.checks);
    if (verb === 'merge') { await mergeInOrigin(pr.headRefOid); return { code: 0, stdout: '', stderr: '' }; }
    if (verb === 'view') return state.viewFails ? { code: 1, stdout: '', stderr: 'HTTP 502' } : ok({ state: pr.state, headRefOid: pr.headRefOid, baseRefName: pr.baseRefName, mergeCommit: pr.mergeCommit ?? null });
    return { code: 1, stdout: '', stderr: `unknown gh pr ${verb}` };
  };
  // The fake store keeps tm's acceptance gate: done refuses while any criterion is unaccepted.
  // accept is what an attesting party (worker evidence, operator) calls; integrate must never call it.
  const closed = { accepted: [], doneBy: [] };
  f.doc.acceptance = (criteria || [{ text: 'first', done: true }, { text: 'second', done: true }]).map(c => ({ ...c }));
  Object.assign(f.opts.store, {
    accept: async (_task, n) => { closed.accepted.push(n); f.doc.acceptance[n - 1].done = true; },
    done: async (_task, actor) => {
      const open = f.doc.acceptance.filter(c => !c.done);
      if (open.length) throw new Error(`tm done refused: ${open.length} acceptance criteria not accepted`);
      closed.doneBy.push(actor); f.doc.status = 'done';
    },
  });
  const attest = () => { for (const c of f.doc.acceptance) c.done = true; };
  const lead = { ...asCaller(f.opts, 'lead-1'), gh, reviewGate: review || fullReview(admitted.record, revision) };
  return { ...f, admitted, revision, base, origin, pr, state, gh, lead, grant: granted, closed, mergeInOrigin, attest };
}
const merges = state => state.argv.filter(a => a[1] === 'merge');
async function refusedAs(p, options, condition, message) {
  await assert.rejects(integrateTask(options), err => {
    assert.equal(err.code, 'TOPOLOGY_INTEGRATE_REFUSED', err.message);
    const named = err.details.refusals.filter(r => r.condition === condition);
    assert.ok(named.length, `expected a "${condition}" refusal, got: ${err.message}`);
    if (message) assert.ok(named.some(r => message.test(r.reason)), `"${condition}" refusal should match ${message}: ${err.message}`);
    return true;
  });
  assert.deepEqual(merges(p.state), [], 'a refusal never reaches gh pr merge');
  assert.equal((await managementStatus(p.opts)).management.merge, undefined, 'a refusal records nothing');
  assert.deepEqual(p.closed.doneBy, [], 'a refusal closes nothing');
}

const UNACCEPTED = [{ text: 'first', done: false }, { text: 'second', done: true }, { text: 'third', done: false }];
test('TM-249 success: integrate merges the PR with exactly --merge --match-head-commit and records the landing; it never accepts criteria, so an unattested task stays open until a rerun', async t => {
  const p = await prTask(t, { criteria: UNACCEPTED });
  await assert.rejects(integrateTask(p.lead), err => {
    assert.equal(err.code, 'TOPOLOGY_INTEGRATE_UNCLOSED', err.message);
    assert.deepEqual(err.details.unaccepted, [{ index: 1, text: 'first' }, { index: 3, text: 'third' }]);
    assert.match(err.message, /#1 "first"; #3 "third"/); assert.match(err.message, /landing is recorded/);
    assert.equal(err.details.merged, true); assert.equal(err.details.recorded, true);
    return true;
  });
  assert.deepEqual(merges(p.state), [['pr', 'merge', '7', '--repo', 'o/r', '--merge', '--match-head-commit', p.revision]]);
  for (const argv of p.state.argv) for (const flag of ['--admin', '--squash', '--rebase', '--auto', '--force'])
    assert.ok(!argv.includes(flag), `gh was never given ${flag}: ${argv.join(' ')}`);
  assert.deepEqual(p.closed.accepted, [], 'integrate accepted no criterion on the task\'s behalf');
  assert.deepEqual(p.doc.acceptance.map(c => c.done), [false, true, false], 'criteria are untouched');
  assert.deepEqual(p.closed.doneBy, []); assert.notEqual(p.doc.status, 'done');
  const landed = (await managementStatus(p.opts)).management;
  assert.equal(landed.state, 'merged'); assert.equal(landed.merge.pull_request.number, 7); assert.equal(landed.closed, undefined);
  const auth = landed.merge.authorization;
  assert.equal(auth.actor, 'lead-1'); assert.equal(auth.delegated_by, 'operator'); assert.equal(auth.delegation_id, p.grant.id); assert.equal(auth.authorized, true);
  assert.equal(landed.merge.landed, p.pr.mergeCommit.oid);
  assert.deepEqual(landed.merge.checks.map(c => c.name), ['unit', 'docs-only'], 'a skipped check not listed as required is allowed');
  assert.equal((await p.git(p.opts.consumer, ['rev-parse', 'main'])).stdout.trim(), p.pr.mergeCommit.oid, 'local main fast-forwarded to the merge commit');
  // Whoever can attest accepts the criteria through the store; the rerun then closes without merging again.
  p.attest();
  const result = await integrateTask(p.lead);
  assert.equal(merges(p.state).length, 1, 'the rerun never merged again');
  assert.deepEqual(p.closed.accepted, []); assert.deepEqual(p.closed.doneBy, ['lead-1'], 'done as the grant\'s actor');
  assert.deepEqual(result.closed && { actor: result.closed.actor, delegated_by: result.closed.delegated_by, delegation_id: result.closed.delegation_id }, { actor: 'lead-1', delegated_by: 'operator', delegation_id: p.grant.id });
  assert.ok(p.calls.indexOf('merge') < p.calls.indexOf('close'), 'landing recorded before closing');
  // The store's real governed-completion gate accepts the record.
  const { governedCompletion } = await import('../../../task-management/lib/governance-check.mjs');
  const saved = process.env.AGENT_ORCHESTRATION_STATE_HOME; process.env.AGENT_ORCHESTRATION_STATE_HOME = p.opts.env.AGENT_ORCHESTRATION_STATE_HOME;
  t.after(() => { if (saved === undefined) delete process.env.AGENT_ORCHESTRATION_STATE_HOME; else process.env.AGENT_ORCHESTRATION_STATE_HOME = saved; });
  const gate = governedCompletion({ id: 'TM-1', worktree: result.worktree, branch: result.branch, governance: { version: 1, runtime: 'topology', workflowRunId: result.workflow_run_id, leadId: result.lead_id, revision: p.revision, state: 'ready-for-review' } }, { root: p.opts.consumer });
  assert.equal(gate.allow, true, gate.reason); assert.equal(gate.actor, 'lead-1');
  // Rerunning is a no-op: nothing merges twice.
  await integrateTask(p.lead); assert.equal(merges(p.state).length, 1);
});

test('TM-249 close-retry runs the same caller and plan gate: a worker pane and a lead without a grant are refused by name and the task stays open', async t => {
  // Criteria are all accepted; the store refuses done once for another gate, leaving the landing recorded but the task open.
  const p = await prTask(t), done = p.opts.store.done;
  p.opts.store.done = async () => { throw new Error('tm done refused: governed completion is unavailable'); };
  await assert.rejects(integrateTask(p.lead), err => err.code === 'TOPOLOGY_INTEGRATE_UNCLOSED' && /governed completion is unavailable/.test(err.message));
  p.opts.store.done = done;
  const retryRefused = async (options, condition, message) => {
    await assert.rejects(integrateTask(options), err => {
      assert.equal(err.code, 'TOPOLOGY_INTEGRATE_REFUSED', err.message);
      assert.ok(err.details.refusals.some(r => r.condition === condition && message.test(r.reason)), err.message);
      return true;
    });
    assert.deepEqual(p.closed.doneBy, [], 'nothing closed'); assert.notEqual(p.doc.status, 'done');
    assert.equal((await managementStatus(p.opts)).management.closed, undefined);
    assert.equal(merges(p.state).length, 1, 'never merged again');
  };
  // A worker: TM_DISPATCH_WORKER unset, AO_AGENT_ID naming the lead, but its pane is bound to worker-7.
  const worker = { ...asCaller(p.opts, 'lead-1', 'worker-7'), gh: p.gh, reviewGate: p.lead.reviewGate };
  assert.equal(worker.env.TM_DISPATCH_WORKER, undefined);
  await retryRefused(worker, 'caller', /TOPOLOGY_DELEGATION_ACTOR/);
  // The lead's own managed session once its grant is revoked.
  const { revokeDelegation } = await import('../../topology/lib/delegation.mjs');
  await revokeDelegation({ consumer: p.opts.consumer, home: p.opts.home, env: { USER: 'operator', AGENT_ORCHESTRATION_STATE_HOME: p.opts.env.AGENT_ORCHESTRATION_STATE_HOME }, io: { ancestors: async () => ['zsh'] }, id: p.grant.id });
  await retryRefused(p.lead, 'plan', /managed agent session needs a valid standing delegation/);
});

test('TM-249 authorization: an operator-shell auto_merge integrate without --authorized or a grant records authorized: false, exactly as the fast-forward path', async t => {
  const p = await prTask(t, { grant: null, management: { auto_merge: true } });
  const result = await integrateTask({ ...p.opts, gh: p.gh, reviewGate: p.lead.reviewGate, env: { ...p.opts.env, TM_ACTOR: '', USER: 'ryan' } });
  const auth = result.merge.authorization;
  assert.equal(auth.authorized, false); assert.equal(auth.policy_auto_merge, true); assert.equal(auth.explicit, false);
  assert.equal(auth.channel, 'local-operator'); assert.equal(auth.actor, 'ryan'); assert.equal(auth.delegation_id, undefined);
  assert.deepEqual(p.closed.doneBy, ['ryan']);
  // The same caller under the fast-forward path records the same authorization shape.
  const { opts, finish } = await fixture(t); // auto_merge: true, operator shell
  await admitTask(opts); await finish();
  const ff = (await integrateTask({ ...opts, env: { ...opts.env, TM_ACTOR: '', USER: 'ryan' } })).merge.authorization;
  for (const key of ['authorized', 'policy_auto_merge', 'explicit', 'channel', 'actor']) assert.equal(auth[key], ff[key], key);
});

test('TM-249 refusal plan: a grant whose plan does not cover the task', async t => {
  const p = await prTask(t, { grant: { plan: { tasks: ['TM-2'] } } });
  await refusedAs(p, p.lead, 'plan', /TOPOLOGY_DELEGATION_PLAN/);
});

test('TM-249 refusal plan: a managed lead session without any grant', async t => {
  const p = await prTask(t, { grant: null });
  await refusedAs(p, p.lead, 'plan', /managed agent session needs a valid standing delegation/);
});

test('TM-249 refusal caller: a worker session cannot use the lead\'s grant', async t => {
  const p = await prTask(t);
  await refusedAs(p, { ...asCaller(p.opts, 'lead-1', 'worker-7'), gh: p.gh, reviewGate: p.lead.reviewGate }, 'caller', /TOPOLOGY_DELEGATION_ACTOR/);
  // A dispatched worker naming the lead from outside the lead's pane.
  await refusedAs(p, { ...p.opts, ancestors: AGENT_ANCESTRY, gh: p.gh, reviewGate: p.lead.reviewGate, env: { ...p.opts.env, AO_AGENT_ID: 'lead-1', TM_DISPATCH_WORKER: '1' } }, 'caller', /TOPOLOGY_DELEGATION_ACTOR/);
});

test('TM-249 refusal base: the PR does not target the integration branch', async t => {
  const p = await prTask(t, { pr: { baseRefName: 'develop' } });
  await refusedAs(p, p.lead, 'base', /targets develop, not the integration branch main/);
});

test('TM-249 refusal head: the PR head is not the reviewed and approved revision', async t => {
  const p = await prTask(t);
  const review = fullReview(p.admitted.record, p.base);
  await refusedAs(p, { ...p.lead, reviewGate: review }, 'head', /not the reviewed and approved revision/);
});

test('TM-249 refusal head: the PR head is not the task\'s recorded finish revision', async t => {
  const p = await prTask(t);
  p.pr.headRefOid = p.base; // reviewed and PR agree with each other, not with the finish report
  await assert.rejects(integrateTask({ ...p.lead, reviewGate: fullReview(p.admitted.record, p.base) }), err =>
    err.details.refusals.some(r => r.condition === 'head' && /recorded finish revision/.test(r.reason)) &&
    !err.details.refusals.some(r => /reviewed and approved/.test(r.reason)));
  assert.deepEqual(merges(p.state), []);
});

test('TM-249 refusal ci: a pending check', async t => {
  const p = await prTask(t, { checks: [{ name: 'unit', state: 'IN_PROGRESS', bucket: 'pending' }] });
  await refusedAs(p, p.lead, 'ci', /unit is pending/);
});

test('TM-249 refusal ci: a failed check, a skipped required check, and no checks at all', async t => {
  const p = await prTask(t, { checks: [{ name: 'unit', state: 'SUCCESS', bucket: 'pass' }, { name: 'lint', state: 'FAILURE', bucket: 'fail' }] });
  await refusedAs(p, p.lead, 'ci', /lint is fail/);
  p.state.checks = [{ name: 'unit', state: 'SKIPPED', bucket: 'skipping' }];
  await refusedAs(p, p.lead, 'ci', /unit is skipping \(required\)/);
  p.state.checks = [];
  await refusedAs(p, p.lead, 'ci', /no CI checks are reported/);
});

test('TM-249 refusal review: the verdict is not approve', async t => {
  const p = await prTask(t);
  const approved = await fullReview(p.admitted.record, p.revision)();
  await refusedAs(p, { ...p.lead, reviewGate: async () => ({ ...approved, status: { review: { ...approved.status.review, verdict: 'request-changes' } } }) }, 'review', /request-changes, not approve/);
  await refusedAs(p, { ...p.lead, reviewGate: async () => ({ eligible: false, reasons: ['reviewer is not independent of the lead and authors'] }) }, 'review', /not independent/);
});

test('TM-249 refusal mergeable: the PR has conflicts', async t => {
  const p = await prTask(t, { pr: { mergeable: 'CONFLICTING' } });
  await refusedAs(p, p.lead, 'mergeable', /CONFLICTING, not MERGEABLE/);
});

test('TM-249 idempotent: a PR already merged at the approved head is recorded and closed without merging again', async t => {
  const p = await prTask(t);
  await p.mergeInOrigin(p.revision);
  const result = await integrateTask(p.lead);
  assert.deepEqual(merges(p.state), [], 'no second merge');
  assert.equal(result.merge.pull_request.already_merged, true); assert.equal(result.merge.landed, p.pr.mergeCommit.oid);
  assert.equal(result.merge.authorization.actor, 'lead-1'); assert.deepEqual(p.closed.doneBy, ['lead-1']);
});

test('TM-249 idempotent: a PR merged at a different head is refused by name', async t => {
  const p = await prTask(t);
  await p.mergeInOrigin(p.revision);
  p.pr.headRefOid = p.base;
  await refusedAs(p, p.lead, 'head', /already merged at .*not the task's recorded finish revision/);
});

test('TM-249 merged but unrecorded is reported explicitly, and a rerun records it without merging again', async t => {
  const p = await prTask(t);
  p.state.viewFails = true;
  await assert.rejects(integrateTask(p.lead), err => err.code === 'TOPOLOGY_INTEGRATE_UNRECORDED' && err.details.merged === true && /Do not merge again/.test(err.message));
  assert.equal((await managementStatus(p.opts)).management.merge, undefined);
  p.state.viewFails = false;
  const result = await integrateTask(p.lead);
  assert.equal(merges(p.state).length, 1, 'the merge ran exactly once'); assert.equal(result.merge.pull_request.already_merged, true);
  assert.deepEqual(p.closed.doneBy, ['lead-1']);
});

// ── TM-263 (ADR-0027): the repository lead records landings without a grant, and a lead-autonomy
// policy on the SERVER default branch stands in for a plan grant on integrate. No real gh: the server
// compare and gh are injected; the lead is proven by the same injected pane, census and /proc as TM-234.
const leadServer = async (t, serverMain) => {
  const f = await landedTask(t);
  const server = fakeServer(serverMain === 'landed' ? f.revision : (await f.git(f.opts.consumer, ['rev-parse', 'main~1'])).stdout.trim());
  return { ...f, server, lead: { ...asCaller(f.opts, 'lead-1'), serverCompare: server.compare } };
};

test('TM-263 (a) the proven lead records a landing with no grant and no --authorized; the record names the lead channel and ADR', async t => {
  const { opts, lead, landing, revision, server } = await leadServer(t, 'landed');
  const recorded = await recordLanding({ ...lead, ...landing });
  const auth = recorded.merge.authorization;
  assert.deepEqual({ authorized: auth.authorized, channel: auth.channel, actor: auth.actor, adr: auth.adr, explicit: auth.explicit, delegation_id: auth.delegation_id },
    { authorized: true, channel: 'repository-lead', actor: 'lead-1', adr: 'ADR-0027', explicit: false, delegation_id: undefined });
  assert.equal(recorded.merge.landed, revision); assert.ok(server.calls >= 1, 'the server was asked');
  const { governedCompletion } = await import('../../../task-management/lib/governance-check.mjs');
  const saved = process.env.AGENT_ORCHESTRATION_STATE_HOME; process.env.AGENT_ORCHESTRATION_STATE_HOME = opts.env.AGENT_ORCHESTRATION_STATE_HOME;
  t.after(() => { if (saved === undefined) delete process.env.AGENT_ORCHESTRATION_STATE_HOME; else process.env.AGENT_ORCHESTRATION_STATE_HOME = saved; });
  const gate = governedCompletion({ id: 'TM-1', worktree: recorded.worktree, branch: recorded.branch, governance: { version: 1, runtime: 'topology', workflowRunId: recorded.workflow_run_id, leadId: recorded.lead_id, revision, state: 'ready-for-review' } }, { root: opts.consumer });
  assert.equal(gate.allow, true, gate.reason); assert.equal(gate.actor, 'lead-1');
});

test('TM-263 (a) the lead path still refuses self-asserted flags and a review that did not approve the landed revision', async t => {
  const { opts, lead, landing, revision } = await leadServer(t, 'landed');
  await assert.rejects(recordLanding({ ...lead, ...landing, authorized: true }), { code: 'TOPOLOGY_MANAGEMENT_SELF_ASSERT' });
  await assert.rejects(recordLanding({ ...lead, ...landing, actor: 'lead-1' }), { code: 'TOPOLOGY_MANAGEMENT_SELF_ASSERT' });
  const review = verdict => async () => { const r = await landing.reviewGate(); return { ...r, status: { review: { ...r.status.review, verdict } } }; };
  await assert.rejects(recordLanding({ ...lead, ...landing, reviewGate: review('changes_requested') }), { code: 'TOPOLOGY_MANAGEMENT_REVIEW', message: /approved/ });
  const other = async () => { const r = await landing.reviewGate(); return { ...r, status: { review: { ...r.status.review, revision: 'f'.repeat(40), verified_commit: 'f'.repeat(40) } } }; };
  await assert.rejects(recordLanding({ ...lead, ...landing, reviewGate: other }), { code: 'TOPOLOGY_MANAGEMENT_REVIEW', message: new RegExp(revision) });
  assert.equal((await managementStatus(opts)).management.merge, undefined, 'nothing recorded by a refusal');
});

test('TM-263 (b) a worker, and an agent that is not the lead, are refused record-landing', async t => {
  const { opts, lead, landing, server } = await leadServer(t, 'landed');
  // The worker in its own pane naming the lead; the lead's pane named without running in it; a dispatched worker in the lead's pane.
  for (const worker of [{ ...asCaller(opts, 'lead-1', 'worker-7'), serverCompare: server.compare }, { ...lead, callerProc: WORKER_PROC }])
    await assert.rejects(recordLanding({ ...worker, ...landing }), { code: 'TOPOLOGY_DELEGATION_ACTOR' });
  await assert.rejects(recordLanding({ ...lead, env: { ...lead.env, TM_DISPATCH_WORKER: '1' }, ...landing }), { code: 'TOPOLOGY_DELEGATION_ACTOR', message: /TM_DISPATCH_WORKER/ });
  // An agent proven in its own pane, but not this repository's lead.
  await assert.rejects(recordLanding({ ...asCaller(opts, 'agent-9'), serverCompare: server.compare, ...landing }), { code: 'TOPOLOGY_MANAGEMENT_LANDING_AUTHORITY', message: /own lead/ });
  assert.equal((await managementStatus(opts)).management.merge, undefined, 'nothing recorded by a refusal');
});

test('TM-263 (c) the lead cannot record a landing the server default branch does not have', async t => {
  const { opts, lead, landing, revision } = await leadServer(t, 'before-landing');
  await assert.rejects(recordLanding({ ...lead, ...landing }), { code: 'TOPOLOGY_MANAGEMENT_TARGET', message: new RegExp(`${revision} is not on the server's default branch \\(compare says behind\\)`) });
  await assert.rejects(recordLanding({ ...lead, ...landing, serverCompare: NO_SERVER_COMPARE }), { code: 'TOPOLOGY_MANAGEMENT_LANDING_AUTHORITY', message: /could not answer/ });
  assert.equal((await managementStatus(opts)).management.merge, undefined, 'nothing recorded by a refusal');
});

const LEAD_POLICY = { lead: 'lead-1', authorized_by: 'Ryan Helms', adr: 'ADR-0027', scopes: ['integrate', 'record-landing'], granted_at: '2026-09-28' };
const POLICY_API = ['api', 'repos/o/r/contents/.bytedesk/agent-orchestration/config.json?ref=main'];
// The server side of gh: repo view and the contents API answer from `server`; every other call goes to the PR fake.
const withServer = (p, server) => async args => {
  if (args[0] !== 'repo' && args[0] !== 'api') return p.gh(args);
  p.state.argv.push(args);
  if (server.down) return { code: 1, stdout: '', stderr: 'error connecting to api.github.com' };
  if (args[0] === 'repo') return { code: 0, stdout: JSON.stringify({ nameWithOwner: server.repo || 'o/r', defaultBranchRef: { name: 'main' } }), stderr: '' };
  if (args.join(' ') !== POLICY_API.join(' ')) return { code: 1, stdout: '', stderr: `unexpected ${args.join(' ')}` };
  const content = Buffer.from(JSON.stringify({ management: { target_branch: 'main', ...(server.policy ? { lead_autonomy: server.policy } : {}) } })).toString('base64');
  return { code: 0, stdout: JSON.stringify({ content, encoding: 'base64' }), stderr: '' };
};
const policyTask = async (t, server, management = {}) => { const p = await prTask(t, { grant: null, management }); return { ...p, lead: { ...p.lead, gh: withServer(p, server) } }; };

test('TM-263 (d) with the server policy naming the lead, integrate merges without a grant, with the exact gh argv, and records the policy and ADR', async t => {
  const p = await policyTask(t, { policy: LEAD_POLICY });
  const result = await integrateTask(p.lead);
  const VIEW = ['repo', 'view', '--json', 'nameWithOwner,defaultBranchRef'];
  assert.deepEqual(p.state.argv, [
    VIEW, POLICY_API, VIEW,
    ['pr', 'list', '--repo', 'o/r', '--head', 'tm/TM-1', '--state', 'all', '--json', 'number,state,baseRefName,headRefOid,mergeable'],
    ['pr', 'checks', '7', '--repo', 'o/r', '--json', 'name,state,bucket'], ['pr', 'checks', '7', '--required', '--repo', 'o/r', '--json', 'name,state,bucket'],
    ['pr', 'merge', '7', '--repo', 'o/r', '--merge', '--match-head-commit', p.revision],
    ['pr', 'view', '7', '--repo', 'o/r', '--json', 'state,headRefOid,baseRefName,mergeCommit']]);
  // Only the resolution itself is unaddressed; every other call names the pinned repository.
  for (const argv of p.state.argv.filter(a => a.join(' ') !== VIEW.join(' ')))
    assert.ok(argv[0] === 'api' ? argv[1].startsWith('repos/o/r/') : argv[argv.indexOf('--repo') + 1] === 'o/r', `gh call not pinned to o/r: ${argv.join(' ')}`);
  const auth = result.merge.authorization;
  assert.deepEqual({ authorized: auth.authorized, channel: auth.channel, actor: auth.actor, policy: auth.policy, delegation_id: auth.delegation_id },
    { authorized: true, channel: 'lead-autonomy-policy', actor: 'lead-1', policy: { adr: 'ADR-0027', authorized_by: 'Ryan Helms', source: 'server-default-branch' }, delegation_id: undefined });
  assert.deepEqual(p.closed.doneBy, ['lead-1']); assert.equal(result.closed.actor, 'lead-1');
});

test('TM-263 (d) the policy replaces only the grant: every other integrate guardrail still refuses by name', async t => {
  const p = await policyTask(t, { policy: LEAD_POLICY });
  p.pr.mergeable = 'CONFLICTING';
  await refusedAs(p, p.lead, 'mergeable');
});

test('TM-263 (e) a lead_autonomy policy only in the LOCAL config is ignored: a grant is required', async t => {
  const p = await policyTask(t, { policy: null });
  // The tamper: the repository's own config file (what loadConfig reads) names the lead.
  await writeJson(join(p.opts.consumer, '.bytedesk', 'agent-orchestration', 'config.json'), { management: { lead_autonomy: LEAD_POLICY } });
  const { loadConfig } = await import('../../topology/lib/config.mjs');
  assert.deepEqual((await loadConfig(p.opts)).config.management.lead_autonomy, LEAD_POLICY, 'the local policy is really loaded');
  await refusedAs(p, p.lead, 'plan', /managed agent session needs a valid standing delegation/);
  assert.ok(p.state.argv.some(a => a.join(' ') === POLICY_API.join(' ')), 'the server was read, not the local file');
});

test('TM-263 (f) the server unavailable fails closed to grant-required', async t => {
  const p = await policyTask(t, { policy: LEAD_POLICY, down: true });
  await refusedAs(p, p.lead, 'plan', /managed agent session needs a valid standing delegation/);
});

test('TM-263 (g) a server policy naming a different lead, or not the integrate scope, needs a grant', async t => {
  for (const policy of [{ ...LEAD_POLICY, lead: 'lead-2' }, { ...LEAD_POLICY, scopes: ['record-landing'] }]) {
    const p = await policyTask(t, { policy });
    await refusedAs(p, p.lead, 'plan', /managed agent session needs a valid standing delegation/);
  }
  // The policy names an agent that is proven in its own pane but is not this repository's lead.
  const p = await policyTask(t, { policy: { ...LEAD_POLICY, lead: 'agent-9' } });
  await refusedAs(p, { ...asCaller(p.opts, 'agent-9'), gh: p.lead.gh, reviewGate: p.lead.reviewGate }, 'plan', /managed agent session needs/);
});

test('TM-263 (h) a worker is refused while the policy exists', async t => {
  const p = await policyTask(t, { policy: LEAD_POLICY });
  const base = { gh: p.lead.gh, reviewGate: p.lead.reviewGate };
  await refusedAs(p, { ...asCaller(p.opts, 'lead-1', 'worker-7'), ...base }, 'caller', /TOPOLOGY_DELEGATION_ACTOR/);
  await refusedAs(p, { ...p.lead, callerProc: WORKER_PROC }, 'caller', /not an ancestor/);
  await refusedAs(p, { ...p.lead, env: { ...p.lead.env, TM_DISPATCH_WORKER: '1' } }, 'caller', /TM_DISPATCH_WORKER/);
  await refusedAs(p, { ...asCaller(p.opts, 'worker-7'), ...base }, 'plan', /managed agent session needs/);
});

// TM-263 (Faro): the GitHub repository is pinned in host state on first resolution, so a repointed
// remote or a changed gh default cannot move the policy read, the PR lookup or the merge elsewhere.
test('TM-263 (i) pinnedGithubRepo pins the first answer and refuses a later one that disagrees', async t => {
  const { opts } = await fixture(t);
  const answer = { name: 'o/r' };
  const gh = async () => ({ code: 0, stdout: JSON.stringify({ nameWithOwner: answer.name, defaultBranchRef: { name: 'main' } }), stderr: '' });
  const io = { env: opts.env, home: opts.home };
  assert.deepEqual(await pinnedGithubRepo(opts.consumer, gh, io), { repo: 'o/r', branch: 'main' });
  const pin = join(opts.env.AGENT_ORCHESTRATION_STATE_HOME, 'repositories', `${repoKey((await canonicalRepoId(opts.consumer)).id)}.github.json`);
  assert.equal((await readJson(pin)).nameWithOwner, 'o/r', 'the pin is recorded under the state root for this repository key');
  answer.name = 'O/R';
  assert.deepEqual(await pinnedGithubRepo(opts.consumer, gh, io), { repo: 'o/r', branch: 'main' }, 'GitHub names compare case-insensitively');
  answer.name = 'attacker/r';
  await assert.rejects(pinnedGithubRepo(opts.consumer, gh, io), { code: 'TOPOLOGY_REPOSITORY_PIN', message: /attacker\/r.*pinned to o\/r/ });
  assert.equal((await readJson(pin)).nameWithOwner, 'o/r', 'a disagreeing answer never rewrites the pin');
});

test('TM-263 (i) after pinning, a repointed remote or gh default refuses integrate as "repository" and drops lead autonomy', async t => {
  const server = { policy: LEAD_POLICY };
  const p = await policyTask(t, server);
  await pinnedGithubRepo(p.opts.consumer, p.lead.gh, { env: p.opts.env, home: p.opts.home });
  server.repo = 'attacker/r'; // what `git remote set-url` or `gh repo set-default` would make gh answer
  await refusedAs(p, p.lead, 'repository', /pinned to o\/r/);
  await refusedAs(p, p.lead, 'plan', /managed agent session needs a valid standing delegation/);
  assert.ok(!p.state.argv.some(a => a[0] === 'pr' || (a[0] === 'api' && !a[1].startsWith('repos/o/r/'))), 'nothing was asked of the other repository');
});

test('TM-263 (j) record-landing: a server lead_autonomy policy naming another lead refuses the locally found lead', async t => {
  const serverGh = lead => async args => args[0] === 'repo'
    ? { code: 0, stdout: JSON.stringify({ nameWithOwner: 'o/r', defaultBranchRef: { name: 'main' } }), stderr: '' }
    : { code: 0, stdout: JSON.stringify({ content: Buffer.from(JSON.stringify({ management: { lead_autonomy: { ...LEAD_POLICY, lead } } })).toString('base64') }), stderr: '' };
  const refused = await leadServer(t, 'landed');
  await assert.rejects(recordLanding({ ...refused.lead, gh: serverGh('lead-2'), ...refused.landing }), { code: 'TOPOLOGY_MANAGEMENT_LANDING_AUTHORITY', message: /names lead-2 .* not lead-1/ });
  assert.equal((await managementStatus(refused.opts)).management.merge, undefined, 'nothing recorded by a refusal');
  const agreed = await leadServer(t, 'landed');
  assert.equal((await recordLanding({ ...agreed.lead, gh: serverGh('lead-1'), ...agreed.landing })).merge.authorization.channel, 'repository-lead');
});
