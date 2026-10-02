import { spawn } from "node:child_process";
import { open } from "node:fs/promises";
import { join } from "node:path";
import { AgentOrchestrationError, invariant } from "../errors.mjs";
import { ensurePrivateDir, processGroupExists, processStartIdentity, runFile, waitForProcessGroupExit } from "../util.mjs";
import { LinuxExecutableResolver } from "./executable-resolvers.mjs";
import { PlatformRuntime, PlatformRuntimeFactory, ProviderSandboxStrategy, WorkerSupervisorStrategy } from "./contracts.mjs";

// The same budgets the Linux systemd scopes carry (RuntimeMaxSec, TimeoutStopSec, prlimit).
export const WORKER_RUNTIME_LIMIT_MS = 8 * 60 * 60 * 1000;
export const PROBE_RUNTIME_LIMIT_MS = 30_000;
const STOP_GRACE_MS = 3_000;
const WORKER_FILE_SIZE_BYTES = 1_073_741_824;
const PROBE_FILE_SIZE_BYTES = 268_435_456;

// The watchdog a plain-POSIX host uses in place of a systemd scope. It runs as
// its own detached process, starts the command as the leader of a NEW process
// group (so the watchdog itself is outside the group it polices), and:
//   - kills the whole group at the runtime limit (TERM, then KILL after grace);
//   - forwards TERM/INT/HUP it receives to the group, so stopping the watchdog
//     stops the run;
//   - TERMs whatever is left in the group when the command exits.
// Core dumps and file size are capped through /bin/sh ulimit; POSIX `ulimit -f`
// counts 512-byte blocks in both dash and macOS /bin/sh (bash in POSIX mode).
// ponytail: no memory or task-count cap; macOS has no per-group equivalent of
// MemoryHigh/TasksMax short of a launchd job. Add one there if runs need it.
const WATCHDOG = String.raw`
const { spawn } = require("node:child_process");
const { constants } = require("node:os");
const [limitMs, graceMs, fsizeBlocks, ...command] = process.argv.slice(1);
const child = spawn("/bin/sh", ["-c", 'ulimit -c 0 && ulimit -f "$1" && shift && exec "$@"', "sh", fsizeBlocks, ...command], { detached: true, stdio: "inherit" });
const signalGroup = (signal) => { try { process.kill(-child.pid, signal); } catch {} };
let stopping = false;
const stop = (signal) => {
  signalGroup(signal);
  if (stopping) return;
  stopping = true;
  setTimeout(() => signalGroup("SIGKILL"), Number(graceMs)).unref();
};
let timedOut = false;
const deadline = setTimeout(() => { timedOut = true; stop("SIGTERM"); }, Number(limitMs));
for (const signal of ["SIGTERM", "SIGINT", "SIGHUP"]) process.on(signal, () => stop("SIGTERM"));
child.on("error", (error) => { process.stderr.write("[agent-orchestration-watchdog] " + error.message + "\n"); process.exit(127); });
child.on("exit", (code, signal) => {
  clearTimeout(deadline);
  signalGroup(stopping ? "SIGKILL" : "SIGTERM");
  if (timedOut) process.stderr.write("[agent-orchestration-watchdog] runtime limit of " + limitMs + "ms reached; process group stopped\n");
  process.exit(timedOut ? 124 : code ?? 128 + (constants.signals[signal] ?? 0));
});
`;

export function processGroupWatchdogCommand({ limitMs, graceMs = STOP_GRACE_MS, fileSizeBytes, command }) {
  invariant(Number.isSafeInteger(limitMs) && limitMs > 0, "AO_INVALID_ARGUMENT", "The watchdog runtime limit must be a positive integer.");
  invariant(Array.isArray(command) && command.length > 0, "AO_INVALID_ARGUMENT", "The watchdog needs a command to run.");
  return {
    executable: process.execPath,
    args: ["-e", WATCHDOG, "--", String(limitMs), String(graceMs), String(Math.ceil(fileSizeBytes / 512)), ...command],
  };
}

/**
 * Worker supervision with nothing but POSIX process groups: macOS has no
 * systemd, cgroups or prlimit. A worker is the leader of its own process group,
 * proven by its recorded pid + start identity; terminate signals the group.
 */
export class ProcessGroupSupervisorStrategy extends WorkerSupervisorStrategy {
  constructor({ workerLimitMs = WORKER_RUNTIME_LIMIT_MS, probeLimitMs = PROBE_RUNTIME_LIMIT_MS, graceMs = STOP_GRACE_MS } = {}) {
    super();
    this.workerLimitMs = workerLimitMs;
    this.probeLimitMs = probeLimitMs;
    this.graceMs = graceMs;
  }

  get requiredExecutables() { return Object.freeze([]); }

  async isAlive(worker) {
    const identity = worker?.pid ? await processStartIdentity(worker.pid) : null;
    return Boolean(identity && identity === worker?.startIdentity);
  }

  async terminate(worker) {
    if (!worker?.processGroup || !processGroupExists(worker.processGroup)) return true;
    const identity = worker.pid ? await processStartIdentity(worker.pid) : null;
    if (!identity || identity !== worker.startIdentity) return false;
    try { process.kill(-worker.processGroup, "SIGTERM"); } catch (error) { if (error?.code !== "ESRCH") throw error; }
    if (!await waitForProcessGroupExit(worker.processGroup, 2_000)) {
      try { process.kill(-worker.processGroup, "SIGKILL"); } catch (error) { if (error?.code !== "ESRCH") throw error; }
    }
    return waitForProcessGroupExit(worker.processGroup, 2_000);
  }

  async waitForRegistration({ runId, child, launchState, store, terminalStates, timeoutMs = 10_000 }) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if (launchState.error) throw new AgentOrchestrationError("AO_WORKER_LAUNCH_FAILED", "The worker watchdog failed before registration.", { cause: launchState.error.message });
      const run = await store.get(runId);
      if (run.worker?.attachedAt) {
        if (terminalStates.has(run.state)) return run;
        invariant(await this.isAlive(run.worker), "AO_WORKER_REGISTRATION_LOST", "The registered worker disappeared before startup acknowledgement.");
        return run;
      }
      if (terminalStates.has(run.state)) throw new AgentOrchestrationError("AO_WORKER_REGISTRATION_MISSING", "The run terminated before its worker registered its process group.");
      if (launchState.exited) throw new AgentOrchestrationError("AO_WORKER_LAUNCH_FAILED", "The worker watchdog exited before the worker registered.", launchState.exited);
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    throw new AgentOrchestrationError("AO_WORKER_REGISTRATION_TIMEOUT", "Timed out waiting for the worker to register its process group.", { launcherPid: child.pid });
  }

  /** Spawns the watchdog detached, so it outlives this server, exactly as a systemd scope would. */
  spawnWatchdog({ limitMs, fileSizeBytes, command, cwd, env, stdio }) {
    const watchdog = processGroupWatchdogCommand({ limitMs, graceMs: this.graceMs, fileSizeBytes, command });
    return spawn(watchdog.executable, watchdog.args, { cwd, env, detached: true, stdio, shell: false });
  }

  async launch({ runId, pluginRoot, stateRoot, workerEntrypoint, store, terminalStates, onLaunchFailure }) {
    const logDir = await ensurePrivateDir(join(stateRoot, "logs"));
    const stdout = await open(join(logDir, `${runId}.out.log`), "a", 0o600);
    const stderr = await open(join(logDir, `${runId}.err.log`), "a", 0o600);
    const launchState = { error: null, exited: null };
    let child;
    let launcher = null;
    try {
      child = this.spawnWatchdog({
        limitMs: this.workerLimitMs,
        fileSizeBytes: WORKER_FILE_SIZE_BYTES,
        command: [process.execPath, workerEntrypoint, "worker", "--state-root", stateRoot, "--run-id", runId],
        cwd: pluginRoot,
        env: { ...process.env, AGENT_ORCHESTRATION_STATE_HOME: stateRoot, AGENT_ORCHESTRATION_CURRENT_WORKER_RUN_ID: runId },
        stdio: ["ignore", stdout.fd, stderr.fd],
      });
      child.on("error", (error) => { launchState.error = error; });
      child.on("exit", (code, signal) => { launchState.exited = { code, signal }; });
      await new Promise((resolveSpawn, rejectSpawn) => {
        child.once("spawn", resolveSpawn);
        child.once("error", rejectSpawn);
      });
      child.unref();
      const startIdentity = await processStartIdentity(child.pid);
      invariant(startIdentity, "AO_WORKER_LAUNCH_FAILED", "Could not establish the worker watchdog identity.");
      launcher = { pid: child.pid, startIdentity };
      // processGroup stays null until the worker attaches: the group is the worker's, not the watchdog's.
      await store.update(runId, { worker: { pid: child.pid, processGroup: null, startIdentity, launcherPid: child.pid, launcherStartIdentity: startIdentity, supervisorUnit: null, supervisorKind: "posix-process-group", startedAt: new Date().toISOString() } }, "worker_started");
      return await this.waitForRegistration({ runId, child, launchState, store, terminalStates });
    } catch (error) {
      // TERM to the watchdog is forwarded to the worker group, followed by KILL after the grace period.
      if (launcher && await processStartIdentity(launcher.pid) === launcher.startIdentity) {
        try { process.kill(launcher.pid, "SIGTERM"); } catch {}
      }
      await onLaunchFailure?.(null, error).catch(() => {});
      throw error;
    } finally {
      await stdout.close().catch(() => {});
      await stderr.close().catch(() => {});
    }
  }

  async attach({ runId, store, terminalStates }) {
    const deadline = Date.now() + 5_000;
    let run = await store.get(runId);
    while (!run.worker?.launcherPid && !terminalStates.has(run.state) && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 25));
      run = await store.get(runId);
    }
    if (terminalStates.has(run.state)) return run;
    // A process group whose id is our pid exists only if we lead it; our parent must be the recorded watchdog.
    const launcherIdentity = await processStartIdentity(process.ppid);
    invariant(
      process.ppid === run.worker?.launcherPid && launcherIdentity && launcherIdentity === run.worker.launcherStartIdentity && processGroupExists(process.pid),
      "AO_WORKER_REGISTRATION_MISSING",
      "The worker refused to execute outside its registered watchdog process group.",
    );
    return store.update(runId, { worker: { ...run.worker, pid: process.pid, processGroup: process.pid, startIdentity: await processStartIdentity(process.pid), attachedAt: new Date().toISOString() } }, "worker_attached_to_supervisor");
  }

  async probe() {
    const watchdog = processGroupWatchdogCommand({ limitMs: 10_000, graceMs: this.graceMs, fileSizeBytes: PROBE_FILE_SIZE_BYTES, command: [process.execPath, "-e", ""] });
    return runFile(watchdog.executable, watchdog.args, { timeoutMs: 15_000 })
      .then(() => ({ ok: true, kind: "posix-process-group" }), (error) => ({ ok: false, kind: "posix-process-group", error: error.message }));
  }

  async runProbe({ pluginRoot, stateRoot, providerId, candidate }) {
    const watchdog = processGroupWatchdogCommand({
      limitMs: this.probeLimitMs, graceMs: 2_000, fileSizeBytes: PROBE_FILE_SIZE_BYTES,
      command: [process.execPath, join(pluginRoot, "dist", "probe-worker.cjs"), pluginRoot, stateRoot, pluginRoot, providerId, candidate],
    });
    const { stdout } = await runFile(watchdog.executable, watchdog.args, { timeoutMs: this.probeLimitMs + 10_000 });
    return JSON.parse(stdout);
  }
}

/**
 * The provider sandbox on a host that has none. Every provider run is
 * contracted to execute inside isolation, so this never degrades to running
 * unsandboxed: doctor reports it unavailable and spawn refuses runs.
 */
export class UnavailableSandboxStrategy extends ProviderSandboxStrategy {
  constructor({ platform }) {
    super();
    this.reason = `Provider isolation is not implemented on ${platform}: Bubblewrap is Linux-only and AppContainer is Windows-only. Provider runs are refused rather than run unsandboxed.`;
  }

  async probe() {
    return { ok: false, kind: "unavailable", missing: [], reason: this.reason };
  }
}

export class DarwinRuntimeFactory extends PlatformRuntimeFactory {
  supports({ platform = process.platform, backend = process.env.AGENT_ORCHESTRATION_RUNTIME_BACKEND } = {}) {
    return platform === "darwin" && (!backend || backend === "darwin-native");
  }

  create() {
    return new PlatformRuntime({
      id: "darwin-native",
      hostPlatform: "darwin",
      // `/usr/bin/which -a` ships with macOS, so the Linux resolver serves both.
      executableResolver: new LinuxExecutableResolver(),
      workerSupervisor: new ProcessGroupSupervisorStrategy(),
      providerSandbox: new UnavailableSandboxStrategy({ platform: "darwin" }),
      metadata: { isolation: "unavailable", supervision: "posix-process-group" },
    });
  }
}
