import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { promisify } from 'node:util';
import test from 'node:test';
import { durableTopologyRoot, preserveWorktreeWorkflows, publishACPWorkflow, readWorkflowIndex, reconcileWorkflows, topologyRunLocation, workflowRepository } from '../../topology/lib/discovery.mjs';
import { appendJournal, saveRun } from '../../topology/lib/mailbox.mjs';
import { assertAutomaticFallbackPolicy, launchRun, materializeWorkflowSpec, retryWorkflowSpec, runtimeGrantDirs, validateRuntimeCandidate, workerCandidateGuard } from '../../topology/lib/launch.mjs';
import { materializeSpec, validateSpec } from '../../topology/lib/spec.mjs';
import { normalizeAdapter } from '../../topology/lib/providers.mjs';
import { writeJson } from '../../topology/lib/util.mjs';
import { assertNativeRepository } from '../../topology/lib/workflow-control.mjs';

const execute = promisify(execFile);
async function fixture(t) {
  const dir = await mkdtemp(join(tmpdir(), 'ao-discovery-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const consumer = join(dir, 'repo'), worktree = join(dir, 'task'), stateHome = join(dir, 'state');
  await mkdir(consumer);
  const git = args => execute('git', ['-C', consumer, ...args], { env: { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1' } });
  await git(['init', '-q']);
  await git(['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '--allow-empty', '-qm', 'fixture']);
  await git(['worktree', 'add', '-qb', 'task-fixture', worktree]);
  return { dir, consumer, worktree, stateHome, git, repository: await workflowRepository(consumer) };
}
function native(consumer, runDir, extra = {}) {
  return { version: 1, run_id: 'fixture-run', name: 'tm-TM-123', consumer, run_dir: runDir, session: 'fixture-only',
    state: 'failed', created: '2026-09-22T00:00:00Z', agents: [], ...extra };
}

test('both runtimes share canonical discovery across worktrees without expanding write authority', async t => {
  const f = await fixture(t);
  const a = await topologyRunLocation({ consumer: f.worktree, nativeRunId: 'fixture-run', stateHome: f.stateHome });
  const b = await topologyRunLocation({ consumer: f.consumer, nativeRunId: 'fixture-run', stateHome: f.stateHome });
  assert.equal(a.runDir, b.runDir); assert.ok(!a.runDir.startsWith(f.worktree));
  await mkdir(a.runDir, { recursive: true });
  await saveRun(a.runDir, native(f.worktree, a.runDir, { repository: a.repository, state_home: f.stateHome, workload_cwd: f.worktree,
    write_authority: { mode: 'task', checkoutRoot: f.worktree, branch: 'task-fixture' } }));
  const snapshot = { schemaVersion: 1, runId: 'run_fixture', revision: 1, state: 'succeeded', createdAt: '2026-09-22T00:00:00Z', updatedAt: '2026-09-22T00:01:00Z',
    consumer: { commonGitDir: f.repository.id, checkoutRoot: f.worktree, requestedCwd: f.worktree }, input: { permissionProfile: 'read', protocolId: 'single.v1' } };
  const recordPath = join(f.stateHome, 'runs', snapshot.runId, 'snapshot.json');
  await writeJson(recordPath, snapshot);
  await publishACPWorkflow({ snapshot, recordPath, stateHome: f.stateHome });
  await writeJson(join(f.consumer, '.bytedesk', 'agent-orchestration', 'agents', 'lead', 'session.json'), { session: 'standing-lead' });
  const index = await reconcileWorkflows({ consumer: f.consumer, stateHome: f.stateHome });
  assert.equal(index.workflows.length, 2);
  assert.equal(index.repository.root, f.consumer);
  assert.equal(index.workflows.find(item => item.runtime === 'topology').writeAuthority.checkoutRoot, f.worktree);
  assert.equal(index.workflows.find(item => item.runtime === 'acp').writeAuthority.checkoutRoot, f.worktree);
  assert.equal(index.workflows.some(item => item.workflowName === 'standing-lead'), false);
});

test('terminal legacy worktree records preserve exact evidence and survive owned worktree removal', async t => {
  const f = await fixture(t), legacy = join(f.worktree, '.bytedesk', 'agent-orchestration', 'runs', 'fixture-run');
  const run = native(f.worktree, legacy);
  await writeJson(join(legacy, 'run.json'), run);
  await writeFile(join(legacy, 'journal.jsonl'), '{"type":"run.launch_failed"}\n');
  await mkdir(join(legacy, 'artifacts')); await writeFile(join(legacy, 'artifacts', 'evidence.txt'), 'preserve this failed launch\n');
  const original = await readFile(join(legacy, 'run.json'));
  const result = await preserveWorktreeWorkflows({ consumer: f.consumer, worktree: f.worktree, stateHome: f.stateHome });
  assert.equal(result.ok, true); assert.equal(result.records.length, 1);
  const durable = dirname(result.records[0].recordPath);
  assert.deepEqual(await readFile(join(durable, 'legacy-evidence', 'run.json')), original);
  assert.equal(await readFile(join(durable, 'legacy-evidence', 'artifacts', 'evidence.txt'), 'utf8'), 'preserve this failed launch\n');
  await f.git(['worktree', 'remove', '--force', f.worktree]);
  const index = await reconcileWorkflows({ consumer: f.consumer, stateHome: f.stateHome });
  assert.equal(index.workflows.length, 1); assert.equal(index.workflows[0].workloadCwd, f.worktree);
  assert.equal(index.workflows[0].recordPath, join(durable, 'run.json'));
  assert.equal(index.workflows[0].state, 'failed');
  assert.equal((await assertNativeRepository({ consumer: f.consumer, runDir: legacy, stateHome: f.stateHome })).runDir, durable);
});

test('active, corrupt and unregistered legacy records prevent cleanup', async t => {
  const f = await fixture(t), root = join(f.worktree, '.orchestration', 'runs');
  await writeJson(join(root, 'fixture-run', 'run.json'), native(f.worktree, join(root, 'fixture-run'), { state: 'running' }));
  await mkdir(join(root, 'bad'), { recursive: true }); await writeFile(join(root, 'bad', 'run.json'), '{broken');
  const result = await preserveWorktreeWorkflows({ consumer: f.consumer, worktree: f.worktree, stateHome: f.stateHome });
  assert.equal(result.ok, false);
  assert.deepEqual(result.rejected.map(item => item.code).sort(), ['TOPOLOGY_INVALID_JSON', 'TOPOLOGY_PRESERVATION_ACTIVE']);
  await assert.rejects(() => preserveWorktreeWorkflows({ consumer: f.consumer, worktree: f.dir, stateHome: f.stateHome }), { code: 'TOPOLOGY_WORKTREE_NOT_REGISTERED' });
});

test('corrupt and escaped records are isolated; removals update the index revision', async t => {
  const f = await fixture(t), root = durableTopologyRoot(f.repository, { stateHome: f.stateHome });
  const good = join(root, 'fixture-run'); await mkdir(good, { recursive: true });
  await saveRun(good, native(f.consumer, good, { repository: f.repository, state_home: f.stateHome }));
  await mkdir(join(root, 'broken')); await writeFile(join(root, 'broken', 'run.json'), '{');
  const foreign = join(f.dir, 'foreign.json'); await writeJson(foreign, native(f.consumer, join(root, 'escape'), { run_id: 'escape' }));
  await mkdir(join(root, 'escape')); await symlink(foreign, join(root, 'escape', 'run.json'));
  const first = await reconcileWorkflows({ consumer: f.consumer, stateHome: f.stateHome });
  assert.equal(first.workflows.length, 1); assert.equal(first.rejected.length, 2);
  await rm(good, { recursive: true });
  const second = await reconcileWorkflows({ consumer: f.consumer, stateHome: f.stateHome });
  assert.equal(second.workflows.length, 0); assert.ok(BigInt(second.revision) > BigInt(first.revision));
});

test('journal-only changes advance discovery while unchanged history retains its revision', async t => {
  const f = await fixture(t), location = await topologyRunLocation({ consumer: f.consumer, nativeRunId: 'fixture-run', stateHome: f.stateHome });
  await mkdir(location.runDir, { recursive: true });
  await saveRun(location.runDir, native(f.consumer, location.runDir, { repository: f.repository, state_home: f.stateHome }));
  const before = await reconcileWorkflows({ consumer: f.consumer, stateHome: f.stateHome });
  const same = await reconcileWorkflows({ consumer: f.consumer, stateHome: f.stateHome });
  assert.equal(same.revision, before.revision);
  await appendJournal(location.runDir, { type: 'message.acked', id: '001-review', agent: 'reviewer' });
  const after = await readWorkflowIndex({ consumer: f.consumer, stateHome: f.stateHome });
  assert.ok(BigInt(after.revision) > BigInt(before.revision));
});

test('admitted launch failure retains a durable record without changing workload cwd', async t => {
  const f = await fixture(t);
  const spec = materializeSpec(validateSpec({ name: 'failed-start', agents: [{ id: 'worker', role: 'orchestrator', cli: 'governed' }] }),
    { runId: 'fixture-run', consumer: f.worktree, home: f.dir, inputs: {} });
  const adapter = normalizeAdapter({ id: 'governed', requires_repository_readiness: true }, 'governed');
  await assert.rejects(() => launchRun({ spec, adapters: new Map([['governed', adapter]]), skillSearchDirs: [], roleSearchDirs: [], cliBin: '/fixture/ao-topology', stateHome: f.stateHome }),
    { code: 'TOPOLOGY_STARTUP_NOT_READY' });
  const index = await readWorkflowIndex({ consumer: f.consumer, stateHome: f.stateHome });
  assert.equal(index.workflows.length, 1); assert.equal(index.workflows[0].state, 'failed');
  assert.equal(index.workflows[0].workloadCwd, f.worktree);
  assert.equal(JSON.parse(await readFile(index.workflows[0].recordPath)).error.code, 'TOPOLOGY_STARTUP_NOT_READY');
});

test('task ownership hook is candidate-specific; unsupported fallback is held', () => {
  const guard = { task_id: 'TM-123', branch: 'task-fixture', hook: "/installed/TM's hooks/tm-hook.sh" };
  const claude = workerCandidateGuard(guard, { cli: 'claude' });
  assert.equal(claude.supported, true); assert.equal(claude.args[0], '--settings');
  assert.equal(JSON.parse(claude.args[1]).hooks.PreToolUse[0].hooks[0].command, "'/installed/TM'\\''s hooks/tm-hook.sh' pre-bash");
  assert.equal(workerCandidateGuard(guard, { cli: 'codex' }).supported, false);
  assert.equal(workerCandidateGuard(guard, { cli: 'grok-build' }).code, 'TOPOLOGY_WORKER_GUARD_UNSUPPORTED');
  assert.equal(workerCandidateGuard(null, { cli: 'codex' }).supported, true);
});

test('an uncertain guarded workflow prevents a second writer in the same task worktree', async t => {
  const f = await fixture(t), location = await topologyRunLocation({ consumer: f.worktree, nativeRunId: 'incumbent', stateHome: f.stateHome });
  await mkdir(location.runDir, { recursive: true });
  await saveRun(location.runDir, native(f.worktree, location.runDir, { run_id: 'incumbent', state: 'launch_failed', repository: f.repository,
    state_home: f.stateHome, write_authority: { worktree: f.worktree }, session_creation_attempted: true }));
  const spec = materializeSpec(validateSpec({ name: 'task-retry', worker_guard: { task_id: 'TM-123', branch: 'task-fixture', hook: '/fixture/hook' },
    agents: [{ id: 'worker', role: 'orchestrator', cli: 'claude' }] }), { runId: 'attempt-two', consumer: f.worktree, home: f.dir, inputs: {} });
  let failure;
  await assert.rejects(() => launchRun({ spec, adapters: new Map(), skillSearchDirs: [], roleSearchDirs: [], cliBin: '/fixture/ao', stateHome: f.stateHome }),
    error => { failure = error; return error.code === 'TOPOLOGY_WORKTREE_WRITER_CONFLICT'; });
  assert.equal(failure.details.retry_safe, false);
  assert.equal(failure.details.workflow_id, 'topology:incumbent');
  assert.equal(JSON.parse(await readFile(join(location.runDir, 'run.json'))).state, 'launch_failed');
});

test('runtime grants name only the current member and shared artifacts and reject redirected recorded paths', async t => {
  const f = await fixture(t), { runDir } = await topologyRunLocation({ consumer: f.consumer, nativeRunId: 'grant-fixture', stateHome: f.stateHome });
  const runtimeDirs = runtimeGrantDirs({ runDir, agentId: 'worker' });
  assert.deepEqual(runtimeDirs, [join(runDir, 'agents', 'worker'), join(runDir, 'artifacts')]);
  assert.ok(!runtimeDirs.includes(f.stateHome) && !runtimeDirs.includes(runDir) && !runtimeDirs.includes(join(runDir, 'agents')));
  for (const artifactsDir of ['.', '../../outside', 'agents/other']) assert.throws(() => runtimeGrantDirs({ runDir, agentId: 'worker', artifactsDir }), { code: 'TOPOLOGY_RUNTIME_GRANT' });
  await Promise.all(runtimeDirs.map(dir => mkdir(dir, { recursive: true })));
  const candidate = { launcher: join(runtimeDirs[0], 'launch-0.sh'), runtime_dirs: runtimeDirs };
  await writeFile(candidate.launcher, '#!/bin/sh\nexit 0\n');
  const validate = value => validateRuntimeCandidate({ runDir, agentId: 'worker', candidate: value, index: 0 });
  assert.deepEqual(await validate(candidate), runtimeDirs);
  await assert.rejects(() => validate({ ...candidate, launcher: join(f.dir, 'outside.sh') }), { code: 'TOPOLOGY_RUNTIME_GRANT' });
  await assert.rejects(() => validate({ ...candidate, runtime_dirs: [f.stateHome] }), { code: 'TOPOLOGY_RUNTIME_GRANT' });
  await rm(runtimeDirs[1], { recursive: true });
  await symlink(f.worktree, runtimeDirs[1]);
  await assert.rejects(() => validate(candidate), { code: 'TOPOLOGY_RUNTIME_GRANT' });
});

test('automatic fallback is restricted to the explicit ordered provider chain', () => {
  const config = { failover: { consent: 'auto', approved_providers: ['claude', 'codex'] } };
  assert.doesNotThrow(() => assertAutomaticFallbackPolicy(config, [{ cli: 'claude' }, { cli: 'codex' }]));
  for (const chain of [[{ cli: 'claude' }, { cli: 'grok-build' }], [{ cli: 'codex' }, { cli: 'claude' }]]) {
    assert.throws(() => assertAutomaticFallbackPolicy(config, chain), { code: 'TOPOLOGY_FALLBACK_NOT_APPROVED' });
  }
  assert.throws(() => assertAutomaticFallbackPolicy({ failover: { consent: 'auto' } }, [{ cli: 'claude' }]), { code: 'TOPOLOGY_FALLBACK_NOT_APPROVED' });
  assert.doesNotThrow(() => assertAutomaticFallbackPolicy({ failover: { consent: 'ask' } }, [{ cli: 'codex' }]));
});

test('terminal durable records cannot authorize cleanup while their exact session remains', async t => {
  const f = await fixture(t), { runDir } = await topologyRunLocation({ consumer: f.worktree, nativeRunId: 'fixture-run', stateHome: f.stateHome });
  await mkdir(runDir, { recursive: true });
  const binding = { serverKey: '/fixture/owned.sock', serverPid: 123, sessionId: '$2', sessionCreated: 1780000000, paneId: '%3', panePid: 456 };
  await saveRun(runDir, native(f.worktree, runDir, { state: 'stopped', repository: f.repository, state_home: f.stateHome,
    agents: [{ id: 'worker', pane: binding.paneId, binding }] }));
  const inspect = panes => preserveWorktreeWorkflows({ consumer: f.consumer, worktree: f.worktree, stateHome: f.stateHome, tmuxApi: { listServerPanes: async () => panes } });
  const held = await inspect([binding]);
  assert.equal(held.ok, false); assert.equal(held.rejected[0].code, 'TOPOLOGY_PRESERVATION_ACTIVE');
  assert.equal((await inspect([])).ok, true);
});

test('a second authentic native record cannot silently replace a durable workflow with the same run ID', async t => {
  const f = await fixture(t), { runDir } = await topologyRunLocation({ consumer: f.consumer, nativeRunId: 'fixture-run', stateHome: f.stateHome });
  await mkdir(runDir, { recursive: true });
  await saveRun(runDir, native(f.consumer, runDir, { repository: f.repository, state_home: f.stateHome }));
  const legacy = join(f.worktree, '.bytedesk', 'agent-orchestration', 'runs', 'fixture-run');
  await writeJson(join(legacy, 'run.json'), native(f.worktree, legacy, { name: 'different-workflow' }));
  const index = await reconcileWorkflows({ consumer: f.consumer, stateHome: f.stateHome });
  assert.equal(index.workflows.length, 1); assert.equal(index.workflows[0].recordPath, join(runDir, 'run.json'));
  assert.equal(index.rejected[0].code, 'TOPOLOGY_DISCOVERY_DUPLICATE');
});

test('launch and retry render retained templates against their own durable attempt without rewriting literal prose', async t => {
  const f = await fixture(t), literal = join(f.worktree, '.bytedesk', 'agent-orchestration', 'runs', 'first');
  await writeFile(join(f.worktree, 'instructions.md'), 'Original source {{run_id}} writes {{run_dir}}/artifacts/report.md');
  const raw = validateSpec({ name: 'recipe', write_authority: { worktree: f.worktree, branch: 'task-fixture' },
    agents: [{ id: 'worker', role: 'orchestrator', cli: 'claude', args: ['--fixture-output', '{{run_dir}}/artifacts'],
      instructions: `Current {{run_dir}}; historical literal ${literal}`, instructions_file: 'instructions.md', env: { FIXTURE_RUN: '{{run_dir}}' } }] });
  const first = await materializeWorkflowSpec(raw, { runId: 'first', consumer: f.worktree, home: f.dir, inputs: {} }, { stateHome: f.stateHome });
  assert.equal(first.run_dir, (await topologyRunLocation({ consumer: f.worktree, nativeRunId: 'first', stateHome: f.stateHome })).runDir);
  assert.equal(first.agents[0]._prompt_vars.run_dir, first.run_dir);
  assert.ok(first.agents[0].instructions.includes(`Current ${first.run_dir}; historical literal ${literal}`));
  const preview = await launchRun({ spec: first, adapters: new Map([['claude', normalizeAdapter({ id: 'claude', command: 'echo' }, 'claude')]]),
    skillSearchDirs: [], roleSearchDirs: [], cliBin: '/fixture/ao', dryRun: true, stateHome: f.stateHome });
  assert.ok(preview.agents[0].candidates[0].command.includes(`${first.run_dir}/artifacts`));
  await writeFile(join(f.worktree, 'instructions.md'), 'Changed source that must not alter the saved retry task.');
  const original = { ...native(f.worktree, first.run_dir), run_id: 'first', name: 'recipe', workload_cwd: first.cwd,
    state_home: f.stateHome, agents: first.agents, launch_spec: first, render_recipe: first.render_recipe, write_authority: first.write_authority };
  const retry = await retryWorkflowSpec(original, { runId: 'second', stateHome: f.stateHome, actor: { id: 'operator' } });
  assert.notEqual(retry.run_dir, first.run_dir); assert.equal(retry.retry_of, 'first');
  assert.equal(retry.cwd, first.cwd); assert.deepEqual(retry.write_authority, first.write_authority);
  assert.equal(retry.agents[0].env.FIXTURE_RUN, retry.run_dir);
  assert.ok(retry.agents[0].instructions.includes(`Original source second writes ${retry.run_dir}/artifacts/report.md`));
  assert.ok(retry.agents[0].instructions.includes(`historical literal ${literal}`));
  assert.ok(!retry.agents[0].instructions.includes('Changed source'));
  await assert.rejects(() => retryWorkflowSpec({ ...original, render_recipe: null, launch_spec: {} }, { runId: 'third', stateHome: f.stateHome }), { code: 'TOPOLOGY_RETRY_UNAVAILABLE' });
});
