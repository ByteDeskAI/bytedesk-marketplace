// TM-302: `agent restart` on a reviewer applies a staged prompt through the read-only relaunch path,
// never mid-review. Fake reviewer only: alive/open/turnEnd/kill are injected, no tmux is touched.
import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, mkdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { run, writeJson } from '../../topology/lib/util.mjs';
import { sealVerdict } from '../../topology/lib/reviewer.mjs';
import { collectReview, currentReviewStatus, ensureReviewer, restartReviewer, reviewerInboxRoot, readReviewerRecord, requestReview, reviewEligibility } from '../../topology/lib/reviewer.mjs';
import { submitVerdict } from '../helpers/review-submit.mjs';
import { refreshPrompt, promptRevisions } from '../../topology/lib/prompt-lifecycle.mjs';
import { loadConfig } from '../../topology/lib/config.mjs';

const incarnation = n => ({ serverKey: '/test/socket', serverPid: 10, sessionId: `$${n}`, sessionCreated: n, paneId: `%${n}`, panePid: n === 1 ? process.pid : 20 + n }); // TM-427: incarnation 1 passes the real ancestry proof

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'ao-reviewer-restart-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const consumer = join(root, 'repo'), pluginRoot = join(root, 'plugin'), home = join(root, 'home');
  await mkdir(consumer); await run('git', ['init', '-q', consumer]);
  await run('git', ['-C', consumer, '-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', 'commit', '--allow-empty', '-m', 'base']);
  const revision = (await run('git', ['-C', consumer, 'rev-parse', 'HEAD'])).stdout.trim();
  const writeConfig = instructions => writeJson(join(pluginRoot, 'config.defaults.json'), { reviewer: { template: 'r' }, templates: { r: { role: 'reviewer', cli: 'codex', instructions } }, management: { reviewer_providers: ['codex', 'claude'] } });
  await writeConfig('Review independently.');
  const env = { ...process.env, XDG_CONFIG_HOME: join(root, 'config'), AGENT_ORCHESTRATION_STATE_HOME: join(root, 'state') };
  const f = { consumer, pluginRoot, home, env, revision };
  // An admitted, finished TM-1, so a real requestReview can be attempted during the restart.
  const { canonicalRepoId, repoKey } = await import('../../topology/lib/repoid.mjs');
  const identity = await canonicalRepoId(consumer);
  await writeJson(join(env.AGENT_ORCHESTRATION_STATE_HOME, 'management', repoKey(identity.id), 'TM-1.json'), { started: true, task: 'TM-1', owner: 'author', repo_id: identity.id, base_revision: revision, finish: { revision } });
  // The fake reviewer: one live incarnation at a time; every launch goes through ensureReviewer's
  // `open`, the reviewer-only opener whose real form builds the read-only argv.
  const calls = [];
  let live = null, n = 0;
  const probes = {
    onKill: null,
    alive: async (_s, record) => Boolean(live && record?.binding?.paneId === live.paneId),
    open: async () => { calls.push('open'); live = incarnation(++n); return { session: 'review', pane: live.paneId, binding: live }; },
    turnEnd: async () => { calls.push('turnEnd'); return { ended: true, reason: 'no busy evidence' }; },
    kill: async () => { calls.push('kill'); await probes.onKill?.(); live = null; },
  };
  const { agent } = await ensureReviewer({ ...f, probes });
  const revisions = async () => promptRevisions({ agent, consumer, loaded: await loadConfig(f), live: true });
  return { ...f, agent, probes, calls, writeConfig, revisions };
}

test('TM-302 restart applies a staged prompt by a read-only relaunch and clears restart_required', async t => {
  const f = await fixture(t);
  await f.writeConfig('Review independently. Also check the CHANGELOG.');
  const staged = await refreshPrompt({ ...f, agent: f.agent, live: true, session: 'review' });
  assert.equal(staged.status, 'queued', 'the fixture really staged a prompt');
  const before = await f.revisions();
  assert.equal(before.restart_required, true);
  f.calls.length = 0;
  const result = await restartReviewer({ ...f, agentId: f.agent.id, mode: 'handoff', probes: f.probes });
  assert.deepEqual(f.calls, ['turnEnd', 'kill', 'open'], 'turn waited out, old incarnation ended, then relaunched');
  assert.equal(result.read_only, true);
  assert.equal(result.mode, 'fresh');
  assert.equal(result.relaunched, true);
  assert.equal(result.old_session.incarnation.paneId, '%1');
  assert.equal(result.new_session.incarnation.paneId, '%2');
  assert.equal(result.prompt_revision, before.desired_revision);
  const after = await f.revisions();
  assert.equal(after.restart_required, false);
  assert.equal(after.applied_revision, before.desired_revision);
});

test('TM-302 restart is refused TOPOLOGY_AGENT_BUSY only while a current-incarnation request is in flight', async t => {
  const f = await fixture(t);
  const { binding } = await readReviewerRecord(f.consumer, f.env, f.home);
  const dir = join(await reviewerInboxRoot(f.consumer, f.env, f.home), 'requests');
  const nonce = '11111111-2222-3333-4444-555555555555', waiting = '66666666-7777-8888-9999-000000000000';
  const request = (task, extra) => writeJson(join(dir, `${task}-abc.json`), { task, revision: 'abc', reviewer_id: f.agent.id, binding, state: 'published', ...extra });
  await request('TM-1', { nonce });
  // still pending: the queue has only recorded "no verdict submitted yet"
  await request('TM-2', { nonce: waiting, collection: { code: 'TOPOLOGY_REVIEWER_NO_VERDICT', reason: 'No verdict has been submitted yet' } });
  // TM-365: a submitted verdict is on disk, bound to this incarnation, so a restart cannot orphan it
  await request('TM-7', { nonce: 'submitted' });
  await writeJson(join(dir, '..', 'verdicts', 'TM-7-abc.json'), await sealVerdict({ nonce: 'submitted', task: 'TM-7', revision: 'abc', verdict: 'approve', findings: [] }, f.env, f.home));
  // TM-427: an unsealed (hand-written) verdict is not a submitted one, so it does not release TM-8
  await request('TM-8', { nonce: 'forged' });
  await writeJson(join(dir, '..', 'verdicts', 'TM-8-abc.json'), { nonce: 'forged', task: 'TM-8', revision: 'abc', verdict: 'approve', findings: [] });
  // outcomes, none of which a restart can orphan
  await request('TM-3', { nonce: 'collected', collected_at: 'x', state: 'collected' });
  await request('TM-4', { nonce: 'withdrawn', collection: { code: 'TOPOLOGY_REVIEWER_RANGE', reason: 'Review request no longer covers the admitted task range.' } });
  await request('TM-5', { nonce: 'stale', binding: { ...binding, paneId: '%0', sessionId: '$0' } });
  await request('TM-6', { nonce: 'failed', state: 'failed' });
  f.calls.length = 0;
  await assert.rejects(restartReviewer({ ...f, agentId: f.agent.id, mode: 'handoff', probes: f.probes }), error => {
    assert.equal(error.code, 'TOPOLOGY_AGENT_BUSY');
    assert.match(error.message, new RegExp(nonce));
    assert.deepEqual(error.details.pending.map(p => p.nonce).sort(), [nonce, waiting, 'forged'].sort(), 'only current-incarnation requests still waiting for a verdict block');
    return true;
  });
  assert.deepEqual(f.calls, [], 'nothing waited, killed or launched');
  assert.equal((await readReviewerRecord(f.consumer, f.env, f.home)).restarting, undefined, 'a refused restart leaves no mark');
});

test('TM-302 a withdrawn or stale-incarnation request does not block a restart', async t => {
  const f = await fixture(t);
  const { binding } = await readReviewerRecord(f.consumer, f.env, f.home);
  const dir = join(await reviewerInboxRoot(f.consumer, f.env, f.home), 'requests');
  await writeJson(join(dir, 'TM-4-abc.json'), { task: 'TM-4', revision: 'abc', nonce: 'withdrawn', reviewer_id: f.agent.id, binding, state: 'published', collection: { code: 'TOPOLOGY_REVIEWER_RANGE', reason: 'range moved' } });
  await writeJson(join(dir, 'TM-5-abc.json'), { task: 'TM-5', revision: 'abc', nonce: 'stale', reviewer_id: f.agent.id, binding: { ...binding, paneId: '%0' }, state: 'published' });
  const result = await restartReviewer({ ...f, agentId: f.agent.id, mode: 'handoff', probes: f.probes });
  assert.equal(result.new_session.incarnation.paneId, '%2');
});

test('TM-302 the record is marked restarting before the old incarnation ends, so a new request is refused until the relaunch', async t => {
  const f = await fixture(t);
  let refused = null, mark = null;
  f.probes.onKill = async () => {
    mark = (await readReviewerRecord(f.consumer, f.env, f.home)).restarting;
    refused = await requestReview({ ...f, task: 'TM-1', revision: f.revision, authorAgentIds: ['author'], wake: async () => assert.fail('a restarting reviewer must not be woken') }).then(() => null, error => error);
  };
  await restartReviewer({ ...f, agentId: f.agent.id, mode: 'handoff', probes: f.probes });
  assert.ok(mark?.at, 'the mark was on the record when the old incarnation was ended');
  assert.equal(refused?.code, 'TOPOLOGY_REVIEWER_RESTARTING');
  const dir = join(await reviewerInboxRoot(f.consumer, f.env, f.home), 'requests');
  await assert.rejects(readFile(join(dir, `TM-1-${f.revision}.json`)), { code: 'ENOENT' }, 'the refused request was not written');
  const after = await readReviewerRecord(f.consumer, f.env, f.home);
  assert.equal(after.restarting, undefined, 'the relaunch cleared the mark');
  const request = await requestReview({ ...f, task: 'TM-1', revision: f.revision, authorAgentIds: ['author'], wake: async () => ({ rang: false }) });
  assert.equal(request.binding.paneId, '%2', 'after the relaunch a request binds the new incarnation');
});

test('TM-302 resume on a reviewer is a fresh read-only launch and says so', async t => {
  const f = await fixture(t);
  const result = await restartReviewer({ ...f, agentId: f.agent.id, mode: 'resume', probes: f.probes });
  assert.equal(result.requested_mode, 'resume');
  assert.equal(result.fallback, 'fresh');
  assert.match(result.fallback_reason, /no conversation state/);
  assert.equal(result.new_session.incarnation.paneId, '%2');
});

test('TM-302 restart refuses an agent that is not the registered reviewer', async t => {
  const f = await fixture(t);
  await assert.rejects(restartReviewer({ ...f, agentId: 'someone-else', probes: f.probes }), { code: 'TOPOLOGY_REVIEWER_NOT_REGISTERED' });
});

test('TM-365 a verdict submitted before a reviewer restart is still collected after it', async t => {
  const f = await fixture(t);
  const before = await readReviewerRecord(f.consumer, f.env, f.home);
  const request = await requestReview({ ...f, task: 'TM-1', authorAgentIds: ['author'], wake: async () => ({ rang: true }) });
  await submitVerdict(f, request, 'blocked', []);
  // The submitted request no longer holds the restart off, and the relaunch is a new incarnation.
  const restarted = await restartReviewer({ ...f, agentId: f.agent.id, mode: 'handoff', probes: f.probes });
  assert.notEqual(restarted.new_session.incarnation.paneId, before.binding.paneId);
  const review = await collectReview({ ...f, task: 'TM-1' });
  assert.equal(review.verdict, 'blocked');
  assert.equal(review.request_nonce, request.nonce);
  assert.deepEqual(review.binding, before.binding, 'recorded against the incarnation that submitted it');
  assert.equal((await currentReviewStatus(f.consumer, 'TM-1', f.revision, f.env, f.home)).state, 'blocked');
  // An approval still has to come from the current incarnation.
  const gate = await reviewEligibility({ ...f, task: 'TM-1', authorAgentIds: ['author'], probes: { alive: async () => true, responsive: async () => true } });
  assert.equal(gate.eligible, false);
  assert.ok(gate.reasons.some(reason => /incarnation changed/.test(reason)), JSON.stringify(gate.reasons));
});

test('TM-365 without a submitted verdict, a request sent to a replaced incarnation cannot be collected', async t => {
  const f = await fixture(t);
  await requestReview({ ...f, task: 'TM-1', authorAgentIds: ['author'], wake: async () => ({ rang: true }) });
  const record = await readReviewerRecord(f.consumer, f.env, f.home);
  const { reviewerPaths } = await import('../../topology/lib/reviewer.mjs');
  await writeJson((await reviewerPaths(f.consumer, f.env, f.home)).recordPath, { ...record, binding: incarnation(9) });
  await assert.rejects(collectReview({ ...f, task: 'TM-1' }), { code: 'TOPOLOGY_REVIEWER_IDENTITY' });
});
