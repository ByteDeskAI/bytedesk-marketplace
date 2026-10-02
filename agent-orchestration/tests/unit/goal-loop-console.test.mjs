import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { publishGoalLoopWorkflow, preserveWorktreeWorkflows, reconcileWorkflows, workflowRepository } from '../../topology/lib/discovery.mjs';
import { controlWorkflow, workflowDetail } from '../../topology/lib/workflow-control.mjs';
import { acceptMailboxDelivery, createMailboxEnvelope, publishMailboxEnvelope, setMailboxDisposition } from '../../topology/lib/mailbox-receipts.mjs';
import { writeJson } from '../../topology/lib/util.mjs';

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'ao-loop-console-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const consumer = join(root, 'consumer'), stateHome = join(root, 'state');
  await mkdir(consumer);
  const repository = await workflowRepository(consumer), loopId = `gl-${'a'.repeat(24)}`;
  const recordPath = join(stateHome, 'goal-loops', 'v1', repository.key, loopId, 'loop.json');
  const loop = { schemaVersion: 1, runtime: 'goal-loop', loopId, workflowId: `goal-loop:${loopId}`, repository, consumer, recordPath,
    goalId: 'EP-001', goalRevision: 1, scopeHash: 'scope', original: { objective: 'Finish the user journey' }, criteria: [{ id: 'AC-001', text: 'Journey works' }],
    authority: { testTarget: 'local-test' }, limits: { maxCycles: 10, maxStalls: 3, deadlineMinutes: 30 },
    phase: 'pm', leadId: 'lead', attempt: 1, cycle: 1, stalls: 0, reports: [], history: [], controls: {},
    state: 'running', revision: 2, createdAt: '2026-10-01T10:00:00Z', updatedAt: '2026-10-01T10:01:00Z',
    obligation: { deadlineAt: '2026-10-01T10:30:00Z', prompt: 'PRIVATE_PROMPT' }, deploymentRecipe: { command: 'PRIVATE_ARGV' } };
  await writeJson(recordPath, loop);
  await publishGoalLoopWorkflow({ loop, recordPath, stateHome });
  return { root, consumer, stateHome, repository, loop, recordPath, workflowId: loop.workflowId, env: { AGENT_ORCHESTRATION_STATE_HOME: stateHome } };
}

test('goal loop discovery and inspection retain workflow identity without exposing prompts or recipes', async t => {
  const f = await fixture(t);
  const index = await reconcileWorkflows(f);
  assert.equal(index.workflows.length, 1);
  assert.equal(index.workflows[0].runtime, 'goal-loop');
  assert.equal(index.workflows[0].goalId, 'EP-001');
  const detail = await workflowDetail(f);
  assert.equal(detail.goalLoop.goalSummary, 'Finish the user journey');
  assert.equal(detail.goalLoop.limits.phaseTimeoutMs, 1800000);
  assert.equal(detail.run, undefined);
  assert.equal(JSON.stringify(detail).includes('PRIVATE_'), false);
  assert.equal(detail.goalLoop.criteria[0].status, 'unproven');
  const preservation = await preserveWorktreeWorkflows({ ...f, worktree: f.consumer });
  assert.equal(preservation.ok, false);
  assert.equal(preservation.rejected[0].code, 'TOPOLOGY_PRESERVATION_ACTIVE');
});

test('console reads separate publication and disposition facts without broker pulls or ACK', async t => {
  const f = await fixture(t);
  const envelope = createMailboxEnvelope({ id: 'phase-1', repositoryId: f.repository.id, from: 'controller', to: 'lead', body: 'PRIVATE_ARGV in PM obligation', context: { workflowId: f.workflowId, stage: 'goal-phase', phase: 'pm', attempt: 1 } });
  let acknowledgements = 0, publications = 0;
  await publishMailboxEnvelope({ envelope, env: f.env, transport: { publishMail: async () => { publications++; return { sequence: 1 }; } } });
  await acceptMailboxDelivery({ ...f, agent: 'lead', delivery: { body: JSON.stringify(envelope), ack: async () => { acknowledgements++; } } });
  await setMailboxDisposition({ ...f, agent: 'lead', messageId: 'phase-1', disposition: 'deferred', reason: 'Waiting for task admission' });
  const first = await workflowDetail(f), second = await workflowDetail(f);
  assert.deepEqual(first.messages, second.messages);
  assert.equal(first.messages.length, 1);
  assert.equal(first.messages[0].publicationStatus, 'published');
  assert.equal(first.messages[0].receiptStatus, 'deferred');
  assert.equal(first.messages[0].disposition.reason, 'Waiting for task admission');
  assert.equal(JSON.stringify(first.messages).includes('PRIVATE_ARGV'), false);
  assert.equal(acknowledgements, 1); assert.equal(publications, 1);
});

test('goal control requires operator attestation and current index revision; crash retry retains original native revision', async t => {
  const f = await fixture(t);
  const index = await reconcileWorkflows(f);
  const request = { schemaVersion: 1, workflowId: f.workflowId, action: 'goal-control', actor: { id: 'gateway-user' },
    idempotencyKey: 'pause-1', expectedRevision: index.workflows[0].revision, payload: { action: 'pause', reason: 'Inspect progress' } };
  await assert.rejects(() => controlWorkflow({ ...f, request }), { code: 'TOPOLOGY_CONTROL_ACTOR' });
  await assert.rejects(() => controlWorkflow({ ...f, request: { ...request, expectedRevision: 'stale' }, authenticatedHuman: true }), { code: 'TOPOLOGY_CONTROL_REVISION' });
  let calls = 0;
  const goalControl = async options => {
    assert.equal(options.authenticatedHuman, true);
    assert.equal(options.request.expectedRevision, 2);
    calls++;
    if (calls === 1) {
      f.loop.revision++; f.loop.state = 'paused';
      await writeJson(f.recordPath, f.loop); await publishGoalLoopWorkflow({ ...f, loop: f.loop });
      throw new Error('process ended after loop commit');
    }
    return f.loop;
  };
  await assert.rejects(() => controlWorkflow({ ...f, request, authenticatedHuman: true, goalControl }), /after loop commit/);
  const result = await controlWorkflow({ ...f, request, authenticatedHuman: true, goalControl });
  assert.equal(result.ok, true); assert.equal(result.result.state, 'paused');
  assert.deepEqual(await controlWorkflow({ ...f, request, authenticatedHuman: true, goalControl }), result);
  assert.equal(calls, 2);
});

test('discovery rejects a redirected loop record', async t => {
  const f = await fixture(t), outside = join(f.root, 'outside.json');
  await writeJson(outside, f.loop); await rm(f.recordPath); await symlink(outside, f.recordPath);
  const index = await reconcileWorkflows(f);
  assert.equal(index.workflows.length, 0);
  assert.ok(index.rejected.length > 0);
});

test('a native goal update without index publication invalidates the old operator decision', async t => {
  const f = await fixture(t), index = await reconcileWorkflows(f);
  f.loop.revision++; f.loop.attempt++; await writeJson(f.recordPath, f.loop);
  let controlled = false;
  const request = { schemaVersion: 1, workflowId: f.workflowId, action: 'goal-control', actor: { id: 'gateway-user' },
    idempotencyKey: 'stale-native', expectedRevision: index.workflows[0].revision, payload: { action: 'stop', reason: 'Reviewed old attempt' } };
  await assert.rejects(() => controlWorkflow({ ...f, request, authenticatedHuman: true, goalControl: async () => { controlled = true; } }), { code: 'TOPOLOGY_CONTROL_REVISION' });
  assert.equal(controlled, false);
});
