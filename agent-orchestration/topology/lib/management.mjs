// Task-store-backed management. The task store owns claims, WIP and worktree provisioning;
// orchestration owns communication and the review/check/landing evidence it contributes.
import { homedir } from 'node:os';
import { createHash } from 'node:crypto';
import { basename, dirname, isAbsolute, join, resolve } from 'node:path';
import { readFile, readdir, realpath } from 'node:fs/promises';
import { listServerPanes } from './tmux.mjs';
import { readCensus } from './census.mjs';
import { loadConfig } from './config.mjs';
import { agentDirs, findLead } from './agents.mjs';
import { withLock } from './lockfile.mjs';
import { canonicalRepoId, repoKey, stateRoot } from './repoid.mjs';
import { reviewEligibility, reviewerAvailability, requestReview } from './reviewer.mjs';
import { observeNativeWorkflow } from './workflow-control.mjs';
import { readStandingMessage, sendStandingMessage } from './standing-mailbox.mjs';
import { invariant, nowIso, readJson, run, writeJson } from './util.mjs';

const taskId = value => { invariant(/^TM-[0-9]+$/.test(value), 'TOPOLOGY_MANAGEMENT_TASK', 'Expected a task-store TM id.'); return value; };
const nonempty = value => typeof value === 'string' && value.trim().length > 0;
const list = value => Array.isArray(value) && value.every(nonempty);
const git = async (cwd, args, allowFailure = false) => run('git', ['-C', cwd, ...args], { allowFailure });
const gitText = async (cwd, args) => (await git(cwd, args)).stdout.trim();

/** Execute the repository's existing tm launcher, never a second provisioner or a shell. */
export async function taskStore({ consumer, owner = null, env = process.env, tmBin = null }) {
  const identity = await canonicalRepoId(consumer);
  invariant(identity.kind === 'git-common-dir', 'TOPOLOGY_MANAGEMENT_REPO', 'Management requires a Git repository.');
  const entries = (await gitText(consumer, ['worktree', 'list', '--porcelain'])).split('\n\n');
  const main = entries.find(entry => !entry.split('\n').includes('bare'));
  const root = main?.match(/^worktree (.+)$/m)?.[1];
  invariant(root && isAbsolute(root), 'TOPOLOGY_MANAGEMENT_REPO', 'No non-bare checkout exists for the task store.');
  const bin = tmBin || join(root, '.bytedesk/task-management/bin/tm');
  invariant(isAbsolute(bin), 'TOPOLOGY_MANAGEMENT_TM', 'tm launcher must be absolute.');
  const exec = async (args, cwd = root) => run(bin, args, { cwd, env: { ...env, TM_ROOT: root, CLAUDE_PROJECT_DIR: cwd, ...(owner ? { TM_SESSION_ID: owner } : {}) } });
  const where = JSON.parse((await exec(['where'])).stdout);
  invariant(isAbsolute(where.store), 'TOPOLOGY_MANAGEMENT_STORE', 'tm did not identify its task store.');
  return {
    root,
    workers: async () => Object.values((await readJson(join(where.store, 'agents.json')).catch(error => { if (error.code === 'ENOENT') return { agents: {} }; throw error; })).agents || {}),
    show: async id => JSON.parse((await exec(['show', taskId(id), '--json'])).stdout),
    claim: async id => (await readJson(join(where.store, 'state.json'))).claims?.[taskId(id)] || null,
    provision: async id => exec(['worktree', 'new', taskId(id)]),
    start: async (id, cwd) => exec(['start', taskId(id)], cwd),
    comment: async (id, value) => exec(['comment', taskId(id), value]),
    evidence: async (id, path) => exec(['evidence', taskId(id), path]),
    removeWorktree: async id => exec(['worktree', 'rm', taskId(id)]),
    done: async id => exec(['done', taskId(id)]),
    govern: async (id, governance) => exec(['govern',taskId(id),'--workflow',governance.workflowRunId,'--lead',governance.leadId,'--record',governance.recordPath]),
    reviewReady: async (id, revision) => exec(['review-ready',taskId(id),'--revision',revision]),
  };
}

async function context(options) {
  const { consumer, env = process.env, home = homedir() } = options;
  const identity = await canonicalRepoId(consumer);
  const root = join(stateRoot(env, home), 'management', repoKey(identity.id));
  const path = join(root, `${taskId(options.task)}.json`);
  const store = options.store || await taskStore(options);
  return { root, path, store, identity, env, home };
}
const loadRecord = async path => readJson(path).catch(error => { if (error.code === 'ENOENT') return null; throw error; });
async function recordEvent(ctx, task, prior, event, details) {
  const entry = { event, at: nowIso(), ...details };
  // Comment first: a failed task-store write must never claim the lead received the protocol.
  await ctx.store.comment(task, JSON.stringify(entry));
  const next = { ...prior, task, repo_id: ctx.identity.id, events: [...(prior?.events || []), entry], updated_at: entry.at };
  await writeJson(ctx.path, next);
  return next;
}
function ownClaim(claim, owner) {
  invariant(claim && claim.session === owner, 'TOPOLOGY_MANAGEMENT_OWNERSHIP', 'Task claim is missing, unknown, or held by another session; reconcile ownership without stealing.');
}
async function ownedTask(ctx, task, owner) {
  const doc = await ctx.store.show(task);
  ownClaim(await ctx.store.claim(task), owner);
  invariant(doc.worktree && doc.branch, 'TOPOLOGY_MANAGEMENT_WORKTREE', 'tm must provision and record the task worktree and branch.');
  invariant((await canonicalRepoId(doc.worktree)).id === ctx.identity.id && await realpath(doc.worktree) !== await realpath(ctx.store.root), 'TOPOLOGY_MANAGEMENT_WORKTREE', 'Task worktree must be isolated within this repository.');
  invariant(await gitText(doc.worktree, ['symbolic-ref', '--short', 'HEAD']) === doc.branch, 'TOPOLOGY_MANAGEMENT_BRANCH', 'Task worktree branch differs from the task store.');
  return doc;
}

const bindingKeys = ['serverKey', 'serverPid', 'sessionId', 'sessionCreated', 'paneId', 'panePid'];
async function processStart(pid) {
  if (!Number.isSafeInteger(pid) || pid <= 0) return null;
  try {
    const raw = await readFile(`/proc/${pid}/stat`, 'utf8');
    return { start: raw.slice(raw.lastIndexOf(')') + 2).split(' ')[19], boot: (await readFile('/proc/sys/kernel/random/boot_id', 'utf8')).trim(), cwd: await realpath(`/proc/${pid}/cwd`) };
  } catch { return null; }
}
function processGone(pid) {
  try { process.kill(pid, 0); return false; } catch (error) { return error.code === 'ESRCH'; }
}
async function registeredWorker(ctx, doc, owner) {
  ownClaim(await ctx.store.claim(doc.id), owner);
  invariant(doc.dispatched?.run && doc.dispatched.session === owner, 'TOPOLOGY_MANAGEMENT_WORKER', 'Task dispatch must name the claim owner and worker run.');
  invariant(typeof ctx.store.workers === 'function', 'TOPOLOGY_MANAGEMENT_WORKER', 'Task store has no worker registry adapter.');
  const rows = (await ctx.store.workers()).filter(row => row.session === owner && row.runId === doc.dispatched.run && row.backend === doc.dispatched.backend);
  invariant(rows.length === 1, 'TOPOLOGY_MANAGEMENT_WORKER', 'Exactly one task-store worker must match the dispatch and claim.');
  return rows[0];
}

// Native identity comes from the producer's authenticated records and exact observations.
// Exclude changing liveness and record paths: an exact member can exit, and a legacy record
// can move into durable storage, without becoming a different task writer.
function nativeWriterIdentity(observation) {
  invariant(observation && typeof observation.runId === 'string' && Array.isArray(observation.agents) && Array.isArray(observation.children),
    'TOPOLOGY_MANAGEMENT_WORKER', 'Native producer returned incomplete workflow ownership.');
  return {
    run_id: observation.runId,
    repository_id: observation.repositoryId,
    task_id: observation.taskId ?? null,
    parent_agent_id: observation.parentAgentId ?? null,
    workload_cwd: observation.workloadCwd,
    write_authority: observation.writeAuthority ?? null,
    members: observation.agents.map(member => ({ id: member.id, pane: member.pane ?? null,
      binding: member.binding ? Object.fromEntries(bindingKeys.map(key => [key, member.binding[key]])) : null })).sort((left, right) => String(left.id).localeCompare(String(right.id))),
    children: observation.children.map(nativeWriterIdentity).sort((left, right) => left.run_id.localeCompare(right.run_id)),
  };
}

async function observedNativeWorker(ctx, doc) {
  const dispatched = doc.dispatched;
  invariant(typeof dispatched?.nativeRunId === 'string' && isAbsolute(dispatched.recordPath || '') && basename(dispatched.recordPath) === 'run.json',
    'TOPOLOGY_MANAGEMENT_WORKER', 'Topology dispatch needs its authentic native run ID and record path; reconcile the task through tm collect before reporting a finish.');
  invariant(!dispatched.workflowRunId || dispatched.workflowRunId === `topology:${dispatched.nativeRunId}`,
    'TOPOLOGY_MANAGEMENT_WORKER', 'Canonical workflow and native task run IDs differ.');
  const observation = await observeNativeWorkflow({ consumer: ctx.store.root, runDir: dirname(dispatched.recordPath),
    nativeRunId: dispatched.nativeRunId, taskId: doc.id, workloadCwd: doc.worktree, stateHome: stateRoot(ctx.env, ctx.home) });
  invariant(observation.runId === dispatched.nativeRunId && observation.observationError === null && typeof observation.hasLiveWriters === 'boolean' && typeof observation.fingerprint === 'string',
    'TOPOLOGY_MANAGEMENT_WORKER', 'Native producer could not establish every task writer incarnation.');
  return { observation, identity: nativeWriterIdentity(observation) };
}

async function observeWorker(ctx, doc, owner) {
  const row = await registeredWorker(ctx, doc, owner);
  const base = { name: row.name, run: row.runId, backend: row.backend, owner, registered_at: row.registeredAt, observed_at: nowIso() };
  if (row.backend === 'topology') {
    const { observation, identity } = await observedNativeWorker(ctx, doc);
    return { ...base, kind: 'topology', native_run_id: observation.runId, record_path: join(observation.runDir, 'run.json'), native_fingerprint: observation.fingerprint, native_identity: identity };
  }
  invariant(row.status === 'active', 'TOPOLOGY_MANAGEMENT_WORKER', 'Only a currently live registered worker can establish a new ownership binding.');
  if (row.backend === 'tmux') {
    const prefix = `${row.backend}:`;
    invariant(row.runId.startsWith(prefix), 'TOPOLOGY_MANAGEMENT_WORKER', 'Invalid task worker session handle.');
    const session = row.runId.slice(prefix.length);
    // TM-167: the worker's named session, not the whole implicit server. The registry row records no
    // server, so the SERVER here is still implicit ($TMUX or the default socket); the realpath check on
    // the pane's cwd below is what refuses a same-named session on some other server.
    const panes = (await listServerPanes({ session, env: ctx.env })).filter(p => p.sessionName === session && p.alive);
    invariant(panes.length === 1 && await realpath(panes[0].cwd) === await realpath(doc.worktree), 'TOPOLOGY_MANAGEMENT_WORKER', 'Worker must have one observed live pane in its task-owned worktree; unknown or multi-pane ownership needs explicit reconciliation.');
    return { ...base, kind: 'tmux', session_name: session, binding: Object.fromEntries(bindingKeys.map(key => [key, panes[0][key]])) };
  }
  const process = await processStart(row.pid);
  invariant(process && process.cwd === await realpath(doc.worktree), 'TOPOLOGY_MANAGEMENT_WORKER', 'Worker PID must be observed alive in the task-owned worktree.');
  return { ...base, kind: 'process', pid: row.pid, process_start: process.start, boot: process.boot };
}

/** Bind observed ownership after tm dispatch, without trusting caller-supplied pid/idle flags. */
export async function bindTaskWorker(options) {
  const ctx = await context(options);
  return withLock(`${ctx.path}.lock`, async () => {
    const prior = await loadRecord(ctx.path);
    invariant(prior?.started && prior.owner === options.owner, 'TOPOLOGY_MANAGEMENT_WORKER', 'Admit the task and reconcile ownership before binding a worker.');
    const doc = await ownedTask(ctx, options.task, options.owner);
    const worker = await observeWorker(ctx, doc, options.owner);
    invariant(!prior.worker || JSON.stringify({ ...prior.worker, observed_at: null }) === JSON.stringify({ ...worker, observed_at: null }), 'TOPOLOGY_MANAGEMENT_WORKER', 'Worker incarnation changed; preserve work and reconcile rather than rebinding a successor.');
    const record = await recordEvent(ctx, options.task, prior, 'worker-bound', { worker });
    record.worker = worker; await writeJson(ctx.path, record);
    return { bound: true, worker };
  });
}

/** Default production proof. An observed exited process plus a collected finish report is safe;
 * a live process is always active/unknown. Registry TTL/dead labels never prove process death.
 */
export async function taskWorkerState(options, record) {
  const ctx = await context(options);
  try {
    const doc = await ownedTask(ctx, options.task, record?.owner);
    const row = await registeredWorker(ctx, doc, record.owner), worker = record.worker;
    invariant(worker && worker.owner === record.owner && worker.name === row.name && worker.run === row.runId && worker.backend === row.backend && worker.registered_at === row.registeredAt, 'TOPOLOGY_MANAGEMENT_WORKER', 'No matching observed task-worker incarnation.');
    invariant(record.finish && record.events?.some(event => event.event === 'finish' && event.report?.revision === record.finish.revision), 'TOPOLOGY_MANAGEMENT_WORKER', 'Task worker result has not been collected through the finish protocol.');
    if (row.backend === 'topology') {
      invariant(worker.kind === 'topology' && worker.native_identity, 'TOPOLOGY_MANAGEMENT_WORKER', 'Legacy native ownership must be reconciled through a new verified finish report.');
      const { observation, identity } = await observedNativeWorker(ctx, doc);
      invariant(worker.native_run_id === observation.runId && worker.native_fingerprint === observation.fingerprint && JSON.stringify(worker.native_identity) === JSON.stringify(identity),
        'TOPOLOGY_MANAGEMENT_WORKER', 'Native workflow membership or incarnation changed after the finish report; preserve it and submit a new verified finish.');
      return { owned: true, active: observation.hasLiveWriters, alive: observation.hasLiveWriters,
        proof: observation.hasLiveWriters ? 'observed-native-writers-live' : 'observed-native-workflow-exited', worker,
        ...(observation.hasLiveWriters ? { reason: 'An exact native workflow member or child is still alive; stop every task writer before integration.' } : {}) };
    }
    if (worker.kind === 'process') {
      invariant(row.pid === worker.pid, 'TOPOLOGY_MANAGEMENT_WORKER', 'Registered worker PID changed.');
      if (processGone(worker.pid)) return { owned: true, active: false, alive: false, proof: 'observed-process-exited', worker };
      const current = await processStart(worker.pid);
      invariant(current && current.start === worker.process_start && current.boot === worker.boot, 'TOPOLOGY_MANAGEMENT_WORKER', 'Worker PID identity is unknown or was reused.');
      return { owned: true, active: true, alive: true, reason: 'Observed worker is still alive; finish its process before integration.' };
    }
    const panes = await listServerPanes({ tmuxServer: worker.binding.serverKey, env: ctx.env });
    const pane = panes.find(p => bindingKeys.every(key => p[key] === worker.binding[key]));
    if (!pane || !pane.alive) {
      // A replacement in the same session is another writer, not evidence the task is idle.
      invariant(!panes.some(p => p.alive && (p.sessionId === worker.binding.sessionId || p.sessionName === worker.session_name || resolve(p.cwd) === resolve(doc.worktree))), 'TOPOLOGY_MANAGEMENT_WORKER', 'Worker session contains a replacement live pane.');
      return { owned: true, active: false, alive: false, proof: 'observed-pane-exited', worker };
    }
    return { owned: true, active: true, alive: true, reason: 'Observed worker pane is still alive; its activity is not safely known.' };
  } catch (error) { return { owned: false, active: true, alive: null, reason: error.message }; }
}

/** New admission requires readiness before tm start (which enforces dependencies/claim/WIP).
 * An already active adopted worker is never moved; the response schedules ownership review.
 */
export async function admitTask(options) {
  const ctx = await context(options), { task, owner, intent, boundaries, dependencies, checks } = options;
  invariant(nonempty(owner) && nonempty(intent) && list(boundaries) && boundaries.length && list(dependencies) && list(checks) && checks.length, 'TOPOLOGY_MANAGEMENT_START_PROTOCOL', 'Start requires owner, intended change, boundaries, dependencies and required checks.');
  return withLock(`${ctx.path}.lock`, async () => {
    const doc = await ctx.store.show(task), prior = await loadRecord(ctx.path);
    const held = await ctx.store.claim(task);
    if (doc.status === 'in_progress' && (!prior || prior.owner !== owner)) {
      await recordEvent(ctx, task, prior, 'ownership-review-required', { owner, existing_owner: held?.session || null, worktree: doc.worktree || null, recovery: 'Preserve the live worker and its work; review ownership and schedule migration at a safe boundary.' });
      return { admitted: false, state: 'ownership-review-required' };
    }
    if (held) ownClaim(held, owner); // TTL expiry never authorizes silent reassignment here.
    if (prior?.owner === owner && prior.started) { await ownedTask(ctx, task, owner); return { admitted: true, resumed: true, record: prior }; }
    invariant(doc.labels?.includes('ready-for-agent') && list(doc.touches) && doc.touches.length, 'TOPOLOGY_MANAGEMENT_SCOPE', 'Task needs approved ready-for-agent scope and declared files/touches.');
    const available = await (options.reviewerReady || reviewerAvailability)(options);
    invariant(available.available, 'TOPOLOGY_MANAGEMENT_REVIEWER', available.reason || 'Designated reviewer is not ready.');
    for (const id of doc.blockedBy || []) invariant((await ctx.store.show(id)).status === 'done', 'TOPOLOGY_MANAGEMENT_DEPENDENCY', `Dependency ${id} is not complete.`);
    if (!doc.worktree || resolve(doc.worktree) === resolve(ctx.store.root)) await ctx.store.provision(task);
    const provisioned = await ownedTask(ctx, task, owner);
    await ctx.store.start(task, provisioned.worktree);
    const record = await recordEvent(ctx, task, prior, 'start', { owner, worktree: provisioned.worktree, branch: provisioned.branch, intent, boundaries, dependencies, checks, files: doc.touches });
    const lead=await findLead(agentDirs({...options,consumer:ctx.store.root}));
    const workflowRunId=options.workflowRunId || provisioned.dispatched?.workflowRunId || `tm-${task}`;
    const leadId=lead?.id || options.leadId || owner;
    Object.assign(record, { base_revision: await gitText(provisioned.worktree, ['rev-parse', 'HEAD']), owner, workflow_run_id:workflowRunId,lead_id:leadId, worktree: provisioned.worktree, branch: provisioned.branch, started: true, state: 'working' });
    await writeJson(ctx.path, record);
    await ctx.store.govern?.(task,{workflowRunId,leadId,recordPath:ctx.path});
    return { admitted: true, record };
  });
}

/** Mechanically validate before/during/finish reports; finish is never task completion. */
export async function workerReport(options) {
  const ctx = await context(options), { task, owner, kind, report } = options;
  return withLock(`${ctx.path}.lock`, async () => {
    const prior = await loadRecord(ctx.path);
    invariant(prior?.started && prior.owner === owner, 'TOPOLOGY_MANAGEMENT_PROTOCOL', 'Worker must be admitted and send its start report before reporting work.');
    const doc = await ownedTask(ctx, task, owner);
    invariant(['blocker', 'scope-change', 'ownership-conflict', 'stale-activity', 'failed-check', 'finish'].includes(kind), 'TOPOLOGY_MANAGEMENT_PROTOCOL', 'Unknown worker report kind.');
    if (kind === 'finish') {
      invariant(report && list(report.artifacts) && report.artifacts.length && list(report.checks) && report.checks.length && list(report.risks) && nonempty(report.evidence), 'TOPOLOGY_MANAGEMENT_FINISH_PROTOCOL', 'Finish requires artifacts, checks/evidence, remaining risks and exact revision.');
      invariant(report.revision === await gitText(doc.worktree, ['rev-parse', 'HEAD']), 'TOPOLOGY_MANAGEMENT_REVISION', 'Finish must name the current exact task commit.');
      invariant(!(await gitText(doc.worktree, ['status', '--porcelain'])), 'TOPOLOGY_MANAGEMENT_DIRTY', 'Commit or preserve outstanding changes before readiness for review.');
    } else invariant(nonempty(report?.message), 'TOPOLOGY_MANAGEMENT_PROTOCOL', 'A during-work report requires a visible reason.');
    // The same native workflow can undergo a producer-controlled fallback. A new finish
    // records its newly verified member set; a change after this point blocks integration.
    if (kind === 'finish' && doc.dispatched && ctx.store.workers && (!prior.worker || doc.dispatched.backend === 'topology')) prior.worker = await observeWorker(ctx, doc, owner);
    const next = await recordEvent(ctx, task, prior, kind, { owner, report, state: kind === 'finish' ? 'ready-for-review' : 'blocked' });
    next.state = kind === 'finish' ? 'ready-for-review' : 'blocked';
    if (kind === 'finish') { next.finish = report; next.collected = false; }
    await writeJson(ctx.path, next);
    if (kind === 'finish') {
      await ctx.store.reviewReady?.(task,report.revision);
      try {
        const request = await (options.queueReview || requestReview)({ ...options, revision: report.revision, baseRevision: prior.base_revision, authorAgentIds: [owner] });
        next.review_request = request;
      } catch (error) { next.review_blocked = error.message; }
      await writeJson(ctx.path, next);
      await ctx.store.comment(task, JSON.stringify({ event: 'review-queued', request: next.review_request || null, blocked: next.review_blocked || null }));
    }
    return next;
  });
}

/** Read-only integration gate; tests are rerun by integrateTask, never trusted from reports. */
export async function integrationEligibility(options) {
  const ctx = await context(options), record = await loadRecord(ctx.path), reasons = [];
  if (!record || record.state !== 'ready-for-review') reasons.push('task has no completed worker protocol ready for review');
  let doc, review = null;
  try { doc = await ownedTask(ctx, options.task, record?.owner); } catch (error) { reasons.push(error.message); }
  const loaded = await loadConfig(options);
  const policy = loaded.config.management || {};
  if (loaded.errors.length) reasons.push('management configuration is invalid');
  if (policy.auto_merge !== true && options.authorized !== true) reasons.push('configured policy requires explicit integration authority');
  if (!Array.isArray(policy.required_checks) || !policy.required_checks.length || policy.required_checks.some(c => !nonempty(c.name) || !list(c.argv) || !c.argv.length)) reasons.push('configure named management.required_checks with executable argv');
  if (!nonempty(policy.target_branch)) reasons.push('configure management.target_branch before integration');
  if (doc && record?.finish) {
    if (!doc.labels?.includes('ready-for-agent')) reasons.push('task scope is no longer approved');
    if (await gitText(doc.worktree, ['rev-parse', 'HEAD']) !== record.finish.revision) reasons.push('task changed after finish; send a new report and obtain a new review');
    if (await gitText(doc.worktree, ['status', '--porcelain'])) reasons.push('task worktree has uncommitted work');
    review = await (options.reviewGate || reviewEligibility)({ ...options, revision: record.finish.revision, baseRevision: record.base_revision, authorAgentIds: [record.owner] });
    reasons.push(...review.reasons);
    if (review.eligible !== true && review.reasons.length === 0) reasons.push('review eligibility was not established');
    if (!record.base_revision || !list(doc.touches) || !doc.touches.length) reasons.push('approved file scope or task base revision is unavailable');
    else {
      const paths = (await git(doc.worktree, ['diff', '--name-only', '-z', record.base_revision, record.finish.revision])).stdout.split('\0').filter(Boolean);
      if (paths.some(path => !doc.touches.some(scope => path === scope || path.startsWith(scope.replace(/\/$/, '') + '/')))) reasons.push('implementation changed files outside the approved task scope');
    }
    const writer = options.workerState ? await options.workerState(record) : await taskWorkerState(options, record);
    if (!writer.owned || writer.active !== false) reasons.push(writer.reason || 'worker ownership or absence of an active writer is unproven');
  }
  return { eligible: reasons.length === 0, reasons, record, doc, policy, review };
}

/** Merge only the reviewed commit after freshly running configured checks. No push or deploy. */
export async function integrateTask(options) {
  const ctx = await context(options);
  return withLock(join(ctx.root, 'integration.lock'), async () => {
    const gate = await integrationEligibility(options);
    invariant(gate.eligible, 'TOPOLOGY_MANAGEMENT_INTEGRATION_BLOCKED', gate.reasons.join('; '));
    const { record, doc, policy } = gate, checks = [];
    const targetBefore = await gitText(ctx.store.root, ['rev-parse', 'HEAD']);
    invariant(await gitText(ctx.store.root, ['symbolic-ref', '--short', 'HEAD']) === policy.target_branch, 'TOPOLOGY_MANAGEMENT_TARGET', 'Canonical checkout must be on the configured integration branch.');
    invariant(!(await gitText(ctx.store.root, ['status', '--porcelain'])), 'TOPOLOGY_MANAGEMENT_DIRTY', 'Integration checkout has uncommitted or uncollected work.');
    for (const check of policy.required_checks) {
      const result = await run(check.argv[0], check.argv.slice(1), { cwd: doc.worktree, allowFailure: true, timeoutMs: check.timeout_ms || 120000 });
      checks.push({ name: check.name, code: result.code, revision: record.finish.revision });
      invariant(result.code === 0, 'TOPOLOGY_MANAGEMENT_CHECK_FAILED', `Required check ${check.name} failed.`, { checks });
    }
    // Reread claims, revision and reviewer readiness after potentially long checks.
    const fresh = await integrationEligibility(options);
    invariant(fresh.eligible && fresh.record.finish.revision === record.finish.revision && JSON.stringify(fresh.policy) === JSON.stringify(policy), 'TOPOLOGY_MANAGEMENT_INTEGRATION_BLOCKED', fresh.reasons.join('; ') || 'Revision changed during checks.');
    invariant(await gitText(ctx.store.root, ['symbolic-ref', '--short', 'HEAD']) === policy.target_branch && await gitText(ctx.store.root, ['rev-parse', 'HEAD']) === targetBefore && !(await gitText(ctx.store.root, ['status', '--porcelain'])), 'TOPOLOGY_MANAGEMENT_TARGET', 'Integration target changed during checks.');
    record.review = fresh.review.status?.review || null;
    await ctx.store.evidence(options.task, ctx.path);
    record.collected = true;
    await writeJson(ctx.path, record);
    await git(ctx.store.root, ['merge', '--ff-only', record.finish.revision]);
    const landed = await gitText(ctx.store.root, ['rev-parse', 'HEAD']);
    invariant((await git(ctx.store.root, ['merge-base', '--is-ancestor', record.finish.revision, landed], true)).code === 0, 'TOPOLOGY_MANAGEMENT_LANDING', 'Landing ancestry verification failed.');
    const authorization={decision:'integrate',actor:options.actor || ctx.env.TM_ACTOR || ctx.env.USER || record.lead_id,
      authorized:options.authorized===true,revision:record.finish.revision,channel:options.actor?'gateway-or-explicit-actor':'local-operator',policy_auto_merge:policy.auto_merge===true,at:nowIso()};
    const next = await recordEvent(ctx, options.task, record, 'merge', { revision: record.finish.revision, landed, checks, target_branch: policy.target_branch,authorization });
    Object.assign(next, { state: 'merged', collected: true, merge: { revision: record.finish.revision, landed, checks, target_branch: policy.target_branch,authorization } });
    await writeJson(ctx.path, next);
    return next;
  });
}

/** Cleanup fails closed with a recovery path; it never force-removes a tree or remote branch. */
export async function cleanupTask(options) {
  const ctx = await context(options);
  return withLock(join(ctx.root, 'integration.lock'), async () => {
    const record = await loadRecord(ctx.path);
    try {
      invariant(record?.merge && record.collected, 'TOPOLOGY_MANAGEMENT_CLEANUP', 'Verified merge and collected results are required.');
      const doc = await ownedTask(ctx, options.task, record.owner);
      invariant(record.worktree === doc.worktree && record.branch === doc.branch, 'TOPOLOGY_MANAGEMENT_CLEANUP', 'Task worktree ownership changed.');
      invariant(!(await gitText(doc.worktree, ['status', '--porcelain'])), 'TOPOLOGY_MANAGEMENT_CLEANUP', 'Task tree has uncommitted work.');
      invariant(await gitText(doc.worktree, ['rev-parse', 'HEAD']) === record.merge.revision, 'TOPOLOGY_MANAGEMENT_CLEANUP', 'Task branch changed after integration.');
      invariant((await git(ctx.store.root, ['merge-base', '--is-ancestor', record.merge.revision, `refs/heads/${record.merge.target_branch}`], true)).code === 0, 'TOPOLOGY_MANAGEMENT_CLEANUP', 'Merge ancestry is no longer established.');
      const worker = options.workerState ? await options.workerState(record) : await taskWorkerState(options, record);
      invariant(worker.owned && worker.active === false, 'TOPOLOGY_MANAGEMENT_CLEANUP', 'Worker ownership or idle state is unproven.');
      if (worker.alive) {
        invariant(typeof options.closeWorker === 'function', 'TOPOLOGY_MANAGEMENT_CLEANUP', 'Owned-worker closer is unavailable.');
        await options.closeWorker(record);
        invariant((await options.workerState(record)).alive === false, 'TOPOLOGY_MANAGEMENT_CLEANUP', 'Owned worker did not stop.');
      }
      await ctx.store.removeWorktree(options.task);
      await git(ctx.store.root, ['branch', '-d', '--', record.branch]);
      const next = await recordEvent(ctx, options.task, record, 'cleanup', { worktree: record.worktree, branch: record.branch, status: 'complete' });
      next.state = 'cleaned';
      await writeJson(ctx.path, next);
      await ctx.store.evidence(options.task, ctx.path);
      await ctx.store.done(options.task);
      return { cleaned: true, record: next };
    } catch (error) {
      const recovery = 'Preserve the task, results and worktree; resolve the named ownership, writer or landing gate, then retry cleanup.';
      await recordEvent(ctx, options.task, record, 'cleanup-blocked', { reason: error.message, recovery });
      return { cleaned: false, reason: error.message, recovery };
    }
  });
}

export async function managementStatus(options) {
  const ctx = await context(options);
  return { task: await ctx.store.show(options.task), management: await loadRecord(ctx.path), claim: await ctx.store.claim(options.task) };
}

// ── Idle dispatch: handing a ready task to an agent that is ALREADY running ───
//
// A standing agent outlives any one task. `tm dispatch --backend idle` therefore does not launch
// anything: it claims the task, provisions the worktree through tm exactly as every other backend
// does, and then asks HERE for an idle agent to be bound to it.
//
// THE CENSUS IS A HINT; THIS RECORD IS THE AUTHORITY. The idle read and the assignment write happen
// inside ONE critical section, because they are one decision. Check idle in the scheduler and write
// the binding here and two ticks both see the same agent idle, both provision a worktree, and one
// pane silently interleaves two tasks.
//
// The lock is REPO-WIDE (`assignment.lock`), not the per-task `<task>.json.lock` every other verb in
// this file takes. Two different tasks racing for the same agent are the whole hazard, and two
// per-task locks are never contended with each other, so a per-task lock would leave exactly the
// double assignment this section exists to prevent. Same reasoning as `integration.lock`.
//
// ponytail: one lock for every assignment in a repository. Per-agent locks if assignment throughput
// ever matters — it is one write per dispatched task, so it does not.

const ASSIGNMENT_OUTCOMES = { DONE: 'done', BLOCKED: 'blocked', FAILED: 'failed' };
const assignmentLock = ctx => join(ctx.root, 'assignment.lock');
/**
 * The envelope id for one assignment. Derived, so a RETRIED assign delivers nothing twice — same
 * discipline as slot grants.
 *
 * `round` is load-bearing and not decoration. Without it the id is a pure function of
 * (repo, task, agent), so releasing an assignment and later handing the SAME task back to the SAME
 * agent recomputes the same id, `sendStandingMessage` dedupes to the already-delivered envelope,
 * and `assignmentResult` reads the PREVIOUS round's reply as this round's completion signal — the
 * task collects instantly with a stale outcome and nobody ever sees the second attempt. The round
 * is the count of assignments this record has already seen, which is stable across a retry of the
 * same attempt (nothing is written until delivery succeeded) and different across a reassignment.
 */
const assignmentMessageId = (ctx, task, agentId, round) =>
  createHash('sha256').update(`idle-dispatch:${ctx.identity.id}:${task}:${agentId}:${round}`).digest('hex').slice(0, 32);

/** Every unreleased assignment in this repository. Read under the assignment lock, never cached. */
async function heldAssignments(ctx) {
  const rows = [];
  for (const name of (await readdir(ctx.root).catch(() => [])).filter(n => /^TM-[0-9]+\.json$/.test(n))) {
    const record = await readJson(join(ctx.root, name)).catch(() => null);
    if (record?.assignee && !record.assignee.released_at) rows.push({ task: record.task, ...record.assignee });
  }
  return rows;
}

/**
 * What the assigned agent is told. It is a POINTER, never the handoff itself: the handoff is a file
 * in the task worktree that `tm` already rendered, and a standing agent's cwd is its own agent
 * directory by design, so the absolute path is the only thing that travels.
 *
 * TM_SESSION_ID is the DISPATCHING session, not a fresh synthetic id (CAP-0002). The claim on this
 * task is held by that session; `tm` run under any other id is a stranger to its own claim, so
 * `tm start` would refuse, `heartbeatClaim` would return null, and `ownedTask` below would reject
 * every later `manage` call from the agent. One owned claim, one session id, no new null-session
 * claims from this path.
 */
export function assignmentBody({ task, worktree, promptFile, session, agentId }) {
  return [
    `TASK ASSIGNMENT: ${task}`,
    '',
    `You are already running, so nothing was launched for this. The work is prepared:`,
    `  worktree     ${worktree}`,
    `  handoff      ${promptFile}`,
    '',
    `1. cd ${worktree}`,
    `2. export TM_SESSION_ID=${session}   # the claim on ${task} is held by this session id; tm refuses under any other`,
    `3. Read ${promptFile} and do exactly what it says. Close the task through the gates (\`tm done ${task}\`).`,
    '',
    `When you are finished, REPLY TO THIS MESSAGE. The reply is the completion signal — your session`,
    `is not expected to exit, and nothing is watching it for death. Start the reply with one word:`,
    `  DONE     you closed ${task} through the gates`,
    `  BLOCKED  you could not proceed; say why on the following lines`,
    `  FAILED   you tried and it did not work; say why on the following lines`,
    `Anything else is recorded as FAILED. "DONE" is a claim about the store and the store gets the`,
    `last word: if ${task} is not actually done, the result is downgraded to failed with the status`,
    `named. Then you are free again — you are ${agentId}, not this task.`,
  ].join('\n');
}

/** A reply body → the outcome recorded against the task. Unknown first word is an honest failure. */
export function parseAssignmentReply(body) {
  const text = String(body ?? '').trim();
  const first = text.split(/\s+/, 1)[0]?.toUpperCase() ?? '';
  return { outcome: ASSIGNMENT_OUTCOMES[first] ?? 'failed', summary: text };
}

/**
 * Bind one idle agent to one owned task, and deliver the pointer.
 *
 * Refuses, in order: a task this session does not own or that tm has not provisioned; a task that
 * already carries a live assignment; a stale census (a stale document is not old news, it is NO
 * news — the agent it calls idle has had a minute to start working); an agent that already holds an
 * unreleased assignment anywhere in this repository; an undeliverable pointer.
 */
export async function assignTaskToAgent(options) {
  const ctx = await context(options);
  const { task, owner, agent = null } = options;
  invariant(nonempty(owner), 'TOPOLOGY_MANAGEMENT_ASSIGN', 'Assignment requires the dispatching session id (TM_SESSION_ID); an unowned claim cannot be handed to anyone.');
  return withLock(assignmentLock(ctx), async () => {
    const doc = await ownedTask(ctx, task, owner);
    const prior = await loadRecord(ctx.path);
    invariant(!prior?.assignee || prior.assignee.released_at,
      'TOPOLOGY_MANAGEMENT_ASSIGNED', `${task} is already assigned to ${prior?.assignee?.agent_id}; release it before reassigning.`);
    const census = await (options.census ?? readCensus)({ ...options, identity: ctx.identity, env: ctx.env, home: ctx.home });
    invariant(census && !census.stale, 'TOPOLOGY_MANAGEMENT_CENSUS',
      'No fresh liveness census for this repository; start the repository supervisor. Nothing is dispatchable from a stale or missing census.');
    const held = new Set((await heldAssignments(ctx)).map(row => row.agent_id));
    const free = (census.agents ?? []).filter(row => row.dispatchable && !held.has(row.agentId));
    const pick = agent ? free.find(row => row.agentId === agent) : free[0];
    invariant(pick, 'TOPOLOGY_MANAGEMENT_NO_IDLE_AGENT', agent
      ? `${agent} is not an idle, unassigned agent in this repository right now.`
      : `No idle unassigned agent in this repository. Observed: ${(census.agents ?? []).map(row => `${row.agentId}=${row.state}`).join(', ') || 'none'}.`);
    // The census is a HINT even when it is fresh: `staleAfterMs` is 45s off the supervisor's
    // slowest rung, which is 45s in which a pane can exit. So the six-tuple is re-proved HERE,
    // inside the same critical section as the write, exactly as `observeWorker` proves a dispatched
    // worker's. Assigning to a pane that is already gone costs the task a whole collect cycle
    // before anyone notices, and the agent slot until someone releases it by hand.
    // TM-167: re-proved on the server the census binding names; no binding, nothing to prove.
    const panes = pick.binding ? await (options.listPanes ?? listServerPanes)({ tmuxServer: pick.binding.serverKey, env: ctx.env }) : [];
    invariant(pick.binding && panes.some(pane => pane.alive && bindingKeys.every(key => pane[key] === pick.binding[key])),
      'TOPOLOGY_MANAGEMENT_AGENT_GONE', `${pick.agentId} read as idle in the census but its pane incarnation is no longer live; nothing was assigned.`);
    const promptFile = options.promptFile ? (isAbsolute(options.promptFile) ? options.promptFile : join(doc.worktree, options.promptFile)) : join(doc.worktree, '.tm-dispatch-prompt.md');
    const round = (prior?.events ?? []).filter(entry => entry.event === 'assigned').length;
    const messageId = assignmentMessageId(ctx, task, pick.agentId, round);
    const mail = await (options.deliver ?? sendStandingMessage)({
      id: messageId, consumer: ctx.store.root, fromProject: ctx.store.root, from: options.from ?? 'tm-dispatch',
      to: pick.agentId, task, subject: `task assignment ${task}`, assignment: true,
      body: assignmentBody({ task, worktree: doc.worktree, promptFile, session: owner, agentId: pick.agentId }),
      provenance: { source: 'tm dispatch --backend idle' },
    }, { env: ctx.env, home: ctx.home });
    invariant(mail?.status === 'delivered', 'TOPOLOGY_MANAGEMENT_ASSIGN_UNDELIVERED',
      `The assignment pointer for ${task} could not be delivered to ${pick.agentId}: ${mail?.reason ?? 'unknown'}.`);
    const assignee = { agent_id: pick.agentId, session_name: pick.sessionName ?? null, binding: pick.binding ?? null,
      message_id: messageId, round, owner, worktree: doc.worktree, prompt_file: promptFile, assigned_at: nowIso(), released_at: null };
    const record = await recordEvent(ctx, task, prior, 'assigned', { assignee });
    record.assignee = assignee;
    await writeJson(ctx.path, record);
    return { assigned: true, task, agent_id: pick.agentId, message_id: messageId, worktree: doc.worktree, prompt_file: promptFile };
  });
}

/**
 * The completion signal, which is the REPLY and not session death — the standing session outlives
 * the task, which is the entire point of dispatching to it. `{ pending: true }` while the assignment
 * is live and unanswered; a read, never a wait.
 */
export async function assignmentResult(options) {
  const ctx = await context({ ...options, store: options.store ?? { root: null } });
  const record = await loadRecord(ctx.path);
  const assignee = record?.assignee ?? null;
  if (!assignee) return { assigned: false, reason: `${options.task} has no idle-dispatch assignment.` };
  if (assignee.released_at) return { assigned: false, released_at: assignee.released_at, agent_id: assignee.agent_id };
  const mail = await (options.readMessage ?? readStandingMessage)({ id: assignee.message_id, env: ctx.env, home: ctx.home });
  if (!mail?.reply) return { assigned: true, pending: true, agent_id: assignee.agent_id, message_id: assignee.message_id };
  return { assigned: true, pending: false, agent_id: assignee.agent_id, message_id: assignee.message_id,
    replied_at: mail.reply.created_at, ...parseAssignmentReply(mail.reply.body) };
}

/**
 * Free the agent. Idempotent, and it keeps the record: an assignment that happened is history, and
 * `heldAssignments` reads `released_at` rather than the absence of a row.
 */
export async function releaseAssignment(options) {
  const ctx = await context({ ...options, store: options.store ?? { root: null } });
  return withLock(assignmentLock(ctx), async () => {
    const record = await loadRecord(ctx.path);
    if (!record?.assignee) return { released: false, reason: `${options.task} has no idle-dispatch assignment.` };
    if (record.assignee.released_at) return { released: false, already: true, agent_id: record.assignee.agent_id, released_at: record.assignee.released_at };
    const assignee = { ...record.assignee, released_at: nowIso(), release_reason: options.reason ?? null };
    await writeJson(ctx.path, { ...record, assignee, updated_at: assignee.released_at,
      events: [...(record.events || []), { event: 'assignment-released', at: assignee.released_at, agent_id: assignee.agent_id, reason: assignee.release_reason }] });
    return { released: true, agent_id: assignee.agent_id, task: options.task };
  });
}
