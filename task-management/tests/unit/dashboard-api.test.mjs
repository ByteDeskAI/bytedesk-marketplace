/**
 * TM-026 — the dashboard becomes a write surface.
 *
 * The rule that matters: every write goes through the same lib functions the CLI
 * uses, so the gates, the event log and the markdown files stay authoritative no
 * matter who called. These tests assert on the *store*, not on status codes —
 * a 200 that didn't change a file is the failure mode worth catching.
 */
import { after, describe, it } from "node:test";
import assert from "node:assert/strict";
import { cleanup, tempStore } from "./helpers.mjs";
import { backlog as backlogOf, handleWrite } from "../../lib/dashboard-api.mjs";
import { create, read, readEvents, state, update, writeConfig, writeState } from "../../lib/store.mjs";

const stores = [];
function store() {
  const p = tempStore();
  stores.push(p.root);
  writeConfig({ requireEpic: false, requireAcceptance: true, wipLimit: 99 }, p);
  return p;
}
after(() => cleanup(...stores));

const act = (p, { action, id, ...body }) =>
  handleWrite("POST", id ? `/api/task/${id}/${action}` : "/api/task", body, { p });
const task = (p, title = "a task", fields = {}) => create("task", { title, acceptance: [], ...fields }, "", p);

describe("transitions", () => {
  it("moves a task and records it", () => {
    const p = store();
    const t = task(p);
    const res = act(p, { action: "transition", id: t.id, status: "in_progress"  });
    assert.equal(res.status, 200);
    assert.equal(read(t.id, p).status, "in_progress", "the markdown file is the assertion, not the response");
    assert.ok(readEvents(p).some((e) => e.id === t.id && e.event === "update"));
  });

  it("enforces the acceptance gate exactly like the CLI", () => {
    const p = store();
    const t = task(p, "gated", { acceptance: [{ text: "prove it", done: false }] });
    const res = act(p, { action: "transition", id: t.id, status: "done"  });
    assert.equal(res.status, 409, "a gate refusal is a conflict, not a crash");
    assert.match(res.body.error, /acceptance/i, "and the UI must be able to show why");
    assert.equal(read(t.id, p).status, "open", "a refused transition must not have changed anything");
  });

  it("releases the claim when work leaves in_progress", () => {
    const p = store();
    const t = task(p);
    act(p, { action: "transition", id: t.id, status: "in_progress"  });
    writeState({ claims: { [t.id]: { session: "s1", ts: new Date().toISOString() } } }, p);
    act(p, { action: "transition", id: t.id, status: "parked"  });
    assert.deepEqual(state(p).claims, {}, "a parked card cannot keep holding a lock");
  });

  it("rejects a status that is not a real one", () => {
    const p = store();
    const t = task(p);
    assert.equal(act(p, { action: "transition", id: t.id, status: "almost-done"  }).status, 400);
  });
});

describe("field edits", () => {
  it("assigns, labels, prioritises, estimates and comments", () => {
    const p = store();
    const t = task(p);
    act(p, { action: "assign", id: t.id, assignee: "@mcp"  });
    act(p, { action: "labels", id: t.id, add: ["ui", "ui", "urgent"]  });
    act(p, { action: "priority", id: t.id, priority: "high"  });
    act(p, { action: "estimate", id: t.id, estimate: 3  });
    act(p, { action: "comment", id: t.id, text: "picked this up"  });

    const after = read(t.id, p);
    assert.equal(after.assignee, "@mcp");
    assert.deepEqual(after.labels, ["ui", "urgent"]);
    assert.equal(after.priority, "high");
    assert.equal(after.estimate, 3);
    assert.equal(after.comments.length, 1);
  });

  it("passes a bad value's reason back instead of throwing", () => {
    const p = store();
    const t = task(p);
    const res = act(p, { action: "priority", id: t.id, priority: "urgentish"  });
    assert.equal(res.status, 400);
    assert.match(res.body.error, /priority/i);
  });

  it("edits title and body", () => {
    const p = store();
    const t = task(p);
    handleWrite("PATCH", `/api/task/${t.id}`, { title: "renamed", body: "fuller context" }, { p });
    const after = read(t.id, p);
    assert.equal(after.title, "renamed");
    assert.match(after.body, /fuller context/);
  });
});

describe("hierarchy and ordering", () => {
  it("links two tasks from one call, both ends", () => {
    const p = store();
    const a = task(p, "cause");
    const b = task(p, "symptom");
    act(p, { action: "link", id: a.id, type: "causes", to: b.id  });
    assert.deepEqual(read(b.id, p).links, [{ type: "caused by", id: a.id }]);
  });

  it("nests a subtask and refuses a cycle", () => {
    const p = store();
    const a = task(p, "parent");
    const b = task(p, "child");
    act(p, { action: "subtask", id: b.id, parent: a.id  });
    assert.equal(read(b.id, p).parent, a.id);
    assert.equal(act(p, { action: "subtask", id: a.id, parent: b.id  }).status, 400);
  });

  it("reorders the backlog by dropping one card above another", () => {
    const p = store();
    const a = task(p, "first");
    const b = task(p, "second");
    const c = task(p, "third");
    act(p, { action: "rank", id: c.id, before: a.id  });
    const order = backlogOf(p).map((t) => t.id);
    assert.deepEqual(order, [c.id, a.id, b.id]);
  });
});

describe("creation", () => {
  it("creates a task and honours the active epic", () => {
    const p = store();
    const epic = create("epic", { title: "current" }, "", p);
    writeState({ activeEpic: epic.id }, p);
    const res = handleWrite("POST", "/api/task", { title: "born on the board" }, { p });
    assert.equal(res.status, 201);
    assert.equal(read(res.body.id, p).epic, epic.id);
  });

  it("refuses creation when the epic gate says so", () => {
    const p = store();
    writeConfig({ requireEpic: true }, p);
    writeState({ activeEpic: null }, p);
    const res = handleWrite("POST", "/api/task", { title: "orphan" }, { p });
    assert.equal(res.status, 409);
    assert.match(res.body.error, /epic/i);
  });

  it("refuses an empty title", () => {
    const p = store();
    assert.equal(handleWrite("POST", "/api/task", { title: "  " }, { p }).status, 400);
  });
});

describe("bulk edit", () => {
  it("applies one operation across many tasks and reports per-task results", () => {
    const p = store();
    const a = task(p, "one");
    const b = task(p, "two");
    const res = handleWrite("POST", "/api/bulk", { ids: [a.id, b.id], op: "labels", args: { add: ["sprint-4"] } }, { p });
    assert.equal(res.status, 200);
    assert.equal(res.body.ok.length, 2);
    assert.deepEqual(read(b.id, p).labels, ["sprint-4"]);
  });

  it("keeps going when one item fails, and says which", () => {
    const p = store();
    const a = task(p, "fine");
    const res = handleWrite("POST", "/api/bulk", { ids: [a.id, "TM-999"], op: "assign", args: { assignee: "ryan" } }, { p });
    assert.equal(res.body.ok.length, 1);
    assert.equal(res.body.failed.length, 1);
    assert.match(res.body.failed[0].error, /not found/i);
    assert.equal(read(a.id, p).assignee, "ryan", "one bad id must not roll back the good work");
  });
});

describe("safety", () => {
  it("404s an unknown route and an unknown task", () => {
    const p = store();
    assert.equal(handleWrite("POST", "/api/nonsense", {}, { p }).status, 404);
    assert.equal(handleWrite("POST", "/api/task/TM-999/assign", { assignee: "x" }, { p }).status, 404);
  });

  it("refuses a task id that isn't one", () => {
    const p = store();
    assert.equal(handleWrite("POST", "/api/task/..%2f..%2fetc/assign", { assignee: "x" }, { p }).status, 400);
  });
});
