import assert from "node:assert/strict";
import { access, chmod, cp, lstat, mkdir, mkdtemp, readdir, readFile, realpath, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import { delimiter, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const run = promisify(execFile);
const sourceRoot = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
const packageManifest = JSON.parse(await readFile(join(sourceRoot, "package.json"), "utf8"));
const shippedEntries = packageManifest.files;
const shippedTopLevelEntries = [...new Set(shippedEntries.map((entry) => entry.split("/")[0]))];
const expectedToolNames = [
  "orchestration_capabilities",
  "orchestration_doctor",
  "orchestration_route",
  "orchestration_plan",
  "orchestration_spawn",
  "orchestration_send",
  "orchestration_wait",
  "orchestration_status",
  "orchestration_list",
  "orchestration_events",
  "orchestration_cancel",
  "orchestration_cleanup",
  "orchestration_decision_get",
  "orchestration_decision_approve",
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
      const destination = join(installed, entry);
      await mkdir(dirname(destination), { recursive: true });
      await cp(join(sourceRoot, entry), destination, { recursive: true });
    }
    for (const launcher of await readdir(join(installed, "bin"))) await chmod(join(installed, "bin", launcher), 0o755);
    await Promise.all([
      cp(join(sourceRoot, "tests", "fixtures", "fake-grok.mjs"), join(fakeGrokBin, "grok")),
      cp(join(sourceRoot, "tests", "fixtures", "fake-grok.mjs"), join(fakeKimiBin, "kimi")),
    ]);
    await Promise.all([chmod(join(fakeGrokBin, "grok"), 0o755), chmod(join(fakeKimiBin, "kimi"), 0o755)]);
    await assert.rejects(() => lstat(join(installed, "src")));
    await assert.rejects(() => lstat(join(installed, "node_modules")));
    await access(join(installed, "ROADMAP.md"));
    await access(join(installed, "ROADMAP-SOURCES.json"));
    await access(join(installed, "ROADMAP-INVENTORY.json"));
    await access(join(installed, "scripts", "roadmap.mjs"));
    assert.deepEqual(await readdir(join(installed, "scripts")), ["roadmap.mjs"]);
    assert.equal(shippedEntries.includes("src"), false, "package files must not ship the implementation source tree");
    assert.equal(shippedEntries.includes("ROADMAP-SOURCES.json"), true, "package files must ship source-seam integrity data");
    assert.equal(shippedEntries.includes("ROADMAP-INVENTORY.json"), true, "package files must ship append-only roadmap identity data");
    const roadmapCheck = await run(process.execPath, [join(installed, "scripts", "roadmap.mjs"), "--check", join(installed, "ROADMAP.md")], { cwd: installed });
    assert.match(roadmapCheck.stdout, /^ROADMAP OK:/);
    const roadmapSkill = (await readFile(join(installed, "skills", "roadmap-orchestrator", "SKILL.md"), "utf8")).replace(/\r\n?/g, "\n");
    assert.match(roadmapSkill, /^---\nname: roadmap-orchestrator\ndescription: .+\n---\n/);
    const roadmapSkillMetadata = await readFile(join(installed, "skills", "roadmap-orchestrator", "agents", "openai.yaml"), "utf8");
    assert.match(roadmapSkillMetadata, /display_name: "Roadmap Orchestrator"/);
    assert.match(roadmapSkillMetadata, /\$roadmap-orchestrator/);
    assert.equal(JSON.parse(await readFile(join(installed, ".claude-plugin", "plugin.json"), "utf8")).version, undefined);
    assert.equal(JSON.parse(await readFile(join(installed, ".codex-plugin", "plugin.json"), "utf8")).version, undefined);
    const agentsMd = await readFile(join(installed, "AGENTS.md"), "utf8");
    assert.match(agentsMd, /\| Grok Build \| Same `\.mcp\.json`/);
    assert.match(agentsMd, /\| Kimi Code \| `~\/\.kimi-code\/mcp\.json`/);
    assert.match(agentsMd, /Wire hosts with `skills\/install-orchestration-host`/);
    const hostSkill = (await readFile(join(installed, "skills", "install-orchestration-host", "SKILL.md"), "utf8")).replace(/\r\n?/g, "\n");
    assert.match(hostSkill, /^---\nname: install-orchestration-host\n/);

    const transport = new StdioClientTransport({
      command: join(installed, "bin", "agent-orchestration-mcp"),
      cwd: installed,
      env: {
        PATH: [fakeGrokBin, fakeKimiBin, process.env.PATH].filter(Boolean).join(delimiter),
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
      const names = tools.tools.map((tool) => tool.name);
      assert.deepEqual([...names].sort(), [...expectedToolNames].sort());
      assert.equal(names.some((name) => name.startsWith("ao_")), false, "legacy ao_* tools must not be installed");
      for (const tool of tools.tools) {
        assert.equal(tool.outputSchema?.properties?.schemaVersion?.const, 1, `${tool.name} lacks the versioned output envelope`);
      }
      const planTool = tools.tools.find((tool) => tool.name === "orchestration_plan");
      assert.equal(planTool.inputSchema.properties.effort.enum.includes("none"), true);

      const doctor = await client.callTool({ name: "orchestration_doctor", arguments: {} });
      const doctorPayload = JSON.parse(doctor.content[0].text);
      if (process.platform === "win32") {
        assert.equal(doctorPayload.ok, true, JSON.stringify(doctorPayload, null, 2));
        assert.equal(doctorPayload.runtime.id, "windows-native");
      } else {
        assert.equal(doctorPayload.providerProbes.find((entry) => entry.id === "kimi").ready, true, JSON.stringify(doctorPayload.providerProbes.find((entry) => entry.id === "kimi"), null, 2));
      }

      const planned = await client.callTool({ name: "orchestration_plan", arguments: { consumerCwd: consumer, intent: "implementation", task: "Plan a fixture change", permissionProfile: "read" } });
      assert.equal(planned.isError, undefined);
      const planPayload = JSON.parse(planned.content[0].text);
      assert.equal(planPayload.consumer.checkoutRoot, await realpath(consumer));
      assert.equal(planPayload.plan.stages[0].route.selected.providerId, "codex");

      const missing = await client.callTool({ name: "orchestration_plan", arguments: { intent: "implementation", task: "Must fail" } });
      assert.equal(missing.isError, true);

      if (process.platform !== "win32") {
      const spawned = await client.callTool({ name: "orchestration_spawn", arguments: { consumerCwd: consumer, intent: "research", provider: "grok-build", task: `WRITE_FIXTURE\nFORBIDDEN_PATH=${forbiddenPath}`, permissionProfile: "write", timeoutMs: 20_000 } });
      assert.equal(spawned.isError, undefined);
      const writeRunId = JSON.parse(spawned.content[0].text).run.runId;
      const completed = await client.callTool({ name: "orchestration_wait", arguments: { consumerCwd: consumer, runId: writeRunId, timeoutMs: 20_000 } });
      const completedRun = JSON.parse(completed.content[0].text);
      assert.equal(completedRun.state, "succeeded", JSON.stringify(completedRun, null, 2));
      assert.equal(await readFile(join(completedRun.workspace.path, "fake-agent-change.txt"), "utf8"), "sandbox write succeeded\n");
      // `bootstrap_credentials_exposed` is deliberate, and reading it as a defect is the mistake to
      // avoid. Subscription CLIs (Claude Max) re-read their credential file on later turns, so
      // shredding it the moment bootstrap completes — which is what `cleared` recorded — broke
      // authentication for every provider of that shape. The broker-owned copy therefore stays
      // mounted for the life of the process. Do not "fix" this line back.
      //
      // What must still hold is asserted below, and it is the whole of the protection:
      // the agent may read a COPY and never the host's file, it may not write it, it may not rename
      // its way around it, and the copy does not survive the run.
      assert.equal(await readFile(join(completedRun.workspace.path, "sandbox-result.txt"), "utf8"), "sandbox_only\nclient_callbacks_blocked\nbootstrap_home_read_only\nbootstrap_ancestors_protected\nruntime_root_protected\nbootstrap_credentials_exposed\n");
      await assert.rejects(() => access(join(completedRun.workspace.path, "client-callback-write.txt")));
      await assert.rejects(() => access(forbiddenPath));
      assert.equal(await readFile(join(fakeHome, ".grok", "auth.json"), "utf8"), "contract-secret-must-be-revoked\n");
      // The replacement for shred-after-bootstrap: nothing readable is left behind. Teardown
      // truncates, syncs and unlinks the broker copy and removes the control directory, so after a
      // completed run no broker tree may still hold the secret. Without this the trade-off above
      // would be unbounded — a token readable for one run is a decision, a token left on disk is a
      // leak, and only this assertion tells the two apart.
      //
      // Scope, precisely: this catches a credential still sitting in a broker tree at this point,
      // which is what a teardown that stopped revoking would leave. It does not isolate teardown
      // from the startup sweep that also prunes broker trees whose pid is gone — both are supposed
      // to run, and either one failing alone still leaves the other. The staged mount target under
      // the run's temp dir needs no check: it is created empty and is only ever a mount point.
      const brokerRoots = await readdir("/dev/shm", { withFileTypes: true })
        .then((entries) => entries.filter((entry) => entry.isDirectory() && entry.name.startsWith("agent-orchestration-broker-")))
        .catch(() => []);
      for (const entry of brokerRoots) {
        const leaked = await run("grep", ["-rl", "contract-secret-must-be-revoked", join("/dev/shm", entry.name)]).catch(() => null);
        assert.equal(leaked, null, `broker tree ${entry.name} still holds the provider credential after the run`);
      }
      const unsafeFollowup = await client.callTool({ name: "orchestration_send", arguments: { consumerCwd: consumer, runId: writeRunId, message: "continue writing" } });
      assert.equal(unsafeFollowup.isError, true);
      assert.equal(JSON.parse(unsafeFollowup.content[0].text).code, "AO_WRITE_FOLLOWUP_REQUIRES_NEW_RUN");
      const cleaned = await client.callTool({ name: "orchestration_cleanup", arguments: { consumerCwd: consumer, runId: writeRunId } });
      assert.equal(JSON.parse(cleaned.content[0].text).cleaned, true);
      await assert.rejects(() => access(completedRun.workspace.path));

      const blocking = await client.callTool({ name: "orchestration_spawn", arguments: { consumerCwd: consumer, intent: "research", provider: "grok-build", task: "BLOCK_UNTIL_CANCEL", permissionProfile: "read", timeoutMs: 20_000 } });
      const blockingRunId = JSON.parse(blocking.content[0].text).run.runId;
      let blockingState = "queued";
      for (let attempt = 0; attempt < 100 && blockingState === "queued"; attempt += 1) {
        await new Promise((resolve) => setTimeout(resolve, 50));
        const status = await client.callTool({ name: "orchestration_status", arguments: { consumerCwd: consumer, runId: blockingRunId } });
        blockingState = JSON.parse(status.content[0].text).state;
      }
      assert.notEqual(blockingState, "queued");
      const cancelled = await client.callTool({ name: "orchestration_cancel", arguments: { consumerCwd: consumer, runId: blockingRunId } });
      assert.equal(JSON.parse(cancelled.content[0].text).state, "cancelled");

      const readSpawn = await client.callTool({ name: "orchestration_spawn", arguments: { consumerCwd: consumer, intent: "research", provider: "grok-build", task: "READ_FIXTURE", permissionProfile: "read", timeoutMs: 20_000 } });
      const readRunId = JSON.parse(readSpawn.content[0].text).run.runId;
      const readComplete = await client.callTool({ name: "orchestration_wait", arguments: { consumerCwd: consumer, runId: readRunId, timeoutMs: 20_000 } });
      assert.equal(JSON.parse(readComplete.content[0].text).state, "succeeded");
      const followup = await client.callTool({ name: "orchestration_send", arguments: { consumerCwd: consumer, runId: readRunId, message: "Continue the fixture session", timeoutMs: 20_000 } });
      assert.equal(followup.isError, true);
      assert.equal(JSON.parse(followup.content[0].text).code, "AO_FOLLOWUP_UNSUPPORTED");
      }
    } finally {
      await client.close();
    }

    assert.deepEqual((await readdir(installed)).sort(), shippedTopLevelEntries.sort());
    assert.deepEqual(await readdir(decoy), [".git", "README.md"]);
    assert.equal((await readdir(stateRoot)).includes("runs"), true);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
