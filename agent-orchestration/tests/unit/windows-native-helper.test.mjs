import assert from "node:assert/strict";
import { copyFile, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import { join } from "node:path";
import test from "node:test";
import { runFile } from "../../src/util.mjs";

const pluginRoot = new URL("../..", import.meta.url).pathname.replace(/^\/(?:[A-Za-z]:)/, (value) => value.slice(1));
const helper = join(pluginRoot, "dist", "windows-native", "AgentOrchestration.Windows.dll");

test("native Windows helper creates Job Objects and AppContainers", { skip: process.platform !== "win32" }, async () => {
  const { stdout } = await runFile("dotnet", [helper, "doctor"]);
  const result = JSON.parse(stdout);
  assert.equal(result.jobObjects, true);
  assert.equal(result.appContainer, true);
});

test("native Windows AppContainer launches a bounded console process", { skip: process.platform !== "win32" }, async () => {
  const root = await mkdtemp(join(os.tmpdir(), "ao-windows-helper-test-"));
  const configPath = join(root, "config.json");
  try {
    await writeFile(configPath, `${JSON.stringify({
      profileName: `ByteDesk.AO.Test.${Date.now().toString(36)}`,
      workingDirectory: root,
      readablePaths: [],
      writablePaths: [root],
      protectedPaths: [],
      allowInternet: true,
      memoryBytes: 268435456,
      processLimit: 8,
      runtimeMilliseconds: 5000,
    })}\n`);
    const command = join(process.env.SystemRoot, "System32", "cmd.exe");
    await runFile("dotnet", [helper, "sandbox", "--config", configPath, "--", command, "/d", "/c", "exit", "0"], { timeoutMs: 10_000 });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("native Windows AppContainer launches a staged Node runtime", { skip: process.platform !== "win32" }, async () => {
  const root = await mkdtemp(join(os.tmpdir(), "ao-windows-node-test-"));
  const configPath = join(root, "config.json");
  const stagedNode = join(root, "node.exe");
  try {
    await copyFile(process.execPath, stagedNode);
    await writeFile(configPath, `${JSON.stringify({
      profileName: `ByteDesk.AO.Node.${Date.now().toString(36)}`,
      workingDirectory: root,
      readablePaths: [],
      writablePaths: [root],
      protectedPaths: [],
      allowInternet: false,
      memoryBytes: 268435456,
      processLimit: 8,
      runtimeMilliseconds: 5000,
    })}\n`);
    const dotnet = join(process.env.ProgramFiles, "dotnet", "dotnet.exe");
    const { stdout } = await runFile(dotnet, [helper, "sandbox", "--config", configPath, "--", stagedNode, "-e", "process.stdout.write('node-ok')"], {
      timeoutMs: 10_000,
      env: {
        SystemRoot: process.env.SystemRoot,
        WINDIR: process.env.WINDIR,
        SystemDrive: process.env.SystemDrive,
        ComSpec: process.env.ComSpec,
        PATHEXT: process.env.PATHEXT,
        OS: process.env.OS,
        PROCESSOR_ARCHITECTURE: process.env.PROCESSOR_ARCHITECTURE,
        NUMBER_OF_PROCESSORS: process.env.NUMBER_OF_PROCESSORS,
        PATH: `${join(process.env.ProgramFiles, "dotnet")};${join(process.env.SystemRoot, "System32")}`,
        TEMP: root,
        TMP: root,
        USERPROFILE: root,
        LOCALAPPDATA: process.env.LOCALAPPDATA,
        APPDATA: process.env.APPDATA,
        ProgramData: process.env.ProgramData,
        ProgramFiles: process.env.ProgramFiles,
        ProgramW6432: process.env.ProgramW6432,
        CommonProgramFiles: process.env.CommonProgramFiles,
        CommonProgramW6432: process.env.CommonProgramW6432,
        HOMEDRIVE: process.env.HOMEDRIVE,
        HOMEPATH: process.env.HOMEPATH,
        USERNAME: process.env.USERNAME,
        USERDOMAIN: process.env.USERDOMAIN,
        PUBLIC: process.env.PUBLIC,
      },
    });
    assert.equal(stdout, "node-ok");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("native Windows AppContainer launches the installed Codex executable", { skip: process.platform !== "win32" }, async (context) => {
  const paths = await runFile("where.exe", ["codex"]).then(({ stdout }) => stdout.split(/\r?\n/).filter((value) => value.toLowerCase().endsWith(".exe")), () => []);
  if (paths.length === 0) return context.skip("Codex executable is not installed.");
  const root = await mkdtemp(join(os.tmpdir(), "ao-windows-codex-test-"));
  const configPath = join(root, "config.json");
  const stagedCodex = join(root, "codex.exe");
  try {
    await copyFile(paths[0], stagedCodex);
    await writeFile(configPath, `${JSON.stringify({
      profileName: `ByteDesk.AO.Codex.${Date.now().toString(36)}`,
      workingDirectory: root,
      readablePaths: [],
      writablePaths: [root],
      protectedPaths: [],
      allowInternet: true,
      memoryBytes: 536870912,
      processLimit: 32,
      runtimeMilliseconds: 10000,
    })}\n`);
    const { stdout } = await runFile("dotnet", [helper, "sandbox", "--config", configPath, "--", stagedCodex, "--version"], { timeoutMs: 15_000 });
    assert.match(stdout, /codex/i);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
