import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import { join } from "node:path";
import test from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createServer } from "../../src/mcp.mjs";

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

test("MCP plan and spawn expose protocols while route remains a single-route preview", async () => {
  const fx = await fixture();
  try {
    const tools = new Map((await fx.client.listTools()).tools.map((tool) => [tool.name, tool]));
    const route = tools.get("ao_route");
    const plan = tools.get("ao_plan");
    const spawn = tools.get("ao_spawn");

    assert.ok(route && plan && spawn);
    assert.equal(route.inputSchema.properties.protocolId, undefined);
    for (const tool of [plan, spawn]) {
      assert.deepEqual(tool.inputSchema.properties.protocolId.enum, ["single.v1", "architecture.adversarial.v1"]);
      assert.deepEqual(tool.inputSchema.properties.sessionMode.enum, ["oneshot", "persistent"]);
      assert.equal(tool.inputSchema.required.includes("protocolId"), false);
      assert.equal(tool.inputSchema.required.includes("sessionMode"), false);
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
      ao_capabilities: "providerIds",
      ao_doctor: "providerProbes",
      ao_route: "decision",
      ao_plan: "plan",
      ao_spawn: "run",
      ao_status: "runId",
      ao_wait: "runId",
      ao_send: "parentRunId",
      ao_cancel: "runId",
      ao_cleanup: "cleaned",
      ao_decision_get: "runId",
      ao_decision_approve: "decision",
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

    for (const [name, itemField] of [["ao_list", "runId"], ["ao_events", "seq"]]) {
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
    const capabilities = await fx.client.callTool({ name: "ao_capabilities", arguments: {} });
    assert.equal(capabilities.isError, undefined);
    assert.equal(capabilities.structuredContent.schemaVersion, 1);
    assert.ok(capabilities.structuredContent.data.providerIds.includes("codex"));

    const failed = await fx.client.callTool({
      name: "ao_plan",
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
