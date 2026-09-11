import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { run, writeJson } from '../../topology/lib/util.mjs';
import { canonicalRepoId, repoKey } from '../../topology/lib/repoid.mjs';
import {
  classifyFinding, closeObserver, discoverObserverTargets, escalationPlan,
  findingFingerprint, observerStatus, openObserver, recordFinding, redactEvidence,
  reportFinding, watchObservedRun,
} from '../../topology/lib/observer.mjs';
import { observerAckTimeout, prepareObserverSession, waitForObserverPrompt } from '../../topology/lib/observer-session.mjs';

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'ao-observer-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const repo = join(root, 'repo'), runDir = join(repo, '.bytedesk', 'agent-orchestration', 'runs', 'live');
  const home = join(root, 'home'), env = { ...process.env, AGENT_ORCHESTRATION_STATE_HOME: join(root, 'state') };
  await run('git', ['init', repo]);
  await mkdir(runDir, { recursive: true });
  const conductorBinding = { serverKey: '/tmp/tmux', serverPid: 10, sessionId: '$1', sessionCreated: 20, paneId: '%1', panePid: 30 };
  const observerBinding = { serverKey: '/tmp/tmux', serverPid: 10, sessionId: '$2', sessionCreated: 21, paneId: '%9', panePid: 31 };
  await writeJson(join(runDir, 'run.json'), { run_id: 'live', name: 'demo', state: 'running', session: 'demo-session', run_dir: runDir, consumer: repo,
    agents: [{ id: 'conductor', role: 'orchestrator', binding: conductorBinding }, { id: 'worker', role: 'worker' }] });
  const panes = [{ ...conductorBinding, sessionName: 'demo-session', alive: true }, { ...observerBinding, sessionName: 'ao-watcher', alive: true }];
  const tmux = { hasSession: async name => ['demo-session', 'ao-watcher'].includes(name), listServerPanes: async () => panes };
  const observerAgentDir = join(root, 'observer-agent');
  const prepareSession = async () => ({ agent: { id: 'watcher', _dir: observerAgentDir }, session: 'ao-watcher', pane: '%9', binding: observerBinding, prompt_revision: 'revision-1', prompt_acknowledged_at: new Date().toISOString(), reattached: true });
  const readPromptState = async () => ({ status: 'current', desired_revision: 'revision-1', applied_revision: 'revision-1', applied_binding: observerBinding });
  const activate = async () => ({ delivered: true });
  return { root, repo, runDir, home, env, tmux, panes, conductorBinding, observerBinding, prepareSession, activate, readPromptState, observerAgentDir };
}

const optionsFor = f => ({ consumer: f.repo, runDir: f.runDir, observerId: 'watcher', home: f.home, env: f.env,
  tmux: f.tmux, prepareSession: f.prepareSession, activate: f.activate, readPromptState: f.readPromptState });

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
    agents: [{ agentId: 'lead-1', sessionName: 'ao-lead-1', binding: { ...f.conductorBinding, sessionId: '$3', paneId: '%2', panePid: 32 } }],
  });
  const leadPane = { ...f.conductorBinding, sessionId: '$3', paneId: '%2', panePid: 32, sessionName: 'ao-lead-1', alive: true };
  const targets = await discoverObserverTargets({ consumer: f.repo, agentDirs: [agents], env: f.env, home: f.home,
    tmux: { hasSession: async name => name === 'demo-session' || name === 'ao-lead-1', listServerPanes: async () => [...f.panes, leadPane] } });
  const target = targets.find(item => item.kind === 'repository');
  assert.equal(target.id, `repository:${key}`);
  assert.equal(target.conductor, 'lead-1');
  const standingBinding = { ...f.observerBinding, sessionId: '$4', paneId: '%8', panePid: 33 };
  const opened = await openObserver({ consumer: f.repo, target: target.id, agentDirs: [agents], observerId: 'standing-watcher',
    env: f.env, home: f.home, tmux: { hasSession: async () => true, listServerPanes: async () => [...f.panes, leadPane, { ...standingBinding, sessionName: 'ao-standing-watcher', alive: true }] },
    prepareSession: async () => ({ agent: { id: 'standing-watcher', _dir: f.observerAgentDir }, session: 'ao-standing-watcher', pane: '%8', binding: standingBinding, prompt_revision: 'r', reattached: true }),
    readPromptState: async () => ({ status: 'current', desired_revision: 'r', applied_revision: 'r', applied_binding: standingBinding }), activate: f.activate });
  assert.equal(opened.attachment.kind, 'repository');
  assert.equal(opened.attachment.run_dir, null);
});

test('attachment requires explicit exact selection and is idempotent', async t => {
  const f = await fixture(t), options = optionsFor(f);
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

test('start commits no attachment before exact prompt acknowledgement', async t => {
  const f = await fixture(t), options = optionsFor(f);
  await assert.rejects(openObserver({ ...options, prepareSession: async () => {
    const error = new Error('no ack'); error.code = 'TOPOLOGY_PROMPT_ACK_TIMEOUT'; throw error;
  }}), { code: 'TOPOLOGY_PROMPT_ACK_TIMEOUT' });
  assert.equal((await observerStatus(options)).status, 'detached');
});

test('target binding drift fails closed before attachment commit', async t => {
  const f = await fixture(t), options = optionsFor(f);
  let calls = 0;
  const tmux = { ...f.tmux, listServerPanes: async () => ++calls === 1 ? f.panes : f.panes.map(pane =>
    pane.paneId === f.conductorBinding.paneId ? { ...pane, panePid: pane.panePid + 1 } : pane) };
  await assert.rejects(openObserver({ ...options, tmux }), { code: 'TOPOLOGY_OBSERVER_TARGET_BINDING' });
  assert.equal((await observerStatus(options)).status, 'detached');
});

test('managed observer reattaches only when current and otherwise requests one controlled restart', async t => {
  const f = await fixture(t), agentDir = join(f.root, 'agents', 'watcher');
  await mkdir(agentDir, { recursive: true });
  await writeJson(join(agentDir, 'session.json'), { agent_id: 'watcher', binding: f.observerBinding });
  const agent = { id: 'watcher', role: 'observer', coordinates_only: true, _dir: agentDir, env: {} };
  const runCase = async status => {
    const opens = [];
    const lifecycle = {
      requireAgent: async () => agent, refreshPrompt: async () => ({ status, applied_binding: f.observerBinding }),
      loadAdapters: async () => new Map(), adapterFor: () => ({ id: 'fake' }), buildArgv: () => ['fake'],
      openRoleSession: async input => { opens.push(input); return { pane: '%9', binding: f.observerBinding,
        reattached: !input.controlledRestart, restarted: input.controlledRestart, record: { binding: f.observerBinding } }; },
      readPromptState: async () => ({ status: 'current', desired_revision: 'r', applied_revision: 'r',
        desired_session: 'ao-watcher', applied_binding: f.observerBinding }),
    };
    const result = await prepareObserverSession({ consumer: f.repo, observerId: 'watcher', agentDirs: [dirname(agentDir)],
      home: f.home, env: f.env, tmux: f.tmux, lifecycle, timeoutMs: 10 });
    return { result, opens };
  };
  const current = await runCase('current');
  assert.equal(current.opens[0].controlledRestart, false);
  assert.equal(current.result.reattached, true);
  const stale = await runCase('restart-required');
  assert.equal(stale.opens.length, 1);
  assert.equal(stale.opens[0].controlledRestart, true);
  assert.equal(stale.result.restarted, true);
});

test('prompt wait rejects wrong binding and legacy attachments cannot observe or report', async t => {
  const f = await fixture(t), agent = { _dir: join(f.root, 'observer-agent') };
  let clock = 0;
  await assert.rejects(waitForObserverPrompt({ agent, session: 'ao-watcher', binding: f.observerBinding, timeoutMs: 2,
    now: () => clock, sleepFn: async () => { clock += 2; }, readState: async () => ({ status: 'current',
      desired_revision: 'r', applied_revision: 'r', desired_session: 'ao-watcher', applied_binding: { ...f.observerBinding, panePid: 999 } }) }),
    { code: 'TOPOLOGY_PROMPT_ACK_TIMEOUT' });
  const attachment = join(f.env.AGENT_ORCHESTRATION_STATE_HOME, 'observers', 'legacy', 'attachment.json');
  await mkdir(dirname(attachment), { recursive: true });
  await writeJson(attachment, { version: 1, observer_id: 'legacy', session: 'demo-session', run_dir: f.runDir });
  const legacy = { ...optionsFor(f), observerId: 'legacy' };
  assert.equal((await observerStatus(legacy)).status, 'legacy-attachment');
  await assert.rejects(watchObservedRun(legacy, { once: true }), { code: 'TOPOLOGY_OBSERVER_UNVERIFIED' });
  await assert.rejects(reportFinding('a'.repeat(64), { ...legacy, affectedConsumer: f.repo, affectedLead: 'a',
    marketplaceConsumer: f.repo, marketplaceLead: 'm', send: async () => ({}) }), { code: 'TOPOLOGY_OBSERVER_UNVERIFIED' });
});

test('verified observer can record and report the target-gone anomaly', async t => {
  const f = await fixture(t), options = optionsFor(f);
  await openObserver(options);
  f.panes.splice(f.panes.findIndex(pane => pane.paneId === f.conductorBinding.paneId), 1);
  const status = await observerStatus(options);
  assert.equal(status.status, 'target-gone');
  assert.equal(status.observer_verified, true);
  assert.equal(status.observation_allowed, true);
  const tick = await watchObservedRun(options, { once: true, intervalMs: 1000 });
  assert.equal(tick.recorded[0].record.signal, 'run-session-gone');
  const sent = [];
  await reportFinding(tick.recorded[0].record.fingerprint, { ...options, affectedConsumer: f.repo, affectedLead: 'a',
    marketplaceConsumer: f.repo, marketplaceLead: 'm', send: async envelope => { sent.push(envelope); return { status: 'delivered' }; } });
  assert.equal(sent.length, 2);
});

test('post-attach prompt staleness refuses direct persistence and reporting', async t => {
  const f = await fixture(t), options = optionsFor(f);
  await openObserver(options);
  const stale = { ...options, readPromptState: async () => ({ status: 'queued', desired_revision: 'revision-2',
    applied_revision: 'revision-1', applied_binding: f.observerBinding }) };
  assert.equal((await observerStatus(stale)).status, 'prompt-stale');
  await assert.rejects(recordFinding({ signal: 'enhancement' }, stale), { code: 'TOPOLOGY_OBSERVER_UNVERIFIED' });
  await assert.rejects(reportFinding('a'.repeat(64), { ...stale, affectedConsumer: f.repo, affectedLead: 'a',
    marketplaceConsumer: f.repo, marketplaceLead: 'm', send: async () => ({}) }), { code: 'TOPOLOGY_OBSERVER_UNVERIFIED' });
});

test('same-target legacy or degraded attachment upgrades transactionally and different target refuses', async t => {
  const f = await fixture(t), options = optionsFor(f), attachmentPath = join(f.env.AGENT_ORCHESTRATION_STATE_HOME, 'observers', 'watcher', 'attachment.json');
  const target = (await discoverObserverTargets(options))[0];
  await mkdir(dirname(attachmentPath), { recursive: true });
  await writeJson(attachmentPath, { version: 1, observer_id: 'watcher', ...target });
  const upgraded = await openObserver(options);
  assert.equal(upgraded.attachment.version, 2);
  assert.equal(upgraded.idempotent, false);
  await writeJson(attachmentPath, { ...upgraded.attachment, prompt_revision: 'old' });
  const repaired = await openObserver(options);
  assert.equal(repaired.attachment.prompt_revision, 'revision-1');
  await writeJson(attachmentPath, { version: 1, observer_id: 'watcher', ...target, id: 'run:different' });
  await assert.rejects(openObserver(options), { code: 'TOPOLOGY_OBSERVER_ALREADY_ATTACHED' });
});

test('observer acknowledgement timeout precedence is flag then env then legacy then default', () => {
  assert.equal(observerAckTimeout({ ackTimeout: '7s', legacyTimeout: '9s', env: { AO_OBSERVER_ACK_TIMEOUT_MS: '8000' } }), 7000);
  assert.equal(observerAckTimeout({ legacyTimeout: '9s', env: { AO_OBSERVER_ACK_TIMEOUT_MS: '8000' } }), 8000);
  assert.equal(observerAckTimeout({ legacyTimeout: '9s', env: {} }), 9000);
  assert.equal(observerAckTimeout({ env: {} }), 30000);
});

test('classification, redaction, fingerprint and delivery states are deterministic', async t => {
  const f = await fixture(t), options = optionsFor(f);
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
  const f = await fixture(t), options = optionsFor(f);
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
