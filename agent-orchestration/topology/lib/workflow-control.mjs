// Native workflow operations. Gateway calls these through the CLI; it never writes runtime state.
import { createHash } from 'node:crypto';
import { releaseRunPersona } from './persona-registry.mjs';
import { mkdir, readdir, readFile, realpath } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';
import { appendJournal, loadRun, readJournal, saveRun, sendMessage } from './mailbox.mjs';
import { durableTopologyRoot, readWorkflowIndex, reconcileWorkflows, registeredWorktrees, workflowRepository } from './discovery.mjs';
import { incarnationOf, sameIncarnation } from './incarnation.mjs';
import { stateRoot } from './repoid.mjs';
import { callerIdentity } from './session-identity.mjs';
import { childrenFile } from './lineage.mjs';
import { invariant, isInside, newRunId, nowIso, readJson, writeJson } from './util.mjs';
import { withLock } from './lockfile.mjs';
import * as tmux from './tmux.mjs';

const TERMINAL = new Set(['stopped', 'succeeded', 'completed', 'failed', 'cancelled', 'timed_out', 'rejected']);
const hash = value => createHash('sha256').update(value).digest('hex');
const errorOf = error => ({ code: error.code || 'TOPOLOGY_CONTROL_FAILED', message: error.message });

export async function assertNativeRepository({ consumer, runDir, ...options }) {
  const repository = await workflowRepository(consumer);
  let path, imported = null;
  try { path = await realpath(runDir); }
  catch (error) {
    if (error.code !== 'ENOENT') throw error;
    const index = await readWorkflowIndex({ consumer, ...options });
    const matches = index.workflows.filter(entry => entry.runtime === 'topology' && entry.legacySourcePath === join(resolve(runDir), 'run.json'));
    invariant(matches.length === 1, 'TOPOLOGY_RUN_NOT_FOUND', 'The native record is missing and has no unique verified durable import.');
    imported = matches[0]; path = await realpath(dirname(imported.recordPath));
  }
  const run = await loadRun(path);
  invariant((run.repository || await workflowRepository(run.consumer)).id === repository.id,
    'TOPOLOGY_DISCOVERY_REPOSITORY', 'Native workflow belongs to another repository.');
  invariant(!imported || run.run_id === imported.nativeRunId && run.legacy_import?.sourcePath === imported.legacySourcePath,
    'TOPOLOGY_DISCOVERY_BOUNDARY', 'Native record does not acknowledge this exact legacy evidence source.');
  const allowed = [durableTopologyRoot(repository, options)];
  for (const checkout of await registeredWorktrees(consumer)) allowed.push(join(checkout, '.bytedesk', 'agent-orchestration', 'runs'), join(checkout, '.orchestration', 'runs'));
  invariant(/^[A-Za-z0-9][A-Za-z0-9_.-]{0,159}$/.test(run.run_id) && allowed.some(root => path === join(root, run.run_id)),
    'TOPOLOGY_DISCOVERY_BOUNDARY', 'Native workflow is outside canonical state and registered worktrees.');
  return { repository, run, runDir: path };
}

export async function assertRunOwnership(run, { tmuxApi = tmux, requireAlive = true } = {}) {
  const members = run.agents.filter(agent => agent.pane);
  if (!members.length) {
    invariant(!run.session_creation_attempted, 'TOPOLOGY_SESSION_OWNERSHIP', 'Session creation was attempted without a recorded member binding; current ownership is unknown.');
    invariant(!requireAlive, 'TOPOLOGY_SESSION_GONE', 'Workflow has no recorded member panes.');
    return { members: [], panes: [], gone: true };
  }
  invariant(members.every(agent => incarnationOf(agent.binding) && agent.binding.paneId === agent.pane),
    'TOPOLOGY_SESSION_OWNERSHIP', 'A member lacks its exact recorded incarnation; preserve the workflow for inspection.');
  const first = members[0].binding;
  invariant(members.every(agent => ['serverKey', 'serverPid', 'sessionId', 'sessionCreated'].every(key => agent.binding[key] === first[key])),
    'TOPOLOGY_SESSION_OWNERSHIP', 'Member bindings do not name one owned workflow session.');
  const panes = await tmuxApi.listServerPanes({ tmuxServer: first.serverKey, session: run.session });
  if (!panes.length) {
    invariant(!requireAlive, 'TOPOLOGY_SESSION_GONE', 'The recorded workflow session is gone.');
    return { members, panes, gone: true };
  }
  invariant(panes.every(pane => members.some(agent => sameIncarnation(pane, agent.binding))) &&
    members.every(agent => panes.some(pane => sameIncarnation(pane, agent.binding))),
  'TOPOLOGY_SESSION_OWNERSHIP', 'The session name or pane was reused, or an unowned pane is present. No control was sent.');
  return { members, panes, gone: false };
}

export async function observeNativeWorkflow({ consumer, runDir, nativeRunId, taskId, workloadCwd, stateHome, tmuxApi = tmux }) {
  const observed = new Map(), seen = new Set();
  const taskOf = run => run.task_id || /^tm-(TM-[0-9]+)$/i.exec(run.name)?.[1]?.toUpperCase() || null;
  const remember = async (path, optional = false) => {
    const text = await readFile(path, 'utf8').catch(error => { if (optional && error.code === 'ENOENT') return null; throw error; });
    observed.set(path, text);
    return text === null ? [] : JSON.parse(text);
  };
  const inspect = async (path, expectedId, parentId = null) => {
    const admitted = await assertNativeRepository({ consumer, runDir: path, stateHome });
    invariant(!seen.has(admitted.runDir) && seen.size < 256, 'TOPOLOGY_LINEAGE_CYCLE', 'Native workflow lineage is cyclic or exceeds the inspection bound.');
    seen.add(admitted.runDir);
    const run = await remember(join(admitted.runDir, 'run.json'));
    invariant(run.version === 1 && (run.repository || await workflowRepository(run.consumer)).id === admitted.repository.id && Array.isArray(run.agents),
      'TOPOLOGY_DISCOVERY_REPOSITORY', 'Native record changed repository identity or format during admission.');
    invariant(run.run_id === expectedId && (!parentId || run.parent?.run_id === parentId), 'TOPOLOGY_CHILD_OWNERSHIP', 'Native workflow identity or acknowledged parent differs from its recorded owner.');
    invariant(['running', 'degraded', 'stopped', 'stop_failed', 'failed', 'launch_failed', 'succeeded', 'completed', 'cancelled', 'timed_out', 'rejected', 'launching', 'starting'].includes(run.state),
      'TOPOLOGY_WRITER_UNCERTAIN', 'Native workflow state is unknown.');
    invariant(!['launching', 'starting'].includes(run.state), 'TOPOLOGY_WRITER_PENDING', 'Workflow startup is still pending.');
    if (run.session_creation_attempted) {
      const planned = run.launch_spec?.agents;
      invariant(!planned || planned.length === run.agents.length && planned.every(agent => run.agents.some(member => member.id === agent.id)),
        'TOPOLOGY_WRITER_PENDING', 'Native member roster is incomplete.');
    }
    invariant(run.agents.every(agent => agent.workflow ? agent.workflow.run_dir : agent.pane),
      'TOPOLOGY_WRITER_PENDING', 'A member or child workflow has no settled runtime binding.');
    const ownership = await assertRunOwnership(run, { tmuxApi, requireAlive: false });
    const agents = run.agents.map(agent => {
      if (agent.workflow) return { id: agent.id, pane: null, binding: null, alive: false };
      const pane = ownership.panes.find(pane => sameIncarnation(pane, agent.binding));
      invariant(!pane || typeof pane.alive === 'boolean', 'TOPOLOGY_WRITER_UNCERTAIN', 'Member process liveness is unknown.');
      return { id: agent.id, pane: agent.pane, binding: incarnationOf(agent.binding), alive: pane?.alive ?? false };
    });
    const childRecords = await remember(childrenFile(admitted.runDir), true);
    invariant(Array.isArray(childRecords), 'TOPOLOGY_CHILDREN_INVALID', 'Native child workflow index is invalid.');
    const childPaths = [...new Set([...childRecords.map(child => child.run_dir), ...run.agents.filter(agent => agent.workflow).map(agent => agent.workflow.run_dir)])];
    const children = [];
    for (const childPath of childPaths) {
      invariant(typeof childPath === 'string' && childPath.length > 0, 'TOPOLOGY_WRITER_PENDING', 'A child workflow has no durable record location.');
      const child = (await assertNativeRepository({ consumer, runDir: childPath, stateHome })).run;
      const owner = run.agents.find(agent => agent.workflow?.run_dir === childPath)?.id || childRecords.find(item => item.run_dir === childPath)?.agent_id;
      invariant(owner && run.agents.some(agent => agent.id === owner) && child.parent?.agent_id === owner,
        'TOPOLOGY_CHILD_OWNERSHIP', 'Child workflow does not acknowledge its exact owning member.');
      children.push(await inspect(childPath, child.run_id, run.run_id));
    }
    const identity = { runId: run.run_id, repositoryId: admitted.repository.id, taskId: taskOf(run), parentAgentId: run.parent?.agent_id || null,
      workloadCwd: run.workload_cwd || run.cwd || run.consumer, writeAuthority: run.write_authority || null,
      session: run.session, agents: agents.map(({ id, pane, binding }) => ({ id, pane, binding })),
      children: children.map(child => ({ runId: child.runId, fingerprint: child.fingerprint })) };
    return { ...identity, runDir: admitted.runDir, fingerprint: hash(JSON.stringify(identity)), state: run.state, sessionAlive: !ownership.gone,
      agents, children, hasLiveWriters: agents.some(agent => agent.alive) || children.some(child => child.hasLiveWriters), observationError: null };
  };
  const result = await inspect(runDir, nativeRunId);
  invariant(!taskId || result.taskId === taskId, 'TOPOLOGY_TASK_OWNERSHIP', 'Native workflow does not belong to this task.');
  invariant(!workloadCwd || resolve(result.workloadCwd) === resolve(workloadCwd), 'TOPOLOGY_WORKLOAD_OWNERSHIP', 'Native workflow does not use this task worktree.');
  for (const [path, before] of observed) {
    const after = await readFile(path, 'utf8').catch(error => { if (error.code === 'ENOENT') return null; throw error; });
    invariant(before === after, 'TOPOLOGY_OBSERVATION_CHANGED', 'Native records changed during observation; inspect again before admitting integration.');
  }
  return result;
}

// Run the test and kill inside one tmux command queue. All command text below is built only from
// checked numeric tmux identities. A name, provider label, actor, or path is never shell source.
export async function killExactPane(binding, { tmuxApi = tmux } = {}) {
  invariant(/^%[0-9]+$/.test(binding.paneId) && /^\$[0-9]+$/.test(binding.sessionId) &&
    ['serverPid', 'sessionCreated', 'panePid'].every(key => Number.isSafeInteger(binding[key]) && binding[key] > 0),
  'TOPOLOGY_SESSION_OWNERSHIP', 'Invalid exact tmux incarnation.');
  const terms = [['pid', binding.serverPid], ['session_id', binding.sessionId], ['session_created', binding.sessionCreated], ['pane_id', binding.paneId], ['pane_pid', binding.panePid]];
  const condition = terms.map(([key, value]) => `#{==:#{${key}},${value}}`).reduce((left, right) => `#{&&:${left},${right}}`);
  await tmuxApi.tmux(['if-shell', '-F', '-t', binding.paneId, condition, `kill-pane -t ${binding.paneId}`, ''], { tmuxServer: binding.serverKey });
}

export async function stopNativeRun({ runDir, actor = { id: 'local-operator' }, cascade = true, tmuxApi = tmux, seen = new Set(), repositoryId = null }) {
  const path = await realpath(runDir);
  invariant(!seen.has(path), 'TOPOLOGY_LINEAGE_CYCLE', 'Child workflow lineage contains a cycle.');
  seen.add(path);
  const run = await loadRun(path);
  const identity = run.repository || await workflowRepository(run.consumer);
  invariant(!repositoryId || identity.id === repositoryId, 'TOPOLOGY_DISCOVERY_REPOSITORY', 'Child workflow belongs to another repository.');
  const failures = [], childrenStopped = [];
  let ownership;
  try { ownership = await assertRunOwnership(run, { tmuxApi, requireAlive: false }); }
  catch (error) { failures.push({ run_id: run.run_id, ...errorOf(error) }); }
  // Validate the parent before controlling its children. A corrupt parent cannot claim peers.
  if (!failures.length && cascade) {
    const children = await readJson(childrenFile(path)).catch(error => { if (error.code === 'ENOENT') return []; throw error; });
    invariant(Array.isArray(children), 'TOPOLOGY_CHILDREN_INVALID', 'Child workflow index is invalid.');
    for (const child of children) {
      try {
        invariant(child.run_dir, 'TOPOLOGY_CHILDREN_INVALID', 'Child run has no native record path.');
        const admittedChild = await assertNativeRepository({ consumer: identity.root, runDir: child.run_dir, stateHome: run.state_home });
        const childRun = admittedChild.run;
        invariant(childRun.parent?.run_id === run.run_id, 'TOPOLOGY_CHILD_OWNERSHIP', 'Child record does not acknowledge this parent.');
        const outcome = await stopNativeRun({ runDir: admittedChild.runDir, actor, cascade, tmuxApi, seen, repositoryId: identity.id });
        childrenStopped.push(outcome);
        failures.push(...outcome.failures);
        await appendJournal(path, { type: outcome.ok ? 'run.child_exited' : 'run.child_stop_failed', run_id: outcome.run_id,
          run_dir: outcome.run_dir, session: outcome.session, reason: 'parent-stop', actor });
      } catch (error) { failures.push({ run_dir: child.run_dir, ...errorOf(error) }); }
    }
  }
  if (ownership && !ownership.gone) {
    for (const member of ownership.members) {
      try { await killExactPane(member.binding, { tmuxApi }); }
      catch (error) { failures.push({ agent: member.id, ...errorOf(error) }); }
    }
    for (const member of ownership.members) {
      try {
        const panes = await tmuxApi.listServerPanes({ tmuxServer: member.binding.serverKey, session: run.session });
        if (panes.some(pane => sameIncarnation(pane, member.binding))) failures.push({ agent: member.id, code: 'TOPOLOGY_STOP_NOT_CONFIRMED', message: 'The exact member incarnation remains after stop.' });
        else if (panes.some(pane => pane.paneId === member.pane && pane.sessionId === member.binding.sessionId && pane.serverPid === member.binding.serverPid && pane.sessionCreated === member.binding.sessionCreated)) {
          failures.push({ agent: member.id, code: 'TOPOLOGY_STOP_OWNERSHIP_CHANGED', message: 'The member incarnation changed during stop and was preserved.' });
        }
      } catch (error) { failures.push({ agent: member.id, ...errorOf(error) }); }
    }
  }
  const result = { ok: failures.length === 0, run_id: run.run_id, run_dir: path, session: run.session,
    killed: Boolean(ownership && !ownership.gone), files_kept: true, children_stopped: childrenStopped, failures };
  const current = await loadRun(path);
  current.state = result.ok ? 'stopped' : 'stop_failed';
  current.stop_result = result;
  await saveRun(path, current);
  // TM-274: a stopped team run gives its persona back; a failed stop keeps it, the session may live on.
  if (result.ok) await releaseRunPersona(current.session_identity).catch(() => {});
  await appendJournal(path, { type: result.ok ? 'run.stopped' : 'run.stop_failed', actor, failures, children_stopped: childrenStopped.length });
  return result;
}

export async function indexedWorkflow({ consumer, workflowId, ...options }) {
  invariant(typeof workflowId === 'string' && /^(topology|acp|goal-loop):[A-Za-z0-9_.-]+$/.test(workflowId), 'TOPOLOGY_WORKFLOW_REQUIRED', 'Pass a canonical workflow ID.');
  const index = await readWorkflowIndex({ consumer, ...options });
  const entry = index.workflows.find(item => item.workflowId === workflowId);
  invariant(entry && entry.repositoryId === index.repository.id, 'TOPOLOGY_WORKFLOW_NOT_FOUND', 'Workflow is not indexed for the authorized repository.');
  const recordPath = await realpath(entry.recordPath);
  if (entry.runtime === 'goal-loop') {
    const { showGoalLoop } = await import('./goal-loop.mjs');
    const loop = await showGoalLoop({ consumer, loopId: entry.nativeRunId, ...options,
      env: { ...process.env, ...(options.env || {}), AGENT_ORCHESTRATION_STATE_HOME: options.stateHome || stateRoot(options.env) } });
    invariant(recordPath === loop.recordPath && loop.workflowId === workflowId && loop.repository.id === index.repository.id,
      'TOPOLOGY_DISCOVERY_REPOSITORY', 'Goal loop no longer matches its indexed identity.');
    return { entry, loop, repository: index.repository };
  }
  if (entry.runtime === 'topology') {
    invariant(basename(recordPath) === 'run.json', 'TOPOLOGY_DISCOVERY_BOUNDARY', 'Native workflow record must be run.json.');
    const { run } = await assertNativeRepository({ consumer, runDir: dirname(recordPath), ...options });
    invariant(run.run_id === entry.nativeRunId && (run.repository || await workflowRepository(run.consumer)).id === index.repository.id,
      'TOPOLOGY_DISCOVERY_REPOSITORY', 'Native record no longer matches indexed workflow identity.');
    return { entry, run, runDir: dirname(recordPath), repository: index.repository };
  }
  return { entry, repository: index.repository };
}

// The gate reads the census from the same state home the console reads mail from.
const gateEnv = options => ({ ...process.env, ...(options.env || {}), ...(options.stateHome ? { AGENT_ORCHESTRATION_STATE_HOME: options.stateHome } : {}) });

export async function workflowDetail({ consumer, workflowId, ...options }) {
  // TM-464 F1: refused before the workflow is even looked up, so a non-operator learns nothing.
  await assertOperatorReader({ consumer, env: gateEnv(options), proof: options.proof });
  const { entry, run, runDir, loop } = await indexedWorkflow({ consumer, workflowId, ...options });
  if (loop) {
    const { goalLoopSummary } = await import('./goal-loop.mjs');
    return { workflow: entry, goalLoop: goalLoopSummary(loop), messages: await workflowMessages({ consumer, workflowId, ...options }),
      events: loop.history.slice(-200).map(event => ({ type: event.type, at: event.at, phase: event.phase, attempt: event.attempt })) };
  }
  invariant(run, 'TOPOLOGY_RUNTIME_UNSUPPORTED', 'Use the ACP producer to inspect this workflow.');
  const messages = [];
  for (const member of run.agents) {
    invariant(/^[A-Za-z0-9_.-]+$/.test(member.id), 'TOPOLOGY_INVALID_AGENT', 'Member ID is not a safe path component.');
    for (const [folder, direction] of [['inbox', 'in'], ['outbox', 'out']]) {
      const mailbox = join(runDir, 'agents', member.id, folder);
      for (const file of (await readdir(mailbox).catch(error => { if (error.code === 'ENOENT') return []; throw error; })).filter(file => file.endsWith('.md')).sort().slice(-100)) {
        const target = await realpath(join(mailbox, file));
        invariant(isInside(runDir, target), 'TOPOLOGY_DISCOVERY_BOUNDARY', 'Mailbox path escapes the native run.');
        const body = await readFile(target, 'utf8');
        messages.push({ agentId: member.id, id: file, direction, body: body.slice(0, 128 * 1024), truncated: body.length > 128 * 1024 });
      }
    }
  }
  const safeRun = Object.fromEntries(['version', 'run_id', 'name', 'consumer', 'run_dir', 'session', 'state', 'created', 'updated', 'revision', 'repository', 'workload_cwd', 'write_authority', 'task_id', 'retry_of', 'parent', 'inputs', 'stages', 'gates', 'error', 'human_decisions', 'stop_result'].map(key => [key, run[key]]));
  safeRun.agents = run.agents.map(member => Object.fromEntries(['id', 'agent_id', 'role', 'cwd', 'pane', 'binding', 'provider', 'adapter', 'active', 'workflow'].map(key => [key, member[key]])));
  const taskId = run.task_id || /^tm-(TM-[0-9]+)$/i.exec(run.name)?.[1]?.toUpperCase() || null;
  let independentReview = { status: 'not-requested', taskId, sourceRevision: null, reviewerId: null, verdict: null, requestedAt: null, collectedAt: null, reason: 'This workflow has no governed task review.' };
  if (taskId) {
    try {
      const { independentReviewStatus } = await import('./reviewer.mjs');
      independentReview = await independentReviewStatus({ consumer: entry.repositoryRoot, task: taskId,
        env: { ...process.env, ...(options.env || {}), AGENT_ORCHESTRATION_STATE_HOME: options.stateHome || run.state_home || stateRoot() },
        home: options.home, pluginRoot: options.pluginRoot });
    } catch (error) { independentReview = { ...independentReview, status: 'unavailable', reason: error.message }; }
  }
  let inspection;
  try {
    const ownership = await assertRunOwnership(run, { tmuxApi: options.tmuxApi || tmux, requireAlive: false });
    inspection = { sessionAlive: !ownership.gone, observedAt: nowIso(), error: null,
      agents: run.agents.filter(agent => agent.pane).map(agent => ({ id: agent.id, alive: ownership.panes.some(pane => sameIncarnation(pane, agent.binding) && pane.alive !== false) })) };
  } catch (error) { inspection = { sessionAlive: null, observedAt: nowIso(), error: errorOf(error), agents: run.agents.filter(agent => agent.pane).map(agent => ({ id: agent.id, alive: null })) }; }
  messages.push(...await workflowMessages({ consumer, workflowId, ...options }));
  return { workflow: entry, run: safeRun, messages, events: await readJournal(runDir, 200), independentReview, inspection };
}

// Reading diagnostics must never pull or acknowledge a broker message. These are
// retained producer/recipient facts, not task ownership or completion evidence.
/** TM-464 F1: the workflow console shows every agent's mail, so it is the operator's view only.
 * Allowed: a bare operator shell, i.e. NO agent identity (no AO_AGENT_ID, no minted session id) AND a
 * pane this repository's census binds to no agent; or this repository's lead PROVEN by
 * requireLeadCaller (census-bound live pane plus process ancestry). Anyone else is refused: a
 * dispatched worker, a minted session, a non-lead agent, and a launched agent that unset AO_AGENT_ID
 * but still runs in its bound pane (the binding names it). As in requireHandoffCaller, the pane's
 * census binding stands in for the env name. `proof` injects pane, census and /proc readers for tests.
 * Same-user limit: a process outside every bound pane with its identity variables removed is,
 * to this check, the operator. */
export async function assertOperatorReader({ consumer, env = process.env, home, proof = {} }) {
  invariant(!env.TM_DISPATCH_WORKER, 'TOPOLOGY_OPERATOR_ONLY', 'A dispatched worker session (TM_DISPATCH_WORKER) cannot read every agent\'s mail in the workflow console. Nothing was read.');
  const { bindingAgentId, requireLeadCaller } = await import('./delegation.mjs');
  const lookup = { consumer, env, ...(home ? { home } : {}), ...proof };
  const bound = await bindingAgentId(lookup).catch(() => null);
  const caller = callerIdentity(env);
  if (!caller && !bound) return { as: 'operator' };
  const named = env.AO_AGENT_ID || bound || caller?.agentId;
  const lead = await requireLeadCaller({ ...lookup, env: { ...env, AO_AGENT_ID: named } });
  invariant(lead, 'TOPOLOGY_OPERATOR_ONLY',
    `This session is ${named}, not this repository's proven lead or a bare operator shell, so it cannot read every agent's mail in the workflow console. Nothing was read.`);
  return { as: 'lead', caller: lead };
}

async function workflowMessages(options) {
  await assertOperatorReader({ consumer: options.consumer, env: gateEnv(options), proof: options.proof });
  const { listMailboxReceipts, listMailboxPublications } = await import('./mailbox-receipts.mjs');
  const query = { ...options, allAgents: true, env: { ...process.env, ...(options.env || {}), AGENT_ORCHESTRATION_STATE_HOME: options.stateHome || stateRoot(options.env) } };
  const receipts = await listMailboxReceipts(query);
  const publications = await listMailboxPublications(query);
  const displayBody = envelope => options.workflowId.startsWith('goal-loop:') && envelope.context.stage === 'goal-phase'
    ? `Phase obligation: ${envelope.context.phase || 'current phase'}; attempt ${envelope.context.attempt || 'current'}. See the goal details for its deadline and required evidence.`
    : envelope.body.slice(0, 128 * 1024);
  const rows = publications.map(p => ({ agentId: p.envelope.to, id: p.messageId, direction: 'out', kind: p.kind,
    body: displayBody(p.envelope), truncated: p.envelope.body.length > 128 * 1024,
    publicationStatus: p.status, publishedAt: p.publishedAt, taskId: p.envelope.context.taskId,
    updatedAt: p.updatedAt || p.createdAt }));
  for (const r of receipts) {
    const row = rows.find(p => p.id === r.messageId && p.kind === r.kind && p.agentId === r.agent);
    const receipt = { receiptStatus: r.status, acceptedAt: r.acceptedAt, disposition: r.disposition, updatedAt: r.updatedAt };
    if (row) Object.assign(row, receipt);
    else rows.push({ agentId: r.agent, id: r.messageId, kind: r.kind, direction: 'in', body: displayBody(r.envelope),
      truncated: r.envelope.body.length > 128 * 1024, taskId: r.envelope.context.taskId, ...receipt });
  }
  return rows.sort((a, b) => String(a.updatedAt).localeCompare(String(b.updatedAt))).slice(-200);
}

export async function controlWorkflow({ consumer, request, launch, failover, deliver, stateHome = stateRoot(), tmuxApi = tmux, authenticatedHuman = false, goalControl }) {
  invariant(request?.schemaVersion === 1 && ['launch', 'message', 'review', 'failover', 'stop', 'retry', 'goal-control'].includes(request.action), 'TOPOLOGY_CONTROL_REQUEST', 'Unsupported console control request.');
  invariant(typeof request.actor?.id === 'string' && request.actor.id.trim().length > 0 && request.actor.id.length <= 200,
    'TOPOLOGY_CONTROL_ACTOR', 'An authenticated actor label is required.');
  invariant(typeof request.idempotencyKey === 'string' && request.idempotencyKey.length > 0 && request.idempotencyKey.length <= 200,
    'TOPOLOGY_CONTROL_IDEMPOTENCY', 'A bounded idempotency key is required.');
  const repository = await workflowRepository(consumer), payload = request.payload || {};
  const requestId = hash(request.idempotencyKey), fingerprint = hash(JSON.stringify(request));
  const path = join(stateHome, 'workflow-controls', 'v1', repository.key, `${requestId}.json`);
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  return withLock(`${path}.lock`, async () => {
    const prior = await readJson(path).catch(error => { if (error.code === 'ENOENT') return null; throw error; });
    invariant(!prior || prior.fingerprint === fingerprint, 'TOPOLOGY_CONTROL_CONFLICT', 'This idempotency key was already used for a different request.');
    if (prior?.outcome) return prior.outcome;
    invariant(!prior || request.action === 'goal-control' && prior.goalRequest, 'TOPOLOGY_CONTROL_UNCERTAIN', 'The earlier request did not record completion. Inspect its workflow before issuing another request.');
    const perform = async () => {
    let target = null;
    if (request.action !== 'launch') {
      target = await indexedWorkflow({ consumer, workflowId: request.workflowId, stateHome });
      invariant(request.action === 'goal-control' ? target.loop : target.run, 'TOPOLOGY_RUNTIME_UNSUPPORTED', 'Select an operation for this workflow runtime.');
      if (request.expectedRevision !== undefined && !prior?.goalRequest) invariant(String(request.expectedRevision) === target.entry.revision, 'TOPOLOGY_CONTROL_REVISION', 'Workflow changed since the decision was prepared. Refresh and review the current revision.');
    }
    if (request.action === 'goal-control') {
      invariant(authenticatedHuman && request.expectedRevision !== undefined, 'TOPOLOGY_CONTROL_ACTOR', 'Goal decisions require the authenticated operator boundary and current revision.');
      invariant(prior?.goalRequest || String(target.loop.revision) === String(target.entry.nativeRevision),
        'TOPOLOGY_CONTROL_REVISION', 'The goal changed before discovery refreshed. Refresh the workflow before deciding.');
      const control = goalControl || (await import('./goal-loop.mjs')).controlGoalLoop;
      const goalRequest = prior?.goalRequest || { action: payload.action, reason: payload.reason, decision: payload.decision,
        ...(payload.choice === undefined ? {} : { choice: payload.choice }),
        idempotencyKey: request.idempotencyKey, expectedRevision: target.loop.revision, actor: request.actor };
      // Persist the native revision before control. If the process exits after the
      // loop commits, replay uses that same request rather than today's revision.
      await writeJson(path, { schemaVersion: 1, requestId, fingerprint, goalRequest, startedAt: prior?.startedAt || nowIso() });
      const result = await control({ consumer, loopId: target.loop.loopId, stateHome,
        env: { ...process.env, AGENT_ORCHESTRATION_STATE_HOME: stateHome }, authenticatedHuman: true,
        request: goalRequest });
      const index = await reconcileWorkflows({ consumer, stateHome });
      const outcome = { ok: true, action: request.action, workflowId: request.workflowId, requestId,
        revision: index.workflows.find(item => item.workflowId === request.workflowId)?.revision, result: { state: result.state } };
      await writeJson(path, { schemaVersion: 1, requestId, fingerprint, completedAt: nowIso(), outcome });
      return outcome;
    }
    const record = { schemaVersion: 1, requestId, fingerprint, action: request.action, actor: request.actor, workflowId: request.workflowId || null, startedAt: nowIso() };
    await writeJson(path, record);
    let outcome;
    try {
      let result;
      if (target) await appendJournal(target.runDir, { type: 'control.requested', action: request.action, requestId, actor: request.actor });
      if (request.action === 'stop') result = await stopNativeRun({ runDir: target.runDir, actor: request.actor, tmuxApi });
      else if (request.action === 'message') {
        invariant(Array.isArray(payload.to) && payload.to.length > 0 && payload.to.every(id => target.run.agents.some(agent => agent.id === id)), 'TOPOLOGY_CONTROL_RECIPIENT', 'Message recipients must be members of this workflow.');
        invariant(typeof payload.body === 'string' && payload.body.trim().length > 0 && payload.body.length <= 128 * 1024, 'TOPOLOGY_CONTROL_MESSAGE', 'Provide a nonempty message up to 128 KiB.');
        invariant(payload.stage === undefined || /^[a-z][a-z0-9-]{0,39}$/.test(payload.stage), 'TOPOLOGY_STAGE_INVALID', 'Message stage must be a lowercase slug.');
        await assertRunOwnership(target.run, { tmuxApi });
        const message = await sendMessage({ runDir: target.runDir, from: 'human', to: payload.to, stage: payload.stage || 'operator-message', body: payload.body,
          idempotencyKey: request.idempotencyKey, consumer: target.run.consumer, fromProject: target.run.consumer, provenance: { actor: request.actor, requestId } });
        const notifications = [];
        for (const id of payload.to) {
          try { notifications.push(await deliver({ target, agentId: id, message, stage: payload.stage || 'operator-message' })); }
          catch (error) { notifications.push({ agentId: id, ok: false, ...errorOf(error) }); }
        }
        result = { message, notifications, published: true, delivered: notifications.every(item => item?.rang === true) };
      } else if (request.action === 'review') {
        invariant(['approve', 'reject'].includes(payload.decision) && typeof payload.revision === 'string' && payload.revision.length > 0,
          'TOPOLOGY_CONTROL_REVIEW', 'A human decision must name approve or reject and the exact reviewed source revision.');
        const current = await loadRun(target.runDir);
        const decision = { decision: payload.decision, revision: payload.revision, note: String(payload.note || '').slice(0, 8192), actor: request.actor, at: nowIso() };
        current.human_decisions = [...(current.human_decisions || []), decision];
        await saveRun(target.runDir, current);
        await appendJournal(target.runDir, { type: 'review.human_decision', ...decision });
        result = { decision, independentReviewRequired: true, integrationAuthorized: false };
      } else if (request.action === 'failover') {
        await assertRunOwnership(target.run, { tmuxApi });
        invariant(typeof payload.agentId === 'string' && target.run.agents.some(agent => agent.id === payload.agentId), 'TOPOLOGY_UNKNOWN_AGENT', 'Failover requires an indexed workflow member.');
        result = await failover({ target, agentId: payload.agentId, to: payload.to, actor: request.actor });
      } else {
        if (request.action === 'retry') {
          invariant(TERMINAL.has(target.run.state), 'TOPOLOGY_RETRY_ACTIVE', 'Stop the existing attempt before retrying it.');
          await assertRunOwnership(target.run, { tmuxApi, requireAlive: false }).then(ownership => invariant(ownership.gone, 'TOPOLOGY_RETRY_ACTIVE', 'The recorded attempt still has live panes.'));
          invariant((target.run.render_recipe || target.run.launch_spec?.render_recipe)?.schemaVersion === 1,
            'TOPOLOGY_RETRY_UNAVAILABLE', 'This legacy attempt has no retained original workflow recipe. Preserve it and launch a reviewed saved workflow.');
        } else invariant(typeof payload.workflowName === 'string' && payload.workflowName.length > 0, 'TOPOLOGY_WORKFLOW_REQUIRED', 'Choose a saved workflow name.');
        const runId = newRunId();
        record.newRunId = runId; await writeJson(path, record);
        result = await launch({ consumer, workflowName: payload.workflowName, inputs: payload.inputs || {}, runId, retry: target?.run || null, actor: request.actor, stateHome });
        record.workflowId = `topology:${runId}`;
        if (target) await appendJournal(target.runDir, { type: 'run.retried', retry_run_id: runId, actor: request.actor });
      }
      if (target) await appendJournal(target.runDir, { type: 'control.completed', action: request.action, requestId, actor: request.actor, ok: result?.ok !== false });
      await reconcileWorkflows({ consumer, stateHome });
      const workflowId = record.workflowId || request.workflowId;
      const index = await readWorkflowIndex({ consumer, stateHome });
      outcome = { ok: result?.ok !== false, action: request.action, workflowId, requestId, revision: index.workflows.find(item => item.workflowId === workflowId)?.revision || null, result };
    } catch (error) {
      outcome = { ok: false, action: request.action, workflowId: record.workflowId || request.workflowId || (record.newRunId ? `topology:${record.newRunId}` : null), requestId, ...errorOf(error), details: error.details || null };
      if (target) await appendJournal(target.runDir, { type: 'control.failed', action: request.action, requestId, actor: request.actor, error: errorOf(error) });
    }
    await writeJson(path, { ...record, completedAt: nowIso(), outcome });
    return outcome;
    };
    return withLock(join(stateHome, 'workflow-operation-locks', repository.key, hash(request.workflowId || `launch:${payload.workflowName || ''}`)), perform);
  });
}
