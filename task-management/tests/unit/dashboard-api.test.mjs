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
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { cleanup, tempStore } from "./helpers.mjs";
import { backlog as backlogOf, boardPayload, handleWrite } from "../../lib/dashboard-api.mjs";
import { create, list, read, readEvents, state, update, writeConfig, writeState } from "../../lib/store.mjs";
import { seedTemplates } from "../../lib/templates.mjs";

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

describe("the active epic", () => {
  it("switches it, in the store, with the same event the CLI logs", () => {
    const p = store();
    const first = create("epic", { title: "first" }, "", p);
    const second = create("epic", { title: "second" }, "", p);
    writeState({ activeEpic: first.id }, p);

    const res = handleWrite("POST", "/api/epic", { id: second.id }, { p });

    assert.equal(res.status, 200);
    assert.equal(state(p).activeEpic, second.id, "a 200 that did not change state.json is the failure to catch");
    assert.ok(readEvents(p).some((e) => e.event === "epic_active" && e.id === second.id));
  });

  it("gates the next task creation on what it just set", () => {
    // This is the whole reason the route exists: requireEpic reads state.activeEpic.
    const p = store();
    writeConfig({ requireEpic: true }, p);
    const e = create("epic", { title: "real" }, "", p);
    assert.equal(handleWrite("POST", "/api/task", { title: "before" }, { p }).status, 409);

    handleWrite("POST", "/api/epic", { id: e.id }, { p });

    assert.equal(handleWrite("POST", "/api/task", { title: "after" }, { p }).status, 201);
  });

  it("refuses an epic that does not exist", () => {
    const p = store();
    assert.equal(handleWrite("POST", "/api/epic", { id: "EP-404" }, { p }).status, 404);
    assert.equal(state(p).activeEpic ?? null, null);
  });

  it("refuses a closed epic, which would silently gate every later create", () => {
    const p = store();
    const e = create("epic", { title: "shipped" }, "", p);
    update(e.id, { status: "done" }, p);

    const res = handleWrite("POST", "/api/epic", { id: e.id }, { p });

    assert.equal(res.status, 409);
    assert.match(res.body.error, /done/);
  });

  it("clears it when asked, rather than treating null as an error", () => {
    const p = store();
    const e = create("epic", { title: "real" }, "", p);
    handleWrite("POST", "/api/epic", { id: e.id }, { p });

    assert.equal(handleWrite("POST", "/api/epic", { id: null }, { p }).status, 200);
    assert.equal(state(p).activeEpic, null);
  });

  it("creates from { title } without colliding with { id } activate", () => {
    const p = store();
    const res = handleWrite("POST", "/api/epic", { title: "from the board", body: "context" }, { p });
    assert.equal(res.status, 201);
    assert.equal(res.body.id, "EP-001");
    assert.equal(state(p).activeEpic, "EP-001", "create sets the new epic active");
    assert.match(read("EP-001", p).body, /context/);
    assert.ok(readEvents(p).some((e) => e.event === "epic_active" && e.id === "EP-001"));
  });

  it("treats { id } as activate even when a title is also present", () => {
    const p = store();
    const existing = create("epic", { title: "already here" }, "", p);
    const before = listEpics(p);
    const res = handleWrite("POST", "/api/epic", { id: existing.id, title: "must not create" }, { p });
    assert.equal(res.status, 200);
    assert.equal(state(p).activeEpic, existing.id);
    assert.equal(listEpics(p), before, "a title next to an id must not mint a second epic");
  });

  it("refuses an empty title on create", () => {
    const p = store();
    assert.equal(handleWrite("POST", "/api/epic", { title: "  " }, { p }).status, 400);
    assert.equal(state(p).activeEpic ?? null, null);
  });
});

function listEpics(p) {
  return boardPayload(p).epics.map((e) => e.id).join(",");
}

describe("epic detail and close/reopen", () => {
  it("returns the full epic including body", () => {
    const p = store();
    const e = create("epic", { title: "with body" }, "the markdown the list must not ship", p);
    const res = handleWrite("GET", `/api/epic/${e.id}`, {}, { p });
    assert.equal(res.status, 200);
    assert.match(res.body.body, /the markdown/);
    assert.equal(res.body.title, "with body");
  });

  it("keeps /api/board body-stripped", () => {
    const p = store();
    create("epic", { title: "with body" }, "secret context", p);
    const [e] = boardPayload(p).epics;
    assert.equal("body" in e, false, "the list is the thing that stays small");
    assert.equal(e.title, "with body");
  });

  it("leaves GET /api/task/EP-* as 400 — requireTask stays on the task surface", () => {
    const p = store();
    const e = create("epic", { title: "not a task" }, "belongs at /api/epic", p);
    const res = handleWrite("GET", `/api/task/${e.id}`, {}, { p });
    assert.equal(res.status, 400);
    assert.match(res.body.error, /not a task id/);
    assert.equal(handleWrite("POST", `/api/task/${e.id}/transition`, { status: "done" }, { p }).status, 400);
  });

  it("closes with a timestamp and clears the active pointer", () => {
    const p = store();
    const e = create("epic", { title: "ship it" }, "", p);
    writeState({ activeEpic: e.id }, p);

    const res = handleWrite("POST", `/api/epic/${e.id}/close`, {}, { p });

    assert.equal(res.status, 200);
    const after = read(e.id, p);
    assert.equal(after.status, "done");
    assert.ok(after.closed, "tm epic done and the drawer both write closed");
    assert.equal(state(p).activeEpic, null);
  });

  it("reopens through reopenEpic, dropping closed", () => {
    const p = store();
    const e = create("epic", { title: "shipped" }, "", p);
    update(e.id, { status: "done", closed: "2026-01-01T00:00:00.000Z" }, p);

    const res = handleWrite("POST", `/api/epic/${e.id}/reopen`, {}, { p });

    assert.equal(res.status, 200);
    assert.equal(read(e.id, p).status, "open");
    assert.equal(read(e.id, p).closed, undefined);
    assert.ok(readEvents(p).some((ev) => ev.event === "epic_reopened" && ev.id === e.id));
  });

  it("activating a done epic is still 409 after close", () => {
    const p = store();
    const e = create("epic", { title: "shipped" }, "", p);
    handleWrite("POST", `/api/epic/${e.id}/close`, {}, { p });
    const res = handleWrite("POST", "/api/epic", { id: e.id }, { p });
    assert.equal(res.status, 409);
    assert.match(res.body.error, /done/);
  });
});

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

  it("sets type through POST /type", () => {
    const p = store();
    const t = task(p);
    const res = act(p, { action: "type", id: t.id, type: "bug" });
    assert.equal(res.status, 200);
    assert.equal(read(t.id, p).type, "bug");
  });

  it("clears priority when the field is omitted rather than 400ing on null", () => {
    // The drawer used to send `{ priority: null }`. null is not a ladder value, so
    // prioritise() 400ed and the chip could never come off. Omit / undefined is the
    // clear — the same shape assign already uses.
    const p = store();
    const t = task(p, "a task", { priority: "high" });

    const omitted = handleWrite("POST", `/api/task/${t.id}/priority`, {}, { p });
    assert.equal(omitted.status, 200, "an omitted priority is a clear, not a bad value");
    assert.equal(read(t.id, p).priority, undefined);

    act(p, { action: "priority", id: t.id, priority: "low" });
    const undef = handleWrite("POST", `/api/task/${t.id}/priority`, { priority: undefined }, { p });
    assert.equal(undef.status, 200);
    assert.equal(read(t.id, p).priority, undefined);
  });

  it("clears estimate by removing the field rather than writing 0", () => {
    const p = store();
    const t = task(p);
    act(p, { action: "estimate", id: t.id, estimate: 5 });
    const res = handleWrite("POST", `/api/task/${t.id}/estimate`, {}, { p });
    assert.equal(res.status, 200);
    assert.equal(read(t.id, p).estimate, undefined, "a cleared estimate must vanish, not become 0");
  });
});

describe("transition honesty (BDM-67)", () => {
  it("writes blockedReason when moving to blocked with a reason", () => {
    const p = store();
    const t = task(p);
    const res = act(p, { action: "transition", id: t.id, status: "blocked", reason: "waiting on design" });
    assert.equal(res.status, 200);
    assert.equal(read(t.id, p).status, "blocked");
    assert.equal(read(t.id, p).blockedReason, "waiting on design");
  });

  it("writes parkedReason when moving to parked with a reason", () => {
    const p = store();
    const t = task(p);
    const res = act(p, { action: "transition", id: t.id, status: "parked", reason: "until the API lands" });
    assert.equal(res.status, 200);
    assert.equal(read(t.id, p).status, "parked");
    assert.equal(read(t.id, p).parkedReason, "until the API lands");
  });

  it("drops the stop reason when leaving blocked or parked", () => {
    const p = store();
    const t = task(p, "a task", { status: "blocked", blockedReason: "old reason" });
    act(p, { action: "transition", id: t.id, status: "open" });
    assert.equal(read(t.id, p).blockedReason, undefined);
  });

  it("stamps actor/session/branch/worktree when moving to in_progress, like tm start", () => {
    const p = store();
    execFileSync("git", ["init", "-q", "-b", "feat/stamp", p.root]);
    const prevActor = process.env.TM_ACTOR;
    const prevSession = process.env.CLAUDE_SESSION_ID;
    process.env.TM_ACTOR = "dashboard-test";
    process.env.CLAUDE_SESSION_ID = "sess-abc";
    try {
      const t = task(p);
      const res = act(p, { action: "transition", id: t.id, status: "in_progress" });
      assert.equal(res.status, 200);
      const after = read(t.id, p);
      assert.equal(after.actor, "@dashboard-test");
      assert.equal(after.session, "sess-abc");
      assert.equal(after.branch, "feat/stamp");
      assert.equal(after.worktree, p.root);
    } finally {
      if (prevActor === undefined) delete process.env.TM_ACTOR;
      else process.env.TM_ACTOR = prevActor;
      if (prevSession === undefined) delete process.env.CLAUDE_SESSION_ID;
      else process.env.CLAUDE_SESSION_ID = prevSession;
    }
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

  it("applies a template the same way `tm task new --template` does", () => {
    const p = store();
    seedTemplates(p);
    const res = handleWrite("POST", "/api/task", { title: "login 500s", template: "bug" }, { p });
    assert.equal(res.status, 201);
    const created = read(res.body.id, p);
    assert.match(created.body, /## Repro/, "the template body is the task body");
    assert.equal(created.acceptance.length, 1, "template acceptance must survive the create defaults");
    assert.equal(created.description, undefined, "`description` describes the template, not the task");
    assert.equal(created.type, "bug");
  });

  it("refuses an unknown template with 400 instead of minting a blank task", () => {
    const p = store();
    const before = list("task", {}, p).length;
    const res = handleWrite("POST", "/api/task", { title: "orphan", template: "ghost" }, { p });
    assert.equal(res.status, 400, "an unknown name is the caller's mistake, not a 201");
    assert.match(res.body.error, /no such template/);
    assert.equal(list("task", {}, p).length, before, "a refused template must not have created anything");
  });

  it("does not let empty acceptance or an empty body wipe the template", () => {
    const p = store();
    seedTemplates(p);
    const res = handleWrite(
      "POST",
      "/api/task",
      { title: "still a bug", template: "bug", acceptance: [], body: "" },
      { p },
    );
    assert.equal(res.status, 201);
    const created = read(res.body.id, p);
    assert.equal(created.acceptance.length, 1, "acceptance: [] is a create default, not a wipe");
    assert.match(created.body, /## Repro/, "an empty body must not erase the template skeleton");
  });

  it("does not invent a type for a template that never had one", () => {
    // Seeded stores written before type existed must keep working; do not rewrite them.
    const p = store();
    mkdirSync(p.templates, { recursive: true });
    writeFileSync(
      join(p.templates, "legacy.md"),
      '---\ndescription: "old starter"\nacceptance: ["prove it"]\nlabels: ["legacy"]\n---\n\n## Notes\n',
    );
    const res = handleWrite("POST", "/api/task", { title: "from legacy", template: "legacy" }, { p });
    assert.equal(res.status, 201);
    const created = read(res.body.id, p);
    assert.equal(created.type, undefined, "a typeless template must not grow a type on create");
    assert.equal(created.description, undefined);
    assert.deepEqual(created.labels, ["legacy"]);
  });
});

describe("templates", () => {
  it("lists each template's name and description", () => {
    const p = store();
    seedTemplates(p);
    const res = handleWrite("GET", "/api/templates", null, { p });
    assert.equal(res.status, 200);
    const names = res.body.map((t) => t.name);
    assert.deepEqual(names, ["bug", "chore", "spike"]);
    for (const t of res.body) {
      assert.equal(typeof t.description, "string");
      assert.ok(t.description.length, `${t.name} should carry a description`);
    }
  });

  it("returns [] when the store has no templates at all", () => {
    const p = store();
    const res = handleWrite("GET", "/api/templates", null, { p });
    assert.equal(res.status, 200);
    assert.deepEqual(res.body, []);
  });

  it("reads one template in full", () => {
    const p = store();
    seedTemplates(p);
    const res = handleWrite("GET", "/api/templates/bug", null, { p });
    assert.equal(res.status, 200);
    assert.equal(res.body.name, "bug");
    assert.match(res.body.body, /## Repro/);
    assert.equal(res.body.fields.description, "a defect with a known repro, closed by a regression test");
  });

  it("404s a template that does not exist", () => {
    const p = store();
    const res = handleWrite("GET", "/api/templates/ghost", null, { p });
    assert.equal(res.status, 404);
    assert.match(res.body.error, /no such template/);
  });

  it("400s a path-unsafe name instead of walking out of the store", () => {
    const p = store();
    const res = handleWrite("GET", "/api/templates/..%2f..%2fetc%2fpasswd", null, { p });
    assert.equal(res.status, 400);
    assert.match(res.body.error, /unsafe template name/);
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

describe("adrs on the board (BDM-70)", () => {
  it("includes adrs without body; an empty store is []", () => {
    const empty = store();
    assert.deepEqual(boardPayload(empty).adrs, [], "empty adrs/ is first-class, not omitted");

    const p = store();
    create("adr", { title: "use files", status: "proposed" }, "SECRET BODY the list must not ship", p);
    const [row] = boardPayload(p).adrs;
    assert.equal(row.id, "ADR-0001");
    assert.equal(row.title, "use files");
    assert.equal(row.status, "proposed");
    assert.equal("body" in row, false, "the list is the thing that stays small");
    assert.equal("file" in row, false);
  });

  it("GET /api/adr/:id returns the body; GET /api/task/ADR-* stays 400", () => {
    const p = store();
    const a = create("adr", { title: "use files", status: "proposed" }, "the decision body", p);

    const res = handleWrite("GET", `/api/adr/${a.id}`, {}, { p });
    assert.equal(res.status, 200);
    assert.match(res.body.body, /the decision body/);
    assert.equal(res.body.title, "use files");

    const asTask = handleWrite("GET", `/api/task/${a.id}`, {}, { p });
    assert.equal(asTask.status, 400);
    assert.match(asTask.body.error, /not a task id/);
    assert.equal(handleWrite("POST", `/api/task/${a.id}/transition`, { status: "done" }, { p }).status, 400);
  });

  it("GET /api/adr/TM-* is 400 and a missing ADR is 404", () => {
    const p = store();
    const t = task(p);
    const wrong = handleWrite("GET", `/api/adr/${t.id}`, {}, { p });
    assert.equal(wrong.status, 400);
    assert.match(wrong.body.error, /not a adr id/);
    assert.equal(handleWrite("GET", "/api/adr/ADR-404", {}, { p }).status, 404);
  });

  it("POST /api/adr creates proposed and inherits activeEpic", () => {
    const p = store();
    const e = create("epic", { title: "wave" }, "", p);
    writeState({ activeEpic: e.id }, p);

    const res = handleWrite("POST", "/api/adr", { title: "store as markdown", body: "## Decision\n\nfiles" }, { p });
    assert.equal(res.status, 201);
    assert.equal(res.body.status, "proposed");
    assert.equal(res.body.epic, e.id);

    const doc = read(res.body.id, p);
    assert.equal(doc.status, "proposed");
    assert.equal(doc.epic, e.id);
    assert.deepEqual(doc.deciders, []);
    assert.match(doc.body, /files/);
    assert.ok(doc.date);
  });

  it("POST /api/adr with no active epic still creates, epic null", () => {
    const p = store();
    const res = handleWrite("POST", "/api/adr", { title: "unscoped" }, { p });
    assert.equal(res.status, 201);
    assert.equal(read(res.body.id, p).epic, null);
    assert.match(read(res.body.id, p).body, /## Context/);
  });

  it("accepts only from proposed", () => {
    const p = store();
    const a = create("adr", { title: "use files", status: "proposed" }, "", p);

    const res = handleWrite("POST", `/api/adr/${a.id}/accept`, {}, { p });
    assert.equal(res.status, 200);
    assert.equal(read(a.id, p).status, "accepted");

    const again = handleWrite("POST", `/api/adr/${a.id}/accept`, {}, { p });
    assert.equal(again.status, 409);
    assert.match(again.body.error, /accepted/);
    assert.equal(read(a.id, p).status, "accepted", "a refused accept must not have changed anything");
  });

  it("supersede writes a new ADR and marks the old one, without rewriting its body", () => {
    const p = store();
    const e = create("epic", { title: "wave" }, "", p);
    const old = create(
      "adr",
      { title: "use files", status: "accepted", epic: e.id },
      "ORIGINAL DECISION — do not rewrite",
      p,
    );

    const res = handleWrite(
      "POST",
      `/api/adr/${old.id}/supersede`,
      { title: "use a database", body: "## Decision\n\nSQLite after all" },
      { p },
    );
    assert.equal(res.status, 201);
    assert.notEqual(res.body.id, old.id);
    assert.equal(res.body.supersedes, old.id);
    assert.equal(res.body.status, "proposed");

    const next = read(res.body.id, p);
    assert.equal(next.supersedes, old.id);
    assert.equal(next.epic, e.id, "the replacement stays under the same epic");
    assert.match(next.body, /SQLite after all/);

    const was = read(old.id, p);
    assert.equal(was.status, "superseded");
    assert.match(was.body, /ORIGINAL DECISION/, "the accepted body is left alone");
  });

  it("refuses to supersede an already superseded ADR", () => {
    const p = store();
    const old = create("adr", { title: "old", status: "superseded" }, "", p);
    const res = handleWrite("POST", `/api/adr/${old.id}/supersede`, { title: "newer" }, { p });
    assert.equal(res.status, 409);
    assert.equal(list("adr", {}, p).length, 1);
  });
});

describe("safety", () => {
  it("404s an unknown route and an unknown task", () => {
    const p = store();
    assert.equal(handleWrite("POST", "/api/epic", { id: "TM-001" }, { p }).status, 400, "not an epic id");
    assert.equal(handleWrite("POST", "/api/nonsense", {}, { p }).status, 404);
    assert.equal(handleWrite("POST", "/api/task/TM-999/assign", { assignee: "x" }, { p }).status, 404);
  });

  it("refuses a task id that isn't one", () => {
    const p = store();
    assert.equal(handleWrite("POST", "/api/task/..%2f..%2fetc/assign", { assignee: "x" }, { p }).status, 400);
  });
});
