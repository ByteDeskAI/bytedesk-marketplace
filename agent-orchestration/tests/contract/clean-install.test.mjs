import assert from "node:assert/strict";
import { access, chmod, cp, lstat, mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const run = promisify(execFile);
const sourceRoot = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
const shippedEntries = [
  ".claude-plugin", ".codex-plugin", ".mcp.json", ".codex-mcp.json", "agents", "bin",
  "dist", "skills", "templates", "AGENTS.md", "CHANGELOG.md", "README.md",
];

async function initRepo(path) {
  await mkdir(path);
  await run("git", ["-C", path, "init", "-q"]);
  await run("git", ["-C", path, "config", "user.email", "agent-orchestration@test.invalid"]);
  await run("git", ["-C", path, "config", "user.name", "Agent Orchestration Test"]);
  await writeFile(join(path, "README.md"), "fixture\n");
  await run("git", ["-C", path, "add", "README.md"]);
  await run("git", ["-C", path, "commit", "-qm", "fixture"]);
}

test("tracked install bundle starts from plugin cwd but resolves only explicit consumerCwd", async () => {
  const root = await mkdtemp(join(os.tmpdir(), "ao-clean-install-"));
  const installed = join(root, "cache", "agent-orchestration");
  const stateRoot = join(root, "state");
  const consumer = join(root, "consumer");
  const decoy = join(root, "decoy");
  const fakeHome = join(root, "home");
  const fakeGrokBin = join(fakeHome, ".grok", "downloads");
  const fakeKimiBin = join(fakeHome, ".local", "share", "uv", "tools", "kimi-cli", "bin");
  const forbiddenPath = join(root, "forbidden.txt");
  await Promise.all([mkdir(installed, { recursive: true }), mkdir(stateRoot), mkdir(join(fakeHome, ".grok"), { recursive: true }), mkdir(fakeGrokBin, { recursive: true }), mkdir(fakeKimiBin, { recursive: true }), initRepo(consumer), initRepo(decoy)]);
  try {
    await writeFile(join(fakeHome, ".grok", "auth.json"), "contract-secret-must-be-revoked\n", { mode: 0o600 });
    for (const entry of shippedEntries) {
      await cp(join(sourceRoot, entry), join(installed, entry), { recursive: true });
    }
    for (const launcher of await readdir(join(installed, "bin"))) await chmod(join(installed, "bin", launcher), 0o755);
    await Promise.all([
      cp(join(sourceRoot, "tests", "fixtures", "fake-grok.mjs"), join(fakeGrokBin, "grok")),
      cp(join(sourceRoot, "tests", "fixtures", "fake-grok.mjs"), join(fakeKimiBin, "kimi")),
    ]);
    await Promise.all([chmod(join(fakeGrokBin, "grok"), 0o755), chmod(join(fakeKimiBin, "kimi"), 0o755)]);
    await assert.rejects(() => lstat(join(installed, "src")));
    await assert.rejects(() => lstat(join(installed, "node_modules")));

    const transport = new StdioClientTransport({
      command: join(installed, "bin", "agent-orchestration-mcp"),
      cwd: installed,
      env: {
        PATH: `${fakeGrokBin}:${fakeKimiBin}:${process.env.PATH}`,
        HOME: fakeHome,
        XDG_RUNTIME_DIR: process.env.XDG_RUNTIME_DIR,
        DBUS_SESSION_BUS_ADDRESS: process.env.DBUS_SESSION_BUS_ADDRESS,
        XDG_STATE_HOME: stateRoot,
        AGENT_ORCHESTRATION_STATE_HOME: stateRoot,
      },
      stderr: "pipe",
    });
    const client = new Client({ name: "agent-orchestration-contract", version: "1.0.0" });
    await client.connect(transport);
    try {
      const tools = await client.listTools();
      const names = new Set(tools.tools.map((tool) => tool.name));
      for (const name of ["ao_capabilities", "ao_doctor", "ao_route", "ao_plan", "ao_spawn", "ao_send", "ao_wait", "ao_status", "ao_list", "ao_events", "ao_cancel", "ao_cleanup", "ao_decision_get", "ao_decision_approve"]) {
        assert.equal(names.has(name), true, `${name} missing from installed tool surface`);
      }
      for (const tool of tools.tools) {
        assert.equal(tool.outputSchema?.properties?.schemaVersion?.const, 1, `${tool.name} lacks the versioned output envelope`);
      }
      const planTool = tools.tools.find((tool) => tool.name === "ao_plan");
      assert.equal(planTool.inputSchema.properties.effort.enum.includes("none"), true);

      const doctor = await client.callTool({ name: "ao_doctor", arguments: {} });
      const doctorPayload = JSON.parse(doctor.content[0].text);
      assert.equal(doctorPayload.providerProbes.find((entry) => entry.id === "kimi").ready, true, JSON.stringify(doctorPayload.providerProbes.find((entry) => entry.id === "kimi"), null, 2));

      const planned = await client.callTool({ name: "ao_plan", arguments: { consumerCwd: consumer, intent: "implementation", task: "Plan a fixture change", permissionProfile: "read" } });
      assert.equal(planned.isError, undefined);
      const planPayload = JSON.parse(planned.content[0].text);
      assert.equal(planPayload.consumer.checkoutRoot, consumer);
      assert.equal(planPayload.plan.stages[0].route.selected.providerId, "codex");

      const missing = await client.callTool({ name: "ao_plan", arguments: { intent: "implementation", task: "Must fail" } });
      assert.equal(missing.isError, true);

      const spawned = await client.callTool({ name: "ao_spawn", arguments: { consumerCwd: consumer, intent: "research", provider: "grok-build", task: `WRITE_FIXTURE\nFORBIDDEN_PATH=${forbiddenPath}`, permissionProfile: "write", timeoutMs: 20_000 } });
      assert.equal(spawned.isError, undefined);
      const writeRunId = JSON.parse(spawned.content[0].text).run.runId;
      const completed = await client.callTool({ name: "ao_wait", arguments: { consumerCwd: consumer, runId: writeRunId, timeoutMs: 20_000 } });
      const completedRun = JSON.parse(completed.content[0].text);
      assert.equal(completedRun.state, "succeeded", JSON.stringify(completedRun, null, 2));
      assert.equal(await readFile(join(completedRun.workspace.path, "fake-agent-change.txt"), "utf8"), "sandbox write succeeded\n");
      assert.equal(await readFile(join(completedRun.workspace.path, "sandbox-result.txt"), "utf8"), "sandbox_only\nclient_callbacks_blocked\nbootstrap_home_read_only\nbootstrap_ancestors_protected\nruntime_root_protected\nbootstrap_credentials_cleared\n");
      await assert.rejects(() => access(join(completedRun.workspace.path, "client-callback-write.txt")));
      await assert.rejects(() => access(forbiddenPath));
      assert.equal(await readFile(join(fakeHome, ".grok", "auth.json"), "utf8"), "contract-secret-must-be-revoked\n");
      const unsafeFollowup = await client.callTool({ name: "ao_send", arguments: { consumerCwd: consumer, runId: writeRunId, message: "continue writing" } });
      assert.equal(unsafeFollowup.isError, true);
      assert.equal(JSON.parse(unsafeFollowup.content[0].text).code, "AO_WRITE_FOLLOWUP_REQUIRES_NEW_RUN");
      const cleaned = await client.callTool({ name: "ao_cleanup", arguments: { consumerCwd: consumer, runId: writeRunId } });
      assert.equal(JSON.parse(cleaned.content[0].text).cleaned, true);
      await assert.rejects(() => access(completedRun.workspace.path));

      const blocking = await client.callTool({ name: "ao_spawn", arguments: { consumerCwd: consumer, intent: "research", provider: "grok-build", task: "BLOCK_UNTIL_CANCEL", permissionProfile: "read", timeoutMs: 20_000 } });
      const blockingRunId = JSON.parse(blocking.content[0].text).run.runId;
      let blockingState = "queued";
      for (let attempt = 0; attempt < 100 && blockingState === "queued"; attempt += 1) {
        await new Promise((resolve) => setTimeout(resolve, 50));
        const status = await client.callTool({ name: "ao_status", arguments: { consumerCwd: consumer, runId: blockingRunId } });
        blockingState = JSON.parse(status.content[0].text).state;
      }
      assert.notEqual(blockingState, "queued");
      const cancelled = await client.callTool({ name: "ao_cancel", arguments: { consumerCwd: consumer, runId: blockingRunId } });
      assert.equal(JSON.parse(cancelled.content[0].text).state, "cancelled");

      const readSpawn = await client.callTool({ name: "ao_spawn", arguments: { consumerCwd: consumer, intent: "research", provider: "grok-build", task: "READ_FIXTURE", permissionProfile: "read", timeoutMs: 20_000 } });
      const readRunId = JSON.parse(readSpawn.content[0].text).run.runId;
      const readComplete = await client.callTool({ name: "ao_wait", arguments: { consumerCwd: consumer, runId: readRunId, timeoutMs: 20_000 } });
      assert.equal(JSON.parse(readComplete.content[0].text).state, "succeeded");
      const followup = await client.callTool({ name: "ao_send", arguments: { consumerCwd: consumer, runId: readRunId, message: "Continue the fixture session", timeoutMs: 20_000 } });
      assert.equal(followup.isError, true);
      assert.equal(JSON.parse(followup.content[0].text).code, "AO_FOLLOWUP_UNSUPPORTED");
    } finally {
      await client.close();
    }

    assert.deepEqual((await readdir(installed)).sort(), shippedEntries.sort());
    assert.deepEqual(await readdir(decoy), [".git", "README.md"]);
    assert.equal((await readdir(stateRoot)).includes("runs"), true);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
