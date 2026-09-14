/**
 * TM-179 — the pool and readiness become visible.
 *
 * Two surfaces, one question each. `tm why` answers "would an agent take this, and if not what is
 * missing?", which until now could only be inferred from a label that the pool re-checks anyway.
 * `GET /api/pool` answers "what is the pool doing?" with the same object the CLI prints, so the
 * board and the terminal cannot drift apart — the assertion below is deep equality against
 * `poolStatus`, not a hand-listed set of fields that would pass while the two diverged.
 */
import { after, describe, it } from "node:test";
import assert from "node:assert/strict";
import { cleanup, tempStore } from "./helpers.mjs";
import { renderWhy, why } from "../../lib/graph.mjs";
import { boardPayload, handleWrite } from "../../lib/dashboard-api.mjs";
import { poolStatus } from "../../lib/dispatch/pool.mjs";
import { create, update, writeConfig } from "../../lib/store.mjs";

const stores = [];
function store(config = {}) {
  const p = tempStore();
  stores.push(p.root);
  writeConfig({ requireEpic: false, wipLimit: 99, ...config }, p);
  return p;
}
after(() => cleanup(...stores));

const complete = (p, fields = {}) =>
  create("task", { title: "a complete task", acceptance: [{ text: "done means", done: false }], ...fields }, "context\n", p);

describe("tm why answers the readiness question", () => {
  it("says a complete task is ready, without becoming a reason it cannot be started", () => {
    const p = store();
    const t = complete(p);
    const w = why(t.id, p);
    assert.ok(w.readiness, "why() carries a readiness verdict");
    assert.equal(w.readiness.ready, true);
    assert.match(w.readiness.text, /ready for an agent/);
    assert.equal(w.startable, true);
    // `reasons` keeps its meaning: what is holding this up, and nothing is.
    assert.deepEqual(w.reasons, []);
    const text = renderWhy(w);
    assert.match(text, /nothing is holding this up/);
    assert.match(text, /→ ready for an agent/);
  });

  it("names what is missing when an agent could not take it", () => {
    const p = store();
    const t = create("task", { title: "no criteria" }, "context\n", p);
    const w = why(t.id, p);
    assert.equal(w.readiness.ready, false);
    assert.deepEqual(w.readiness.missing, ["acceptance criteria"]);
    assert.match(w.readiness.text, /not ready for an agent: acceptance criteria/);
    // Still a person's to start: the pool skipping it is not a blocker.
    assert.equal(w.startable, true);
    assert.match(renderWhy(w), /→ not ready for an agent/);
  });

  it("reports a person's veto as a person's, not as a gap", () => {
    const p = store();
    const t = complete(p);
    update(t.id, { labels: ["ready-for-human"], triagedBy: "human" }, p);
    const r = why(t.id, p).readiness;
    assert.equal(r.ready, false);
    assert.equal(r.human, true);
    assert.match(r.text, /triaged by a person/);
    assert.match(r.text, /an agent would need: label ready-for-human/);
  });

  it("says nothing about readiness once the task is resolved", () => {
    const p = store();
    const t = complete(p);
    update(t.id, { status: "done" }, p);
    assert.equal(why(t.id, p).readiness, null);
  });
});

describe("GET /api/pool", () => {
  const get = (p, path) => handleWrite("GET", path, {}, { p });

  it("returns exactly what tm pool status prints", () => {
    const p = store();
    complete(p);
    const res = get(p, "/api/pool");
    assert.equal(res.status, 200);
    // Deep equality: a route that grew its own copy of the shape would pass a field-by-field check
    // and fail this one.
    assert.deepEqual(res.body, poolStatus(p));
  });

  it("reports the off switch and the queue without starting anything", () => {
    const p = store();
    complete(p);
    writeConfig({ dispatch: { enabled: false } }, p);
    const body = get(p, "/api/pool").body;
    assert.equal(body.enabled, false);
    assert.equal(body.running, false);
    assert.equal(body.pid, null);
    assert.equal(body.poolable, 1, "the ready task is counted even while the pool is off");
    assert.equal(body.paused, false);
    assert.equal(typeof body.idleExitMinutes, "number");
    assert.match(body.log, /pool\.log$/);
  });
});

/**
 * TM-188 — the same verdict, per card, without a round trip per card.
 *
 * The trap this guards is specific: `boardPayload` strips `body` from every row, and `body` is a
 * `requireOnStart` field. A readiness computed from the stripped row returns `not ready: body` for
 * every task on the board — a perfectly-shaped answer that is wrong everywhere, and that a test
 * asserting only "the field exists" would pass.
 */
describe("the board payload carries each card's readiness", () => {
  const card = (p, id) => boardPayload(p).tasks.find((t) => t.id === id);

  it("says ready for a complete task — the body it strips is still weighed", () => {
    const p = store();
    const t = complete(p);
    assert.equal(card(p, t.id).readiness.ready, true);
    assert.deepEqual(card(p, t.id).readiness.missing, []);
  });

  it("names the gaps, and agrees with tm why field for field", () => {
    const p = store();
    const t = create("task", { title: "no criteria" }, "context\n", p);
    assert.deepEqual(card(p, t.id).readiness, why(t.id, p).readiness);
    assert.deepEqual(card(p, t.id).readiness.missing, ["acceptance criteria"]);
  });

  it("reports a person's veto as a person's here too", () => {
    const p = store();
    const t = complete(p);
    update(t.id, { labels: ["ready-for-human"], triagedBy: "human" }, p);
    const r = card(p, t.id).readiness;
    assert.equal(r.human, true);
    assert.equal(r.ready, false);
  });

  it("says nothing once the card is resolved", () => {
    const p = store();
    const t = complete(p);
    update(t.id, { status: "done" }, p);
    assert.equal(card(p, t.id).readiness, null);
  });
});
