import { after, describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  answerOf,
  attentionOf,
  decisionRole,
  hasAnswer,
  sectionsOf,
  setAnswer,
} from "../../lib/decision.mjs";
import { gateDone } from "../../lib/enforce.mjs";
import { boardPayload } from "../../lib/dashboard-api.mjs";
import { create, update } from "../../lib/store.mjs";
import { cleanup, tempStore } from "./helpers.mjs";
import { writeConfig } from "../../lib/store.mjs";

const stores = [];
after(() => cleanup(...stores));
function store() {
  const p = tempStore();
  stores.push(p.root);
  writeConfig({ requireEpic: false, requireAcceptance: true }, p);
  return p;
}

describe("decisionRole", () => {
  it("picks the exclusive decision kind and ignores other labels", () => {
    assert.equal(decisionRole(["ready-for-agent", "decision:interview"]), "decision:interview");
    assert.equal(decisionRole(["bug"]), null);
  });
});

describe("attentionOf", () => {
  it("marks research AFK and the rest HITL", () => {
    assert.equal(attentionOf("decision:research"), "AFK");
    assert.equal(attentionOf("decision:interview"), "HITL");
    assert.equal(attentionOf("decision:prototype"), "HITL");
    assert.equal(attentionOf(null), null);
  });
});

describe("answerOf", () => {
  it("is null when the heading is missing", () => {
    assert.equal(answerOf("## Question\n\nWhat?\n"), null);
    assert.equal(hasAnswer("## Question\n\nWhat?\n"), false);
  });

  it("is empty when the heading exists with no content", () => {
    assert.equal(answerOf("## Answer\n\n"), "");
    assert.equal(hasAnswer("## Answer\n\n"), false);
  });

  it("returns the text until the next heading", () => {
    const body = "## Question\n\nWhere?\n\n## Answer\n\nIn the store.\n\n## Notes\n\nlater\n";
    assert.equal(answerOf(body), "In the store.");
    assert.equal(hasAnswer(body), true);
  });

  it("setAnswer appends or replaces without eating Question", () => {
    const once = setAnswer("## Question\n\nWhere?\n", "In the store.");
    assert.match(once, /## Question/);
    assert.equal(answerOf(once), "In the store.");
    const twice = setAnswer(once, "Files, actually.");
    assert.equal(answerOf(twice), "Files, actually.");
    assert.equal(sectionsOf(twice).filter((s) => s.heading === "Question").length, 1);
  });
});

describe("gateDone on decision tickets", () => {
  it("refuses a decision ticket with no ## Answer even when AC is empty", () => {
    const p = store();
    const t = create(
      "task",
      { title: "where?", labels: ["decision:interview"], acceptance: [] },
      "## Question\n\nWhere?\n",
      p,
    );
    assert.equal(gateDone(t.id, p).allow, false);
    assert.match(gateDone(t.id, p).reason, /## Answer/);
  });

  it("allows once the answer is on the task", () => {
    const p = store();
    const t = create(
      "task",
      { title: "where?", labels: ["decision:interview"], acceptance: [] },
      "## Question\n\nWhere?\n\n## Answer\n\nIn the store.\n",
      p,
    );
    assert.equal(gateDone(t.id, p).allow, true);
  });

  it("prototype and research also need evidence", () => {
    const p = store();
    const proto = create(
      "task",
      { title: "look?", labels: ["decision:prototype"], acceptance: [] },
      "## Answer\n\nVariant B.\n",
      p,
    );
    assert.equal(gateDone(proto.id, p).allow, false);
    assert.match(gateDone(proto.id, p).reason, /evidence/);
    update(proto.id, { evidence: ["worktrees/TM-001"] }, p);
    assert.equal(gateDone(proto.id, p).allow, true);
  });

  it("board payload strips body but keeps hasAnswer", () => {
    const p = store();
    const blank = create(
      "task",
      { title: "q", labels: ["decision:interview"], acceptance: [] },
      "## Question\n\n?\n",
      p,
    );
    const answered = create(
      "task",
      { title: "a", labels: ["decision:interview"], acceptance: [] },
      "## Answer\n\nYes.\n",
      p,
    );
    const rows = Object.fromEntries(boardPayload(p).tasks.map((t) => [t.id, t]));
    assert.equal("body" in rows[blank.id], false);
    assert.equal(rows[blank.id].hasAnswer, false);
    assert.equal(rows[answered.id].hasAnswer, true);
  });
});
