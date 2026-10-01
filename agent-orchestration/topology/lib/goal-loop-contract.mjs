import { createHash } from 'node:crypto';
import { invariant, shellQuote } from './util.mjs';

export const GOAL_LOOP_PHASES = ['pm', 'build', 'qa', 'review', 'integration', 'integration-qa', 'test-deploy', 'dogfood', 'assessment'];
export const GOAL_LOOP_RECIPE_VERSION = 'goal-feedback/v1';
export const GOAL_LOOP_DEFAULT_LIMITS = { maxStalls: 3, maxCycles: 10, deadlineMinutes: 30 };
const canonical = value => Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object' ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value;
export const goalLoopDigest = value => createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
export const isRevision = value => typeof value === 'string' && /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(value);
export function requireGoalLoop(condition, message, details = {}) {
  invariant(condition, 'TOPOLOGY_GOAL_LOOP_CONTRACT', message, details);
}
export function actorId(actor) {
  requireGoalLoop(typeof actor?.id === 'string' && actor.id.trim() && actor.id.length <= 200, 'An attributed actor is required.');
  return actor.id;
}
export function requestKey(input) {
  requireGoalLoop(typeof input?.idempotencyKey === 'string' && input.idempotencyKey.length > 0 && input.idempotencyKey.length <= 200, 'A bounded idempotencyKey is required.');
  return input.idempotencyKey;
}
export function scopedDecision(report, loop) {
  const d = report.details?.decision ?? {}, bounded = (value, limit) => typeof value === 'string' && value.trim() && value.length <= limit;
  const kind = d.kind ?? 'phase-decision', summary = d.summary ?? report.details?.reason;
  requireGoalLoop(/^[a-z][a-z0-9-]{0,79}$/.test(kind) && bounded(summary, 500), 'Human decision requires a bounded kind and concrete summary.');
  const scope = d.scope ? { action: d.scope.action, target: d.scope.target } : null;
  if (scope || ['public-release', 'destructive'].includes(kind)) requireGoalLoop(scope && bounded(scope.action, 200) && bounded(scope.target, 1000), 'Human decision must name its exact requested action and target.');
  if (['public-release', 'destructive'].includes(kind)) requireGoalLoop(isRevision(loop.artifact), 'Public or destructive approval requires the exact artifact.');
  const options = (d.options ?? []).map(o => ({ id: o.id, label: o.label, consequence: o.consequence }));
  requireGoalLoop(options.length <= 5 && options.every(o => /^[a-z][a-z0-9-]{0,79}$/.test(o.id) && bounded(o.label, 100) && bounded(o.consequence, 500)) && new Set(options.map(o => o.id)).size === options.length, 'Decision options need unique identifiers, labels and consequences.');
  requireGoalLoop(!d.recommendation || bounded(d.recommendation, 200), 'Decision recommendation is too long.');
  requireGoalLoop(!d.nextAction || bounded(d.nextAction, 500), 'Decision next action is too long.');
  return { kind, summary, ...(scope ? { scope } : {}), ...(options.length ? { options } : {}), ...(d.recommendation ? { recommendation: d.recommendation } : {}), ...(d.nextAction ? { nextAction: d.nextAction } : {}) };
}
export function validateGoal(goal) {
  requireGoalLoop(goal?.schemaVersion === 1 && Number.isSafeInteger(goal.revision) && goal.revision > 0 && typeof goal.scopeHash === 'string', 'Task Management did not return a versioned goal contract.');
  requireGoalLoop(Array.isArray(goal.criteria) && goal.criteria.length > 0 && goal.criteria.every(c => c.id && c.text), 'The goal requires explicit acceptance criteria.');
  requireGoalLoop(goal.authority?.publicRelease === 'human' && goal.authority?.destructive === 'human', 'Public release and destructive actions must remain human gates.');
  return goal;
}
export function validateRecipe(recipe, goal) {
  requireGoalLoop(recipe && typeof recipe.id === 'string' && typeof recipe.version === 'string', 'Choose a versioned deployment recipe from the repository allowlist.');
  requireGoalLoop(recipe.target === goal.authority.testTarget && typeof recipe.target === 'string' && recipe.target.trim(), 'Deployment recipe must target the goal’s approved test environment.');
  requireGoalLoop(typeof recipe.command === 'string' && recipe.command.length > 0 && !/[\r\n\0]/.test(recipe.command) && Array.isArray(recipe.args) && recipe.args.every(a => typeof a === 'string' && !a.includes('\0')), 'Deployment recipe requires executable plus argv, never shell source.');
  requireGoalLoop(!['sh', 'bash', 'zsh', 'cmd', 'powershell', 'pwsh'].includes(recipe.command.split(/[\\/]/).at(-1)), 'A shell interpreter is not an allowed deployment recipe.');
  return JSON.parse(JSON.stringify(recipe));
}
export function validateReport(report, loop) {
  requestKey(report); actorId(report.actor);
  requireGoalLoop(report.obligationId === loop.obligation?.id && report.attempt === loop.attempt && report.phase === loop.phase,
    'Report belongs to another phase or attempt.');
  requireGoalLoop(report.goalRevision === loop.goalRevision && report.scopeHash === loop.scopeHash, 'Report belongs to another goal revision.');
  requireGoalLoop(['succeeded', 'failed', 'progress', 'human_required'].includes(report.status), 'Unsupported phase report status.');
  requireGoalLoop(Array.isArray(report.taskIds) && report.taskIds.every(id => /^TM-\d+$/.test(id)), 'Report requires taskIds (empty when no task exists).');
  requireGoalLoop(Array.isArray(report.evidence) && report.evidence.every(p => typeof p === 'string' && p.trim()), 'Report requires evidence paths.');
  if (report.knowledgeRefs !== undefined) requireGoalLoop(Array.isArray(report.knowledgeRefs) && report.knowledgeRefs.every(k => k && typeof k.conceptId === 'string' && k.conceptId.trim() && k.goalId === loop.goalId && (!k.findingId || /^GF-\d+$/.test(k.findingId)) && (!k.artifact || isRevision(k.artifact)) && Array.isArray(k.evidence) && k.evidence.every(p => typeof p === 'string' && p.trim())), 'Knowledge references must retain concept, source goal/finding and evidence provenance.');
  if (report.artifact != null) requireGoalLoop(isRevision(report.artifact), 'Artifact must be a full commit SHA.');
  if (report.status === 'human_required') scopedDecision(report, loop);
  if (report.status !== 'succeeded') return;
  requireGoalLoop(report.evidence.length > 0, 'A successful phase needs durable evidence.');
  requireGoalLoop(report.taskIds.length > 0 && loop.taskIds.every(id => report.taskIds.includes(id)), 'Successful phases must retain every governed task already bound to this attempt.');
  const d = report.details ?? {};
  if (report.phase === 'pm') requireGoalLoop(report.taskIds.length > 0 && d.plan && Array.isArray(d.criterionIds) && loop.criteria.every(c => d.criterionIds.includes(c.id)), 'PM must bind a plan and governed tasks to every criterion.');
  if (report.phase === 'build') requireGoalLoop(isRevision(report.artifact) && d.implementerId && report.taskIds.length > 0, 'Build must identify the exact artifact, implementer and task custody.');
  if (['build', 'integration'].includes(report.phase)) requireGoalLoop(d.taskArtifacts && report.taskIds.every(id => isRevision(d.taskArtifacts[id]?.sourceRevision) && (report.phase !== 'integration' || isRevision(d.taskArtifacts[id]?.landedRevision))), 'Bind every implementation task to its source revision and, for integration, its landed revision.');
  if (['qa', 'review', 'integration', 'integration-qa', 'test-deploy', 'dogfood', 'assessment'].includes(report.phase)) {
    requireGoalLoop(report.artifact === loop.artifact, 'Phase evidence must name the exact current artifact.');
  }
  if (['qa', 'review', 'integration-qa', 'dogfood'].includes(report.phase)) requireGoalLoop(d.evaluator?.id && d.evaluator.id !== loop.implementerId && d.evaluator.independentOf?.includes(loop.implementerId), 'Evaluation requires an attributed evaluator independent of the implementer.');
  if (['qa', 'integration-qa', 'dogfood'].includes(report.phase)) requireGoalLoop(/^TM-\d+$/.test(d.evaluation?.taskId ?? '') && d.evaluation?.runId && d.evaluation?.evidence, 'Evaluation needs its observed governed task, worker run and finish evidence path.');
  if (report.phase === 'review') requireGoalLoop(d.verdict === 'satisfied', 'Integration requires a satisfied independent review.');
  if (report.phase === 'integration') requireGoalLoop(d.landingReceipt && isRevision(d.landedArtifact), 'Integration requires a governed landing receipt and exact landed revision.');
  if (report.phase === 'test-deploy') requireGoalLoop(d.deployment && d.recipeHash === loop.deploymentRecipeHash && d.environment === loop.authority.testTarget, 'Deployment must use the retained allowlisted recipe and approved test target.');
  if (report.phase === 'dogfood') requireGoalLoop(d.source && d.environment === loop.authority.testTarget && d.persona, 'Dogfood requires an observed test-environment receipt and intended persona.');
  if (report.phase === 'assessment') requireGoalLoop(d.assessment && typeof d.assessment === 'object', 'Assessment requires the public Task Management assessment payload.');
}

const phaseWork = {
  pm: 'Act as product manager. Read the original goal and current evidence. Produce one bounded plan covering every acceptance criterion and both product and workflow improvements. Create/reuse implementation tasks through public tm commands. Admit tasks with ao-topology manage admit. Record their IDs in a progress report BEFORE any dispatch. Do not expand the accepted goal.',
  build: 'Use the existing governed task path: ao-topology manage admit/start (or tm dispatch only after admission). Delegate implementation to a worker, preserve its isolated worktree, collect the exact revision through ao-topology manage report. Record every task/writer binding before starting it. Report the exact full commit SHA and implementer identity; compilation alone is not completion.',
  qa: 'Assign QA independent of the implementer. Run relevant checks and exercise the intended user path on the exact artifact. Save observations, environment, persona, expected/actual behavior and criterion evidence. Report evaluator identity and independentOf; failures return to the PM as actionable findings.',
  review: 'Request the existing repository independent reviewer for every governed implementation task and exact artifact. Use ao-topology reviewer request/collect and retain the satisfied review evidence. Do not substitute the implementer’s own report or a green test suite for review.',
  integration: 'Use ao-topology manage integrate for the reviewed tasks. It must check existing writer identity, exact review revision, PR/CI and current integration authority. Do not merge directly or bypass governance. Save the verified landing receipt, reviewed artifact and full landed commit SHA. A refusal is a blocked/human-required report, not success.',
  'test-deploy': 'Deploy only the retained allowlisted recipe below into the explicitly approved test target. Invoke its executable with argv, never evaluate report text as shell code. Save a deployment JSON receipt containing schemaVersion:1, kind:deployment, goalId, artifact, environment, deployedAt, actor and source. Public release and destructive actions require a separate exact human decision and are outside this recipe.',
  dogfood: 'Have an evaluator independent of the implementer use the deployed artifact as the intended user. Observe each acceptance criterion in the approved environment. Save a dogfood JSON receipt with schemaVersion:1,kind:dogfood,goalId,revision,scopeHash,artifact,environment,persona,evaluator,implementerId,recordedAt and criteria[{id,verdict,observed,expected,evidence}]. Record failures as findings linked to corrective tasks. Tests or a terminal close are not user acceptance.',
  assessment: 'Act as product manager. Compare dogfood evidence with the ORIGINAL accepted goal. Submit details.assessment using the public tm goal assess schema, preserving exact artifact, target, persona, independent evaluator and receipts. Include findings for unmet criteria and corrective task IDs. Mark every criterion proven only when observed evidence establishes it. The controller invokes tm goal assess/complete; successful delivery is not completion. Once proven, propose (do not start) a separate next cycle.',
};

export function phasePrompt(loop) {
  const report = { idempotencyKey: '<unique-report-key>', obligationId: loop.obligation.id, attempt: loop.attempt, phase: loop.phase,
    goalRevision: loop.goalRevision, scopeHash: loop.scopeHash, actor: { id: loop.leadId }, status: 'progress', artifact: loop.artifact,
    taskIds: loop.taskIds, evidence: [], details: {} };
  return [
    `Goal feedback loop ${loop.loopId}; phase ${loop.phase}; attempt ${loop.attempt}; cycle ${loop.cycle}.`,
    `You are the standing lead coordinating this phase, not a replacement task executor.`,
    `Goal: ${loop.goalId} revision ${loop.goalRevision}, scope ${loop.scopeHash}.`,
    `Original objective: ${loop.original.objective}`,
    `Current criteria: ${JSON.stringify(loop.criteria)}`,
    `Recipe ${loop.recipeVersion}; authority ${loop.authorityVersion}: ${JSON.stringify(loop.authority)}`,
    `Exact operator decisions: ${JSON.stringify(loop.decisions.filter(d => d.attempt === loop.attempt))}. Decisions authorize only their stated scope; none proves a phase succeeded.`,
    `Deadline ${loop.obligation.deadlineAt}. Deadline expiry does not prove a worker exited.`,
    loop.phase === 'integration-qa' ? 'Independently validate the exact aggregate landed artifact before deployment. Use a governed read-only evaluator task, retain the worker run and its finish evidence. This second QA check is required because integration may change the commit being shipped.' : phaseWork[loop.phase],
    `Public goal inspection: tm goal show ${loop.goalId} --json`,
    `Retained tasks: ${JSON.stringify(loop.taskIds)}; current artifact: ${loop.artifact ?? 'not built'}.`,
    `Prior phase reports: ${loop.recordPath} (read the current record; never edit controller state).`,
    `Approved deployment recipe: ${JSON.stringify(loop.deploymentRecipe)}; hash ${loop.deploymentRecipeHash}.`,
    'Report through the controller before marking the mailbox obligation handled. Accepted/handled mail is not phase success. Never dispatch another writer while a prior writer is alive or unknown. Report progress with task IDs before dispatch; report failed or human_required with a concrete reason instead of silently waiting.',
    `Evidence paths are relative to the repository's main checkout (the public TM store root): ${loop.evidenceRoot}.`,
    `Write the report JSON to a file; submit: ao-topology goal-loop report --consumer ${shellQuote(loop.consumer)} --loop ${loop.loopId} --file <report.json> --json`,
    `Report template: ${JSON.stringify(report)}`,
    'Required success details: pm={plan,criterionIds}; build={implementerId,taskArtifacts:{TM-id:{sourceRevision}}}; integration={landingReceipt,landedArtifact,taskArtifacts:{TM-id:{sourceRevision,landedRevision}}}; review={evaluator,verdict}; qa/integration-qa/dogfood={evaluator:{id,role,independentOf:[all builder identities]},evaluation:{taskId,runId,evidence}}; test-deploy={deployment,recipeHash,environment}; dogfood also needs {source,environment,persona}; assessment={assessment,findings?:[],nextCycleProposal?}. Keep implementation taskIds separate from evaluation task IDs, all in this epic. Close evaluation tasks through existing governed protocols before goal completion. Every success includes durable evidence paths; do not invent receipts.',
    'In PM and assessment, query existing knowledge with km find. Reuse a concept by source goal/finding identity, or create a sourced machine draft with km concept new "..." --type ... --dir ... --desc ... --resource <evidence URI> --json, then km link task <TM-id> <concept-id> --json (or km_write_concept MCP). Retain optional knowledgeRefs [{conceptId,goalId,findingId?,artifact?,evidence:[paths]}] in the report. Never apply km verify or a human stamp. If knowledge is unavailable, record a typed workflow finding; do not claim the knowledge work succeeded.',
  ].join('\n\n');
}
