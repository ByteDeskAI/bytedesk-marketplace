import { join } from "node:path";
import { readFile, lstat } from "node:fs/promises";
import { isAbsolute } from "node:path";
import { z } from "zod";
import { newId, git, sha256 } from "../util.mjs";
import { serializeError, invariant } from "../errors.mjs";
import { createOrchestrationWorktree, gitMetadataFingerprint, removeOrchestrationWorktree } from "../workspace/worktrees.mjs";
import { getProviderDescriptor } from "../providers/index.mjs";
import { runProviderTurn } from "./acpx-driver.mjs";
import { stagePrompt } from "./prompts.mjs";

function planStages(plan) {
  const stages = plan.stages ?? plan.steps ?? plan.assignments ?? [];
  const sessionSourceIds = new Set(stages
    .filter((stage) => stage.selection?.kind === "reuse_stage_session")
    .map((stage) => stage.selection.sourceStageId));
  return stages.map((stage, index) => {
    const selected = stage.route?.selected ?? null;
    const alternatives = stage.route?.fallbackPath?.map((candidateId) => stage.route.candidates.find((candidate) => candidate.candidateId === candidateId))
      .filter(Boolean)
      .map((candidate) => ({
        provider: candidate.agentTarget ?? candidate.providerId,
        providerId: candidate.providerId,
        model: candidate.modelId,
        effort: candidate.effort,
      })) ?? [];
    const normalized = {
      id: stage.stageId ?? stage.id ?? `stage-${index + 1}`,
      role: stage.role ?? stage.purpose ?? stage.id,
      provider: selected?.agentTarget ?? selected?.providerId ?? stage.provider ?? stage.endpoint?.provider ?? stage.model?.provider ?? null,
      providerId: selected?.providerId ?? stage.provider ?? null,
      model: selected?.modelId ?? (typeof stage.model === "string" ? stage.model : (stage.model?.id ?? stage.endpoint?.model)) ?? null,
      effort: selected?.effort ?? stage.effort ?? stage.endpoint?.effort ?? null,
      sessionKey: stage.sessionKey ?? null,
      alternatives,
      sessionSource: stage.selection?.kind === "reuse_stage_session" ? stage.selection.sourceStageId : null,
      internal: stage.selection?.kind === "deterministic_gate",
      dependsOn: stage.dependsOn ?? [],
      selectionKind: stage.selection?.kind ?? "route",
      outputContract: stage.outputContract,
      requiresPersistentSession: sessionSourceIds.has(stage.stageId)
        || ["reuse_stage_session", "persistent_session"].includes(stage.selection?.kind),
    };
    return normalized;
  });
}

function canFallbackBeforeTurn(error) {
  return [
    "REQUESTED_MODEL_UNSUPPORTED",
    "AO_EFFORT_UNSUPPORTED",
    "ACP_SESSION_INIT_FAILED",
    "ACP_BACKEND_UNAVAILABLE",
  ].includes(error?.code) || /(?:unknown|unsupported|unavailable)\s+(?:model|effort)|model\s+(?:unknown|unsupported|unavailable)/i.test(error?.message ?? "");
}

function isTimeoutError(error) {
  return ["ETIMEDOUT", "ACP_TURN_TIMEOUT", "AO_TIMEOUT"].includes(error?.code) || /timed?\s*out|timeout/i.test(error?.message ?? "");
}

function parseStructuredOutput(text) {
  const candidate = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  try { return JSON.parse(candidate); } catch { return null; }
}

const evidenceValue = z.union([
  z.string().min(1),
  z.array(z.unknown()).min(1),
  z.record(z.string(), z.unknown()),
]);
const proposalSchema = z.object({
  decision: evidenceValue,
  constraints: evidenceValue,
  options: evidenceValue,
  recommendation: evidenceValue,
  risks: evidenceValue,
  evidence: evidenceValue,
}).passthrough();
const findingSchema = z.object({
  findingId: z.string().min(1),
  severity: z.enum(["low", "medium", "high", "critical"]),
  claim: z.string().min(1),
  evidence: evidenceValue,
}).passthrough();
const critiqueSchema = z.object({
  findings: z.array(findingSchema),
  counterproposal: evidenceValue,
  acceptanceCriteria: evidenceValue,
}).passthrough();
const dispositionSchema = z.object({
  findingId: z.string().min(1),
  status: z.enum(["accepted", "resolved", "rejected", "unresolved"]),
  rationale: z.string().min(1),
  evidence: evidenceValue,
}).passthrough();
const revisionSchema = z.object({
  revisedDecision: evidenceValue,
  dispositions: z.array(dispositionSchema),
  unresolvedFindings: z.array(z.string().min(1)),
  rationale: evidenceValue,
  verification: evidenceValue,
}).passthrough();

function parseContractOutput(outputs, stageId, schema, contractErrors) {
  const parsed = parseStructuredOutput(outputs.find((entry) => entry.stageId === stageId)?.text ?? "");
  if (!parsed) return { value: null, parseFailure: true };
  const result = schema.safeParse(parsed);
  if (!result.success) {
    contractErrors.push(`${stageId}_contract_invalid`);
    return { value: null, parseFailure: false };
  }
  return { value: result.data, parseFailure: false };
}

function deterministicArchitectureGate(outputs) {
  const contractErrors = [];
  const proposalResult = parseContractOutput(outputs, "proposal", proposalSchema, contractErrors);
  const critiqueResult = parseContractOutput(outputs, "critique", critiqueSchema, contractErrors);
  const revisionResult = parseContractOutput(outputs, "revision", revisionSchema, contractErrors);
  const critique = critiqueResult.value;
  const revision = revisionResult.value;
  const findings = critique?.findings ?? [];
  const dispositions = revision?.dispositions ?? [];
  const findingIds = findings.map((finding) => finding.findingId);
  const dispositionIds = dispositions.map((entry) => entry.findingId);
  if (new Set(findingIds).size !== findingIds.length) contractErrors.push("critique_finding_ids_duplicate");
  if (new Set(dispositionIds).size !== dispositionIds.length) contractErrors.push("revision_disposition_ids_duplicate");
  const unknownDispositions = dispositionIds.filter((findingId) => !findingIds.includes(findingId));
  if (unknownDispositions.length > 0) contractErrors.push("revision_dispositions_unknown");
  const dispositionById = new Map(dispositions.map((entry) => [entry.findingId, entry]));
  const unaddressedFindings = findingIds.filter((findingId) => !dispositionById.has(findingId));
  if (unaddressedFindings.length > 0) contractErrors.push("revision_dispositions_incomplete");
  const severeUnresolved = findings.filter((finding) => {
    if (!["high", "critical"].includes(String(finding?.severity).toLowerCase())) return false;
    return !["accepted", "resolved"].includes(String(dispositionById.get(finding.findingId)?.status).toLowerCase());
  });
  const declaredUnresolved = revision?.unresolvedFindings ?? [];
  if (declaredUnresolved.some((findingId) => !findingIds.includes(findingId))) contractErrors.push("revision_unresolved_findings_unknown");
  if (new Set(declaredUnresolved).size !== declaredUnresolved.length) contractErrors.push("revision_unresolved_findings_duplicate");
  const disagreementFindings = dispositions.filter((entry) => ["rejected", "unresolved"].includes(entry.status));
  const parseFailures = [
    proposalResult.parseFailure ? "proposal" : null,
    critiqueResult.parseFailure ? "critique" : null,
    revisionResult.parseFailure ? "revision" : null,
  ].filter(Boolean);
  const needsApproval = declaredUnresolved.length > 0 || severeUnresolved.length > 0 || disagreementFindings.length > 0 || contractErrors.length > 0 || parseFailures.length > 0;
  return {
    state: needsApproval ? "waiting_for_decision" : "recommendation_ready",
    requiresHumanApproval: needsApproval,
    unresolvedFindings: declaredUnresolved,
    severeCritique: severeUnresolved,
    unaddressedFindings,
    unknownDispositions,
    disagreementFindings,
    contractErrors,
    parseFailures,
  };
}

export const runtimeInternals = Object.freeze({ planStages, canFallbackBeforeTurn, isTimeoutError, deterministicArchitectureGate });

function dependencyOutputs(stage, stages, outputs) {
  const byId = new Map(stages.map((entry) => [entry.id, entry]));
  const needed = new Set();
  const visit = (stageId) => {
    if (needed.has(stageId)) return;
    needed.add(stageId);
    for (const dependency of byId.get(stageId)?.dependsOn ?? []) visit(dependency);
  };
  for (const dependency of stage.dependsOn) visit(dependency);
  return outputs.filter((output) => needed.has(output.stageId));
}

async function validateWorkspace(workspace, consumer) {
  const markerInfo = await lstat(join(workspace.path, ".git"));
  invariant(markerInfo.isFile(), "AO_GIT_METADATA_CHANGED", "The worktree .git marker was replaced.");
  invariant(sha256(await readFile(join(workspace.path, ".git"))) === workspace.gitMarkerHash, "AO_GIT_METADATA_CHANGED", "The worktree .git marker changed during provider execution.");
  invariant(await gitMetadataFingerprint(consumer) === workspace.gitMetadataFingerprint, "AO_GIT_METADATA_CHANGED", "Shared Git refs or configuration changed during provider execution.");
  const { stdout } = await git(workspace.path, ["status", "--porcelain=v1", "-z", "--untracked-files=all"]);
  const changedPaths = stdout.split("\0").filter(Boolean).map((record) => /^[ MADRCU?!]{2} /.test(record) ? record.slice(3) : record);
  for (const path of changedPaths) {
    invariant(!isAbsolute(path) && path !== ".." && !path.startsWith("../") && !path.includes("/../") && path !== ".git" && !path.startsWith(".git/"), "AO_UNSAFE_AGENT_CHANGE", `Agent changed a forbidden path: ${path}`);
  }
  return changedPaths;
}

export async function executeRun({ store, runId, pluginRoot, stateRoot }) {
  let run = await store.get(runId);
  let workspace = null;
  try {
    run = await store.transition(runId, ["queued"], "preparing");
    if (run.cancelRequestedAt) return store.transition(runId, ["preparing"], "cancelling", {}, "cancellation_observed_before_start");

    if (run.input.permissionProfile === "write") {
      workspace = await createOrchestrationWorktree(run.consumer, { runId });
      run = await store.update(runId, { workspace }, "workspace_created");
    }
    const workspacePath = workspace?.path ?? run.consumer.checkoutRoot;
    run = await store.transition(runId, ["preparing"], "running");

    const outputs = [];
    const sessions = [];
    let decision = null;
    const plannedStages = planStages(run.plan);
    for (const stage of plannedStages) {
      invariant(["route", "reuse_stage_session", "persistent_session", "deterministic_gate"].includes(stage.selectionKind), "AO_PROTOCOL_EXECUTOR_MISSING", `No stage executor is registered for selection kind '${stage.selectionKind}'.`);
      const completedStageIds = new Set(outputs.map((output) => output.stageId));
      const missingDependencies = stage.dependsOn.filter((dependency) => !completedStageIds.has(dependency));
      invariant(missingDependencies.length === 0, "AO_PROTOCOL_DEPENDENCY_INCOMPLETE", `Stage ${stage.id} cannot execute before its dependencies complete.`, { missingDependencies });
      const latest = await store.get(runId);
      if (latest.cancelRequestedAt) {
        await store.transition(runId, ["running"], "cancelling", { outputs, sessions }, "cancellation_observed_between_stages");
        return await store.get(runId);
      }
      if (stage.internal) {
        invariant(stage.outputContract === "architecture.disposition-matrix.v1", "AO_PROTOCOL_EXECUTOR_MISSING", `No deterministic gate implements '${stage.outputContract}'.`);
        decision = deterministicArchitectureGate(dependencyOutputs(stage, plannedStages, outputs));
        outputs.push({ stageId: stage.id, provider: "broker", model: null, effort: null, text: JSON.stringify(decision, null, 2), status: "completed" });
        await store.update(runId, { outputs, sessions, decision }, "decision_gate_completed");
        continue;
      }
      let effectiveStage = stage;
      if (stage.sessionSource) {
        const sourceSession = sessions.find((session) => session.stageId === stage.sessionSource);
        invariant(sourceSession, "AO_SESSION_NOT_FOUND", `Stage ${stage.id} must reuse missing stage ${stage.sessionSource}.`);
        effectiveStage = { ...stage, provider: sourceSession.provider, providerId: sourceSession.providerId, model: sourceSession.model, effort: sourceSession.effort, sessionKey: sourceSession.sessionKey, alternatives: [] };
      }
      invariant(effectiveStage.provider, "AO_INVALID_EXECUTION_PLAN", `Stage ${stage.id} does not identify a provider.`);
      const candidates = effectiveStage.sessionSource || effectiveStage.alternatives.length === 0
        ? [effectiveStage]
        : effectiveStage.alternatives.map((candidate) => ({ ...effectiveStage, ...candidate }));
      let result;
      let selectedStage;
      for (let candidateIndex = 0; candidateIndex < candidates.length; candidateIndex += 1) {
        const candidate = candidates[candidateIndex];
        const sessionKey = candidate.sessionKey ?? `${runId}:${stage.id}:${candidate.providerId ?? candidate.provider}:${candidate.model ?? "default"}:${candidate.effort ?? "default"}`;
        try {
          result = await runProviderTurn({
            pluginRoot,
            sessionStateDir: join(stateRoot, "sessions"),
            workspacePath,
            commonGitDir: run.consumer.commonGitDir,
            providerExecutable: run.input.providerExecutables?.[candidate.providerId ?? candidate.provider],
            permissionProfile: run.input.permissionProfile,
            stage: candidate,
            prompt: stagePrompt({ input: run.input, stage: candidate, priorOutputs: dependencyOutputs(stage, plannedStages, outputs), workspacePath }),
            sessionKey,
            requestId: newId("turn"),
            timeoutMs: run.input.timeoutMs,
            maxTurns: run.input.maxTurns,
            sessionMode: effectiveStage.requiresPersistentSession ? "persistent" : (run.input.sessionMode ?? "oneshot"),
            shouldCancel: async () => (await store.get(runId)).cancelRequestedAt !== null,
            onEvent: async (event) => {
              if (event.type === "tool_call" || event.type === "status") {
                await store.update(runId, { lastProviderEvent: { stageId: stage.id, type: event.type, text: event.text?.slice(0, 500), at: new Date().toISOString() } }, "provider_event");
              }
            },
          });
          selectedStage = candidate;
          selectedStage.sessionKey = sessionKey;
          break;
        } catch (error) {
          if (candidateIndex === candidates.length - 1 || !canFallbackBeforeTurn(error)) throw error;
          await store.update(runId, { lastRouteFallback: { stageId: stage.id, rejected: { providerId: candidate.providerId, model: candidate.model, effort: candidate.effort }, error: serializeError(error), at: new Date().toISOString() } }, "route_fallback");
        }
      }
      invariant(result && selectedStage, "AO_PROVIDER_FAILED", `No provider candidate completed stage ${stage.id}.`);
      outputs.push({ stageId: stage.id, provider: selectedStage.providerId ?? selectedStage.provider, model: selectedStage.model, effort: selectedStage.effort, text: result.text, status: result.result.status });
      const providerDescriptor = getProviderDescriptor(selectedStage.providerId ?? selectedStage.provider);
      sessions.push({
        stageId: stage.id,
        sessionKey: selectedStage.sessionKey,
        provider: selectedStage.provider,
        providerId: selectedStage.providerId,
        model: selectedStage.model,
        effort: selectedStage.effort,
        handle: result.handle,
        effortControl: result.effortControl,
        sessionMode: effectiveStage.requiresPersistentSession ? "persistent" : (run.input.sessionMode ?? "oneshot"),
        resumeSupported: providerDescriptor?.capabilities?.persistent_session === "supported",
      });
      await store.update(runId, { outputs, sessions }, "stage_completed");
    }

    run = await store.transition(runId, ["running"], "verifying", { outputs, sessions });
    const changedPaths = workspace ? await validateWorkspace(workspace, run.consumer) : [];
    const finalPatch = { outputs, sessions, changedPaths, decision };
    if (decision?.requiresHumanApproval) {
      return store.transition(runId, ["verifying"], "waiting_for_decision", finalPatch, "decision_waiting_for_approval");
    }
    return store.transition(runId, ["verifying"], "succeeded", finalPatch, "run_succeeded");
  } catch (error) {
    const current = await store.get(runId).catch(() => run);
    if (current && !["succeeded", "failed", "cancelled", "timed_out", "rejected", "recovery_required"].includes(current.state)) {
      if (current.cancelRequestedAt) {
        return store.transition(runId, [current.state], "cancelling", { error: null }, "cancellation_observed").catch(() => ({ ...current, state: "recovery_required", error: serializeError(error) }));
      }
      const requiresSupervisorCleanup = ["AO_PROVIDER_INIT_TIMEOUT", "AO_SESSION_CLOSE_FAILED"].includes(error?.code);
      const nextState = requiresSupervisorCleanup ? "cleanup_required" : isTimeoutError(error) ? "timed_out" : "failed";
      const eventType = nextState === "cleanup_required" ? "supervisor_cleanup_required" : nextState === "timed_out" ? "run_timed_out" : "run_failed";
      return store.transition(runId, [current.state], nextState, { error: serializeError(error) }, eventType).catch(() => ({ ...current, state: "recovery_required", error: serializeError(error) }));
    }
    throw error;
  }
}

export async function cleanupRun({ store, runId }) {
  const run = await store.get(runId);
  invariant(["succeeded", "failed", "cancelled", "timed_out", "rejected", "recovery_required"].includes(run.state), "AO_RUN_NOT_TERMINAL", "A run must be terminal before its worktree can be cleaned up.");
  if (!run.workspace) return { cleaned: false, reason: "no_workspace", run };
  const removal = await removeOrchestrationWorktree(run.consumer, run.workspace);
  return { cleaned: removal?.removed === true, reason: removal?.reason, run: await store.clearWorkspace(runId) };
}
