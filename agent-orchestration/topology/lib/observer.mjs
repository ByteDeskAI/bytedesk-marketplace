// Read-only orchestration observer. It records its own attachment and findings under the
// host-local AO state root; it never mutates an observed run, task store, or observed tmux session.
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { loadRun, pendingReplies, readJournal } from './mailbox.mjs';
import { undeliveredReport } from './delivery.mjs';
import { findLead } from './agents.mjs';
import { readCensus } from './census.mjs';
import { canonicalRepoId, repoKey, stateRoot } from './repoid.mjs';
import { sameIncarnation } from './incarnation.mjs';
import { deliverObserverActivation, prepareObserverSession } from './observer-session.mjs';
import { readPromptState } from './prompts.mjs';
import * as defaultTmux from './tmux.mjs';
import { exists, invariant, nowIso } from './util.mjs';

const OBSERVER_ID = /^[A-Za-z0-9_-]{1,96}$/;
const TERMINAL_RUN_STATES = new Set(['complete', 'completed', 'failed', 'stopped', 'cancelled']);
const SECRET = /(api[_-]?key|authorization|bearer|password|passwd|secret|token)\s*[:=]\s*([^\s,;]+)/gi;

function digest(value) { return createHash('sha256').update(JSON.stringify(value)).digest('hex'); }
function safeObserverId(value) {
  const id = String(value || process.env.AO_AGENT_ID || 'observer');
  invariant(OBSERVER_ID.test(id), 'TOPOLOGY_OBSERVER_ID', 'Observer id must contain only letters, digits, dashes, or underscores.');
  return id;
}
function observerPaths({ env = process.env, home = homedir(), observerId } = {}) {
  const id = safeObserverId(observerId);
  const root = join(stateRoot(env, home), 'observers', id);
  return { id, root, attachment: join(root, 'attachment.json'), findings: join(root, 'findings') };
}
async function atomicJson(path, value) {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const temp = `${path}.${randomUUID()}.tmp`;
  try { await writeFile(temp, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 }); await rename(temp, path); }
  finally { await rm(temp, { force: true }); }
}
async function json(path) { try { return JSON.parse(await readFile(path, 'utf8')); } catch (error) { if (error.code === 'ENOENT') return null; throw error; } }

export function redactEvidence(value) {
  if (typeof value === 'string') return value.replace(SECRET, (_all, name) => `${name}=[REDACTED]`);
  if (Array.isArray(value)) return value.map(redactEvidence);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) =>
    /api.?key|authorization|password|passwd|secret|token/i.test(key) ? [key, '[REDACTED]'] : [key, redactEvidence(item)]));
  return value;
}

export function findingFingerprint({ repository, run_id, type, component }) {
  return digest([repository || null, run_id || null, type || 'unknown', component || 'orchestration']);
}

export function classifyFinding(input = {}) {
  const signal = String(input.signal || input.type || 'unknown');
  const breaking = new Set(['run-session-gone', 'worker-dead-with-claim', 'undelivered-message', 'supervisor-down', 'corrupt-journal', 'provider-auth-failure']);
  const improvement = new Set(['slow-stage', 'repeated-retry', 'excessive-queue-age', 'workflow-friction', 'enhancement']);
  return breaking.has(signal) ? 'breaking' : improvement.has(signal) ? 'improvement' : 'needs-triage';
}

export async function discoverObserverTargets({ consumer, agentDirs = [], tmux = defaultTmux, env = process.env, home = homedir() } = {}) {
  invariant(consumer, 'TOPOLOGY_OBSERVER_CONSUMER', 'Observer discovery needs a consumer repository.');
  const identity = await canonicalRepoId(consumer);
  const runsRoot = join(resolve(consumer), '.bytedesk', 'agent-orchestration', 'runs');
  const targets = [];
  for (const entry of (await readdir(runsRoot).catch(() => [])).sort()) {
    const runDir = join(runsRoot, entry);
    if (!(await exists(join(runDir, 'run.json')))) continue;
    const run = await loadRun(runDir).catch(() => null);
    if (!run?.session || TERMINAL_RUN_STATES.has(run.state)) continue;
    const conductor = run.agents?.find(agent => agent.role === 'orchestrator' && !agent.workflow);
    const conductorBinding = conductor?.binding;
    const panes = conductorBinding ? await tmux.listServerPanes({ tmuxServer: conductorBinding.serverKey }).catch(() => []) : [];
    if (!conductor?.id || !(await tmux.hasSession(run.session)) ||
        panes.filter(pane => pane.alive !== false && sameIncarnation(pane, conductorBinding)).length !== 1) continue;
    targets.push({ id: `run:${run.run_id}`, kind: 'run', repository: identity.id, repo_key: repoKey(identity.id), run_id: run.run_id, run_dir: runDir,
      name: run.name, state: run.state, session: run.session, conductor: conductor.id, conductor_binding: conductorBinding });
  }
  const lead = await findLead(agentDirs).catch(() => null);
  if (lead?.id) {
    const census = await readCensus({ consumer, env, home, identity }).catch(() => null);
    const row = census?.agents?.find(agent => agent.agentId === lead.id || agent.sessionName === `ao-${lead.id}`);
    const session = row?.sessionName || `ao-${lead.id}`;
    if (!census?.stale && row?.binding && await tmux.hasSession(session) &&
        (await tmux.listServerPanes({ tmuxServer: row.binding.serverKey }).catch(() => []))
          .filter(pane => pane.alive !== false && sameIncarnation(pane, row.binding)).length === 1) targets.push({
      id: `repository:${repoKey(identity.id)}`, kind: 'repository', repository: identity.id,
      repo_key: repoKey(identity.id), run_id: null, run_dir: null, name: 'Standing repository orchestration',
      state: 'running', session, conductor: lead.id, conductor_binding: row?.binding ?? null,
    });
  }
  return targets;
}

async function selectedTarget({ consumer, runDir, target, agentDirs = [], observerId, env = process.env, home = homedir(), tmux = defaultTmux } = {}) {
  const available = await discoverObserverTargets({ consumer, agentDirs, tmux, env, home });
  invariant(runDir || target, 'TOPOLOGY_OBSERVER_SELECTION', 'Select one live orchestration with --target <id> or --run <run_dir>.');
  const wanted = runDir ? resolve(runDir) : String(target);
  const matches = available.filter(item => runDir ? item.run_dir && resolve(item.run_dir) === wanted : item.id === wanted);
  invariant(matches.length === 1, 'TOPOLOGY_OBSERVER_SELECTION', 'The selected run is absent, terminal, ambiguous, or has no verified live conductor.', { candidates: available });
  return matches[0];
}

async function targetStillExact(selected, tmux) {
  const panes = await tmux.listServerPanes({ tmuxServer: selected.conductor_binding?.serverKey }).catch(() => []);
  return panes.filter(pane => pane.alive !== false && pane.sessionName === selected.session && sameIncarnation(pane, selected.conductor_binding)).length === 1;
}

export async function startObserver(options = {}) {
  const { consumer, observerId, env = process.env, home = homedir(), tmux = defaultTmux } = options;
  const paths = observerPaths({ env, home, observerId });
  const selected = await selectedTarget(options);
  const prior = await json(paths.attachment);
  if (prior) {
    invariant(prior.repository === selected.repository && prior.id === selected.id && prior.conductor === selected.conductor,
      'TOPOLOGY_OBSERVER_ALREADY_ATTACHED', 'Observer is already attached to a different orchestration; close it first.');
    if (prior.version === 2 && prior.observation_allowed === true) {
      const status = await observerStatus(options);
      if (status.observer_verified && status.target_alive) return { status: 'attached', idempotent: true, attachment: prior, activation: null };
    }
  }
  const activation = await (options.prepareSession ?? prepareObserverSession)({ ...options, observerId: paths.id });
  invariant(await targetStillExact(selected, tmux), 'TOPOLOGY_OBSERVER_TARGET_BINDING', 'The selected conductor incarnation changed during observer startup; no attachment was created.');
  const attachment = { version: 2, observer_id: paths.id, ...selected, observer_session: activation.session,
    observer_binding: activation.binding, prompt_revision: activation.prompt_revision,
    observer_agent_dir: activation.agent?._dir ?? null,
    prompt_acknowledged_at: activation.prompt_acknowledged_at, observation_allowed: true,
    attached_at: nowIso(), privileges: 'read-only', coordinates_only: true };
  await atomicJson(paths.attachment, attachment);
  const activate = options.activate ?? deliverObserverActivation;
  const activationDelivery = await activate(activation,
    `Observer activation is verified. Monitor ${selected.id} with ao-topology observer watch --consumer ${resolve(consumer)} --observer ${paths.id}.`)
    .catch(error => ({ delivered: false, reason: error.code ?? error.message }));
  const { adapter: _adapter, agent: _agent, ...publicActivation } = activation;
  return { status: 'attached', idempotent: false, attachment, activation: publicActivation, activation_delivery: activationDelivery };
}

// Kept as the established spelling, but it is now the same proof-gated transaction as `start`.
export const openObserver = startObserver;

export async function observerStatus(options = {}) {
  const paths = observerPaths(options);
  const attachment = await json(paths.attachment);
  if (!attachment) return { status: 'detached', observer_id: paths.id };
  if (attachment.version !== 2 || attachment.observation_allowed !== true) return {
    status: 'legacy-attachment', observer_id: paths.id, observation_allowed: false, attachment,
  };
  const tmux = options.tmux ?? defaultTmux;
  const [targetAlive, observerAlive, prompt] = await Promise.all([
    targetStillExact(attachment, tmux),
    (async () => {
      const panes = await tmux.listServerPanes({ tmuxServer: attachment.observer_binding?.serverKey }).catch(() => []);
      return panes.filter(pane => pane.alive !== false && pane.sessionName === attachment.observer_session && sameIncarnation(pane, attachment.observer_binding)).length === 1;
    })(),
    attachment.observer_agent_dir ? (options.readPromptState ?? readPromptState)(attachment.observer_agent_dir) : null,
  ]);
  const promptCurrent = prompt?.status === 'current' && prompt.applied_revision === attachment.prompt_revision &&
    prompt.desired_revision === attachment.prompt_revision && sameIncarnation(prompt.applied_binding, attachment.observer_binding);
  const observerVerified = observerAlive && promptCurrent;
  const status = !observerAlive ? 'observer-gone' : !promptCurrent ? 'prompt-stale' : targetAlive ? 'attached' : 'target-gone';
  return { status, observer_id: paths.id, observer_verified: observerVerified, target_alive: targetAlive,
    prompt_current: promptCurrent, observation_allowed: observerVerified, attachment };
}

export async function closeObserver(options = {}) {
  const paths = observerPaths(options);
  const existed = await exists(paths.attachment);
  await rm(paths.attachment, { force: true });
  return { status: 'detached', observer_id: paths.id, removed: existed };
}

export async function inspectObservedRun(options = {}) {
  const status = await observerStatus(options);
  invariant(status.attachment, 'TOPOLOGY_OBSERVER_DETACHED', 'Observer is not attached.');
  invariant(status.attachment.version === 2 && status.observer_verified === true,
    'TOPOLOGY_OBSERVER_UNVERIFIED', 'Observer attachment is legacy or its exact process proof is no longer valid; start it again before observing.');
  if (status.attachment.kind === 'repository') {
    const census = await readCensus({ ...options, consumer: options.consumer }).catch(() => null);
    const findings = [];
    if (status.status === 'target-gone') findings.push({ signal: 'run-session-gone', component: 'conductor', summary: 'The standing repository conductor session is gone.' });
    if (!census || census.stale) findings.push({ signal: 'supervisor-down', component: 'census', summary: 'The repository census is missing or stale.' });
    else for (const agent of census.agents || []) {
      if (agent.state === 'dead') findings.push({ signal: 'worker-dead-with-claim', component: agent.agentId, summary: `${agent.displayName || agent.agentId} is dead.`, evidence: { state: agent.state, reason: agent.reason } });
      if (agent.state === 'quota-blocked') findings.push({ signal: 'provider-auth-failure', component: agent.agentId, summary: `${agent.displayName || agent.agentId} is quota blocked.`, evidence: { state: agent.state, reason: agent.reason } });
      if (agent.mailStuck || agent.undeliveredMessages?.length) findings.push({ signal: 'undelivered-message', component: agent.agentId, summary: `${agent.displayName || agent.agentId} has undelivered mail.`, evidence: { messages: agent.undeliveredMessages || [] } });
    }
    return { attachment: status.attachment, observed_at: nowIso(), findings: findings.map(item => ({ ...item, severity: classifyFinding(item) })) };
  }
  const run = await loadRun(status.attachment.run_dir).catch(() => null);
  const findings = [];
  if (!run) findings.push({ signal: 'corrupt-journal', component: 'run-record', summary: 'The selected run record cannot be read.' });
  else {
    if (status.status === 'target-gone' && !TERMINAL_RUN_STATES.has(run.state)) findings.push({ signal: 'run-session-gone', component: 'tmux-session', summary: 'The run is active but its tmux session is gone.' });
    for (const item of await undeliveredReport(status.attachment.run_dir).catch(() => [])) findings.push({ signal: 'undelivered-message', component: item.agent || 'mailbox', summary: item.reason || 'A persisted message was not delivered.', evidence: item });
    const pending = await pendingReplies(status.attachment.run_dir).catch(() => []);
    const journal = await readJournal(status.attachment.run_dir, 100).catch(() => []);
    if (journal.some(event => event.type === 'provider.auth_error')) findings.push({ signal: 'provider-auth-failure', component: 'provider', summary: 'A provider authentication failure stopped progress.' });
    if (pending.length > 10) findings.push({ signal: 'excessive-queue-age', component: 'mailbox', summary: `${pending.length} replies are pending.`, evidence: { count: pending.length } });
  }
  return { attachment: status.attachment, observed_at: nowIso(), findings: findings.map(item => ({ ...item, severity: classifyFinding(item) })) };
}

export async function recordFinding(finding, options = {}) {
  const { observerId, env = process.env, home = homedir(), now = Date.now(), cooldownMs = 300000 } = options;
  const paths = observerPaths({ observerId, env, home });
  const status = await observerStatus(options);
  const attachment = status.attachment;
  invariant(attachment, 'TOPOLOGY_OBSERVER_DETACHED', 'Observer is not attached.');
  invariant(status.observer_verified === true, 'TOPOLOGY_OBSERVER_UNVERIFIED', 'Observer process or prompt proof is no longer current; start the observer again.');
  const clean = redactEvidence(finding);
  const severity = classifyFinding(clean);
  const fingerprint = findingFingerprint({ repository: attachment.repository, run_id: attachment.run_id, type: clean.signal || clean.type, component: clean.component });
  const path = join(paths.findings, `${fingerprint}.json`);
  const prior = await json(path);
  const timestamp = new Date(now).toISOString();
  const record = prior ? { ...prior, last_seen: timestamp, occurrences: prior.occurrences + 1, evidence: clean.evidence ?? prior.evidence }
    : { version: 1, fingerprint, observer_id: paths.id, repository: attachment.repository, run_id: attachment.run_id,
      severity, signal: clean.signal || clean.type || 'unknown', component: clean.component || 'orchestration', summary: clean.summary || '', evidence: clean.evidence ?? null,
      first_seen: timestamp, last_seen: timestamp, occurrences: 1, delivery: { persisted: timestamp, notified: null, acknowledged: null, resolved: null } };
  await atomicJson(path, record);
  const lastNotice = prior?.delivery?.notified ? Date.parse(prior.delivery.notified) : 0;
  return { record, notify: !lastNotice || now - lastNotice >= cooldownMs, duplicate: Boolean(prior) };
}

export async function loadFinding(fingerprint, options = {}) {
  invariant(/^[0-9a-f]{64}$/.test(String(fingerprint || '')), 'TOPOLOGY_OBSERVER_FINDING', 'Finding fingerprint must be a SHA-256 value.');
  const paths = observerPaths(options);
  const record = await json(join(paths.findings, `${fingerprint}.json`));
  invariant(record, 'TOPOLOGY_OBSERVER_FINDING', 'Observer finding does not exist.');
  return record;
}

export async function watchObservedRun(options = {}, { once = false, intervalMs = 5000, onTick = () => {} } = {}) {
  invariant(Number.isFinite(intervalMs) && intervalMs >= 1000, 'TOPOLOGY_OBSERVER_INTERVAL', 'Observer interval must be at least one second.');
  for (;;) {
    const inspection = await inspectObservedRun(options);
    const recorded = [];
    for (const finding of inspection.findings) recorded.push(await recordFinding(finding, options));
    await onTick({ ...inspection, recorded });
    if (once) return { ...inspection, recorded };
    await new Promise(resolve => setTimeout(resolve, intervalMs));
  }
}

export function escalationPlan(record, { affectedLead, marketplaceLead, marketplaceRepository } = {}) {
  invariant(record?.fingerprint, 'TOPOLOGY_OBSERVER_FINDING', 'A persisted observer finding is required.');
  invariant(affectedLead && marketplaceLead && marketplaceRepository, 'TOPOLOGY_OBSERVER_AUTHORITY', 'Verified affected and Marketplace leads are required.');
  const breaking = record.severity === 'breaking';
  return { finding: record.fingerprint, recipients: breaking ? [affectedLead, marketplaceLead] : [affectedLead],
    next: breaking ? 'dispatch-requested' : 'affected-lead-verification-required', observer_may_dispatch: false,
    marketplace: { repository: marketplaceRepository, lead: marketplaceLead, epic_title: 'Agent Orchestration Tasks', create_or_update_by_fingerprint: true } };
}


/** Reporting is the observer's only outward mutation. It sends durable, non-assignment mail;
 * conductors retain all authority to verify, create tasks, or dispatch workers. */
export async function reportFinding(fingerprint, {
  observerId, env = process.env, home = homedir(), affectedConsumer, affectedLead,
  marketplaceConsumer, marketplaceLead, send, ...runtime
} = {}) {
  invariant(affectedConsumer && affectedLead && marketplaceConsumer && marketplaceLead,
    'TOPOLOGY_OBSERVER_AUTHORITY', 'Reporting needs explicit affected and Marketplace repositories and leads.');
  invariant(typeof send === 'function', 'TOPOLOGY_OBSERVER_SENDER', 'Reporting needs a durable standing-mail sender.');
  const paths = observerPaths({ observerId, env, home });
  const status = await observerStatus({ observerId, env, home, ...runtime });
  const attachment = status.attachment;
  invariant(attachment, 'TOPOLOGY_OBSERVER_DETACHED', 'Observer is not attached.');
  invariant(status.observer_verified === true, 'TOPOLOGY_OBSERVER_UNVERIFIED', 'Observer process or prompt proof is no longer current; start the observer again.');
  const record = await loadFinding(fingerprint, { observerId, env, home });
  const plan = escalationPlan(record, { affectedLead, marketplaceLead, marketplaceRepository: marketplaceConsumer });
  const common = {
    version: 1, kind: 'agent-orchestration-observer-finding', fingerprint: record.fingerprint,
    severity: record.severity, signal: record.signal, component: record.component,
    summary: record.summary, evidence: redactEvidence(record.evidence), occurrences: record.occurrences,
    observed_repository: record.repository, observed_run: record.run_id,
    observer_may_dispatch: false, epic_title: 'Agent Orchestration Tasks',
  };
  const requests = [{
    consumer: affectedConsumer, to: affectedLead, id: `observer:${record.fingerprint}:affected`,
    stage: record.severity === 'breaking' ? 'breaking-observer-finding' : 'observer-finding-verification',
    subject: `[${record.severity}] ${record.summary || record.signal}`,
    body: JSON.stringify({ ...common, requested_action: record.severity === 'breaking'
      ? 'Verify impact immediately and coordinate with the Marketplace conductor.'
      : 'Verify this non-breaking finding. If valid, forward it to the Marketplace conductor for task creation or update by fingerprint.' }),
  }];
  if (record.severity === 'breaking') requests.push({
    consumer: marketplaceConsumer, to: marketplaceLead, id: `observer:${record.fingerprint}:marketplace`,
    stage: 'breaking-observer-finding', subject: `[breaking] ${record.summary || record.signal}`,
    body: JSON.stringify({ ...common, requested_action: 'Create or update the fingerprinted task in the exact epic, then dispatch it through normal task-management authority.' }),
  });
  const results = [];
  for (const request of requests) results.push(await send({ ...request, fromProject: affectedConsumer,
    from: paths.id, provenance: { source: 'agent-orchestration observer', observer: paths.id }, assignment: false, via: [] }));
  const delivered = results.every(result => result.status === 'delivered');
  const updated = { ...record, delivery: { ...record.delivery, notified: delivered ? nowIso() : record.delivery.notified,
    last_attempt: nowIso(), state: delivered ? 'delivered' : 'held' } };
  await atomicJson(join(paths.findings, `${record.fingerprint}.json`), updated);
  return { plan, delivered, results, record: updated };
}
