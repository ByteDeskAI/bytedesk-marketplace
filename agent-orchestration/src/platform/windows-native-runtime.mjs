import { spawn } from "node:child_process";
import { join } from "node:path";
import { access } from "node:fs/promises";
import { AgentOrchestrationError, invariant } from "../errors.mjs";
import { newId, runFile } from "../util.mjs";
import { WindowsExecutableResolver } from "./executable-resolvers.mjs";
import { PlatformRuntime, PlatformRuntimeFactory, ProviderSandboxStrategy, WorkerSupervisorStrategy } from "./contracts.mjs";

export class WindowsNativeHelperAdapter {
  constructor({ pluginRoot, runner = runFile, executable = "dotnet" } = {}) {
    this.helperPath = join(pluginRoot, "dist", "windows-native", "AgentOrchestration.Windows.dll");
    this.executable = executable;
    this.runner = runner;
  }

  args(command, args = []) {
    return [this.helperPath, command, ...args];
  }

  async available() {
    return access(this.helperPath).then(() => true, () => false);
  }

  async runJson(command, args = [], options = {}) {
    invariant(await this.available(), "AO_WINDOWS_HELPER_MISSING", "The native Windows isolation helper is not installed.", { helperPath: this.helperPath });
    const { stdout } = await this.runner(this.executable, this.args(command, args), options);
    return stdout ? JSON.parse(stdout) : {};
  }

  spawn(command, args = [], options = {}) {
    return spawn(this.executable, this.args(command, args), { windowsHide: true, shell: false, ...options });
  }
}

export class WindowsAppContainerSandboxStrategy extends ProviderSandboxStrategy {
  constructor({ helper }) {
    super();
    this.helper = helper;
  }

  get requiredExecutables() {
    return Object.freeze([Object.freeze({ id: "dotnet", command: "dotnet" })]);
  }

  async probe() {
    try {
      const result = await this.helper.runJson("doctor");
      return { ok: result.appContainer === true, kind: "windows-appcontainer", helper: this.helper.helperPath, ...result };
    } catch (error) {
      return { ok: false, kind: "windows-appcontainer", helper: this.helper.helperPath, error: error.message };
    }
  }
}

export class WindowsJobObjectSupervisorStrategy extends WorkerSupervisorStrategy {
  constructor({ helper }) {
    super();
    this.helper = helper;
  }

  get requiredExecutables() {
    return Object.freeze([Object.freeze({ id: "dotnet", command: "dotnet" })]);
  }

  validateJobName(value) {
    invariant(/^Local\\ByteDesk-Agent-Orchestration-[A-Za-z0-9-]+$/.test(value || ""), "AO_UNSAFE_SUPERVISOR_UNIT", "Refusing to operate on an untrusted Windows Job Object name.");
    return value;
  }

  async isAlive(worker) {
    if (!worker?.supervisorUnit) return false;
    try {
      return (await this.helper.runJson("exists", ["--job", this.validateJobName(worker.supervisorUnit)], { timeoutMs: 5_000 })).exists === true;
    } catch { return false; }
  }

  async terminate(worker) {
    if (!worker?.supervisorUnit) return true;
    try {
      return (await this.helper.runJson("terminate", ["--job", this.validateJobName(worker.supervisorUnit)], { timeoutMs: 10_000 })).terminated === true;
    } catch { return false; }
  }

  async waitForRegistration({ runId, supervisorUnit, child, launchState, store, terminalStates, timeoutMs = 10_000 }) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if (launchState.error) throw new AgentOrchestrationError("AO_WORKER_LAUNCH_FAILED", "The Windows Job Object supervisor failed before registration.", { cause: launchState.error.message });
      const run = await store.get(runId);
      if (run.worker?.attachedAt) {
        invariant(await this.isAlive(run.worker), "AO_WORKER_REGISTRATION_LOST", "The registered Windows worker Job Object disappeared before startup acknowledgement.");
        return run;
      }
      if (terminalStates.has(run.state)) throw new AgentOrchestrationError("AO_WORKER_REGISTRATION_MISSING", "The run terminated before its worker acknowledged the Windows Job Object.");
      if (launchState.exited) throw new AgentOrchestrationError("AO_WORKER_LAUNCH_FAILED", "The Windows Job Object supervisor exited before the worker registered.", launchState.exited);
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    throw new AgentOrchestrationError("AO_WORKER_REGISTRATION_TIMEOUT", "Timed out waiting for the worker to register in its Windows Job Object.", { supervisorUnit, launcherPid: child.pid });
  }

  async launch({ runId, pluginRoot, stateRoot, workerEntrypoint, store, terminalStates, onLaunchFailure }) {
    const supervisorUnit = `Local\\ByteDesk-Agent-Orchestration-${runId.replaceAll("_", "-")}`;
    const logDir = join(stateRoot, "logs");
    const launchState = { error: null, exited: null };
    let child;
    try {
      child = this.helper.spawn("supervise", [
        "--job", supervisorUnit,
        "--stdout", join(logDir, `${runId}.out.log`),
        "--stderr", join(logDir, `${runId}.err.log`),
        "--memory-bytes", String(8 * 1024 * 1024 * 1024),
        "--process-limit", "512",
        "--runtime-ms", String(8 * 60 * 60 * 1000),
        "--", process.execPath, workerEntrypoint, "worker", "--state-root", stateRoot, "--run-id", runId,
      ], {
        cwd: pluginRoot,
        env: { ...process.env, AGENT_ORCHESTRATION_STATE_HOME: stateRoot, AGENT_ORCHESTRATION_CURRENT_WORKER_RUN_ID: runId },
        detached: false,
        stdio: "ignore",
      });
      child.on("error", (error) => { launchState.error = error; });
      child.on("exit", (code, signal) => { launchState.exited = { code, signal }; });
      await new Promise((resolveSpawn, rejectSpawn) => {
        child.once("spawn", resolveSpawn);
        child.once("error", rejectSpawn);
      });
      child.unref();
      await store.update(runId, { worker: { pid: child.pid, processGroup: null, startIdentity: supervisorUnit, supervisorUnit, supervisorKind: "windows-job-object", startedAt: new Date().toISOString() } }, "worker_started");
      return await this.waitForRegistration({ runId, supervisorUnit, child, launchState, store, terminalStates });
    } catch (error) {
      await onLaunchFailure?.(supervisorUnit, error).catch(() => {});
      throw error;
    }
  }

  async attach({ runId, store, terminalStates }) {
    const deadline = Date.now() + 5_000;
    let run = await store.get(runId);
    while (!run.worker?.supervisorUnit && !terminalStates.has(run.state) && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 25));
      run = await store.get(runId);
    }
    if (terminalStates.has(run.state)) return run;
    const result = await this.helper.runJson("contains", ["--job", this.validateJobName(run.worker?.supervisorUnit), "--pid", String(process.pid)], { timeoutMs: 5_000 });
    invariant(result.contains === true, "AO_WORKER_REGISTRATION_MISSING", "The worker refused to execute outside its registered Windows Job Object.");
    return store.update(runId, { worker: { ...run.worker, pid: process.pid, startIdentity: run.worker.supervisorUnit, attachedAt: new Date().toISOString() } }, "worker_attached_to_supervisor");
  }

  async probe() {
    try {
      const result = await this.helper.runJson("doctor", [], { timeoutMs: 10_000 });
      return { ok: result.jobObjects === true, kind: "windows-job-object", helper: this.helper.helperPath, ...result };
    } catch (error) {
      return { ok: false, kind: "windows-job-object", helper: this.helper.helperPath, error: error.message };
    }
  }

  async runProbe({ pluginRoot, stateRoot, providerId, candidate }) {
    const job = `Local\\ByteDesk-Agent-Orchestration-${newId(`probe-${providerId}`).replaceAll("_", "-")}`;
    return this.helper.runJson("run", [
      "--job", job, "--memory-bytes", String(2 * 1024 * 1024 * 1024), "--process-limit", "128", "--runtime-ms", "30000", "--",
      process.execPath, join(pluginRoot, "dist", "probe-worker.cjs"), pluginRoot, stateRoot, pluginRoot, providerId, candidate,
    ], { timeoutMs: 40_000 });
  }
}

export class WindowsNativeRuntimeFactory extends PlatformRuntimeFactory {
  supports({ platform = process.platform, backend = process.env.AGENT_ORCHESTRATION_RUNTIME_BACKEND } = {}) {
    return platform === "win32" && (!backend || backend === "windows-native");
  }

  create({ pluginRoot }) {
    const helper = new WindowsNativeHelperAdapter({ pluginRoot });
    return new PlatformRuntime({
      id: "windows-native",
      hostPlatform: "win32",
      executableResolver: new WindowsExecutableResolver(),
      workerSupervisor: new WindowsJobObjectSupervisorStrategy({ helper }),
      providerSandbox: new WindowsAppContainerSandboxStrategy({ helper }),
      metadata: { isolation: "appcontainer", supervision: "windows-job-object" },
    });
  }
}
