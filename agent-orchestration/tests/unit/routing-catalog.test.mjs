import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  MODEL_CATALOG,
  PROVIDER_ADAPTERS,
  PROVIDER_CATALOG,
} from "../../src/providers/index.mjs";
import { ROUTING_ALIASES } from "../../src/policy/index.mjs";

test("provider catalog exposes only canonical ACPX targets and no commands", () => {
  assert.deepEqual(
    PROVIDER_CATALOG.map((provider) => provider.providerId),
    ["claude", "codex", "grok-build", "kimi"],
  );
  for (const provider of PROVIDER_CATALOG) {
    assert.equal(provider.driverId, "acpx");
    assert.equal("command" in provider, false);
    assert.equal("args" in provider, false);
  }
});

test("documented model IDs are isolated from runtime-only Grok and Kimi defaults", () => {
  assert.equal(
    MODEL_CATALOG.find((model) => model.endpointId === "claude.fable-5-1")?.modelId,
    "claude-fable-5-1",
  );
  assert.equal(
    MODEL_CATALOG.find((model) => model.endpointId === "claude.opus-4-8")?.modelId,
    "claude-opus-4-8",
  );
  assert.equal(
    MODEL_CATALOG.find((model) => model.endpointId === "openai.gpt-5.6-sol")?.modelId,
    "gpt-5.6-sol",
  );
  assert.equal(
    MODEL_CATALOG.find((model) => model.endpointId === "grok-build.default")?.modelId,
    null,
  );
  assert.equal(
    MODEL_CATALOG.find((model) => model.endpointId === "kimi.default")?.modelId,
    null,
  );
});

test("bundled Claude ACP bridge isolates settings and forwards exact runtime model IDs", async () => {
  const bridge = await readFile(new URL("../../dist/claude-agent-acp.mjs", import.meta.url), "utf8");
  assert.doesNotMatch(bridge, /settingSources:\s*\["user",\s*"project",\s*"local"\]/, "bundled Claude sessions must not load consumer or user hooks before auth revocation");
  assert.match(bridge, /settingSources:\s*\[\]/, "bundled Claude sessions must explicitly isolate settings");
  assert.match(bridge, /setModel\(currentModel\.value\)/, "exact catalog IDs must be revalidated by the installed Claude harness");
});

test("bundled Codex bridge launches app-server without a shell", async () => {
  const bridge = await readFile(new URL("../../dist/codex-acp.mjs", import.meta.url), "utf8");
  assert.doesNotMatch(bridge, /spawn\(`"\$\{codexPath\}" app-server`,\s*\{\s*shell:\s*true/, "Windows Codex launch must not use cmd.exe");
  assert.match(bridge, /spawn\(codexPath,\s*\["app-server"\],\s*\{\s*env:\s*spawnEnv,\s*windowsHide:\s*true,\s*shell:\s*false\s*\}\)/);
});

test("default aliases preserve the agreed architecture, design, and implementation order", () => {
  assert.deepEqual(ROUTING_ALIASES["architecture.proposal"], [
    { endpointId: "claude.fable-5-1", effort: "max" },
    { endpointId: "claude.opus-5", effort: "max" },
    { endpointId: "claude.opus-4-8", effort: "max" },
  ]);
  assert.equal(ROUTING_ALIASES["architecture.critique"][0].endpointId, "openai.gpt-5.6-sol");
  assert.equal(ROUTING_ALIASES["design.default"][0].endpointId, "claude.fable-5-1");
  assert.equal(ROUTING_ALIASES["implementation.default"][0].endpointId, "openai.gpt-5.6-sol");
  assert.ok(ROUTING_ALIASES["implementation.default"].some((candidate) => candidate.endpointId === "claude.fable-5-1"));
});

test("provider capabilities and sandbox credential inputs are explicit metadata", () => {
  const claude = PROVIDER_CATALOG.find((provider) => provider.providerId === "claude");
  const codex = PROVIDER_CATALOG.find((provider) => provider.providerId === "codex");
  assert.equal(claude.capabilities.persistent_session, "supported");
  assert.equal(codex.capabilities.persistent_session, "unknown");
  assert.equal(codex.capabilities.image_generation, "supported");
  const grok = PROVIDER_CATALOG.find((provider) => provider.providerId === "grok-build");
  assert.equal(grok.capabilities.tools, "supported");
  assert.equal(grok.capabilities.workspace_read, "supported");
  assert.equal(grok.capabilities.workspace_write, "supported");
  assert.equal(grok.capabilities.persistent_session, "unknown");
  const kimi = PROVIDER_CATALOG.find((provider) => provider.providerId === "kimi");
  assert.equal(kimi.capabilities.workspace_read, "supported");
  assert.equal(kimi.capabilities.workspace_write, "unknown");
  assert.equal(kimi.capabilities.persistent_session, "unknown");

  assert.deepEqual(PROVIDER_ADAPTERS.claude.sandboxHome, {
    env: "CLAUDE_CONFIG_DIR",
    sourceDir: ".claude",
    bootstrapFiles: [".credentials.json"],
  });
  for (const adapter of Object.values(PROVIDER_ADAPTERS)) {
    assert.deepEqual(adapter.credentialEnv, [], "provider secrets must never cross through process argv");
    assert.ok(adapter.executableRoots.length >= 3, "provider executable authority roots must be explicit");
  }
});
