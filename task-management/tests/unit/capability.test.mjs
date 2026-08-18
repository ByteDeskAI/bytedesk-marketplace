/**
 * Capabilities — discovery layer above tasks.
 *
 * BDM-73: acceptanceOf must write `{ done: false }`, the flag `gateDone` / `tm done`
 * / `setCriterion` read. `{ met: false }` made minted criteria invisible to the gate.
 */
import { after, describe, it } from "node:test";
import assert from "node:assert/strict";
import { cleanup, tempStore } from "./helpers.mjs";
import { accept, acceptanceOf, drop, propose, ranked, score, ship } from "../../lib/capability.mjs";
import { gateDone } from "../../lib/enforce.mjs";
import { read, setCriterion, writeConfig } from "../../lib/store.mjs";

const stores = [];
function store() {
  const p = tempStore();
  stores.push(p.root);
  writeConfig({ requireEpic: false, requireAcceptance: true, wipLimit: 99 }, p);
  return p;
}
after(() => cleanup(...stores));

describe("acceptanceOf (BDM-73)", () => {
  it("writes done, not met", () => {
    const p = store();
    const cap = propose(
      { title: "Cheap big win", criteria: ["the palette lists help items", "no network call"] },
      p,
    );
    const ac = acceptanceOf(cap);
    assert.deepEqual(
      ac,
      [
        { text: "the palette lists help items", done: false },
        { text: "no network call", done: false },
      ],
    );
    assert.equal(ac.every((a) => !Object.hasOwn(a, "met")), true, "the old met flag must not come back");
  });

  it("accept mints a task whose criteria gateDone can see", () => {
    const p = store();
    const cap = propose(
      { title: "Cheap big win", criteria: ["the palette lists help items", "no network call"] },
      p,
    );

    const { task } = accept(cap.id, p);
    assert.equal(task.id, "TM-001");
    assert.equal(task.capability, cap.id);
    assert.equal(task.acceptance.every((a) => a.done === false), true);
    assert.equal("epic" in read(cap.id, p), false, "epic is not a field on the capability");

    assert.equal(gateDone(task.id, p).allow, false);
    assert.match(gateDone(task.id, p).reason, /unmet acceptance criteria/);

    setCriterion(task.id, 1, true, p);
    assert.equal(gateDone(task.id, p).allow, false, "one of two still open");
    setCriterion(task.id, 2, true, p);
    assert.equal(gateDone(task.id, p).allow, true);
  });
});

describe("score and rank", () => {
  it("ranks impact × ease × confidence, 1–27", () => {
    const p = store();
    const cheap = propose({ title: "cheap", impact: "H", effort: "S", confidence: "H" }, p);
    const speculative = propose({ title: "rewrite", impact: "H", effort: "L", confidence: "L" }, p);
    assert.equal(score(cheap), 27);
    assert.equal(score(speculative), 3);
    assert.deepEqual(ranked(p).map((c) => c.id), [cheap.id, speculative.id]);
  });
});

describe("ship and drop", () => {
  it("refuses to ship without evidence", () => {
    const p = store();
    const cap = propose({ title: "cheap" }, p);
    assert.throws(() => ship(cap.id, {}, p), /no evidence/);
    assert.equal(read(cap.id, p).status, "open");
  });

  it("drop keeps the reason", () => {
    const p = store();
    const cap = propose({ title: "rewrite" }, p);
    drop(cap.id, "no evidence anyone wants this", p);
    assert.equal(read(cap.id, p).status, "deleted");
    assert.equal(read(cap.id, p).droppedReason, "no evidence anyone wants this");
  });
});
