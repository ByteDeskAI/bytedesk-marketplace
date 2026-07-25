/**
 * TM-013 epic auto-close · TM-017 event-log rotation · TM-018 incremental index.
 * All three are housekeeping the store should do for you: an epic that is finished
 * should say so, a log that grows forever eventually costs real time to read, and
 * rescanning every file on every write is O(store) for an O(1) change.
 */
import { after, describe, it } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { cleanup, tempStore } from "./helpers.mjs";
import {
  autoCloseEpic,
  create,
  logEvent,
  readEvents,
  reindex,
  rotateEvents,
  update,
  writeConfig,
} from "../../lib/store.mjs";

const stores = [];
function store() {
  const p = tempStore();
  stores.push(p.root);
  return p;
}
after(() => cleanup(...stores));

describe("autoCloseEpic", () => {
  it("closes an epic once its last child is done", () => {
    const p = store();
    const epic = create("epic", { title: "shipping" }, "", p);
    const a = create("task", { title: "one", epic: epic.id }, "", p);
    const b = create("task", { title: "two", epic: epic.id }, "", p);
    update(a.id, { status: "done" }, p);
    assert.equal(autoCloseEpic(epic.id, p), false, "an epic with open children stays open");

    update(b.id, { status: "done" }, p);
    assert.equal(autoCloseEpic(epic.id, p), true);
  });

  it("ignores deleted children when deciding", () => {
    const p = store();
    const epic = create("epic", { title: "with an abandoned child" }, "", p);
    const a = create("task", { title: "kept", epic: epic.id }, "", p);
    const b = create("task", { title: "abandoned", epic: epic.id }, "", p);
    update(a.id, { status: "done" }, p);
    update(b.id, { status: "deleted" }, p);
    assert.equal(autoCloseEpic(epic.id, p), true, "a deleted child must not keep an epic open forever");
  });

  it("never closes a childless epic — that is a new epic, not a finished one", () => {
    const p = store();
    const epic = create("epic", { title: "just created" }, "", p);
    assert.equal(autoCloseEpic(epic.id, p), false);
  });

  it("respects autoCloseEpics: false", () => {
    const p = store();
    writeConfig({ autoCloseEpics: false }, p);
    const epic = create("epic", { title: "manual" }, "", p);
    const a = create("task", { title: "one", epic: epic.id }, "", p);
    update(a.id, { status: "done" }, p);
    assert.equal(autoCloseEpic(epic.id, p), false);
  });
});

describe("event log rotation", () => {
  it("rotates once the log passes the configured size", () => {
    const p = store();
    writeConfig({ eventMaxBytes: 400 }, p);
    for (let i = 0; i < 40; i += 1) logEvent("noise", { id: `TM-${i}`, filler: "x".repeat(40) }, p);

    rotateEvents(p);

    assert.ok(existsSync(join(p.base, "events.1.jsonl")), "the old log is kept, not discarded");
    assert.ok(readFileSync(p.events, "utf8").length < 400);
  });

  it("still reads across a rotation boundary", () => {
    const p = store();
    writeConfig({ eventMaxBytes: 300 }, p);
    logEvent("first", { id: "TM-001" }, p);
    for (let i = 0; i < 30; i += 1) logEvent("noise", { id: `TM-${i}`, filler: "y".repeat(40) }, p);
    rotateEvents(p);
    logEvent("last", { id: "TM-002" }, p);

    const events = readEvents(p);
    const kinds = events.map((e) => e.event);
    assert.ok(kinds.includes("first"), "history must survive rotation — it is the audit trail");
    assert.ok(kinds.includes("last"));
    assert.ok(
      events.every((e, i) => i === 0 || Date.parse(events[i - 1].ts) <= Date.parse(e.ts)),
      "events must come back in chronological order across files",
    );
  });

  it("tolerates a corrupt line without losing the rest", () => {
    const p = store();
    logEvent("good", { id: "TM-001" }, p);
    writeFileSync(p.events, `${readFileSync(p.events, "utf8")}{ not json\n`);
    logEvent("also good", { id: "TM-002" }, p);
    assert.deepEqual(readEvents(p).map((e) => e.event), ["good", "also good"]);
  });
});

describe("incremental index", () => {
  it("patches a single entity without rescanning the store", () => {
    const p = store();
    const t = create("task", { title: "indexed" }, "", p);
    update(t.id, { status: "in_progress" }, p);

    const index = JSON.parse(readFileSync(p.index, "utf8"));
    const row = index.tasks.find((x) => x.id === t.id);
    assert.equal(row.status, "in_progress", "a write must leave the index current");
    assert.equal(row.body, undefined, "the index stays a summary, not a copy of the store");
  });

  it("drops an entity from the index when it is deleted", () => {
    const p = store();
    const t = create("task", { title: "temporary" }, "", p);
    update(t.id, { status: "deleted" }, p);
    const index = JSON.parse(readFileSync(p.index, "utf8"));
    assert.equal(index.tasks.find((x) => x.id === t.id), undefined);
  });

  it("rebuilds identically from the files it indexes", () => {
    const p = store();
    create("task", { title: "one" }, "", p);
    const epic = create("epic", { title: "two" }, "", p);
    update(epic.id, { status: "done" }, p);
    const incremental = JSON.parse(readFileSync(p.index, "utf8"));

    const full = reindex(p);

    assert.deepEqual(
      { epics: full.epics, tasks: full.tasks, adrs: full.adrs },
      { epics: incremental.epics, tasks: incremental.tasks, adrs: incremental.adrs },
      "incremental and full index must not drift — the cache has to be trustworthy",
    );
  });
});
