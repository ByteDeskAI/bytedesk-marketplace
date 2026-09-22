import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, mkdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import test from 'node:test';
import { assertNativeRepository, assertRunOwnership, controlWorkflow, observeNativeWorkflow, stopNativeRun, workflowDetail } from '../../topology/lib/workflow-control.mjs';
import { readWorkflowIndex, topologyRunLocation, workflowRepository } from '../../topology/lib/discovery.mjs';
import { loadRun, saveRun } from '../../topology/lib/mailbox.mjs';
import { writeJson } from '../../topology/lib/util.mjs';
import * as tmux from '../../topology/lib/tmux.mjs';

const execute = promisify(execFile);
const binding = { serverKey: '/fixture/tmux.sock', serverPid: 100, sessionId: '$1', sessionCreated: 1234567890, paneId: '%2', panePid: 200, sessionName: 'same-name', alive: true };
async function fixture(t, extra = {}) {
  const dir = await mkdtemp(join(tmpdir(), 'ao-control-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const consumer = join(dir, 'repo'), stateHome = join(dir, 'state'); await mkdir(consumer);
  const location = await topologyRunLocation({ consumer, nativeRunId: 'parent', stateHome });
  await mkdir(location.runDir, { recursive: true });
  const run = { version: 1, run_id: 'parent', name: 'named-workflow', consumer, run_dir: location.runDir, workload_cwd: consumer,
    repository: await workflowRepository(consumer), state_home: stateHome, created: '2026-09-22T00:00:00Z', state: 'running',
    session: 'same-name', agents: [{ id: 'worker', pane: '%2', binding: { ...binding }, role: 'orchestrator' }], ...extra };
  await saveRun(location.runDir, run);
  return { dir, consumer, stateHome, runDir: location.runDir, run };
}
function fakeTmux(initial, { failKill = false, replacement = false } = {}) {
  let panes = initial.map(pane => ({ ...pane })); const calls = [];
  return { calls, listServerPanes: async options => { calls.push({ operation: 'observe', ...options }); return panes.map(pane => ({ ...pane })); },
    tmux: async (args, options) => {
      calls.push({ operation: 'kill', args, options });
      if (failKill) throw Object.assign(new Error('fixture stop failure'), { code: 'TOPOLOGY_TMUX_FAILED' });
      if (replacement) panes = panes.map(pane => ({ ...pane, panePid: pane.panePid + 1 }));
      else panes = [];
      return { code: 0, stdout: '', stderr: '' };
    } };
}

test('stop confirms exact termination on the recorded server and retains evidence', async t => {
  const f = await fixture(t), tmuxApi = fakeTmux([binding]);
  const result = await stopNativeRun({ runDir: f.runDir, tmuxApi, actor: { id: 'gateway-user' } });
  assert.equal(result.ok, true); assert.equal(result.files_kept, true);
  const kill = tmuxApi.calls.find(call => call.operation === 'kill');
  assert.equal(kill.options.tmuxServer, binding.serverKey);
  assert.deepEqual(kill.args.slice(0, 4), ['if-shell', '-F', '-t', '%2']);
  assert.equal(kill.args[5], 'kill-pane -t %2');
  assert.equal((await loadRun(f.runDir)).state, 'stopped');
  assert.ok((await readFile(join(f.runDir, 'journal.jsonl'), 'utf8')).includes('gateway-user'));
});

for (const [name, replacement] of [['session name reuse', { sessionId: '$9' }], ['wrong pane process', { panePid: 999 }], ['wrong server incarnation', { serverPid: 999 }]]) {
  test(`${name} refuses native stop without controlling any pane`, async t => {
    const f = await fixture(t), tmuxApi = fakeTmux([{ ...binding, ...replacement }]);
    const result = await stopNativeRun({ runDir: f.runDir, tmuxApi });
    assert.equal(result.ok, false); assert.equal(result.failures[0].code, 'TOPOLOGY_SESSION_OWNERSHIP');
    assert.equal(tmuxApi.calls.some(call => call.operation === 'kill'), false);
    assert.equal((await loadRun(f.runDir)).state, 'stop_failed');
  });
}

test('unowned pane and missing binding refuse control; a replacement during stop stays visible', async t => {
  const f = await fixture(t);
  await assert.rejects(() => assertRunOwnership(f.run, { tmuxApi: fakeTmux([binding, { ...binding, paneId: '%5', panePid: 900 }]) }), { code: 'TOPOLOGY_SESSION_OWNERSHIP' });
  await assert.rejects(() => assertRunOwnership({ ...f.run, agents: [{ id: 'worker', pane: '%2' }] }, { tmuxApi: fakeTmux([binding]) }), { code: 'TOPOLOGY_SESSION_OWNERSHIP' });
  await assert.rejects(() => assertRunOwnership({ ...f.run, agents: [], session_creation_attempted: true }, { requireAlive: false, tmuxApi: fakeTmux([]) }), { code: 'TOPOLOGY_SESSION_OWNERSHIP' });
  const result = await stopNativeRun({ runDir: f.runDir, tmuxApi: fakeTmux([binding], { replacement: true }) });
  assert.equal(result.ok, false); assert.equal(result.failures[0].code, 'TOPOLOGY_STOP_OWNERSHIP_CHANGED');
});

test('partial stop failures remain failures and cannot declare the run stopped', async t => {
  const f = await fixture(t), result = await stopNativeRun({ runDir: f.runDir, tmuxApi: fakeTmux([binding], { failKill: true }) });
  assert.equal(result.ok, false); assert.equal(result.failures.length, 2);
  assert.equal((await loadRun(f.runDir)).state, 'stop_failed');
});

test('consumer-bound inspection rejects a native record from another repository', async t => {
  const f = await fixture(t), foreign = join(f.dir, 'foreign'); await mkdir(foreign);
  await assert.rejects(() => assertNativeRepository({ consumer: foreign, runDir: f.runDir, stateHome: f.stateHome }), { code: 'TOPOLOGY_DISCOVERY_REPOSITORY' });
});

test('a child cannot redirect cascade control across repository boundaries', async t => {
  const f = await fixture(t, { agents: [] }), other = join(f.dir, 'other'); await mkdir(other);
  const childDir = join(f.dir, 'child');
  await writeJson(join(childDir, 'run.json'), { ...f.run, run_id: 'child', consumer: other, repository: await workflowRepository(other), parent: { run_id: 'parent' }, run_dir: childDir });
  await writeJson(join(f.runDir, 'children.json'), [{ run_dir: childDir }]);
  const tmuxApi = fakeTmux([binding]), result = await stopNativeRun({ runDir: f.runDir, tmuxApi });
  assert.equal(result.ok, false); assert.equal(result.failures[0].code, 'TOPOLOGY_DISCOVERY_REPOSITORY');
  assert.equal(tmuxApi.calls.some(call => call.operation === 'kill'), false);
});

test('human review is idempotent, revision-bound and never bypasses independent integration', async t => {
  const f = await fixture(t, { agents: [], state: 'running', launch_spec: { secret: 'must-not-be-returned' } });
  const index = await readWorkflowIndex({ consumer: f.consumer, stateHome: f.stateHome });
  const request = { schemaVersion: 1, action: 'review', workflowId: 'topology:parent', actor: { id: 'reviewing-user', sessionId: 'gw-1' },
    idempotencyKey: 'one-decision', expectedRevision: index.workflows[0].revision, payload: { decision: 'approve', revision: 'a'.repeat(40), note: 'Human review only.' } };
  const first = await controlWorkflow({ consumer: f.consumer, stateHome: f.stateHome, request });
  const second = await controlWorkflow({ consumer: f.consumer, stateHome: f.stateHome, request });
  assert.equal(first.ok, true); assert.deepEqual(second, first);
  assert.equal(first.result.independentReviewRequired, true); assert.equal(first.result.integrationAuthorized, false);
  assert.equal((await loadRun(f.runDir)).human_decisions.length, 1); assert.equal((await loadRun(f.runDir)).state, 'running');
  await assert.rejects(() => controlWorkflow({ consumer: f.consumer, stateHome: f.stateHome, request: { ...request, payload: { ...request.payload, note: 'changed' } } }), { code: 'TOPOLOGY_CONTROL_CONFLICT' });
  await assert.rejects(() => controlWorkflow({ consumer: f.consumer, stateHome: f.stateHome, request: { ...request, idempotencyKey: 'stale' } }), { code: 'TOPOLOGY_CONTROL_REVISION' });
  const detail = await workflowDetail({ consumer: f.consumer, workflowId: 'topology:parent', stateHome: f.stateHome });
  assert.equal(JSON.stringify(detail).includes('must-not-be-returned'), false);
  assert.equal(detail.run.human_decisions.length, 1);
  assert.equal(detail.inspection.sessionAlive, false);
});

test('retry creates a linked attempt and preserves the admitted workload and authority', async t => {
  const f = await fixture(t, { agents: [], state: 'stopped', write_authority: { checkoutRoot: '/exact/worktree', branch: 'task-branch' }, launch_spec: { preserved: true }, render_recipe: { schemaVersion: 1 } });
  let calls = 0;
  const request = { schemaVersion: 1, action: 'retry', workflowId: 'topology:parent', actor: { id: 'operator' }, idempotencyKey: 'retry-once', payload: {} };
  const launch = async ({ runId, retry }) => {
    calls++; assert.equal(retry.workload_cwd, f.consumer); assert.deepEqual(retry.write_authority, f.run.write_authority);
    const location = await topologyRunLocation({ consumer: f.consumer, nativeRunId: runId, stateHome: f.stateHome }); await mkdir(location.runDir, { recursive: true });
    await saveRun(location.runDir, { ...retry, run_id: runId, retry_of: retry.run_id, run_dir: location.runDir, state: 'running' });
    return { runDir: location.runDir, state: 'running' };
  };
  const result = await controlWorkflow({ consumer: f.consumer, stateHome: f.stateHome, request, launch });
  assert.equal(result.ok, true); assert.notEqual(result.workflowId, 'topology:parent');
  await controlWorkflow({ consumer: f.consumer, stateHome: f.stateHome, request, launch }); assert.equal(calls, 1);
  const index = await readWorkflowIndex({ consumer: f.consumer, stateHome: f.stateHome });
  assert.equal(index.workflows.find(item => item.workflowId === result.workflowId).lineage.retryOfWorkflowId, 'topology:parent');
});

test('legacy attempts without an original template hold retry before any new launch', async t => {
  const f = await fixture(t, { agents: [], state: 'stopped', launch_spec: { already_rendered: true } });
  const result = await controlWorkflow({ consumer: f.consumer, stateHome: f.stateHome,
    request: { schemaVersion: 1, action: 'retry', workflowId: 'topology:parent', actor: { id: 'operator' }, idempotencyKey: 'legacy-retry', payload: {} },
    launch: () => assert.fail('legacy recipe must hold before launch') });
  assert.equal(result.ok, false); assert.equal(result.code, 'TOPOLOGY_RETRY_UNAVAILABLE');
});

test('native writer observation proves all exact members absent or dead and fences record changes', async t => {
  const f = await fixture(t, { task_id: 'TM-123' });
  const inspect = tmuxApi => observeNativeWorkflow({ consumer: f.consumer, runDir: f.runDir, nativeRunId: 'parent', taskId: 'TM-123', workloadCwd: f.consumer, stateHome: f.stateHome, tmuxApi });
  const live = await inspect(fakeTmux([binding]));
  const dead = await inspect(fakeTmux([{ ...binding, alive: false }]));
  assert.equal(live.hasLiveWriters, true); assert.equal(dead.hasLiveWriters, false);
  assert.equal(live.fingerprint, dead.fingerprint);
  await assert.rejects(() => observeNativeWorkflow({ consumer: f.consumer, runDir: f.runDir, nativeRunId: 'parent', taskId: 'TM-999', stateHome: f.stateHome, tmuxApi: fakeTmux([]) }), { code: 'TOPOLOGY_TASK_OWNERSHIP' });
  await assert.rejects(() => inspect({ listServerPanes: async () => {
    const run = await loadRun(f.runDir); run.sequence = 1; await saveRun(f.runDir, run); return [];
  } }), { code: 'TOPOLOGY_OBSERVATION_CHANGED' });
  const run = await loadRun(f.runDir); run.state = 'launching'; await saveRun(f.runDir, run);
  await assert.rejects(() => inspect(fakeTmux([])), { code: 'TOPOLOGY_WRITER_PENDING' });
});

test('native writer observation includes child writers and holds missing virtual participants', async t => {
  const f = await fixture(t, { task_id: 'TM-123' });
  const child = await topologyRunLocation({ consumer: f.consumer, nativeRunId: 'child', stateHome: f.stateHome });
  await mkdir(child.runDir, { recursive: true });
  const childBinding = { ...binding, sessionId: '$3', paneId: '%4', panePid: 400 };
  await saveRun(child.runDir, { ...f.run, run_id: 'child', name: 'review-team', task_id: null, run_dir: child.runDir, session: 'child-session',
    parent: { run_id: 'parent', agent_id: 'reviewers' }, agents: [{ id: 'reviewer', pane: '%4', binding: childBinding }] });
  const run = await loadRun(f.runDir);
  run.agents.push({ id: 'reviewers', pane: null, workflow: { run_dir: child.runDir } });
  await saveRun(f.runDir, run); await writeJson(join(f.runDir, 'children.json'), [{ run_dir: child.runDir, agent_id: 'reviewers' }]);
  const inspect = childAlive => observeNativeWorkflow({ consumer: f.consumer, runDir: f.runDir, nativeRunId: 'parent', taskId: 'TM-123', workloadCwd: f.consumer, stateHome: f.stateHome,
    tmuxApi: { listServerPanes: async ({ session }) => session === 'same-name' ? [{ ...binding, alive: false }] : [{ ...childBinding, alive: childAlive }] } });
  const active = await inspect(true), finished = await inspect(false);
  assert.equal(active.hasLiveWriters, true); assert.equal(finished.hasLiveWriters, false); assert.equal(active.fingerprint, finished.fingerprint);
  assert.equal(finished.children[0].workloadCwd, f.consumer); assert.equal(finished.children[0].parentAgentId, 'reviewers');
  assert.equal(finished.agents.find(agent => agent.id === 'reviewers').binding, null);
  run.agents.find(agent => agent.id === 'reviewers').workflow.run_dir = null; await saveRun(f.runDir, run);
  await assert.rejects(() => inspect(false), { code: 'TOPOLOGY_WRITER_PENDING' });
});

test('real isolated tmux stop addresses the recorded server and leaves a same-named peer intact', async t => {
  if (!(await execute('tmux', ['-V']).catch(() => null))) return t.skip('tmux is unavailable');
  const cleanup = [], f = await fixture({ after: fn => cleanup.push(fn) }), ownedSocket = join(f.dir, 'a.sock'), peerSocket = join(f.dir, 'b.sock');
  t.after(async () => {
    for (const socket of [ownedSocket, peerSocket]) await execute('tmux', ['-S', socket, 'kill-server']).catch(() => {});
    for (const dispose of cleanup) await dispose();
  });
  for (const socket of [ownedSocket, peerSocket]) await execute('tmux', ['-S', socket, '-f', '/dev/null', 'new-session', '-d', '-s', 'same-name', 'sleep', '300']);
  const [observed] = await tmux.listServerPanes({ tmuxServer: ownedSocket, session: 'same-name' });
  f.run.agents[0].pane = observed.paneId; f.run.agents[0].binding = observed; await saveRun(f.runDir, f.run);
  const result = await stopNativeRun({ runDir: f.runDir });
  assert.equal(result.ok, true);
  assert.equal((await tmux.listServerPanes({ tmuxServer: ownedSocket, session: 'same-name' })).length, 0);
  assert.equal((await tmux.listServerPanes({ tmuxServer: peerSocket, session: 'same-name' })).length, 1);
});
