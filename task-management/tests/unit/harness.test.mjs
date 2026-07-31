/**
 * Harness Bridge: adapters translate wire → intents; apply is harness-agnostic.
 * Parity with Claude TaskCreate/TaskUpdate fixtures from test-hooks.sh.
 */
import { strict as assert } from "node:assert";
import { test } from "node:test";
import { adapterFor, preCreateGate, toIntents } from "../../lib/harness/index.mjs";
import { applyIntents } from "../../lib/harness/apply.mjs";
import { create, list, state, writeState } from "../../lib/store.mjs";
import { tempStore } from "./helpers.mjs";

const stamp = () => ({ session: "t", branch: "main" });

test("strategy map selects Claude adapter for TaskCreate/TaskUpdate", () => {
  assert.equal(adapterFor({ tool_name: "TaskCreate" })?.toIntents.name, adapterFor({ tool_name: "TaskUpdate" })?.toIntents.name);
  assert.ok(adapterFor({ tool_name: "todo_write" }));
  assert.equal(adapterFor({ tool_name: "Bash" }), null);
});

test("Claude TaskCreate intent preserves subject, body, native id", () => {
  const intents = toIntents({
    tool_name: "TaskCreate",
    tool_input: { subject: "Mirrored task", description: "the body", activeForm: "Mirroring" },
    tool_response: { id: "42" },
  });
  assert.equal(intents.length, 1);
  assert.deepEqual(intents[0], {
    op: "create",
    title: "Mirrored task",
    body: "the body",
    nativeId: "42",
    activeForm: "Mirroring",
    via: "claude",
  });
});

test("Claude TaskUpdate maps completed → done", () => {
  const intents = toIntents({
    tool_name: "TaskUpdate",
    tool_input: { taskId: "42", status: "completed" },
  });
  assert.equal(intents[0].op, "update");
  assert.equal(intents[0].nativeId, "42");
  assert.equal(intents[0].status, "done");
});

test("Grok todo_write produces update intents keyed grok-todo:<id>", () => {
  const intents = toIntents({
    tool_name: "todo_write",
    tool_input: {
      todos: [
        { id: "a1", content: "Ship harness", status: "pending" },
        { id: "a2", content: "Write tests", status: "in_progress" },
      ],
    },
  });
  assert.equal(intents.length, 2);
  assert.equal(intents[0].nativeId, "grok-todo:a1");
  assert.equal(intents[0].status, "open");
  assert.equal(intents[1].status, "in_progress");
  assert.equal(intents[1].title, "Write tests");
});

test("apply Claude create+update mirrors test-hooks parity", () => {
  const p = tempStore();
  const epic = create("epic", { title: "Hook epic" }, "", p);
  writeState({ activeEpic: epic.id }, p);

  applyIntents(
    toIntents({
      tool_name: "TaskCreate",
      tool_input: { subject: "Mirrored task", description: "the body", activeForm: "Mirroring" },
      tool_response: { id: "42" },
    }),
    { p, stamp },
  );
  let tasks = list("task", {}, p);
  assert.equal(tasks.length, 1);
  assert.equal(tasks[0].title, "Mirrored task");
  assert.equal(tasks[0].nativeId, "42");
  assert.equal(tasks[0].status, "open");

  applyIntents(
    toIntents({ tool_name: "TaskUpdate", tool_input: { taskId: "42", status: "in_progress" } }),
    { p, stamp },
  );
  assert.equal(list("task", {}, p)[0].status, "in_progress");

  applyIntents(
    toIntents({ tool_name: "TaskUpdate", tool_input: { taskId: "42", status: "completed" } }),
    { p, stamp },
  );
  assert.equal(list("task", {}, p)[0].status, "done");
});

test("apply Grok todos creates then completes by native id", () => {
  const p = tempStore();
  create("epic", { title: "G" }, "", p);
  writeState({ activeEpic: list("epic", {}, p)[0].id }, p);

  applyIntents(
    toIntents({
      tool_name: "todo_write",
      tool_input: { todos: [{ id: "t1", content: "Grok item", status: "pending" }] },
    }),
    { p, stamp },
  );
  let t = list("task", {}, p)[0];
  assert.equal(t.nativeId, "grok-todo:t1");
  assert.equal(t.status, "open");

  applyIntents(
    toIntents({
      tool_name: "todo_write",
      tool_input: { todos: [{ id: "t1", content: "Grok item", status: "completed" }] },
    }),
    { p, stamp },
  );
  t = list("task", {}, p)[0];
  assert.equal(t.status, "done");
  assert.equal(list("task", {}, p).length, 1, "same native id does not duplicate");
});

test("preCreateGate denies TaskCreate and create-ish todo_write without epic", () => {
  const p = tempStore();
  const d1 = preCreateGate({ tool_name: "TaskCreate", tool_input: { subject: "x" } }, p);
  assert.equal(d1.allow, false);
  assert.equal(d1.denyPayload.decision, "deny");
  assert.equal(d1.denyPayload.hookSpecificOutput.permissionDecision, "deny");

  const d2 = preCreateGate(
    { tool_name: "todo_write", tool_input: { todos: [{ id: "1", content: "x", status: "pending" }] } },
    p,
  );
  assert.equal(d2.allow, false);

  // pure progress update on completed work should not require epic for gate purpose
  // (wouldCreate is false when only in_progress/completed with ids — still true for pending)
  const d3 = preCreateGate(
    {
      tool_name: "todo_write",
      tool_input: { todos: [{ id: "1", content: "x", status: "completed" }], merge: true },
    },
    p,
  );
  assert.equal(d3.allow, true);
});

test("preCreateGate allows TaskCreate once an epic is active", () => {
  const p = tempStore();
  const e = create("epic", { title: "E" }, "", p);
  writeState({ activeEpic: e.id }, p);
  assert.equal(state(p).activeEpic, e.id);
  const d = preCreateGate({ tool_name: "TaskCreate" }, p);
  assert.equal(d.allow, true);
});

test("Codex update_plan intents use stable step hashes", () => {
  const a = toIntents({
    tool_name: "update_plan",
    tool_input: {
      explanation: "kickoff",
      plan: [
        { step: "Implement the adapter", status: "pending" },
        { step: "Write tests", status: "in_progress" },
      ],
    },
  });
  assert.equal(a.length, 2);
  assert.match(a[0].nativeId, /^codex-plan:[0-9a-f]{12}$/);
  assert.equal(a[0].title, "Implement the adapter");
  assert.equal(a[0].status, "open");
  assert.equal(a[1].status, "in_progress");
  // Same step text → same nativeId across calls
  const b = toIntents({
    tool_name: "update_plan",
    tool_input: { plan: [{ step: "Implement the adapter", status: "completed" }] },
  });
  assert.equal(b[0].nativeId, a[0].nativeId);
  assert.equal(b[0].status, "done");
});

test("apply Codex plan creates then completes without duplicates", () => {
  const p = tempStore();
  create("epic", { title: "C" }, "", p);
  writeState({ activeEpic: list("epic", {}, p)[0].id }, p);

  applyIntents(
    toIntents({
      tool_name: "update_plan",
      tool_input: { plan: [{ step: "Codex step", status: "pending" }] },
    }),
    { p, stamp },
  );
  assert.equal(list("task", {}, p).length, 1);
  assert.match(list("task", {}, p)[0].nativeId, /^codex-plan:/);

  applyIntents(
    toIntents({
      tool_name: "update_plan",
      tool_input: { plan: [{ step: "Codex step", status: "completed" }] },
    }),
    { p, stamp },
  );
  assert.equal(list("task", {}, p).length, 1);
  assert.equal(list("task", {}, p)[0].status, "done");
});

test("preCreateGate denies create-ish update_plan without epic", () => {
  const p = tempStore();
  const d = preCreateGate(
    { tool_name: "update_plan", tool_input: { plan: [{ step: "x", status: "pending" }] } },
    p,
  );
  assert.equal(d.allow, false);
});
