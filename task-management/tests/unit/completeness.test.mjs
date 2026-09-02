/** missingFields — one { field, hint } per gap, the hint naming the fix verb. */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { missingFields } from "../../lib/completeness.mjs";

const ALL = ["body", "acceptance", "evidence", "actor"];
const complete = {
  id: "TM-001",
  body: "what and why",
  acceptance: [{ text: "verifiable", done: false }],
  evidence: ["evidence/out.txt"],
  assignee: "ryan",
};
const fields = (list) => list.map((m) => m.field);

describe("missingFields", () => {
  it("returns [] for a task carrying everything", () => {
    assert.deepEqual(missingFields(complete, ALL), []);
  });

  it("flags a missing or whitespace-only body", () => {
    for (const body of [undefined, "", "  \n  "]) {
      assert.deepEqual(missingFields({ ...complete, body }, ["body"]), [
        { field: "body", hint: "tm edit TM-001 --body" },
      ]);
    }
  });

  it("flags zero acceptance criteria — existence, not tickedness", () => {
    assert.equal(fields(missingFields({ ...complete, acceptance: [] }, ALL))[0], "acceptance");
    assert.equal(fields(missingFields({ ...complete, acceptance: undefined }, ALL))[0], "acceptance");
    // An unticked criterion still EXISTS. Ticking is the done gate's older
    // requireAcceptance check; this one only closes the zero-AC hole.
    assert.deepEqual(missingFields(complete, ["acceptance"]), []);
  });

  it("flags missing evidence", () => {
    assert.deepEqual(missingFields({ ...complete, evidence: [] }, ["evidence"]), [
      { field: "evidence", hint: "tm evidence TM-001 <path|->" },
    ]);
    assert.deepEqual(missingFields({ ...complete, evidence: undefined }, ["evidence"]), [
      { field: "evidence", hint: "tm evidence TM-001 <path|->" },
    ]);
  });

  it("flags a missing actor, satisfied by actor or assignee", () => {
    assert.deepEqual(missingFields({ ...complete, assignee: undefined }, ["actor"]), [
      { field: "actor", hint: "tm assign TM-001 <who>" },
    ]);
    assert.deepEqual(missingFields({ ...complete, assignee: undefined, actor: "claude" }, ["actor"]), []);
    assert.deepEqual(missingFields({ ...complete, actor: null }, ["actor"]), [], "null falls through to assignee");
    assert.equal(fields(missingFields({ ...complete, actor: "  " }, ["actor"]))[0], "actor", "blank is no attribution");
  });

  it("names the exact fix command per field", () => {
    const hints = Object.fromEntries(missingFields({ id: "TM-007" }, ALL).map((m) => [m.field, m.hint]));
    assert.deepEqual(hints, {
      body: "tm edit TM-007 --body",
      acceptance: 'tm ac TM-007 "…"',
      evidence: "tm evidence TM-007 <path|->",
      actor: "tm assign TM-007 <who>",
    });
  });

  it("falls back to <id> for a create draft that has no id yet", () => {
    assert.equal(missingFields({ body: "" }, ["body"])[0].hint, "tm edit <id> --body");
  });

  it("checks only the fields asked for, in the order asked", () => {
    assert.deepEqual(fields(missingFields({}, ["actor", "body"])), ["actor", "body"]);
    assert.deepEqual(missingFields({}, []), []);
    assert.deepEqual(missingFields({}, undefined), []);
  });

  it("ignores unknown field names rather than throwing", () => {
    // A typo'd config key is doctor's finding, not a reason to crash a hook.
    assert.deepEqual(missingFields({}, ["boddy", "evidance"]), []);
  });

  it("treats a null task as missing everything", () => {
    assert.deepEqual(fields(missingFields(null, ALL)), ALL);
  });
});
