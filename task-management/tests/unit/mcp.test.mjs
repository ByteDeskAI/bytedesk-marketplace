/** MCP protocol shape + tool dispatch. handleRequest is pure, so no process is spawned. */
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { gateTaskCreate } from "../../lib/enforce.mjs";
import { TOOLS, handleRequest, respondToLine } from "../../lib/mcp.mjs";
import { create, read, state, update, writeState } from "../../lib/store.mjs";
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

test("the handshake identifies the code, not merely 'dev'", () => {
  // `dev` was honest and useless: every build said it, so a client could not tell which code it
  // was talking to — the only reason the handshake carries a version at all. An installed copy
  // reads the SHA out of its own path; a source checkout asks git, and lets it say `-dirty`,
  // because a client comparing two handshakes should see that they differ.
  const res = handleRequest({ jsonrpc: "2.0", id: 0, method: "initialize" }, { p: tempStore() });
  const v = res.result.serverInfo.version;
  assert.notEqual(v, "dev", "a source checkout can answer this from git");
  assert.match(v, /[0-9a-f]{7}/i, "and the answer names a commit");
});

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

test("tm_label catalog, exclusive roles, and create-time labels", () => {
  const p = tempStore();
  const catalog = call("tm_label", {}, p);
  assert.equal(catalog.ok, true);
  assert.ok(catalog.catalog.includes("decision:interview"));
  assert.ok(catalog.catalog.includes("ready-for-agent"));

  call("tm_epic", { action: "new", title: "Map" }, p);
  const created = call("tm_task_create", { title: "Decide the store", labels: ["decision:interview"] }, p);
  assert.deepEqual(created.labels, ["decision:interview"]);

  call("tm_label", { id: created.id, add: ["ready-for-agent"] }, p);
  const after = call("tm_label", { id: created.id, add: ["needs-triage"] }, p);
  assert.ok(after.labels.includes("needs-triage"));
  assert.equal(after.labels.includes("ready-for-agent"), false, "triage roles are exclusive");

  const bad = call("tm_label", { id: created.id, add: ["decision:grilling"] }, p);
  assert.equal(bad.ok, false);
  assert.match(bad.error, /unknown decision label/);

  const mapOnTask = call("tm_label", { id: created.id, add: ["decision:map"] }, p);
  assert.equal(mapOnTask.ok, false);
  assert.match(mapOnTask.error, /epics only/);

  const onEpic = call("tm_label", { id: "EP-001", add: ["decision:map"] }, p);
  assert.equal(onEpic.ok, true);
  assert.deepEqual(onEpic.labels, ["decision:map"]);
});

test("tm_epic use refuses a done epic, same words as the dashboard 409", () => {
  const p = tempStore();
  const e = create("epic", { title: "shipped" }, "", p);
  writeState({ activeEpic: e.id }, p);
  const closed = call("tm_epic", { action: "done", id: e.id }, p);
  assert.equal(closed.ok, true);
  assert.ok(read(e.id, p).closed, "done writes the closed timestamp");
  assert.equal(state(p).activeEpic, null);

  const out = call("tm_epic", { action: "use", id: e.id }, p);
  assert.equal(out.ok, false);
  assert.match(out.error, /done — reopen/);
  assert.equal(state(p).activeEpic, null, "a refused use must not have changed the pointer");
});

test("tm_epic use of an already-open epic still works", () => {
  const p = tempStore();
  call("tm_epic", { action: "new", title: "live" }, p);
  update("EP-001", { status: "done", closed: new Date().toISOString() }, p);
  const other = create("epic", { title: "next" }, "", p);
  const out = call("tm_epic", { action: "use", id: other.id }, p);
  assert.equal(out.ok, true);
  assert.equal(state(p).activeEpic, other.id);
});

test("unknown tool names come back as a failed result, not a protocol error", () => {
  const out = call("tm_nope", {}, tempStore());
  assert.equal(out.ok, false);
  assert.match(out.error, /Unknown tool/);
});

test("tm_sprint mirrors the CLI verbs on the same store functions", () => {
  const p = tempStore();
  const noActive = call("tm_sprint", { action: "show" }, p);
  assert.equal(noActive.ok, false);
  assert.match(noActive.error, /no active sprint/);

  const created = call("tm_sprint", { action: "new", title: "Sprint 12", ends: "2026-08-28" }, p);
  assert.equal(created.ok, true);
  assert.equal(created.id, "SP-001");
  assert.equal(state(p).activeSprint, "SP-001");
  assert.equal(read("SP-001", p).ends, "2026-08-28");

  const listed = call("tm_sprint", { action: "list" }, p);
  assert.equal(listed.ok, true);
  assert.equal(listed.sprints.length, 1);
  assert.equal(listed.activeSprint, "SP-001");

  call("tm_epic", { action: "new", title: "wave" }, p);
  call("tm_task_create", { title: "card" }, p);

  const added = call("tm_sprint", { action: "add", tasks: ["TM-001"] }, p);
  assert.equal(added.ok, true);
  assert.equal(read("TM-001", p).sprint, "SP-001");

  const shown = call("tm_sprint", { action: "show" }, p);
  assert.equal(shown.ok, true);
  assert.equal(shown.doc.id, "SP-001");
  assert.ok(typeof shown.report === "string" && shown.report.length);

  const rm = call("tm_sprint", { action: "rm", tasks: ["TM-001"] }, p);
  assert.equal(rm.ok, true);
  assert.equal(read("TM-001", p).sprint, undefined);

  call("tm_sprint", { action: "add", tasks: ["TM-001"] }, p);
  const closed = call("tm_sprint", { action: "done" }, p);
  assert.equal(closed.ok, true);
  assert.equal(read("SP-001", p).status, "done");
  assert.ok(read("SP-001", p).closed);
  assert.equal(state(p).activeSprint, null);
  assert.equal(read("TM-001", p).sprint, "SP-001", "closing must not evaporate unfinished work");
});

test("tm_sprint add without an active sprint is refused with the CLI's words", () => {
  const p = tempStore();
  const out = call("tm_sprint", { action: "add", tasks: ["TM-001"] }, p);
  assert.equal(out.ok, false);
  assert.match(out.error, /no active sprint/);
});

test("tm_cap_drop records the reason and keeps the card readable", () => {
  const p = tempStore();
  const proposed = call("tm_cap_propose", { title: "Speculative rewrite" }, p);
  assert.equal(proposed.ok, true);
  assert.equal(proposed.id, "CAP-0001");

  const dropped = call("tm_cap_drop", { id: proposed.id, why: "not this year" }, p);
  assert.equal(dropped.ok, true);
  assert.equal(dropped.status, "deleted");
  assert.equal(read(proposed.id, p).status, "deleted");
  assert.equal(read(proposed.id, p).droppedReason, "not this year");
});
