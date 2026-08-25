/**
 * TM-040 — motion carries information or it does not exist.
 *
 * The two rules worth a test are the ones that are easy to regress into decoration: the liveness
 * pulse must follow real writes rather than a status, and an idle board must be still. Both are
 * pure functions on the event feed the board already holds, so they are testable without a DOM.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { LIVE_WINDOW_MS, lastWriteByEntity } from "../../dashboard/src/liveness.mjs";

const at = (msAgo, id, event = "update") => ({ ts: new Date(Date.now() - msAgo).toISOString(), id, event });
const live = (events, now = Date.now()) =>
  new Set([...lastWriteByEntity(events)].filter(([, t]) => now - t < LIVE_WINDOW_MS).map(([id]) => id));

describe("liveness follows writes, not status", () => {
  it("counts a task written to just now", () => {
    assert.deepEqual([...live([at(1_000, "TM-001")])], ["TM-001"]);
  });

  it("stops counting one whose session went quiet", () => {
    // The card is still in_progress and still claimed. Nothing about it should be moving.
    assert.deepEqual([...live([at(LIVE_WINDOW_MS + 5_000, "TM-001")])], []);
  });

  it("is empty on an idle board, so nothing loops forever", () => {
    const stale = [at(60_000, "TM-001"), at(3_600_000, "TM-002"), at(86_400_000, "TM-003")];
    assert.equal(live(stale).size, 0, "a board nobody is working on is still");
  });

  it("takes the newest write per entity, not the first seen", () => {
    const writes = lastWriteByEntity([at(90_000, "TM-001"), at(1_000, "TM-001")]);
    assert.ok(Date.now() - writes.get("TM-001") < 5_000, "an old event must not mask a recent one");
  });

  it("ignores events with no entity and unparseable timestamps", () => {
    const writes = lastWriteByEntity([{ ts: "not a date", id: "TM-001" }, { ts: new Date().toISOString() }]);
    assert.equal(writes.size, 0);
  });
});

describe("reduced motion", () => {
  const html = readFileSync(new URL("../../dashboard/index.html", import.meta.url), "utf8");

  it("has one switch that stops every animation and transition", () => {
    assert.match(html, /@media \(prefers-reduced-motion: reduce\)/);
    assert.match(html, /animation-iteration-count: 1 !important/, "an infinite animation must not survive the switch");
    assert.match(html, /transition-duration: 0\.01ms !important/);
  });

  it("keeps the keyframes it references defined in one place", () => {
    for (const name of ["tmPulse", "tmFlash", "tmBump"]) {
      assert.match(html, new RegExp(`@keyframes ${name}`), `${name} is referenced by a component`);
    }
  });
});
