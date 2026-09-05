import assert from "node:assert/strict";
import { mkdtemp, realpath, rm, writeFile, chmod } from "node:fs/promises";
import os from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createPlatformRuntime } from "../../src/platform/factory.mjs";
import { DirectHostAdapter, WindowsWslHostAdapter, createHostAdapter } from "../../src/platform/host-adapters.mjs";
import { WslPathAdapter } from "../../src/platform/path-mapper.mjs";
import { WindowsExecutableResolver } from "../../src/platform/executable-resolvers.mjs";

test("Abstract Factory selects the native Linux strategy family", () => {
  const runtime = createPlatformRuntime({ platform: "linux", backend: "linux-native", pluginRoot: "/plugin", stateRoot: "/state" });
  assert.deepEqual(runtime.describe(), {
    id: "linux-native",
    hostPlatform: process.env.AGENT_ORCHESTRATION_HOST_PLATFORM || process.platform,
    sandbox: "BubblewrapSandboxStrategy",
    supervisor: "SystemdWorkerSupervisorStrategy",
    executableResolver: "LinuxExecutableResolver",
    isolation: "bubblewrap",
    supervision: "systemd-user-cgroup",
  });
});

test("Abstract Factory selects the native Windows strategy family", () => {
  const runtime = createPlatformRuntime({ platform: "win32", backend: "windows-native", pluginRoot: "C:\\plugin", stateRoot: "C:\\state" });
  assert.equal(runtime.id, "windows-native");
  assert.equal(runtime.describe().isolation, "appcontainer");
  assert.equal(runtime.describe().supervision, "windows-job-object");
});

test("explicit Windows host backend selection is deterministic", async () => {
  assert.ok(await createHostAdapter({ platform: "win32", env: { AGENT_ORCHESTRATION_WINDOWS_BACKEND: "native" } }) instanceof DirectHostAdapter);
  assert.ok(await createHostAdapter({ platform: "win32", env: { AGENT_ORCHESTRATION_WINDOWS_BACKEND: "wsl" } }) instanceof WindowsWslHostAdapter);
});

test("WSL Adapter checks the Linux security stack and translates the entrypoint", async () => {
  const calls = [];
  const runner = async (command, args) => {
    calls.push({ command, args });
    if (args.includes("wslpath")) return { stdout: "/mnt/c/plugin/dist/mcp.cjs", stderr: "" };
    return { stdout: "", stderr: "" };
  };
  const adapter = new WindowsWslHostAdapter({ distro: "Ubuntu", runner });
  const health = await adapter.probe();
  const command = await adapter.command("C:\\plugin\\dist\\mcp.cjs");
  assert.equal(health.ok, true);
  assert.equal(command.executable, "wsl.exe");
  assert.ok(command.args.includes("AGENT_ORCHESTRATION_HOST_PLATFORM=win32"));
  assert.ok(command.args.includes("/mnt/c/plugin/dist/mcp.cjs"));
  const probeScript = calls.find(({ args }) => args.includes("/bin/sh"))?.args.at(-1) ?? "";
  assert.match(probeScript, /\bpasta\b/);
  assert.match(probeScript, /\bunshare\b/);
  assert.doesNotMatch(probeScript, /\bslirp4netns\b/);
  assert.ok(calls.every(({ command: executable }) => executable === "wsl.exe"));
});

test("WSL Adapter fails closed when an isolation dependency is missing", async () => {
  const adapter = new WindowsWslHostAdapter({ runner: async () => ({ stdout: "bwrap\npasta\nunshare\n", stderr: "" }) });
  await assert.rejects(() => adapter.command("C:\\plugin\\dist\\mcp.cjs"), { code: "AO_WSL_RUNTIME_NOT_READY" });
});

test("WSL path Adapter translates only absolute Windows paths", async () => {
  const adapter = new WslPathAdapter({ runner: async (command, args) => {
    assert.equal(command, "/usr/bin/wslpath");
    assert.deepEqual(args, ["-a", "-u", "C:\\repo\\worktree"]);
    return { stdout: "/mnt/c/repo/worktree", stderr: "" };
  } });
  assert.equal(await adapter.toRuntimePath("C:\\repo\\worktree"), "/mnt/c/repo/worktree");
  assert.equal(await adapter.toRuntimePath("/already/linux"), "/already/linux");
});

test("Windows executable Strategy honors PATHEXT without invoking a shell", async () => {
  const root = await mkdtemp(join(os.tmpdir(), "ao-windows-resolver-"));
  try {
    const executable = join(root, "provider.exe");
    await writeFile(executable, "fixture");
    // The resolver requires the execute bit. Windows ignores X_OK, so without this the fixture only
    // resolves there and the test is dead weight on POSIX.
    await chmod(executable, 0o755);
    const resolver = new WindowsExecutableResolver({ env: { PATH: root, PATHEXT: ".EXE" } });
    assert.deepEqual(await resolver.findAll("provider"), [await realpath(executable)]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
