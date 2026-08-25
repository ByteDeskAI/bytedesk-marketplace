/**
 * TM-028 — the Jira-shaped fields the dashboard needs to be a write surface:
 * assignee, labels, priority, estimate, comments, backlog rank, subtasks, links.
 *
 * These live in task frontmatter, which is already free-form, so this is an
 * extension rather than a migration: a v0.2 task with none of these fields set
 * must keep working untouched.
 */
import { after, describe, it } from "node:test";
import assert from "node:assert/strict";
import { cleanup, tempStore } from "./helpers.mjs";
import {
  addComment,
  addLink,
  assign,
  backlog,
  estimate,
  labels,
  prioritise,
  rank,
  removeLink,
  subtasks,
} from "../../lib/issue.mjs";
import { create, read, readEvents, update } from "../../lib/store.mjs";

const stores = [];
function store() {
  const p = tempStore();
  stores.push(p.root);
  return p;
}
after(() => cleanup(...stores));

const task = (p, title = "a task", fields = {}) => create("task", { title, ...fields }, "", p);

describe("assignee", () => {
  it("assigns and reassigns, logging both", () => {
    const p = store();
    const t = task(p);
    assign(t.id, "ryan", p);
    assert.equal(read(t.id, p).assignee, "ryan");
    assign(t.id, "@worktree", p);
    assert.equal(read(t.id, p).assignee, "@worktree");
    assert.equal(readEvents(p).filter((e) => e.event === "assign").length, 2);
  });

  it("unassigns with an empty value", () => {
    const p = store();
    const t = task(p);
    assign(t.id, "ryan", p);
    assign(t.id, null, p);
    assert.equal(read(t.id, p).assignee, undefined, "an unassigned task must not keep a ghost owner");
  });
});

describe("labels", () => {
  it("adds, dedupes and removes", () => {
    const p = store();
    const t = task(p);
    labels(t.id, { add: ["backend", "urgent", "backend"] }, p);
    assert.deepEqual(read(t.id, p).labels, ["backend", "urgent"]);
    labels(t.id, { remove: ["urgent"] }, p);
    assert.deepEqual(read(t.id, p).labels, ["backend"]);
  });

  it("exclusive triage roles replace each other", () => {
    const p = store();
    const t = task(p);
    labels(t.id, { add: ["needs-triage"] }, p);
    labels(t.id, { add: ["ready-for-agent"] }, p);
    assert.deepEqual(read(t.id, p).labels, ["ready-for-agent"]);
  });

  it("exclusive decision roles replace each other", () => {
    const p = store();
    const t = task(p);
    labels(t.id, { add: ["decision:interview"] }, p);
    labels(t.id, { add: ["decision:research"] }, p);
    assert.deepEqual(read(t.id, p).labels, ["decision:research"]);
  });

  it("refuses unknown decision:* unless force", () => {
    const p = store();
    const t = task(p);
    assert.throws(() => labels(t.id, { add: ["decision:grilling"] }, p), /unknown decision label/);
    labels(t.id, { add: ["decision:grilling"], force: true }, p);
    assert.deepEqual(read(t.id, p).labels, ["decision:grilling"]);
  });

  it("decision:map is epic-only", () => {
    const p = store();
    const t = task(p);
    assert.throws(() => labels(t.id, { add: ["decision:map"] }, p), /epics only/);
    const e = create("epic", { title: "a map" }, "", p);
    labels(e.id, { add: ["decision:map"] }, p);
    assert.deepEqual(read(e.id, p).labels, ["decision:map"]);
    assert.throws(() => labels(e.id, { add: ["decision:interview"] }, p), /not epics/);
  });
});

describe("priority and estimate", () => {
  it("accepts the Jira ladder and rejects nonsense", () => {
    const p = store();
    const t = task(p);
    prioritise(t.id, "highest", p);
    assert.equal(read(t.id, p).priority, "highest");
    assert.throws(() => prioritise(t.id, "urgentish", p), /priority/i);
  });

  it("stores estimates as points", () => {
    const p = store();
    const t = task(p);
    estimate(t.id, 5, p);
    assert.equal(read(t.id, p).estimate, 5);
    assert.throws(() => estimate(t.id, -2, p), /estimate/i);
  });
});

describe("comments", () => {
  it("appends with author and timestamp, oldest first", () => {
    const p = store();
    const t = task(p);
    addComment(t.id, "first thought", { author: "ryan", p });
    addComment(t.id, "second thought", { author: "@mcp", p });
    const comments = read(t.id, p).comments;
    assert.equal(comments.length, 2);
    assert.equal(comments[0].text, "first thought");
    assert.equal(comments[1].author, "@mcp");
    assert.ok(Date.parse(comments[1].ts) >= Date.parse(comments[0].ts));
  });

  it("refuses an empty comment", () => {
    const p = store();
    const t = task(p);
    assert.throws(() => addComment(t.id, "   ", { p }), /empty/i);
  });
});

describe("links", () => {
  it("records a typed link on both ends", () => {
    const p = store();
    const a = task(p, "the cause");
    const b = task(p, "the symptom");
    addLink(a.id, "causes", b.id, p);
    assert.deepEqual(read(a.id, p).links, [{ type: "causes", id: b.id }]);
    assert.deepEqual(
      read(b.id, p).links,
      [{ type: "caused by", id: a.id }],
      "a one-sided link is invisible from the other task, which is where you usually look",
    );
  });

  it("refuses to link a task to itself", () => {
    const p = store();
    const a = task(p);
    assert.throws(() => addLink(a.id, "relates to", a.id, p), /itself/i);
  });

  it("two-sided add then remove leaves both ends clean (BDM-74 / TM-008)", () => {
    const p = store();
    const a = task(p, "the cause");
    const b = task(p, "the symptom");
    addLink(a.id, "causes", b.id, p);

    removeLink(a.id, "causes", b.id, p);

    assert.deepEqual(read(a.id, p).links || [], [], "the from-end must drop the edge");
    assert.deepEqual(read(b.id, p).links || [], [], "the mirror must drop too — a leftover is the bug");
  });

  it("removing a foreign ref is one-sided", () => {
    const p = store();
    const a = task(p);
    addLink(a.id, "relates to", "other/repo#TM-007", p);
    assert.equal(read(a.id, p).links.length, 1);

    removeLink(a.id, "relates to", "other/repo#TM-007", p);

    assert.deepEqual(read(a.id, p).links || [], []);
  });

  it("is idempotent when the edge is already gone", () => {
    const p = store();
    const a = task(p, "a");
    const b = task(p, "b");
    removeLink(a.id, "blocks", b.id, p);
    assert.deepEqual(read(a.id, p).links || [], []);
    assert.deepEqual(read(b.id, p).links || [], []);
  });
});

describe("subtasks", () => {
  it("nests a task under a parent and lists children", () => {
    const p = store();
    const parent = task(p, "the epic-ish parent");
    const child = task(p, "a step");
    subtasks(child.id, { parent: parent.id }, p);
    assert.equal(read(child.id, p).parent, parent.id);
    assert.deepEqual(subtasks(parent.id, {}, p).map((t) => t.id), [child.id]);
  });

  it("refuses a cycle", () => {
    const p = store();
    const a = task(p, "a");
    const b = task(p, "b");
    subtasks(b.id, { parent: a.id }, p);
    assert.throws(() => subtasks(a.id, { parent: b.id }, p), /cycle/i);
  });
});

describe("backlog rank", () => {
  it("orders unranked tasks by id and ranked ones by rank", () => {
    const p = store();
    const a = task(p, "first created");
    const b = task(p, "second created");
    const c = task(p, "third created");
    rank(c.id, { before: a.id }, p);
    assert.deepEqual(
      backlog(p).map((t) => t.id),
      [c.id, a.id, b.id],
      "dragging a card to the top must survive a reload",
    );
  });

  it("leaves done work out of the backlog", () => {
    const p = store();
    const a = task(p, "shipped");
    const b = task(p, "waiting");
    update(a.id, { status: "done" }, p);
    assert.deepEqual(backlog(p).map((t) => t.id), [b.id]);
  });
});

describe("backwards compatibility", () => {
  it("leaves a task with none of these fields untouched", () => {
    const p = store();
    const t = task(p, "plain old task");
    const before = read(t.id, p);
    assert.equal(before.labels, undefined);
    assert.equal(before.assignee, undefined);
    assert.deepEqual(backlog(p).map((x) => x.id), [t.id], "unranked tasks still appear on the backlog");
  });
});
