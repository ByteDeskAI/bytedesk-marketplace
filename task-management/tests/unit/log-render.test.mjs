/**
 * `tm log`, for a person.
 *
 * Its human branch was `rows.map((e) => JSON.stringify(e))` — the same output as `--json`, so the
 * one surface you reach for when two agents disagreed about a claim, or a card moved and nobody
 * knows who moved it, was raw JSONL. Every other read verb has a renderer.
 *
 * The labels are NOT redefined for this: `CATALOG.events` already carries a sentence per event kind
 * and a test derives that list from the source, so a new event gets a description in both places or
 * neither.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { collapseLog, renderHistory, renderLog } from "../../lib/render.mjs";
import { CATALOG } from "../../lib/ntfy.mjs";

const at = (ts, event, extra = {}) => ({ ts, event, actor: "main", ...extra });

describe("renderLog — the tail", () => {
  it("says something for an empty log", () => {
    assert.equal(renderLog([]), "(no events)");
  });

  it("groups by day rather than repeating a date on every line", () => {
    const out = renderLog([
      at("2026-07-29T10:00:00Z", "create", { id: "TM-001", kind: "task", title: "a task" }),
      at("2026-07-29T11:00:00Z", "done", { id: "TM-001" }),
      at("2026-07-30T09:00:00Z", "claim", { id: "TM-002" }),
    ]);
    assert.equal(out.match(/2026-07-29/g).length, 1);
    assert.equal(out.match(/2026-07-30/g).length, 1);
    assert.match(out, /10:00/);
  });

  it("has a sentence for a soft delete, from the same catalog", () => {
    const out = renderLog([at("2026-07-29T10:00:00Z", "deleted", { id: "TM-001", from: "open", why: "duplicate" })]);
    assert.ok(out.includes(CATALOG.events.deleted.label.slice(0, 20)), out);
  });

  it("uses the catalog's own sentence for each kind", () => {
    const out = renderLog([at("2026-07-29T10:00:00Z", "claim_stolen", { id: "TM-001", from: "alice" })]);
    assert.match(out, new RegExp(CATALOG.events.claim_stolen.label.slice(0, 20)));
    assert.match(out, /alice/);
  });

  it("falls back to the raw kind for an event the catalog has not classified", () => {
    const out = renderLog([at("2026-07-29T10:00:00Z", "brand_new_event", { id: "TM-001" })]);
    assert.match(out, /brand_new_event/);
  });

  it("shows the payload but not the plumbing", () => {
    const out = renderLog([at("2026-07-29T10:00:00Z", "git_link", { id: "TM-001", ref: "abc1234", session: "s-123" })]);
    assert.match(out, /abc1234/);
    assert.ok(!out.includes("s-123"), "session is context, not payload");
  });

  it("does not fall over on an event with no id", () => {
    const out = renderLog([at("2026-07-29T10:00:00Z", "events_rotated", {})]);
    assert.match(out, /rotate/i);
  });
});

describe("collapseLog — two log lines per write becomes one", () => {
  // prioritise() calls update() (logging `update`) then logs `prioritise`. In a changelog that
  // doubles every row and buries the fact under its bookkeeping.
  it("drops an update shadowed by a specific event in the same second", () => {
    const rows = [
      at("2026-07-29T10:00:00Z", "update", { id: "TM-001", patch: "priority", status: "open" }),
      at("2026-07-29T10:00:00Z", "prioritise", { id: "TM-001", priority: "high" }),
    ];
    const out = collapseLog(rows);
    // The status row survives because it is the first status seen; the shadowed one does not recur.
    assert.equal(out.filter((e) => e.event === "update").length, 0);
    assert.equal(out.filter((e) => e.event === "prioritise").length, 1);
  });

  it("keeps an update that stands alone, because then it IS the fact", () => {
    const rows = [at("2026-07-29T10:00:00Z", "update", { id: "TM-001", patch: "body", status: "open" })];
    const out = collapseLog(rows);
    assert.equal(out.length, 1);
  });

  it("promotes a status change to its own row", () => {
    const rows = [
      at("2026-07-29T10:00:00Z", "update", { id: "TM-001", patch: "status", status: "open" }),
      at("2026-07-29T11:00:00Z", "update", { id: "TM-001", patch: "status", status: "in_progress" }),
      at("2026-07-29T12:00:00Z", "update", { id: "TM-001", patch: "status", status: "done" }),
    ];
    const out = collapseLog(rows);
    assert.deepEqual(out.map((e) => e._status), ["open", "in_progress", "done"]);
  });

  it("does not repeat a status that did not change", () => {
    const rows = [
      at("2026-07-29T10:00:00Z", "update", { id: "TM-001", patch: "status", status: "open" }),
      at("2026-07-29T10:05:00Z", "update", { id: "TM-001", patch: "labels", status: "open" }),
      at("2026-07-29T10:05:00Z", "labels", { id: "TM-001", labels: "ui" }),
    ];
    const out = collapseLog(rows);
    assert.equal(out.filter((e) => e.event === "status").length, 1);
  });

  it("does not let one entity's event shadow another's update", () => {
    const rows = [
      at("2026-07-29T10:00:00Z", "update", { id: "TM-001", patch: "body", status: "open" }),
      at("2026-07-29T10:00:00Z", "claim", { id: "TM-002" }),
    ];
    // Same second, different task — the update is TM-001's own fact and must survive.
    assert.ok(collapseLog(rows).some((e) => e.id === "TM-001"));
  });
});

describe("renderHistory — the per-issue changelog", () => {
  const life = [
    at("2026-07-29T10:00:00Z", "create", { id: "TM-001", kind: "task", title: "a task" }),
    at("2026-07-29T10:00:00Z", "update", { id: "TM-001", patch: "status", status: "open" }),
    at("2026-07-29T10:30:00Z", "update", { id: "TM-001", patch: "status", status: "in_progress" }),
    at("2026-07-29T14:45:00Z", "update", { id: "TM-001", patch: "status", status: "done" }),
    at("2026-07-29T14:45:00Z", "done", { id: "TM-001" }),
  ];

  it("says so when nothing has happened", () => {
    assert.match(renderHistory("TM-404", []), /no events/);
  });

  it("shows the status path the task took", () => {
    const out = renderHistory("TM-001", life);
    assert.match(out, /→ open/);
    assert.match(out, /→ in_progress/);
    assert.match(out, /→ done/);
  });

  it("measures elapsed time from the first start, not from the previous row", () => {
    // A changelog answers "how long did this take". A delta per row makes the reader add a column.
    const out = renderHistory("TM-001", life);
    assert.match(out, /\(\+4h 15m\)/);
    assert.ok(!out.includes("(+30m)"), "the start row itself carries no delta");
  });

  it("uses coarse units", () => {
    const long = [
      at("2026-07-01T10:00:00Z", "update", { id: "TM-001", patch: "status", status: "in_progress" }),
      at("2026-07-04T12:00:00Z", "done", { id: "TM-001" }),
    ];
    assert.match(renderHistory("TM-001", long), /\(\+3d 2h\)/);
  });

  it("shows no delta at all for a task never started", () => {
    const out = renderHistory("TM-001", [at("2026-07-29T10:00:00Z", "create", { id: "TM-001", kind: "task" })]);
    assert.ok(!out.includes("(+"));
  });
});
