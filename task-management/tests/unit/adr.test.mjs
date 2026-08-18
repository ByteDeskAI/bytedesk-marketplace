/**
 * TM-016 — an ADR is drafted only for questions that actually decided something,
 * and asking the same thing twice revises one ADR instead of breeding twins.
 */
import { after, describe, it } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { ensureDirs, paths } from "../../lib/paths.mjs";
import { create, list, read, readEvents, writeState } from "../../lib/store.mjs";
import { decisionEventName, decisionKey, renderDecision, shouldCapture, upsertDecision } from "../../lib/adr.mjs";

const TM = fileURLToPath(new URL("../../bin/tm", import.meta.url));

const created = [];
after(() => {
  for (const d of created) rmSync(d, { recursive: true, force: true });
});

/** A store of its own per test — upsert writes files and we assert on the count. */
function store() {
  const dir = mkdtempSync(join(tmpdir(), "tm-adr-"));
  created.push(dir);
  const p = paths(dir);
  ensureDirs(p);
  return p;
}

/** The real PostToolUse payload shape, trimmed to what capture reads. */
function hook(questions, answers) {
  return {
    tool_name: "AskUserQuestion",
    tool_input: { questions },
    ...(answers === undefined ? {} : { tool_response: { answers } }),
  };
}

const STORAGE = hook(
  [
    {
      question: "How should tasks be stored?",
      header: "Storage",
      multiSelect: false,
      options: [
        { label: "Markdown + JSONL index", description: "Human-readable, diffable, git-native." },
        { label: "SQLite", description: "Transactional, but opaque in a code review." },
      ],
    },
  ],
  { "How should tasks be stored?": "Markdown + JSONL index" },
);

const CLARIFICATION = hook(
  [
    {
      question: "Which file did you mean?",
      header: "File",
      options: [{ label: "lib/store.mjs", description: "The one you just edited." }],
    },
  ],
  { "Which file did you mean?": "lib/store.mjs" },
);

const YES_NO = hook(
  [
    {
      question: "Run the tests now?",
      header: "Tests",
      options: [{ label: "Yes", description: "" }, { label: "No", description: "" }],
    },
  ],
  { "Run the tests now?": "Yes" },
);

describe("shouldCapture", () => {
  it("captures a question that offered real alternatives", () => {
    const got = shouldCapture(STORAGE, {});
    assert.equal(got.capture, true);
    assert.match(got.reason, /Storage|How should tasks be stored/);
  });

  it("skips a single-option clarification, and says why", () => {
    const got = shouldCapture(CLARIFICATION, {});
    assert.equal(got.capture, false);
    assert.match(got.reason, /option/i, `reason must name the cause, got: ${got.reason}`);
  });

  it("skips a yes/no confirmation", () => {
    const got = shouldCapture(YES_NO, {});
    assert.equal(got.capture, false);
    assert.match(got.reason, /yes\/no|confirmation/i);
  });

  it("skips an answer that matches no option — the user typed their own", () => {
    const other = hook(STORAGE.tool_input.questions, { "How should tasks be stored?": "Postgres, actually" });
    const got = shouldCapture(other, {});
    assert.equal(got.capture, false);
    assert.match(got.reason, /free.?text|other/i);
  });

  it("skips when the tool response never arrived", () => {
    const got = shouldCapture(hook(STORAGE.tool_input.questions), {});
    assert.equal(got.capture, false);
    assert.match(got.reason, /answer/i);
  });

  it("captures a multiSelect answer with several picks", () => {
    const multi = hook(
      [
        {
          question: "Which surfaces ship first?",
          header: "Surfaces",
          multiSelect: true,
          options: [
            { label: "CLI", description: "The tm binary." },
            { label: "Dashboard", description: "The web board." },
            { label: "Hooks", description: "Enforcement." },
          ],
        },
      ],
      { "Which surfaces ship first?": ["CLI", "Dashboard"] },
    );
    assert.equal(shouldCapture(multi, {}).capture, true);
  });

  it("captureDecisions:true overrides the smart rules", () => {
    const got = shouldCapture(CLARIFICATION, { captureDecisions: true });
    assert.equal(got.capture, true);
    assert.match(got.reason, /captureDecisions/);
  });

  it("captureDecisions:false never captures", () => {
    const got = shouldCapture(STORAGE, { captureDecisions: false });
    assert.equal(got.capture, false);
    assert.match(got.reason, /captureDecisions/);
  });

  it("treats 'smart' as the same rules as the default", () => {
    assert.deepEqual(shouldCapture(STORAGE, { captureDecisions: "smart" }), shouldCapture(STORAGE, {}));
    assert.equal(shouldCapture(CLARIFICATION, { captureDecisions: "smart" }).capture, false);
  });
});

describe("decisionKey", () => {
  it("is stable for the same question set", () => {
    assert.equal(decisionKey(STORAGE), decisionKey(STORAGE));
  });

  it("ignores the answer — the same question decided differently is the same decision", () => {
    const flipped = hook(STORAGE.tool_input.questions, { "How should tasks be stored?": "SQLite" });
    assert.equal(decisionKey(flipped), decisionKey(STORAGE));
  });

  it("differs for a different question set", () => {
    assert.notEqual(decisionKey(YES_NO), decisionKey(STORAGE));
  });

  it("is short enough to sit in frontmatter", () => {
    assert.ok(decisionKey(STORAGE).length <= 16, decisionKey(STORAGE));
  });
});

describe("renderDecision", () => {
  const { title, body } = renderDecision(STORAGE);

  it("titles the decision, not the topic", () => {
    assert.match(title, /Markdown \+ JSONL index/, `title must name what was chosen, got: ${title}`);
    assert.notEqual(title, "Storage decision");
  });

  it("has the three ADR sections", () => {
    for (const section of ["## Context", "## Decision", "## Consequences"]) {
      assert.ok(body.includes(section), `missing ${section}`);
    }
  });

  it("records the rejected options with their descriptions", () => {
    assert.ok(body.includes("SQLite"), "the rejected option must survive");
    assert.ok(body.includes("Transactional, but opaque in a code review."), "so must why it was rejected");
  });

  it("puts the rejected options inside the Decision section", () => {
    const decision = body.slice(body.indexOf("## Decision"), body.indexOf("## Consequences"));
    assert.ok(decision.includes("SQLite"), "alternatives belong to the decision, not a footnote");
  });
});

describe("upsertDecision", () => {
  it("creates one ADR carrying the decision key", () => {
    const p = store();
    const res = upsertDecision(STORAGE, { p, config: {} });
    assert.equal(res.action, "created");
    const doc = read(res.id, p);
    assert.equal(doc.decisionKey, decisionKey(STORAGE));
    assert.equal(doc.status, "proposed");
  });

  it("updates the existing ADR when the same question is asked again", () => {
    const p = store();
    const first = upsertDecision(STORAGE, { p, config: {} });
    const again = hook(STORAGE.tool_input.questions, { "How should tasks be stored?": "SQLite" });
    const second = upsertDecision(again, { p, config: {} });

    assert.equal(second.action, "updated");
    assert.equal(second.id, first.id);
    assert.equal(list("adr", {}, p).length, 1, "re-asking must revise one ADR, not write a twin");

    const doc = read(first.id, p);
    assert.ok(doc.body.includes("SQLite"), "the new answer must be recorded");
    assert.match(doc.body, /Revision.*\d{4}-\d{2}-\d{2}/s, "a revision needs a timestamp");
    assert.ok(doc.body.includes("Markdown + JSONL index"), "the original decision must not be overwritten");
  });

  it("writes nothing when the rules say skip, and reports why", () => {
    const p = store();
    const res = upsertDecision(CLARIFICATION, { p, config: {} });
    assert.equal(res.action, "skipped");
    assert.ok(res.reason);
    assert.equal(list("adr", {}, p).length, 0);
  });

  it("writes epic on create when one is passed", () => {
    const p = store();
    const epic = create("epic", { title: "wave" }, "", p);
    const res = upsertDecision(STORAGE, { p, config: {}, epic: epic.id });
    assert.equal(res.action, "created");
    assert.equal(read(res.id, p).epic, epic.id);
  });
});

describe("decisionEventName", () => {
  it("maps upsertDecision's action, not a nonexistent created flag", () => {
    assert.equal(decisionEventName({ action: "created", id: "ADR-0001" }), "decision_captured");
    assert.equal(decisionEventName({ action: "updated", id: "ADR-0001" }), "decision_updated");
    assert.equal(decisionEventName({ action: "skipped", reason: "no" }), null);
    assert.equal(decisionEventName({ created: true, id: "ADR-0001" }), null);
  });
});

describe("captureDecision hook (BDM-70)", () => {
  function hookPostDecision(p, payload) {
    return spawnSync(process.execPath, [TM, "hook", "post-decision"], {
      input: JSON.stringify(payload),
      env: { ...process.env, TM_ROOT: p.root, TM_NO_AUTOLINK: "1" },
      encoding: "utf8",
    });
  }

  it("logs decision_captured, inherits activeEpic, and revises as decision_updated", () => {
    const p = store();
    const epic = create("epic", { title: "wave" }, "", p);
    writeState({ activeEpic: epic.id }, p);

    const first = hookPostDecision(p, STORAGE);
    assert.equal(first.status, 0, first.stderr);

    const created = list("adr", {}, p);
    assert.equal(created.length, 1);
    assert.equal(created[0].epic, epic.id, "captureDecision must pass state.activeEpic");
    assert.ok(
      readEvents(p).some((e) => e.event === "decision_captured" && e.id === created[0].id),
      "first capture must log decision_captured, not decision_updated",
    );

    const flipped = hook(
      STORAGE.tool_input.questions,
      { "How should tasks be stored?": "SQLite" },
    );
    const second = hookPostDecision(p, flipped);
    assert.equal(second.status, 0, second.stderr);
    assert.equal(list("adr", {}, p).length, 1, "re-asking must still revise one ADR");
    assert.ok(
      readEvents(p).some((e) => e.event === "decision_updated" && e.id === created[0].id),
      "a revision must log decision_updated",
    );
  });
});
