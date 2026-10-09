/**
 * TM-493 — task-management's finishChecksRefusal mirrors agent-orchestration's finish-check reader
 * (finishCheckEvidence → normalizeChecks in topology/lib/reviewer.mjs) without importing it, so the
 * plugins stay independent. This test runs one table of check shapes through both and pins each
 * side's verdict, so a change to either side alone turns it red — like the TM-441 mergeInOf test.
 *
 * Rows where the two disagree today are pinned as `{ tm, ao, why }`. They are recorded findings,
 * not endorsements: fixing one means changing both sides and the row together.
 *
 * agent-orchestration is loaded from its source file at test time only, and only when this
 * checkout carries it; task-management never imports it at runtime.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { finishChecksRefusal } from "../../lib/governance-check.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const AO_REVIEWER = join(HERE, "..", "..", "..", "agent-orchestration", "topology", "lib", "reviewer.mjs");
const R = "a".repeat(40);
const OTHER = "b".repeat(40);
const run = (extra = {}) => ({ name: "unit", command: "npm test", exit_code: 0, revision: R, ...extra });
const without = (key) => { const entry = run(); delete entry[key]; return entry; };

// [label, entry, verdict] — verdict is "accept" | "refuse" when both agree, else { tm, ao, why }.
// AO's third outcome, "ignore", is finishCheckEvidence dropping a non-object entry before
// normalizeChecks sees it: neither evidence nor a refusal.
const TABLE = [
  ["structured run", run(), "accept"],
  ["argv command", run({ command: ["npm", "test"] }), "accept"],
  ["failing exit_code (the reviewer judges failures)", run({ exit_code: 1 }), "accept"],
  ["with log_tail", run({ log_tail: "ok 1" }), "accept"],
  ["missing name", without("name"), "refuse"],
  ["blank name", run({ name: "  " }), "refuse"],
  ["non-string name", run({ name: 5 }), "refuse"],
  ["missing exit_code", without("exit_code"), "refuse"],
  ["string exit_code", run({ exit_code: "0" }), "refuse"],
  ["fractional exit_code", run({ exit_code: 0.5 }), "refuse"],
  ["short revision", run({ revision: "abc123" }), "refuse"],
  ["uppercase revision", run({ revision: "A".repeat(40) }), "refuse"],
  ["array entry", [], "refuse"],
  ["missing revision", without("revision"),
    { tm: "accept", ao: "refuse", why: "tm treats revision as optional; AO's finishCheckEvidence throws TOPOLOGY_REVIEWER_CHECKS, so an automatic review request fails after review-ready passed" }],
  ["revision of another commit", run({ revision: OTHER }),
    { tm: "refuse", ao: "accept", why: "layering: AO binds the run to the reviewed revision later, in unsatisfiedChecks; tm binds at the reader" }],
  ["missing command", without("command"),
    { tm: "refuse", ao: "accept", why: "AO coerces a missing command to ''; tm requires a non-empty command (TM-492 review)" }],
  ["argv of empty strings", run({ command: ["", ""] }),
    { tm: "refuse", ao: "accept", why: "AO joins any argv with String(); tm requires every item non-empty" }],
  ["argv of non-strings", run({ command: [1, null] }),
    { tm: "refuse", ao: "accept", why: "AO joins any argv with String(); tm requires strings" }],
  ["legacy prose string", "npm test passed",
    { tm: "accept", ao: "ignore", why: "tm keeps legacy strings readable; AO never turns prose into evidence (TM-418)" }],
  ["empty string", "",
    { tm: "refuse", ao: "ignore", why: "AO drops every non-object before reading" }],
  ["null entry", null,
    { tm: "refuse", ao: "ignore", why: "AO drops every non-object before reading" }],
];

const tmVerdict = (entry) => (finishChecksRefusal([entry], R) === null ? "accept" : "refuse");

describe("finish-check readers agree (TM-493)", { skip: !existsSync(AO_REVIEWER) && "agent-orchestration is not in this checkout" }, () => {
  it("runs every row through both readers and matches the pinned verdicts", async () => {
    const { finishCheckEvidence } = await import(pathToFileURL(AO_REVIEWER).href);
    const aoVerdict = (entry) => {
      try { return finishCheckEvidence({ checks: [entry] }).length ? "accept" : "ignore"; }
      catch (error) { assert.equal(error.code, "TOPOLOGY_REVIEWER_CHECKS", `unexpected AO error: ${error.message}`); return "refuse"; }
    };
    const seen = { tm: new Set(), ao: new Set() };
    const mismatches = [];
    for (const [label, entry, verdict] of TABLE) {
      const want = typeof verdict === "string" ? { tm: verdict, ao: verdict } : verdict;
      const got = { tm: tmVerdict(entry), ao: aoVerdict(entry) };
      seen.tm.add(got.tm); seen.ao.add(got.ao);
      if (got.tm !== want.tm || got.ao !== want.ao) mismatches.push(`${label}: want tm=${want.tm} ao=${want.ao}, got tm=${got.tm} ao=${got.ao}`);
    }
    assert.deepEqual(mismatches, [], "a reader changed alone; change the other side (or the pinned divergence) with it");
    // Coverage: the table must reach every verdict on both sides, so an empty or one-sided run cannot pass.
    assert.deepEqual([...seen.tm].sort(), ["accept", "refuse"]);
    assert.deepEqual([...seen.ao].sort(), ["accept", "ignore", "refuse"]);
  });

  it("an empty or absent checks list: tm refuses it, AO reads it as no evidence", async () => {
    const { normalizeChecks } = await import(pathToFileURL(AO_REVIEWER).href);
    assert.notEqual(finishChecksRefusal([], R), null);
    assert.notEqual(finishChecksRefusal(undefined, R), null);
    assert.deepEqual(normalizeChecks([]), []);
    assert.deepEqual(normalizeChecks(null), []);
    assert.throws(() => normalizeChecks("npm test"), { code: "TOPOLOGY_REVIEWER_CHECKS" });
  });
});
