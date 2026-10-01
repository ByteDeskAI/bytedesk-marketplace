import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { startGoalLoop, showGoalLoop, reportGoalLoop, reconcileGoalLoop, reconcileGoalLoops, controlGoalLoop, goalLoopSummary } from '../../topology/lib/goal-loop.mjs';
import { repoKey } from '../../topology/lib/repoid.mjs';
import { writeJson, run } from '../../topology/lib/util.mjs';

const sha = 'a'.repeat(40), landed = 'b'.repeat(40);
async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'ao-goal-loop-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const consumer = join(root, 'repo'); await mkdir(consumer); await writeFile(join(consumer, 'proof.json'), '{"observed":"test"}');
  await writeFile(join(consumer, 'deploy.json'), '{}'); await writeFile(join(consumer, 'dogfood.json'), JSON.stringify({ criteria: [{ evidence: ['proof.json'] }] }));
  const goal = { schemaVersion: 1, status: 'active', revision: 1, scopeHash: 'scope-1', criteria: [{ id: 'AC-001', text: 'User can finish the goal' }],
    original: { revision: 1, scopeHash: 'scope-1', objective: 'Fix the user journey', criteria: [{ id: 'AC-001', text: 'User can finish the goal' }] },
    authority: { reviewedMerge: true, testTarget: 'approved-test', publicRelease: 'human', destructive: 'human' }, limits: { maxStalls: 3, maxCycles: 10, deadlineMinutes: 30 } };
  const state = { time: Date.parse('2026-10-01T12:00:00Z'), goal, sends: [], messages: new Map(), calls: [], writes: new Map(), writer: { resolved: true }, publishFails: false, activations: 0, activationReady: true, verification: { completionReady: false } };
  const options = { consumer, home: join(root, 'home'), env: { AO_TRANSPORT: 'file', AGENT_ORCHESTRATION_STATE_HOME: join(root, 'state') },
    now: () => state.time, enrollment: async () => ({ enrolled: true, source: 'repo-config' }),
    activate: async () => { state.activations++; return { supervision: { ready: state.activationReady, state: state.activationReady ? 'running' : 'died-before-first-tick' } }; },
    notify: async () => ({ state: 'sent' }),
    config: { goal_loop: { deploymentRecipes: [{ id: 'test', version: '1', repositoryId: consumer, target: 'approved-test', command: '/usr/bin/test-deployer', args: ['--revision', '{artifact}'] }] } },
    tm: async (args, input) => {
      state.calls.push({ args, input });
      if (args[0] === 'show') return { id: args[1], epic: 'EP-001', status: 'done' };
      if (args[0] === 'find') return [];
      if (args[1] === 'show') return { ok: true, goal: structuredClone(state.goal), verification: structuredClone(state.verification) };
      const key = input.idempotencyKey, fingerprint = JSON.stringify(input);
      if (state.writes.has(key)) { assert.equal(state.writes.get(key), fingerprint); return { ok: true, goal: structuredClone(state.goal) }; }
      state.writes.set(key, fingerprint);
      if (args[1] === 'assess') { state.goal.latestAssessmentId = 'GA-001'; state.goal.assessments = [{ id: 'GA-001', ...structuredClone(input) }]; state.verification = { completionReady: !state.blockCompletion && input.criteria.every(c => c.verdict === 'proven'), completionReason: state.blockCompletion ? 'Blocking finding remains' : null }; }
      if (args[1] === 'complete') { if (state.failComplete) throw new Error('missing criterion evidence'); state.goal.status = 'proven'; }
      return { ok: true, goal: structuredClone(state.goal) };
    },
    send: async (input, passed) => { assert.equal(passed.env.AO_NATS_AUTOSTART, '0'); state.sends.push(input); const record = { status: 'delivered', envelope: input }; state.messages.set(input.id, record); return record; },
    readMessage: async ({ id }) => state.messages.get(id) ?? null,
    verifyPhase: async () => {}, authenticateReport: async (loop, report) => assert.equal(report.actor.id, loop.leadId),
    writersResolved: async () => state.writer,
    publish: async () => { if (state.publishFails) throw new Error('index down'); },
  };
  const request = { idempotencyKey: 'start-1', actor: { id: 'operator' }, goalRevision: 1, scopeHash: 'scope-1', leadId: 'lead-1', deploymentRecipeId: 'test' };
  const start = async () => startGoalLoop({ ...options, goalId: 'EP-001', request });
  return { root, state, options, request, start };
}
function output(loop, overrides = {}) {
  const details = {
    pm: { plan: 'proof.json', criterionIds: ['AC-001'] }, build: { implementerId: 'builder-1', taskArtifacts: { 'TM-001': { sourceRevision: sha } } },
    qa: { evaluator: { id: 'qa-1', role: 'validation', independentOf: ['builder-1'] }, evaluation: { taskId: 'TM-002', runId: 'eval-1', evidence: 'proof.json' }, verdict: 'satisfied' },
    'integration-qa': { evaluator: { id: 'qa-1', role: 'validation', independentOf: ['builder-1'] }, evaluation: { taskId: 'TM-002', runId: 'eval-2', evidence: 'proof.json' }, verdict: 'satisfied' },
    review: { evaluator: { id: 'reviewer-1', role: 'reviewer', independentOf: ['builder-1'] }, verdict: 'satisfied' },
    integration: { landingReceipt: 'proof.json', landedArtifact: landed, taskArtifacts: { 'TM-001': { sourceRevision: sha, landedRevision: landed } } },
    'test-deploy': { deployment: 'deploy.json', recipeHash: loop.deploymentRecipeHash, environment: 'approved-test' },
    dogfood: { source: 'dogfood.json', evaluator: { id: 'qa-1', role: 'dogfood', independentOf: ['builder-1'] }, evaluation: { taskId: 'TM-002', runId: 'eval-3', evidence: 'dogfood.json' }, environment: 'approved-test', persona: 'user' },
    assessment: { assessment: { revision: 1, scopeHash: 'scope-1', artifact: landed, environment: 'approved-test', persona: 'user',
      evaluator: { id: 'qa-1', role: 'dogfood', independentOf: ['builder-1'] }, implementerId: 'builder-1', source: 'dogfood.json', deployment: 'deploy.json', criteria: [{ id: 'AC-001', verdict: 'proven', evidence: ['proof.json'] }] }, nextCycleProposal: 'A separate accessibility improvement' },
  }[loop.phase];
  return { idempotencyKey: `result-${loop.attempt}-${loop.phase}`, actor: { id: 'lead-1' }, obligationId: loop.obligation.id, attempt: loop.attempt,
    phase: loop.phase, goalRevision: loop.goalRevision, scopeHash: loop.scopeHash, status: 'succeeded', artifact: loop.phase === 'build' ? sha : loop.artifact,
    taskIds: ['TM-001'], evidence: ['proof.json'], details, ...overrides };
}
async function report(f, loop, overrides) { return reportGoalLoop({ ...f.options, loopId: loop.loopId, report: output(loop, overrides) }); }

test('persisted controller drives every phase and public TM completion, then proposes without starting another cycle', async t => {
  const f = await fixture(t); let loop = await f.start();
  const phases = [];
  while (loop.state !== 'proven') { phases.push(loop.phase); loop = await report(f, loop); assert.ok(phases.length <= 9); }
  assert.deepEqual(phases, ['pm', 'build', 'qa', 'review', 'integration', 'integration-qa', 'test-deploy', 'dogfood', 'assessment']);
  assert.equal(f.state.sends.length, 9); assert.equal(loop.cycle, 1); assert.equal(loop.artifact, landed);
  assert.equal(loop.nextCycleProposal, 'A separate accessibility improvement');
  assert.equal(f.state.calls.filter(c => c.args[1] === 'complete').length, 1);
  const summary = goalLoopSummary(loop); assert.equal(summary.criteria[0].status, 'proven'); assert.equal(summary.artifact.sourceRevision, sha);
  assert.ok(!JSON.stringify(summary).includes('/usr/bin/test-deployer')); assert.ok(!JSON.stringify(summary).includes('Report template'));
  const count = f.state.sends.length; await reconcileGoalLoop({ ...f.options, loopId: loop.loopId }); assert.equal(f.state.sends.length, count);
});
test('start and report retries are idempotent and changed payload reuse is rejected', async t => {
  const f = await fixture(t), loop = await f.start();
  assert.equal((await f.start()).loopId, loop.loopId); assert.equal(f.state.sends.length, 1);
  const input = output(loop); const next = await reportGoalLoop({ ...f.options, loopId: loop.loopId, report: input });
  assert.equal((await reportGoalLoop({ ...f.options, loopId: loop.loopId, report: input })).phase, 'build');
  assert.equal(f.state.sends.length, 2);
  await assert.rejects(reportGoalLoop({ ...f.options, loopId: loop.loopId, report: { ...input, evidence: ['different'] } }), /reused/);
  await assert.rejects(startGoalLoop({ ...f.options, goalId: 'EP-001', request: { ...f.request, leadId: 'other' } }), /reused/);
  assert.equal(next.phase, 'build');
});
test('a restart recovers a persisted report before phase advancement without a second obligation', async t => {
  const f = await fixture(t), loop = await f.start();
  const path = loop.recordPath, record = JSON.parse(await readFile(path, 'utf8'));
  record.reports.push({ input: output(loop), fingerprint: 'persisted', evidence: [], at: '2026-10-01T12:01:00Z', applied: false });
  await writeFile(path, JSON.stringify(record));
  const next = await reconcileGoalLoop({ ...f.options, loopId: loop.loopId }); assert.equal(next.phase, 'build');
  await reconcileGoalLoop({ ...f.options, loopId: loop.loopId }); assert.equal(f.state.sends.length, 2);
});
test('crash after durable mail publication recovers by obligation ID; transport acceptance never advances a phase', async t => {
  const f = await fixture(t); const send = f.options.send; let crash = true;
  f.options.send = async (...args) => { const result = await send(...args); if (crash) { crash = false; throw new Error('lost client reply'); } return result; };
  let loop = await f.start(); assert.equal(loop.state, 'blocked');
  loop = await reconcileGoalLoop({ ...f.options, loopId: loop.loopId });
  // Delivery-error retries must re-inspect their durable mailbox record.
  assert.equal(loop.phase, 'pm'); assert.equal(loop.state, 'running'); assert.equal(f.state.sends.length, 1);
});
test('wrong goal, phase, artifact, evaluator and foreign task reports cannot advance', async t => {
  const f = await fixture(t); let loop = await f.start();
  await assert.rejects(report(f, loop, { goalRevision: 2 }), /goal revision/);
  await assert.rejects(report(f, loop, { attempt: 2 }), /another phase/);
  const tm = f.options.tm; f.options.tm = async (args, input) => args[0] === 'show' ? { id: args[1], epic: 'EP-OTHER' } : tm(args, input);
  await assert.rejects(report(f, loop), /does not belong/); f.options.tm = tm;
  loop = await report(f, loop); loop = await report(f, loop);
  await assert.rejects(report(f, loop, { artifact: landed }), /exact current artifact/);
  await assert.rejects(report(f, loop, { details: { evaluator: { id: 'builder-1', independentOf: ['builder-1'] } } }), /independent/);
});
test('phase deadline persists human-required reason and retry refuses live or uncertain writers', async t => {
  const f = await fixture(t); let loop = await f.start(); f.state.time += 30 * 60_000;
  loop = await reconcileGoalLoop({ ...f.options, loopId: loop.loopId });
  assert.equal(loop.state, 'human_required'); assert.equal(loop.diagnostic.code, 'GOAL_LOOP_DEADLINE');
  f.state.writer = { resolved: false, reason: 'Unknown writer incarnation' };
  const request = { action: 'retry', idempotencyKey: 'retry', actor: { id: 'operator' }, expectedRevision: loop.revision, reason: 'Inspected old attempt' };
  await assert.rejects(controlGoalLoop({ ...f.options, loopId: loop.loopId, request }), /existing writer/);
  f.state.writer = { resolved: true }; loop = await controlGoalLoop({ ...f.options, loopId: loop.loopId, request });
  assert.equal(loop.attempt, 2); assert.equal(loop.phase, 'pm'); assert.equal(loop.state, 'running');
});
test('three failed no-progress cycles stop persistently; actor label cannot grant human authority', async t => {
  const f = await fixture(t); let loop = await f.start();
  for (let i = 0; i < 3; i++) loop = await report(f, loop, { status: 'failed', details: { reason: 'Criterion still broken' } });
  assert.equal(loop.state, 'human_required'); assert.equal(loop.stalls, 3); assert.equal(loop.cycle, 3);
  assert.equal((await reconcileGoalLoops(f.options))[0].changed, false);
  await assert.rejects(controlGoalLoop({ ...f.options, env: { ...f.options.env, AO_AGENT_ID: 'lead-1' }, loopId: loop.loopId,
    request: { action: 'retry', idempotencyKey: 'forged', expectedRevision: loop.revision, reason: 'I am human', actor: { id: 'operator', kind: 'human' } } }), /agent-marked/);
});
test('scope and authority drift stop a running loop; recipe changes never silently replace the retained argv', async t => {
  const f = await fixture(t); let loop = await f.start();
  f.options.config.goal_loop.deploymentRecipes[0].args = ['different'];
  loop = await reconcileGoalLoop({ ...f.options, loopId: loop.loopId }); assert.deepEqual(loop.deploymentRecipe.args, ['--revision', '{artifact}']);
  f.state.goal.scopeHash = 'changed'; loop = await reconcileGoalLoop({ ...f.options, loopId: loop.loopId });
  assert.equal(loop.state, 'human_required'); assert.equal(loop.diagnostic.code, 'GOAL_LOOP_GOAL_CHANGED');
});
test('durable reply recovery validates a correlated report and never treats a generic ACK as success', async t => {
  const f = await fixture(t); let loop = await f.start();
  f.state.messages.get(loop.obligation.id).reply = { agent: 'lead-1', body: 'received' };
  loop = await reconcileGoalLoop({ ...f.options, loopId: loop.loopId }); assert.equal(loop.phase, 'pm');
  f.state.messages.get(loop.obligation.id).reply.body = JSON.stringify(output(loop));
  loop = await reconcileGoalLoop({ ...f.options, loopId: loop.loopId }); assert.equal(loop.reports.length, 1);
  loop = await reconcileGoalLoop({ ...f.options, loopId: loop.loopId }); assert.equal(loop.phase, 'build');
});
test('global disable, explicit enrollment veto and an unlisted recipe fail before sending', async t => {
  const f = await fixture(t); f.options.config.goal_loop.enabled = false;
  await assert.rejects(f.start(), /disabled/); f.options.config.goal_loop.enabled = true;
  f.options.enrollment = async () => ({ enrolled: false, source: 'disabled' });
  await assert.rejects(f.start(), /disabled/); f.options.enrollment = async () => ({ enrolled: true, source: 'default' });
  f.options.config.goal_loop.deploymentRecipes = [];
  await assert.rejects(f.start(), /exactly one/); assert.equal(f.state.sends.length, 0);
});
test('evidence path escape and missing evidence are refused; discovery failure preserves committed work', async t => {
  const f = await fixture(t); f.state.publishFails = true; const loop = await f.start();
  assert.equal(loop.discoveryDiagnostic.code, 'GOAL_DISCOVERY_FAILED');
  await writeFile(join(f.root, 'outside'), 'secret');
  await assert.rejects(report(f, loop, { evidence: ['../outside'] }), /escaped/);
  await assert.rejects(report(f, loop, { evidence: [] }), /durable evidence/);
  assert.equal((await showGoalLoop({ ...f.options, loopId: loop.loopId })).state, 'running');
});
test('typed human decision is exact and approval does not become phase success', async t => {
  const f = await fixture(t); let loop = await f.start();
  loop = await report(f, loop, { status: 'human_required', details: { reason: 'Needs a scoped decision', decision: { kind: 'phase-decision', scope: { action: 'Continue PM planning', target: 'EP-001' } } } });
  const request = { action: 'approve', idempotencyKey: 'decision', actor: { id: 'operator' }, expectedRevision: loop.revision, reason: 'Reviewed exact request', decision: { ...loop.pendingDecision, artifact: sha } };
  await assert.rejects(controlGoalLoop({ ...f.options, loopId: loop.loopId, request }), /exact pending/);
  request.decision = loop.pendingDecision; loop = await controlGoalLoop({ ...f.options, loopId: loop.loopId, request });
  assert.equal(loop.phase, 'pm'); assert.equal(loop.decisions.length, 1); assert.equal(loop.state, 'running');
  assert.match(loop.obligation.id, /decision-1$/); loop = await report(f, loop, { idempotencyKey: 'after-decision' }); assert.equal(loop.phase, 'build');
});
test('explicitly unauthenticated human channel and Codex-marked session cannot control the loop', async t => {
  const f = await fixture(t), loop = await f.start();
  const request = { action: 'pause', idempotencyKey: 'pause', actor: { id: 'human' }, expectedRevision: loop.revision, reason: 'pause' };
  await assert.rejects(controlGoalLoop({ ...f.options, authenticatedHuman: false, loopId: loop.loopId, request }), /agent-marked/);
  await assert.rejects(controlGoalLoop({ ...f.options, env: { ...f.options.env, CODEX_THREAD_ID: 'thread' }, loopId: loop.loopId, request }), /agent-marked/);
});
test('a report persisted during pause refuses altered evidence when resumed', async t => {
  const f = await fixture(t); let loop = await f.start();
  loop = await controlGoalLoop({ ...f.options, loopId: loop.loopId, request: { action: 'pause', idempotencyKey: 'pause', actor: { id: 'operator' }, expectedRevision: loop.revision, reason: 'Inspect' } });
  loop = await report(f, loop); await writeFile(join(f.options.consumer, 'proof.json'), 'altered');
  loop = await controlGoalLoop({ ...f.options, loopId: loop.loopId, request: { action: 'resume', idempotencyKey: 'resume', actor: { id: 'operator' }, expectedRevision: loop.revision, reason: 'Continue' } });
  assert.equal(loop.state, 'blocked'); assert.equal(loop.phase, 'pm'); assert.match(loop.diagnostic.message, /evidence changed/);
});

test('durable admission precedes supervisor activation and first tick can reconcile without deadlock', async t => {
  const f = await fixture(t); f.options.activate = async () => {
    const loops = await reconcileGoalLoops({ ...f.options, supervisorTick: true });
    assert.equal(loops.length, 1); assert.equal(loops[0].state, 'running');
    return { supervision: { ready: true } };
  };
  const loop = await f.start(); assert.equal(loop.activation.state, 'ready'); assert.equal(f.state.sends.length, 1);
  assert.match(loop.obligation.prompt, /ao-topology goal-loop report/);
});
test('failed supervisor activation is durable, visible and recovers on a later supervisor tick', async t => {
  const f = await fixture(t); f.state.activationReady = false;
  let loop = await f.start(); assert.equal(loop.diagnostic.code, 'GOAL_LOOP_SUPERVISION'); assert.equal(f.state.sends.length, 0);
  assert.equal((await showGoalLoop({ ...f.options, loopId: loop.loopId })).diagnostic.code, 'GOAL_LOOP_SUPERVISION');
  const before = f.state.activations; await showGoalLoop({ ...f.options, loopId: loop.loopId }); assert.equal(f.state.activations, before);
  loop = await reconcileGoalLoop({ ...f.options, loopId: loop.loopId, supervisorTick: true });
  assert.equal(loop.state, 'running'); assert.equal(f.state.sends.length, 1);
});
test('historical completion is not displayed as proof when public TM reports drift', async t => {
  const f = await fixture(t); let loop = await f.start();
  for (let phase = 0; phase < 9; phase++) loop = await report(f, loop);
  f.state.verification = { completionReady: false, completionReason: 'Evidence changed' };
  const activations = f.state.activations;
  const view = await showGoalLoop({ ...f.options, loopId: loop.loopId });
  assert.equal(view.state, 'human_required'); assert.equal(goalLoopSummary(view).criteria[0].status, 'unproven');
  assert.equal(f.state.activations, activations);
  loop = await reconcileGoalLoop({ ...f.options, loopId: loop.loopId }); assert.equal(loop.state, 'human_required');
});
test('a blocked authoritative completion repairs rather than retrying an immutable success report forever', async t => {
  const f = await fixture(t); f.state.blockCompletion = true; let loop = await f.start();
  for (let phase = 0; phase < 9; phase++) loop = await report(f, loop);
  assert.equal(loop.phase, 'pm'); assert.equal(loop.attempt, 2);
  assert.equal(f.state.calls.filter(c => c.args[1] === 'complete').length, 0);
  assert.equal(loop.reports.at(-1).applied, true);
});
test('reports cannot omit retained task custody or arrive after the phase deadline', async t => {
  const f = await fixture(t); let loop = await f.start(); loop = await report(f, loop); loop = await report(f, loop);
  await assert.rejects(report(f, loop, { taskIds: [] }), /retain every/);
  f.state.time += 30 * 60_000;
  await assert.rejects(report(f, loop), /deadline/);
  loop = await reconcileGoalLoop({ ...f.options, loopId: loop.loopId }); assert.equal(loop.state, 'human_required');
  await assert.rejects(report(f, loop), /operator decision/);
});
test('referenced receipts are immutable even when omitted from top-level evidence', async t => {
  const f = await fixture(t); let loop = await f.start();
  while (loop.phase !== 'dogfood') loop = await report(f, loop);
  loop = await controlGoalLoop({ ...f.options, loopId: loop.loopId, request: { action: 'pause', idempotencyKey: 'pause', actor: { id: 'operator' }, expectedRevision: loop.revision, reason: 'Inspect' } });
  loop = await report(f, loop);
  assert.ok(loop.reports.at(-1).evidence.some(e => e.path === 'dogfood.json'));
  await writeFile(join(f.options.consumer, 'dogfood.json'), JSON.stringify({ criteria: [{ evidence: ['proof.json'], observed: 'altered' }] }));
  loop = await controlGoalLoop({ ...f.options, loopId: loop.loopId, request: { action: 'resume', idempotencyKey: 'resume', actor: { id: 'operator' }, expectedRevision: loop.revision, reason: 'Continue' } });
  assert.equal(loop.state, 'blocked'); assert.match(loop.diagnostic.message, /evidence changed/);
});
test('producer-confirmed cleanup resolves old writer custody after its claim and worktree are gone', async t => {
  const f = await fixture(t); let loop = await f.start(); delete f.options.writersResolved;
  const doc = { id: 'TM-001', epic: 'EP-001', status: 'done', governance: {}, dispatched: { run: 'old-run' } };
  const record = { state: 'cleaned', collected: true, finish: { revision: sha }, merge: { revision: sha }, worker: { run: 'old-run' }, worktree: '/gone', branch: 'old', events: [{ event: 'cleanup', status: 'complete', worktree: '/gone', branch: 'old' }] };
  const path = join(f.options.env.AGENT_ORCHESTRATION_STATE_HOME, 'management', repoKey(f.options.consumer), 'TM-001.json'); await writeJson(path, record);
  f.options.store = { root: f.options.consumer, show: async () => doc, claim: async () => null };
  const tm = f.options.tm; f.options.tm = (args, input) => args[0] === 'find' ? [doc] : tm(args, input);
  loop = await report(f, loop, { status: 'failed', details: { reason: 'Repair needed' } });
  assert.equal(loop.attempt, 2); assert.equal(loop.state, 'running');
  doc.dispatched.run = 'replacement';
  loop = await report(f, loop, { status: 'failed', details: { reason: 'Repair again' } });
  assert.equal(loop.state, 'blocked'); assert.equal(loop.diagnostic.code, 'GOAL_LOOP_WRITER_UNRESOLVED');
});
test('distinct task source and landing revisions must all belong to their aggregate artifact', async t => {
  const f = await fixture(t); let loop = await f.start();
  loop = await report(f, loop, { taskIds: ['TM-001', 'TM-002'] }); delete f.options.verifyPhase;
  const other = 'c'.repeat(40), records = {
    'TM-001': { finish: { revision: sha }, worker: { name: 'builder-1', run: 'build-1' } },
    'TM-002': { finish: { revision: other }, worker: { name: 'builder-2', run: 'build-2' } },
  };
  for (const record of Object.values(records)) record.events = [{ event: 'worker-bound', worker: record.worker }, { event: 'finish', report: record.finish }];
  f.options.managementStatus = async ({ task }) => ({ task: { id: task, status: 'done' }, management: records[task] });
  f.options.isAncestor = async (source, aggregate) => [sha, other].includes(source) && aggregate === landed;
  const input = output(loop, { artifact: landed, taskIds: ['TM-001', 'TM-002'], details: { implementerId: 'builder-1', taskArtifacts: { 'TM-001': { sourceRevision: sha }, 'TM-002': { sourceRevision: other } } } });
  loop = await reportGoalLoop({ ...f.options, loopId: loop.loopId, report: input });
  assert.equal(loop.phase, 'qa'); assert.equal(loop.taskArtifacts['TM-002'].implementerId, 'builder-2');
  assert.equal(input.details.taskArtifacts['TM-001'].runId, undefined, 'validation does not mutate idempotent report bytes');
  const finish = { revision: landed, evidence: 'proof.json' };
  const evaluationWorker = { name: 'qa-1', run: 'qa-run', binding: { panePid: 123 } };
  records['TM-003'] = { worker: evaluationWorker, finish, events: [{ event: 'worker-bound', worker: evaluationWorker }, { event: 'finish', report: finish }] };
  const qa = output(loop, { taskIds: ['TM-001', 'TM-002'], details: { evaluator: { id: 'qa-1', role: 'validation', independentOf: ['builder-1', 'builder-2'] }, evaluation: { taskId: 'TM-003', runId: 'wrong', evidence: 'proof.json' } } });
  await assert.rejects(reportGoalLoop({ ...f.options, loopId: loop.loopId, report: qa }), /observed worker/);
  qa.details.evaluation.runId = 'qa-run'; qa.details.evaluator.independentOf = ['builder-1'];
  await assert.rejects(reportGoalLoop({ ...f.options, loopId: loop.loopId, report: qa }), /every observed/);
  qa.details.evaluator.independentOf.push('builder-2');
  records['TM-003'].events.push({ event: 'worker-bound', worker: evaluationWorker });
  await assert.rejects(reportGoalLoop({ ...f.options, loopId: loop.loopId, report: qa }), /observed worker/);
  records['TM-003'].events.push({ event: 'finish', report: finish });
  loop = await controlGoalLoop({ ...f.options, loopId: loop.loopId, request: { action: 'pause', idempotencyKey: 'pause-eval', actor: { id: 'operator' }, expectedRevision: loop.revision, reason: 'Inspect evaluator finish' } });
  loop = await reportGoalLoop({ ...f.options, loopId: loop.loopId, report: qa });
  records['TM-003'].worker.stopped_at = new Date().toISOString();
  loop = await controlGoalLoop({ ...f.options, loopId: loop.loopId, request: { action: 'resume', idempotencyKey: 'resume-eval', actor: { id: 'operator' }, expectedRevision: loop.revision, reason: 'The same evaluator finished and exited' } });
  assert.equal(loop.phase, 'review');
});

test('real public TM CLI accepts controller assessment and rejects drift after completion', async t => {
  const f = await fixture(t), tmBin = fileURLToPath(new URL('../../../task-management/bin/tm', import.meta.url));
  const env = { ...process.env, ...f.options.env, TM_ROOT: f.options.consumer, CLAUDE_PROJECT_DIR: f.options.consumer, TM_SESSION_ID: 'goal-loop-fixture', TM_ACTOR: 'goal-loop-fixture', TM_NTFY_OFF: '1' };
  const cli = async (...args) => (await run(process.execPath, [tmBin, ...args], { cwd: f.options.consumer, env, timeoutMs: 30_000 })).stdout;
  await cli('init'); await cli('config', 'dispatch.enabled', 'false');
  await cli('epic', 'new', 'Fixture goal', '--body', 'fixture');
  await writeJson(join(f.root, 'admit.json'), { objective: 'Fix the user journey', criteria: [{ text: 'User can finish the goal' }], authority: f.state.goal.authority });
  const goal = JSON.parse(await cli('goal', 'open', 'EP-001', '--file', join(f.root, 'admit.json'), '--json')).goal;
  await cli('task', 'new', 'Fixture implementation', '--body', 'fixture', '--ac', 'Observed fixture outcome');
  await cli('accept', 'TM-001', '1'); await cli('evidence', 'TM-001', join(f.options.consumer, 'proof.json')); await cli('done', 'TM-001');
  delete f.options.tm; f.options.tmBin = tmBin; f.options.env = env; f.state.time = Date.now(); f.request.scopeHash = goal.scopeHash;
  let loop = await f.start();
  while (loop.phase !== 'test-deploy') loop = await report(f, loop);
  const deployedAt = new Date().toISOString();
  await writeJson(join(f.options.consumer, 'deploy.json'), { schemaVersion: 1, kind: 'deployment', goalId: 'EP-001', artifact: landed, environment: 'approved-test', deployedAt, actor: 'deployer', source: 'Fixture deployment observation' });
  loop = await report(f, loop);
  const assessment = { ...output({ ...loop, phase: 'assessment' }).details.assessment, scopeHash: goal.scopeHash, implementationTaskIds: ['TM-001'] };
  await writeJson(join(f.options.consumer, 'dogfood.json'), { schemaVersion: 1, kind: 'dogfood', goalId: 'EP-001', ...assessment, recordedAt: new Date().toISOString(), criteria: assessment.criteria.map(c => ({ ...c, observed: 'User completes the deployed fixture journey', expected: 'Journey succeeds' })) });
  loop = await report(f, loop);
  loop = await report(f, loop, { details: { assessment } });
  assert.equal(loop.state, 'proven'); assert.equal(loop.goalAssessment.id, 'GA-001'); assert.equal(goalLoopSummary(loop).criteria[0].status, 'proven');
  await writeFile(join(f.options.consumer, 'proof.json'), 'changed after verification');
  const view = await showGoalLoop({ ...f.options, loopId: loop.loopId }); assert.equal(view.state, 'human_required'); assert.equal(goalLoopSummary(view).criteria[0].status, 'unproven');
});
test('a prior successful dogfood receipt cannot be replaced before assessment', async t => {
  const f = await fixture(t); let loop = await f.start();
  while (loop.phase !== 'assessment') loop = await report(f, loop);
  await writeFile(join(f.options.consumer, 'dogfood.json'), JSON.stringify({ criteria: [{ evidence: ['proof.json'], observed: 'a different evaluator outcome' }] }));
  loop = await report(f, loop);
  assert.equal(loop.state, 'blocked'); assert.match(loop.diagnostic.message, /dogfood evidence changed/);
  assert.equal(f.state.calls.filter(c => c.args[1] === 'assess').length, 0);
});
test('held lead notification retries after publication without sending a second obligation', async t => {
  const f = await fixture(t); let ready = false;
  f.options.notify = async () => ready ? { state: 'sent' } : { state: 'held', reason: 'Lead composer contains a draft' };
  let loop = await f.start(); assert.equal(loop.diagnostic.code, 'GOAL_LOOP_NOTIFICATION');
  ready = true; loop = await reconcileGoalLoop({ ...f.options, loopId: loop.loopId, supervisorTick: true });
  assert.equal(loop.state, 'running'); assert.equal(loop.phase, 'pm'); assert.equal(f.state.sends.length, 1);
});
test('repair budget permits exactly ten repairs after the initial attempt', async t => {
  const f = await fixture(t); f.state.goal.limits.maxStalls = 99; let loop = await f.start();
  for (let count = 0; count < 10; count++) loop = await report(f, loop, { status: 'failed' });
  assert.equal(loop.attempt, 11); assert.equal(goalLoopSummary(loop).repairCycles, 10); assert.equal(loop.state, 'running');
  loop = await report(f, loop, { status: 'failed' }); assert.equal(loop.state, 'human_required'); assert.equal(loop.attempt, 11);
});
test('typed choices survive object key reordering and cannot approve a different requested scope', async t => {
  const f = await fixture(t); let loop = await f.start();
  loop = await report(f, loop, { status: 'human_required', details: { reason: 'Choose the approved test action', decision: { kind: 'phase-decision', summary: 'Continue planning for this goal', scope: { action: 'plan', target: 'EP-001' }, options: [{ id: 'continue', label: 'Continue planning', consequence: 'Allows this PM phase to continue within the accepted scope' }], recommendation: 'continue', nextAction: 'Inspect the accepted criteria before continuing' } } });
  const decision = JSON.parse(JSON.stringify(loop.pendingDecision)); decision.scope.target = 'another-goal';
  const request = { action: 'approve', actor: { id: 'operator' }, idempotencyKey: 'decision', expectedRevision: loop.revision, reason: 'Reviewed', decision, choice: 'continue' };
  await assert.rejects(controlGoalLoop({ ...f.options, loopId: loop.loopId, request }), /exact pending/);
  request.decision = Object.fromEntries(Object.entries(loop.pendingDecision).reverse()); request.decision.scope = { target: 'EP-001', action: 'plan' }; request.choice = 'invented';
  await assert.rejects(controlGoalLoop({ ...f.options, loopId: loop.loopId, request }), /exact presented/);
  request.choice = 'continue'; loop = await controlGoalLoop({ ...f.options, loopId: loop.loopId, request });
  assert.equal(loop.state, 'running'); assert.equal(loop.decisions.at(-1).choice, 'continue'); assert.match(loop.obligation.prompt, /Continue planning for this goal/);
});
test('authoritative resolution of a blocking finding counts as progress despite unchanged proven count', async t => {
  const f = await fixture(t); f.state.blockCompletion = true; let loop = await f.start();
  for (let count = 0; count < 9; count++) loop = await report(f, loop);
  const record = JSON.parse(await readFile(loop.recordPath, 'utf8')); record.stalls = 2; await writeJson(loop.recordPath, record);
  f.state.goal.findings = [{ id: 'GF-001', status: 'resolved', resolvedBy: 'GA-001' }];
  for (let count = 0; count < 9; count++) loop = await report(f, loop);
  assert.equal(loop.state, 'running'); assert.equal(loop.stalls, 0); assert.deepEqual(loop.resolvedFindingIds, ['GF-001']);
});
test('pause and resume preserve a pending typed decision and stale running state cannot bypass it', async t => {
  const f = await fixture(t); let loop = await f.start();
  loop = await report(f, loop, { status: 'human_required', details: { reason: 'Operator must approve the concrete next action', decision: { kind: 'phase-decision', scope: { action: 'continue planning', target: 'EP-001' } } } });
  const pending = structuredClone(loop.pendingDecision), sent = f.state.sends.length, activated = f.state.activations;
  const control = action => controlGoalLoop({ ...f.options, loopId: loop.loopId, request: { action, idempotencyKey: action, actor: { id: 'operator' }, expectedRevision: loop.revision, reason: 'Inspect the pending decision' } });
  loop = await control('pause'); assert.equal(loop.state, 'paused');
  loop = await control('resume'); assert.equal(loop.state, 'human_required'); assert.deepEqual(loop.pendingDecision, pending);
  await assert.rejects(report(f, loop, { idempotencyKey: 'unapproved-success' }), /operator decision/);
  loop.state = 'running'; await writeJson(loop.recordPath, loop);
  await assert.rejects(report(f, loop, { idempotencyKey: 'stale-state-success' }), /operator decision/);
  loop = await reconcileGoalLoop({ ...f.options, loopId: loop.loopId });
  assert.equal(loop.state, 'human_required'); assert.deepEqual(loop.pendingDecision, pending);
  assert.equal(f.state.sends.length, sent); assert.equal(f.state.activations, activated);
  loop = await controlGoalLoop({ ...f.options, loopId: loop.loopId, request: { action: 'approve', idempotencyKey: 'approve', actor: { id: 'operator' }, expectedRevision: loop.revision, reason: 'Approve the inspected exact action', decision: pending } });
  assert.equal(loop.state, 'running'); assert.equal(loop.pendingDecision, null); assert.match(loop.obligation.id, /decision-1$/);
});
