import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import { join } from "node:path";
import test from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createServer } from "../../src/mcp.mjs";

const EXPECTED_TOOL_NAMES = [
  "orchestration_capabilities",
  "orchestration_doctor",
  "orchestration_route",
  "orchestration_plan",
  "orchestration_spawn",
  "orchestration_send",
  "orchestration_wait",
  "orchestration_run_followup",
  "orchestration_run_wait",
  "orchestration_run_mail_send",
  "orchestration_run_mail_reply",
  "orchestration_run_mail_wait",
  "orchestration_lead_status",
  "orchestration_session_handoff",
  "orchestration_status",
  "orchestration_list",
  "orchestration_events",
  "orchestration_cancel",
  "orchestration_cleanup",
  "orchestration_decision_get",
  "orchestration_decision_approve",
  "orchestration_mailbox_send",
  "orchestration_mailbox_receive",
  "orchestration_mailbox_list",
  "orchestration_mailbox_dispose",
  "orchestration_mailbox_wait",
  "orchestration_goal_start",
  "orchestration_goal_status",
  "orchestration_goal_report",
  "orchestration_goal_control",
  "orchestration_goal_reconcile",
];

async function fixture() {
  const root = await mkdtemp(join(os.tmpdir(), "ao-mcp-contract-"));
  const pluginRoot = join(root, "plugin");
  const stateRoot = join(root, "state");
  await Promise.all([mkdir(pluginRoot), mkdir(stateRoot)]);

  const { server } = await createServer({ pluginRoot, stateRoot, autoRecover: false });
  const client = new Client({ name: "agent-orchestration-mcp-contract", version: "1.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);

  return {
    client,
    root,
    stateRoot,
    cleanup: async () => {
      await client.close().catch(() => {});
      await server.close().catch(() => {});
      await rm(root, { recursive: true, force: true });
    },
  };
}

function successBranch(tool) {
  const branches = tool.outputSchema?.properties?.data?.anyOf;
  assert.ok(Array.isArray(branches), `${tool.name} output data must be a success/error union`);
  assert.equal(branches.length, 2, `${tool.name} output data must have exactly success and error branches`);
  return branches[0];
}

test("public MCP surface exposes exactly the orchestration-prefixed contract", async () => {
  const fx = await fixture();
  try {
    const names = (await fx.client.listTools()).tools.map((tool) => tool.name);
    assert.deepEqual([...names].sort(), [...EXPECTED_TOOL_NAMES].sort());
    assert.equal(names.some((name) => name.startsWith("ao_")), false, "legacy ao_* tools must not be exposed");
  } finally {
    await fx.cleanup();
  }
});

test("MCP plan and spawn expose protocols while route remains a single-route preview", async () => {
  const fx = await fixture();
  try {
    const tools = new Map((await fx.client.listTools()).tools.map((tool) => [tool.name, tool]));
    const route = tools.get("orchestration_route");
    const plan = tools.get("orchestration_plan");
    const spawn = tools.get("orchestration_spawn");

    assert.ok(route && plan && spawn);
    assert.equal(route.inputSchema.properties.protocolId, undefined);
    for (const tool of [plan, spawn]) {
      assert.deepEqual(tool.inputSchema.properties.protocolId.enum, ["single.v1", "architecture.adversarial.v1"]);
      assert.deepEqual(tool.inputSchema.properties.sessionMode.enum, ["oneshot", "persistent"]);
      assert.ok(tool.inputSchema.properties.endpointId.enum.includes("claude.fable-5-1"));
      assert.ok(tool.inputSchema.properties.endpointId.enum.includes("openai.gpt-5.6-sol"));
      assert.equal(tool.inputSchema.required.includes("protocolId"), false);
      assert.equal(tool.inputSchema.required.includes("sessionMode"), false);
      assert.equal(tool.inputSchema.required.includes("endpointId"), false);
    }
  } finally {
    await fx.cleanup();
  }
});

test("every MCP tool publishes a concrete forward-compatible success/error envelope", async () => {
  const fx = await fixture();
  try {
    const tools = new Map((await fx.client.listTools()).tools.map((tool) => [tool.name, tool]));
    const requiredSuccessField = {
      orchestration_capabilities: "providerIds",
      orchestration_doctor: "providerProbes",
      orchestration_route: "decision",
      orchestration_plan: "plan",
      orchestration_spawn: "run",
      orchestration_status: "runId",
      orchestration_wait: "runId",
      orchestration_send: "parentRunId",
      orchestration_cancel: "runId",
      orchestration_cleanup: "cleaned",
      orchestration_decision_get: "runId",
      orchestration_decision_approve: "decision",
    };

    for (const [name, requiredField] of Object.entries(requiredSuccessField)) {
      const tool = tools.get(name);
      assert.ok(tool, `${name} missing`);
      assert.equal(tool.outputSchema.type, "object");
      assert.equal(tool.outputSchema.properties.schemaVersion.const, 1);
      assert.ok(tool.outputSchema.required.includes("schemaVersion"));
      assert.ok(tool.outputSchema.required.includes("data"));
      const success = successBranch(tool);
      assert.equal(success.type, "object", `${name} success data must be an object`);
      assert.ok(success.required.includes(requiredField), `${name} must require ${requiredField}`);
      assert.equal(success.additionalProperties !== false, true, `${name} must allow additive fields`);
    }

    for (const [name, itemField] of [["orchestration_list", "runId"], ["orchestration_events", "seq"]]) {
      const success = successBranch(tools.get(name));
      assert.equal(success.type, "array", `${name} success data must be an array`);
      assert.ok(success.items.required.includes(itemField), `${name} items must require ${itemField}`);
      assert.equal(success.items.additionalProperties !== false, true, `${name} items must allow additive fields`);
    }
  } finally {
    await fx.cleanup();
  }
});

test("concrete output schemas preserve serialized operation errors", async () => {
  const fx = await fixture();
  try {
    const capabilities = await fx.client.callTool({ name: "orchestration_capabilities", arguments: {} });
    assert.equal(capabilities.isError, undefined);
    assert.equal(capabilities.structuredContent.schemaVersion, 1);
    assert.ok(capabilities.structuredContent.data.providerIds.includes("codex"));

    const failed = await fx.client.callTool({
      name: "orchestration_plan",
      arguments: {
        consumerCwd: "/definitely/not/a/repository",
        intent: "implementation",
        task: "Exercise the serialized error envelope",
        protocolId: "single.v1",
        sessionMode: "oneshot",
      },
    });
    assert.equal(failed.isError, true);
    assert.equal(failed.structuredContent.schemaVersion, 1);
    assert.equal(typeof failed.structuredContent.data.code, "string");
    assert.equal(typeof failed.structuredContent.data.message, "string");
    assert.deepEqual(JSON.parse(failed.content[0].text), failed.structuredContent.data);
  } finally {
    await fx.cleanup();
  }
});

test("TM-352: orchestration_mailbox_wait returns a standing reply and refuses an unknown id", async () => {
  const { initTempRepo } = await import("../helpers/temp-repo.mjs");
  const repoRoot = await mkdtemp(join(os.tmpdir(), "ao-mcp-contract-repo-"));
  const repo = await initTempRepo(join(repoRoot, "repo"), { commit: true });
  // TM-465: only the sender may wait, so this server's session identity is the sender, lead0001.
  const saved = { AO_AGENT_ID: process.env.AO_AGENT_ID, AO_CONSUMER: process.env.AO_CONSUMER };
  Object.assign(process.env, { AO_AGENT_ID: "lead0001", AO_CONSUMER: repo });
  const fx = await fixture().finally(() => { for (const [key, value] of Object.entries(saved)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; } });
  try {
    const { sendStandingMessage, recordStandingReply } = await import("../../topology/lib/standing-mailbox.mjs");
    const { writeJson } = await import("../../topology/lib/util.mjs");
    const { agentsRoot } = await import("../../topology/lib/agents.mjs");
    const home = join(fx.root, "home");
    const env = { AGENT_ORCHESTRATION_STATE_HOME: fx.stateRoot };
    await writeJson(join(agentsRoot(repo), "lead0001", "agent.json"), { id: "lead0001", role: "lead", full_name: "lead0001" });
    const unknown = await fx.client.callTool({ name: "orchestration_mailbox_wait", arguments: { consumerCwd: repo, id: "no-such-id", timeoutMs: 100 } });
    assert.equal(unknown.isError, true, JSON.stringify(unknown.structuredContent));
    assert.equal(unknown.structuredContent.data.code, "TOPOLOGY_SENDER_MISMATCH");
    assert.equal((await sendStandingMessage({ id: "m-mcp", consumer: repo, fromProject: repo, from: "lead0001", to: "lead0001", body: "question" }, { env, home })).status, "delivered");
    const timedOut = await fx.client.callTool({ name: "orchestration_mailbox_wait", arguments: { consumerCwd: repo, id: "m-mcp", timeoutMs: 100, pollIntervalMs: 20 } });
    assert.equal(timedOut.isError, true);
    assert.equal(timedOut.structuredContent.data.code, "TOPOLOGY_MAILBOX_WAIT_TIMEOUT");
    assert.match(timedOut.structuredContent.data.message, /m-mcp/);
    await recordStandingReply({ consumer: repo, messageId: "m-mcp", agentId: "lead0001", body: "answer", home, env: { ...env, AO_AGENT_ID: "lead0001", AO_CONSUMER: repo } });
    const answered = await fx.client.callTool({ name: "orchestration_mailbox_wait", arguments: { consumerCwd: repo, id: "m-mcp", timeoutMs: 1000 } });
    assert.equal(answered.isError, undefined);
    assert.equal(answered.structuredContent.data.reply.body, "answer");
  } finally {
    await fx.cleanup();
    await rm(repoRoot, { recursive: true, force: true });
  }
});
