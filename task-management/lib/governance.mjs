import { read, update, logEvent, now } from "./store.mjs";
import { paths } from "./paths.mjs";
import { finishChecksRefusal, fullRevision, governanceGit, readManagementRecord } from "./governance-check.mjs";
import { isWorkerCaller, workerTasks } from "./worker-identity.mjs";

export function governTask(id, { workflowRunId, leadId, recordPath, p = paths() } = {}) {
  const task = read(id, p);
  if (isWorkerCaller({ task }).worker) throw new Error("a dispatched worker cannot grant or change governed task ownership");
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
  const task = read(id, p);
  const who = isWorkerCaller({ task });
  const pins = workerTasks(who);
  if (who.worker && (!pins.length || pins.some((pinned) => pinned !== id))) throw new Error("a dispatched worker may submit only its own task for review");
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
    finish?.revision !== revision) {
    throw new Error(`${id}: submit the producer finish report with ao-topology manage report --task ${id} --consumer <repository> --file <finish-report.json>; review-ready only reflects an accepted exact-revision finish`);
  }
  // TM-492: name the refused field. checks go through the shared reader, which accepts structured runs (TM-418).
  const refused = !strings(finish.artifacts) || !finish.artifacts.length ? "finish.artifacts must be a non-empty array of strings"
    : finishChecksRefusal(finish.checks, finish.revision)
    ?? (!strings(finish.risks) ? "finish.risks must be an array of strings"
    : typeof finish.evidence !== "string" || !finish.evidence.trim() ? "finish.evidence must be a non-empty string" : null);
  if (refused) throw new Error(`${id}: the producer finish report is malformed: ${refused}; correct it and resubmit with ao-topology manage report --task ${id} --consumer <repository> --file <finish-report.json>`);
  const next = update(id, { governance: { ...task.governance, state: "ready-for-review", revision, submittedAt: now() } }, p);
  logEvent("ready-for-review", { id, workflowRunId: task.governance.workflowRunId, revision }, p);
  return next;
}

/**
 * TM-347: the store projection of the producer rework. After an independent review requests
 * changes on the submitted revision, `ao-topology manage rework` records the rework against that
 * revision, returns its record to working and calls this. The governed task returns to working, the
 * reworked revision and the finished dispatch are kept in `governance.reworks`, and the dispatch is
 * cleared so the lead can dispatch the next worker. Idempotent for a retry of the same revision.
 */
export function reworkGovernance(id, { revision, p = paths() } = {}) {
  if (isWorkerCaller().worker) throw new Error("a dispatched worker cannot return its task to work; the lead runs ao-topology manage rework");
  const task = read(id, p);
  if (!task?.governance) throw new Error(`${id} is not a governed task`);
  const g = task.governance, { record } = readManagementRecord(task, p);
  const last = (record.events || []).filter((event) => event.event === "rework").at(-1);
  if (!fullRevision(revision) || !record.started || record.state !== "working" || record.finish ||
    record.workflow_run_id !== g.workflowRunId || (record.lead_id || record.owner) !== g.leadId || last?.revision !== revision ||
    record.worktree !== task.worktree || record.branch !== task.branch) {
    throw new Error(`${id}: run ao-topology manage rework --task ${id}; tm rework only reflects a rework the producer recorded for the reviewed revision`);
  }
  if (g.state === "working" && g.reworks?.at(-1)?.revision === revision) return task;
  if (g.state !== "ready-for-review" || g.revision !== revision) throw new Error(`${id}: only the revision submitted for review (${g.revision ?? "none"}) can return to work`);
  const { revision: _reviewed, submittedAt, ...kept } = g;
  const reworks = [...(g.reworks || []), { revision, submittedAt: submittedAt ?? null, at: now(), dispatched: task.dispatched ?? null }];
  const next = update(id, { governance: { ...kept, state: "working", reworks }, dispatched: undefined }, p);
  logEvent("reworked", { id, workflowRunId: g.workflowRunId, revision }, p);
  return next;
}
