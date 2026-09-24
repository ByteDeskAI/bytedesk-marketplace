import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { run, writeJson } from '../../topology/lib/util.mjs';
import { admitTask, workerReport, integrationEligibility, integrateTask, cleanupTask, bindTaskWorker, taskWorkerState, managementStatus, recordLanding } from '../../topology/lib/management.mjs';
import { topologyRunLocation } from '../../topology/lib/discovery.mjs';
import { listServerPanes } from '../../topology/lib/tmux.mjs';

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'ao-manage-')); t.after(() => rm(root, { recursive: true, force: true }));
  const consumer = join(root, 'repo'), worktree = join(root, 'task'), pluginRoot = join(root, 'plugin');
  await mkdir(consumer); await run('git', ['init', '-q', '-b', 'main', consumer]);
  const git = async (cwd, args) => run('git', ['-C', cwd, ...args]);
  await writeFile(join(consumer, 'code.txt'), 'base');
  await git(consumer, ['add', 'code.txt']);
  await git(consumer, ['-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', 'commit', '-m', 'base']);
  const doc = { id: 'TM-1', status: 'todo', labels: ['ready-for-agent'], touches: ['code.txt'], blockedBy: [] };
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
  const opts = { consumer, pluginRoot, home: join(root, 'home'), env: { ...process.env, XDG_CONFIG_HOME: join(root, 'config'), AGENT_ORCHESTRATION_STATE_HOME: join(root, 'state') }, store, task: 'TM-1', owner: 'author', intent: 'Implement file', boundaries: ['code.txt only'], dependencies: [], checks: ['content'], reviewerReady: async () => ({ available: true }), reviewGate: async () => ({ eligible: true, reasons: [], status: { review: { verdict: 'approve', reviewer_id: 'fixture-reviewer' } } }), workerState: async () => ({ owned: true, active: false, alive: false }) };
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
  const { readJson } = await import('../../topology/lib/util.mjs');
  const state = await readJson(join(opts.consumer, '.bytedesk/task-management/state.json'));
  assert.equal(state.claims['TM-001'].session, 'author');
  assert.equal(state.claims['TM-001'].worktree, doc.worktree);
  assert.equal((await admitTask(actual)).resumed, true);
  const worktrees = JSON.parse((await tm(['worktree', '--json'])).stdout);
  assert.equal(worktrees.filter(w => w.taskId === 'TM-001').length, 1);
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
  const actual = { ...opts, store: undefined, task: 'TM-001', tmBin, env, workerState: undefined };
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
  const socket = join(opts.home, 'worker.sock'); await mkdir(opts.home, { recursive: true });
  await run('tmux', ['-S', socket, 'new-session', '-d', '-s', 'owned-worker', '-c', doc.worktree, 'sleep', '30']);
  t.after(() => run('tmux', ['-S', socket, 'kill-server'], { allowFailure: true }));
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
  // Keep the socket outside the Git fixture so teardown can always reach and stop only
  // these test-owned servers, even if the repository's earlier cleanup hook has run.
  const socketRoot = await mkdtemp(join(tmpdir(), 'ao-native-owner-'));
  const socket = join(socketRoot, 'native.sock'), decoySocket = join(socketRoot, 'decoy.sock');
  t.after(async () => {
    for (const path of [socket, decoySocket]) await run('tmux', ['-S', path, 'kill-server'], { allowFailure: true });
    await rm(socketRoot, { recursive: true, force: true });
  });
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
  assert.deepEqual({ ...recorded.merge, authorization: undefined }, { revision, landed: revision, checks: [], target_branch: 'main', authorization: undefined });
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
  assert.equal((await managementStatus(opts)).management.merge, undefined, 'nothing was recorded by a refusal');
});
