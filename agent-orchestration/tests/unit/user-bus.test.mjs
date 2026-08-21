import assert from "node:assert/strict";
import test from "node:test";
import {
  canonicalUserBusEnvironment,
  runUserManagerFile,
  spawnUserManagerFile,
} from "../../src/runtime/user-bus.mjs";

const uid = 4242;
const runtimeDir = `/run/user/${uid}`;
const busPath = `${runtimeDir}/bus`;

function validFilesystem(overrides = {}) {
  return {
    uid,
    lstat: async (path) => {
      if (path === runtimeDir) {
        return {
          uid,
          mode: overrides.runtimeMode ?? 0o40700,
          isDirectory: () => overrides.runtimeDirectory ?? true,
          isSocket: () => false,
        };
      }
      if (path === busPath) {
        return {
          uid: overrides.busUid ?? uid,
          mode: 0o140666,
          isDirectory: () => false,
          isSocket: () => overrides.busSocket ?? true,
        };
      }
      throw new Error("unexpected path");
    },
    realpath: async (path) => overrides.realpaths?.[path] ?? path,
  };
}

test("missing user-bus variables are recovered from the validated canonical runtime", async () => {
  const environment = await canonicalUserBusEnvironment(
    { PATH: "/usr/bin", PRESERVED: "yes" },
    validFilesystem(),
  );

  assert.equal(environment.XDG_RUNTIME_DIR, runtimeDir);
  assert.equal(environment.DBUS_SESSION_BUS_ADDRESS, `unix:path=${busPath}`);
  assert.equal(environment.PRESERVED, "yes");
});

test("systemd-run, systemctl, and worker launch receive the same canonical user-bus environment", async () => {
  const executions = [];
  const spawns = [];
  const dependencies = {
    ...validFilesystem(),
    runFile: async (command, args, options) => {
      executions.push({ command, args, options });
      return { stdout: "active", stderr: "" };
    },
    spawn: (command, args, options) => {
      const child = { pid: 1234 };
      spawns.push({ command, args, options, child });
      return child;
    },
  };
  const environmentWithoutBus = { PATH: "/usr/bin", AGENT_ORCHESTRATION_CURRENT_WORKER_RUN_ID: "run_fixture" };

  await runUserManagerFile("/usr/bin/systemctl", ["--user", "show", "fixture.scope"], { env: environmentWithoutBus, timeoutMs: 1_000 }, dependencies);
  await runUserManagerFile("/usr/bin/systemd-run", ["--user", "/usr/bin/true"], { env: environmentWithoutBus }, dependencies);
  const child = await spawnUserManagerFile("/usr/bin/systemd-run", ["--user", "--scope", "/usr/bin/true"], { env: environmentWithoutBus, detached: true, shell: false }, dependencies);

  assert.equal(child.pid, 1234);
  for (const invocation of [...executions, ...spawns]) {
    assert.equal(invocation.options.env.XDG_RUNTIME_DIR, runtimeDir);
    assert.equal(invocation.options.env.DBUS_SESSION_BUS_ADDRESS, `unix:path=${busPath}`);
    assert.equal(invocation.options.env.AGENT_ORCHESTRATION_CURRENT_WORKER_RUN_ID, "run_fixture");
  }
  assert.equal(spawns[0].options.detached, true);
  assert.equal(spawns[0].options.shell, false);
});

test("ambient user-bus paths are replaced instead of trusted", async () => {
  const environment = await canonicalUserBusEnvironment({
    XDG_RUNTIME_DIR: "/tmp/attacker-runtime",
    DBUS_SESSION_BUS_ADDRESS: "unix:path=/tmp/attacker-bus",
  }, validFilesystem());

  assert.equal(environment.XDG_RUNTIME_DIR, runtimeDir);
  assert.equal(environment.DBUS_SESSION_BUS_ADDRESS, `unix:path=${busPath}`);
});

test("user-manager execution fails closed for unsafe canonical runtime or bus paths", async (t) => {
  await t.test("runtime permissions are not private", async () => {
    await assert.rejects(
      () => runUserManagerFile("/usr/bin/systemctl", ["--user", "show-environment"], {}, validFilesystem({ runtimeMode: 0o40755 })),
      { code: "AO_USER_BUS_UNAVAILABLE" },
    );
  });

  await t.test("runtime path resolves elsewhere", async () => {
    await assert.rejects(
      () => runUserManagerFile("/usr/bin/systemctl", ["--user", "show-environment"], {}, validFilesystem({ realpaths: { [runtimeDir]: "/tmp/redirected-runtime" } })),
      { code: "AO_USER_BUS_UNAVAILABLE" },
    );
  });

  await t.test("bus path is not an owned socket", async () => {
    await assert.rejects(
      () => spawnUserManagerFile("/usr/bin/systemd-run", ["--user", "/usr/bin/true"], {}, validFilesystem({ busSocket: false })),
      { code: "AO_USER_BUS_UNAVAILABLE" },
    );
  });
});
