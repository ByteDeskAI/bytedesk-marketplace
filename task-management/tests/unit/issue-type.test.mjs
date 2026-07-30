/**
 * Issue type, as a stored field rather than something an exporter invents.
 *
 * `toCsv` wrote `t.parent ? "Sub-task" : "Task"` into the Issue Type column — that is PARENTAGE,
 * not type. A bug that happened to be a subtask exported as `Sub-task` and its bug-ness was lost,
 * while the store already knew: the bug/spike/chore templates encoded it as `labels: ["bug"]`.
 * The answer was in the wrong field and the exporter did not look.
 */
import { after, describe, it } from "node:test";
import assert from "node:assert/strict";
import { cleanup, tempStore } from "./helpers.mjs";
import { create, read, readEvents, update } from "../../lib/store.mjs";
import { TYPES, setType, typeOf } from "../../lib/issue.mjs";
import { toCsv } from "../../lib/export.mjs";
import { applyTemplate, seedTemplates } from "../../lib/templates.mjs";

const stores = [];
function store() {
  const p = tempStore();
  stores.push(p.root);
  return p;
}
after(() => cleanup(...stores));

const task = (p, fields = {}) => create("task", { title: "a task", ...fields }, "", p).id;

describe("the vocabulary", () => {
  it("does not include subtask, because parent expresses that", () => {
    // Conflating the two is the bug being fixed; putting `subtask` in here would re-import it.
    assert.ok(!TYPES.includes("subtask"));
    assert.ok(!TYPES.includes("sub-task"));
  });

  it("refuses a value outside it — free text is what made exporters invent one", () => {
    const p = store();
    assert.throws(() => setType(task(p), "epic", p), /unknown type "epic"/);
    assert.throws(() => setType(task(p), "Feature", p), /use one of/);
  });

  it("is case-insensitive about a value that is in it", () => {
    const p = store();
    const id = task(p);
    assert.equal(setType(id, "BUG", p), "bug");
  });

  it("clears with an empty value", () => {
    const p = store();
    const id = task(p, { type: "bug" });
    assert.equal(setType(id, "", p), null);
    assert.equal(read(id, p).type, undefined);
  });

  it("logs an event", () => {
    const p = store();
    const id = task(p);
    setType(id, "spike", p);
    assert.equal(readEvents(p).filter((e) => e.event === "type")[0].type, "spike");
  });
});

describe("typeOf — how a task's type is decided", () => {
  it("takes the stored field when someone said so", () => {
    assert.equal(typeOf({ type: "story" }), "story");
  });

  it("falls back to a recognised label, so existing stores keep their meaning", () => {
    // The templates encoded type as a label before this field existed. Every task already in a
    // store has to keep reading correctly with no migration.
    assert.equal(typeOf({ labels: ["bug"] }), "bug");
    assert.equal(typeOf({ labels: ["ui", "spike", "urgent"] }), "spike");
  });

  it("prefers the field over a contradicting label", () => {
    assert.equal(typeOf({ type: "chore", labels: ["bug"] }), "chore");
  });

  it("ignores a label that is not a type", () => {
    assert.equal(typeOf({ labels: ["urgent", "ui"] }), "task");
  });

  it("defaults to task", () => {
    assert.equal(typeOf({}), "task");
    assert.equal(typeOf(null), "task");
  });

  it("never consults parent — where a task sits is not what it is", () => {
    assert.equal(typeOf({ parent: "TM-001" }), "task");
    assert.equal(typeOf({ parent: "TM-001", type: "bug" }), "bug");
  });

  it("ignores a stored value outside the vocabulary rather than reporting it", () => {
    assert.equal(typeOf({ type: "nonsense" }), "task");
  });
});

describe("the CSV column that was wrong", () => {
  const columnOf = (p, id, name) => {
    const rows = toCsv({}, p).split("\n");
    const header = rows[0].split(",");
    const row = rows.find((r) => r.startsWith(id)).split(",");
    return row[header.indexOf(name)];
  };

  it("reports a bug as a Bug", () => {
    const p = store();
    const id = task(p, { type: "bug" });
    assert.equal(columnOf(p, id, "Issue Type"), "Bug");
  });

  it("reports a bug that is also a subtask as Sub-task, and keeps parent", () => {
    // Jira's own vocabulary: Sub-task IS the structural type there, so a task with a parent still
    // reports it — but the fabrication is gone, because a top-level bug is no longer "Task".
    const p = store();
    const parent = task(p, {});
    const id = task(p, { type: "bug", parent });
    assert.equal(columnOf(p, id, "Issue Type"), "Sub-task");
    assert.equal(columnOf(p, id, "Parent"), parent);
  });

  it("still reports a plain task as Task", () => {
    const p = store();
    assert.equal(columnOf(p, task(p), "Issue Type"), "Task");
  });

  it("reports a template-created task correctly with no type field at all", () => {
    // The regression that matters for anyone with an existing store.
    const p = store();
    const id = task(p, { labels: ["bug"] });
    assert.equal(columnOf(p, id, "Issue Type"), "Bug");
  });
});

describe("the templates", () => {
  it("set the field now, and keep the label as a filter", () => {
    const p = store();
    seedTemplates(p);
    const applied = applyTemplate("bug", { title: "a defect" }, p);
    assert.equal(applied.fields.type, "bug");
    assert.deepEqual(applied.fields.labels, ["bug"]);
  });

  it("gives every shipped template a type in the vocabulary", () => {
    const p = store();
    seedTemplates(p);
    for (const name of ["bug", "spike", "chore"]) {
      const t = applyTemplate(name, { title: "x" }, p).fields.type;
      assert.ok(TYPES.includes(t), `${name} template has type ${t}`);
    }
  });
});
