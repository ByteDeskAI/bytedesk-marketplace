/**
 * The way back from done.
 *
 * `tm start` on a done task was the de facto reopen, and it lied in four places at once.
 * Reproduced before this existed: TM-001 done → "EP-001 closed", then `tm start TM-001` left
 * `status: "in_progress"` with `closed: "…"` still in the frontmatter, the epic still `done`
 * while holding a live child, `state.activeEpic` still pointing at the closed epic so the next
 * `tm task new` filed into it, `tm export csv` emitting that closed date in the Resolved
 * column — the one column a Jira import cannot repair — and `tm doctor` reporting
 * "no problems found", exit 0.
 */
import { after, describe, it } from "node:test";
import assert from "node:assert/strict";
import { cleanup, tempStore } from "./helpers.mjs";
import { autoCloseEpic, create, read, readEvents, reopenEpic, state, update, writeConfig, writeState } from "../../lib/store.mjs";
import { diagnose, repairAll } from "../../lib/doctor.mjs";
import { toCsv } from "../../lib/export.mjs";

const stores = [];
function store() {
  const p = tempStore();
  stores.push(p.root);
  return p;
}
after(() => cleanup(...stores));

/** An epic with one task, both finished, and the epic auto-closed behind it. */
function finished() {
  const p = store();
  const e = create("epic", { title: "demo epic" }, "", p);
  writeState({ activeEpic: e.id }, p);
  const t = create("task", { title: "alpha one thing", epic: e.id, acceptance: [] }, "", p);
  update(t.id, { status: "done", closed: new Date().toISOString() }, p);
  autoCloseEpic(e.id, p);
  return { p, epic: e.id, task: t.id };
}

describe("leaving done", () => {
  it("drops the closed date, so exports stop dating open work", () => {
    const { p, task } = finished();
    assert.ok(read(task, p).closed, "precondition: it was closed");

    update(task, { status: "in_progress" }, p);

    assert.equal(read(task, p).closed, undefined);
  });

  it("clears it for every status out of done, not just in_progress", () => {
    for (const status of ["open", "in_progress", "blocked", "parked"]) {
      const { p, task } = finished();
      update(task, { status }, p);
      assert.equal(read(task, p).closed, undefined, `status ${status} kept closed`);
    }
  });

  it("reopens the epic that closed behind it", () => {
    const { p, epic, task } = finished();
    assert.equal(read(epic, p).status, "done");

    update(task, { status: "in_progress" }, p);

    assert.equal(read(epic, p).status, "open", "autoCloseEpic refuses an epic already done, so it would never re-close");
    assert.equal(read(epic, p).closed, undefined);
    assert.ok(readEvents(p).some((e) => e.event === "epic_reopened" && e.id === epic));
  });

  it("leaves a done task alone when the patch is not a status change", () => {
    const { p, task } = finished();
    update(task, { assignee: "ryan" }, p);
    assert.ok(read(task, p).closed, "an unrelated edit must not resurrect a closed task");
  });

  it("does not fire when a task moves between two resolved states", () => {
    const { p, task } = finished();
    const closed = read(task, p).closed;
    update(task, { status: "deleted" }, p);
    assert.equal(read(task, p).closed, closed);
  });

  it("does not recurse: the epic's own reopen is not treated as a task reopen", () => {
    // The guard is kind-aware, so reopenEpic's update() cannot re-enter it.
    const { p, epic, task } = finished();
    update(task, { status: "open" }, p);
    assert.equal(read(epic, p).status, "open");
  });

  it("respects autoCloseEpics: false — a team that does not want auto-close does not want auto-reopen", () => {
    const { p, epic, task } = finished();
    writeConfig({ autoCloseEpics: false }, p);
    update(task, { status: "in_progress" }, p);
    assert.equal(read(epic, p).status, "done");
    assert.equal(read(task, p).closed, undefined, "but the task's own closed date still clears");
  });
});

describe("the active epic", () => {
  it("is cleared when the epic auto-closes, so nothing files into a closed epic", () => {
    const { p, epic } = finished();
    // Before this, activeEpic still named the closed epic and the next `tm task new` landed
    // in it — the exact condition dashboard-api's transition refuses by name.
    assert.equal(state(p).activeEpic ?? null, null, `still active: ${state(p).activeEpic}`);
    void epic;
  });

  it("leaves a different active epic alone", () => {
    const p = store();
    const other = create("epic", { title: "other" }, "", p);
    const e = create("epic", { title: "closing" }, "", p);
    const t = create("task", { title: "a task", epic: e.id }, "", p);
    writeState({ activeEpic: other.id }, p);
    update(t.id, { status: "done" }, p);
    autoCloseEpic(e.id, p);

    assert.equal(state(p).activeEpic, other.id);
  });
});

describe("reopenEpic", () => {
  it("refuses an epic that is not done", () => {
    const p = store();
    const e = create("epic", { title: "open one" }, "", p);
    assert.equal(reopenEpic(e.id, p), false);
  });

  it("refuses an epic that does not exist", () => {
    assert.equal(reopenEpic("EP-404", store()), false);
  });
});

describe("the CSV a Jira import would read", () => {
  it("leaves Resolved empty once the task is reopened", () => {
    const { p, task } = finished();
    const header = toCsv({}, p).split("\n")[0].split(",");
    const resolvedCol = header.indexOf("Resolved");

    update(task, { status: "in_progress" }, p);

    const row = toCsv({}, p).split("\n")[1].split(",");
    assert.equal(row[resolvedCol], "", "a resolution date on open work is the one column an import cannot repair");
  });
});

describe("doctor catches what a hand edit or a merge leaves", () => {
  it("reports a done epic holding live children", () => {
    const { p, epic, task } = finished();
    // Force the broken shape directly, as a merge would.
    update(task, { status: "in_progress" }, p);
    update(epic, { status: "done" }, p);

    const f = diagnose(p).find((x) => x.code === "epic-done-open-children");
    assert.ok(f);
    assert.equal(f.level, "error");
    assert.match(f.message, new RegExp(task));

    repairAll(p);
    assert.equal(read(epic, p).status, "open");
  });

  it("reports a closed date on open work, and drops it", () => {
    const p = store();
    const t = create("task", { title: "open but dated" }, "", p);
    update(t.id, { closed: new Date().toISOString() }, p);

    const f = diagnose(p).find((x) => x.code === "closed-on-open-task");
    assert.ok(f);
    assert.equal(f.level, "warning");

    repairAll(p);
    assert.equal(read(t.id, p).closed, undefined);
    assert.deepEqual(diagnose(p).filter((x) => x.code === "closed-on-open-task"), []);
  });

  it("says nothing about a legitimately closed epic", () => {
    const { p } = finished();
    assert.ok(!diagnose(p).some((x) => x.code === "epic-done-open-children"));
  });

  it("says nothing about a closed date on a done task", () => {
    const { p } = finished();
    assert.ok(!diagnose(p).some((x) => x.code === "closed-on-open-task"));
  });
});
