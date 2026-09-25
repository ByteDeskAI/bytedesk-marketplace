/** Producer-owned review and integration records are the authority for governed completion. */
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, realpathSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { config } from "./store.mjs";

export const fullRevision = (value) => /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(String(value || ""));
// TM-221: mirrors agent-orchestration topology/lib/reviewer.mjs SEVERITIES (TM-215); a conformance test holds them equal.
export const REVIEW_SEVERITIES = ["blocker", "major", "minor", "nit", "note"];
const BLOCKING_SEVERITIES = new Set(["blocker", "major"]);
/** Approve may carry findings only when every one is a known, non-blocking severity. */
export const approvableFindings = (findings) => Array.isArray(findings) && findings.every((finding) =>
  finding && typeof finding === "object" && !Array.isArray(finding) && REVIEW_SEVERITIES.includes(finding.severity) && !BLOCKING_SEVERITIES.has(finding.severity));
const bindingKeys = ["serverKey", "serverPid", "sessionId", "sessionCreated", "paneId", "panePid"];
const real = (value) => { try { return realpathSync(value); } catch { return resolve(value); } };
export function governanceGit(root, ...args) {
  try { return execFileSync("git", ["-C", root, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: 5000 }).trim(); }
  catch { return null; }
}

/**
 * Repository identity as agent-orchestration's topology layer computes it (repoid.mjs
 * `canonicalRepoId` + `repoKey`, reviewer.mjs/management.mjs `stateRoot`) — re-derived here,
 * dependency-free, rather than imported, exactly like `governanceGit` re-derives the git call.
 * Both `management/<key>/` (task admission) and `reviewers/<key>.json` (standing reviewer)
 * hang off this one root and key; a conformance test should hold this equal to the topology
 * plugin's own derivation if either ever moves.
 */
function repoIdentity(p, env = process.env) {
  const common = governanceGit(p.root, "rev-parse", "--path-format=absolute", "--git-common-dir");
  if (!common) throw new Error("governed tasks require a Git repository");
  const repoId = real(common);
  const root = env.AGENT_ORCHESTRATION_STATE_HOME ? resolve(env.AGENT_ORCHESTRATION_STATE_HOME)
    : join(env.XDG_STATE_HOME || join(homedir(), ".local", "state"), "bytedesk", "agent-orchestration");
  const key = createHash("sha256").update(repoId).digest("hex").slice(0, 16);
  return { repoId, root, key };
}

export function managementIdentity(id, p, env = process.env) {
  if (!/^TM-[0-9]+$/.test(id)) throw new Error("governed task id is invalid");
  const { repoId, root, key } = repoIdentity(p, env);
  return { repoId, recordPath: join(root, "management", key, `${id}.json`) };
}

export function readManagementRecord(task, p) {
  const identity = managementIdentity(task.id, p);
  const configured = task.governance?.recordPath || identity.recordPath;
  if (resolve(configured) !== resolve(identity.recordPath) || real(configured) !== resolve(identity.recordPath)) throw new Error("management record must be the producer's canonical repository record, without aliases");
  const record = JSON.parse(readFileSync(configured, "utf8"));
  if (record.task !== task.id || record.repo_id !== identity.repoId) throw new Error("management record belongs to a different task or repository");
  return { ...identity, record };
}

export function governedAdmission(task, p) {
  try {
    if (!task.governance) throw new Error("persistent-lead admission is missing");
    const { record } = readManagementRecord(task, p), g = task.governance;
    if (!record.started || record.workflow_run_id !== g.workflowRunId || (record.lead_id || record.owner) !== g.leadId ||
      record.worktree !== task.worktree || record.branch !== task.branch || g.state !== "working") throw new Error("admitted ownership or working state does not match the task");
    return { allow: true, owner: record.owner };
  } catch (error) { return { allow: false, code: "TM_GOVERNED_ADMISSION_REQUIRED", reason: `${task.id}: ${error.message}; run ao-topology manage admit --task ${task.id} before dispatch` }; }
}

/**
 * Whether THIS repository has a standing ao-topology reviewer registered.
 *
 * Mirrors agent-orchestration topology/lib/reviewer.mjs `reviewerPaths` exactly (same
 * stateRoot, same sha256-16 repoKey over the git common dir) without importing that plugin —
 * governance-check.mjs already re-derives the sibling `management/<key>/` path the same way
 * (managementIdentity above); this is that same derivation for `reviewers/<key>.json`. A
 * conformance test (TM-221-style) should hold the two derivations equal if either ever moves.
 * No reviewer registered means there is nothing for governed admission to protect — the gate
 * below does not apply at all.
 */
export function reviewerRegistered(p) {
  try {
    const { root, key } = repoIdentity(p);
    return existsSync(join(root, "reviewers", `${key}.json`));
  } catch {
    return false;
  }
}

/**
 * ONE predicate for whether a dispatch of `task` must go through governed admission —
 * shared by `tm dispatch` (dispatch/index.mjs), the pool (dispatch/pool.mjs) and `tm doctor`,
 * so none of the three can disagree about the rule.
 *
 * Modes:
 *   "admitted"       task already carries a persistent-lead admission record — always gated.
 *   "required"       an admission record is required before dispatch. Either `dispatch.governed`
 *                     is explicitly `true` (an operator opted IN regardless of reviewer standing),
 *                     or it is unset and this repo has a standing ao-topology reviewer — the new
 *                     default (TM-240): an *unset* value used to skip the gate silently, which is
 *                     how TM-136 (design-system PR 121) and TM-235 (this repo's PR 125) finished
 *                     with no mechanical path to independent review.
 *   "opted-out"      a reviewer exists but `dispatch.governed` is explicitly `false` — dispatch
 *                     proceeds, but independent review will be unavailable for this task.
 *   "not-applicable" no reviewer is registered for this repo and no explicit opt-in — nothing to
 *                     protect, no gate.
 */
export function governanceMode(task, p) {
  if (task?.governance) return { mode: "admitted" };
  const explicit = config(p).dispatch?.governed;
  if (explicit === true) return { mode: "required" };
  if (!reviewerRegistered(p)) return { mode: "not-applicable" };
  return explicit === false ? { mode: "opted-out" } : { mode: "required" };
}

/** This gate is also called inside update(), after surface-specific acceptance gates. */
export function governedCompletion(task, p) {
  if (!task?.governance) return { allow: true };
  const refuse = (reason) => ({ allow: false, code: "TM_GOVERNED_COMPLETION_REQUIRED", reason: `${task.id}: ${reason}` });
  if (process.env.TM_DISPATCH_WORKER) return refuse("workers finish at ready-for-review; only reviewed and authorized integration can close this task");
  try {
    const { record } = readManagementRecord(task, p), g = task.governance;
    if (g.version !== 1 || g.runtime !== "topology" || !g.workflowRunId || !g.leadId ||
      record.workflow_run_id !== g.workflowRunId || (record.lead_id || record.owner) !== g.leadId) return refuse("governed workflow or lead ownership does not match the producer record");
    const revision = record.finish?.revision, review = record.review, merge = record.merge;
    if (!fullRevision(revision) || g.revision !== revision) return refuse("the completed revision has not been submitted for review");
    if (task.worktree && existsSync(task.worktree)) {
      if (real(task.worktree) !== real(record.worktree) || task.branch !== record.branch ||
        governanceGit(task.worktree, "symbolic-ref", "--short", "HEAD") !== task.branch || governanceGit(task.worktree, "rev-parse", "HEAD") !== revision ||
        governanceGit(task.worktree, "status", "--porcelain") !== "") return refuse("task worktree changed after review");
    }
    if (!review || review.task !== task.id || review.repo_id !== record.repo_id || review.revision !== revision || review.verified_commit !== revision ||
      review.verdict !== "approve" || !approvableFindings(review.findings) || !review.request_nonce ||
      !bindingKeys.every((key) => review.binding?.[key] !== undefined && review.binding[key] !== null && review.binding[key] !== "") ||
      !review.reviewer_id || review.reviewer_id === record.owner || review.reviewer_id === g.leadId || !Array.isArray(review.author_agent_ids) ||
      review.author_agent_ids.includes(review.reviewer_id)) return refuse("an independent review of this exact revision and reviewer incarnation is required");
    const auth = merge?.authorization;
    if (!merge || merge.revision !== revision || !fullRevision(merge.landed) || !merge.target_branch ||
      auth?.decision !== "integrate" || auth.authorized !== true || auth.revision !== revision || typeof auth.actor !== "string" || !auth.actor.trim()) return refuse("a separate, attributed integration decision and verified landing are required");
    if (!["merged", "cleaned"].includes(record.state) || record.collected !== true || governanceGit(p.root, "merge-base", "--is-ancestor", revision, merge.landed) === null ||
      governanceGit(p.root, "merge-base", "--is-ancestor", merge.landed, `refs/heads/${merge.target_branch}`) === null) return refuse("the reviewed revision is not verified on the integration branch");
    return { allow: true, revision, actor: auth.actor };
  } catch (error) { return refuse(`governed evidence is unavailable or invalid: ${error.message}`); }
}

export function assertGovernedMutation(task, patch, p) {
  if (task.governance && "governance" in patch) {
    const next = patch.governance;
    if (!next || ["version", "runtime", "workflowRunId", "leadId", "recordPath"].some((key) => next[key] !== task.governance[key])) {
      throw Object.assign(new Error(`${task.id}: governed ownership cannot be cleared or replaced by a task update`), { code: "TM_GOVERNED_OWNERSHIP" });
    }
  }
  if (patch.status === "done") {
    const gate = governedCompletion({ ...task, ...patch }, p);
    if (!gate.allow) throw Object.assign(new Error(gate.reason), { code: gate.code });
  }
}
