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
import { existsSync, mkdirSync, readFileSync, symlinkSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { cleanup, tempRepo, tempStore, withSessionEnv } from "./helpers.mjs";
import { backlog as backlogOf, boardPayload, handleWrite } from "../../lib/dashboard-api.mjs";
import { acceptanceOf, propose } from "../../lib/capability.mjs";
import { gateDone } from "../../lib/enforce.mjs";
import { mutateSession } from "../../lib/planner.mjs";
import { ensureDirs, paths } from "../../lib/paths.mjs";
import { create, list, read, readEvents, reindex, seedGitContract, setCriterion, state, update, writeConfig, writeState } from "../../lib/store.mjs";
import { listWorktrees } from "../../lib/worktree.mjs";
import { seedTemplates } from "../../lib/templates.mjs";
import { sprintCounts, sprintReport } from "../../lib/render.mjs";

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
const task = (p, title = "a task", fields = {}) =>
  create("task", { title, acceptance: [{ text: "done means", done: false }], ...fields }, "context\n", p);

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
    assert.equal(
      handleWrite("POST", "/api/task", { title: "before", body: "context", acceptance: [{ text: "done means", done: false }] }, { p }).status,
      409,
    );

    handleWrite("POST", "/api/epic", { id: e.id }, { p });

    assert.equal(
      handleWrite("POST", "/api/task", { title: "after", body: "context", acceptance: [{ text: "done means", done: false }] }, { p }).status,
      201,
    );
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
    // Every session variable is cleared, not just the one being set: this suite
    // runs inside a real agent session, and the ambient CLAUDE_CODE_SESSION_ID
    // outranks CLAUDE_SESSION_ID in the precedence chain.
    withSessionEnv({ TM_ACTOR: "dashboard-test", CLAUDE_SESSION_ID: "sess-abc" }, () => {
      const t = task(p);
      const res = act(p, { action: "transition", id: t.id, status: "in_progress" });
      assert.equal(res.status, 200);
      const after = read(t.id, p);
      assert.equal(after.actor, "@dashboard-test");
      assert.equal(after.session, "sess-abc");
      assert.equal(after.branch, "feat/stamp");
      assert.equal(after.worktree, p.root);
    });
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
    const res = handleWrite(
      "POST",
      "/api/task",
      { title: "born on the board", body: "context", acceptance: [{ text: "done means" }] },
      { p },
    );
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
    assert.deepEqual(names, ["bug", "chore", "interview", "prototype", "research", "spike", "unblock"]);
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

describe("sprints on the board (BDM-71)", () => {
  it("includes sprints without body; an empty store is []", () => {
    const empty = store();
    assert.deepEqual(boardPayload(empty).sprints, [], "empty sprints/ is first-class, not omitted");

    const p = store();
    create("sprint", { title: "Sprint 12", status: "open" }, "SECRET BODY the list must not ship", p);
    const [row] = boardPayload(p).sprints;
    assert.equal(row.id, "SP-001");
    assert.equal(row.title, "Sprint 12");
    assert.equal(row.status, "open");
    assert.equal("body" in row, false, "the list is the thing that stays small");
    assert.equal("file" in row, false);
    assert.ok(row.report, "the header reads report off the list so it does not fetch");
  });

  it("reindex includes sprints", () => {
    const empty = store();
    assert.deepEqual(reindex(empty).sprints, []);

    const p = store();
    const s = create("sprint", { title: "Sprint 12", status: "open" }, "keep this off the cache", p);
    const idx = reindex(p);
    assert.equal(idx.sprints.length, 1);
    assert.equal(idx.sprints[0].id, s.id);
    assert.equal("body" in idx.sprints[0], false);
  });

  it("creates from { title }, sets activeSprint in state.json, not config", () => {
    const p = store();
    const res = handleWrite("POST", "/api/sprint", { title: "Sprint 12", ends: "2026-08-28" }, { p });
    assert.equal(res.status, 201);
    assert.equal(res.body.id, "SP-001");
    assert.equal(state(p).activeSprint, "SP-001");

    const local = JSON.parse(readFileSync(p.state, "utf8"));
    const cfg = JSON.parse(readFileSync(p.config, "utf8"));
    assert.equal(local.activeSprint, "SP-001", "a sprint is a local work rhythm");
    assert.equal("activeSprint" in cfg, false, "activeSprint is not SHARED_STATE");
    assert.equal(read("SP-001", p).ends, "2026-08-28");
  });

  it("activates with { id } and does not mint a second sprint when a title is also present", () => {
    const p = store();
    const existing = create("sprint", { title: "already here", status: "open" }, "", p);
    const before = list("sprint", {}, p).length;
    const res = handleWrite("POST", "/api/sprint", { id: existing.id, title: "must not create" }, { p });
    assert.equal(res.status, 200);
    assert.equal(state(p).activeSprint, existing.id);
    assert.equal(list("sprint", {}, p).length, before);
  });

  it("closes, clears the active pointer, and leaves unfinished work committed", () => {
    const p = store();
    const s = create("sprint", { title: "Sprint 12", status: "open" }, "", p);
    writeState({ activeSprint: s.id }, p);
    const open = task(p, "still going", { sprint: s.id, estimate: 5 });
    const done = task(p, "shipped", { sprint: s.id, estimate: 3 });
    update(done.id, { status: "done" }, p);

    const res = handleWrite("POST", `/api/sprint/${s.id}/done`, {}, { p });
    assert.equal(res.status, 200);
    assert.equal(read(s.id, p).status, "done");
    assert.ok(read(s.id, p).closed);
    assert.equal(state(p).activeSprint ?? null, null);
    assert.equal(read(open.id, p).sprint, s.id, "closing must not evaporate unfinished work");
    assert.equal(read(open.id, p).status, "open");
    assert.equal(read(done.id, p).sprint, s.id);
    assert.equal(res.body.unfinished, 1);
  });

  it("commits and removes task.sprint", () => {
    const p = store();
    const s = create("sprint", { title: "Sprint 12", status: "open" }, "", p);
    const t = task(p, "card");

    const add = handleWrite("POST", `/api/task/${t.id}/sprint`, { sprint: s.id }, { p });
    assert.equal(add.status, 200);
    assert.equal(read(t.id, p).sprint, s.id);

    const rm = handleWrite("POST", `/api/task/${t.id}/sprint`, { sprint: null }, { p });
    assert.equal(rm.status, 200);
    assert.equal(read(t.id, p).sprint, undefined);
  });

  it("does not auto-commit a new task to activeSprint", () => {
    const p = store();
    const s = create("sprint", { title: "Sprint 12", status: "open" }, "", p);
    writeState({ activeSprint: s.id }, p);
    const res = handleWrite(
      "POST",
      "/api/task",
      { title: "born on the board", body: "context", acceptance: [{ text: "done means" }] },
      { p },
    );
    assert.equal(res.status, 201);
    assert.equal(read(res.body.id, p).sprint, undefined);
  });

  it("header numbers are the same numbers sprintReport prints", () => {
    const p = store();
    const s = create("sprint", { title: "Sprint 12", status: "open" }, "", p);
    task(p, "done five", { sprint: s.id, estimate: 5 });
    update(list("task", {}, p)[0].id, { status: "done" }, p);
    task(p, "open three", { sprint: s.id, estimate: 3 });
    task(p, "open eight", { sprint: s.id, estimate: 8 });
    task(p, "nobody sized this", { sprint: s.id });

    const committed = list("task", {}, p).filter((t) => t.sprint === s.id);
    const nums = sprintCounts(committed);
    assert.match(
      sprintReport(s.id, p),
      new RegExp(`${nums.done}/${nums.committed} points done across ${nums.cards} card\\(s\\), ${nums.unsized} unsized`),
    );

    const detail = handleWrite("GET", `/api/sprint/${s.id}`, {}, { p });
    assert.equal(detail.status, 200);
    assert.deepEqual(detail.body.report, nums);

    const [row] = boardPayload(p).sprints;
    assert.deepEqual(row.report, nums, "the header reads these, so they must match sprintReport");
  });

  it("GET /api/task/SP-* stays 400 — requireTask stays on the task surface", () => {
    const p = store();
    const s = create("sprint", { title: "not a task" }, "belongs at /api/sprint", p);
    const res = handleWrite("GET", `/api/task/${s.id}`, {}, { p });
    assert.equal(res.status, 400);
    assert.match(res.body.error, /not a task id/);
    assert.equal(handleWrite("POST", `/api/task/${s.id}/transition`, { status: "done" }, { p }).status, 400);
  });

  it("GET /api/sprint/:id returns the body and report; a missing sprint is 404", () => {
    const p = store();
    const s = create("sprint", { title: "Sprint 12", status: "open" }, "the sprint goal", p);
    const res = handleWrite("GET", `/api/sprint/${s.id}`, {}, { p });
    assert.equal(res.status, 200);
    assert.match(res.body.body, /the sprint goal/);
    assert.deepEqual(res.body.report, { cards: 0, committed: 0, done: 0, unsized: 0 });

    const wrong = handleWrite("GET", "/api/sprint/TM-001", {}, { p });
    assert.equal(wrong.status, 400);
    assert.match(wrong.body.error, /not a sprint id/);
    assert.equal(handleWrite("GET", "/api/sprint/SP-404", {}, { p }).status, 404);
  });

  it("bulk fans sprint commit through /api/task/:id/sprint", () => {
    const p = store();
    const s = create("sprint", { title: "Sprint 12", status: "open" }, "", p);
    const a = task(p, "one");
    const b = task(p, "two");
    const res = handleWrite("POST", "/api/bulk", { ids: [a.id, b.id], op: "sprint", args: { sprint: s.id } }, { p });
    assert.equal(res.status, 200);
    assert.equal(res.body.ok.length, 2);
    assert.equal(read(a.id, p).sprint, s.id);
    assert.equal(read(b.id, p).sprint, s.id);
  });
});

describe("plans inbox (BDM-72)", () => {
  const get = (p, path) => handleWrite("GET", path, {}, { p });

  it("empty plans/ is [] — not a KIND, not omitted", () => {
    const p = store();
    const res = get(p, "/api/plans");
    assert.equal(res.status, 200);
    assert.deepEqual(res.body, []);
    assert.equal("plans" in boardPayload(p), false, "the board payload must not grow a plans KIND");
  });

  it("lists files and marks linked vs unlinked", () => {
    const p = store();
    mkdirSync(p.plans, { recursive: true });
    writeFileSync(join(p.plans, "linked.md"), "# Linked\n");
    writeFileSync(join(p.plans, "loose.md"), "# Loose\n");
    const e = create("epic", { title: "has a plan" }, "", p);
    const rel = ".bytedesk/task-management/plans/linked.md";
    const set = handleWrite("POST", `/api/epic/${e.id}/plan`, { plan: rel }, { p });
    assert.equal(set.status, 200);
    assert.equal(read(e.id, p).plan, rel);

    const res = get(p, "/api/plans");
    assert.equal(res.status, 200);
    const byName = Object.fromEntries(res.body.map((row) => [row.name, row]));
    assert.equal(byName["linked.md"].linkedEpic, e.id);
    assert.equal(byName["linked.md"].exists, true);
    assert.equal(byName["loose.md"].linkedEpic, undefined);
    assert.equal(byName["loose.md"].path, ".bytedesk/task-management/plans/loose.md");
  });

  it("clears epic.plan via POST { plan: null }", () => {
    const p = store();
    const e = create("epic", { title: "has a plan", plan: "plans/x.md" }, "", p);
    const res = handleWrite("POST", `/api/epic/${e.id}/plan`, { plan: null }, { p });
    assert.equal(res.status, 200);
    assert.equal(read(e.id, p).plan, undefined);
  });

  it("confined GET allows a file in p.plans and 404s traversal / absolute outside", () => {
    const p = store();
    mkdirSync(p.plans, { recursive: true });
    writeFileSync(join(p.plans, "ok.md"), "# Inside\n");
    const ref = ".bytedesk/task-management/plans/ok.md";
    const okRes = get(p, `/api/plans/file?ref=${encodeURIComponent(ref)}`);
    assert.equal(okRes.status, 200);
    assert.equal(okRes.body.name, "ok.md");
    assert.match(okRes.body.content, /Inside/);

    const secret = join(p.base, "config.json");
    assert.equal(existsSync(secret), true);
    const traversal = ".bytedesk/task-management/plans/../config.json";
    assert.equal(get(p, `/api/plans/file?ref=${encodeURIComponent(traversal)}`).status, 404);

    const outside = join(p.root, "secret.md");
    writeFileSync(outside, "nope\n");
    assert.equal(get(p, `/api/plans/file?ref=${encodeURIComponent(outside)}`).status, 404);
  });

  it("serves an epic.plan file that lives outside p.plans (tm goal import)", () => {
    const p = store();
    const dest = join(p.root, "docs", "goals", "prog.plan.json");
    mkdirSync(join(p.root, "docs", "goals"), { recursive: true });
    writeFileSync(
      dest,
      JSON.stringify({
        plan: "prog",
        epic: { title: "Program" },
        goals: [{ id: "g1", doc: "docs/goals/a.md", title: "Do A" }],
      }),
    );
    const e = create("epic", { title: "imported", plan: "docs/goals/prog.plan.json" }, "", p);
    const res = get(p, `/api/plans/file?ref=${encodeURIComponent("docs/goals/prog.plan.json")}`);
    assert.equal(res.status, 200);
    assert.equal(res.body.manifest.epicTitle, "Program");
    assert.equal(res.body.manifest.goals[0].title, "Do A");
    assert.equal(get(p, "/api/plans").body.length, 0, "inbox is only p.plans, not the import source");
    void e;
  });

  it("404s a symlink that escapes p.plans unless that file is epic.plan", () => {
    const p = store();
    mkdirSync(p.plans, { recursive: true });
    const outside = join(p.root, "escape.md");
    writeFileSync(outside, "escaped\n");
    symlinkSync(outside, join(p.plans, "link.md"));
    assert.equal(
      get(p, `/api/plans/file?ref=${encodeURIComponent(".bytedesk/task-management/plans/link.md")}`).status,
      404,
    );
  });
});

describe("capabilities on the board (BDM-73)", () => {
  it("includes capabilities without body; an empty store is []", () => {
    const empty = store();
    assert.deepEqual(boardPayload(empty).capabilities, [], "empty capabilities/ is first-class, not omitted");

    const p = store();
    handleWrite(
      "POST",
      "/api/capability",
      { title: "Cheap big win", impact: "H", effort: "S", confidence: "H", criteria: ["palette lists help"] },
      { p },
    );
    const [row] = boardPayload(p).capabilities;
    assert.equal(row.id, "CAP-0001");
    assert.equal(row.title, "Cheap big win");
    assert.equal(row.status, "open");
    assert.equal(row.score, 27);
    assert.equal("body" in row, false, "the list is the thing that stays small");
    assert.equal("file" in row, false);
    assert.equal("epic" in row, false, "epic is not a field on the card");
  });

  it("GET /api/capability/:id returns the body; GET /api/task/CAP-* stays 400", () => {
    const p = store();
    const created = handleWrite("POST", "/api/capability", { title: "Cheap big win", problem: "the card body" }, { p });
    assert.equal(created.status, 201);

    const res = handleWrite("GET", `/api/capability/${created.body.id}`, {}, { p });
    assert.equal(res.status, 200);
    assert.match(res.body.body, /the card body/);
    assert.equal(res.body.title, "Cheap big win");
    assert.equal(res.body.score, 8);

    const asTask = handleWrite("GET", `/api/task/${created.body.id}`, {}, { p });
    assert.equal(asTask.status, 400);
    assert.match(asTask.body.error, /not a task id/);
    assert.equal(handleWrite("POST", `/api/task/${created.body.id}/transition`, { status: "done" }, { p }).status, 400);
  });

  it("GET /api/capability/TM-* is 400 and a missing CAP is 404", () => {
    const p = store();
    const t = task(p);
    const wrong = handleWrite("GET", `/api/capability/${t.id}`, {}, { p });
    assert.equal(wrong.status, 400);
    assert.match(wrong.body.error, /not a capability id/);
    assert.equal(handleWrite("GET", "/api/capability/CAP-404", {}, { p }).status, 404);
  });

  it("POST /api/capability proposes; accept/ship/drop go through the lib", () => {
    const p = store();
    const created = handleWrite(
      "POST",
      "/api/capability",
      {
        title: "Cheap big win",
        impact: "H",
        effort: "S",
        confidence: "H",
        criteria: ["the palette lists help items", "no network call"],
      },
      { p },
    );
    assert.equal(created.status, 201);
    assert.equal(created.body.id, "CAP-0001");
    assert.equal(read("CAP-0001", p).status, "open");

    const accepted = handleWrite("POST", "/api/capability/CAP-0001/accept", {}, { p });
    assert.equal(accepted.status, 200);
    assert.equal(accepted.body.task, "TM-001");
    assert.equal(read("CAP-0001", p).status, "in_progress");
    assert.equal(read("CAP-0001", p).task, "TM-001");
    assert.equal(read("TM-001", p).capability, "CAP-0001");

    const again = handleWrite("POST", "/api/capability/CAP-0001/accept", {}, { p });
    assert.equal(again.status, 200);
    assert.equal(again.body.existing, true);
    assert.equal(list("task", {}, p).length, 1, "accepting twice must not mint a second task");

    const other = handleWrite("POST", "/api/capability", { title: "Speculative rewrite" }, { p });
    const dropped = handleWrite("POST", `/api/capability/${other.body.id}/drop`, { why: "no one wants this" }, { p });
    assert.equal(dropped.status, 200);
    assert.equal(read(other.body.id, p).status, "deleted");
    assert.equal(read(other.body.id, p).droppedReason, "no one wants this");
  });

  it("ship without evidence is 409 with the CLI wording", () => {
    const p = store();
    handleWrite("POST", "/api/capability", { title: "Cheap big win" }, { p });
    const res = handleWrite("POST", "/api/capability/CAP-0001/ship", {}, { p });
    assert.equal(res.status, 409);
    assert.match(res.body.error, /no evidence/);
    assert.match(res.body.error, /tm evidence CAP-0001/);
    assert.equal(read("CAP-0001", p).status, "open", "a refused ship must not have changed anything");
  });

  it("ship succeeds once there is evidence", () => {
    const p = store();
    handleWrite("POST", "/api/capability", { title: "Cheap big win" }, { p });
    update("CAP-0001", { evidence: ["cutover PASS"] }, p);
    const res = handleWrite("POST", "/api/capability/CAP-0001/ship", {}, { p });
    assert.equal(res.status, 200);
    assert.equal(read("CAP-0001", p).status, "done");
    assert.ok(read("CAP-0001", p).shipped);
    assert.ok(readEvents(p).some((e) => e.event === "cap-ship" && e.id === "CAP-0001"));
  });

  it("acceptanceOf writes done, not met, and accept mints a gated task", () => {
    const p = store();
    const cap = propose(
      {
        title: "Cheap big win",
        impact: "H",
        effort: "S",
        confidence: "H",
        criteria: ["the palette lists help items", "no network call"],
      },
      p,
    );
    const criteria = acceptanceOf(cap);
    assert.deepEqual(
      criteria,
      [
        { text: "the palette lists help items", done: false },
        { text: "no network call", done: false },
      ],
    );
    assert.equal(criteria.every((a) => !Object.hasOwn(a, "met")), true);

    const minted = handleWrite("POST", `/api/capability/${cap.id}/accept`, {}, { p });
    assert.equal(minted.status, 200);
    const t = read(minted.body.task, p);
    assert.equal(t.acceptance.every((a) => a.done === false), true);
    assert.equal(gateDone(t.id, p).allow, false, "unmet minted criteria must gate tm done");
    assert.match(gateDone(t.id, p).reason, /unmet acceptance criteria/);

    setCriterion(t.id, 1, true, p);
    setCriterion(t.id, 2, true, p);
    update(t.id, { evidence: [".bytedesk/task-management/evidence/TM-001-cap.log"], assignee: "@cap" }, p);
    assert.equal(gateDone(t.id, p).allow, true);
  });

  it("refuses an empty title on propose", () => {
    const p = store();
    assert.equal(handleWrite("POST", "/api/capability", { title: "" }, { p }).status, 400);
    assert.equal(list("capability", {}, p).length, 0);
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

describe("link remove (BDM-74)", () => {
  it("POST /unlink drops both ends after a two-sided add", () => {
    const p = store();
    const a = task(p, "cause");
    const b = task(p, "symptom");
    act(p, { action: "link", id: a.id, type: "causes", to: b.id });
    assert.equal(read(b.id, p).links.length, 1);

    const res = handleWrite("POST", `/api/task/${a.id}/unlink`, { type: "causes", to: b.id }, { p });
    assert.equal(res.status, 200);
    assert.deepEqual(read(a.id, p).links || [], []);
    assert.deepEqual(read(b.id, p).links || [], []);
  });

  it("POST /link { remove: true } is the same verb", () => {
    const p = store();
    const a = task(p, "blocker");
    const b = task(p, "blocked");
    act(p, { action: "link", id: a.id, type: "blocks", to: b.id });

    const res = handleWrite("POST", `/api/task/${a.id}/link`, { type: "blocks", to: b.id, remove: true }, { p });
    assert.equal(res.status, 200);
    assert.deepEqual(read(a.id, p).links || [], []);
    assert.deepEqual(read(b.id, p).links || [], []);
  });
});

describe("GET /api/entity/:id (BDM-74)", () => {
  it("returns EP/TM/ADR/SP/CAP when present; GET /api/task/EP-* stays 400", () => {
    const p = store();
    const e = create("epic", { title: "e" }, "epic body", p);
    const t = task(p, "t");
    const a = create("adr", { title: "a" }, "adr body", p);
    const s = create("sprint", { title: "s" }, "sprint body", p);
    const c = handleWrite("POST", "/api/capability", { title: "c", problem: "cap body" }, { p });
    assert.equal(c.status, 201);

    for (const id of [e.id, t.id, a.id, s.id, c.body.id]) {
      const res = handleWrite("GET", `/api/entity/${id}`, {}, { p });
      assert.equal(res.status, 200, id);
      assert.equal(res.body.id, id);
    }
    assert.match(handleWrite("GET", `/api/entity/${e.id}`, {}, { p }).body.body, /epic body/);

    const asTask = handleWrite("GET", `/api/task/${e.id}`, {}, { p });
    assert.equal(asTask.status, 400);
    assert.match(asTask.body.error, /not a task id/);
  });

  it("400s an unknown prefix and 404s a missing known id", () => {
    const p = store();
    const bad = handleWrite("GET", "/api/entity/FOO-1", {}, { p });
    assert.equal(bad.status, 400);
    assert.match(bad.body.error, /unknown prefix/);
    const miss = handleWrite("GET", "/api/entity/EP-404", {}, { p });
    assert.equal(miss.status, 404);
    assert.match(miss.body.error, /not found/);
  });
});

describe("worktrees (BDM-74)", () => {
  function gitStore() {
    const root = tempRepo();
    const p = paths(root);
    ensureDirs(p);
    seedGitContract(p);
    writeConfig({ requireEpic: false, requireAcceptance: true, wipLimit: 99 }, p);
    stores.push(root);
    return p;
  }

  it("GET /api/worktrees is [] when none exist", () => {
    const p = store();
    const res = handleWrite("GET", "/api/worktrees", {}, { p });
    assert.equal(res.status, 200);
    assert.deepEqual(res.body, []);
    assert.deepEqual(listWorktrees(p), []);
  });

  it("does not serve worktree file contents", () => {
    const p = store();
    assert.equal(handleWrite("GET", "/api/worktrees/secret", {}, { p }).status, 404);
  });

  it("creates and removes a task worktree through the lib", () => {
    const p = gitStore();
    const t = task(p, "isolated checkout");

    const created = handleWrite("POST", `/api/task/${t.id}/worktree`, { action: "create" }, { p });
    assert.equal(created.status, 200);
    const afterCreate = read(t.id, p);
    assert.ok(afterCreate.worktree, "createWorktree stamps task.worktree");
    assert.ok(afterCreate.branch, "createWorktree stamps task.branch");

    const listed = handleWrite("GET", "/api/worktrees", {}, { p });
    assert.equal(listed.status, 200);
    assert.equal(listed.body.length, 1);
    assert.equal(listed.body[0].taskId, t.id);
    assert.equal(listWorktrees(p).length, 1);

    const removed = handleWrite("POST", `/api/task/${t.id}/worktree`, { action: "remove" }, { p });
    assert.equal(removed.status, 200);
    assert.equal(read(t.id, p).worktree, undefined);
    assert.equal(handleWrite("GET", "/api/worktrees", {}, { p }).body.length, 0);
  });

  it("refuses a dirty remove unless force is set", () => {
    const p = gitStore();
    const t = task(p, "dirty checkout");
    const created = handleWrite("POST", `/api/task/${t.id}/worktree`, { action: "create" }, { p });
    assert.equal(created.status, 200);
    writeFileSync(join(read(t.id, p).worktree, "uncommitted.txt"), "dirty\n");

    const refused = handleWrite("POST", `/api/task/${t.id}/worktree`, { action: "remove" }, { p });
    assert.equal(refused.status, 409);
    assert.match(refused.body.error, /uncommitted|force/i);
    assert.ok(read(t.id, p).worktree, "a refused remove must leave the worktree");

    const forced = handleWrite("POST", `/api/task/${t.id}/worktree`, { action: "remove", force: true }, { p });
    assert.equal(forced.status, 200);
    assert.equal(read(t.id, p).worktree, undefined);
  });

  it("400s an unknown worktree action", () => {
    const p = store();
    const t = task(p);
    const res = handleWrite("POST", `/api/task/${t.id}/worktree`, { action: "share" }, { p });
    assert.equal(res.status, 400);
  });
});

// ── W1: every CLI-only read and write, over HTTP ─────────────────────────────

import { handleAsync } from "../../lib/dashboard-api.mjs";
import { dependencies } from "../../lib/issue.mjs";
import { FIELD_NAMES } from "../../lib/query.mjs";
import { COLUMNS } from "../../lib/render.mjs";
import { claimTask } from "../../lib/claims.mjs";
import { readTemplate } from "../../lib/templates.mjs";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";

const get = (p, path) => handleWrite("GET", path, null, { p });
const sessioned = (id, fn) => withSessionEnv({ CLAUDE_CODE_SESSION_ID: id }, fn);

describe("why and graph", () => {
  it("walks the chain to the parked root and names its reason", () => {
    const p = store();
    const e = create("epic", { title: "scoped" }, "", p);
    const a = task(p, "the credential", { epic: e.id });
    const b = task(p, "the secret store", { epic: e.id });
    const c = task(p, "legal sign-off"); // outside the epic on purpose
    dependencies(a.id, { add: [b.id] }, p);
    dependencies(b.id, { add: [c.id] }, p);
    update(c.id, { status: "parked", parkedReason: "waiting on counsel" }, p);

    const res = get(p, `/api/task/${a.id}/why`);
    assert.equal(res.status, 200);
    assert.equal(res.body.startable, false);
    assert.ok(res.body.chain.some((x) => x.id === c.id), "the transitive blocker is in the chain");
    assert.match(res.body.text, /waiting on counsel/);

    const g = get(p, `/api/graph?epic=${e.id}`);
    assert.equal(g.status, 200);
    assert.ok(g.body.edges.some((x) => x.from === c.id && x.to === b.id), "an out-of-epic blocker is still drawn — it still explains the block");
    assert.match(g.body.mermaid, /classDef parked/);
    assert.equal(get(p, "/api/task/TM-404/why").status, 404);
  });
});

describe("insight reads", () => {
  it("standup, time, stale and history answer from the event log", async () => {
    const p = store();
    writeConfig({ staleMinutes: 0 }, p);
    const t = task(p, "finished today", {
      acceptance: [{ text: "done means", done: true }],
      evidence: [".bytedesk/task-management/evidence/TM-001-done.log"],
      assignee: "@test",
    });
    const since = new Date(Date.now() - 60_000).toISOString();
    act(p, { action: "transition", id: t.id, status: "in_progress" });
    await new Promise((r) => setTimeout(r, 5));
    assert.deepEqual(get(p, "/api/stale").body.tasks, [t.id], "staleMinutes 0 makes any in-progress task stale");
    act(p, { action: "transition", id: t.id, status: "done" });

    assert.match(get(p, `/api/standup?since=${since}`).body.text, new RegExp(t.id));
    assert.equal(get(p, "/api/standup?since=yesterday").status, 400);
    assert.equal(get(p, "/api/time").body.completed, 1);
    const per = get(p, `/api/task/${t.id}/time`).body;
    assert.ok(per.cycle && per.cycle.ms >= 0, "a cycle time once done");
    assert.ok(per.timeline.some((e) => e.event === "done"));

    const e = create("epic", { title: "an epic" }, "", p);
    const h = get(p, `/api/entity/${e.id}/history`);
    assert.equal(h.status, 200);
    assert.ok(h.body.events.some((x) => x.event === "create" && x.label), "labelled like /api/events");
    assert.equal(get(p, "/api/entity/XX-1/history").status, 400);
    assert.equal(get(p, "/api/entity/EP-999/history").status, 404);
  });
});

describe("find", () => {
  it("takes tm find syntax and refuses a field that does not exist", () => {
    const p = store();
    const a = task(p, "rotate the needle", { labels: ["x"] });
    const b = task(p, "another needle");
    const res = get(p, "/api/find?q=status:open%20-label:x%20needle");
    assert.equal(res.status, 200);
    assert.deepEqual(res.body.hits.map((h) => h.id), [b.id], `not ${a.id} — it wears the negated label`);
    const bad = get(p, "/api/find?q=assigne:ryan");
    assert.equal(bad.status, 400, "a typo'd field must not silently match body text");
    assert.match(bad.body.error, /assignee/);
  });
});

describe("claims over http", () => {
  it("claims, refuses a second session, steals on request, releases", () => {
    const p = store();
    const t = task(p, "contested");
    sessioned("alpha", () => {
      const res = act(p, { action: "claim", id: t.id });
      assert.equal(res.status, 200);
      assert.equal(state(p).claims[t.id].session, "alpha");
      assert.ok(state(p).claims[t.id].worktree, "the claim carries the checkout, like tm claim");
    });
    sessioned("beta", () => {
      const refused = act(p, { action: "claim", id: t.id });
      assert.equal(refused.status, 409);
      assert.match(refused.body.error, /claimed by/);
      const stolen = act(p, { action: "claim", id: t.id, steal: true });
      assert.equal(stolen.status, 200);
      assert.equal(stolen.body.stolenFrom, "alpha");
      assert.ok(readEvents(p).some((e) => e.event === "claim_stolen" && e.id === t.id));
    });
    assert.equal(get(p, "/api/claims").body.claims[t.id].session, "beta");
    assert.equal(act(p, { action: "release", id: t.id }).body.released, true);
    assert.equal(state(p).claims[t.id], undefined);
  });

  it("sweeps only dead claims, and only when confirmed", () => {
    const p = store();
    const live = task(p, "held");
    const dead = task(p, "abandoned");
    sessioned("alpha", () => claimTask(live.id, { session: "alpha", actor: "main", p }));
    const gone = mkdtempSync(join(tmpdir(), "tm-gone-"));
    claimTask(dead.id, { session: "omega", actor: "main", worktree: gone, p });
    rmSync(gone, { recursive: true, force: true }); // a claim whose worktree vanished is expired
    assert.equal(handleWrite("POST", "/api/claims/sweep", {}, { p }).status, 400);
    assert.ok(state(p).claims[dead.id], "nothing swept without confirm");
    const res = handleWrite("POST", "/api/claims/sweep", { confirm: true }, { p });
    assert.deepEqual(res.body.released, [dead.id]);
    assert.ok(state(p).claims[live.id], "the live claim survives");
  });
});

describe("gateStart", () => {
  it("enforces the WIP limit on the board too, and spends an override exactly once", () => {
    const p = store();
    writeConfig({ wipLimit: 1, enforce: true }, p);
    const a = task(p, "first");
    const b = task(p, "second");
    const c = task(p, "third");
    assert.equal(act(p, { action: "transition", id: a.id, status: "in_progress" }).status, 200);
    const refused = act(p, { action: "transition", id: b.id, status: "in_progress" });
    assert.equal(refused.status, 409);
    assert.match(refused.body.error, /WIP limit 1 reached/);
    assert.equal(read(b.id, p).status, "open", "a 409 must not move the card");
    assert.equal(act(p, { action: "transition", id: a.id, status: "in_progress" }).status, 200, "resuming is not starting");

    assert.equal(handleWrite("POST", "/api/override", {}, { p }).status, 400);
    assert.equal(handleWrite("POST", "/api/override", { reason: "pairing" }, { p }).status, 200);
    assert.equal(get(p, "/api/override").body.override.reason, "pairing");
    assert.equal(act(p, { action: "transition", id: b.id, status: "in_progress" }).status, 200);
    assert.equal(readEvents(p).filter((e) => e.event === "override_used").length, 1);
    assert.equal(act(p, { action: "transition", id: c.id, status: "in_progress" }).status, 409, "the token is spent");
  });
});

describe("doctor over http", () => {
  it("reports, refuses an unconfirmed fix, and repairs the unambiguous half", () => {
    const p = store();
    const t = task(p, "waiting on a ghost", { blockedBy: ["TM-404"] });
    const report = get(p, "/api/doctor");
    assert.equal(report.status, 200);
    const finding = report.body.findings.find((f) => f.code === "dangling-dep" && f.id === t.id);
    assert.ok(finding && finding.fixable);
    assert.equal(typeof finding.fix, "undefined", "closures do not cross HTTP");
    assert.equal(report.body.errors >= 1, true);

    assert.equal(handleWrite("POST", "/api/doctor/fix", {}, { p }).status, 400);
    assert.match(readFileSync(read(t.id, p).file, "utf8"), /TM-404/, "untouched without confirm");
    const fixed = handleWrite("POST", "/api/doctor/fix", { confirm: true }, { p });
    assert.equal(fixed.status, 200);
    assert.ok(fixed.body.applied.some((a) => a.code === "dangling-dep"));
    assert.doesNotMatch(readFileSync(read(t.id, p).file, "utf8"), /TM-404/);
    assert.ok(readEvents(p).some((e) => e.event === "doctor_fix"));
    assert.equal(handleWrite("POST", "/api/reindex", {}, { p }).body.tasks, 1);
  });
});

describe("parallel", () => {
  it("batches disjoint touches and leaves claimed work out", () => {
    const p = store();
    task(p, "a", { touches: ["src/a.ts"] });
    task(p, "b", { touches: ["src/a.ts", "src/b.ts"] });
    task(p, "c", { touches: ["src/c.ts"] });
    const held = task(p, "d");
    claimTask(held.id, { session: "someone", actor: "main", p });
    const { batches } = get(p, "/api/parallel").body;
    assert.equal(batches.length, 2);
    const ids = batches.flatMap((b) => b.tasks.map((t) => t.id));
    assert.ok(!ids.includes(held.id));
    assert.equal(ids.length, 3);
  });
});

describe("goal import", () => {
  const doc = "# Goal: Bake the harness into the image (BDP-9)\n\n## Success criteria\n\n- codex runs inside the pod\n- the image builds\n";
  it("lands a pasted doc as a task whose gate is the doc's own criteria", () => {
    const p = store();
    const res = handleWrite("POST", "/api/goal/import", { content: doc, name: "pasted.md" }, { p });
    assert.equal(res.status, 201, res.body.error);
    const t = read(res.body.id, p);
    assert.deepEqual(t.acceptance.map((a) => a.text), ["codex runs inside the pod", "the image builds"]);
    assert.equal(t.goalDoc, "pasted.md");
    assert.ok(readEvents(p).some((e) => e.event === "goal_imported" && e.id === t.id));
  });
  it("refuses a doc with no criteria, a path outside the repo, and a missing file", () => {
    const p = store();
    const empty = handleWrite("POST", "/api/goal/import", { content: "# Goal: nothing measurable\n", name: "x.md" }, { p });
    assert.equal(empty.status, 409);
    assert.match(empty.body.error, /criteria/i);
    assert.equal(handleWrite("POST", "/api/goal/import", { path: "/etc/passwd" }, { p }).status, 400);
    assert.equal(handleWrite("POST", "/api/goal/import", { path: "docs/goals/nope.md" }, { p }).status, 404);
    assert.equal(handleWrite("POST", "/api/goal/import", {}, { p }).status, 400);
  });
  it("lands a manifest as an epic with wired dependencies and named skips", () => {
    const p = store();
    mkdirSync(join(p.root, "docs", "goals"), { recursive: true });
    writeFileSync(join(p.root, "docs", "goals", "one.md"), doc);
    writeFileSync(join(p.root, "docs", "goals", "two.md"), "# Goal: Second\n\n## Success criteria\n\n- it works\n");
    writeFileSync(join(p.root, "docs", "goals", "bad.md"), "# Goal: no gate\n");
    writeFileSync(
      join(p.root, "docs", "goals", "prog.plan.json"),
      JSON.stringify({
        epic: { title: "Program" },
        goals: [
          { id: "G1", doc: "docs/goals/one.md", touches: ["a"] },
          { id: "G2", doc: "docs/goals/two.md", dependsOn: ["G1"] },
          { id: "G3", doc: "docs/goals/bad.md" },
        ],
      }),
    );
    const res = handleWrite("POST", "/api/goal/import", { path: "docs/goals/prog.plan.json" }, { p });
    assert.equal(res.status, 201, res.body.error);
    assert.equal(res.body.tasks.length, 2);
    assert.equal(res.body.skipped.length, 1);
    assert.equal(res.body.edges, 1);
    assert.equal(state(p).activeEpic, res.body.epic);
    const second = read(res.body.tasks[1], p);
    assert.deepEqual(second.blockedBy, [res.body.tasks[0]]);
    assert.equal(second.status, "blocked");
  });

  it("previews a manifest without writing, and agrees with what the import then does", () => {
    const p = store();
    mkdirSync(join(p.root, "docs", "goals"), { recursive: true });
    writeFileSync(join(p.root, "docs", "goals", "one.md"), doc);
    writeFileSync(join(p.root, "docs", "goals", "two.md"), "# Goal: Second\n\n## Success criteria\n\n- it works\n");
    writeFileSync(join(p.root, "docs", "goals", "bad.md"), "# Goal: no gate\n");
    writeFileSync(
      join(p.root, "docs", "goals", "prog.plan.json"),
      JSON.stringify({
        epic: { title: "Program" },
        goals: [
          { id: "G1", doc: "docs/goals/one.md", touches: ["a"] },
          { id: "G2", doc: "docs/goals/two.md", dependsOn: ["G1", "GHOST"] },
          { id: "G3", doc: "docs/goals/bad.md" },
        ],
      }),
    );

    const pre = handleWrite("POST", "/api/goal/preview", { path: "docs/goals/prog.plan.json" }, { p });
    assert.equal(pre.status ?? 200, 200, pre.body.error);
    assert.equal(pre.body.kind, "manifest");
    assert.equal(pre.body.epic.title, "Program");
    assert.deepEqual(pre.body.goals.map((g) => g.goalId), ["G1", "G2"]);
    assert.deepEqual(pre.body.goals.map((g) => g.criteria), [2, 1]);
    assert.deepEqual(pre.body.skipped.map((sk) => sk.id), ["G3"]);
    assert.equal(pre.body.edges, 1);
    assert.deepEqual(pre.body.danglingDeps, [{ id: "G2", on: ["GHOST"] }]);

    // A preview that costs board state is not a preview.
    assert.equal(list("epic", {}, p).length, 0);
    assert.equal(list("task", {}, p).length, 0);
    assert.ok(!state(p).activeEpic);

    // And it has to be the same answer the import gives, or it is worse than no preview at all.
    const res = handleWrite("POST", "/api/goal/import", { path: "docs/goals/prog.plan.json" }, { p });
    assert.equal(res.status, 201, res.body.error);
    assert.equal(res.body.tasks.length, pre.body.goals.length);
    assert.equal(res.body.edges, pre.body.edges);
    assert.deepEqual(res.body.skipped.map((sk) => sk.id), pre.body.skipped.map((sk) => sk.id));
    assert.deepEqual(res.body.tasks.map((id) => read(id, p).title), pre.body.goals.map((g) => g.title));
  });

  it("previews a single doc, and refuses at preview time what the import would refuse", () => {
    const p = store();
    const pre = handleWrite("POST", "/api/goal/preview", { content: doc, name: "pasted.md" }, { p });
    assert.equal(pre.status ?? 200, 200);
    assert.equal(pre.body.kind, "doc");
    assert.equal(pre.body.title, "Bake the harness into the image");
    assert.deepEqual(pre.body.criteria, ["codex runs inside the pod", "the image builds"]);
    assert.equal(list("task", {}, p).length, 0, "previewing a doc writes nothing either");

    // Same refusals, same statuses, at preview time rather than at apply time.
    assert.equal(handleWrite("POST", "/api/goal/preview", { content: "# Goal: nothing measurable\n", name: "x.md" }, { p }).status, 409);
    assert.equal(handleWrite("POST", "/api/goal/preview", { content: "no heading at all\n", name: "x.md" }, { p }).status, 400);
    assert.equal(handleWrite("POST", "/api/goal/preview", { path: "/etc/passwd" }, { p }).status, 400);
    assert.equal(handleWrite("POST", "/api/goal/preview", { path: "docs/goals/nope.md" }, { p }).status, 404);
    assert.equal(handleWrite("POST", "/api/goal/preview", {}, { p }).status, 400);
  });
});

describe("planning sessions", () => {
  it("opens, converses, resumes and ends a session over HTTP", () => {
    const p = store();
    const made = handleWrite("POST", "/api/planner", { goal: "Make the planner resumable" }, { p });
    assert.equal(made.status, 201);
    const id = made.body.id;
    assert.match(id, /^PL-[0-9a-f]{12}$/);

    assert.equal(handleWrite("POST", `/api/planner/${id}/turn`, { role: "agent", kind: "question", text: "Which epic?" }, { p }).status ?? 200, 200);
    handleWrite("POST", `/api/planner/${id}/turn`, { role: "operator", kind: "answer", text: "A new one" }, { p });

    // Resume: a plain GET is enough, because the session is a file rather than server memory.
    const got = handleWrite("GET", `/api/planner/${id}`, null, { p });
    assert.deepEqual(got.body.turns.map((t) => t.kind), ["question", "answer"]);
    assert.equal(handleWrite("GET", "/api/planner", null, { p }).body.sessions.length, 1);

    assert.equal(handleWrite("POST", `/api/planner/${id}/close`, { status: "applied" }, { p }).body.status, "applied");
    assert.equal(handleWrite("POST", `/api/planner/${id}/turn`, { kind: "note", text: "after" }, { p }).status, 409);
    assert.equal(handleWrite("DELETE", `/api/planner/${id}`, null, { p }).body.deleted, true);
    assert.equal(handleWrite("GET", `/api/planner/${id}`, null, { p }).status, 404);
  });

  it("refuses a bad session id rather than letting it reach the filesystem", () => {
    const p = store();
    for (const bad of ["..%2F..%2Fetc", "PL-zzzz", "TM-001"]) {
      assert.equal(handleWrite("GET", `/api/planner/${bad}`, null, { p }).status, 400, bad);
    }
    assert.equal(handleWrite("POST", "/api/planner", { goal: "  " }, { p }).status, 400);
    assert.equal(handleWrite("POST", "/api/planner", {}, { p }).status, 400);
  });

  it("proposes, holds the proposal server-side, and applies only what was approved", () => {
    const p = store();
    const id = handleWrite("POST", "/api/planner", { goal: "Add a preflight" }, { p }).body.id;
    const operations = [
      { op: "epic.create", args: { ref: "E", title: "Preflight", body: "why" } },
      { op: "task.create", args: { ref: "T", epic: "E", title: "Probe", body: "b", acceptance: ["reports"] } },
    ];
    const prop = handleWrite("POST", `/api/planner/${id}/propose`, { operations }, { p });
    assert.equal(prop.body.ok, true);
    assert.equal(prop.body.operations.length, 2);
    assert.match(prop.body.operations[0].consequence, /independently reviewable epic/);
    assert.equal(list("task", {}, p).length, 0, "proposing writes nothing to the board");

    // The proposal is held on the SESSION. An approval is checked against what the server
    // proposed, never against whatever the browser hands back.
    assert.equal(handleWrite("GET", `/api/planner/${id}`, null, { p }).body.proposal.digest, prop.body.digest);
    assert.equal(handleWrite("POST", `/api/planner/${id}/apply`, { approvedDigest: "deadbeef" }, { p }).status, 409);
    assert.equal(list("task", {}, p).length, 0, "a wrong digest applies nothing");
    assert.equal(handleWrite("POST", `/api/planner/${id}/apply`, {}, { p }).status, 409);

    const applied = handleWrite("POST", `/api/planner/${id}/apply`, { approvedDigest: prop.body.digest }, { p });
    assert.equal(applied.status, 201);
    assert.equal(applied.body.created.length, 2);
    assert.equal(list("task", {}, p).length, 1);
    assert.equal(read(list("task", {}, p)[0].id, p).acceptance[0].text, "reports");
    // The conversation ends when its proposal lands.
    assert.equal(handleWrite("GET", `/api/planner/${id}`, null, { p }).body.status, "applied");
    assert.ok(readEvents(p).some((e) => e.event === "planner_applied"));
  });

  it("reopens a session that a crash left mid-apply, instead of stranding it forever", () => {
    const p = store();
    const id = handleWrite("POST", "/api/planner", { goal: "Survive a restart" }, { p }).body.id;

    // Exactly the state a crash between the claim and the apply leaves behind: not open, so
    // nothing can be proposed or answered, and holding no proposal, so nothing can be approved.
    // Before this, no request could ever move it again.
    mutateSession(id, () => ({ proposal: null, status: "applying" }), p);
    assert.equal(handleWrite("GET", `/api/planner/${id}`, null, { p }).body.status, "applying");

    const prop = handleWrite("POST", `/api/planner/${id}/propose`, {
      operations: [{ op: "epic.create", args: { ref: "E", title: "Recovered", body: "why" } }],
    }, { p });
    assert.equal(prop.status ?? 200, 200, "the session took a proposal again");
    assert.equal(handleWrite("GET", `/api/planner/${id}`, null, { p }).body.status, "open");
    assert.ok(readEvents(p).some((e) => e.event === "planner_apply_abandoned"));
    assert.equal(handleWrite("POST", `/api/planner/${id}/apply`, { approvedDigest: prop.body.digest }, { p }).status, 201);
  });

  it("spends an approval once — a second apply of the same digest writes nothing", () => {
    const p = store();
    const id = handleWrite("POST", "/api/planner", { goal: "Approve once" }, { p }).body.id;
    const operations = [{ op: "epic.create", args: { ref: "E", title: "Approved once", body: "why" } }];
    const prop = handleWrite("POST", `/api/planner/${id}/propose`, { operations }, { p });

    assert.equal(handleWrite("POST", `/api/planner/${id}/apply`, { approvedDigest: prop.body.digest }, { p }).status, 201);
    // The failure this closes: an approval authorises ONE write, and reading the proposal then
    // applying it in two steps let it authorise as many as the caller asked for. A double-click on
    // the confirmation created the whole set twice, because the second request found the same
    // proposal and the same digest still sitting on the session.
    const again = handleWrite("POST", `/api/planner/${id}/apply`, { approvedDigest: prop.body.digest }, { p });
    assert.equal(again.status, 409);
    assert.equal(list("epic", {}, p).filter((e) => e.title === "Approved once").length, 1, "one approval, one epic");
  });

  it("puts the proposal back when a landing fails, rather than stranding the session", () => {
    const p = store();
    const id = handleWrite("POST", "/api/planner", { goal: "Fails to land" }, { p }).body.id;
    // Valid at preview, refused at apply: the epic it names is removed in between, so the landing
    // fails inside the lock rather than at validation.
    const epic = create("epic", { title: "Vanishes" }, "", p);
    const operations = [{ op: "task.create", args: { epic: epic.id, title: "Orphan", body: "b", acceptance: ["x"] } }];
    const prop = handleWrite("POST", `/api/planner/${id}/propose`, { operations }, { p });
    assert.equal(prop.body.ok, true);

    unlinkSync(read(epic.id, p).file);
    reindex(p);
    const failed = handleWrite("POST", `/api/planner/${id}/apply`, { approvedDigest: prop.body.digest }, { p });
    assert.equal(failed.status, 409);
    assert.equal(list("task", {}, p).length, 0, "nothing landed");

    // The operator can still see and retry what they approved.
    const after = handleWrite("GET", `/api/planner/${id}`, null, { p }).body;
    assert.equal(after.status, "open");
    assert.equal(after.proposal.digest, prop.body.digest);
  });

  it("refuses to propose an operation that is not governed", () => {
    const p = store();
    const id = handleWrite("POST", "/api/planner", { goal: "Try something" }, { p }).body.id;
    const res = handleWrite("POST", `/api/planner/${id}/propose`, { operations: [{ op: "task.delete", args: { id: "TM-001" } }] }, { p });
    assert.equal(res.status, 400);
    assert.match(res.body.error, /not a governed planning operation/);
    assert.equal(handleWrite("POST", `/api/planner/${id}/apply`, { approvedDigest: "x" }, { p }).status, 409, "and there is nothing to apply");
  });

  it("lists configured planning agents without ever naming the command", async () => {
    const p = store();
    assert.deepEqual(handleWrite("GET", "/api/planner/agents", null, { p }).body.agents, [], "none ship by default");

    const fake = join(dirname(fileURLToPath(import.meta.url)), "fixtures", "fake-acp-agent.mjs");
    writeConfig({ planner: { agents: [{ id: "fake", label: "Fake ACP agent", command: process.execPath, args: [fake] }] } }, p);
    const listed = handleWrite("GET", "/api/planner/agents", null, { p }).body.agents;
    assert.deepEqual(listed.map((a) => a.id), ["fake"]);
    assert.equal(listed[0].boardWrites, "confirm each set", "not read from the agent");
    assert.ok(!JSON.stringify(listed).includes(fake), "the command line is not health information");
    assert.ok(!JSON.stringify(listed).includes(process.execPath));

    // A probe actually spawns, because a check that only reads configuration reports healthy for a
    // command that is not installed.
    const probed = await handleAsync("POST", "/api/planner/agents/fake/probe", {}, { p });
    assert.equal(probed.body.connected, true);
    assert.ok(!JSON.stringify(probed.body).includes(fake));
    assert.equal((await handleAsync("POST", "/api/planner/agents/ghost/probe", {}, { p })).status, 404);
  });

  it("keeps a planning session off the board until something is approved", () => {
    const p = store();
    handleWrite("POST", "/api/planner", { goal: "Nothing lands yet" }, { p });
    // The whole reason a session is not an entity: an unfinished conversation must not appear as
    // work anybody committed to.
    assert.equal(list("task", {}, p).length, 0);
    assert.equal(list("epic", {}, p).length, 0);
    assert.equal(boardPayload(p).tasks.length, 0);
  });
});

describe("entity edits", () => {
  it("retitles an epic without renaming its file, and validates each kind's extra fields", () => {
    const p = store();
    const e = create("epic", { title: "typoed titel" }, "", p);
    const before = read(e.id, p).file;
    const res = handleWrite("PATCH", `/api/epic/${e.id}`, { title: "typoed title, fixed" }, { p });
    assert.equal(res.status, 200);
    assert.equal(read(e.id, p).file, before, "the id is the identity; the slug is decoration");
    assert.equal(read(e.id, p).title, "typoed title, fixed");
    assert.equal(handleWrite("PATCH", `/api/epic/${e.id}`, {}, { p }).status, 400);

    const a = create("adr", { title: "a decision", status: "proposed", deciders: [] }, "", p);
    assert.equal(handleWrite("PATCH", `/api/adr/${a.id}`, { deciders: ["ryan"] }, { p }).status, 200);
    assert.deepEqual(read(a.id, p).deciders, ["ryan"]);
    assert.equal(handleWrite("PATCH", `/api/adr/${a.id}`, { deciders: "ryan" }, { p }).status, 400);

    const s = create("sprint", { title: "s1", status: "open" }, "", p);
    assert.equal(handleWrite("PATCH", `/api/sprint/${s.id}`, { ends: "next friday" }, { p }).status, 400);
    assert.equal(handleWrite("PATCH", `/api/sprint/${s.id}`, { ends: "2026-09-12" }, { p }).status, 200);
    assert.equal(read(s.id, p).ends, "2026-09-12");

    const c = propose({ title: "a cap", impact: "M", effort: "S", confidence: "H" }, p);
    assert.equal(handleWrite("PATCH", `/api/capability/${c.id}`, { impact: "X" }, { p }).status, 400);
    const ok2 = handleWrite("PATCH", `/api/capability/${c.id}`, { impact: "H" }, { p });
    assert.equal(ok2.status, 200);
    assert.equal(read(c.id, p).impact, "H");
    assert.equal(typeof ok2.body.score, "number");
  });
});

describe("delete and restore", () => {
  it("hides the card, keeps the file, releases the claim, and comes back on restore", () => {
    const p = store();
    const t = task(p, "expendable");
    sessioned("alpha", () => act(p, { action: "transition", id: t.id, status: "in_progress" }));
    const refused = sessioned("beta", () => act(p, { action: "delete", id: t.id }));
    assert.equal(refused.status, 409, "someone else's in-flight work is not deletable from a tab");
    const res = sessioned("alpha", () => act(p, { action: "delete", id: t.id, why: "duplicate" }));
    assert.equal(res.status, 200);
    assert.ok(existsSync(read(t.id, p).file), "the file stays");
    assert.ok(!list("task", {}, p).some((x) => x.id === t.id), "hidden from the board");
    assert.equal(state(p).claims[t.id], undefined, "claim released");
    assert.ok(readEvents(p).some((e) => e.event === "deleted" && e.id === t.id && e.why === "duplicate"));
    assert.equal(get(p, `/api/task/${t.id}`).status, 200, "still readable while deleted");
    assert.equal(act(p, { action: "restore", id: t.id }).body.status, "in_progress");
    assert.equal(act(p, { action: "restore", id: t.id }).status, 409);
  });
});

describe("templates write", () => {
  it("creates, refuses a silent overwrite, patches, and rejects an unsafe name", () => {
    const p = store();
    const res = handleWrite("POST", "/api/templates", { name: "incident", description: "an outage", body: "## Timeline\n" }, { p });
    assert.equal(res.status, 201, res.body.error);
    assert.equal(readTemplate("incident", p).fields.description, "an outage");
    assert.equal(handleWrite("POST", "/api/templates", { name: "incident", body: "x" }, { p }).status, 409);
    assert.equal(handleWrite("PATCH", "/api/templates/incident", { body: "## Impact\n" }, { p }).status, 200);
    assert.match(readTemplate("incident", p).body, /## Impact/);
    assert.equal(handleWrite("POST", "/api/templates", { name: "../x", body: "" }, { p }).status, 400);
  });
});

describe("meta and skills", () => {
  it("publishes every vocabulary the SPA would otherwise hardcode", () => {
    const p = store();
    const m = get(p, "/api/meta").body;
    assert.deepEqual(m.vocab.findFields, FIELD_NAMES);
    assert.deepEqual(m.vocab.columns, COLUMNS);
    assert.ok(m.plugin.version.length > 0);
    assert.ok(m.vocab.eventCatalog.deleted, "the new kind is catalogued");
    assert.equal(typeof m.gates.enforce, "boolean");
    const skills = get(p, "/api/skills").body;
    assert.ok(skills.length >= 20);
    assert.equal(skills.find((s) => s.name === "board").userInvokable, true);
    assert.equal(skills.find((s) => s.name === "enhance-capture").userInvokable, false);
  });
});

describe("ntfy test", () => {
  it("explains silence, and sends through the injected fetch when configured", async () => {
    const p = store();
    writeConfig({ ntfy: { topic: "tm-test" } }, p);
    // The suite runs inside a real environment that may carry its own ntfy settings; the test
    // owns all three so it reads its fixture rather than the machine's phone.
    const saved = Object.fromEntries(["TM_NTFY_TOKEN", "TM_NTFY_TOPIC", "TM_NTFY_SERVER"].map((k) => [k, process.env[k]]));
    for (const k of Object.keys(saved)) delete process.env[k];
    try {
      const quiet = await handleAsync("POST", "/api/ntfy/test", {}, { p });
      assert.equal(quiet.body.sent, false);
      assert.match(quiet.body.reason, /TM_NTFY_TOKEN/);
      process.env.TM_NTFY_TOKEN = "tok";
      const calls = [];
      const fetchImpl = async (url, init) => {
        calls.push({ url, init });
        return { ok: true, status: 200, text: async () => "" };
      };
      const sent = await handleAsync("POST", "/api/ntfy/test", {}, { p, fetchImpl });
      assert.equal(sent.body.sent, true);
      assert.match(calls[0].url, /tm-test$/);
      assert.match(calls[0].init.headers.Authorization, /tok/);
    } finally {
      for (const [k, v] of Object.entries(saved)) {
        if (v === undefined) delete process.env[k];
        else process.env[k] = v;
      }
    }
  });
});
