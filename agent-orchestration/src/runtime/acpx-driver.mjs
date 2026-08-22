import { access, mkdtemp, readdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { createAcpRuntime, createAgentRegistry, createRuntimeStore } from "acpx/runtime";
import { AgentOrchestrationError, invariant } from "../errors.mjs";
import { PROVIDER_ADAPTERS, getProviderAdapter } from "../providers/adapters.mjs";
import { ensurePrivateDir, git, newId } from "../util.mjs";
import { AUTH_BOOTSTRAP_PROMPT } from "./bootstrap.mjs";

async function createEphemeralScratch(kind) {
  for (const entry of await readdir("/dev/shm", { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const match = /^agent-orchestration-(?:turn|probe-[a-z0-9-]+)-(\d+)-/.exec(entry.name);
    if (!match) continue;
    try { process.kill(Number(match[1]), 0); } catch (error) {
      if (error?.code === "ESRCH") await rm(join("/dev/shm", entry.name), { recursive: true, force: true });
    }
  }
  const path = await mkdtemp(join("/dev/shm", `agent-orchestration-${kind}-${process.pid}-`));
  return path;
}

function shellQuote(value) {
  return `'${String(value).replaceAll("'", `'\\''`)}'`;
}

export function providerCommandOverrides(pluginRoot, sandboxEnvironment = {}) {
  const launcher = shellQuote(join(pluginRoot, "bin", "provider-sandbox"));
  const environment = Object.entries(sandboxEnvironment)
    .map(([key, value]) => `${key}=${shellQuote(value)}`)
    .join(" ");
  return Object.fromEntries(Object.values(PROVIDER_ADAPTERS)
    .map((adapter) => [adapter.agentTarget, `${environment ? `env ${environment} ` : ""}${launcher} ${shellQuote(adapter.providerId)}`]));
}

export function createProviderRuntime({ pluginRoot, sessionStateDir, cwd, commonGitDir, permissionProfile, permissionState = { bootstrapComplete: true }, verbose = process.env.AGENT_ORCHESTRATION_VERBOSE === "1", sandboxEnvironment = {}, runtimeTimeoutMs = 30 * 60 * 1000 }) {
  return createAcpRuntime({
    cwd,
    sessionStore: createRuntimeStore({ stateDir: sessionStateDir }),
    agentRegistry: createAgentRegistry({ overrides: providerCommandOverrides(pluginRoot, sandboxEnvironment) }),
    // Provider-native tools execute in the Bubblewrap boundary. ACP client-side
    // filesystem and terminal callbacks execute in this broker process, so they
    // must never be enabled: doing so would let an ACP peer bypass the sandbox.
    permissionMode: "deny-all",
    nonInteractivePermissions: "deny",
    onPermissionRequest: async () => {
      // After AUTH_READY, every catalog CLI runs as yolo / skip-permissions.
      // Isolation stays with Bubblewrap (read profile still mounts the workspace RO).
      if (!permissionState.bootstrapComplete) return { outcome: "reject_once" };
      return { outcome: "allow_once" };
    },
    timeoutMs: runtimeTimeoutMs,
    verbose,
  });
}

const YOLO_MODE_VALUES = Object.freeze(["bypassPermissions", "agent-full-access", "dontAsk", "auto"]);

export async function configureAutoApproveMode(runtime, handle) {
  const capabilities = await runtime.getCapabilities({ handle });
  const keys = capabilities.configOptionKeys ?? [];
  if (!keys.includes("mode")) return null;
  const option = (capabilities.configOptions ?? []).find((entry) => entry?.id === "mode");
  const values = (option?.options ?? []).map((entry) => entry?.value).filter(Boolean);
  const selected = YOLO_MODE_VALUES.find((value) => values.includes(value));
  if (!selected) return null;
  await runtime.setConfigOption({ handle, key: "mode", value: selected });
  return selected;
}

export async function configureEffort(runtime, handle, effort) {
  if (!effort) return null;
  const capabilities = await runtime.getCapabilities({ handle });
  const keys = capabilities.configOptionKeys ?? [];
  const key = ["effort", "reasoning_effort", "reasoningEffort"].find((candidate) => keys.includes(candidate));
  if (!key) {
    throw new AgentOrchestrationError("AO_EFFORT_UNSUPPORTED", `The selected provider session did not advertise an effort control; refusing to silently downgrade requested effort '${effort}'.`, { configOptionKeys: keys });
  }
  await runtime.setConfigOption({ handle, key, value: effort });
  return key;
}

export async function runProviderTurn({
  pluginRoot,
  sessionStateDir,
  workspacePath,
  commonGitDir,
  providerExecutable,
  permissionProfile,
  stage,
  prompt,
  sessionKey,
  requestId,
  timeoutMs,
  maxTurns,
  sessionMode = "oneshot",
  onEvent = async () => {},
  shouldCancel = async () => false,
}) {
  const sandboxTempDir = await createEphemeralScratch("turn");
  const sandboxEnvironment = {
    ao_sandbox_workspace: workspacePath,
    ao_sandbox_common_git_dir: commonGitDir,
    ao_sandbox_temp_dir: sandboxTempDir,
    ao_sandbox_permission_profile: permissionProfile,
    ao_provider_executable: providerExecutable,
  };
  const permissionState = { bootstrapComplete: false };
  const runtime = createProviderRuntime({ pluginRoot, sessionStateDir, cwd: workspacePath, commonGitDir, permissionProfile, permissionState, sandboxEnvironment, runtimeTimeoutMs: timeoutMs });
  const adapter = getProviderAdapter(stage.providerId ?? stage.provider);
  invariant(adapter, "AO_PROVIDER_ADAPTER_MISSING", `No trusted adapter is registered for provider ${stage.providerId ?? stage.provider}.`);
  const requestedModel = adapter.effortTransport === "model-id-suffix" && stage.model && stage.effort
    ? `${stage.model}[${stage.effort}]`
    : stage.model;
  const sessionOptions = {
    systemPrompt: { append: "Obey the orchestration scope and never modify Git metadata or launch other agents." },
    env: sandboxEnvironment,
    ...(maxTurns ? { maxTurns } : {}),
    ...(requestedModel ? { model: requestedModel } : {}),
  };
  let handle;
  let operationError = null;
  let completed = false;
  try {
    handle = await runtime.ensureSession({
      sessionKey,
      agent: stage.provider,
      // Even logical one-shot runs retain one transport across the broker-only
      // auth bootstrap and the task turn. The session is still discarded below.
      mode: "persistent",
      cwd: workspacePath,
      sessionOptions,
    });
    const effortControl = adapter.effortTransport === "model-id-suffix"
      ? "model-id"
      : await configureEffort(runtime, handle, stage.effort);
    await configureAutoApproveMode(runtime, handle);
    const bootstrapTurn = runtime.startTurn({
      handle,
      text: AUTH_BOOTSTRAP_PROMPT,
      mode: "prompt",
      requestId: newId("auth-bootstrap"),
      timeoutMs,
    });
    for await (const event of bootstrapTurn.events) {
      // Deliberately consume without publishing: this turn carries no task or
      // repository input and exists only to force lazy CLI authentication.
      void event;
    }
    const bootstrapResult = await bootstrapTurn.result;
    invariant(bootstrapResult.status === "completed", "AO_AUTH_BOOTSTRAP_FAILED", "Provider authentication bootstrap did not complete.", bootstrapResult);
    permissionState.bootstrapComplete = true;
    const turn = runtime.startTurn({ handle, text: prompt, mode: "prompt", requestId, timeoutMs });
    let cancellationCheckActive = false;
    let cancellationRequested = false;
    const cancellationTimer = setInterval(async () => {
      if (cancellationCheckActive || cancellationRequested) return;
      cancellationCheckActive = true;
      try {
        if (await shouldCancel()) {
          cancellationRequested = true;
          await turn.cancel({ reason: "Broker cancellation requested" });
        }
      } finally {
        cancellationCheckActive = false;
      }
    }, 200);
    cancellationTimer.unref();
    let text = "";
    try {
      for await (const event of turn.events) {
        if (event.type === "text_delta" && event.stream !== "thought") text += event.text;
        await onEvent(event);
      }
    } finally {
      clearInterval(cancellationTimer);
    }
    const result = await turn.result;
    invariant(result.status === "completed", result.status === "cancelled" ? "AO_PROVIDER_CANCELLED" : "AO_PROVIDER_FAILED", result.status === "failed" ? result.error.message : "Provider turn was cancelled.", result);
    const status = await runtime.getStatus({ handle }).catch(() => ({}));
    completed = true;
    return { handle, text, result, status, effortControl };
  } catch (error) {
    operationError = error;
    throw error;
  } finally {
    let closeError = null;
    if (handle) {
      try {
        await runtime.close({ handle, reason: completed ? "Provider turn completed" : "Provider turn aborted", discardPersistentState: sessionMode !== "persistent" });
      } catch (error) {
        // ACPX closes the transport in a finally block even when the backend does
        // not implement optional session/close. That specific condition proves
        // the process transport is gone and is safe for one-shot completion.
        if (!(sessionMode === "oneshot" && error?.code === "ACP_BACKEND_UNSUPPORTED_CONTROL")) {
          closeError = new AgentOrchestrationError("AO_SESSION_CLOSE_FAILED", "The provider session could not be proven closed; supervisor cleanup is required.", { cause: error?.message ?? String(error) });
        }
      }
    }
    await rm(sandboxTempDir, { recursive: true, force: true });
    if (closeError && !operationError) throw closeError;
  }
}

export async function probeProviderSession({ pluginRoot, stateRoot, cwd, providerId, providerExecutable }) {
  const adapter = getProviderAdapter(providerId);
  invariant(adapter, "AO_PROVIDER_ADAPTER_MISSING", `No trusted adapter is registered for provider ${providerId}.`);
  const probeWorkspace = await ensurePrivateDir(join(stateRoot, "probe-workspaces", providerId, "workspace"));
  await git(probeWorkspace, ["init", "-q"]);
  const probeGitDir = join(probeWorkspace, ".git");
  const sandboxTempDir = await createEphemeralScratch(`probe-${providerId}`);
  const runtime = createProviderRuntime({
    pluginRoot,
    sessionStateDir: join(stateRoot, "probe-sessions", providerId),
    cwd: probeWorkspace,
    commonGitDir: probeGitDir,
    permissionProfile: "read",
    sandboxEnvironment: {
      ao_sandbox_workspace: probeWorkspace,
      ao_sandbox_common_git_dir: probeGitDir,
      ao_sandbox_temp_dir: sandboxTempDir,
      ao_sandbox_permission_profile: "read",
      ao_provider_executable: providerExecutable,
    },
    runtimeTimeoutMs: 10_000,
  });
  const sessionOptions = { env: {
    ao_sandbox_workspace: probeWorkspace,
    ao_sandbox_common_git_dir: probeGitDir,
    ao_sandbox_temp_dir: sandboxTempDir,
    ao_sandbox_permission_profile: "read",
    ao_provider_executable: providerExecutable,
  } };
  let handle;
  try {
    handle = await runtime.ensureSession({ sessionKey: newId(`probe-${providerId}`), agent: adapter.agentTarget, mode: "oneshot", cwd: probeWorkspace, sessionOptions });
    return { ok: true, message: "Authenticated ACP session initialization passed." };
  } finally {
    if (handle) {
      try {
        await runtime.close({ handle, reason: "Readiness probe completed", discardPersistentState: true });
      } catch (error) {
        if (error?.code !== "ACP_BACKEND_UNSUPPORTED_CONTROL") throw error;
      }
    }
    await rm(sandboxTempDir, { recursive: true, force: true });
  }
}

export async function checkBundledBridges(pluginRoot) {
  const checks = await Promise.all(["claude-agent-acp", "codex-acp", "provider-sandbox"].map(async (name) => {
    const path = join(pluginRoot, "bin", name);
    try {
      await access(path);
      return { id: name, ok: true, path };
    } catch {
      return { id: name, ok: false, path };
    }
  }));
  return checks;
}
