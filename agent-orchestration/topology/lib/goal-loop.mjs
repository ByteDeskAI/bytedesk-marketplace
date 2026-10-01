// Durable coordinator, not a second executor. Public TM commands own goals and task
// evidence; the standing lead owns governed dispatch/review/integration.
import { mkdir, readdir, readFile, realpath, stat, writeFile, open } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { homedir } from 'node:os';
import { canonicalRepoId, repositoryConsumer, repoKey, stateRoot } from './repoid.mjs';
import { withLock } from './lockfile.mjs';
import { readJson, writeJson, run, invariant } from './util.mjs';
import { loadConfig } from './config.mjs';
import { resolveEnrollment } from './repo-enrollment.mjs';
import { sendStandingMessage, readStandingMessage } from './standing-mailbox.mjs';
import { managementStatus, taskWorkerState, integrationEligibility } from './management.mjs';
import { GOAL_LOOP_PHASES, GOAL_LOOP_RECIPE_VERSION, GOAL_LOOP_DEFAULT_LIMITS, goalLoopDigest as hash,
  requireGoalLoop as check, actorId, requestKey, validateGoal, validateRecipe, validateReport, phasePrompt, scopedDecision } from './goal-loop-contract.mjs';

const terminal = new Set(['proven', 'stopped']);
const missing = error => { if (error.code === 'ENOENT') return null; throw error; };
const clock = options => new Date(options.now ? options.now() : Date.now()).toISOString();
const clone = value => JSON.parse(JSON.stringify(value));
function loopName(id) { check(/^gl-[a-f0-9]{24}$/.test(id ?? ''), 'Invalid goal loop ID.'); return id; }

async function context(options) {
  check(isAbsolute(options.consumer ?? ''), 'An explicit absolute consumer is required.');
  const consumer = await realpath(options.consumer);
  const identity = await canonicalRepoId(consumer);
  const root = join(options.stateHome ?? stateRoot(options.env ?? process.env, options.home ?? homedir()), 'goal-loops', 'v1', repoKey(identity.id));
  return { consumer, repository: { id: identity.id, key: repoKey(identity.id) }, root };
}
async function load(ctx, id) {
  const recordPath = join(ctx.root, loopName(id), 'loop.json');
  const loop = await readJson(recordPath);
  check(loop.schemaVersion === 1 && loop.repository?.id === ctx.repository.id && loop.loopId === id, 'Goal loop belongs to another repository or has invalid state.');
  return { ...loop, recordPath };
}
async function persist(loop, options, event) {
  loop.updatedAt = clock(options); loop.revision += 1;
  if (event) loop.history.push({ at: loop.updatedAt, revision: loop.revision, ...event });
  await writeJson(loop.recordPath, loop);
  if (process.platform !== 'win32') {
    const dir = await open(dirname(loop.recordPath), 'r');
    try { await dir.sync(); } finally { await dir.close(); }
  }
}
async function publish(loop, options) {
  try {
    const publishFn = options.publish ?? (await import('./discovery.mjs')).publishGoalLoopWorkflow;
    if (publishFn) await publishFn({ ...options, loop, recordPath: loop.recordPath });
    return loop;
  } catch (error) { return { ...loop, discoveryDiagnostic: { code: error.code ?? 'GOAL_DISCOVERY_FAILED', message: 'Loop committed; workflow discovery could not refresh.' } }; }
}
async function locked(options, work) {
  const ctx = await context(options);
  const path = join(ctx.root, loopName(options.loopId), 'loop.json');
  return withLock(`${path}.lock`, async () => publish(await work(await load(ctx, options.loopId), ctx), options));
}

async function tm(options, args, input) {
  if (options.tm) return options.tm(args, input);
  const consumer = await repositoryConsumer(options.consumer);
  const argv = [...args];
  if (input !== undefined) {
    const ctx = await context(options);
    const path = join(ctx.root, 'tm-inputs', `${hash({ args, input })}.json`);
    await writeJson(path, input); argv.push('--file', path);
  }
  argv.push('--json');
  const result = await run(options.tmBin ?? join(consumer, '.bytedesk/task-management/bin/tm'), argv, {
    cwd: consumer, env: { ...(options.env ?? process.env), TM_ROOT: consumer, CLAUDE_PROJECT_DIR: consumer }, timeoutMs: 30_000, maxBuffer: 2 * 1024 * 1024,
  });
  const data = JSON.parse(result.stdout);
  check(data?.ok !== false, 'Task Management refused the operation.', { reason: data.reason ?? data.error });
  return data;
}
async function goalFor(loop, options) {
  const result = await tm(options, ['goal', 'show', loop.goalId]);
  return { ...validateGoal(result.goal ?? result), verification: result.verification ?? null };
}
async function activationFor(loop, options) {
  if (options.supervisorTick) return { state: 'ready' };
  try {
    const activate = options.activate ?? (await import('./repo-enrollment.mjs')).activateRepository;
    const result = await activate({ ...options, consumer: loop.consumer, reason: 'goal-loop', env: { ...(options.env ?? process.env), AO_NATS_AUTOSTART: '0' } });
    return result.supervision?.ready === true ? { state: 'ready' } : { state: 'unavailable', reason: result.supervision?.state ?? result.supervision?.reason ?? 'supervisor did not confirm its first tick' };
  } catch { return { state: 'unavailable', reason: 'supervisor activation failed' }; }
}
function applyGoalVerification(loop, goal) {
  loop.goalVerification = goal.verification;
  loop.goalAssessment = goal.assessments?.find(a => a.id === (goal.latestAssessmentId ?? loop.assessmentId)) ?? null;
  if (loop.state === 'proven' && (goal.verification?.completionReady !== true || goal.revision !== loop.goalRevision || goal.scopeHash !== loop.scopeHash)) {
    hold(loop, 'GOAL_LOOP_PROOF_INVALID', 'Task Management can no longer verify the recorded completion. Inspect the current goal and its retained evidence.', 'human_required');
  }
}
async function proofView(loop, options) {
  if (loop.state !== 'proven') return loop;
  const view = clone(loop);
  try { applyGoalVerification(view, await goalFor(loop, options)); }
  catch { hold(view, 'GOAL_LOOP_PROOF_UNAVAILABLE', 'Current completion proof could not be checked through Task Management.', 'human_required'); view.goalVerification = null; }
  return view;
}
async function selectedRecipe(ctx, goal, request, options) {
  const loaded = options.config ? { config: options.config, errors: [] } : await loadConfig({ home: options.home, env: options.env });
  check(loaded.errors.length === 0, 'Global orchestration configuration is invalid.');
  check(loaded.config.goal_loop?.enabled !== false, 'Goal feedback loops are disabled in global configuration.');
  const entries = loaded.config.goal_loop?.deploymentRecipes ?? [];
  check(Array.isArray(entries), 'Global goal_loop.deploymentRecipes must be an array.');
  const id = request.deploymentRecipeId ?? request.deploymentRecipe?.id;
  const matches = entries.filter(e => e.id === id && (e.repositoryId === ctx.repository.id || e.repositoryKey === ctx.repository.key));
  check(matches.length === 1, 'Choose exactly one repository-scoped recipe in global goal_loop.deploymentRecipes.');
  const recipe = validateRecipe(matches[0], goal);
  if (request.deploymentRecipe) check(hash(request.deploymentRecipe) === hash(recipe), 'Recipe preview differs from the configured recipe.');
  return recipe;
}
function limitsFor(goal) {
  const value = { ...GOAL_LOOP_DEFAULT_LIMITS, ...goal.limits, deadlineMinutes: goal.limits?.phaseDeadlineMinutes ?? goal.limits?.deadlineMinutes ?? GOAL_LOOP_DEFAULT_LIMITS.deadlineMinutes };
  for (const name of ['maxStalls', 'maxCycles', 'deadlineMinutes']) check(Number.isSafeInteger(value[name]) && value[name] > 0 && value[name] <= 10080, `Invalid goal limit ${name}.`);
  return value;
}
function newObligation(loop, options) {
  const id = `${loop.loopId}:${loop.attempt}:${loop.phase}${loop.phaseRound ? `:decision-${loop.phaseRound}` : ''}`;
  loop.obligation = { id, phase: loop.phase, createdAt: clock(options), deadlineAt: new Date(Date.parse(clock(options)) + loop.limits.deadlineMinutes * 60_000).toISOString(), delivery: null };
  loop.obligation.prompt = phasePrompt(loop);
}

export async function startGoalLoop(options) {
  const ctx = await context(options), request = options.request;
  requestKey(request); actorId(request.actor);
  const goalId = options.goalId ?? request.goalId;
  check(/^EP-\d+$/.test(goalId ?? ''), 'Goal must be an epic ID.');
  check(typeof request.leadId === 'string' && /^[A-Za-z0-9_-]{1,100}$/.test(request.leadId), 'An explicit standing lead identity is required.');
  const loopId = `gl-${hash({ repository: ctx.repository.id, goalId, key: request.idempotencyKey }).slice(0, 24)}`;
  await mkdir(ctx.root, { recursive: true });
  const loop = await withLock(join(ctx.root, 'admission.lock'), async () => {
    const recordPath = join(ctx.root, loopId, 'loop.json');
    const previous = await readJson(recordPath).catch(missing);
    if (previous) { check(previous.startFingerprint === hash(request), 'Start idempotency key was reused with another request.'); return previous; }
    for (const old of await listGoalLoops(options)) check(old.goalId !== goalId || terminal.has(old.state), 'This goal already has an unfinished loop.', { loopId: old.loopId });
    const result = await tm(options, ['goal', 'show', goalId]);
    const goal = validateGoal(result.goal ?? result);
    check(goal.status !== 'proven', 'This goal is already proven; propose a new goal rather than rerunning it.');
    check(goal.revision === request.goalRevision && goal.scopeHash === request.scopeHash, 'Goal changed since the start request was prepared.');
    const deploymentRecipe = await selectedRecipe(ctx, goal, request, options);
    const enrollment = await (options.enrollment ?? resolveEnrollment)({ ...options, consumer: ctx.consumer });
    // A repository-specific global recipe is explicit loop opt-in, but never overrides an explicit veto.
    check(enrollment?.enrolled !== false || !['repo-disabled', 'disabled', 'global-disabled'].includes(enrollment?.source), 'Repository explicitly disabled orchestration.');
    check(enrollment?.reason !== 'explicitly_disabled' && enrollment?.enabled !== false, 'Repository explicitly disabled orchestration.');
    const next = { schemaVersion: 1, runtime: 'goal-loop', loopId, workflowId: `goal-loop:${loopId}`, recordPath,
      repository: ctx.repository, consumer: ctx.consumer, evidenceRoot: await repositoryConsumer(ctx.consumer), goalId, goalRevision: goal.revision, scopeHash: goal.scopeHash,
      original: clone(goal.original), criteria: clone(goal.criteria), authority: clone(goal.authority), authorityVersion: hash(goal.authority),
      recipeVersion: GOAL_LOOP_RECIPE_VERSION, deploymentRecipe, deploymentRecipeHash: hash(deploymentRecipe), limits: limitsFor(goal),
      leadId: request.leadId, actor: request.actor, startFingerprint: hash(request), state: 'running', revision: 0,
      phase: 'pm', attempt: 1, cycle: 1, stalls: 0, bestProven: 0, artifact: null, implementerId: null, taskIds: [],
      createdAt: clock(options), updatedAt: clock(options), reports: [], history: [], decisions: [], controls: {}, diagnostic: null };
    newObligation(next, options);
    await persist(next, options, { type: 'started', actor: request.actor });
    return next;
  });
  // Admission is already durable; any failed prerequisites remain visible and retryable.
  return reconcileGoalLoop({ ...options, loopId: loop.loopId });
}
export async function showGoalLoop(options) { return proofView(await load(await context(options), options.loopId), options); }
/** Safe console projection: no argv, prompts or evidence contents. */
export function goalLoopSummary(loop) {
  const assessment = loop.goalAssessment;
  const proofValid = loop.goalVerification?.completionReady === true;
  return { goalId: loop.goalId, goalRevision: loop.goalRevision, scopeHash: loop.scopeHash, goalSummary: loop.original?.objective,
    phase: loop.phase, owner: loop.leadId, attempt: loop.attempt, repairCycles: loop.cycle - 1, noProgressCycles: loop.stalls,
    limits: { maxRepairCycles: loop.limits.maxCycles, maxNoProgressCycles: loop.limits.maxStalls, phaseTimeoutMs: loop.limits.deadlineMinutes * 60_000 },
    deadlineAt: loop.obligation?.deadlineAt ?? null, lastAcceptedEvidenceAt: [...loop.reports].reverse().find(r => r.applied && r.input.status === 'succeeded')?.at ?? null,
    artifact: { sourceRevision: loop.builtArtifact ?? loop.artifact, artifactId: loop.artifact, environment: loop.authority.testTarget },
    diagnostic: loop.diagnostic ? { ...loop.diagnostic, nextAction: loop.state === 'human_required' ? 'Inspect the phase and decide through the operator control.' : 'Inspect the durable obligation and resolve the named prerequisite.', retryAt: null } : null,
    requiredDecision: loop.pendingDecision ?? (loop.state === 'human_required' ? { kind: 'retry', loopId: loop.loopId, attempt: loop.attempt, phase: loop.phase, artifact: loop.artifact, goalRevision: loop.goalRevision, scopeHash: loop.scopeHash } : null),
    criteria: loop.criteria.map(c => { const a = assessment && assessment.artifact === loop.artifact && Array.isArray(assessment.criteria) ? assessment.criteria.find(x => x.id === c.id) : null; return { id: c.id, text: c.text, status: a?.verdict === 'proven' && !proofValid ? 'unproven' : a?.verdict ?? 'unproven', evidenceRefs: a?.evidence ?? [] }; }),
    state: loop.state, updatedAt: loop.updatedAt };
}
export async function listGoalLoops(options) {
  const ctx = await context(options);
  const entries = await readdir(ctx.root).catch(error => error.code === 'ENOENT' ? [] : Promise.reject(error));
  const loops = [];
  for (const entry of entries.filter(id => /^gl-[a-f0-9]{24}$/.test(id))) loops.push(await proofView(await load(ctx, entry), options));
  return loops.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

async function evidenceFiles(loop, paths, options) {
  if (options.evidence) return options.evidence(paths, loop);
  const root = await realpath(loop.evidenceRoot ?? await repositoryConsumer(loop.consumer)), files = [];
  for (const item of [...new Set(paths)]) {
    check(typeof item === 'string' && !isAbsolute(item), 'Evidence paths must be consumer-relative.');
    const path = await realpath(resolve(root, item));
    const rel = relative(root, path);
    check(rel && !rel.startsWith('..') && !isAbsolute(rel), 'Evidence escaped the consumer checkout.');
    const info = await stat(path); check(info.isFile() && info.size > 0 && info.size <= 4 * 1024 * 1024, 'Evidence must be a nonempty bounded file.');
    const bytes = await readFile(path), digest = hash(bytes.toString('base64'));
    const retained = join(dirname(loop.recordPath), 'evidence', digest);
    await mkdir(dirname(retained), { recursive: true }); await writeFile(retained, bytes, { mode: 0o600 });
    files.push({ path: item, digest, retained });
  }
  return files;
}
async function receipt(loop, path, options) {
  if (options.receipt) return options.receipt(path, loop);
  await evidenceFiles(loop, [path], options);
  return readJson(resolve(loop.evidenceRoot ?? await repositoryConsumer(loop.consumer), path));
}
async function reportEvidence(loop, report, options) {
  const d = report.details ?? {}, a = d.assessment;
  const paths = [...report.evidence, d.plan, d.landingReceipt, d.deployment, d.source, d.evaluation?.evidence, a?.source, a?.deployment,
    ...(a?.criteria ?? []).flatMap(c => c.evidence ?? []), ...(report.knowledgeRefs ?? []).flatMap(k => k.evidence)].filter(Boolean);
  for (const source of [...new Set([d.source, a?.source].filter(Boolean))]) {
    const r = await receipt(loop, source, options);
    paths.push(...(r.criteria ?? []).flatMap(c => c.evidence ?? []));
  }
  return evidenceFiles(loop, paths, options);
}
async function authenticateReport(loop, report, options) {
  if (options.authenticateReport) return options.authenticateReport(loop, report);
  const env = options.env ?? process.env;
  check(env.AO_AGENT_ID === loop.leadId && report.actor.id === loop.leadId && env.AO_CONSUMER, 'Phase reports require the receiving standing lead’s launcher identity.');
  check((await canonicalRepoId(env.AO_CONSUMER)).id === loop.repository.id, 'Report launcher belongs to another repository.');
}
async function taskDocs(loop, ids, options) {
  const docs = [];
  for (const id of ids) {
    const result = await tm(options, ['show', id]); const doc = result.task ?? result;
    check(doc.id === id && doc.epic === loop.goalId, 'Phase task does not belong to this goal.', { task: id }); docs.push(doc);
  }
  return docs;
}
function finishedByCurrentWorker(record) {
  if (!record?.worker || !record.finish || !Array.isArray(record.events)) return false;
  const finish = record.events.findLastIndex(e => e.event === 'finish' && hash(e.report) === hash(record.finish));
  const binding = record.events.findLastIndex(e => ['worker-bound', 'worker-started'].includes(e.event));
  if (finish < 0 || binding >= finish) return false;
  if (binding >= 0) {
    const event = record.events[binding];
    return event.event !== 'worker-bound' || ['name', 'run', 'owner', 'backend'].every(key => event.worker?.[key] === record.worker[key]);
  }
  // Older native finishes observed their worker inside workerReport rather than
  // a separate bind call. Its observation must still predate the finish event.
  return Number.isFinite(Date.parse(record.worker.observed_at)) && Date.parse(record.worker.observed_at) <= Date.parse(record.events[finish].at);
}
function workerIncarnation(worker) {
  const { observed_at, stopped_at, ...identity } = worker;
  return identity;
}
async function verifyPhase(loop, report, options) {
  await taskDocs(loop, report.taskIds, options);
  if (options.verifyPhase) return options.verifyPhase(loop, report);
  const facts = { taskArtifacts: clone(report.details?.taskArtifacts ?? {}) };
  const inspect = options.managementStatus ?? managementStatus;
  const ancestor = options.isAncestor ?? (async (source, aggregate) => (await run('git', ['-C', loop.evidenceRoot ?? loop.consumer, 'merge-base', '--is-ancestor', source, aggregate], { allowFailure: true })).code === 0);
  if (report.phase === 'build' || report.phase === 'integration') for (const task of report.taskIds) {
    const status = await inspect({ ...options, consumer: loop.consumer, task }), revision = facts.taskArtifacts[task];
    check(status.management?.finish?.revision === revision.sourceRevision && finishedByCurrentWorker(status.management), 'Task lacks a governed finish from its current worker for the exact source revision.', { task });
    if (report.phase === 'build') {
      check(await ancestor(revision.sourceRevision, report.artifact), 'Aggregate build does not contain every task source revision.', { task });
      check(status.management.worker?.name && status.management.worker?.run, 'Implementation worker incarnation is unproven.', { task });
      revision.implementerId = status.management.worker.name; revision.runId = status.management.worker.run;
      revision.workerDigest = hash(workerIncarnation(status.management.worker));
    }
    if (report.phase === 'integration') {
      check(loop.taskArtifacts?.[task]?.sourceRevision === revision.sourceRevision, 'Integration changed a task source after QA and review.', { task });
      check(['merged', 'cleaned'].includes(status.management.state) && status.management.merge?.landed === revision.landedRevision && status.task.status === 'done', 'Task lacks a verified governed landing and closure.', { task });
      check(await ancestor(revision.landedRevision, report.details.landedArtifact), 'Aggregate landing does not contain every landed task revision.', { task });
    }
  }
  if (report.phase === 'build') check(Object.values(facts.taskArtifacts).some(v => v.implementerId === report.details.implementerId), 'Primary implementer does not match an observed implementation worker.');
  if (report.phase === 'review') for (const task of report.taskIds) {
    const gate = await (options.integrationEligibility ?? integrationEligibility)({ ...options, consumer: loop.consumer, task });
    check(gate.review?.eligible === true && gate.record?.finish?.revision === loop.taskArtifacts?.[task]?.sourceRevision && gate.review.status?.review?.reviewer_id === report.details.evaluator.id, 'Exact independent review is not eligible for this reviewer and task source.', { task, reasons: gate.review?.reasons });
  }
  if (['qa', 'integration-qa', 'dogfood'].includes(report.phase)) {
    const d = report.details, evaluation = d.evaluation;
    await taskDocs(loop, [evaluation.taskId], options);
    const status = await inspect({ ...options, consumer: loop.consumer, task: evaluation.taskId }), record = status.management;
    check(record?.worker?.name === d.evaluator.id && record.worker.run === evaluation.runId && record.finish?.revision === loop.artifact && finishedByCurrentWorker(record), 'Evaluation lacks the observed worker incarnation and exact-artifact finish.');
    facts.evaluationWorker = clone(workerIncarnation(record.worker));
    check(Object.values(loop.taskArtifacts ?? {}).every(v => v.implementerId && v.implementerId !== d.evaluator.id && v.runId !== evaluation.runId && d.evaluator.independentOf.includes(v.implementerId)), 'Evaluator is not independent of every observed implementation worker.');
    const root = loop.evidenceRoot ?? loop.consumer;
    check(resolve(root, record.finish.evidence) === resolve(root, evaluation.evidence), 'Evaluation evidence differs from the observed worker finish.');
    if (report.phase === 'dogfood') check(evaluation.evidence === d.source, 'Dogfood receipt must be the observed evaluator finish evidence.');
  }
  if (report.phase === 'test-deploy') {
    const r = await receipt(loop, report.details.deployment, options);
    check(r.schemaVersion === 1 && r.kind === 'deployment' && r.goalId === loop.goalId && r.artifact === loop.artifact && r.environment === loop.authority.testTarget && r.actor && r.source && Number.isFinite(Date.parse(r.deployedAt)), 'Deployment receipt does not prove this artifact/target.');
  }
  if (report.phase === 'dogfood') {
    const r = await receipt(loop, report.details.source, options);
    check(r.schemaVersion === 1 && r.kind === 'dogfood' && r.goalId === loop.goalId && r.revision === loop.goalRevision && r.scopeHash === loop.scopeHash && r.artifact === loop.artifact && r.environment === loop.authority.testTarget && r.evaluator?.id === report.details.evaluator.id && r.implementerId === loop.implementerId, 'Dogfood receipt does not match this goal, evaluator and artifact.');
  }
  return facts;
}
export async function reportGoalLoop(options) {
  const report = options.report ?? options.request;
  return locked(options, async loop => {
    requestKey(report); actorId(report.actor); await authenticateReport(loop, report, options);
    const old = loop.reports.find(r => r.input.idempotencyKey === report.idempotencyKey);
    if (old) { check(old.fingerprint === hash(report), 'Report key was reused with different content.'); return loop; }
    check(!terminal.has(loop.state) && loop.state !== 'human_required', 'This loop requires an operator decision or is terminal.');
    check(Date.parse(clock(options)) < Date.parse(loop.obligation.deadlineAt), 'Phase deadline has expired; reconcile for the persisted human decision.');
    validateReport(report, loop);
    check(!loop.reports.some(r => r.input.obligationId === report.obligationId && ['succeeded', 'failed'].includes(r.input.status)), 'This obligation already has a terminal phase report.');
    const files = await reportEvidence(loop, report, options);
    await taskDocs(loop, report.taskIds, options);
    const facts = report.status === 'succeeded' ? await verifyPhase(loop, report, options) : null;
    const row = { input: clone(report), fingerprint: hash(report), evidence: files, facts: facts ?? null, at: clock(options), applied: false };
    loop.reports.push(row); loop.taskIds = [...new Set([...loop.taskIds, ...report.taskIds])];
    await persist(loop, options, { type: 'phase.reported', obligationId: report.obligationId, status: report.status });
    return loop;
  }).then(loop => reconcileGoalLoop({ ...options, loopId: loop.loopId }));
}

async function writersResolved(loop, options) {
  if (options.writersResolved) return options.writersResolved(loop);
  const all = await tm(options, ['find', `epic:${loop.goalId}`, 'kind:task']);
  const docs = Array.isArray(all) ? all : all.tasks;
  check(Array.isArray(docs), 'Task writer census is unavailable.');
  for (const doc of docs) {
    if (!doc.dispatched && !doc.governance) continue;
    const status = await (options.managementStatus ?? managementStatus)({ ...options, consumer: loop.consumer, task: doc.id });
    const record = status.management;
    // Successful producer cleanup already observed the exact worker exit before
    // removing its worktree and releasing its claim. Requiring that deleted
    // worktree for a later census would permanently prevent every repair.
    if (doc.status === 'done' && record?.state === 'cleaned' && record.collected === true && record.finish?.revision === record.merge?.revision && record.worker &&
      (!doc.dispatched || doc.dispatched.run === record.worker.run) && record.events?.some(event => event.event === 'cleanup' && event.status === 'complete' && event.worktree === record.worktree && event.branch === record.branch)) continue;
    const observed = await taskWorkerState({ ...options, consumer: loop.consumer, task: doc.id }, status.management);
    if (!observed.owned || observed.active !== false) return { resolved: false, taskId: doc.id, reason: observed.reason ?? 'Prior writer is active or unknown.' };
  }
  return { resolved: true };
}
function hold(loop, code, message, state = 'blocked') { loop.state = state; loop.diagnostic = { code, message }; }
function resetAttempt(loop, options) {
  for (const row of loop.reports.filter(r => !r.applied)) { row.applied = true; row.superseded = true; }
  loop.attempt += 1; loop.cycle += 1; loop.phase = 'pm'; loop.artifact = null; loop.builtArtifact = null; loop.implementerId = null;
  loop.state = 'running'; loop.diagnostic = null; loop.repairPending = false; loop.deployment = null; loop.dogfood = null;
  loop.taskIds = []; loop.taskArtifacts = {}; loop.evaluationTaskIds = []; loop.pendingDecision = null; loop.phaseRound = 0;
  newObligation(loop, options);
}
async function repair(loop, options) {
  if (loop.cycle - 1 >= loop.limits.maxCycles || loop.stalls >= loop.limits.maxStalls) {
    hold(loop, 'GOAL_LOOP_LIMIT', 'Persistent repair/no-progress limit reached. A human decision is required.', 'human_required'); return;
  }
  const writers = await writersResolved(loop, options);
  if (!writers.resolved) { hold(loop, 'GOAL_LOOP_WRITER_UNRESOLVED', writers.reason); return; }
  resetAttempt(loop, options);
}
async function applyReport(loop, row, options) {
  const report = row.input;
  check(report.obligationId === loop.obligation.id, 'An unapplied report belongs to a superseded obligation.');
  if (report.status === 'progress') { row.applied = true; return; }
  if (report.status === 'human_required') {
    loop.pendingDecision = { id: `${loop.obligation.id}:decision`, ...scopedDecision(report, loop), loopId: loop.loopId, attempt: loop.attempt, phase: loop.phase, artifact: loop.artifact, goalRevision: loop.goalRevision, scopeHash: loop.scopeHash };
    hold(loop, 'GOAL_LOOP_HUMAN_REQUIRED', report.details?.reason ?? 'Phase needs a scoped human decision.', 'human_required'); row.applied = true; return;
  }
  if (report.status === 'failed') {
    loop.stalls += 1; loop.repairPending = true; row.applied = true;
    hold(loop, 'GOAL_LOOP_PHASE_FAILED', report.details?.reason ?? 'Phase failed; resolve existing writers before repair.'); return;
  }
  // A report is retained before effects. Recheck its facts after restart or a
  // long operator pause, rather than promoting a stale review/evidence snapshot.
  const currentEvidence = await reportEvidence(loop, report, options);
  check(!row.evidence.length || hash(currentEvidence.map(e => [e.path, e.digest])) === hash(row.evidence.map(e => [e.path, e.digest])), 'Phase evidence changed after its report was recorded.');
  const facts = await verifyPhase(loop, report, options);
  check(!row.facts || hash(row.facts) === hash(facts), 'Observed task or evaluator incarnation changed after reporting.');
  if (report.phase === 'assessment') {
    for (const phase of ['test-deploy', 'dogfood']) {
      const prior = [...loop.reports].reverse().find(r => r.applied && !r.superseded && r.input.attempt === loop.attempt && r.input.phase === phase && r.input.artifact === loop.artifact && r.input.status === 'succeeded');
      check(prior, `Assessment lacks this attempt's completed ${phase} evidence.`);
      const current = await reportEvidence(loop, prior.input, options);
      check(hash(current.map(e => [e.path, e.digest])) === hash(prior.evidence.map(e => [e.path, e.digest])), `Retained ${phase} evidence changed before assessment.`);
    }
    const a = { ...report.details.assessment, idempotencyKey: `${loop.obligation.id}:assessment` };
    check(a.revision === loop.goalRevision && a.scopeHash === loop.scopeHash && a.artifact === loop.artifact && a.environment === loop.authority.testTarget && a.implementerId === loop.implementerId && a.source === loop.dogfood && a.deployment === loop.deployment, 'Assessment must reuse this attempt’s exact deployment and dogfood evidence.');
    for (const [index, finding] of (report.details.findings ?? []).entries()) await tm(options, ['goal', 'finding', loop.goalId], { ...finding, idempotencyKey: `${loop.obligation.id}:finding:${index}` });
    const assessed = await tm(options, ['goal', 'assess', loop.goalId], a);
    loop.assessmentId = assessed.goal?.latestAssessmentId ?? assessed.goal?.assessments?.at(-1)?.id;
    loop.goalAssessment = assessed.goal?.assessments?.find(value => value.id === loop.assessmentId) ?? null;
    const currentGoal = await goalFor(loop, options);
    applyGoalVerification(loop, currentGoal);
    const proven = loop.goalAssessment?.criteria?.filter(c => c.verdict === 'proven').length ?? 0;
    if (!row.accounted) {
      const resolved = (currentGoal.findings ?? []).filter(f => f.status === 'resolved' && f.resolvedBy === loop.assessmentId && !(loop.resolvedFindingIds ?? []).includes(f.id)).map(f => f.id);
      loop.stalls = proven > loop.bestProven || resolved.length > 0 ? 0 : loop.stalls + 1;
      loop.resolvedFindingIds = [...(loop.resolvedFindingIds ?? []), ...resolved];
      loop.bestProven = Math.max(loop.bestProven, proven); row.accounted = true;
    }
    if (currentGoal.verification?.completionReady === true) {
      const done = await tm(options, ['goal', 'complete', loop.goalId], { revision: loop.goalRevision, scopeHash: loop.scopeHash, artifact: loop.artifact, environment: loop.authority.testTarget, assessmentId: loop.assessmentId, idempotencyKey: `${loop.obligation.id}:complete` });
      check(done.goal?.status === 'proven', 'Task Management did not certify goal completion.');
      loop.state = 'proven'; loop.nextCycleProposal = report.details.nextCycleProposal ?? null; loop.completedAt = clock(options); loop.diagnostic = null;
      applyGoalVerification(loop, await goalFor(loop, options));
    } else if (currentGoal.status === 'human_required') {
      hold(loop, 'GOAL_LOOP_TM_HUMAN_REQUIRED', 'Task Management requires a human decision before another assessment.', 'human_required');
    } else { loop.repairPending = true; hold(loop, 'GOAL_LOOP_CRITERIA_UNMET', currentGoal.verification?.completionReason ?? 'Accepted criteria remain unmet; PM must plan the next bounded repair.'); }
    row.applied = true; return;
  }
  if (report.phase === 'build') { loop.artifact = report.artifact; loop.builtArtifact = report.artifact; loop.implementerId = report.details.implementerId; loop.taskArtifacts = clone(facts?.taskArtifacts ?? report.details.taskArtifacts); }
  if (report.phase === 'integration') { loop.artifact = report.details.landedArtifact; for (const [id, value] of Object.entries(report.details.taskArtifacts)) loop.taskArtifacts[id] = { ...loop.taskArtifacts[id], ...value }; }
  if (report.details.evaluation?.taskId) loop.evaluationTaskIds = [...new Set([...(loop.evaluationTaskIds ?? []), report.details.evaluation.taskId])];
  if (report.phase === 'test-deploy') loop.deployment = report.details.deployment;
  if (report.phase === 'dogfood') loop.dogfood = report.details.source;
  row.applied = true; loop.phase = GOAL_LOOP_PHASES[GOAL_LOOP_PHASES.indexOf(loop.phase) + 1]; loop.phaseRound = 0; loop.state = 'running'; loop.diagnostic = null;
  newObligation(loop, options);
}

export async function reconcileGoalLoop(options) {
  // Activation waits for the supervisor's first tick. Never hold a loop lock
  // while waiting: that tick must be able to reconcile the admitted record.
  const initial = await load(await context(options), options.loopId);
  const activation = terminal.has(initial.state) || ['paused', 'human_required'].includes(initial.state) ? null : await activationFor(initial, options);
  return locked(options, async loop => {
    if (loop.state === 'stopped' || loop.state === 'paused' || loop.state === 'human_required') return loop;
    const before = hash(loop);
    if (loop.state !== 'proven' && Date.parse(loop.obligation.deadlineAt) <= Date.parse(clock(options))) {
      hold(loop, 'GOAL_LOOP_DEADLINE', `Phase ${loop.phase} exceeded its ${loop.limits.deadlineMinutes}-minute deadline. Inspect the existing writer before retrying.`, 'human_required');
      await persist(loop, options, { type: 'deadline', phase: loop.phase }); return loop;
    }
    try {
      const goal = await goalFor(loop, options);
      applyGoalVerification(loop, goal);
      if (initial.state === 'proven') { /* Proof readback only; never reopen execution automatically. */ }
      else if (goal.revision !== loop.goalRevision || goal.scopeHash !== loop.scopeHash || hash(goal.authority) !== loop.authorityVersion) {
        hold(loop, 'GOAL_LOOP_GOAL_CHANGED', 'Goal or authority changed. Review it at an attempt boundary before continuing.', 'human_required');
      } else if (goal.status === 'human_required' && !loop.reports.some(r => !r.applied && r.input.phase === 'assessment')) {
        hold(loop, 'GOAL_LOOP_TM_HUMAN_REQUIRED', 'Task Management requires a human decision before execution continues.', 'human_required');
      } else if (activation?.state !== 'ready') {
        loop.activation = activation;
        hold(loop, 'GOAL_LOOP_SUPERVISION', `Repository supervisor is unavailable: ${activation?.reason ?? 'activation not confirmed'}. Reconcile this loop to retry activation.`);
      } else {
        loop.activation = activation;
        // A failed probe or lost client response is recoverable. Nothing below
        // advances without rechecking its report or observing the durable mail.
        if (loop.state === 'blocked' && !loop.repairPending) { loop.state = 'running'; loop.diagnostic = null; }
        // Report persistence precedes all TM effects. Replays reuse their original keys.
        for (const row of loop.reports.filter(r => !r.applied)) await applyReport(loop, row, options);
        if (loop.repairPending) await repair(loop, options);
        if (loop.state === 'running' || loop.state === 'blocked' && loop.diagnostic?.code === 'GOAL_LOOP_DELIVERY') {
          if (Date.parse(loop.obligation.deadlineAt) <= Date.parse(clock(options))) {
            hold(loop, 'GOAL_LOOP_DEADLINE', `Phase ${loop.phase} exceeded its ${loop.limits.deadlineMinutes}-minute deadline. Inspect the existing writer before retrying.`, 'human_required');
          } else {
            const send = options.send ?? sendStandingMessage;
            const transportOptions = { ...options, env: { ...(options.env ?? process.env), AO_NATS_AUTOSTART: '0' } };
            let mail = await (options.readMessage ?? readStandingMessage)({ ...transportOptions, id: loop.obligation.id });
            const message = mail?.status === 'delivered' ? mail : await send({ id: loop.obligation.id, consumer: loop.consumer, fromProject: loop.consumer, from: loop.leadId, to: loop.leadId,
              body: loop.obligation.prompt, stage: 'goal-phase', subject: `${loop.goalId}: ${loop.phase}`, assignment: false,
              context: { workflowId: loop.workflowId, runId: loop.loopId, taskId: loop.goalId, attempt: loop.attempt, phase: loop.phase },
              provenance: { loopId: loop.loopId, goalRevision: loop.goalRevision, scopeHash: loop.scopeHash } }, transportOptions);
            const delivery = { status: message.status, reason: message.reason ?? null };
            loop.obligation.delivery = delivery;
            if (message.status !== 'delivered') hold(loop, 'GOAL_LOOP_DELIVERY', `Phase obligation is durable but delivery is ${message.status}: ${message.reason ?? 'awaiting broker confirmation'}.`);
            else {
              loop.state = 'running'; loop.diagnostic = null;
              const notify = options.notify ?? (await import('./goal-loop-notify.mjs')).notifyGoalObligation;
              loop.obligation.notification = await notify({ ...transportOptions, loop });
              if (loop.obligation.notification.state !== 'sent') hold(loop, 'GOAL_LOOP_NOTIFICATION', `Obligation is published; lead notification is held: ${loop.obligation.notification.reason ?? 'safe delivery is unproven'}.`);
            }
            mail ??= await (options.readMessage ?? readStandingMessage)({ ...transportOptions, id: loop.obligation.id });
            // A durable correlated reply is recoverable after a reporting client crashes.
            if (mail?.reply?.agent === loop.leadId && mail.reply.body) {
              let input; try { input = JSON.parse(mail.reply.body); } catch { input = null; }
              if (input?.obligationId === loop.obligation.id && !loop.reports.some(r => r.input.idempotencyKey === input.idempotencyKey)) {
                validateReport(input, loop); check(input.actor.id === loop.leadId, 'Reply actor differs from mailbox recipient.');
                const evidence = await reportEvidence(loop, input, options);
                await taskDocs(loop, input.taskIds, options);
                const facts = input.status === 'succeeded' ? await verifyPhase(loop, input, options) : null;
                loop.reports.push({ input, fingerprint: hash(input), evidence, facts: facts ?? null, at: clock(options), applied: false });
                loop.taskIds = [...new Set([...loop.taskIds, ...input.taskIds])];
              }
            }
          }
        }
      }
    } catch (error) {
      hold(loop, error.code ?? 'GOAL_LOOP_RECONCILE', String(error.message).slice(0, 1000));
    }
    if (hash(loop) !== before) await persist(loop, options, { type: 'reconciled', phase: loop.phase, state: loop.state });
    return loop;
  });
}
export async function reconcileGoalLoops(options) {
  const loops = await listGoalLoops(options), results = [];
  for (const loop of loops.filter(l => !terminal.has(l.state))) {
    try { const next = await reconcileGoalLoop({ ...options, loopId: loop.loopId }); results.push({ loopId: loop.loopId, state: next.state, phase: next.phase, changed: next.revision !== loop.revision, diagnostic: next.diagnostic }); }
    catch (error) { results.push({ loopId: loop.loopId, state: 'blocked', diagnostic: { code: error.code ?? 'GOAL_LOOP_RECONCILE', message: String(error.message).slice(0, 1000) } }); }
  }
  return results;
}

export async function controlGoalLoop(options) {
  const request = options.request;
  return locked(options, async (loop, ctx) => {
    requestKey(request); actorId(request.actor);
    const env = options.env ?? process.env;
    check(options.authenticatedHuman === true || options.authenticatedHuman === undefined && !['AO_AGENT_ID', 'AO_RUN_ID', 'AO_LEAD_ID', 'TM_SESSION_ID', 'CLAUDECODE', 'CODEX_THREAD_ID', 'CODEX_CI', 'AGENT_ORCHESTRATION_CURRENT_WORKER_RUN_ID'].some(k => env[k]), 'Human control is unavailable from an agent-marked session. Use the authenticated operator surface.');
    const old = Object.hasOwn(loop.controls, request.idempotencyKey) ? loop.controls[request.idempotencyKey] : null;
    if (old) { check(old.fingerprint === hash(request), 'Control key was reused with another request.'); return loop; }
    check(request.expectedRevision === loop.revision && request.reason?.trim(), 'Control needs the current loop revision and a reason.');
    check(['pause', 'resume', 'stop', 'retry', 'approve'].includes(request.action), 'Unsupported goal loop control.');
    check(!terminal.has(loop.state), 'A terminal loop cannot be restarted; propose a new goal.');
    if (request.action === 'pause') loop.state = 'paused';
    if (request.action === 'stop') { loop.state = 'stopped'; loop.diagnostic = { code: 'GOAL_LOOP_STOPPED', message: 'Controller stopped. Existing task writers are preserved; use governed task controls to resolve them.' }; }
    if (request.action === 'resume') {
      check(loop.state === 'paused', 'Resume applies only to an explicitly paused loop.'); loop.state = 'running';
    }
    if (request.action === 'approve') {
      check(loop.pendingDecision && hash(request.decision) === hash(loop.pendingDecision), 'Human approval must match the exact pending typed decision.');
      if (loop.pendingDecision.options?.length) check(loop.pendingDecision.options.some(o => o.id === request.choice), 'Select one of the exact presented decision options.');
      loop.decisions.push({ ...clone(request.decision), ...(request.choice ? { choice: request.choice } : {}), actor: request.actor, reason: request.reason, at: clock(options) }); loop.pendingDecision = null;
      loop.state = 'running'; loop.diagnostic = null;
      for (const row of loop.reports.filter(r => !r.applied)) { row.applied = true; row.superseded = true; }
      loop.phaseRound = (loop.phaseRound ?? 0) + 1;
      newObligation(loop, options); // Fresh correlated continuation; approval is not completion.
    }
    if (request.action === 'retry') {
      const writers = await writersResolved(loop, options); check(writers.resolved, 'Retry refused: existing writer is active or unknown.', writers);
      check(loop.cycle - 1 < loop.limits.maxCycles && loop.stalls < loop.limits.maxStalls, 'Retry limits are exhausted; create a reviewed goal revision before a new loop.');
      const goal = await goalFor(loop, options);
      const changed = goal.revision !== loop.goalRevision || goal.scopeHash !== loop.scopeHash || hash(goal.authority) !== loop.authorityVersion;
      if (changed) {
        check(request.decision?.kind === 'goal-revision' && request.decision.goalRevision === goal.revision && request.decision.scopeHash === goal.scopeHash, 'Retry must explicitly approve the changed goal revision.');
        loop.goalRevision = goal.revision; loop.scopeHash = goal.scopeHash; loop.criteria = clone(goal.criteria); loop.authority = clone(goal.authority); loop.authorityVersion = hash(goal.authority);
      }
      if (request.deploymentRecipeId) {
        check(request.decision?.kind === 'recipe-change' || changed && request.decision?.kind === 'goal-revision' && request.decision.deploymentRecipeId === request.deploymentRecipeId, 'A recipe change requires a reviewed recipe-change decision at this attempt boundary.');
        loop.deploymentRecipe = await selectedRecipe(ctx, goal, request, options); loop.deploymentRecipeHash = hash(loop.deploymentRecipe);
        check(request.decision.deploymentRecipeHash === loop.deploymentRecipeHash, 'Recipe approval must name the exact configured recipe hash.');
      }
      check(loop.deploymentRecipe.target === loop.authority.testTarget, 'Updated authority requires an approved matching deployment recipe.');
      loop.decisions.push({ ...clone(request.decision ?? { kind: 'retry' }), actor: request.actor, reason: request.reason, at: clock(options), priorAttempt: loop.attempt, attempt: loop.attempt + 1 });
      resetAttempt(loop, options);
    }
    Object.defineProperty(loop.controls, request.idempotencyKey, { value: { fingerprint: hash(request), at: clock(options) }, enumerable: true, configurable: true, writable: true });
    await persist(loop, options, { type: `control.${request.action}`, actor: request.actor }); return loop;
  }).then(loop => reconcileGoalLoop({ ...options, loopId: loop.loopId }));
}
