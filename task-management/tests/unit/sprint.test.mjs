/**
 * Sprints, and the number they exist to produce.
 *
 * `estimate` was writable from the CLI, the dashboard and MCP, and read by nothing — the same
 * write-only shape `priority` and `rank` had. `burndown` counts CARDS, so a two-point card and a
 * thirteen-point card moved the line by the same amount. A sprint is what gives points a
 * denominator: this many committed, this many done.
 */
import { after, describe, it } from "node:test";
import assert from "node:assert/strict";
import { cleanup, tempStore } from "./helpers.mjs";
import { sprintReport } from "../../lib/render.mjs";
import { create, update } from "../../lib/store.mjs";

const stores = [];
function store() {
  const p = tempStore();
  stores.push(p.root);
  return p;
}
after(() => cleanup(...stores));

function sprint(p, cards) {
  const s = create("sprint", { title: "Sprint 12", status: "open" }, "", p);
  for (const c of cards) {
    const t = create("task", { title: c.title, sprint: s.id, ...(c.points === undefined ? {} : { estimate: c.points }) }, "", p);
    if (c.status) update(t.id, { status: c.status }, p);
  }
  return s;
}

describe("the sprint report", () => {
  it("gives points a denominator, which is what estimate never had", () => {
    const p = store();
    const s = sprint(p, [
      { title: "done five", points: 5, status: "done" },
      { title: "open three", points: 3 },
      { title: "open eight", points: 8 },
    ]);
    assert.match(sprintReport(s.id, p), /5\/16 points done across 3 card\(s\)/);
  });

  it("counts unsized cards apart rather than as zero", () => {
    const p = store();
    const s = sprint(p, [
      { title: "sized", points: 5, status: "done" },
      { title: "nobody sized this" },
    ]);
    const out = sprintReport(s.id, p);

    // "5 of 5 done" would report this sprint as finished while a card nobody sized is still open.
    assert.match(out, /5\/5 points done across 2 card\(s\), 1 unsized/);
    assert.match(out, /carry no estimate, so they are outside the point total/);
    assert.match(out, /nobody sized this/);
  });

  it("groups by status, so what is left is legible without a second command", () => {
    const p = store();
    const s = sprint(p, [
      { title: "in flight", points: 1, status: "in_progress" },
      { title: "stuck", points: 1, status: "blocked" },
      { title: "finished", points: 1, status: "done" },
    ]);
    const out = sprintReport(s.id, p);
    // Headings read the same here as on the board — one COLUMNS/LABEL pair feeds both.
    for (const heading of ["## in progress (1)", "## blocked (1)", "## done (1)"]) {
      assert.ok(out.includes(heading), `missing ${heading}\n${out}`);
    }
  });

  it("says so when nothing is committed, rather than reporting 0/0", () => {
    const p = store();
    const s = create("sprint", { title: "empty", status: "open" }, "", p);
    assert.match(sprintReport(s.id, p), /Nothing committed yet/);
  });

  it("only counts the cards committed to THIS sprint", () => {
    const p = store();
    const s = sprint(p, [{ title: "mine", points: 5, status: "done" }]);
    create("task", { title: "not in any sprint", estimate: 100 }, "", p);
    assert.match(sprintReport(s.id, p), /5\/5 points done across 1 card/);
  });

  it("refuses an id that is not there", () => {
    assert.throws(() => sprintReport("SP-404", store()), /not found/);
  });
});
