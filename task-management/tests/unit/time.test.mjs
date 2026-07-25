/**
 * TM-012 — cycle time derived from the event log, with no new bookkeeping fields.
 * The event log already records every status change; anything else would be a
 * second source of truth to keep in sync.
 *
 * The claim under test is honesty: a task that was started, parked for three
 * hours and restarted took two hours of work, not five hours of wall clock.
 * Fixtures are written as raw events.jsonl so the arithmetic is exact.
 */
import { after, describe, it } from "node:test";
import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { cleanup, tempStore } from "./helpers.mjs";
import { cycleTime, summary, taskTimeline, throughput, timeInStatus } from "../../lib/time.mjs";

const stores = [];
const H = 3_600_000;
const at = (iso) => `2026-07-${iso}Z`;

/** events.jsonl rows, written by hand so every duration below is checkable by eye. */
const ROTATED = [
  { ts: at("01T00:00:00.000"), event: "create", id: "TM-001", kind: "task" },
  { ts: at("01T00:00:00.000"), event: "create", id: "TM-002", kind: "task" },
];
const CURRENT = [
  // TM-001: started, parked for 3h, restarted, done. 2h of work across 5h of clock.
  { ts: at("01T01:00:00.000"), event: "update", id: "TM-001", status: "in_progress" },
  { ts: at("01T02:00:00.000"), event: "update", id: "TM-001", status: "parked" },
  { ts: at("01T05:00:00.000"), event: "update", id: "TM-001", status: "in_progress" },
  { ts: at("01T06:00:00.000"), event: "update", id: "TM-001", status: "done" },
  { ts: at("01T06:00:00.000"), event: "done", id: "TM-001" },
  // TM-002: straight through, 4h.
  { ts: at("01T03:00:00.000"), event: "update", id: "TM-002", status: "in_progress" },
  { ts: at("01T07:00:00.000"), event: "update", id: "TM-002", status: "done" },
  // TM-003: closed two days later, 1h.
  { ts: at("02T00:00:00.000"), event: "create", id: "TM-003", kind: "task" },
  { ts: at("03T02:00:00.000"), event: "update", id: "TM-003", status: "done" },
  { ts: at("03T01:00:00.000"), event: "update", id: "TM-003", status: "in_progress" }, // out of order on purpose
  // TM-004: still in progress. TM-005: never started.
  { ts: at("01T00:00:00.000"), event: "create", id: "TM-004", kind: "task" },
  { ts: at("03T00:00:00.000"), event: "update", id: "TM-004", status: "in_progress" },
  { ts: at("02T00:00:00.000"), event: "create", id: "TM-005", kind: "task" },
];

const NOW = Date.parse(at("03T04:00:00.000"));

function store() {
  const p = tempStore();
  stores.push(p.root);
  writeFileSync(p.events.replace("events.jsonl", "events.1.jsonl"), ROTATED.map((e) => `${JSON.stringify(e)}\n`).join(""));
  writeFileSync(
    p.events,
    `${CURRENT.map((e) => JSON.stringify(e)).join("\n")}\n{ this line is not json\n\n{"ts":"nonsense","event":"update","id":"TM-001"}\n`,
  );
  return p;
}
after(() => cleanup(...stores));

describe("taskTimeline", () => {
  it("returns one task's events in time order, across a rotated log", () => {
    const t = taskTimeline("TM-001", store());
    assert.deepEqual(
      t.map((e) => e.event),
      ["create", "update", "update", "update", "update", "done"],
      "the create lives in events.1.jsonl and must still lead the timeline",
    );
    assert.equal(t[0].ts, at("01T00:00:00.000"));
  });

  it("sorts events that were appended out of order", () => {
    assert.deepEqual(
      taskTimeline("TM-003", store()).map((e) => e.status),
      [undefined, "in_progress", "done"],
    );
  });

  it("survives malformed and unparseable lines", () => {
    // The fixture ends with a truncated line, a blank line and a bad timestamp.
    assert.equal(taskTimeline("TM-002", store()).length, 3, "a broken line must not eat the log");
  });

  it("returns [] for an unknown id and for a store with no log", () => {
    assert.deepEqual(taskTimeline("TM-999", store()), []);
    assert.deepEqual(taskTimeline("TM-001", tempStore()), []);
  });
});

describe("cycleTime", () => {
  it("counts in-progress spans only — parked time is not work", () => {
    const c = cycleTime("TM-001", store());
    assert.equal(c.ms, 2 * H, "started, parked 3h, restarted, done = 2h of work");
    assert.equal(c.elapsedMs, 5 * H, "wall clock from first start to done is reported separately");
    assert.equal(c.human, "2h");
    assert.equal(c.startedAt, at("01T01:00:00.000"));
    assert.equal(c.doneAt, at("01T06:00:00.000"));
  });

  it("matches wall clock when nothing interrupted the task", () => {
    const c = cycleTime("TM-002", store());
    assert.equal(c.ms, 4 * H);
    assert.equal(c.ms, c.elapsedMs);
  });

  it("returns null while a task is still open", () => {
    assert.equal(cycleTime("TM-004", store()), null);
    assert.equal(cycleTime("TM-005", store()), null);
  });
});

describe("timeInStatus", () => {
  it("splits a task's life across the statuses it actually sat in", () => {
    const s = timeInStatus("TM-001", store(), NOW);
    assert.deepEqual(s, { open: 1 * H, in_progress: 2 * H, parked: 3 * H, done: 0 });
  });

  it("accrues the current status up to now for a task that is still open", () => {
    const s = timeInStatus("TM-004", store(), NOW);
    assert.deepEqual(s, { open: 48 * H, in_progress: 4 * H }, "an unfinished span runs to now, not to nowhere");
  });
});

describe("throughput", () => {
  it("counts tasks closed per calendar day", () => {
    const t = throughput(store(), { sinceIso: at("01T00:00:00.000") });
    assert.deepEqual(t.byDay, { "2026-07-01": 2, "2026-07-03": 1 });
    assert.equal(t.total, 3);
    assert.equal(t.perDay, 1, "3 closes across a 3-day window");
  });

  it("honours sinceIso", () => {
    const t = throughput(store(), { sinceIso: at("02T00:00:00.000") });
    assert.deepEqual(t.byDay, { "2026-07-03": 1 });
    assert.equal(t.total, 1);
  });

  it("reports zeros rather than NaN on an empty log", () => {
    assert.deepEqual(throughput(tempStore()), { byDay: {}, total: 0, perDay: 0 });
  });
});

describe("summary", () => {
  it("reports median and mean cycle time over closed tasks", () => {
    const s = summary(store(), NOW);
    assert.equal(s.completed, 3);
    assert.equal(s.medianMs, 2 * H, "median of 1h, 2h, 4h");
    assert.equal(s.meanMs, (7 * H) / 3);
    assert.equal(s.median, "2h");
  });

  it("reports WIP age and the oldest thing still open", () => {
    const s = summary(store(), NOW);
    assert.deepEqual(s.wip, [{ id: "TM-004", ms: 4 * H, human: "4h" }]);
    assert.equal(s.oldestOpen.id, "TM-004", "TM-004 was created a day before TM-005");
    assert.equal(s.oldestOpen.ms, 52 * H);
  });

  it("degrades to empty rather than dividing by zero", () => {
    const s = summary(tempStore(), NOW);
    assert.deepEqual(s, { completed: 0, medianMs: 0, meanMs: 0, median: "0m", mean: "0m", wip: [], oldestOpen: null });
  });
});
