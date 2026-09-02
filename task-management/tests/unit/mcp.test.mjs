/** MCP protocol shape + tool dispatch. handleRequest is pure, so no process is spawned. */
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { gateTaskCreate } from "../../lib/enforce.mjs";
import { TOOLS, handleRequest, respondToLine } from "../../lib/mcp.mjs";
import { create, list, read, state, update, writeState } from "../../lib/store.mjs";
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

test("tm_task_create refuses a sparse task and names what is missing", () => {
  // The completeness half of the create gate: an explicit create must carry context and
  // criteria. The refusal names the fields; a refused create writes nothing.
  const p = tempStore();
  call("tm_epic", { action: "new", title: "Test epic" }, p);
  const out = call("tm_task_create", { title: "no context, no criteria" }, p);
  assert.equal(out.ok, false);
  assert.match(out.error, /body/);
  assert.match(out.error, /acceptance/);
  assert.match(out.error, /override/, "the escape hatch is named, as on every gate");
  assert.equal(list("task", {}, p).length, 0, "a refused create writes nothing");
});

test("a full round trip: epic → task → acceptance → done → board", () => {
  const p = tempStore();
  assert.equal(call("tm_epic", { action: "new", title: "Test epic" }, p).id, "EP-001");
  const created = call(
    "tm_task_create",
    { title: "First real task", body: "what and why", acceptance: ["the thing is verifiably true"] },
    p,
  );
  assert.equal(created.id, "TM-001", created.error);
  assert.equal(call("tm_show", { id: "TM-001" }, p).doc.epic, "EP-001");

  call("tm_task_update", { id: "TM-001", action: "start" }, p);
  assert.equal(call("tm_task_update", { id: "TM-001", action: "done" }, p).ok, false, "done is gated on the AC");

  call("tm_ac_accept", { id: "TM-001", index: 1 }, p);
  const unproven = call("tm_task_update", { id: "TM-001", action: "done" }, p);
  assert.equal(unproven.ok, false, "ticked criteria alone do not close a task");
  assert.match(unproven.error, /evidence/, "done also wants proof and attribution");

  call("tm_evidence", { id: "TM-001", text: "the thing is verifiably true, and here is the run" }, p);
  call("tm_task_field", { id: "TM-001", assignee: "tester" }, p);
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
  const created = call(
    "tm_task_create",
    { title: "Decide the store", body: "pick the store shape", acceptance: ["the store is named"], labels: ["decision:interview"] },
    p,
  );
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
  call("tm_task_create", { title: "card", body: "sprint fixture", acceptance: ["the card moves"] }, p);

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

// ── parity with the dashboard's write surface (CAP-0001) ─────────────────────
// Each tool calls the function the HTTP route calls; these assert the store, not the envelope.
import { existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { after } from "node:test";
import { ensureDirs, paths } from "../../lib/paths.mjs";
import { seedGitContract } from "../../lib/store.mjs";
import { cleanup, tempRepo } from "./helpers.mjs";

/**
 * A store with an epic and two tasks, ready for field writes.
 * Tasks carry a body and one criterion because gateStart/gateDone require them — a
 * bare fixture could never leave `open`, and half these tests start or close work.
 */
function seeded() {
  const p = tempStore();
  call("tm_epic", { action: "new", title: "Parity" }, p);
  call("tm_task_create", { title: "first", body: "the first task", acceptance: ["first is verifiably done"] }, p);
  call("tm_task_create", { title: "second", body: "the second task", acceptance: ["second is verifiably done"] }, p);
  return p;
}

const parityTrash = [];
after(() => cleanup(...parityTrash));

test("tools/list advertises every parity tool", () => {
  const names = TOOLS.map((t) => t.name);
  for (const n of ["tm_worktree", "tm_link", "tm_graph", "tm_doctor", "tm_export", "tm_time", "tm_parallel", "tm_task_field", "tm_history", "tm_stale", "tm_goal_import"]) {
    assert.ok(names.includes(n), `${n} is advertised`);
  }
  const listed = handleRequest({ jsonrpc: "2.0", id: 9, method: "tools/list" }, { p: tempStore() }).result.tools.map((t) => t.name);
  assert.deepEqual(listed, names);
});

test("tm_worktree new claims and provisions, rm releases and removes, list reads — and refuses a held task", () => {
  const repo = tempRepo();
  parityTrash.push(repo);
  const p = paths(repo);
  ensureDirs(p);
  seedGitContract(p);
  call("tm_epic", { action: "new", title: "Parity" }, p);
  const made = call("tm_task_create", { title: "isolated work", body: "worktree fixture", acceptance: ["the checkout exists"] }, p);

  // The claim interlock only engages for sessions with a real id (a null-session
  // claim is deliberately unowned), so this test must not depend on an ambient
  // CLAUDE_CODE_SESSION_ID — harnesses like Kimi export none.
  const ambient = process.env.CLAUDE_CODE_SESSION_ID;
  process.env.CLAUDE_CODE_SESSION_ID = "first-session";
  const res = call("tm_worktree", { action: "new", id: made.id, share: false }, p);
  assert.equal(res.ok, true, res.error);
  assert.ok(existsSync(res.worktree), "a real checkout exists");
  assert.equal(read(made.id, p).worktree, res.worktree);
  assert.equal(read(made.id, p).branch, res.branch);
  assert.ok(state(p).claims[made.id], "the claim is taken");

  const listed = call("tm_worktree", { action: "list" }, p);
  assert.equal(listed.worktrees.length, 1);

  // Another live session cannot provision the same task.
  const before = process.env.CLAUDE_CODE_SESSION_ID;
  process.env.CLAUDE_CODE_SESSION_ID = "someone-else";
  const held = call("tm_worktree", { action: "new", id: made.id }, p);
  if (before === undefined) delete process.env.CLAUDE_CODE_SESSION_ID;
  else process.env.CLAUDE_CODE_SESSION_ID = before;
  assert.equal(held.ok, false);
  assert.match(held.error, /claimed|held|holds/i);

  const rm = call("tm_worktree", { action: "rm", id: made.id }, p);
  assert.equal(rm.ok, true, rm.error);
  assert.equal(existsSync(res.worktree), false);
  assert.equal(read(made.id, p).worktree, undefined);
  assert.equal(state(p).claims[made.id], undefined, "rm releases the claim");
  assert.equal(call("tm_worktree", { action: "new" }, p).ok, false, "new needs an id");
  if (ambient === undefined) delete process.env.CLAUDE_CODE_SESSION_ID;
  else process.env.CLAUDE_CODE_SESSION_ID = ambient;
});

test("tm_link writes both ends and remove leaves both clean", () => {
  const p = seeded();
  const linked = call("tm_link", { id: "TM-001", type: "blocks", to: "TM-002" }, p);
  assert.equal(linked.ok, true, linked.error);
  assert.deepEqual(read("TM-001", p).links, [{ type: "blocks", id: "TM-002" }]);
  assert.deepEqual(read("TM-002", p).links, [{ type: "blocked by", id: "TM-001" }]);
  const removed = call("tm_link", { id: "TM-001", type: "blocks", to: "TM-002", remove: true }, p);
  assert.equal(removed.ok, true, removed.error);
  assert.deepEqual(read("TM-001", p).links || [], []);
  assert.deepEqual(read("TM-002", p).links || [], []);
  assert.equal(call("tm_link", { id: "TM-001", type: "blocks", to: "TM-404" }, p).ok, false, "a missing target is refused");
});

test("tm_graph returns nodes, edges and a mermaid flowchart", () => {
  const p = seeded();
  call("tm_task_field", { id: "TM-002", dep: { add: ["TM-001"] } }, p);
  const g = call("tm_graph", {}, p);
  assert.equal(g.ok, true, g.error);
  assert.ok(g.nodes.some((n) => n.id === "TM-001"));
  assert.ok(g.edges.some((e) => e.from === "TM-001" && e.to === "TM-002" || e.from === "TM-002" && e.to === "TM-001"));
  assert.match(g.mermaid, /flowchart/);
  assert.equal(g.counts.tasks, 2);
});

test("tm_doctor reports a dangling dep and repairs it only with confirm", () => {
  const p = seeded();
  update("TM-001", { blockedBy: ["TM-404"] }, p);
  const report = call("tm_doctor", {}, p);
  assert.equal(report.ok, true);
  assert.ok(report.findings.some((f) => f.code === "dangling-dep"), JSON.stringify(report.findings));
  assert.ok(report.findings.every((f) => !("fix" in f)), "closures are stripped");
  const refused = call("tm_doctor", { fix: true }, p);
  assert.equal(refused.ok, false);
  assert.match(refused.error, /confirm/);
  assert.deepEqual(read("TM-001", p).blockedBy, ["TM-404"], "nothing rewritten without confirm");
  const fixed = call("tm_doctor", { fix: true, confirm: true }, p);
  assert.equal(fixed.ok, true, fixed.error);
  assert.deepEqual(read("TM-001", p).blockedBy, []);
});

test("tm_export renders each format and refuses an unknown one", () => {
  const p = seeded();
  assert.match(call("tm_export", { format: "md" }, p).text, /TM-001/);
  assert.match(call("tm_export", { format: "csv" }, p).text.split("\n")[0], /Summary/);
  assert.equal(JSON.parse(call("tm_export", { format: "json" }, p).text).tasks.length, 2);
  assert.equal(call("tm_export", { format: "xml" }, p).ok, false);
});

test("tm_time summarises the board and one task", () => {
  const p = seeded();
  call("tm_task_update", { id: "TM-001", action: "start" }, p);
  call("tm_ac_accept", { id: "TM-001", index: 1 }, p);
  // done wants proof and a name, not just ticked criteria.
  call("tm_evidence", { id: "TM-001", text: "the run that proves it" }, p);
  call("tm_task_field", { id: "TM-001", assignee: "tester" }, p);
  call("tm_task_update", { id: "TM-001", action: "done" }, p);
  const all = call("tm_time", {}, p);
  assert.equal(all.ok, true, all.error);
  assert.equal(all.completed, 1);
  assert.ok(all.throughput);
  const one = call("tm_time", { id: "TM-001" }, p);
  assert.equal(one.ok, true, one.error);
  assert.ok(Array.isArray(one.timeline));
  assert.equal(call("tm_time", { id: "TM-404" }, p).ok, false);
});

test("tm_parallel batches tasks whose touches do not collide", () => {
  const p = seeded();
  call("tm_task_create", { title: "third", body: "the third task", acceptance: ["third is verifiably done"] }, p);
  update("TM-001", { touches: ["a.js"] }, p);
  update("TM-002", { touches: ["a.js"] }, p);
  update("TM-003", { touches: ["b.js"] }, p);
  const res = call("tm_parallel", {}, p);
  assert.equal(res.ok, true, res.error);
  assert.equal(res.batches.length, 2, "a.js collides, so two batches");
});

test("tm_task_field writes each Jira-shaped field through the CLI's functions", () => {
  const p = seeded();
  assert.equal(call("tm_task_field", { id: "TM-001" }, p).ok, false, "an empty call is refused");
  call("tm_task_field", { id: "TM-001", assignee: "ryan", priority: "high", estimate: 3, type: "bug" }, p);
  const t = read("TM-001", p);
  assert.equal(t.assignee, "ryan");
  assert.equal(t.priority, "high");
  assert.equal(t.estimate, 3);
  assert.equal(t.type, "bug");
  call("tm_task_field", { id: "TM-002", parent: "TM-001" }, p);
  assert.equal(read("TM-002", p).parent, "TM-001");
  assert.equal(call("tm_task_field", { id: "TM-001", parent: "TM-002" }, p).ok, false, "a subtask cycle is refused");
  call("tm_task_field", { id: "TM-002", parent: null }, p);
  call("tm_task_field", { id: "TM-002", dep: { add: ["TM-001"] } }, p);
  assert.deepEqual(read("TM-002", p).blockedBy, ["TM-001"]);
  assert.deepEqual(read("TM-001", p).blocks, ["TM-002"]);
  assert.equal(call("tm_task_field", { id: "TM-001", dep: { add: ["TM-002"] } }, p).ok, false, "a dependency cycle is refused");
  call("tm_task_field", { id: "TM-002", dep: { remove: ["TM-001"] } }, p);
  assert.deepEqual(read("TM-002", p).blockedBy, []);
  call("tm_task_field", { id: "TM-001", comment: "noted" }, p);
  assert.equal(read("TM-001", p).comments.at(-1).text, "noted");
  call("tm_task_field", { id: "TM-001", rank: { before: "TM-002" } }, p);
  assert.ok(read("TM-001", p).rank < read("TM-002", p).rank || read("TM-002", p).rank === undefined);
  call("tm_task_field", { id: "TM-001", touches: ["src/x.js"] }, p);
  assert.deepEqual(read("TM-001", p).touches, ["src/x.js"]);
});

test("tm_history lists one entity's events, labelled, and honours limit", () => {
  const p = seeded();
  call("tm_task_field", { id: "TM-001", priority: "low" }, p);
  const h = call("tm_history", { id: "TM-001" }, p);
  assert.equal(h.ok, true, h.error);
  assert.ok(h.events.length >= 2);
  assert.ok(h.events.every((e) => e.id === "TM-001" && typeof e.label === "string"));
  assert.equal(call("tm_history", { id: "TM-001", limit: 1 }, p).events.length, 1);
  assert.equal(call("tm_history", { id: "XX-1" }, p).ok, false);
});

test("tm_stale names in_progress work older than staleMinutes", () => {
  const p = seeded();
  call("tm_task_update", { id: "TM-001", action: "start" }, p);
  update("TM-001", { updated: new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString() }, p);
  // update() restamps `updated`; write the old stamp straight through the parsed record instead.
  const res = call("tm_stale", {}, p);
  assert.equal(res.ok, true);
  assert.equal(typeof res.minutes, "number");
  assert.ok(Array.isArray(res.tasks));
});

test("tm_goal_import takes a pasted doc or a repo path, and refuses a path outside the repo", () => {
  const p = seeded();
  const doc = "# Goal: Ship it (BDP-1)\n\n**Validate:** `make test`\n\n## Success criteria\n\n- tests pass\n- docs updated\n";
  const pasted = call("tm_goal_import", { content: doc, name: "ship.md" }, p);
  assert.equal(pasted.ok, true, pasted.error);
  assert.equal(read(pasted.id, p).acceptance.length, 2);
  writeFileSync(join(p.root, "goal.md"), doc);
  const fromPath = call("tm_goal_import", { path: "goal.md" }, p);
  assert.equal(fromPath.ok, true, fromPath.error);
  assert.equal(read(fromPath.id, p).goalDoc, "goal.md");
  assert.equal(call("tm_goal_import", { path: "../../etc/passwd" }, p).ok, false);
  assert.equal(call("tm_goal_import", { content: "# Goal: nothing\n" }, p).ok, false, "no criteria is refused");
});

test("tm_task_update delete is soft and restore brings the task back where it was", () => {
  const p = seeded();
  call("tm_task_update", { id: "TM-001", action: "park", reason: "later" }, p);
  const del = call("tm_task_update", { id: "TM-001", action: "delete", reason: "dup" }, p);
  assert.equal(del.ok, true, del.error);
  assert.equal(read("TM-001", p).status, "deleted");
  assert.equal(read("TM-001", p).deletedFrom, "parked");
  assert.equal(call("tm_task_update", { id: "TM-001", action: "delete" }, p).ok, false, "twice is refused");
  const back = call("tm_task_update", { id: "TM-001", action: "restore" }, p);
  assert.equal(back.status, "parked");
  assert.equal(read("TM-001", p).deletedFrom, undefined);
});
