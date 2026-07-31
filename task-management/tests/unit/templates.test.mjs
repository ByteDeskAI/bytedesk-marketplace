/**
 * TM-011 — task templates. Recurring work (a bug, a spike, a chore) should start
 * with the same shape every time instead of whatever the agent remembered today.
 * The contract that matters: seeding is idempotent and never clobbers a human's
 * edits, and a caller's own fields always beat the template's defaults.
 */
import { after, describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { cleanup, tempStore } from "./helpers.mjs";
import { applyTemplate, listTemplates, readTemplate, seedTemplates } from "../../lib/templates.mjs";

const stores = [];
function store() {
  const p = tempStore();
  stores.push(p.root);
  return p;
}
after(() => cleanup(...stores));

function writeTemplate(p, name, text) {
  mkdirSync(p.templates, { recursive: true });
  writeFileSync(join(p.templates, `${name}.md`), text);
}

describe("seedTemplates", () => {
  it("writes the three starters on a fresh store", () => {
    const p = store();
    const created = seedTemplates(p);
    assert.deepEqual(created.sort(), ["bug", "chore", "spike"], "all three starters must land");
    assert.deepEqual(listTemplates(p).map((t) => t.name).sort(), ["bug", "chore", "spike"]);
  });

  it("is idempotent — a second seed creates nothing", () => {
    const p = store();
    seedTemplates(p);
    assert.deepEqual(seedTemplates(p), [], "re-seeding must be a no-op");
  });

  it("never overwrites a template a human has edited", () => {
    const p = store();
    writeTemplate(p, "bug", '---\nacceptance: ["mine"]\n---\n\nmy own repro checklist\n');
    seedTemplates(p);
    const kept = readFileSync(join(p.templates, "bug.md"), "utf8");
    assert.match(kept, /my own repro checklist/, "a user-edited template must survive seeding");
  });
});

describe("the starters", () => {
  it("gives bug a regression-test acceptance criterion and repro sections", () => {
    const p = store();
    seedTemplates(p);
    const bug = readTemplate("bug", p);
    assert.deepEqual(
      bug.fields.acceptance,
      ["a regression test fails before the fix and passes after"],
      "the bug starter's acceptance is the whole point of it",
    );
    for (const heading of ["Repro", "Expected", "Actual"]) {
      assert.match(bug.body, new RegExp(`## ${heading}`), `bug body needs a ${heading} section`);
    }
  });

  it("gives spike a question, a timebox and an ending artifact", () => {
    const p = store();
    seedTemplates(p);
    const spike = readTemplate("spike", p);
    for (const heading of ["Question", "Timebox", "Ends when"]) {
      assert.match(spike.body, new RegExp(`## ${heading}`), `spike body needs a ${heading} section`);
    }
  });

  it("gives chore a scope and a blast radius", () => {
    const p = store();
    seedTemplates(p);
    const chore = readTemplate("chore", p);
    for (const heading of ["Scope", "Blast radius"]) {
      assert.match(chore.body, new RegExp(`## ${heading}`), `chore body needs a ${heading} section`);
    }
  });
});

describe("readTemplate", () => {
  it("returns null for a template that does not exist", () => {
    assert.equal(readTemplate("nope", store()), null);
  });

  it("refuses a path-unsafe name instead of reading outside the store", () => {
    const p = store();
    assert.throws(() => readTemplate("../../../etc/passwd", p), /unsafe template name/);
  });
});

describe("applyTemplate", () => {
  it("hands back fields and body ready for create()", () => {
    const p = store();
    seedTemplates(p);
    const { fields, body } = applyTemplate("bug", { title: "login 500s" }, p);
    assert.equal(fields.title, "login 500s");
    assert.deepEqual(
      fields.acceptance,
      [{ text: "a regression test fails before the fix and passes after", done: false }],
      "acceptance strings must arrive in the store's {text,done} shape",
    );
    assert.match(body, /## Repro/);
  });

  it("lets the caller's own value win over the template default", () => {
    const p = store();
    writeTemplate(p, "loud", '---\nlabels: ["from-template"]\n---\n\nbody\n');
    const { fields } = applyTemplate("loud", { labels: ["mine"] }, p);
    assert.deepEqual(fields.labels, ["mine"], "an explicit caller value must not be overwritten");
  });

  it("treats an empty caller array as absent so `tm task new` defaults do not erase the template", () => {
    const p = store();
    seedTemplates(p);
    // bin/tm seeds every new task with acceptance: [] — that must not beat the template.
    const { fields } = applyTemplate("bug", { title: "t", acceptance: [], commits: [] }, p);
    assert.equal(fields.acceptance.length, 1, "an empty default must not wipe the template's criteria");
    assert.deepEqual(fields.commits, [], "keys the template says nothing about pass through untouched");
  });

  it("does not leak template-only metadata into the task", () => {
    const p = store();
    writeTemplate(p, "meta", '---\ndescription: "what this is for"\nlabels: ["x"]\n---\n\nbody\n');
    const { fields } = applyTemplate("meta", { title: "t" }, p);
    assert.equal(fields.description, undefined, "`description` describes the template, not the task");
    assert.deepEqual(fields.labels, ["x"]);
  });

  it("throws on an unknown template rather than silently creating a bare task", () => {
    assert.throws(() => applyTemplate("ghost", { title: "t" }, store()), /no such template: ghost/);
  });
});

describe("listTemplates", () => {
  it("returns [] when the store has no templates dir at all", () => {
    assert.deepEqual(listTemplates(store()), []);
  });

  it("carries each template's description for `tm task new --template` help", () => {
    const p = store();
    writeTemplate(p, "zeta", '---\ndescription: "z work"\n---\n\nb\n');
    writeTemplate(p, "alpha", '---\ndescription: "a work"\n---\n\nb\n');
    assert.deepEqual(listTemplates(p), [
      { name: "alpha", description: "a work" },
      { name: "zeta", description: "z work" },
    ]);
  });
});
