// TM-302: `agent restart` on a reviewer applies a staged prompt through the read-only relaunch path,
// never mid-review. Fake reviewer only: alive/open/turnEnd/kill are injected, no tmux is touched.
import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { run, writeJson } from '../../topology/lib/util.mjs';
import { ensureReviewer, restartReviewer, reviewerInboxRoot } from '../../topology/lib/reviewer.mjs';
import { refreshPrompt, promptRevisions } from '../../topology/lib/prompt-lifecycle.mjs';
import { loadConfig } from '../../topology/lib/config.mjs';

const incarnation = n => ({ serverKey: '/test/socket', serverPid: 10, sessionId: `$${n}`, sessionCreated: n, paneId: `%${n}`, panePid: 20 + n });

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'ao-reviewer-restart-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const consumer = join(root, 'repo'), pluginRoot = join(root, 'plugin'), home = join(root, 'home');
  await mkdir(consumer); await run('git', ['init', '-q', consumer]);
  const writeConfig = instructions => writeJson(join(pluginRoot, 'config.defaults.json'), { reviewer: { template: 'r' }, templates: { r: { role: 'reviewer', cli: 'codex', instructions } }, management: { reviewer_providers: ['codex', 'claude'] } });
  await writeConfig('Review independently.');
  const env = { ...process.env, XDG_CONFIG_HOME: join(root, 'config'), AGENT_ORCHESTRATION_STATE_HOME: join(root, 'state') };
  const f = { consumer, pluginRoot, home, env };
  // The fake reviewer: one live incarnation at a time; every launch goes through ensureReviewer's
  // `open`, the reviewer-only opener whose real form builds the read-only argv.
  const calls = [];
  let live = null, n = 0;
  const probes = {
    alive: async (_s, record) => Boolean(live && record?.binding?.paneId === live.paneId),
    open: async () => { calls.push('open'); live = incarnation(++n); return { session: 'review', pane: live.paneId, binding: live }; },
    turnEnd: async () => { calls.push('turnEnd'); return { ended: true, reason: 'no busy evidence' }; },
    kill: async () => { calls.push('kill'); live = null; },
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

test('TM-302 restart is refused TOPOLOGY_AGENT_BUSY while a review request is published and uncollected', async t => {
  const f = await fixture(t);
  const dir = join(await reviewerInboxRoot(f.consumer, f.env, f.home), 'requests');
  const nonce = '11111111-2222-3333-4444-555555555555';
  await writeJson(join(dir, 'TM-1-abc.json'), { task: 'TM-1', revision: 'abc', nonce, reviewer_id: f.agent.id, state: 'published' });
  await writeJson(join(dir, 'TM-2-def.json'), { task: 'TM-2', revision: 'def', nonce: 'collected', reviewer_id: f.agent.id, state: 'published', collected_at: 'x' });
  f.calls.length = 0;
  await assert.rejects(restartReviewer({ ...f, agentId: f.agent.id, mode: 'handoff', probes: f.probes }), error => {
    assert.equal(error.code, 'TOPOLOGY_AGENT_BUSY');
    assert.match(error.message, new RegExp(nonce));
    assert.deepEqual(error.details.pending.map(p => p.nonce), [nonce], 'only the uncollected request blocks');
    return true;
  });
  assert.deepEqual(f.calls, [], 'nothing waited, killed or launched');
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
