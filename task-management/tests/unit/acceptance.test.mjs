/**
 * Acceptance criteria were a one-way door.
 *
 * Three surfaces could tick one and none could untick it — the dashboard's checkbox even set
 * `isDisabled` once checked, locking the box it had just ticked. Nothing anywhere could remove a
 * criterion added by mistake. Since `tm done` is gated on the list, a stray click or a typo
 * permanently changed what the tool would accept, and the only way back was editing the frontmatter
 * JSON by hand.
 *
 * Reported by a user who ticked one on the dashboard and could not untick it.
 */
import { after, describe, it } from "node:test";
import assert from "node:assert/strict";
import { cleanup, tempStore } from "./helpers.mjs";
import { create, read, readEvents, removeCriterion, setCriterion, update } from "../../lib/store.mjs";

const stores = [];
function store() {
  const p = tempStore();
  stores.push(p.root);
  return p;
}
after(() => cleanup(...stores));

const withCriteria = (p, ...texts) =>
  create("task", { title: "gated", acceptance: texts.map((text) => ({ text, done: false })) }, "", p);

const events = (p, kind) => readEvents(p).filter((e) => e.event === kind);

describe("ticking and unticking", () => {
  it("ticks", () => {
    const p = store();
    const t = withCriteria(p, "first", "second");

    const res = setCriterion(t.id, 1, true, p);

    assert.equal(res.met, 1);
    assert.equal(read(t.id, p).acceptance[0].done, true);
  });

  it("unticks one ticked by mistake", () => {
    const p = store();
    const t = withCriteria(p, "first", "second");
    setCriterion(t.id, 1, true, p);

    const res = setCriterion(t.id, 1, false, p);

    assert.equal(res.met, 0);
    assert.equal(read(t.id, p).acceptance[0].done, false);
  });

  it("drops the met-at timestamp when unticking", () => {
    const p = store();
    const t = withCriteria(p, "first");
    setCriterion(t.id, 1, true, p);
    assert.ok(read(t.id, p).acceptance[0].at, "ticking records when");

    setCriterion(t.id, 1, false, p);

    // A met-at on something not met reads as history, and would survive into `tm export`.
    assert.equal(read(t.id, p).acceptance[0].at, undefined);
  });

  it("keeps the criterion's text and position", () => {
    const p = store();
    const t = withCriteria(p, "first", "second", "third");
    setCriterion(t.id, 2, true, p);
    setCriterion(t.id, 2, false, p);

    assert.deepEqual(read(t.id, p).acceptance.map((a) => a.text), ["first", "second", "third"]);
  });

  it("does not reopen a task that is already done", () => {
    const p = store();
    const t = withCriteria(p, "first");
    setCriterion(t.id, 1, true, p);
    update(t.id, { status: "done" }, p);

    setCriterion(t.id, 1, false, p);

    // A decision, not an invariant: the work may genuinely be finished and the criterion simply
    // mis-ticked. `tm doctor` already reports this state as `done-unmet` and refuses to auto-repair
    // it for the same reason — silently reopening someone's finished task would overrule them.
    assert.equal(read(t.id, p).status, "done");
  });

  it("refuses an index that does not exist, and an unknown task", () => {
    const p = store();
    const t = withCriteria(p, "only one");
    assert.throws(() => setCriterion(t.id, 2, true, p), /no acceptance criterion 2/);
    assert.throws(() => setCriterion(t.id, 0, true, p), /no acceptance criterion 0/);
    assert.throws(() => setCriterion("TM-404", 1, true, p), /not found/);
  });

  it("logs which way it went", () => {
    const p = store();
    const t = withCriteria(p, "first");
    setCriterion(t.id, 1, true, p);
    setCriterion(t.id, 1, false, p);

    assert.equal(events(p, "ac_met").length, 1);
    assert.equal(events(p, "ac_unmet").length, 1, "an untick is a real change and belongs on the timeline");
    assert.equal(events(p, "ac_unmet")[0].text, "first");
  });
});

describe("removing", () => {
  it("removes a criterion added by mistake", () => {
    const p = store();
    const t = withCriteria(p, "first", "typo'd", "third");

    const res = removeCriterion(t.id, 2, p);

    assert.equal(res.removed, "typo'd");
    assert.deepEqual(read(t.id, p).acceptance.map((a) => a.text), ["first", "third"]);
  });

  it("returns the surviving list, because removal renumbers what follows", () => {
    const p = store();
    const t = withCriteria(p, "first", "second", "third");

    // "AC 3" in a commit message now points at a different sentence. The callers print this.
    const res = removeCriterion(t.id, 1, p);
    assert.deepEqual(res.acceptance.map((a) => a.text), ["second", "third"]);
  });

  it("keeps the tick state of everything else", () => {
    const p = store();
    const t = withCriteria(p, "first", "second", "third");
    setCriterion(t.id, 3, true, p);

    removeCriterion(t.id, 1, p);

    const acc = read(t.id, p).acceptance;
    assert.deepEqual(acc.map((a) => [a.text, Boolean(a.done)]), [["second", false], ["third", true]]);
  });

  it("can empty the list, which ungates a task nothing could close", () => {
    const p = store();
    const t = withCriteria(p, "an unmeetable typo");

    removeCriterion(t.id, 1, p);

    // The point of the whole change: an unmeetable criterion gated `tm done` forever.
    assert.deepEqual(read(t.id, p).acceptance, []);
  });

  it("refuses an index that does not exist", () => {
    const p = store();
    const t = withCriteria(p, "only one");
    assert.throws(() => removeCriterion(t.id, 5, p), /no acceptance criterion 5/);
    assert.deepEqual(read(t.id, p).acceptance.length, 1, "a refused removal must not have half-written");
  });

  it("records what it removed, since the text is otherwise gone", () => {
    const p = store();
    const t = withCriteria(p, "first", "the one that vanished");
    removeCriterion(t.id, 2, p);

    const [e] = events(p, "ac_removed");
    assert.equal(e.text, "the one that vanished");
  });
});
