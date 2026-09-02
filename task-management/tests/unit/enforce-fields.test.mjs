/**
 * The completeness half of the gates: create drafts, start, and done refuse
 * tasks that carry no details. The WIP/epic/unticked-AC halves are pinned by
 * gate-start.test.mjs and decision.test.mjs; this file pins only what
 * completeness.mjs added.
 */
import { after, describe, it } from "node:test";
import assert from "node:assert/strict";
import { cleanup, tempStore } from "./helpers.mjs";
import { gateDone, gateStart, gateTaskCreate, setOverride } from "../../lib/enforce.mjs";
import { create, readEvents, writeConfig, writeState } from "../../lib/store.mjs";

const stores = [];
after(() => cleanup(...stores));
const store = (cfg = {}) => {
  const p = tempStore();
  stores.push(p.root);
  if (Object.keys(cfg).length) writeConfig(cfg, p);
  return p;
};

const withEnforceOff = (fn) => {
  const was = process.env.TM_ENFORCE;
  process.env.TM_ENFORCE = "off";
  try {
    return fn();
  } finally {
    if (was === undefined) delete process.env.TM_ENFORCE;
    else process.env.TM_ENFORCE = was;
  }
};

const ac = (text = "verifiable", done = true) => ({ text, done });
/** A draft or task carrying everything requireOnDone asks for. */
const fullFields = { body: "what and why", acceptance: [ac()], evidence: ["out.txt"], assignee: "ryan" };

describe("gateTaskCreate draft completeness", () => {
  /** requireEpic is satisfied, so only the draft check can refuse. */
  const storeWithEpic = () => {
    const p = store();
    writeState({ activeEpic: create("epic", { title: "e" }, "", p).id }, p);
    return p;
  };

  it("refuses an explicit draft missing body and acceptance, naming both fixes", () => {
    const p = storeWithEpic();
    const res = gateTaskCreate(p, {});
    assert.equal(res.allow, false);
    assert.match(res.reason, /body — tm edit <id> --body/);
    assert.match(res.reason, /acceptance — tm ac <id> "…"/);
    assert.match(res.reason, /--body <text\|-> --ac/);
    assert.match(res.reason, /tm override/);
  });

  it("refuses a draft with a body but no criteria", () => {
    const p = storeWithEpic();
    const res = gateTaskCreate(p, { body: "context" });
    assert.equal(res.allow, false);
    assert.match(res.reason, /acceptance — tm ac/);
    assert.doesNotMatch(res.reason, /body — tm edit/);
  });

  it("allows a draft carrying body and a criterion", () => {
    const p = storeWithEpic();
    assert.equal(gateTaskCreate(p, { body: "context", acceptance: [ac("x", false)] }).allow, true);
  });

  it("skips the check when the draft is null — the harness-mirror exemption", () => {
    const p = storeWithEpic();
    assert.equal(gateTaskCreate(p).allow, true, "null draft: mirror arrives as a bare todo");
    assert.equal(gateTaskCreate(p, null).allow, true);
  });

  it("requireEpic still refuses first, draft or not", () => {
    const p = store();
    const res = gateTaskCreate(p, { body: "x", acceptance: [ac("x", false)] });
    assert.equal(res.allow, false);
    assert.match(res.reason, /no active epic/);
  });

  it("spends an override on the draft refusal exactly once", () => {
    const p = storeWithEpic();
    setOverride("seeding legacy", p);
    assert.equal(gateTaskCreate(p, {}).allow, true);
    assert.equal(gateTaskCreate(p, {}).allow, false);
    assert.equal(readEvents(p).filter((e) => e.event === "override_used").length, 1);
  });

  it("TM_ENFORCE=off opens the gate", () => {
    const p = store();
    withEnforceOff(() => assert.equal(gateTaskCreate(p, {}).allow, true));
  });
});

describe("gateStart completeness", () => {
  const room = () => store({ wipLimit: 5 });

  it("refuses an incomplete task even under the WIP limit", () => {
    const p = room();
    const t = create("task", { title: "bare" }, "", p);
    const res = gateStart(t.id, p);
    assert.equal(res.allow, false);
    assert.match(res.reason, /TM-001 is missing what starting needs/);
    assert.match(res.reason, /body — tm edit TM-001 --body/);
    assert.match(res.reason, /acceptance — tm ac TM-001 "…"/);
  });

  it("allows a task carrying body and criteria", () => {
    const p = room();
    const t = create("task", { title: "full", acceptance: [ac("x", false)] }, "context", p);
    assert.equal(gateStart(t.id, p).allow, true);
  });

  it("the WIP refusal still leads when the board is full", () => {
    const p = store({ wipLimit: 1 });
    create("task", { title: "running", status: "in_progress" }, "", p);
    const bare = create("task", { title: "bare" }, "", p);
    assert.match(gateStart(bare.id, p).reason, /WIP limit 1 reached/);
  });

  it("spends an override on the completeness refusal exactly once", () => {
    const p = room();
    const t = create("task", { title: "bare" }, "", p);
    setOverride("pairing", p);
    assert.equal(gateStart(t.id, p).allow, true);
    assert.equal(gateStart(t.id, p).allow, false);
  });

  it("enforcement off starts anything", () => {
    const p = store({ enforce: false });
    const t = create("task", { title: "bare" }, "", p);
    assert.equal(gateStart(t.id, p).allow, true);
  });
});

describe("gateDone completeness", () => {
  it("allows a task carrying the full record", () => {
    const p = store();
    // body travels as create's third argument, not a frontmatter field
    const { body, ...fields } = fullFields;
    const t = create("task", { title: "full", ...fields }, body, p);
    assert.equal(gateDone(t.id, p).allow, true);
  });

  it("refuses an empty body", () => {
    const p = store();
    const { body, ...rest } = fullFields;
    const t = create("task", { title: "no context", ...rest }, "", p);
    const res = gateDone(t.id, p);
    assert.equal(res.allow, false);
    assert.match(res.reason, /body — tm edit TM-001 --body/);
  });

  it("closes the zero-AC hole: no criteria at all refuses done", () => {
    const p = store();
    // requireAcceptance passes an empty list — nothing is unticked. This gate
    // is the one that sees the hole.
    const t = create("task", { title: "zero ac", evidence: ["out.txt"], assignee: "ryan" }, "context", p);
    const res = gateDone(t.id, p);
    assert.equal(res.allow, false);
    assert.match(res.reason, /acceptance — tm ac TM-001 "…"/);
  });

  it("unticked criteria still refuse with the older message", () => {
    const p = store();
    const t = create(
      "task",
      { title: "unticked", acceptance: [ac("not yet", false)], evidence: ["out.txt"], assignee: "ryan" },
      "context",
      p,
    );
    const res = gateDone(t.id, p);
    assert.equal(res.allow, false);
    assert.match(res.reason, /unmet acceptance criteria/);
  });

  it("refuses missing evidence", () => {
    const p = store();
    const t = create("task", { title: "no proof", acceptance: [ac()], assignee: "ryan" }, "context", p);
    assert.match(gateDone(t.id, p).reason, /evidence — tm evidence TM-001 <path\|->/);
  });

  it("refuses missing actor, and the actor field alone satisfies it", () => {
    const p = store();
    const nobody = create("task", { title: "anonymous", acceptance: [ac()], evidence: ["out.txt"] }, "context", p);
    assert.match(gateDone(nobody.id, p).reason, /actor — tm assign TM-001 <who>/);
    const stamped = create(
      "task",
      { title: "stamped", acceptance: [ac()], evidence: ["out.txt"], actor: "claude" },
      "context",
      p,
    );
    assert.equal(gateDone(stamped.id, p).allow, true);
  });

  it("lists every gap and its fix at once", () => {
    const p = store();
    const t = create("task", { title: "bare" }, "", p);
    const res = gateDone(t.id, p);
    for (const hint of ["tm edit TM-001 --body", 'tm ac TM-001 "…"', "tm evidence TM-001 <path|->", "tm assign TM-001 <who>"]) {
      assert.ok(res.reason.includes(hint), `reason names: ${hint}`);
    }
    assert.match(res.reason, /Bypass once: .*tm override/);
  });

  it("spends an override on the completeness refusal exactly once", () => {
    const p = store();
    const t = create("task", { title: "bare" }, "", p);
    setOverride("closing a legacy card", p);
    assert.equal(gateDone(t.id, p).allow, true);
    assert.equal(gateDone(t.id, p).allow, false);
    assert.equal(readEvents(p).filter((e) => e.event === "override_used").length, 1);
  });

  it("TM_ENFORCE=off closes anything", () => {
    const p = store();
    const t = create("task", { title: "bare" }, "", p);
    withEnforceOff(() => assert.equal(gateDone(t.id, p).allow, true));
  });

  it("an empty requireOnDone list ungates completeness for the project", () => {
    const p = store({ requireOnDone: [] });
    const t = create("task", { title: "bare" }, "", p);
    assert.equal(gateDone(t.id, p).allow, true, "the policy knob, off");
  });
});
