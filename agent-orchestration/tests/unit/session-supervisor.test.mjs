import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { OrchestrationService } from "../../src/service.mjs";
import { startSessionHost } from "../../src/session/host.mjs";
import {
  SESSION_SUPERVISOR_UNIT_PATTERN,
  assertSessionSupervisorUnit,
  launchSessionSupervisor,
  sessionHostCliPath,
  sessionSupervisorArgs,
  sessionSupervisorEnabled,
  sessionSupervisorUnit,
  sessionSupervisorUnitBase,
  shouldSuperviseSessionHost,
  waitForSessionHostLease,
} from "../../src/session/supervisor.mjs";

const uiRoot = join(dirname(dirname(dirname(fileURLToPath(import.meta.url)))), "session-ui", "mockup");

function fakeChild() {
  const child = {
    pid: 4242,
    unref() {},
    once(event, callback) {
      if (event === "spawn") queueMicrotask(callback);
      return child;
    },
  };
  return child;
}

test("session supervisor unit names are stable, hashed, and refuse unsafe ids", () => {
  const a = sessionSupervisorUnit("/tmp/ao-state-a");
  const again = sessionSupervisorUnit("/tmp/ao-state-a");
  const b = sessionSupervisorUnit("/tmp/ao-state-b");
  assert.equal(a, again);
  assert.notEqual(a, b);
  assert.match(a, SESSION_SUPERVISOR_UNIT_PATTERN);
  assert.equal(sessionSupervisorUnitBase("/tmp/ao-state-a").startsWith("agent-orchestration-session-"), true);
  assert.doesNotThrow(() => assertSessionSupervisorUnit(a));
  assert.throws(() => assertSessionSupervisorUnit("agent-orchestration-run-x.scope"), { code: "AO_UNSAFE_SUPERVISOR_UNIT" });
  assert.throws(() => assertSessionSupervisorUnit("agent-orchestration-session-not-hex.scope"), { code: "AO_UNSAFE_SUPERVISOR_UNIT" });
  assert.throws(() => sessionSupervisorUnitBase("relative-state"), { code: "AO_UNSAFE_SUPERVISOR_UNIT" });
});

test("session supervisor launch argv is systemd-run, prlimit, and cli session-host", async () => {
  const pluginRoot = "/opt/plugin";
  const stateRoot = "/var/ao-state";
  const cliPath = sessionHostCliPath(pluginRoot);
  const args = sessionSupervisorArgs({ nodePath: "/usr/bin/node", cliPath, stateRoot });
  assert.equal(args[0], "--user");
  assert.equal(args.includes("--scope"), true);
  assert.equal(args.includes("--collect"), true);
  assert.equal(args.includes(`--unit=${sessionSupervisorUnitBase(stateRoot)}`), true);
  assert.equal(args.includes("session-host"), true);
  assert.equal(args.includes("--state-root"), true);
  assert.equal(args.at(-1), stateRoot);
  const prlimitAt = args.indexOf("/usr/bin/prlimit");
  assert.equal(args[prlimitAt + 3], "--");
  assert.equal(args[prlimitAt + 4], "/usr/bin/node");
  assert.equal(args[prlimitAt + 5], cliPath);

  const spawns = [];
  const result = await launchSessionSupervisor({
    pluginRoot,
    stateRoot,
    cliPath,
    nodePath: "/usr/bin/node",
    spawnUserManager: async (command, launchArgs, options) => {
      spawns.push({ command, launchArgs, options });
      return fakeChild();
    },
    openLog: async () => ({ stdout: { fd: 3, close: async () => {} }, stderr: { fd: 4, close: async () => {} } }),
  });
  assert.equal(spawns.length, 1);
  assert.equal(spawns[0].command, "/usr/bin/systemd-run");
  assert.deepEqual(spawns[0].launchArgs, args);
  assert.equal(spawns[0].options.cwd, pluginRoot);
  assert.equal(spawns[0].options.detached, true);
  assert.equal(spawns[0].options.shell, false);
  assert.equal(spawns[0].options.env.AGENT_ORCHESTRATION_STATE_HOME, stateRoot);
  assert.equal(spawns[0].options.env.AGENT_ORCHESTRATION_SESSION_HOST, "1");
  assert.equal(result.supervisorUnit, sessionSupervisorUnit(stateRoot));
  assert.equal(result.child.pid, 4242);
});

test("supervision is off on Windows, inside the session-host process, and when env is 0", async () => {
  assert.equal(sessionSupervisorEnabled({ platform: "win32", env: {} }), false);
  assert.equal(sessionSupervisorEnabled({ platform: "linux", env: { AGENT_ORCHESTRATION_SESSION_HOST: "1" } }), false);
  assert.equal(sessionSupervisorEnabled({ platform: "linux", env: { AGENT_ORCHESTRATION_SESSION_SUPERVISOR: "0" } }), false);
  assert.equal(sessionSupervisorEnabled({ platform: "linux", env: {} }), true);

  const root = await mkdtemp(join(os.tmpdir(), "ao-session-supervisor-gate-"));
  try {
    const pluginRoot = join(root, "plugin");
    await mkdir(join(pluginRoot, "dist"), { recursive: true });
    assert.equal(await shouldSuperviseSessionHost({ pluginRoot, platform: "linux", env: {} }), false);
    await writeFile(join(pluginRoot, "dist", "cli.cjs"), "fixture\n");
    assert.equal(await shouldSuperviseSessionHost({ pluginRoot, platform: "linux", env: {} }), true);
    assert.equal(await shouldSuperviseSessionHost({
      pluginRoot,
      platform: "linux",
      env: { AGENT_ORCHESTRATION_SESSION_SUPERVISOR: "0" },
    }), false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("ensureSessionHost joins a live lease and dispose leaves that listener running", async () => {
  const root = await mkdtemp(join(os.tmpdir(), "ao-session-join-"));
  const stateRoot = join(root, "state");
  const pluginRoot = join(root, "plugin");
  await mkdir(pluginRoot);
  const previous = process.env.AGENT_ORCHESTRATION_SESSION_SUPERVISOR;
  process.env.AGENT_ORCHESTRATION_SESSION_SUPERVISOR = "0";
  const host = await startSessionHost({ stateRoot, uiRoot });
  const service = await new OrchestrationService({
    pluginRoot,
    stateRoot,
    autoRecover: false,
    sessionUiRoot: uiRoot,
  }).initialize();
  try {
    const joined = await service.ensureSessionHost();
    assert.equal(joined.port, host.port);
    assert.equal(joined.hostNonce, host.hostNonce);
    assert.equal(joined.server, undefined);
    await service.dispose();
    const health = await fetch(`http://127.0.0.1:${host.port}/api/health`);
    assert.equal(health.status, 200);
    assert.equal((await health.json()).hostNonce, host.hostNonce);
  } finally {
    process.env.AGENT_ORCHESTRATION_SESSION_SUPERVISOR = previous;
    await host.close();
    await rm(root, { recursive: true, force: true });
  }
});

test("ensureSessionHost listens in-process when dist/cli.cjs is missing", async () => {
  const root = await mkdtemp(join(os.tmpdir(), "ao-session-fallback-"));
  const stateRoot = join(root, "state");
  const pluginRoot = join(root, "plugin");
  await mkdir(pluginRoot);
  const service = await new OrchestrationService({
    pluginRoot,
    stateRoot,
    autoRecover: false,
    sessionUiRoot: uiRoot,
  }).initialize();
  try {
    const host = await service.ensureSessionHost();
    assert.equal(typeof host.port, "number");
    assert.ok(host.server);
    const health = await fetch(`http://127.0.0.1:${host.port}/api/health`);
    assert.equal(health.status, 200);
  } finally {
    await service.dispose();
    await rm(root, { recursive: true, force: true });
  }
});

test("waitForSessionHostLease returns the first successful probe", async () => {
  let calls = 0;
  const live = await waitForSessionHostLease("/tmp/unused", {
    timeoutMs: 1_000,
    intervalMs: 1,
    probe: async () => {
      calls += 1;
      return calls >= 2 ? { port: 45000, hostNonce: "host_x", bind: "127.0.0.1:45000" } : null;
    },
  });
  assert.equal(live.port, 45000);
  assert.equal(calls, 2);
});
