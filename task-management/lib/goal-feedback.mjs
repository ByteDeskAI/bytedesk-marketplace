/** Original-goal feedback, stored on the existing epic. No scheduler or foreign store imports. */
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, realpathSync, statSync, writeFileSync } from "node:fs";
import { extname, join, relative, resolve, sep } from "node:path";
import { actor, actorLabel } from "./actor.mjs";
import { paths } from "./paths.mjs";
import { kindOf, list, logEvent, now, read, state, update, withLock, writeState } from "./store.mjs";
import { withGoalWrite } from "./goal-guard.mjs";
import { PREVIEWABLE, PROVENANCE } from "./evidence.mjs";

const SHA = /^[0-9a-f]{40}(?:[0-9a-f]{24})?$/i;
const CATEGORIES = new Set(["product", "workflow", "environment", "knowledge"]);
const VERDICTS = new Set(["proven", "failed", "unproven"]);
const DEFAULT_LIMITS = Object.freeze({ maxStalls: 3, maxCycles: 10, phaseDeadlineMinutes: 30 });
const fail = message => { throw new Error(message); };
const hash = bytes => createHash("sha256").update(bytes).digest("hex");
function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])]));
  return value;
}
const digest = value => hash(JSON.stringify(canonical(value)) ?? "undefined");
const same = (a, b) => digest(a) === digest(b);
function text(value, name, max = 16000) {
  if (typeof value !== "string" || !value.trim() || value.length > max) fail(`${name} must be nonempty text (at most ${max} characters)`);
  return value.trim();
}
function strings(values, name, { empty = false } = {}) {
  if (!Array.isArray(values) || (!empty && !values.length) || values.length > 200) fail(`${name} must be an array${empty ? "" : " with at least one item"}`);
  const out = values.map(value => text(value, name, 4096));
  if (new Set(out).size !== out.length) fail(`${name} contains duplicates`);
  return out;
}
function instant(value, name) {
  text(value, name, 64);
  const ms = Date.parse(value);
  if (!Number.isFinite(ms) || ms > Date.now() + 5000) fail(`${name} must be a valid timestamp, not in the future`);
  return ms;
}
function mustEpic(id, p, admitted = true) {
  const epic = read(id, p);
  if (!epic || kindOf(id) !== "epic") fail(`goal scope must be an existing epic: ${id}`);
  if (admitted && epic.goal?.schemaVersion !== 1) fail(`${id} has no admitted goal`);
  return epic;
}
function scopeMatches(goal, input) {
  if (input.revision !== goal.revision || input.scopeHash !== goal.scopeHash) fail("assessment or request scope revision/hash is stale");
}
function target(goal, input) {
  if (!SHA.test(input.artifact || "")) fail("artifact must be the exact full deployed commit SHA");
  if (input.environment !== goal.authority.testTarget) fail("environment must match the approved test deployment target");
}
function criteriaFor(rows, previous = []) {
  if (!Array.isArray(rows) || !rows.length || rows.length > 200) fail("goal criteria must be a nonempty array");
  const known = new Map(previous.map(c => [c.id, c]));
  let next = Math.max(0, ...previous.map(c => Number(c.id.slice(3)))) + 1;
  const result = rows.map(row => {
    const content = text(typeof row === "string" ? row : row.text, "criterion text");
    const id = row?.id;
    if (id) {
      if (!known.has(id) || known.get(id).text !== content) fail("existing goal criterion identities and text cannot be replaced; add a new criterion");
      return { id, text: content };
    }
    return { id: `AC-${String(next++).padStart(3, "0")}`, text: content };
  });
  if (new Set(result.map(c => c.id)).size !== result.length) fail("duplicate criterion id");
  if (previous.some(c => !result.some(r => r.id === c.id))) fail("scope revision cannot silently remove original criteria");
  return result;
}
function receiptPath(name, p) {
  text(name, "evidence path", 4096);
  const full = resolve(p.root, name);
  if (!existsSync(full)) fail(`evidence file is missing: ${name}`);
  const real = realpathSync(full), root = realpathSync(p.root);
  if (real !== root && !real.startsWith(root + sep)) fail("evidence must stay inside this repository (including symlink targets)");
  const stat = statSync(real);
  if (!stat.isFile() || stat.size > 5_000_000) fail("evidence must be a regular file no larger than 5 MB");
  return real;
}
function jsonReceipt(name, kind, id, p) {
  let receipt;
  try { receipt = JSON.parse(readFileSync(receiptPath(name, p), "utf8")); } catch (error) { fail(`${kind} receipt: ${error.message}`); }
  if (receipt.schemaVersion !== 1 || receipt.kind !== kind || receipt.goalId !== id) fail(`${kind} receipt must identify schemaVersion 1 and this goal`);
  return receipt;
}
function capture(name, id, p) {
  const source = receiptPath(name, p), bytes = readFileSync(source), sha256 = hash(bytes);
  mkdirSync(p.evidence, { recursive: true });
  const extension = extname(source).toLowerCase();
  const dest = join(p.evidence, `${id}-goal-${sha256}${PREVIEWABLE.has(extension) ? extension : ".evidence"}`);
  if (existsSync(dest)) {
    if (hash(readFileSync(dest)) !== sha256) fail("stored goal evidence has changed");
  } else writeFileSync(dest, bytes, { flag: "wx" });
  return { source: relative(p.root, source), copy: relative(p.root, dest), sha256, bytes: bytes.length, capturedAt: now() };
}
function verifyEvidence(records, p) {
  for (const record of records) for (const key of ["source", "copy"]) {
    const path = receiptPath(record[key], p);
    if (hash(readFileSync(path)) !== record.sha256) fail(`goal evidence changed or is stale: ${record[key]}`);
  }
}
function captureAll(names, id, p) {
  return [...new Set(names)].map(name => capture(name, id, p));
}
function author() { const value = actor(); return { id: actorLabel(value), session: value.session, recordedAt: now() }; }
function result(id, goal) { return { ok: true, id, goal }; }
function save(id, goal, p, patch = {}) {
  const prior = read(id, p);
  const records = [...goal.assessments.flatMap(a => a.evidence), ...goal.findings.flatMap(f => f.evidence), ...goal.revisions.flatMap(r => r.approval ? [r.approval] : []), ...(goal.resumptions || []).map(r => r.approval)];
  const evidence = [...new Set([...(prior.evidence || []), ...records.map(record => record.copy)])];
  const provenance = { ...(prior[PROVENANCE] || {}) };
  for (const record of records) provenance[record.copy] = { source: resolve(p.root, record.source), sha256: record.sha256, bytes: record.bytes, at: record.capturedAt };
  withGoalWrite(id, () => update(id, { ...patch, goal, evidence, [PROVENANCE]: provenance }, p));
  return result(id, goal);
}
function writeGoal(id, operation, input, p, fn, admitted = true) {
  if (!input || typeof input !== "object" || Array.isArray(input)) fail("goal input must be an object");
  return withLock(p, () => {
    const epic = mustEpic(id, p, admitted);
    const requestHash = digest({ operation, input });
    const key = input.idempotencyKey == null ? null : text(input.idempotencyKey, "idempotencyKey", 200);
    const replay = key && epic.goal?.requests?.find(r => r.key === key);
    if (replay) {
      if (replay.hash !== requestHash) fail("idempotency key was already used for different input");
      if (operation === "complete") completionProof(id, epic.goal, input, p);
      return result(id, epic.goal);
    }
    const output = fn(epic);
    if (key) output.goal.requests = [...(output.goal.requests || []), { key, hash: requestHash, operation, at: now() }];
    const saved = save(id, output.goal, p, output.patch);
    if (operation === "complete" && state(p).activeEpic === id) writeState({ activeEpic: null }, p);
    logEvent(`goal_${operation}`, { id, revision: saved.goal.revision, scopeHash: saved.goal.scopeHash, status: saved.goal.status }, p);
    return saved;
  });
}
export function goalOpen(id, input, p = paths()) {
  return writeGoal(id, "open", input, p, epic => {
    if (epic.goal) fail(`${id} already has an admitted goal`);
    const objective = text(input.objective, "objective"), criteria = criteriaFor(input.criteria || epic.acceptance);
    const authority = input.authority;
    if (!authority || authority.reviewedMerge !== true || authority.publicRelease !== "human" || authority.destructive !== "human") fail("authority must allow reviewed merge and require human public-release/destructive decisions");
    const testTarget = text(authority.testTarget, "approved testTarget", 1024);
    const limits = { ...DEFAULT_LIMITS, ...input.limits };
    if (Object.keys(limits).some(key => !Object.hasOwn(DEFAULT_LIMITS, key))) fail("unknown goal limit; phase deadlines belong to the orchestration controller");
    for (const key of Object.keys(DEFAULT_LIMITS)) if (!Number.isInteger(limits[key]) || limits[key] < 1 || limits[key] > DEFAULT_LIMITS[key]) fail(`limits.${key} must be between 1 and ${DEFAULT_LIMITS[key]}`);
    const openedAt = now(), scopeHash = digest({ objective, criteria });
    const revision = { revision: 1, scopeHash, objective, criteria, at: openedAt, author: author() };
    const goal = { schemaVersion: 1, status: "active", openedAt, original: revision, revisions: [revision], revision: 1, scopeHash, objective, criteria, authority: { reviewedMerge: true, testTarget, publicRelease: "human", destructive: "human" }, limits, cycles: 0, repairCycles: 0, stalls: 0, bestProven: 0, findings: [], assessments: [], requests: [] };
    return { goal, patch: { status: "in_progress", closed: undefined, acceptance: criteria.map(c => ({ ...c, done: false })) } };
  }, false);
}
export function goalShow(id, p = paths()) {
  const goal = mustEpic(id, p).goal;
  let completionReady = false, completionReason = "No deployed assessment exists";
  const assessment = goal.assessments.at(-1);
  if (assessment) {
    try {
      completionProof(id, goal, { revision: goal.revision, scopeHash: goal.scopeHash, artifact: assessment.artifact, environment: assessment.environment }, p);
      completionReady = true; completionReason = null;
    } catch (error) { completionReason = error.message; }
  }
  return { ...result(id, goal), verification: { completionReady: completionReady && goal.status !== "human_required", completionReason: goal.status === "human_required" ? `human intervention required: ${goal.escalation?.reason || "goal paused"}` : completionReason } };
}
function active(goal) {
  if (goal.status !== "active") fail(`goal is ${goal.status}; a human must authorize a new cycle or scope before more work`);
}
function criterionIds(goal, values) {
  const ids = strings(values, "criterionIds");
  if (ids.some(id => !goal.criteria.some(c => c.id === id))) fail("finding references an unknown current criterion");
  return ids;
}
function linkedTasks(ids, id, p, done = false) {
  for (const taskId of ids) {
    const task = read(taskId, p);
    if (!task || kindOf(taskId) !== "task" || task.epic !== id) fail(`corrective/implementation task must belong to this goal epic: ${taskId}`);
    if (done && task.status !== "done") fail(`corrective/implementation task is not complete: ${taskId}`);
  }
}
export function goalFinding(id, input, p = paths()) {
  return writeGoal(id, "finding", input, p, epic => {
    const goal = structuredClone(epic.goal); active(goal);
    if (!CATEGORIES.has(input.category)) fail("finding category must be product, workflow, environment, or knowledge");
    target(goal, input);
    const correctiveTaskIds = strings(input.correctiveTaskIds || [], "correctiveTaskIds", { empty: true });
    linkedTasks(correctiveTaskIds, id, p);
    const finding = { id: `GF-${String(goal.findings.length + 1).padStart(3, "0")}`, revision: goal.revision, scopeHash: goal.scopeHash, category: input.category, criterionIds: criterionIds(goal, input.criterionIds), artifact: input.artifact, environment: input.environment, correctiveTaskIds, blocking: input.blocking !== false, status: "open", at: now(), author: author() };
    for (const key of ["observed", "expected", "reproduction", "source", "persona"]) finding[key] = text(input[key], key);
    finding.evidence = captureAll(strings(input.evidence || [], "evidence", { empty: true }), id, p);
    goal.findings.push(finding);
    goal.currentArtifact = finding.artifact;
    return { goal };
  });
}
function assessProof(id, goal, input, p) {
  scopeMatches(goal, input); target(goal, input);
  const persona = text(input.persona, "persona"), evaluator = input.evaluator;
  const implementerId = text(input.implementerId, "implementerId", 200);
  if (!evaluator || !evaluator.id || evaluator.id === implementerId || !["validation", "dogfood", "reviewer"].includes(evaluator.role) || !Array.isArray(evaluator.independentOf) || !evaluator.independentOf.includes(implementerId)) fail("dogfood evaluator must be independent of the implementer");
  text(evaluator.id, "evaluator identity", 200);
  strings(evaluator.independentOf, "independentOf");
  const receipt = jsonReceipt(input.source, "dogfood", id, p);
  const deployment = jsonReceipt(input.deployment, "deployment", id, p);
  for (const key of ["revision", "scopeHash", "artifact", "environment", "persona", "evaluator", "implementerId"]) if (!same(receipt[key], input[key])) fail(`dogfood receipt ${key} does not match assessment`);
  if (deployment.artifact !== input.artifact || deployment.environment !== input.environment) fail("deployment receipt artifact/environment does not match current assessment");
  text(deployment.actor, "deployment actor"); text(deployment.source, "deployment source");
  const deployedAt = instant(deployment.deployedAt, "deployedAt"), recordedAt = instant(receipt.recordedAt, "recordedAt");
  const previous = goal.assessments.at(-1);
  if (previous && (deployedAt < Date.parse(previous.deployedAt) || recordedAt < Date.parse(previous.recordedAt))) fail("assessment/deployment receipt is older than the latest observed artifact");
  const latestFinding = goal.findings.at(-1);
  if (latestFinding && (!previous || Date.parse(latestFinding.at) >= Date.parse(previous.at)) && latestFinding.artifact !== input.artifact) fail("assessment artifact differs from the latest dogfood finding");
  if (deployedAt < Date.parse(goal.openedAt) - 5000 || recordedAt < deployedAt || recordedAt < Date.parse(goal.revisions.at(-1).at)) fail("dogfood proof is stale or predates this scope/deployment");
  if (!Array.isArray(input.criteria) || input.criteria.length !== goal.criteria.length) fail("assessment must cover every current criterion");
  if (!Array.isArray(receipt.criteria) || receipt.criteria.length !== input.criteria.length) fail("dogfood receipt must cover every assessed criterion");
  const seen = new Set(), names = [input.source, input.deployment];
  const criteria = input.criteria.map(c => {
    if (!goal.criteria.some(row => row.id === c.id) || seen.has(c.id) || !VERDICTS.has(c.verdict)) fail("assessment has an unknown/duplicate criterion or invalid verdict");
    seen.add(c.id);
    const observed = receipt.criteria.find(row => row.id === c.id);
    if (!observed || observed.verdict !== c.verdict || !same(observed.evidence, c.evidence)) fail("criterion proof does not match independent dogfood receipt");
    const evidence = strings(c.evidence, "criterion evidence", { empty: c.verdict !== "proven" });
    text(observed.observed, "observed outcome"); text(observed.expected, "expected outcome");
    names.push(...evidence);
    return { id: c.id, verdict: c.verdict, observed: observed.observed, expected: observed.expected, evidence };
  });
  const implementationTaskIds = strings(input.implementationTaskIds || [], "implementationTaskIds", { empty: true });
  linkedTasks(implementationTaskIds, id, p, true);
  const evidence = captureAll(names, id, p);
  // Bind validation to exactly the bytes captured, even if a producer replaces a receipt mid-call.
  const captured = name => evidence.find(record => record.source === relative(p.root, receiptPath(name, p)));
  if (!same(JSON.parse(readFileSync(resolve(p.root, captured(input.source).copy), "utf8")), receipt) || !same(JSON.parse(readFileSync(resolve(p.root, captured(input.deployment).copy), "utf8")), deployment)) fail("receipt changed while assessment evidence was being captured");
  return { artifact: input.artifact, environment: input.environment, persona, evaluator, implementerId, recordedAt: receipt.recordedAt, deployedAt: deployment.deployedAt, criteria, implementationTaskIds, evidence };
}
export function goalAssess(id, input, p = paths()) {
  return writeGoal(id, "assess", input, p, epic => {
    const goal = structuredClone(epic.goal); active(goal);
    if (goal.cycles >= goal.limits.maxCycles + 1) fail("goal repair-cycle limit reached; complete the proven goal or request human intervention");
    const proof = assessProof(id, goal, input, p);
    const assessmentId = `GA-${String(goal.assessments.length + 1).padStart(3, "0")}`;
    const resolves = strings(input.resolvesFindingIds || [], "resolvesFindingIds", { empty: true });
    for (const findingId of resolves) {
      const finding = goal.findings.find(f => f.id === findingId);
      if (!finding || finding.status !== "open") fail(`finding is not open: ${findingId}`);
      if (Date.parse(proof.recordedAt) < Date.parse(finding.at)) fail("finding resolution requires fresh dogfood evidence");
      if (finding.criterionIds.some(id => !proof.criteria.some(c => c.id === id && c.verdict === "proven"))) fail("finding resolution requires proven affected criteria");
      linkedTasks(finding.correctiveTaskIds, id, p, true);
      finding.status = "resolved"; finding.resolvedBy = assessmentId; finding.resolvedAt = now();
    }
    const provenCount = proof.criteria.filter(c => c.verdict === "proven").length;
    const bestProven = goal.bestProven ?? Math.max(0, ...goal.assessments.map(a => a.criteria.filter(c => c.verdict === "proven").length));
    const progress = provenCount > bestProven || resolves.length > 0;
    goal.bestProven = Math.max(bestProven, provenCount);
    goal.cycles += 1; goal.repairCycles = Math.max(0, goal.cycles - 1); goal.stalls = progress ? 0 : goal.stalls + 1;
    const assessment = { id: assessmentId, revision: goal.revision, scopeHash: goal.scopeHash, at: now(), author: author(), ...proof, resolvesFindingIds: resolves };
    goal.assessments.push(assessment); goal.latestAssessmentId = assessmentId; goal.currentArtifact = proof.artifact;
    const proven = proof.criteria.every(c => c.verdict === "proven") && !goal.findings.some(f => f.blocking && f.status === "open");
    if (!proven && (goal.stalls >= goal.limits.maxStalls || goal.repairCycles >= goal.limits.maxCycles)) {
      goal.status = "human_required";
      goal.escalation = { reason: goal.stalls >= goal.limits.maxStalls ? "no_progress" : "cycle_limit", at: now(), assessmentId, cycles: goal.cycles, repairCycles: goal.repairCycles, stalls: goal.stalls };
    }
    return { goal };
  });
}
export function goalRevise(id, input, p = paths()) {
  return writeGoal(id, "revise", input, p, epic => {
    const goal = structuredClone(epic.goal); scopeMatches(goal, input);
    const reason = text(input.reason, "scope-change reason"), objective = input.objective || goal.objective;
    const approval = jsonReceipt(input.approval, "scope-change", id, p);
    for (const [key, value] of Object.entries({ revision: goal.revision, scopeHash: goal.scopeHash, reason, objective, criteria: input.criteria })) if (!same(approval[key], value)) fail(`scope-change approval ${key} does not match requested revision`);
    if (!/^human:.+/.test(approval.authorizedBy || "")) fail("scope-change approval must identify the human decision owner");
    instant(approval.recordedAt, "scope-change recordedAt");
    const criteria = criteriaFor(input.criteria, goal.criteria), scopeHash = digest({ objective, criteria });
    if (scopeHash === goal.scopeHash) fail("scope revision must change the scope; budgets cannot be reset by replaying it");
    const capturedApproval = capture(input.approval, id, p);
    if (!same(JSON.parse(readFileSync(resolve(p.root, capturedApproval.copy), "utf8")), approval)) fail("scope-change receipt changed while being captured");
    const revision = { revision: goal.revision + 1, scopeHash, objective, criteria, reason, at: now(), author: author(), approval: capturedApproval };
    goal.revisions.push(revision); goal.revision = revision.revision; goal.scopeHash = scopeHash; goal.objective = objective; goal.criteria = criteria;
    // A scope change invalidates proof. It does not grant extra time or reset exhausted budgets.
    if (goal.status === "proven") goal.status = "active";
    delete goal.completion; delete goal.latestAssessmentId;
    return { goal, patch: { status: "in_progress", closed: undefined, acceptance: criteria.map(c => ({ ...c, done: false })) } };
  });
}
function completionProof(id, goal, input, p) {
  scopeMatches(goal, input); target(goal, input);
  const assessment = goal.assessments.at(-1);
  if (!assessment || assessment.revision !== goal.revision || assessment.scopeHash !== goal.scopeHash) fail("current scope has no independent deployed assessment proof");
  if (input.assessmentId && input.assessmentId !== assessment.id) fail("assessment is stale; completion must use the latest assessment");
  if (assessment.artifact !== input.artifact || assessment.environment !== input.environment) fail("assessment artifact/environment is stale");
  if (goal.currentArtifact && goal.currentArtifact !== assessment.artifact) fail("assessment artifact is older than the latest observed deployment");
  if (!goal.criteria.every(c => assessment.criteria.some(row => row.id === c.id && row.verdict === "proven"))) fail("original/current goal criteria are not all proven");
  if (goal.findings.some(f => f.blocking && f.status !== "resolved")) fail("blocking goal findings remain unresolved");
  const unfinished = list("task", { epic: id, includeDeleted: true }, p).filter(task => task.status !== "done");
  if (unfinished.length) fail(`in-scope child tasks are not complete: ${unfinished.map(task => task.id).join(", ")}`);
  linkedTasks(assessment.implementationTaskIds, id, p, true);
  for (const finding of goal.findings.filter(f => f.blocking)) linkedTasks(finding.correctiveTaskIds, id, p, true);
  verifyEvidence(assessment.evidence, p);
  for (const revision of goal.revisions.slice(1)) verifyEvidence([revision.approval], p);
  for (const resumption of goal.resumptions || []) verifyEvidence([resumption.approval], p);
  return assessment;
}
export function goalComplete(id, input, p = paths()) {
  return writeGoal(id, "complete", input, p, epic => {
    const goal = structuredClone(epic.goal);
    const assessment = completionProof(id, goal, input, p);
    if (goal.status !== "proven") {
      active(goal);
    }
    goal.status = "proven";
    goal.completion = { at: now(), revision: goal.revision, scopeHash: goal.scopeHash, assessmentId: assessment.id, artifact: assessment.artifact, environment: assessment.environment, author: author() };
    return { goal, patch: { status: "done", closed: now(), acceptance: goal.criteria.map(c => ({ ...c, done: true, at: now() })) } };
  });
}
/** TM-486 (TM-483): the one supported way out of human_required. The human's decision is a resume
 * receipt bound to THIS escalation (goal, revision, scopeHash, escalation time), its reason and any
 * extra repair cycles it grants, signed `authorizedBy: human:<owner>` exactly as a scope change is.
 * It resets the no-progress counter; it grants cycles only as many as the receipt names, and an
 * exhausted cycle budget cannot be resumed without at least one. The receipt is captured as evidence
 * and the escalation kept in `resumptions`, so history is not rewritten. */
export function goalResume(id, input, p = paths()) {
  return writeGoal(id, "resume", input, p, epic => {
    const goal = structuredClone(epic.goal); scopeMatches(goal, input);
    if (goal.status !== "human_required" || !goal.escalation) fail(`goal is ${goal.status}; only a human_required goal can be resumed`);
    const reason = text(input.reason, "resume reason"), grantCycles = input.grantCycles ?? 0;
    if (!Number.isInteger(grantCycles) || grantCycles < 0 || grantCycles > DEFAULT_LIMITS.maxCycles) fail(`grantCycles must be an integer between 0 and ${DEFAULT_LIMITS.maxCycles}`);
    if (grantCycles < 1 && (goal.repairCycles >= goal.limits.maxCycles || goal.cycles >= goal.limits.maxCycles + 1)) fail("the repair-cycle budget is exhausted; a resume must grant at least one cycle");
    const approval = jsonReceipt(input.approval, "resume", id, p);
    for (const [key, value] of Object.entries({ revision: goal.revision, scopeHash: goal.scopeHash, escalationAt: goal.escalation.at, reason, grantCycles })) if (!same(approval[key], value)) fail(`resume approval ${key} does not match this escalation`);
    if (!/^human:.+/.test(approval.authorizedBy || "")) fail("resume approval must identify the human decision owner");
    if (instant(approval.recordedAt, "resume recordedAt") < Date.parse(goal.escalation.at)) fail("resume approval predates the escalation it resolves");
    const capturedApproval = capture(input.approval, id, p);
    if (!same(JSON.parse(readFileSync(resolve(p.root, capturedApproval.copy), "utf8")), approval)) fail("resume receipt changed while being captured");
    goal.resumptions = [...(goal.resumptions || []), { escalation: goal.escalation, reason, grantCycles, authorizedBy: approval.authorizedBy, at: now(), author: author(), approval: capturedApproval }];
    goal.limits = { ...goal.limits, maxCycles: goal.limits.maxCycles + grantCycles };
    goal.stalls = 0; goal.status = "active"; delete goal.escalation;
    return { goal };
  });
}
export const GOAL_OPERATIONS = Object.freeze({ open: goalOpen, show: goalShow, finding: goalFinding, assess: goalAssess, revise: goalRevise, complete: goalComplete, resume: goalResume });
