/** MCP protocol shape + tool dispatch. handleRequest is pure, so no process is spawned. */
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { gateTaskCreate } from "../../lib/enforce.mjs";
import { TOOLS, handleRequest, respondToLine } from "../../lib/mcp.mjs";
import { tempStore } from "./helpers.mjs";

delete process.env.TM_ENFORCE;

/** The JSON payload a tools/call response carries in its single text block. */
function payload(res) {
  assert.equal(res.result.content.length, 1);
  assert.equal(res.result.content[0].type, "text");
  return JSON.parse(res.result.content[0].text);
}

const call = (name, args, p) =>
  payload(handleRequest({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } }, { p }));

test("initialize returns the handshake, versioned from the plugin manifest", () => {
  // Read the manifest rather than hardcoding the number. A literal here breaks on
  // every release and asserts nothing useful; comparing the two catches the bug that
  // actually matters — an MCP handshake advertising a different version than the
  // plugin it ships in.
  const manifest = JSON.parse(
    readFileSync(new URL("../../.claude-plugin/plugin.json", import.meta.url), "utf8"),
  );
  const res = handleRequest({ jsonrpc: "2.0", id: 0, method: "initialize" }, { p: tempStore() });
  assert.equal(res.id, 0);
  // Strict MCP clients (Grok) require serverInfo.version as a non-empty string. When the
  // manifest omits version (commit-SHA install identity), the server still fills a string —
  // never drop the field.
  assert.equal(typeof res.result.serverInfo.version, "string");
  assert.ok(res.result.serverInfo.version.length > 0, "serverInfo.version must not be empty");
  const expectedVersion =
    manifest.version != null && String(manifest.version).length > 0 ? String(manifest.version) : res.result.serverInfo.version;
  assert.deepEqual(res.result, {
    protocolVersion: "2024-11-05",
    // Both are MANDATORY declarations for the features we serve, and both empty because
    // neither sub-feature (subscribe, listChanged) is implemented.
    capabilities: { tools: {}, resources: {} },
    serverInfo: { name: "task-management", version: expectedVersion },
  });
  if (manifest.version != null && String(manifest.version).length > 0) {
    assert.equal(res.result.serverInfo.version, String(manifest.version));
  }
});

test("notifications/initialized is answered with nothing at all", () => {
  assert.equal(handleRequest({ jsonrpc: "2.0", method: "notifications/initialized" }, { p: tempStore() }), null);
});

test("tools/list advertises every tool with a JSON Schema", () => {
  const { tools } = handleRequest({ jsonrpc: "2.0", id: 2, method: "tools/list" }, { p: tempStore() }).result;
  assert.equal(tools.length, TOOLS.length);
  assert.ok(tools.length >= 15, `expected ~15 tools, got ${tools.length}`);
  for (const t of tools) {
    assert.match(t.name, /^tm_/);
    assert.ok(t.description.length > 20, `${t.name} needs a description that says when to use it`);
    assert.equal(t.inputSchema.type, "object");
    assert.equal(t.run, undefined, `${t.name} leaked its handler into the wire format`);
  }
});

test("unknown method is a JSON-RPC -32601", () => {
  // Not `resources/list` — that is a real method now. An unknown-method test has to name
  // something the server genuinely does not implement, or it silently stops testing
  // anything the day the method ships.
  const res = handleRequest({ jsonrpc: "2.0", id: 3, method: "completion/complete" }, { p: tempStore() });
  assert.equal(res.error.code, -32601);
  assert.equal(res.result, undefined);
});

test("an unparseable line is a JSON-RPC -32700 with a null id", () => {
  const res = respondToLine("{not json", { p: tempStore() });
  assert.equal(res.error.code, -32700);
  assert.equal(res.id, null);
});

test("blank lines produce no response", () => {
  assert.equal(respondToLine("   ", { p: tempStore() }), null);
});

test("tm_task_create with no active epic is denied with the CLI's own words", () => {
  const p = tempStore();
  const expected = gateTaskCreate(p).reason;
  const out = call("tm_task_create", { title: "orphan task" }, p);
  assert.equal(out.ok, false);
  assert.equal(out.error, expected);
});

test("a full round trip: epic → task → acceptance → done → board", () => {
  const p = tempStore();
  assert.equal(call("tm_epic", { action: "new", title: "Test epic" }, p).id, "EP-001");
  assert.equal(call("tm_task_create", { title: "First real task" }, p).id, "TM-001");
  assert.equal(call("tm_show", { id: "TM-001" }, p).doc.epic, "EP-001");

  call("tm_ac_add", { id: "TM-001", text: "the thing is verifiably true" }, p);
  call("tm_task_update", { id: "TM-001", action: "start" }, p);
  assert.equal(call("tm_task_update", { id: "TM-001", action: "done" }, p).ok, false, "done is gated on the AC");

  call("tm_ac_accept", { id: "TM-001", index: 1 }, p);
  assert.equal(call("tm_task_update", { id: "TM-001", action: "done" }, p).ok, true);
  assert.match(call("tm_board", {}, p).board, /1\/1 done/);
});

test("unknown tool names come back as a failed result, not a protocol error", () => {
  const out = call("tm_nope", {}, tempStore());
  assert.equal(out.ok, false);
  assert.match(out.error, /Unknown tool/);
});
