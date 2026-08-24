import { open, readFile, realpath } from "node:fs/promises";
import { isAbsolute, join, resolve } from "node:path";
import { getRoutingExplanation, routeTask } from "./policy/index.mjs";
import { createExecutionPlan, PROTOCOL_VERSION } from "./protocols/index.mjs";
import { PROVIDER_ADAPTERS, PROVIDER_CATALOG, MODEL_CATALOG, getProviderDescriptor } from "./providers/index.mjs";
import { PLUGIN_ROOT, stateRoot as resolveStateRoot, validateStateRoot } from "./config.mjs";
import { AgentOrchestrationError, invariant } from "./errors.mjs";
import { ensurePrivateDir, isPathWithin, newId, processGroupExists, processStartIdentity, runFile, waitForProcessGroupExit } from "./util.mjs";
import { resolveConsumerRepository } from "./workspace/repository.mjs";
import { RunStore, TERMINAL_STATES } from "./state/store.mjs";
import { cleanupRun, executeRun } from "./runtime/engine.mjs";
import { checkBundledBridges } from "./runtime/acpx-driver.mjs";
import { runUserManagerFile, spawnUserManagerFile } from "./runtime/user-bus.mjs";
import { capabilityUrl, isExpired, mintCapability, readSessionMeta, writeSessionMeta } from "./session/capability.mjs";
import { openSessionBrowser, probeSessionHost, startSessionHost } from "./session/host.mjs";

const WORKER_STATES = new Set(["queued", "preparing", "running", "verifying", "cancelling", "cleanup_required"]);

function normalizeIntentInput(input) {
  return {
    intent: input.intent,
    task: input.task,
    requiredCapabilities: input.requiredCapabilities ?? [],
    effort: input.effort,
    optimization: input.optimization,
    risk: input.risk,
    protocolId: input.protocolId,
    sessionMode: input.sessionMode,
    permissionProfile: input.permissionProfile,
  };
}

export async function externalProviderPaths(pluginRoot, discovered, executableRoots = []) {
  const paths = [];
  for (const candidate of discovered) {
    const resolvedCandidate = await realpath(candidate).catch(() => resolve(candidate));
    if (isPathWithin(pluginRoot, candidate) || isPathWithin(pluginRoot, resolvedCandidate)) continue;
    if (!executableRoots.some((root) => isPathWithin(root, resolvedCandidate))) continue;
    if (!paths.includes(resolvedCandidate)) paths.push(resolvedCandidate);
  }
  return paths;
}

export async function discoverProviderPaths(pluginRoot, adapter, discovered, resolverRunner = runFile) {
  const candidates = [...discovered];
  for (const resolver of adapter.candidateResolvers ?? []) {
    invariant(isAbsolute(resolver.executable), "AO_PROVIDER_RESOLVER_NOT_ABSOLUTE", "Provider candidate resolvers must use an absolute executable path.");
    try {
      const { stdout } = await resolverRunner(resolver.executable, [...resolver.args], { timeoutMs: 5_000 });
      candidates.push(...stdout.split("\n").map((line) => line.trim()).filter(Boolean));
    } catch {}
  }
  return externalProviderPaths(pluginRoot, candidates, adapter.executableRoots);
}

export class OrchestrationService {
  constructor({ pluginRoot = PLUGIN_ROOT, stateRoot = resolveStateRoot(), workerEntrypoint = join(pluginRoot, "dist", "cli.cjs"), maxConcurrentRuns = Number(process.env.AGENT_ORCHESTRATION_MAX_CONCURRENT_RUNS || 4), maxConcurrentPerProvider = Number(process.env.AGENT_ORCHESTRATION_MAX_CONCURRENT_PER_PROVIDER || 2), autoRecover = true, recoveryGraceMs = 5_000, sessionUiRoot = join(pluginRoot, "dist", "session-ui") } = {}) {
    this.pluginRoot = pluginRoot;
    this.stateRoot = stateRoot;
    this.workerEntrypoint = workerEntrypoint;
    this.maxConcurrentRuns = Number.isInteger(maxConcurrentRuns) && maxConcurrentRuns > 0 ? maxConcurrentRuns : 4;
    this.maxConcurrentPerProvider = Number.isInteger(maxConcurrentPerProvider) && maxConcurrentPerProvider > 0 ? maxConcurrentPerProvider : 2;
    this.autoRecover = autoRecover;
    this.recoveryGraceMs = recoveryGraceMs;
    this.sessionUiRoot = sessionUiRoot;
    this.sessionHost = null;
    this.store = new RunStore(stateRoot);
    this.availabilityCache = null;
    this.recoveryTimer = null;
  }

  async initialize() {
    this.stateRoot = validateStateRoot(this.stateRoot, this.pluginRoot);
    this.store = new RunStore(this.stateRoot);
    await this.store.initialize();
    if (this.autoRecover && !process.env.AGENT_ORCHESTRATION_CURRENT_WORKER_RUN_ID) {
      await this.recoverInterruptedRuns();
      this.recoveryTimer = setInterval(() => {
        this.recoverInterruptedRuns().catch((error) => { this.lastRecoveryError = error; });
      }, Math.max(2_000, this.recoveryGraceMs));
      this.recoveryTimer.unref();
    }
    return this;
  }

  async terminateRecordedProcessGroup(worker) {
    if (worker?.supervisorUnit) {
      invariant(/^agent-orchestration-run-[a-z0-9-]+\.(?:scope|service)$/.test(worker.supervisorUnit), "AO_UNSAFE_SUPERVISOR_UNIT", "Refusing to operate on an untrusted supervisor unit name.");
      const readState = async () => {
        const { stdout } = await runUserManagerFile("/usr/bin/systemctl", ["--user", "show", worker.supervisorUnit, "--property=LoadState", "--property=ActiveState"], { timeoutMs: 5_000 });
        return Object.fromEntries(stdout.split("\n").filter(Boolean).map((line) => line.split(/=(.*)/s).slice(0, 2)));
      };
      const before = await readState().catch(() => null);
      if (!before) return false;
      if (before.LoadState === "not-found" || ["inactive", "failed"].includes(before.ActiveState)) return true;
      try { await runUserManagerFile("/usr/bin/systemctl", ["--user", "stop", worker.supervisorUnit], { timeoutMs: 10_000 }); } catch { return false; }
      const after = await readState().catch(() => null);
      return Boolean(after && (after.LoadState === "not-found" || ["inactive", "failed"].includes(after.ActiveState)));
    }
    if (!worker?.processGroup || !processGroupExists(worker.processGroup)) return true;
    const identity = worker.pid ? await processStartIdentity(worker.pid) : null;
    // A numeric PGID is reusable. Never signal unless the recorded leader is
    // still present and its start identity proves ownership of this group.
    if (!identity || identity !== worker.startIdentity) return false;
    try { process.kill(-worker.processGroup, "SIGTERM"); } catch (error) { if (error?.code !== "ESRCH") throw error; }
    if (!await waitForProcessGroupExit(worker.processGroup, 2_000)) {
      try { process.kill(-worker.processGroup, "SIGKILL"); } catch (error) { if (error?.code !== "ESRCH") throw error; }
    }
    return waitForProcessGroupExit(worker.processGroup, 2_000);
  }

  async recoverInterruptedRuns() {
    const now = Date.now();
    for (const candidate of await this.store.list()) {
      if (candidate.runId === process.env.AGENT_ORCHESTRATION_CURRENT_WORKER_RUN_ID) continue;
      if (!WORKER_STATES.has(candidate.state) || now - Date.parse(candidate.updatedAt) < this.recoveryGraceMs) continue;
      await this.store.withLock(`recovery:${candidate.runId}`, async () => {
        const run = await this.store.get(candidate.runId);
        if (!WORKER_STATES.has(run.state)) return;
        const identity = run.worker?.pid ? await processStartIdentity(run.worker.pid) : null;
        const workerAlive = Boolean(identity && identity === run.worker?.startIdentity);
        if (workerAlive && run.state !== "cleanup_required") return;
        if (run.state === "queued") {
          await this.launchWorker(run.runId);
          return;
        }
        const descendantsStopped = await this.terminateRecordedProcessGroup(run.worker);
        const nextState = descendantsStopped ? (run.cancelRequestedAt ? "cancelled" : "recovery_required") : "cleanup_required";
        const patch = {
          error: {
            code: descendantsStopped ? "AO_WORKER_LOST" : "AO_WORKER_GROUP_SURVIVED",
            message: descendantsStopped
              ? "The durable worker disappeared before reaching a terminal state; its recorded process group is stopped."
              : "The durable worker disappeared and its recorded process group could not be proven stopped.",
          },
        };
        if (nextState === run.state) await this.store.update(run.runId, patch, "worker_cleanup_still_required");
        else await this.store.transition(run.runId, [run.state], nextState, patch, "worker_loss_detected");
      });
    }
  }

  capabilities() {
    return {
      schemaVersion: 1,
      providerIds: PROVIDER_CATALOG.map((entry) => entry.providerId),
      models: MODEL_CATALOG,
      intents: ["architecture", "design", "implementation", "review", "research", "test", "documentation", "operations", "triage", "general"],
      protocols: ["architecture.adversarial.v1", "single.v1", "followup.v1"],
      permissionProfiles: ["read", "write"],
      consumerRepository: "required-explicit-absolute-path",
      worktreeDerivation: "consumer-repository-sibling",
      concurrency: { global: this.maxConcurrentRuns, perProvider: this.maxConcurrentPerProvider },
      sessionModes: ["oneshot", "persistent"],
      lifecycle: ["queued", "preparing", "running", "verifying", "cancelling", "cleanup_required", "waiting_for_decision", "succeeded", "failed", "cancelled", "timed_out", "rejected", "recovery_required"],
    };
  }

  async resolveConsumer(consumerCwd, requireClean = false) {
    return resolveConsumerRepository({ consumerCwd, pluginRoot: this.pluginRoot, stateRoot: this.stateRoot, requireClean });
  }

  routingContext(input) {
    const sessionMode = input.sessionMode ?? "oneshot";
    const requiredCapabilities = new Set(input.requiredCapabilities ?? []);
    requiredCapabilities.add(input.permissionProfile === "write" ? "workspace_write" : "workspace_read");
    if (input.permissionProfile === "write") requiredCapabilities.add("tools");
    if (sessionMode === "persistent") requiredCapabilities.add("persistent_session");
    const requestedProviderAlias = input.provider ? `provider.${input.provider}.default` : null;
    const capabilityAlias = input.requiredCapabilities?.includes("large_context")
      ? "provider.kimi.default"
      : input.requiredCapabilities?.includes("web_research")
        ? "provider.grok-build.default"
        : null;
    const derivedEffort = input.effort ?? (
      input.intent === "implementation" && ["high", "critical"].includes(input.risk)
        ? "max"
        : input.intent === "implementation" && input.optimization === "mechanical"
          ? "medium"
          : undefined
    );
    return {
      availability: input.availability,
      alias: requestedProviderAlias ?? capabilityAlias ?? undefined,
      providerAllowlist: input.allowProviders,
      providerDenylist: input.denyProviders,
      excludedProviderIds: input.intent === "review" && input.originProvider ? [input.originProvider] : undefined,
      requiredCapabilities: [...requiredCapabilities],
      effort: derivedEffort,
      optimize: input.optimization === "mechanical" ? "quality" : input.optimization,
      availabilitySnapshotId: input.snapshotId,
      requireAvailable: input.requireAvailable === true,
    };
  }

  async route(input) {
    const consumer = await this.resolveConsumer(input.consumerCwd, false);
    const plan = createExecutionPlan(normalizeIntentInput({ ...input, permissionProfile: "read", sessionMode: input.sessionMode ?? "oneshot" }), this.routingContext({ ...input, permissionProfile: "read" }));
    invariant(plan.stages.length === 1 && plan.stages[0].route, "AO_PLAN_REQUIRED", "This request resolves to a multi-stage protocol; use orchestration_plan to preview all provider routes.", { protocolId: plan.protocolId });
    const decision = plan.stages[0].route;
    return { consumer, decision, explanation: getRoutingExplanation(decision) };
  }

  async plan(input) {
    const preparedInput = {
      ...input,
      permissionProfile: input.permissionProfile ?? "read",
      sessionMode: input.sessionMode ?? "oneshot",
    };
    const consumer = await this.resolveConsumer(preparedInput.consumerCwd, preparedInput.permissionProfile === "write");
    const plan = createExecutionPlan(normalizeIntentInput(preparedInput), this.routingContext(preparedInput));
    return { consumer, plan, explanation: getRoutingExplanation(plan) };
  }

  async spawn(input) {
    const availability = await this.providerAvailabilitySnapshot();
    const prepared = await this.plan({ ...input, availability, requireAvailable: true });
    invariant(prepared.plan.status === "ready", "AO_ROUTING_BLOCKED", "No eligible live provider/model route satisfies the execution policy.", getRoutingExplanation(prepared.plan));
    return this.store.withLock("scheduler", async () => {
      if (input.idempotencyKey) {
        const existing = await this.store.findByIdempotencyKey(input.idempotencyKey, prepared.consumer.repositoryKey);
        if (existing) return { run: existing, explanation: prepared.explanation, session: await this.sessionForRun(existing.runId) };
      }
      const active = (await this.store.list()).filter((run) => WORKER_STATES.has(run.state));
      invariant(active.length < this.maxConcurrentRuns, "AO_CONCURRENCY_LIMIT", "The global orchestration concurrency limit is reached.", { limit: this.maxConcurrentRuns });
      const selectedProviders = [...new Set(prepared.plan.stages.map((stage) => stage.route?.selected?.providerId).filter(Boolean))];
      for (const providerId of selectedProviders) {
        const providerActive = active.filter((run) => run.plan?.stages?.some((stage) => stage.route?.selected?.providerId === providerId));
        invariant(providerActive.length < this.maxConcurrentPerProvider, "AO_PROVIDER_CONCURRENCY_LIMIT", `The concurrency limit for ${providerId} is reached.`, { providerId, limit: this.maxConcurrentPerProvider });
      }
      const run = await this.store.create({
        input: {
          intent: input.intent,
          task: input.task,
          expectedOutput: input.expectedOutput,
          permissionProfile: input.permissionProfile ?? "read",
          timeoutMs: input.timeoutMs ?? 30 * 60 * 1000,
          maxTurns: input.maxTurns ?? 20,
          effort: input.effort,
          protocolId: prepared.plan.protocolId,
          sessionMode: input.sessionMode ?? "oneshot",
          providerExecutables: availability.providerExecutables ?? {},
        },
        consumer: prepared.consumer,
        plan: prepared.plan,
        idempotencyKey: input.idempotencyKey ?? null,
      });
      const launchedRun = run.state === "queued"
        ? (await this.launchWorker(run.runId)) ?? await this.store.get(run.runId)
        : run;
      const session = await this.openRunSession(launchedRun.runId);
      return { run: launchedRun, explanation: prepared.explanation, session };
    });
  }

  async ensureSessionHost() {
    if (this.sessionHost) return this.sessionHost;
    const live = await probeSessionHost(this.stateRoot);
    if (live) {
      this.sessionHost = { port: live.port, hostNonce: live.hostNonce, bind: live.bind, close: async () => {} };
      return this.sessionHost;
    }
    this.sessionHost = await startSessionHost({
      stateRoot: this.stateRoot,
      uiRoot: this.sessionUiRoot,
      controls: this.sessionControls(),
    });
    return this.sessionHost;
  }

  sessionControls() {
    return {
      cancel: (runId) => this.applyCancel(runId),
      followUp: (runId, message) => this.sessionFollowUp(runId, message),
      decide: (runId, body) => this.sessionDecide(runId, body),
    };
  }

  async openRunSession(runId) {
    const host = await this.ensureSessionHost();
    const cap = mintCapability();
    await writeSessionMeta(this.stateRoot, runId, {
      tokenHash: cap.tokenHash,
      expiresAt: cap.expiresAt,
      exchangedAt: null,
      hostNonce: host.hostNonce,
    });
    const url = capabilityUrl(host.port, cap.token);
    const opened = await openSessionBrowser(url);
    return { url, port: host.port, expiresAt: cap.expiresAt, opened, bind: host.bind };
  }

  async sessionForRun(runId) {
    const host = await this.ensureSessionHost();
    const existing = await readSessionMeta(this.stateRoot, runId);
    if (existing && !isExpired(existing.expiresAt) && !existing.exchangedAt) {
      return { url: null, port: host.port, expiresAt: existing.expiresAt, opened: false, bind: host.bind, pendingExchange: true };
    }
    return this.openRunSession(runId);
  }

  async waitForWorkerRegistration(runId, supervisorUnit, child, launchState, timeoutMs = 10_000) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if (launchState.error) {
        throw new AgentOrchestrationError("AO_WORKER_LAUNCH_FAILED", "The worker supervisor failed before registration.", { cause: launchState.error.message });
      }
      const run = await this.store.get(runId);
      if (run.worker?.attachedAt) {
        if (TERMINAL_STATES.has(run.state)) return run;
        const identity = await processStartIdentity(run.worker.pid);
        invariant(identity && identity === run.worker.startIdentity, "AO_WORKER_REGISTRATION_LOST", "The registered worker disappeared before startup acknowledgement.");
        const scope = await runUserManagerFile("/usr/bin/systemctl", ["--user", "show", supervisorUnit, "--property=LoadState", "--property=ActiveState", "--property=ControlGroup"], { timeoutMs: 2_000 }).catch(() => null);
        const properties = scope && Object.fromEntries(scope.stdout.split("\n").filter(Boolean).map((line) => line.split(/=(.*)/s).slice(0, 2)));
        if (properties?.LoadState === "loaded" && properties.ActiveState === "active" && properties.ControlGroup) return run;
      }
      if (TERMINAL_STATES.has(run.state)) {
        throw new AgentOrchestrationError("AO_WORKER_REGISTRATION_MISSING", "The run terminated before its worker acknowledged the supervisor scope.");
      }
      if (launchState.exited) {
        throw new AgentOrchestrationError("AO_WORKER_LAUNCH_FAILED", "systemd-run exited before the worker registered.", launchState.exited);
      }
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    throw new AgentOrchestrationError("AO_WORKER_REGISTRATION_TIMEOUT", "Timed out waiting for the worker to register in its named supervisor scope.", { supervisorUnit, launcherPid: child.pid });
  }

  async quarantineWorkerLaunchFailure(runId, supervisorUnit, error) {
    const stopped = await this.terminateRecordedProcessGroup({ supervisorUnit }).catch(() => false);
    const run = await this.store.get(runId);
    if (TERMINAL_STATES.has(run.state)) return run;
    const nextState = stopped ? "failed" : "cleanup_required";
    return this.store.transition(runId, [run.state], nextState, {
      error: {
        code: error?.code ?? "AO_WORKER_LAUNCH_FAILED",
        message: error instanceof Error ? error.message : String(error),
      },
    }, stopped ? "worker_launch_failed" : "worker_launch_cleanup_required");
  }

  async launchWorker(runId) {
    const logDir = await ensurePrivateDir(join(this.stateRoot, "logs"));
    const unitBase = `agent-orchestration-run-${runId.replaceAll("_", "-")}`;
    const supervisorUnit = `${unitBase}.scope`;
    const args = [
      "--user", "--scope", "--collect", "--quiet", `--unit=${unitBase}`,
      "--property=KillMode=control-group", "--property=TimeoutStopSec=3s", "--property=RuntimeMaxSec=8h",
      "--property=MemoryMax=8G", "--property=TasksMax=512",
      "/usr/bin/prlimit", "--core=0", "--fsize=1073741824", "--",
      process.execPath, this.workerEntrypoint, "worker", "--state-root", this.stateRoot, "--run-id", runId,
    ];
    const stdout = await open(join(logDir, `${runId}.out.log`), "a", 0o600);
    const stderr = await open(join(logDir, `${runId}.err.log`), "a", 0o600);
    let child;
    const launchState = { error: null, exited: null };
    try {
      child = await spawnUserManagerFile("/usr/bin/systemd-run", args, {
        cwd: this.pluginRoot,
        env: { ...process.env, AGENT_ORCHESTRATION_STATE_HOME: this.stateRoot, AGENT_ORCHESTRATION_CURRENT_WORKER_RUN_ID: runId },
        detached: true,
        stdio: ["ignore", stdout.fd, stderr.fd],
        shell: false,
      });
      child.on("error", (error) => { launchState.error = error; });
      child.on("exit", (code, signal) => { launchState.exited = { code, signal }; });
      await new Promise((resolveSpawn, rejectSpawn) => {
        child.once("spawn", resolveSpawn);
        child.once("error", rejectSpawn);
      });
      child.unref();
      const startIdentity = await processStartIdentity(child.pid);
      invariant(startIdentity, "AO_WORKER_LAUNCH_FAILED", "Could not establish the systemd-run launcher identity.");
      await this.store.update(runId, { worker: { pid: child.pid, processGroup: null, startIdentity, supervisorUnit, startedAt: new Date().toISOString() } }, "worker_started");
      return await this.waitForWorkerRegistration(runId, supervisorUnit, child, launchState);
    } catch (error) {
      await this.quarantineWorkerLaunchFailure(runId, supervisorUnit, error).catch(() => {});
      throw error;
    } finally {
      await stdout.close().catch(() => {});
      await stderr.close().catch(() => {});
    }
  }

  async worker(runId) {
    const deadline = Date.now() + 5_000;
    let run = await this.store.get(runId);
    while (!run.worker?.supervisorUnit && !TERMINAL_STATES.has(run.state) && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 25));
      run = await this.store.get(runId);
    }
    if (TERMINAL_STATES.has(run.state)) return run;
    const { stdout: controlGroup } = await runUserManagerFile("/usr/bin/systemctl", ["--user", "show", run.worker?.supervisorUnit, "--property=ControlGroup", "--value"], { timeoutMs: 5_000 });
    const ownCgroups = await readFile("/proc/self/cgroup", "utf8");
    invariant(controlGroup && ownCgroups.includes(controlGroup), "AO_WORKER_REGISTRATION_MISSING", "The worker refused to execute outside its registered supervisor cgroup.");
    run = await this.store.update(runId, { worker: { ...run.worker, pid: process.pid, startIdentity: await processStartIdentity(process.pid), attachedAt: new Date().toISOString() } }, "worker_attached_to_supervisor");
    return executeRun({ store: this.store, runId, pluginRoot: this.pluginRoot, stateRoot: this.stateRoot });
  }

  async getRun(input) {
    const [consumer, run] = await Promise.all([this.resolveConsumer(input.consumerCwd, false), this.store.get(input.runId)]);
    invariant(consumer.repositoryKey === run.consumer.repositoryKey, "AO_RUN_REPOSITORY_MISMATCH", "The run belongs to a different consumer repository.");
    const session = await this.sessionForRun(run.runId);
    return { ...run, session };
  }

  async list(input) {
    const consumer = await this.resolveConsumer(input.consumerCwd, false);
    return (await this.store.list()).filter((run) => run.consumer.repositoryKey === consumer.repositoryKey);
  }

  async events(input) {
    await this.getRun(input);
    return this.store.events(input.runId, input.after ?? 0);
  }

  async wait(input) {
    const deadline = Date.now() + Math.min(input.timeoutMs ?? 55_000, 55_000);
    while (true) {
      const run = await this.getRun(input);
      if (TERMINAL_STATES.has(run.state) || run.state === "waiting_for_decision" || Date.now() >= deadline) return run;
      await new Promise((resolve) => setTimeout(resolve, Math.min(input.pollIntervalMs ?? 250, 2_000)));
    }
  }

  async cancel(input) {
    await this.getRun(input);
    return this.applyCancel(input.runId);
  }

  async applyCancel(runId) {
    let run = await this.store.requestCancel(runId);
    if (TERMINAL_STATES.has(run.state)) return run;
    if (run.worker?.pid && WORKER_STATES.has(run.state)) {
      const cooperativeDeadline = Date.now() + 2_000;
      while (Date.now() < cooperativeDeadline && processGroupExists(run.worker.processGroup)) {
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
      const stopped = await this.terminateRecordedProcessGroup(run.worker);
      run = await this.store.get(runId);
      if (!stopped) {
        if (!TERMINAL_STATES.has(run.state)) {
          const patch = {
            cancellation: { state: "process_group_survived", at: new Date().toISOString() },
          };
          return run.state === "cleanup_required"
            ? this.store.update(runId, patch, "cancellation_still_unproven")
            : this.store.transition(runId, [run.state], "cleanup_required", patch, "cancellation_unproven");
        }
        invariant(false, "AO_CANCELLATION_UNPROVEN", "The run reached a terminal state, but its recorded process group is still alive.");
      }
      if (!TERMINAL_STATES.has(run.state)) {
        run = await this.store.transition(runId, [run.state], "cancelled", { cancellation: { state: "confirmed_stopped", at: new Date().toISOString() } }, "worker_cancelled");
      }
    } else if (!TERMINAL_STATES.has(run.state)) {
      const safelyInactive = ["queued", "waiting_for_decision"].includes(run.state);
      run = await this.store.transition(runId, [run.state], safelyInactive ? "cancelled" : "cleanup_required", {}, safelyInactive ? "cancelled_without_worker" : "cancellation_worker_identity_missing");
    }
    return run;
  }

  async sessionFollowUp(runId, message) {
    const text = typeof message === "string" ? message.trim() : "";
    invariant(text.length > 0, "AO_INVALID_FOLLOWUP", "Follow-up message is required.");
    const run = await this.store.get(runId);
    if (["failed", "cancelled", "timed_out", "rejected", "recovery_required"].includes(run.state)) {
      invariant(false, "AO_RUN_NOT_READY_FOR_FOLLOWUP", "Run ended. Start a new run to continue.");
    }
    invariant(run.input.permissionProfile === "read", "AO_WRITE_FOLLOWUP_REQUIRES_NEW_RUN", "Writable persistent-session follow-up is disabled until workspace leases can prevent cross-run cleanup; spawn a new scoped write run instead.");
    await this.store.appendJournal(runId, "operator_message", { text: text.slice(0, 8_000) });
    if (run.state === "succeeded") {
      return this.send({
        runId,
        consumerCwd: run.consumer.checkoutRoot ?? run.consumer.requestedCwd,
        message: text,
      });
    }
    return { queued: true, runId };
  }

  async sessionDecide(runId, body = {}) {
    const run = await this.store.get(runId);
    return this.approveDecision({
      runId,
      consumerCwd: run.consumer.checkoutRoot ?? run.consumer.requestedCwd,
      approved: Boolean(body.approved),
      rationale: typeof body.rationale === "string" ? body.rationale.slice(0, 500) : "",
      approvedBy: "operator",
    });
  }

  async send(input) {
    const parent = await this.getRun(input);
    invariant(parent.state === "succeeded", "AO_RUN_NOT_READY_FOR_FOLLOWUP", "Follow-up requires a successfully completed run.");
    invariant(parent.input.permissionProfile === "read", "AO_WRITE_FOLLOWUP_REQUIRES_NEW_RUN", "Writable persistent-session follow-up is disabled until workspace leases can prevent cross-run cleanup; spawn a new scoped write run instead.");
    invariant(parent.input.sessionMode === "persistent", "AO_FOLLOWUP_UNSUPPORTED", "The parent run used a one-shot session; spawn with sessionMode='persistent' to enable follow-up.");
    const session = parent.sessions.at(-1);
    invariant(session, "AO_SESSION_NOT_FOUND", "Run has no provider session to continue.");
    const provider = getProviderDescriptor(session.providerId ?? session.provider);
    invariant(session.resumeSupported === true && provider?.capabilities?.persistent_session === "supported", "AO_FOLLOWUP_UNSUPPORTED", "The provider did not advertise durable session resumption; refusing to create a discontinuous follow-up.");
    const plan = {
      kind: "execution_plan",
      schemaVersion: 1,
      protocolVersion: PROTOCOL_VERSION,
      protocolId: "followup.v1",
      intent: parent.input.intent,
      status: "ready",
      stages: [{
        stageId: "followup",
        role: "followup",
        dependsOn: [],
        selection: { kind: "persistent_session", parentRunId: parent.runId },
        sessionKey: session.sessionKey,
        route: {
          selected: { agentTarget: session.provider, providerId: session.providerId, modelId: session.model, effort: session.effort },
          candidates: [],
          fallbackPath: [],
        },
      }],
    };
    return this.store.withLock("scheduler", async () => {
      const active = (await this.store.list()).filter((run) => WORKER_STATES.has(run.state));
      invariant(active.length < this.maxConcurrentRuns, "AO_CONCURRENCY_LIMIT", "The global orchestration concurrency limit is reached.", { limit: this.maxConcurrentRuns });
      const providerActive = active.filter((run) => run.plan?.stages?.some((stage) => stage.route?.selected?.providerId === session.providerId));
      invariant(providerActive.length < this.maxConcurrentPerProvider, "AO_PROVIDER_CONCURRENCY_LIMIT", `The concurrency limit for ${session.providerId} is reached.`, { providerId: session.providerId, limit: this.maxConcurrentPerProvider });
      const run = await this.store.create({
        input: { ...parent.input, task: input.message, permissionProfile: "read", timeoutMs: input.timeoutMs ?? parent.input.timeoutMs },
        consumer: parent.consumer,
        plan,
        parentRunId: parent.runId,
      });
      await this.launchWorker(run.runId);
      return { run: await this.store.get(run.runId), parentRunId: parent.runId };
    });
  }

  async cleanup(input) {
    await this.getRun(input);
    return this.store.withLock(`cleanup:${input.runId}`, () => cleanupRun({ store: this.store, runId: input.runId }));
  }

  async decision(input) {
    const run = await this.getRun(input);
    invariant(run.input.intent === "architecture", "AO_NOT_AN_ARCHITECTURE_DECISION", "Only architecture runs produce an adversarial decision record.");
    return {
      runId: run.runId,
      protocol: run.plan.protocol ?? run.plan.protocolId,
      state: run.decision?.state ?? "pending_review",
      evidence: run.outputs,
      approval: run.decision?.approval ?? null,
    };
  }

  async approveDecision(input) {
    const decision = await this.decision(input);
    const current = await this.getRun(input);
    invariant(current.state === "waiting_for_decision", "AO_DECISION_NOT_WAITING", "Only a completed adversarial gate waiting for human review can be approved or rejected.");
    const requiredStages = new Set(["proposal", "critique", "revision", "decision_gate"]);
    for (const output of current.outputs) requiredStages.delete(output.stageId);
    invariant(requiredStages.size === 0 && current.decision?.requiresHumanApproval === true, "AO_DECISION_EVIDENCE_INCOMPLETE", "Architecture decision evidence is incomplete.", { missingStages: [...requiredStages] });
    const approval = { state: input.approved ? "approved" : "rejected", rationale: input.rationale, by: input.approvedBy, at: new Date().toISOString() };
    const nextDecision = { ...current.decision, state: approval.state, approval };
    const run = await this.store.transition(input.runId, ["waiting_for_decision"], input.approved ? "succeeded" : "rejected", { decision: nextDecision }, "decision_reviewed");
    return { runId: run.runId, decision: run.decision, evidence: decision.evidence };
  }

  async doctor() {
    const providerExecutables = Object.values(PROVIDER_ADAPTERS).map((adapter) => [adapter.providerId, adapter.executable]);
    const executableChecks = await Promise.all([
      ...providerExecutables, ["git", "git"], ["bwrap", "bwrap"], ["slirp4netns", "slirp4netns"], ["systemd-run", "systemd-run"], ["prlimit", "prlimit"],
    ].map(async ([id, command]) => {
      try {
        const { stdout } = await runFile("/usr/bin/which", ["-a", command], { timeoutMs: 5_000 });
        const discovered = [...new Set(stdout.split("\n").filter(Boolean))];
        const paths = PROVIDER_ADAPTERS[id]
          ? await discoverProviderPaths(this.pluginRoot, PROVIDER_ADAPTERS[id], discovered)
          : discovered;
        return { id, command, ok: paths.length > 0, path: paths[0], paths };
      } catch (error) {
        return { id, command, ok: false, error: error.message };
      }
    }));
    const supervisorUnit = newId("agent-orchestration-doctor").replaceAll("_", "-");
    const supervisor = await runUserManagerFile("/usr/bin/systemd-run", ["--user", "--wait", "--collect", "--quiet", `--unit=${supervisorUnit}`, "/usr/bin/true"], { timeoutMs: 10_000 })
      .then(() => ({ ok: true, kind: "systemd-user-cgroup" }), (error) => ({ ok: false, kind: "systemd-user-cgroup", error: error.message }));
    const providerProbes = await Promise.all(PROVIDER_CATALOG.map(async (provider) => {
      const executable = executableChecks.find((entry) => entry.id === provider.providerId);
      if (!executable?.ok) return { id: provider.providerId, ready: false, reason: "executable_not_found" };
      let authenticationReady = false;
      let selectedExecutable = null;
      let sessionProbe = null;
      for (const candidate of executable.paths) {
        try {
          const unitName = newId(`agent-orchestration-probe-${provider.providerId}`).replaceAll("_", "-");
          const { stdout } = await runUserManagerFile("/usr/bin/systemd-run", [
            "--user", "--scope", "--collect", "--quiet", `--unit=${unitName}`,
            "--property=RuntimeMaxSec=10s", "--property=TimeoutStopSec=2s", "--property=KillMode=control-group",
            "--property=MemoryMax=2G", "--property=TasksMax=128",
            "/usr/bin/prlimit", "--core=0", "--fsize=268435456", "--",
            process.execPath, join(this.pluginRoot, "dist", "probe-worker.cjs"),
            this.pluginRoot, this.stateRoot, this.pluginRoot, provider.providerId, candidate,
          ], { timeoutMs: 15_000 });
          sessionProbe = JSON.parse(stdout);
          if (!sessionProbe?.ok) continue;
          authenticationReady = true;
          selectedExecutable = candidate;
          break;
        } catch (error) {
          sessionProbe = { ok: false, error: error.message };
        }
      }
      const ready = authenticationReady && sessionProbe?.ok === true;
      return { id: provider.providerId, ready, reason: ready ? "provider_authentication_and_acp_session_passed" : "provider_authentication_entitlement_or_acp_session_unavailable", selectedExecutable, sessionProbe };
    }));
    const bridges = await checkBundledBridges(this.pluginRoot);
    return {
      ok: executableChecks.find((entry) => entry.id === "git")?.ok === true
        && executableChecks.find((entry) => entry.id === "bwrap")?.ok === true
        && executableChecks.find((entry) => entry.id === "slirp4netns")?.ok === true
        && executableChecks.find((entry) => entry.id === "systemd-run")?.ok === true
        && executableChecks.find((entry) => entry.id === "prlimit")?.ok === true
        && supervisor.ok
        && bridges.every((entry) => entry.ok),
      pluginRoot: this.pluginRoot,
      stateRoot: this.stateRoot,
      executables: executableChecks,
      providerProbes,
      supervisor,
      bundledBridges: bridges,
      availability: this.availabilityFromProbes(executableChecks, providerProbes),
      note: "Provider authentication remains owned by each provider CLI and is never read or logged by this plugin.",
    };
  }

  availabilityFromProbes(checks, probes) {
    const providerState = Object.fromEntries(PROVIDER_CATALOG.map((provider) => {
      const check = checks.find((entry) => entry.id === provider.providerId);
      const probe = probes.find((entry) => entry.id === provider.providerId);
      return [provider.providerId, !check?.ok || probe?.ready === false ? "unavailable" : probe?.ready === true ? "available" : "unknown"];
    }));
    return {
      providers: providerState,
      endpoints: Object.fromEntries(MODEL_CATALOG.map((model) => [model.endpointId, providerState[model.providerId] ?? "unknown"])),
      providerExecutables: Object.fromEntries(probes.filter((probe) => probe.ready && probe.selectedExecutable).map((probe) => [probe.id, probe.selectedExecutable])),
      confidence: "transport-probe; model acceptance is revalidated during ACP session creation",
    };
  }

  async providerAvailabilitySnapshot() {
    if (this.availabilityCache && Date.now() - this.availabilityCache.at < 30_000) return this.availabilityCache.value;
    const doctor = await this.doctor();
    this.availabilityCache = { at: Date.now(), value: doctor.availability };
    return doctor.availability;
  }
}
