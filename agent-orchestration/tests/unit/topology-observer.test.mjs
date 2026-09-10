import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { run, writeJson } from '../../topology/lib/util.mjs';
import { canonicalRepoId, repoKey } from '../../topology/lib/repoid.mjs';
import {
  classifyFinding, closeObserver, discoverObserverTargets, escalationPlan,
  findingFingerprint, observerStatus, openObserver, recordFinding, redactEvidence,
  reportFinding, watchObservedRun,
} from '../../topology/lib/observer.mjs';

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'ao-observer-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const repo = join(root, 'repo'), runDir = join(repo, '.bytedesk', 'agent-orchestration', 'runs', 'live');
  const home = join(root, 'home'), env = { ...process.env, AGENT_ORCHESTRATION_STATE_HOME: join(root, 'state') };
  await run('git', ['init', repo]);
  await mkdir(runDir, { recursive: true });
  await writeJson(join(runDir, 'run.json'), { run_id: 'live', name: 'demo', state: 'running', session: 'demo-session', run_dir: runDir, consumer: repo,
    agents: [{ id: 'conductor', role: 'orchestrator', binding: { paneId: '%1' } }, { id: 'worker', role: 'worker' }] });
  const tmux = { hasSession: async name => name === 'demo-session' };
  return { root, repo, runDir, home, env, tmux };
}

test('discovery exposes only live non-terminal runs with a conductor', async t => {
  const f = await fixture(t);
  const targets = await discoverObserverTargets({ consumer: f.repo, tmux: f.tmux });
  assert.equal(targets.length, 1);
  assert.equal(targets[0].run_id, 'live');
  assert.equal(targets[0].conductor, 'conductor');
  await writeJson(join(f.runDir, 'run.json'), { run_id: 'live', name: 'demo', state: 'complete', session: 'demo-session', run_dir: f.runDir, consumer: f.repo,
    agents: [{ id: 'conductor', role: 'orchestrator' }] });
  assert.deepEqual(await discoverObserverTargets({ consumer: f.repo, tmux: f.tmux }), []);
});

test('discovery exposes a verified standing repository orchestration', async t => {
  const f = await fixture(t);
  const agents = join(f.root, 'agents'), leadDir = join(agents, 'lead-1');
  await mkdir(leadDir, { recursive: true });
  await writeJson(join(leadDir, 'agent.json'), { id: 'lead-1', role: 'lead', full_name: 'Test Conductor' });
  const identity = await canonicalRepoId(f.repo), key = repoKey(identity.id);
  await mkdir(join(f.env.AGENT_ORCHESTRATION_STATE_HOME, 'census'), { recursive: true });
  await writeJson(join(f.env.AGENT_ORCHESTRATION_STATE_HOME, 'census', `${key}.json`), {
    schemaVersion: 1, repositoryKey: key, repoId: identity.id, at: new Date().toISOString(), staleAfterMs: 45000,
    agents: [{ agentId: 'lead-1', sessionName: 'ao-lead-1', binding: { paneId: '%2' } }],
  });
  const targets = await discoverObserverTargets({ consumer: f.repo, agentDirs: [agents], env: f.env, home: f.home,
    tmux: { hasSession: async name => name === 'demo-session' || name === 'ao-lead-1' } });
  const target = targets.find(item => item.kind === 'repository');
  assert.equal(target.id, `repository:${key}`);
  assert.equal(target.conductor, 'lead-1');
  const opened = await openObserver({ consumer: f.repo, target: target.id, agentDirs: [agents], observerId: 'standing-watcher',
    env: f.env, home: f.home, tmux: { hasSession: async () => true } });
  assert.equal(opened.attachment.kind, 'repository');
  assert.equal(opened.attachment.run_dir, null);
});

test('attachment requires explicit exact selection and is idempotent', async t => {
  const f = await fixture(t), options = { consumer: f.repo, runDir: f.runDir, observerId: 'watcher', home: f.home, env: f.env, tmux: f.tmux };
  await assert.rejects(openObserver({ ...options, runDir: null }), error => error.code === 'TOPOLOGY_OBSERVER_SELECTION');
  const first = await openObserver(options);
  assert.equal(first.attachment.privileges, 'read-only');
  assert.equal(first.attachment.coordinates_only, true);
  assert.equal((await observerStatus(options)).status, 'attached');
  assert.equal((await openObserver(options)).idempotent, true);
  assert.deepEqual(await closeObserver(options), { status: 'detached', observer_id: 'watcher', removed: true });
  assert.equal((await observerStatus(options)).status, 'detached');
  assert.equal((await closeObserver(options)).removed, false);
});

test('classification, redaction, fingerprint and delivery states are deterministic', async t => {
  const f = await fixture(t), options = { consumer: f.repo, runDir: f.runDir, observerId: 'watcher', home: f.home, env: f.env, tmux: f.tmux };
  await openObserver(options);
  assert.equal(classifyFinding({ signal: 'undelivered-message' }), 'breaking');
  assert.equal(classifyFinding({ signal: 'workflow-friction' }), 'improvement');
  assert.equal(classifyFinding({ signal: 'model-suspicion' }), 'needs-triage');
  assert.deepEqual(redactEvidence({ token: 'abc', nested: 'authorization=Bearer-123' }), { token: '[REDACTED]', nested: 'authorization=[REDACTED]' });
  assert.equal(findingFingerprint({ repository: 'r', run_id: 'x', type: 't', component: 'c' }), findingFingerprint({ repository: 'r', run_id: 'x', type: 't', component: 'c' }));
  const first = await recordFinding({ signal: 'workflow-friction', component: 'mailbox', summary: 'slow', evidence: { password: 'bad' } }, { ...options, now: 1000 });
  assert.equal(first.notify, true); assert.equal(first.record.delivery.acknowledged, null); assert.equal(first.record.evidence.password, '[REDACTED]');
  const again = await recordFinding({ signal: 'workflow-friction', component: 'mailbox', summary: 'slow' }, { ...options, now: 2000 });
  assert.equal(again.duplicate, true); assert.equal(again.record.occurrences, 2);
  const stored = JSON.parse(await readFile(join(f.env.AGENT_ORCHESTRATION_STATE_HOME, 'observers', 'watcher', 'findings', `${first.record.fingerprint}.json`), 'utf8'));
  assert.equal(stored.delivery.notified, null);
});

test('escalation preserves authority boundaries', () => {
  const breaking = escalationPlan({ fingerprint: 'f', severity: 'breaking' }, { affectedLead: 'lead-a', marketplaceLead: 'lead-m', marketplaceRepository: 'ByteDeskAI/bytedesk-marketplace' });
  assert.deepEqual(breaking.recipients, ['lead-a', 'lead-m']);
  assert.equal(breaking.next, 'dispatch-requested');
  assert.equal(breaking.observer_may_dispatch, false);
  assert.equal(breaking.marketplace.epic_title, 'Agent Orchestration Tasks');
  const improvement = escalationPlan({ fingerprint: 'f', severity: 'improvement' }, { affectedLead: 'lead-a', marketplaceLead: 'lead-m', marketplaceRepository: 'ByteDeskAI/bytedesk-marketplace' });
  assert.deepEqual(improvement.recipients, ['lead-a']);
  assert.equal(improvement.next, 'affected-lead-verification-required');
});

test('watch persists findings and report sends non-assignment conductor requests', async t => {
  const f = await fixture(t), options = { consumer: f.repo, runDir: f.runDir, observerId: 'watcher', home: f.home, env: f.env, tmux: f.tmux };
  await openObserver(options);
  const tick = await watchObservedRun(options, { once: true, intervalMs: 1000 });
  assert.equal(tick.recorded.length, 0);
  const finding = await recordFinding({ signal: 'workflow-friction', component: 'routing', summary: 'extra handoff' }, options);
  const sent = [];
  const result = await reportFinding(finding.record.fingerprint, { ...options,
    affectedConsumer: f.repo, affectedLead: 'affected-lead', marketplaceConsumer: join(f.root, 'marketplace'), marketplaceLead: 'marketplace-lead',
    send: async envelope => { sent.push(envelope); return { status: 'delivered', envelope }; },
  });
  assert.equal(result.delivered, true);
  assert.equal(sent.length, 1);
  assert.equal(sent[0].assignment, false);
  assert.equal(sent[0].to, 'affected-lead');
  assert.match(sent[0].body, /forward it to the Marketplace conductor/);

  const breaking = await recordFinding({ signal: 'run-session-gone', component: 'tmux', summary: 'session gone' }, options);
  sent.length = 0;
  await reportFinding(breaking.record.fingerprint, { ...options,
    affectedConsumer: f.repo, affectedLead: 'affected-lead', marketplaceConsumer: join(f.root, 'marketplace'), marketplaceLead: 'marketplace-lead',
    send: async envelope => { sent.push(envelope); return { status: 'held', envelope }; },
  });
  assert.deepEqual(sent.map(item => item.to), ['affected-lead', 'marketplace-lead']);
  assert.ok(sent.every(item => item.assignment === false));
  const stored = JSON.parse(await readFile(join(f.env.AGENT_ORCHESTRATION_STATE_HOME, 'observers', 'watcher', 'findings', `${breaking.record.fingerprint}.json`), 'utf8'));
  assert.equal(stored.delivery.state, 'held');
  assert.equal(stored.delivery.notified, null);
});

test('the conductor protocol fails closed on epic and fingerprint ambiguity', async () => {
  const role = await readFile(new URL('../../roles/orchestrator.md', import.meta.url), 'utf8');
  assert.match(role, /exact title `Agent Orchestration Tasks`/);
  assert.match(role, /exactly one open epic/);
  assert.match(role, /zero or one task matches/);
  assert.match(role, /Never create a second task for the fingerprint/);
  assert.match(role, /observer never claims, starts, assigns, or completes/i);
});
