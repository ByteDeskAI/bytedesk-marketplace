#!/usr/bin/env node
/**
 * Grok-as-orchestrator read-only smoke: exercise the public MCP surface
 * against every ready catalog provider.
 */
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const PLUGIN = process.env.AO_PLUGIN_ROOT ?? join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const CONSUMER = process.env.AO_CONSUMER_CWD ?? process.cwd();
const TASK = [
  "Read-only orchestration probe.",
  "Do not create, edit, delete, or stage any files.",
  "Do not run git commit, git push, or package installs.",
  "Open README.md at the repository root and quote only the first markdown heading.",
  "Reply with exactly two lines:",
  "PROVIDER_OK=<your provider id if you know it, else unknown>",
  "HEADING=<the heading text>",
].join(" ");

function payload(result) {
  const text = result.content?.find((part) => part.type === "text")?.text;
  if (!text) return { error: "empty", isError: Boolean(result.isError), raw: result };
  try {
    return JSON.parse(text);
  } catch {
    return { error: "unparseable", text: text.slice(0, 500), isError: Boolean(result.isError) };
  }
}

async function call(client, name, args = {}) {
  const result = await client.callTool({ name, arguments: args });
  const data = payload(result);
  return { name, isError: Boolean(result.isError), data };
}

async function waitTerminal(client, runId, label, budgetMs = 240_000) {
  const started = Date.now();
  let last = null;
  while (Date.now() - started < budgetMs) {
    last = await call(client, "orchestration_wait", {
      consumerCwd: CONSUMER,
      runId,
      timeoutMs: 50_000,
    });
    const state = last.data?.state || last.data?.run?.state;
    process.stdout.write(`[wait ${label}] state=${state} elapsed=${Date.now() - started}ms\n`);
    if (["succeeded", "failed", "cancelled", "timed_out"].includes(state)) return last;
  }
  return last;
}

const transport = new StdioClientTransport({
  command: `${PLUGIN}/bin/agent-orchestration-mcp`,
  cwd: PLUGIN,
  stderr: "pipe",
});
const client = new Client({ name: "grok-orchestrator-readonly", version: "1.0.0" });
await client.connect(transport);

const report = { consumerCwd: CONSUMER, steps: [] };

try {
  const caps = await call(client, "orchestration_capabilities");
  report.capabilities = {
    providerIds: caps.data.providerIds,
    intents: caps.data.intents,
    protocols: caps.data.protocols,
    permissionProfiles: caps.data.permissionProfiles,
    lifecycle: caps.data.lifecycle,
  };
  process.stdout.write(`capabilities providers=${JSON.stringify(caps.data.providerIds)}\n`);

  const doctor = await call(client, "orchestration_doctor");
  report.doctor = {
    ok: doctor.data.ok,
    probes: doctor.data.providerProbes,
    executables: doctor.data.executables?.map((row) => ({ id: row.id, ok: row.ok, reason: row.reason })),
  };
  process.stdout.write(`doctor ${JSON.stringify(report.doctor.probes, null, 2)}\n`);

  const ready = (doctor.data.providerProbes || []).filter((row) => row.ready).map((row) => row.id);
  report.readyProviders = ready;

  const route = await call(client, "orchestration_route", {
    consumerCwd: CONSUMER,
    intent: "research",
    task: TASK,
    permissionProfile: "read",
  });
  report.route = {
    isError: route.isError,
    selected: route.data.decision?.selected,
    summary: route.data.explanation?.summary,
  };

  const plan = await call(client, "orchestration_plan", {
    consumerCwd: CONSUMER,
    intent: "research",
    task: TASK,
    permissionProfile: "read",
    protocolId: "single.v1",
    expectedOutput: "Two lines PROVIDER_OK and HEADING. No file changes.",
  });
  report.plan = {
    isError: plan.isError,
    protocolId: plan.data.plan?.protocolId,
    stages: plan.data.plan?.stages?.map((stage) => ({
      stageId: stage.stageId,
      role: stage.role,
      providerId: stage.route?.selected?.providerId,
    })),
  };

  const spawned = [];
  for (const provider of ready) {
    process.stdout.write(`spawn ${provider} read-only oneshot\n`);
    const result = await call(client, "orchestration_spawn", {
      consumerCwd: CONSUMER,
      intent: "research",
      task: TASK,
      provider,
      permissionProfile: "read",
      sessionMode: "oneshot",
      protocolId: "single.v1",
      timeoutMs: 180_000,
      maxTurns: 8,
      expectedOutput: "Two lines PROVIDER_OK and HEADING. No file changes.",
      idempotencyKey: `grok-host-readonly:${provider}:v1`,
    });
    spawned.push({ provider, ...result });
    process.stdout.write(`spawn ${provider} error=${result.isError} run=${result.data.run?.runId || result.data.runId || result.data.code}\n`);
  }
  report.spawns = spawned.map((row) => ({
    provider: row.provider,
    isError: row.isError,
    runId: row.data.run?.runId,
    state: row.data.run?.state,
    code: row.data.code,
    message: row.data.message,
  }));

  const waits = [];
  for (const row of spawned) {
    const runId = row.data.run?.runId;
    if (!runId) continue;
    const done = await waitTerminal(client, runId, row.provider);
    const status = await call(client, "orchestration_status", { consumerCwd: CONSUMER, runId });
    const events = await call(client, "orchestration_events", { consumerCwd: CONSUMER, runId, after: 0 });
    const decision = await call(client, "orchestration_decision_get", { consumerCwd: CONSUMER, runId });
    waits.push({
      provider: row.provider,
      runId,
      state: done.data?.state,
      outputs: status.data?.outputs,
      eventTypes: (events.data || []).map((event) => event.type),
      eventCount: Array.isArray(events.data) ? events.data.length : 0,
      decisionError: decision.isError ? decision.data.code || decision.data.message : null,
    });
  }
  report.waits = waits;

  const listed = await call(client, "orchestration_list", { consumerCwd: CONSUMER });
  report.listCount = Array.isArray(listed.data) ? listed.data.length : listed.data;

  const persistentProvider = ready.find((id) => id !== "grok-build") || ready[0];
  if (persistentProvider) {
    process.stdout.write(`spawn persistent ${persistentProvider}\n`);
    const persistent = await call(client, "orchestration_spawn", {
      consumerCwd: CONSUMER,
      intent: "research",
      task: `${TASK} After the heading, wait for a follow-up; do not write files.`,
      provider: persistentProvider,
      permissionProfile: "read",
      sessionMode: "persistent",
      protocolId: "single.v1",
      timeoutMs: 180_000,
      maxTurns: 6,
      expectedOutput: "Two lines then await follow-up.",
      idempotencyKey: `grok-host-readonly:${persistentProvider}:persistent:v1`,
    });
    report.persistentSpawn = {
      isError: persistent.isError,
      runId: persistent.data.run?.runId,
      state: persistent.data.run?.state,
      code: persistent.data.code,
      message: persistent.data.message,
    };
    const parentId = persistent.data.run?.runId;
    if (parentId) {
      await waitTerminal(client, parentId, `${persistentProvider}-persistent`);
      const follow = await call(client, "orchestration_send", {
        consumerCwd: CONSUMER,
        runId: parentId,
        message: "Read-only follow-up: reply FOLLOWUP_OK=1 and the same heading. Do not write files.",
        timeoutMs: 120_000,
      });
      report.followup = {
        isError: follow.isError,
        childRunId: follow.data.run?.runId,
        parentRunId: follow.data.parentRunId,
        code: follow.data.code,
        message: follow.data.message,
      };
      if (follow.data.run?.runId) {
        const childWait = await waitTerminal(client, follow.data.run.runId, "followup");
        report.followupWait = { state: childWait.data?.state, outputs: childWait.data?.outputs };
        await call(client, "orchestration_cleanup", { consumerCwd: CONSUMER, runId: follow.data.run.runId });
      }
      await call(client, "orchestration_cleanup", { consumerCwd: CONSUMER, runId: parentId });
    }
  }

  for (const row of waits) {
    const cleaned = await call(client, "orchestration_cleanup", { consumerCwd: CONSUMER, runId: row.runId });
    row.cleaned = cleaned.data.cleaned ?? cleaned.isError;
    row.cleanupCode = cleaned.data.code;
  }
} finally {
  await client.close().catch(() => {});
}

process.stdout.write(`\n=== REPORT ===\n${JSON.stringify(report, null, 2)}\n`);
