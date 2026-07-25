/**
 * TM-021 — the numbers behind the board: how long a card has sat where it is,
 * how long it took end to end, and the shape of the epic's remaining work.
 * Pure functions, so the page can stay dumb.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { burndown, claim, cycleTime, elapsed, fmtDuration, startTimes } from "../../dashboard/metrics.mjs";

const iso = (ms) => new Date(ms).toISOString();
const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;
const NOW = Date.parse("2026-07-25T12:00:00Z");

describe("fmtDuration", () => {
  it("reads at a glance at every scale", () => {
    assert.equal(fmtDuration(0), "0m");
    assert.equal(fmtDuration(45 * 1000), "0m");
    assert.equal(fmtDuration(12 * MIN), "12m");
    assert.equal(fmtDuration(3 * HOUR + 12 * MIN), "3h 12m");
    assert.equal(fmtDuration(2 * DAY + 4 * HOUR), "2d 4h");
    assert.equal(fmtDuration(9 * DAY), "9d");
  });

  it("has nothing to say about nothing", () => {
    assert.equal(fmtDuration(null), "");
    assert.equal(fmtDuration(undefined), "");
    assert.equal(fmtDuration(-5), "");
  });
});

describe("elapsed", () => {
  it("measures time since the card last moved", () => {
    const t = { updated: iso(NOW - 3 * HOUR), created: iso(NOW - 5 * DAY) };
    assert.equal(elapsed(t, NOW), 3 * HOUR);
  });

  it("falls back to creation when the card has never been touched", () => {
    assert.equal(elapsed({ created: iso(NOW - 2 * HOUR) }, NOW), 2 * HOUR);
  });

  it("returns null when there are no timestamps at all", () => {
    assert.equal(elapsed({}, NOW), null);
  });
});

describe("startTimes", () => {
  it("takes the first move into in_progress, not the last", () => {
    const events = [
      { ts: iso(NOW - 5 * DAY), event: "create", id: "TM-001" },
      { ts: iso(NOW - 4 * DAY), event: "update", id: "TM-001", status: "in_progress" },
      { ts: iso(NOW - 3 * DAY), event: "update", id: "TM-001", status: "blocked" },
      { ts: iso(NOW - 2 * DAY), event: "update", id: "TM-001", status: "in_progress" },
    ];
    assert.equal(startTimes(events).get("TM-001"), NOW - 4 * DAY);
  });

  it("ignores events that never started anything", () => {
    assert.equal(startTimes([{ ts: iso(NOW), event: "create", id: "TM-002" }]).size, 0);
  });
});

describe("cycleTime", () => {
  const starts = new Map([["TM-001", NOW - 3 * DAY]]);

  it("measures start → done", () => {
    const t = { id: "TM-001", status: "done", closed: iso(NOW - DAY), created: iso(NOW - 9 * DAY) };
    assert.equal(cycleTime(t, starts), 2 * DAY);
  });

  it("falls back to creation when the start was never recorded", () => {
    const t = { id: "TM-009", status: "done", closed: iso(NOW), created: iso(NOW - 4 * DAY) };
    assert.equal(cycleTime(t, starts), 4 * DAY);
  });

  it("has no cycle time for work that is not finished", () => {
    assert.equal(cycleTime({ id: "TM-001", status: "in_progress", created: iso(NOW) }, starts), null);
  });

  it("never reports a negative cycle", () => {
    const t = { id: "TM-001", status: "done", closed: iso(NOW - 5 * DAY), created: iso(NOW - 9 * DAY) };
    assert.equal(cycleTime(t, starts), 0);
  });
});

describe("claim", () => {
  it("surfaces the branch and worktree holding an in-progress card", () => {
    const c = claim({
      status: "in_progress",
      session: "abcdef123456",
      branch: "feat/tm-021",
      worktree: "/home/x/projects/paperclip-wt",
    });
    assert.equal(c.branch, "feat/tm-021");
    assert.equal(c.worktree, "paperclip-wt", "the basename is what identifies a worktree at a glance");
    assert.equal(c.session, "abcdef", "a short session handle is enough to tell two agents apart");
  });

  it("reports nothing for unclaimed or finished work", () => {
    assert.equal(claim({ status: "open", branch: "main" }), null);
    assert.equal(claim({ status: "done", session: "abc" }), null);
    assert.equal(claim({ status: "in_progress" }), null);
  });
});

describe("burndown", () => {
  const tasks = [
    { id: "TM-001", status: "done", epic: "EP-001" },
    { id: "TM-002", status: "done", epic: "EP-001" },
    { id: "TM-003", status: "open", epic: "EP-001" },
    { id: "TM-004", status: "in_progress", epic: "EP-001" },
    { id: "TM-100", status: "done", epic: "EP-002" }, // another epic — must not count
  ];
  const events = [
    { ts: iso(NOW - 3 * DAY), event: "done", id: "TM-001" },
    { ts: iso(NOW - 1 * DAY), event: "done", id: "TM-002" },
    { ts: iso(NOW - 1 * DAY), event: "done", id: "TM-100" },
    { ts: iso(NOW - 2 * DAY), event: "create", id: "TM-004" },
  ];

  it("returns one point per day, oldest first", () => {
    const series = burndown(tasks, events, { days: 5, now: NOW, epic: "EP-001" });
    assert.equal(series.length, 5);
    assert.ok(series[0].day < series[4].day);
  });

  it("ends at today's real remaining count", () => {
    const series = burndown(tasks, events, { days: 5, now: NOW, epic: "EP-001" });
    assert.equal(series.at(-1).remaining, 2, "TM-003 and TM-004 are still open");
  });

  it("counts only the epic's throughput", () => {
    const series = burndown(tasks, events, { days: 5, now: NOW, epic: "EP-001" });
    assert.equal(
      series.reduce((n, d) => n + d.done, 0),
      2,
      "TM-100 belongs to another epic",
    );
  });

  it("walks remaining backwards through dones and creates", () => {
    const series = burndown(tasks, events, { days: 5, now: NOW, epic: "EP-001" });
    const byDay = Object.fromEntries(series.map((d) => [d.day, d]));
    const key = (offset) => new Date(NOW - offset * DAY).toISOString().slice(0, 10);
    // Before TM-002 closed yesterday there was one more card outstanding.
    assert.equal(byDay[key(2)].remaining, 3);
    // TM-004 did not exist before it was created, so the day before is one lighter.
    assert.equal(byDay[key(3)].remaining, 2);
  });

  it("counts a card's completion once, however many events say done", () => {
    // The store logs both `done` and an `update` with status done for one closure.
    const noisy = [
      { ts: iso(NOW - 1 * DAY), event: "update", id: "TM-001", status: "done" },
      { ts: iso(NOW - 1 * DAY), event: "done", id: "TM-001" },
      { ts: iso(NOW - 1 * DAY), event: "update", id: "TM-001", status: "done" },
    ];
    const series = burndown(tasks, noisy, { days: 5, now: NOW, epic: "EP-001" });
    assert.equal(
      series.reduce((n, d) => n + d.done, 0),
      1,
      "one closed card is one unit of throughput",
    );
    assert.equal(series.at(-1).remaining, 2);
  });

  it("survives an empty store", () => {
    const series = burndown([], [], { days: 3, now: NOW });
    assert.equal(series.length, 3);
    assert.ok(series.every((d) => d.remaining === 0 && d.done === 0));
  });
});
