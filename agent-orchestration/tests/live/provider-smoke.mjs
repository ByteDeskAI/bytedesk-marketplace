#!/usr/bin/env node
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { OrchestrationService } from "../../src/service.mjs";
import { git } from "../../src/util.mjs";
import { getProviderDescriptor } from "../../src/providers/index.mjs";

const pluginRoot = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
const provider = process.env.AO_LIVE_PROVIDER ?? "codex";
const liveTimeoutMs = Number(process.env.AO_LIVE_TIMEOUT_MS ?? 120_000);
assert.ok(Number.isInteger(liveTimeoutMs) && liveTimeoutMs > 0, "AO_LIVE_TIMEOUT_MS must be a positive integer");
const intentByProvider = { claude: "design", codex: "implementation", "grok-build": "research", kimi: "general" };
assert.ok(intentByProvider[provider], `Unsupported AO_LIVE_PROVIDER: ${provider}`);

async function waitForTerminal(service, consumerCwd, initialRun) {
  let run = initialRun;
  while (!["succeeded", "failed", "cancelled", "timed_out", "rejected", "recovery_required"].includes(run.state)) {
    run = await service.wait({ consumerCwd, runId: run.runId, timeoutMs: 5_000, pollIntervalMs: 200 });
  }
  return run;
}

const root = await mkdtemp(join(os.tmpdir(), `ao-live-${provider}-`));
const consumer = join(root, "consumer");
const stateRoot = join(root, "state");
try {
  await Promise.all([mkdir(consumer), mkdir(stateRoot)]);
  await git(consumer, ["init", "-q"]);
  await git(consumer, ["config", "user.email", "agent-orchestration@test.invalid"]);
  await git(consumer, ["config", "user.name", "Agent Orchestration Live Smoke"]);
  await writeFile(join(consumer, "README.md"), "live provider smoke\n");
  await git(consumer, ["add", "README.md"]);
  await git(consumer, ["commit", "-qm", "fixture"]);

  const service = await new OrchestrationService({ pluginRoot, stateRoot, autoRecover: false }).initialize();
  const doctor = await service.doctor();
  process.stderr.write(`${JSON.stringify(doctor.providerProbes.find((entry) => entry.id === provider))}\n`);
  const spawned = await service.spawn({
    consumerCwd: consumer,
    provider,
    intent: intentByProvider[provider],
    task: "Create agent-orchestration-live-smoke.txt containing exactly: provider sandbox live smoke",
    expectedOutput: "One changed file and a concise verification result.",
    permissionProfile: "write",
    effort: provider === "codex" ? "high" : undefined,
    timeoutMs: liveTimeoutMs,
    maxTurns: 8,
  });
  const run = await waitForTerminal(service, consumer, spawned.run);
  const workerLog = await readFile(join(stateRoot, "logs", `${run.runId}.err.log`), "utf8").catch(() => "");
  assert.equal(run.state, "succeeded", JSON.stringify({ error: run.error, workerLog }));
  const written = await readFile(join(run.workspace.path, "agent-orchestration-live-smoke.txt"), "utf8").catch((error) => {
    assert.fail(JSON.stringify({ error: { code: error.code, message: error.message }, outputs: run.outputs, changedPaths: run.changedPaths, workerLog }, null, 2));
  });
  assert.equal(written.trim(), "provider sandbox live smoke");
  process.stdout.write(`${JSON.stringify({ provider, runId: run.runId, state: run.state, changedPaths: run.changedPaths }, null, 2)}\n`);
  await service.cleanup({ consumerCwd: consumer, runId: run.runId });

  if (process.env.AO_LIVE_FOLLOWUP === "1" && getProviderDescriptor(provider)?.capabilities?.persistent_session === "supported") {
    const parent = await service.spawn({
      consumerCwd: consumer,
      provider,
      intent: intentByProvider[provider],
      task: "Read README.md and include the marker PARENT_TURN_OK in your response. Do not modify files.",
      expectedOutput: "A concise read-only response containing PARENT_TURN_OK.",
      permissionProfile: "read",
      sessionMode: "persistent",
      effort: provider === "codex" ? "high" : undefined,
      timeoutMs: liveTimeoutMs,
      maxTurns: 8,
    });
    const parentRun = await waitForTerminal(service, consumer, parent.run);
    assert.equal(parentRun.state, "succeeded", JSON.stringify(parentRun.error));
    assert.match(parentRun.outputs.at(-1)?.text ?? "", /PARENT_TURN_OK/);
    const child = await service.send({ consumerCwd: consumer, runId: parentRun.runId, message: "Continue this same session and include the marker FOLLOWUP_TURN_OK in your response.", timeoutMs: liveTimeoutMs });
    const childRun = await waitForTerminal(service, consumer, child.run);
    assert.equal(childRun.state, "succeeded", JSON.stringify(childRun.error));
    assert.match(childRun.outputs.at(-1)?.text ?? "", /FOLLOWUP_TURN_OK/);
    process.stdout.write(`${JSON.stringify({ provider, parentRunId: parentRun.runId, followupRunId: childRun.runId, followupState: childRun.state }, null, 2)}\n`);
  } else if (process.env.AO_LIVE_FOLLOWUP === "1") {
    process.stdout.write(`${JSON.stringify({ provider, followupState: "skipped", reason: "persistent_session_not_verified" }, null, 2)}\n`);
  }
} finally {
  await rm(root, { recursive: true, force: true });
}
