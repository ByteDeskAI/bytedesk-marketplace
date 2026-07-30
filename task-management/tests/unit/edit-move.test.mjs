/**
 * Correcting a task, and refiling it.
 *
 * Every other field on a task had a verb. The two you type first — the title and the body — had
 * none, and the epic had none anywhere at all: not the CLI, not MCP, and not the dashboard,
 * whose PATCH took title and body only. Since `tm task new` files into whatever epic is active
 * and the create gate *requires* an active epic, filing into the wrong one was one keystroke
 * away with no way back short of editing frontmatter by hand.
 *
 * The move tests are mostly about the two epics' lifecycles, because that is the part a field
 * write would get wrong.
 */
import { after, describe, it } from "node:test";
import assert from "node:assert/strict";
import { cleanup, tempStore } from "./helpers.mjs";
import { create, editTask, moveTask, read, readEvents, update } from "../../lib/store.mjs";

const stores = [];
function store() {
  const p = tempStore();
  stores.push(p.root);
  return p;
}
after(() => cleanup(...stores));

const events = (p, kind) => readEvents(p).filter((e) => e.event === kind);

describe("editTask", () => {
  it("corrects a title", () => {
    const p = store();
    const t = create("task", { title: "typoed titel" }, "", p);

    const res = editTask(t.id, { title: "the corrected title" }, p);

    assert.deepEqual(res.changed, ["title"]);
    assert.equal(res.was, "typoed titel", "the old title is reported, because that is the thing you were fixing");
    assert.equal(read(t.id, p).title, "the corrected title");
  });

  it("keeps the file name, because the id is the identity and the slug is decoration", () => {
    const p = store();
    const t = create("task", { title: "typoed titel" }, "", p);
    const before = read(t.id, p).file;

    editTask(t.id, { title: "the corrected title" }, p);

    // A rename is a delete-plus-add in git: it breaks blame on the entity's whole history, and
    // the old path may already be in a commit message or an evidence ref.
    assert.equal(read(t.id, p).file, before);
    assert.match(before, /typoed-titel\.md$/);
  });

  it("rewrites the body, and can empty it", () => {
    const p = store();
    const t = create("task", { title: "t" }, "the original body", p);

    assert.deepEqual(editTask(t.id, { body: "## Notes\nrewritten" }, p).changed, ["body"]);
    assert.match(read(t.id, p).body, /rewritten/);
    assert.deepEqual(editTask(t.id, { body: "" }, p).changed, ["body"], "emptying a body is a change, not a no-op");
  });

  it("changes both at once", () => {
    const p = store();
    const t = create("task", { title: "before" }, "before", p);
    assert.deepEqual(editTask(t.id, { title: "after", body: "after" }, p).changed, ["title", "body"]);
  });

  it("writes nothing when the value is what it already was", () => {
    const p = store();
    const t = create("task", { title: "already right" }, "body", p);
    const stamp = read(t.id, p).updated;

    const res = editTask(t.id, { title: "already right", body: "body" }, p);

    assert.deepEqual(res.changed, []);
    assert.equal(read(t.id, p).updated, stamp, "an `updated` bump would make the task look like it moved when nothing did");
    assert.equal(events(p, "edit").length, 0);
  });

  it("sees an unchanged body through the round-trip that does not return what it was given", () => {
    const p = store();
    const t = create("task", { title: "t" }, "notes", p);

    // serializeDoc writes a newline after the closing fence and parseDoc hands it back, so the
    // body stored as "notes" reads as "\nnotes". A raw !== reports a change every time — and a
    // form re-submitting the body it was handed is the most ordinary call there is.
    assert.equal(read(t.id, p).body, "\nnotes", "if this ever becomes identity, the trim below is merely harmless");
    assert.deepEqual(editTask(t.id, { body: "notes" }, p).changed, []);
  });

  it("trims, and refuses a title that is only whitespace", () => {
    const p = store();
    const t = create("task", { title: "t" }, "", p);

    assert.deepEqual(editTask(t.id, { title: "  padded  " }, p).changed, ["title"]);
    assert.equal(read(t.id, p).title, "padded");
    // An empty title makes the task unfindable on every surface that lists it by name.
    assert.throws(() => editTask(t.id, { title: "   " }, p), /cannot be empty/);
  });

  it("refuses an id that does not exist", () => {
    assert.throws(() => editTask("TM-404", { title: "x" }, store()), /not found/);
  });

  it("logs one specific event, so the log says what happened rather than 'a field changed'", () => {
    const p = store();
    const t = create("task", { title: "was" }, "", p);
    editTask(t.id, { title: "now" }, p);

    const [e] = events(p, "edit");
    assert.ok(e, "the generic `update` event alone cannot distinguish a retitle from a status move");
    assert.equal(e.fields, "title");
    assert.equal(e.was, "was");
  });
});

describe("moveTask", () => {
  const twoEpics = (p) => [create("epic", { title: "first" }, "", p), create("epic", { title: "second" }, "", p)];

  it("refiles a task under another epic", () => {
    const p = store();
    const [a, b] = twoEpics(p);
    const t = create("task", { title: "misfiled", epic: a.id }, "", p);

    const res = moveTask(t.id, b.id, p);

    assert.deepEqual([res.from, res.to, res.changed], [a.id, b.id, true]);
    assert.equal(read(t.id, p).epic, b.id);
  });

  it("detaches on `none`", () => {
    const p = store();
    const [a] = twoEpics(p);
    const t = create("task", { title: "orphan me", epic: a.id }, "", p);

    assert.equal(moveTask(t.id, "none", p).to, null);
    assert.equal(read(t.id, p).epic, undefined);
  });

  it("is a no-op when it is already there, and says so instead of writing", () => {
    const p = store();
    const [a] = twoEpics(p);
    const t = create("task", { title: "t", epic: a.id }, "", p);

    assert.equal(moveTask(t.id, a.id, p).changed, false);
    assert.equal(events(p, "moved").length, 0);
  });

  it("reopens a done destination when the task arriving is not finished", () => {
    const p = store();
    const [a, b] = twoEpics(p);
    const t = create("task", { title: "live work", epic: a.id }, "", p);
    update(b.id, { status: "done" }, p);

    const res = moveTask(t.id, b.id, p);

    // A finished epic holding live work is the same lie `tm reopen` refuses to leave behind,
    // and autoCloseEpic will never re-close it on its own.
    assert.equal(res.reopened, b.id);
    assert.equal(read(b.id, p).status, "open");
  });

  it("leaves a done destination closed when the task arriving is also done", () => {
    const p = store();
    const [a, b] = twoEpics(p);
    const t = create("task", { title: "finished", epic: a.id, status: "done" }, "", p);
    update(b.id, { status: "done" }, p);

    assert.equal(moveTask(t.id, b.id, p).reopened, undefined);
    assert.equal(read(b.id, p).status, "done", "nothing unfinished arrived, so nothing is unfinished");
  });

  it("closes the source epic when the move leaves only finished work behind", () => {
    const p = store();
    const [a, b] = twoEpics(p);
    const done = create("task", { title: "already done", epic: a.id, status: "done" }, "", p);
    const t = create("task", { title: "the last open one", epic: a.id }, "", p);

    const res = moveTask(t.id, b.id, p);

    assert.equal(res.closed, a.id, "the source just became complete, and finishing a task there would have closed it");
    assert.equal(read(a.id, p).status, "done");
    assert.equal(read(done.id, p).epic, a.id);
  });

  it("does not close a source it emptied completely", () => {
    const p = store();
    const [a, b] = twoEpics(p);
    const t = create("task", { title: "only child", epic: a.id }, "", p);

    assert.equal(moveTask(t.id, b.id, p).closed, undefined);
    assert.equal(read(a.id, p).status, "open", "zero tasks is not an achievement");
  });

  it("refuses a destination that is not an epic, and one that does not exist", () => {
    const p = store();
    const [a] = twoEpics(p);
    const t = create("task", { title: "t", epic: a.id }, "", p);
    const other = create("task", { title: "not an epic" }, "", p);

    assert.throws(() => moveTask(t.id, other.id, p), /not an epic id/);
    assert.throws(() => moveTask(t.id, "EP-404", p), /not found/);
    assert.equal(read(t.id, p).epic, a.id, "a refused move must not have half-written");
  });

  it("refuses to move something that is not a task", () => {
    const p = store();
    const [a, b] = twoEpics(p);
    assert.throws(() => moveTask(a.id, b.id, p), /is not a task/);
  });

  it("records where it came from, which the destination alone does not tell you", () => {
    const p = store();
    const [a, b] = twoEpics(p);
    const t = create("task", { title: "t", epic: a.id }, "", p);
    moveTask(t.id, b.id, p);

    const [e] = events(p, "moved");
    assert.deepEqual([e.from, e.to], [a.id, b.id]);
  });
});
