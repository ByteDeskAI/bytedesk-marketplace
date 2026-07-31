/**
 * Why a task stopped, on the surface where you notice it stopped.
 *
 * `tm park <id> <why>` and `tm block <id> <why>` have always stored the sentence you typed. It was
 * read by `tm why <id>` (one task at a time), `tm export md`, and a PWA notification — and by
 * neither board. So "what is everything stuck on" was N commands, `tm show` on a blocked task
 * printed its status and not one word about what it was waiting for, and the card in the browser
 * gave no hint the reason existed at all.
 */
import { after, describe, it } from "node:test";
import assert from "node:assert/strict";
import { cleanup, tempStore } from "./helpers.mjs";
import { board, taskLine } from "../../lib/render.mjs";
import { create, update } from "../../lib/store.mjs";

const stores = [];
function store() {
  const p = tempStore();
  stores.push(p.root);
  return p;
}
after(() => cleanup(...stores));

const parked = (why) => ({ id: "TM-001", title: "vendor work", status: "parked", parkedReason: why });
const blocked = (why) => ({ id: "TM-002", title: "schema work", status: "blocked", blockedReason: why });

describe("taskLine", () => {
  it("shows why a parked task is parked", () => {
    assert.match(taskLine(parked("waiting on the vendor SDK license")), /— waiting on the vendor SDK license/);
  });

  it("shows why a blocked task is blocked", () => {
    assert.match(taskLine(blocked("needs a call with security")), /— needs a call with security/);
  });

  it("puts the reason right after the title, not at the end of the line", () => {
    // It is why this row is in the section you are reading, not one more attribute to scan past.
    const line = taskLine({ ...parked("the reason"), epic: "EP-001", labels: ["ui"] });
    assert.ok(line.indexOf("— the reason") < line.indexOf("EP-001"));
  });

  it("says nothing when there is no reason", () => {
    assert.equal(taskLine({ id: "TM-001", title: "t", status: "parked" }).includes("—"), false);
    assert.equal(taskLine({ id: "TM-001", title: "t", status: "blocked" }).includes("—"), false);
  });

  it("ignores a stale reason left on a task that is no longer stopped", () => {
    // `tm unblock` clears blockedReason, but `tm start` on a parked task does not clear
    // parkedReason — so an in-progress task can still carry the sentence that stopped it once,
    // and printing it would say a working task is waiting on something.
    const line = taskLine({ id: "TM-001", title: "t", status: "in_progress", parkedReason: "waiting on legal" });
    assert.equal(line.includes("waiting on legal"), false);
  });

  it("abridges a long reason visibly, rather than pushing the board off the screen", () => {
    const line = taskLine(parked("x".repeat(200)));
    assert.ok(line.length < 120, `a board row must stay scannable, got ${line.length} chars`);
    assert.match(line, /…/, "an abridged reason has to look abridged");
  });

  it("flattens a reason written across several lines", () => {
    // A hand-edited frontmatter string can hold newlines; one row must stay one row.
    assert.equal(taskLine(parked("waiting on\nlegal\n\nsince Tuesday")).includes("\n"), false);
    assert.match(taskLine(parked("waiting on\nlegal")), /waiting on legal/);
  });
});

describe("the board", () => {
  it("answers 'what is everything stuck on' in one command", () => {
    const p = store();
    const e = create("epic", { title: "Payments" }, "", p);
    const a = create("task", { title: "vendor work", epic: e.id }, "", p);
    const b = create("task", { title: "schema work", epic: e.id }, "", p);
    update(a.id, { status: "parked", parkedReason: "waiting on the vendor SDK license" }, p);
    update(b.id, { status: "blocked", blockedReason: "needs a call with security" }, p);

    const out = board(p);

    assert.match(out, /waiting on the vendor SDK license/);
    assert.match(out, /needs a call with security/);
  });
});
