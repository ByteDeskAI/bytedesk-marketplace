import { open, readFile } from "node:fs/promises";
import { join } from "node:path";
import { AgentOrchestrationError, invariant } from "../errors.mjs";
import { ensurePrivateDir, newId, processGroupExists, processStartIdentity, waitForProcessGroupExit } from "../util.mjs";
import { runUserManagerFile, spawnUserManagerFile } from "../runtime/user-bus.mjs";
import { LinuxExecutableResolver } from "./executable-resolvers.mjs";
import { PlatformRuntime, PlatformRuntimeFactory, ProviderSandboxStrategy, WorkerSupervisorStrategy } from "./contracts.mjs";

export class BubblewrapSandboxStrategy extends ProviderSandboxStrategy {
  get requiredExecutables() {
    return Object.freeze([
      Object.freeze({ id: "bwrap", command: "bwrap" }),
      Object.freeze({ id: "slirp4netns", command: "slirp4netns" }),
    ]);
  }

  async probe({ checks }) {
    const missing = this.requiredExecutables.filter(({ id }) => !checks.find((entry) => entry.id === id)?.ok).map(({ id }) => id);
    return { ok: missing.length === 0, kind: "bubblewrap-slirp4netns", missing };
  }
}

export class SystemdWorkerSupervisorStrategy extends WorkerSupervisorStrategy {
  get requiredExecutables() {
    return Object.freeze([
      Object.freeze({ id: "systemd-run", command: "systemd-run" }),
      Object.freeze({ id: "prlimit", command: "prlimit" }),
    ]);
  }

  async isAlive(worker) {
    if (worker?.supervisorUnit) {
      const { stdout } = await runUserManagerFile("/usr/bin/systemctl", ["--user", "show", worker.supervisorUnit, "--property=LoadState", "--property=ActiveState"], { timeoutMs: 5_000 }).catch(() => ({ stdout: "" }));
      const state = Object.fromEntries(stdout.split("\n").filter(Boolean).map((line) => line.split(/=(.*)/s).slice(0, 2)));
      return state.LoadState === "loaded" && state.ActiveState === "active";
    }
    const identity = worker?.pid ? await processStartIdentity(worker.pid) : null;
    return Boolean(identity && identity === worker?.startIdentity);
  }

  async terminate(worker) {
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
    if (!identity || identity !== worker.startIdentity) return false;
    try { process.kill(-worker.processGroup, "SIGTERM"); } catch (error) { if (error?.code !== "ESRCH") throw error; }
    if (!await waitForProcessGroupExit(worker.processGroup, 2_000)) {
      try { process.kill(-worker.processGroup, "SIGKILL"); } catch (error) { if (error?.code !== "ESRCH") throw error; }
    }
    return waitForProcessGroupExit(worker.processGroup, 2_000);
  }

  async waitForRegistration({ runId, supervisorUnit, child, launchState, store, terminalStates, timeoutMs = 10_000 }) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if (launchState.error) throw new AgentOrchestrationError("AO_WORKER_LAUNCH_FAILED", "The worker supervisor failed before registration.", { cause: launchState.error.message });
      const run = await store.get(runId);
      if (run.worker?.attachedAt) {
        if (terminalStates.has(run.state)) return run;
        const identity = await processStartIdentity(run.worker.pid);
        invariant(identity && identity === run.worker.startIdentity, "AO_WORKER_REGISTRATION_LOST", "The registered worker disappeared before startup acknowledgement.");
        const scope = await runUserManagerFile("/usr/bin/systemctl", ["--user", "show", supervisorUnit, "--property=LoadState", "--property=ActiveState", "--property=ControlGroup"], { timeoutMs: 2_000 }).catch(() => null);
        const properties = scope && Object.fromEntries(scope.stdout.split("\n").filter(Boolean).map((line) => line.split(/=(.*)/s).slice(0, 2)));
        if (properties?.LoadState === "loaded" && properties.ActiveState === "active" && properties.ControlGroup) return run;
      }
      if (terminalStates.has(run.state)) throw new AgentOrchestrationError("AO_WORKER_REGISTRATION_MISSING", "The run terminated before its worker acknowledged the supervisor scope.");
      if (launchState.exited) throw new AgentOrchestrationError("AO_WORKER_LAUNCH_FAILED", "systemd-run exited before the worker registered.", launchState.exited);
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    throw new AgentOrchestrationError("AO_WORKER_REGISTRATION_TIMEOUT", "Timed out waiting for the worker to register in its named supervisor scope.", { supervisorUnit, launcherPid: child.pid });
  }

  async launch({ runId, pluginRoot, stateRoot, workerEntrypoint, store, terminalStates, onLaunchFailure }) {
    const logDir = await ensurePrivateDir(join(stateRoot, "logs"));
    const unitBase = `agent-orchestration-run-${runId.replaceAll("_", "-")}`;
    const supervisorUnit = `${unitBase}.scope`;
    const args = [
      "--user", "--scope", "--collect", "--quiet", `--unit=${unitBase}`,
      "--property=KillMode=control-group", "--property=TimeoutStopSec=3s", "--property=RuntimeMaxSec=8h",
      "--property=MemoryMax=8G", "--property=TasksMax=512",
      "/usr/bin/prlimit", "--core=0", "--fsize=1073741824", "--",
      process.execPath, workerEntrypoint, "worker", "--state-root", stateRoot, "--run-id", runId,
    ];
    const stdout = await open(join(logDir, `${runId}.out.log`), "a", 0o600);
    const stderr = await open(join(logDir, `${runId}.err.log`), "a", 0o600);
    let child;
    const launchState = { error: null, exited: null };
    try {
      child = await spawnUserManagerFile("/usr/bin/systemd-run", args, {
        cwd: pluginRoot,
        env: { ...process.env, AGENT_ORCHESTRATION_STATE_HOME: stateRoot, AGENT_ORCHESTRATION_CURRENT_WORKER_RUN_ID: runId },
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
      await store.update(runId, { worker: { pid: child.pid, processGroup: null, startIdentity, supervisorUnit, supervisorKind: "systemd-user-cgroup", startedAt: new Date().toISOString() } }, "worker_started");
      return await this.waitForRegistration({ runId, supervisorUnit, child, launchState, store, terminalStates });
    } catch (error) {
      await onLaunchFailure?.(supervisorUnit, error).catch(() => {});
      throw error;
    } finally {
      await stdout.close().catch(() => {});
      await stderr.close().catch(() => {});
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
    const { stdout: controlGroup } = await runUserManagerFile("/usr/bin/systemctl", ["--user", "show", run.worker?.supervisorUnit, "--property=ControlGroup", "--value"], { timeoutMs: 5_000 });
    const ownCgroups = await readFile("/proc/self/cgroup", "utf8");
    invariant(controlGroup && ownCgroups.includes(controlGroup), "AO_WORKER_REGISTRATION_MISSING", "The worker refused to execute outside its registered supervisor cgroup.");
    return store.update(runId, { worker: { ...run.worker, pid: process.pid, startIdentity: await processStartIdentity(process.pid), attachedAt: new Date().toISOString() } }, "worker_attached_to_supervisor");
  }

  async probe() {
    const supervisorUnit = newId("agent-orchestration-doctor").replaceAll("_", "-");
    return runUserManagerFile("/usr/bin/systemd-run", ["--user", "--wait", "--collect", "--quiet", `--unit=${supervisorUnit}`, "/usr/bin/true"], { timeoutMs: 10_000 })
      .then(() => ({ ok: true, kind: "systemd-user-cgroup" }), (error) => ({ ok: false, kind: "systemd-user-cgroup", error: error.message }));
  }

  async runProbe({ pluginRoot, stateRoot, providerId, candidate }) {
    const unitName = newId(`agent-orchestration-probe-${providerId}`).replaceAll("_", "-");
    const { stdout } = await runUserManagerFile("/usr/bin/systemd-run", [
      "--user", "--scope", "--collect", "--quiet", `--unit=${unitName}`,
      "--property=RuntimeMaxSec=10s", "--property=TimeoutStopSec=2s", "--property=KillMode=control-group",
      "--property=MemoryMax=2G", "--property=TasksMax=128",
      "/usr/bin/prlimit", "--core=0", "--fsize=268435456", "--",
      process.execPath, join(pluginRoot, "dist", "probe-worker.cjs"),
      pluginRoot, stateRoot, pluginRoot, providerId, candidate,
    ], { timeoutMs: 15_000 });
    return JSON.parse(stdout);
  }
}

export class LinuxRuntimeFactory extends PlatformRuntimeFactory {
  supports({ platform = process.platform, backend = process.env.AGENT_ORCHESTRATION_RUNTIME_BACKEND } = {}) {
    return platform !== "win32" || backend === "linux-native";
  }

  create() {
    return new PlatformRuntime({
      id: "linux-native",
      hostPlatform: process.env.AGENT_ORCHESTRATION_HOST_PLATFORM || process.platform,
      executableResolver: new LinuxExecutableResolver(),
      workerSupervisor: new SystemdWorkerSupervisorStrategy(),
      providerSandbox: new BubblewrapSandboxStrategy(),
      metadata: { isolation: "bubblewrap", supervision: "systemd-user-cgroup" },
    });
  }
}
