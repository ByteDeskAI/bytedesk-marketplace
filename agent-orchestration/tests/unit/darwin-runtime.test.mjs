// TM-273: macOS has no systemd, cgroups, prlimit or /proc. These tests prove the darwin selection
// by injected platform, and exercise the plain-POSIX process-group backend for real on this host:
// it uses only Node, /bin/sh and process groups, so it runs the same on Linux and macOS.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { chmod, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { createPlatformRuntime } from "../../src/platform/factory.mjs";
import { DirectHostAdapter, createHostAdapter } from "../../src/platform/host-adapters.mjs";
import { ProcessGroupSupervisorStrategy, processGroupWatchdogCommand } from "../../src/platform/process-group-runtime.mjs";
import { OrchestrationService } from "../../src/service.mjs";
import { sessionSupervisorEnabled } from "../../src/session/supervisor.mjs";
import { processGroupExists, processStartIdentity, runFile } from "../../src/util.mjs";

const SRC = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "src");
const TERMINAL = new Set(["completed", "failed", "cancelled"]);

function pidAlive(pid) {
  try { process.kill(pid, 0); return true; } catch (error) { return error.code === "EPERM"; }
}

async function waitFor(predicate, timeoutMs = 5_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = await predicate();
    if (value) return value;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  return predicate();
}

// A run store both the test and the detached worker can read: one JSON file.
const STORE_MODULE = `
import { readFile, writeFile, rename } from "node:fs/promises";
export function fileStore(path) {
  const get = async () => JSON.parse(await readFile(path, "utf8"));
  return {
    get,
    async update(_runId, patch) {
      const next = { ...(await get()), ...patch };
      await writeFile(path + ".tmp", JSON.stringify(next));
      await rename(path + ".tmp", path);
      return next;
    },
  };
}
`;

async function workerFixture(root) {
  await writeFile(join(root, "store.mjs"), STORE_MODULE);
  const worker = join(root, "worker.mjs");
  // argv: worker --state-root <root> --run-id <id>. Attaches, then leaves a grandchild in its group.
  await writeFile(worker, `
import { spawn } from "node:child_process";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { ProcessGroupSupervisorStrategy } from ${JSON.stringify(join(SRC, "platform", "process-group-runtime.mjs"))};
import { fileStore } from "./store.mjs";
const stateRoot = process.argv[4];
const runId = process.argv[6];
await new ProcessGroupSupervisorStrategy().attach({ runId, store: fileStore(join(stateRoot, "run.json")), terminalStates: new Set(["completed", "failed", "cancelled"]) });
const grandchild = spawn("sleep", ["300"], { stdio: "ignore" });
await writeFile(join(stateRoot, "grandchild.pid"), String(grandchild.pid));
console.log("worker attached");
setInterval(() => {}, 1_000);
`);
  return worker;
}

test("platform darwin selects the darwin process-group backend, with no systemd checks", async () => {
  const original = process.env.AGENT_ORCHESTRATION_RUNTIME_BACKEND;
  delete process.env.AGENT_ORCHESTRATION_RUNTIME_BACKEND;
  try {
    const runtime = createPlatformRuntime({ platform: "darwin", pluginRoot: "/plugin", stateRoot: "/state" });
    assert.deepEqual(runtime.describe(), {
      id: "darwin-native",
      hostPlatform: "darwin",
      sandbox: "UnavailableSandboxStrategy",
      supervisor: "ProcessGroupSupervisorStrategy",
      executableResolver: "LinuxExecutableResolver",
      isolation: "unavailable",
      supervision: "posix-process-group",
    });
    // doctor's infrastructure list: nothing systemd, prlimit or bwrap is looked for on darwin.
    assert.deepEqual([...runtime.workerSupervisor.requiredExecutables, ...runtime.providerSandbox.requiredExecutables], []);
    const sandbox = await runtime.providerSandbox.probe({ checks: [] });
    assert.equal(sandbox.ok, false);
    assert.equal(sandbox.kind, "unavailable");
    assert.match(sandbox.reason, /refused rather than run unsandboxed/);
    // Linux is unchanged by the same selector.
    assert.equal(createPlatformRuntime({ platform: "linux", pluginRoot: "/plugin", stateRoot: "/state" }).id, "linux-native");
  } finally {
    if (original === undefined) delete process.env.AGENT_ORCHESTRATION_RUNTIME_BACKEND;
    else process.env.AGENT_ORCHESTRATION_RUNTIME_BACKEND = original;
  }
});

test("the darwin host adapter hands the server the darwin backend; Linux keeps linux-native", async () => {
  const darwin = await createHostAdapter({ platform: "darwin", env: {} });
  assert.ok(darwin instanceof DirectHostAdapter);
  assert.equal(darwin.id, "darwin-native");
  assert.equal((await darwin.command("/plugin/dist/mcp.cjs")).env.AGENT_ORCHESTRATION_RUNTIME_BACKEND, "darwin-native");
  assert.equal((await createHostAdapter({ platform: "linux", env: {} })).id, "linux-native");
  assert.equal(sessionSupervisorEnabled({ platform: "darwin", env: {} }), false);
});

test("spawn refuses a run on a host without provider isolation, naming the reason", async () => {
  const platformRuntime = createPlatformRuntime({ platform: "darwin", backend: "darwin-native" });
  let doctorCalled = false;
  const service = { platformRuntime, providerAvailabilitySnapshot: async () => { doctorCalled = true; return {}; } };
  await assert.rejects(OrchestrationService.prototype.spawn.call(service, { consumerCwd: "/repo", task: "x" }), (error) => {
    assert.equal(error.code, "AO_SANDBOX_UNAVAILABLE");
    assert.match(error.message, /darwin/);
    return true;
  });
  assert.equal(doctorCalled, false, "the refusal comes before any provider discovery");
});

test("darwin start identity comes from ps lstart in the C locale, never /proc", async () => {
  const root = await mkdtemp(join(os.tmpdir(), "ao-darwin-ps-"));
  const originalPath = process.env.PATH;
  try {
    const log = join(root, "ps.log");
    await writeFile(join(root, "ps"), `#!/bin/sh\nprintf '%s|LC_ALL=%s\\n' "$*" "$LC_ALL" >> ${JSON.stringify(log)}\necho 'Wed Oct  1 10:00:00 2026'\n`);
    await chmod(join(root, "ps"), 0o755);
    process.env.PATH = `${root}:${originalPath}`;
    assert.equal(await processStartIdentity(process.pid, { platform: "darwin" }), "Wed Oct  1 10:00:00 2026");
    const calls = (await readFile(log, "utf8")).trim().split("\n");
    assert.deepEqual(calls, [`-p ${process.pid} -o lstart=|LC_ALL=C`]);
    // The Linux path reads /proc and must not reach ps at all.
    const linuxIdentity = await processStartIdentity(process.pid, { platform: "linux" });
    assert.match(linuxIdentity, /^\d+$/);
    assert.equal((await readFile(log, "utf8")).trim().split("\n").length, 1, "ps was called on the Linux path");
  } finally {
    process.env.PATH = originalPath;
    await rm(root, { recursive: true, force: true });
  }
});

test("process-group backend launches, proves liveness, and cancel stops the whole group", { timeout: 30_000 }, async () => {
  const root = await mkdtemp(join(os.tmpdir(), "ao-darwin-run-"));
  const supervisor = new ProcessGroupSupervisorStrategy({ workerLimitMs: 60_000 });
  let worker = null;
  try {
    const workerEntrypoint = await workerFixture(root);
    const runId = "run_tm273";
    await writeFile(join(root, "run.json"), JSON.stringify({ runId, state: "running", worker: null }));
    const { fileStore } = await import(join(root, "store.mjs"));
    const store = fileStore(join(root, "run.json"));
    let launchFailure = null;
    const run = await supervisor.launch({ runId, pluginRoot: root, stateRoot: root, workerEntrypoint, store, terminalStates: TERMINAL, onLaunchFailure: async (_unit, error) => { launchFailure = error; } });
    worker = run.worker;
    assert.equal(launchFailure, null);
    assert.ok(worker.attachedAt, "the worker registered");
    assert.equal(worker.supervisorKind, "posix-process-group");
    assert.equal(worker.processGroup, worker.pid, "the worker leads its own group");
    assert.notEqual(worker.launcherPid, worker.pid, "the watchdog is outside the group it polices");
    assert.equal(await supervisor.isAlive(worker), true);
    assert.equal(processGroupExists(worker.processGroup), true);
    const grandchild = Number(await waitFor(() => readFile(join(root, "grandchild.pid"), "utf8").catch(() => null)));
    assert.ok(grandchild > 0 && pidAlive(grandchild), "a descendant is running in the group");
    assert.equal(await supervisor.isAlive({ ...worker, startIdentity: "someone else" }), false, "a recycled pid is not our worker");
    assert.equal(await supervisor.terminate({ ...worker, startIdentity: "someone else" }), false, "never signal a group we cannot prove is ours");
    assert.equal(processGroupExists(worker.processGroup), true);

    assert.equal(await supervisor.terminate(worker), true);
    assert.equal(processGroupExists(worker.processGroup), false);
    assert.equal(pidAlive(worker.pid), false);
    assert.equal(pidAlive(grandchild), false, "the grandchild went with the group");
    assert.equal(await waitFor(() => !pidAlive(worker.launcherPid)), true, "the watchdog exits once its group is gone");
    assert.equal(await supervisor.isAlive(worker), false);
    assert.match(await readFile(join(root, "logs", `${runId}.out.log`), "utf8"), /worker attached/);
    assert.equal((await stat(join(root, "logs", `${runId}.out.log`))).mode & 0o777, 0o600);
  } finally {
    if (worker?.processGroup) { try { process.kill(-worker.processGroup, "SIGKILL"); } catch {} }
    await rm(root, { recursive: true, force: true });
  }
});

test("the watchdog enforces the runtime limit, escalating to SIGKILL for a group that ignores SIGTERM", { timeout: 30_000 }, async () => {
  const root = await mkdtemp(join(os.tmpdir(), "ao-darwin-timeout-"));
  let pids = [];
  try {
    const pidFile = join(root, "pids");
    const watchdog = processGroupWatchdogCommand({
      limitMs: 300, graceMs: 300, fileSizeBytes: 1024,
      command: ["/bin/sh", "-c", `trap '' TERM; sleep 300 & echo $$ $! > ${JSON.stringify(pidFile)}; wait`],
    });
    const started = Date.now();
    const child = spawn(watchdog.executable, watchdog.args, { stdio: ["ignore", "ignore", "pipe"] });
    let stderr = "";
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    pids = (await waitFor(() => readFile(pidFile, "utf8").catch(() => null))).trim().split(" ").map(Number);
    assert.equal(pids.length, 2);
    assert.ok(pids.every(pidAlive), "both group members started");
    const [code] = await once(child, "exit");
    const elapsed = Date.now() - started;
    assert.equal(code, 124, "the watchdog reports a timeout");
    assert.ok(elapsed >= 300 && elapsed < 5_000, `stopped near the limit, took ${elapsed}ms`);
    assert.match(stderr, /runtime limit of 300ms reached/);
    assert.equal(await waitFor(() => pids.every((pid) => !pidAlive(pid))), true, "a TERM-ignoring group still dies");
  } finally {
    for (const pid of pids) { try { process.kill(pid, "SIGKILL"); } catch {} }
    await rm(root, { recursive: true, force: true });
  }
});

test("the watchdog caps core dumps and file size the way prlimit does on Linux", async () => {
  const watchdog = processGroupWatchdogCommand({ limitMs: 10_000, fileSizeBytes: 1_073_741_824, command: ["/bin/sh", "-c", "ulimit -c; ulimit -f"] });
  const { stdout } = await runFile(watchdog.executable, watchdog.args, { timeoutMs: 15_000 });
  assert.deepEqual(stdout.split("\n"), ["0", "2097152"]);
});

test("the process-group doctor probe runs the watchdog for real", async () => {
  assert.deepEqual(await new ProcessGroupSupervisorStrategy().probe(), { ok: true, kind: "posix-process-group" });
});
