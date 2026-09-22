import { read, update, logEvent, now } from "./store.mjs";
import { paths } from "./paths.mjs";
import { fullRevision, governanceGit, readManagementRecord } from "./governance-check.mjs";

export function governTask(id, { workflowRunId, leadId, recordPath, p = paths() } = {}) {
  if (process.env.TM_DISPATCH_WORKER) throw new Error("a dispatched worker cannot grant or change governed task ownership");
  const task = read(id, p);
  if (!task) throw new Error(`not found: ${id}`);
  if (![workflowRunId, leadId, recordPath].every((value) => typeof value === "string" && value.trim())) throw new Error("govern requires workflow, lead and producer record path");
  if (task.governance && (task.governance.workflowRunId !== workflowRunId || task.governance.leadId !== leadId || task.governance.recordPath !== recordPath)) throw new Error("governed ownership is already bound; reconcile it through the producer before a new attempt");
  const governance = { version: 1, runtime: "topology", workflowRunId, leadId, recordPath, state: "working", ...task.governance };
  const { record } = readManagementRecord({ ...task, governance }, p);
  if (record.workflow_run_id !== workflowRunId || (record.lead_id || record.owner) !== leadId || !record.started) throw new Error("workflow and lead must match the admitted producer record");
  const next = update(id, { governance }, p);
  logEvent("governed", { id, workflowRunId, leadId, recordPath }, p);
  return next;
}

export function readyForReview(id, { revision, p = paths() } = {}) {
  if (process.env.TM_DISPATCH_WORKER && process.env.TM_DISPATCH_TASK !== id) throw new Error("a dispatched worker may submit only its own task for review");
  const task = read(id, p);
  if (!task?.governance) throw new Error(`${id} is not a governed task`);
  if (!fullRevision(revision) || !task.worktree || governanceGit(task.worktree, "rev-parse", "HEAD") !== revision || governanceGit(task.worktree, "status", "--porcelain") !== "") {
    throw new Error("ready-for-review requires the current full commit SHA and a clean task worktree");
  }
  // This is the task-store projection called by management.workerReport. The producer
  // writes its finish protocol before this callback, then queues the exact-revision review.
  // Setting the board phase alone would leave that review permanently unrequested.
  const { record } = readManagementRecord(task, p), finish = record.finish;
  const strings = (value) => Array.isArray(value) && value.every((item) => typeof item === "string" && item.trim());
  if (!record.started || record.state !== "ready-for-review" || record.workflow_run_id !== task.governance.workflowRunId ||
    (record.lead_id || record.owner) !== task.governance.leadId || record.worktree !== task.worktree || record.branch !== task.branch ||
    finish?.revision !== revision || !strings(finish.artifacts) || !finish.artifacts.length || !strings(finish.checks) || !finish.checks.length ||
    !strings(finish.risks) || typeof finish.evidence !== "string" || !finish.evidence.trim()) {
    throw new Error(`${id}: submit the producer finish report with ao-topology manage report --task ${id} --consumer <repository> --file <finish-report.json>; review-ready only reflects an accepted exact-revision finish`);
  }
  const next = update(id, { governance: { ...task.governance, state: "ready-for-review", revision, submittedAt: now() } }, p);
  logEvent("ready-for-review", { id, workflowRunId: task.governance.workflowRunId, revision }, p);
  return next;
}
