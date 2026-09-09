import assert from "node:assert/strict";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import os from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  classifyLanding,
  composerEmptyOnScreen,
  composerFormat,
  decideBell,
  decideResubmit,
  isUndelivered,
  MAX_RESUBMITS,
  MAX_RETYPES,
  nextDeliveryRung,
  notificationFor,
  ringCapability,
  ringMessage,
} from "../../topology/lib/delivery.mjs";
import { decideFromSubscription, tmuxFailureTrigger } from "../../topology/lib/launch.mjs";
import { assertTmuxPattern, loadAdapters } from "../../topology/lib/providers.mjs";
import { sendMessage } from "../../topology/lib/mailbox.mjs";
import { readJson, writeJson } from "../../topology/lib/util.mjs";

const CLAUDE_COMPOSER = "❯  ";

async function fakeRun(agents = [{ id: "conductor", role: "orchestrator" }, { id: "a", role: "worker", pane: "%1" }]) {
  const runDir = await mkdtemp(join(os.tmpdir(), "ao-delivery-"));
  await writeJson(join(runDir, "run.json"), { consumer: runDir, version: 1, name: "t", run_id: "r1", session: "t-r1", sequence: 0, agents });
  return runDir;
}

/** Any use at all throws — the shape of the assertion "this path does not touch tmux". */
function forbiddenTmux(what = "tmux") {
  return new Proxy({}, { get(_target, prop) { throw new Error(`${what}.${String(prop)} was called on a path that must not touch tmux`); } });
}

test("classifyLanding: the truth table, including the row that must never read as submitted", () => {
  assert.equal(classifyLanding({ countRose: false, composerEmpty: true }), "not-typed");
  assert.equal(classifyLanding({ countRose: false, composerEmpty: false }), "not-typed");
  assert.equal(classifyLanding({ countRose: false, composerEmpty: null }), "not-typed");
  assert.equal(classifyLanding({ countRose: true, composerEmpty: false }), "typed-unsubmitted");
  assert.equal(classifyLanding({ countRose: true, composerEmpty: true }), "submitted");
  // The composer could not be read. `held` is the honest answer: a wrong "submitted" is a message
  // nobody will ever retry, so this row is never allowed to be optimistic.
  assert.equal(classifyLanding({ countRose: true, composerEmpty: null }), "held");
  assert.equal(classifyLanding({ countRose: true, composerEmpty: undefined }), "held");
});

test("nextDeliveryRung: a stuck draft is resubmitted, then waited on — and NEVER re-typed", () => {
  // Re-typing appends a second copy of the pointer to the draft already in the composer, and the
  // agent then reads a doubled message. This test is what stops a refactor from doing that.
  assert.equal(nextDeliveryRung({ state: "typed-unsubmitted", resubmits: 0 }), "resubmit");
  assert.equal(nextDeliveryRung({ state: "typed-unsubmitted", resubmits: 1 }), "resubmit");
  assert.equal(nextDeliveryRung({ state: "typed-unsubmitted", resubmits: MAX_RESUBMITS }), "wait-safe");
  assert.equal(nextDeliveryRung({ state: "typed-unsubmitted", resubmits: MAX_RESUBMITS + 5 }), "wait-safe");
  for (let resubmits = 0; resubmits <= MAX_RESUBMITS + 5; resubmits += 1) {
    assert.notEqual(nextDeliveryRung({ state: "typed-unsubmitted", resubmits }), "retype");
  }

  assert.equal(nextDeliveryRung({ state: "not-typed", retypes: 0 }), "retype");
  assert.equal(nextDeliveryRung({ state: "not-typed", retypes: MAX_RETYPES }), "escalate");
  assert.equal(nextDeliveryRung({ state: "held", retypes: 0 }), "retype");
  assert.equal(nextDeliveryRung({ state: "held", retypes: MAX_RETYPES }), "escalate");

  assert.equal(nextDeliveryRung({ state: "typed-unsubmitted", safe: false }), "wait-safe");
  assert.equal(nextDeliveryRung({ state: "not-typed", exhausted: true }), "escalate");
  assert.equal(nextDeliveryRung({ state: "submitted" }), null);
  assert.equal(nextDeliveryRung({ state: "engaged" }), null);
  assert.equal(nextDeliveryRung({ state: "processed" }), null);
});

test("decideBell refuses on a failure column, a dead pane and a stale binding", () => {
  // A failure or attention line is exactly the TM-111 case: the folder-trust modal draws
  // "❯ No, exit" and Enter there means exit. Never ring, whatever the composer says.
  assert.equal(decideBell("4|9|0|").safe, false);
  assert.equal(decideBell("4|9|0|").check, "failure");
  assert.equal(decideBell("4|0|1|42").safe, false);
  assert.equal(decideBell("4|0|1|42").exit_status, 42);
  assert.equal(decideBell("4|0|0|", { bindingOk: false }).safe, false);
  assert.equal(decideBell("4|0|0|", { bindingOk: false }).stale, true);
  assert.equal(decideBell("0|0|0|").safe, false);
  assert.equal(decideBell("4|0|0|").safe, true);
});

test("decideBell thresholds on > 0, not > promptLines — the launch rule rejects every safe pane", () => {
  // At launch the shell's own prompt is still on screen after clearAndWaitForShell, so a match at or
  // below promptLines is that prompt. Mid-run the shell has been exec'd away and there is no prompt
  // to discount: a composer rendered on line 1 is a perfectly good composer.
  assert.equal(decideBell("1|0|0|").safe, true);
  assert.equal(decideFromSubscription("1|0|0|"), null, "the launch rule discards this same value");
  assert.equal(decideFromSubscription("1|0|0|", { promptLines: 0 })?.ready, true);
});

test("decideResubmit drops the composer check and NOTHING else — the rung must stay reachable", () => {
  // The bug this pins: `typed-unsubmitted` IS a non-empty composer, so gating the resubmit rung on
  // `decideBell` (which requires an empty one) made the only rung that can fix a stuck draft
  // unreachable. Every stuck message would have gone straight to `stuck-in-composer` without one
  // Enter ever being sent, and the ladder would have looked correct in review.
  assert.equal(decideBell("0|0|0|").safe, false, "a full composer is never safe to TYPE into");
  assert.equal(decideResubmit("0|0|0|").safe, true, "but it is exactly when the submit key is called for");
  // Everything else decideBell refuses, this refuses too. TM-111: pressing Enter at the folder-trust
  // modal ("❯ No, exit") is if anything worse than typing there.
  assert.equal(decideResubmit("0|7|0|").safe, false);
  assert.equal(decideResubmit("0|7|0|").check, "failure");
  assert.equal(decideResubmit("0|0|1|9").safe, false);
  assert.equal(decideResubmit("0|0|1|9").exit_status, 9);
  assert.equal(decideResubmit("0|0|0|", { bindingOk: false }).safe, false);
  assert.equal(decideResubmit("0|0|0|", { bindingOk: false }).stale, true);
});

test("an adapter with no composer is ring_capability unsupported, holds, and touches tmux not at all", async () => {
  const adapters = await loadAdapters([join(process.cwd(), "providers")]);
  const grok = adapters.get("grok");
  assert.ok(grok, "grok is one of the adapters deliberately left without a measured composer");
  assert.equal(ringCapability(grok), "unsupported");
  assert.equal(ringCapability(adapters.get("claude")), "supported");

  const runDir = await fakeRun();
  try {
    const result = await ringMessage({
      runDir,
      agentId: "a",
      agent: { id: "a", pane: "%1" },
      adapter: grok,
      pointer: "[ao] Message 001-ping",
      messageId: "001-ping",
      session: "t-r1",
      tmux: forbiddenTmux(),
      deliverPointer: () => { throw new Error("deliverPointer was called for an unsupported adapter"); },
      tmuxFailureTrigger: () => { throw new Error("tmuxFailureTrigger was called for an unsupported adapter"); },
    });
    assert.equal(result.rang, false);
    assert.equal(result.delivery.ring_capability, "unsupported");
    assert.equal(result.delivery.state, "held");
    assert.equal(result.delivery.escalated, false);
    // durable-pending keeps its meaning exactly: the file is in the mailbox and no bell was rung.
    assert.equal(result.notification, "durable-pending");
    assert.equal(isUndelivered(result.delivery), false, "an unsupported adapter must never exit 3");
    const run = await readJson(join(runDir, "run.json"));
    assert.equal(run.ring_state["001-ping"].a.state, "held");
  } finally {
    await rm(runDir, { recursive: true, force: true });
  }
});

test("--no-ring skips the bell without touching tmux and never escalates", async () => {
  const adapters = await loadAdapters([join(process.cwd(), "providers")]);
  const runDir = await fakeRun();
  try {
    const result = await ringMessage({
      runDir, agentId: "a", agent: { id: "a", pane: "%1" }, adapter: adapters.get("claude"),
      pointer: "[ao] Message 001-ping", messageId: "001-ping", session: "t-r1",
      noRing: true,
      tmux: forbiddenTmux(),
      deliverPointer: () => { throw new Error("deliverPointer was called under --no-ring"); },
      tmuxFailureTrigger: () => { throw new Error("tmuxFailureTrigger was called under --no-ring"); },
    });
    assert.equal(result.notification, "ring-skipped");
    assert.equal(result.rang, false);
    assert.equal(isUndelivered(result.delivery), false);
  } finally {
    await rm(runDir, { recursive: true, force: true });
  }
});

test("the driver rings, observes an empty composer, and reports submitted", async () => {
  const adapters = await loadAdapters([join(process.cwd(), "providers")]);
  const runDir = await fakeRun();
  const typed = [];
  try {
    const result = await ringMessage({
      runDir, agentId: "a", agent: { id: "a", pane: "%1" }, adapter: adapters.get("claude"),
      pointer: "[ao] Message 001-ping", messageId: "001-ping", session: null,
      tmux: {
        // The poll path: one display-message per look, in the same four-field shape the
        // subscription pushes.
        tmux: async () => ({ code: 0, stdout: "3|0|0|\n" }),
        captureAll: async () => `some output\n${CLAUDE_COMPOSER}\n`,
        capture: async () => "",
        listServerPanes: async () => [],
        sendKeys: async () => { throw new Error("resubmit is not a rung for a landing that submitted"); },
      },
      deliverPointer: async (pane, adapter, pointer) => { typed.push(pointer); return { delivered: true, attempts: 1 }; },
      tmuxFailureTrigger,
    });
    assert.equal(result.rang, true);
    assert.equal(result.notification, "submitted");
    assert.deepEqual(result.delivery.rungs, ["retype"]);
    assert.equal(result.delivery.state, "submitted");
    assert.equal(result.delivery.composer_empty_after, true);
    assert.equal(result.delivery.escalated, false);
    assert.equal(typed.length, 1, "the message of record is never re-sent, and the pointer is typed once");

    // Idempotent by (message, agent): a second ring for the same message types nothing at all.
    const again = await ringMessage({
      runDir, agentId: "a", agent: { id: "a", pane: "%1" }, adapter: adapters.get("claude"),
      pointer: "[ao] Message 001-ping", messageId: "001-ping", session: null,
      tmux: forbiddenTmux(),
      deliverPointer: () => { throw new Error("a second ring re-typed the pointer"); },
      tmuxFailureTrigger,
    });
    assert.equal(again.notification, "ring-skipped");
  } finally {
    await rm(runDir, { recursive: true, force: true });
  }
});

test("a stuck draft is resubmitted with the submit key alone, never re-typed", async () => {
  const adapters = await loadAdapters([join(process.cwd(), "providers")]);
  const runDir = await fakeRun();
  const typed = [];
  const keys = [];
  let looks = 0;
  try {
    const result = await ringMessage({
      runDir, agentId: "a", agent: { id: "a", pane: "%1" }, adapter: adapters.get("claude"),
      pointer: "[ao] Message 001-ping", messageId: "001-ping", session: null,
      windowMs: 6000,
      tmux: {
        // The pane as it really behaves: composer empty until we type into it, non-empty forever
        // after. That is what makes this test load-bearing — the resubmit rung has to be reachable
        // through a NON-empty composer, because a non-empty composer is the only thing that asks
        // for it. Gating it on `decideBell` (composer empty) made it unreachable.
        tmux: async () => { looks += 1; return { code: 0, stdout: typed.length === 0 ? "3|0|0|\n" : "0|0|0|\n" }; },
        captureAll: async () => "❯ [ao] Message 001-ping from conductor\n",
        capture: async () => "",
        listServerPanes: async () => [],
        sendKeys: async (pane, k) => { keys.push(k.join("+")); },
      },
      deliverPointer: async (pane, adapter, pointer) => { typed.push(pointer); return { delivered: true, attempts: 1 }; },
      tmuxFailureTrigger,
    });
    assert.equal(typed.length, 1, "re-typing would append a second copy of the pointer to the draft");
    assert.deepEqual(keys, ["Enter", "Enter"], "the submit key alone, MAX_RESUBMITS times");
    assert.deepEqual(result.delivery.rungs.slice(0, 3), ["retype", "resubmit", "resubmit"]);
    assert.equal(result.delivery.state, "typed-unsubmitted");
    assert.equal(result.notification, "stuck-in-composer");
    assert.equal(result.delivery.escalated, true);
    assert.equal(isUndelivered(result.delivery), true, "safe pane, pointer did not land — this is the exit-3 case");
    assert.ok(looks > 0);
  } finally {
    await rm(runDir, { recursive: true, force: true });
  }
});

test("a pane that never accepts input escalates as ring-failed rather than reporting success", async () => {
  const adapters = await loadAdapters([join(process.cwd(), "providers")]);
  const runDir = await fakeRun();
  try {
    const result = await ringMessage({
      runDir, agentId: "a", agent: { id: "a", pane: "%1" }, adapter: adapters.get("claude"),
      pointer: "[ao] Message 001-ping", messageId: "001-ping", session: null,
      windowMs: 4000,
      tmux: {
        tmux: async () => ({ code: 0, stdout: "3|0|0|\n" }),
        captureAll: async () => "nothing was ever echoed here\n",
        capture: async () => "",
        listServerPanes: async () => [],
        sendKeys: async () => {},
      },
      // TM-126: the TUI has no key handler, so the occurrence count never rises.
      deliverPointer: async () => ({ delivered: false, attempts: 1 }),
      tmuxFailureTrigger,
    });
    assert.equal(result.delivery.state, "not-typed");
    assert.equal(result.notification, "ring-failed");
    assert.equal(result.delivery.escalated, true);
    assert.equal(result.rang, false);
    assert.equal(isUndelivered(result.delivery), true);
  } finally {
    await rm(runDir, { recursive: true, force: true });
  }
});

test("no safe moment holds without escalating, and never reports rang", async () => {
  const adapters = await loadAdapters([join(process.cwd(), "providers")]);
  const runDir = await fakeRun();
  try {
    const result = await ringMessage({
      runDir, agentId: "a", agent: { id: "a", pane: "%1" }, adapter: adapters.get("claude"),
      pointer: "[ao] Message 001-ping", messageId: "001-ping", session: null,
      windowMs: 300,
      tmux: {
        tmux: async () => ({ code: 0, stdout: "0|0|0|\n" }), // composer never empty
        captureAll: async () => { throw new Error("nothing should be typed when no moment is safe"); },
        capture: async () => "",
        listServerPanes: async () => [],
        sendKeys: async () => { throw new Error("nothing should be typed when no moment is safe"); },
      },
      deliverPointer: () => { throw new Error("nothing should be typed when no moment is safe"); },
      tmuxFailureTrigger,
    });
    assert.equal(result.delivery.state, "held");
    assert.equal(result.notification, "no-safe-bell");
    assert.equal(result.rang, false);
    assert.equal(result.delivery.escalated, false, "held is never exit 3 — nothing was typed");
    assert.equal(isUndelivered(result.delivery), false);
  } finally {
    await rm(runDir, { recursive: true, force: true });
  }
});

test("every provider declaring a composer declares a note, and its patterns survive both guards", async () => {
  const adapters = await loadAdapters([join(process.cwd(), "providers")]);
  const declared = [...adapters.values()].filter((adapter) => adapter.composer);
  assert.deepEqual(declared.map((adapter) => adapter.id).sort(), ["claude", "codex", "kimi"]);
  for (const adapter of declared) {
    assert.ok(adapter.composer.note.trim().length > 40, `${adapter.id}: composer.note must record the measurement`);
    // The same guard `ready.tmux_pattern` goes through: braces, colons, newlines and a trailing
    // whitespace class each compile fine, match nothing, and cost the full timeout.
    assert.doesNotThrow(() => assertTmuxPattern(adapter, "composer.empty_tmux_pattern", adapter.composer.empty_tmux_pattern));
    assert.doesNotThrow(() => new RegExp(adapter.composer.empty_pattern, "m"));
    // tmuxFailureTrigger drops any pattern tmux cannot parse; a composer pattern dropped the same
    // way would never fire on the subscription path — silently, which is the codex bug again.
    assert.ok(!/[{}:]/.test(adapter.composer.empty_tmux_pattern), `${adapter.id}: composer pattern would be dropped by tmuxFailureTrigger's filter`);
    assert.ok(composerFormat(adapter, "usage limit").startsWith("#{C/r:"));
  }
  // Every adapter left without one is honest about it rather than defaulting to ready.tmux_pattern.
  for (const adapter of [...adapters.values()].filter((item) => !item.composer)) {
    assert.equal(ringCapability(adapter), "unsupported");
    assert.equal(composerFormat(adapter, null).split("|")[0], "0");
  }
});

test("the codex ready pattern matches the placeholder an empty composer actually renders", async () => {
  const adapters = await loadAdapters([join(process.cwd(), "providers")]);
  const codex = adapters.get("codex");
  const empty = "  1 background terminal running\n\n› Ask Codex to do anything\n";
  const busy = "› read the inbox file\n";
  // Measured 2026-09-09 on live pane %385: the shipped glyph-only pattern answered 0 for this.
  assert.equal(new RegExp(codex.ready.pattern, "m").test(empty), true);
  assert.equal(new RegExp("(^|\\n)\\s*[›>❯][^a-zA-Z0-9\\n]*$", "m").test(empty), false, "the pattern this adapter used to ship");
  assert.equal(composerEmptyOnScreen(codex, empty), true);
  assert.equal(composerEmptyOnScreen(codex, busy), false);
  assert.equal(composerEmptyOnScreen(adapters.get("claude"), `${CLAUDE_COMPOSER}\n`), true);
  assert.equal(composerEmptyOnScreen(adapters.get("claude"), "❯ read the inbox file 001-ping\n"), false);
  assert.equal(composerEmptyOnScreen(adapters.get("kimi"), "│ >                    │\n"), true);
  assert.equal(composerEmptyOnScreen(adapters.get("kimi"), "│ > read inbox 001  │\n"), false);
  assert.equal(composerEmptyOnScreen(adapters.get("grok"), "anything at all"), null);
});

test("a repeated idempotencyKey writes no second inbox file", async () => {
  const runDir = await fakeRun();
  try {
    const first = await sendMessage({ runDir, fromProject: runDir, from: "conductor", to: ["a"], stage: "ping", body: "PING", idempotencyKey: "k1" });
    const again = await sendMessage({ runDir, fromProject: runDir, from: "conductor", to: ["a"], stage: "ping", body: "PING", idempotencyKey: "k1" });
    assert.equal(again.id, first.id);
    const inbox = await readdir(join(runDir, "agents", "a", "inbox"));
    assert.deepEqual(inbox, ["001-ping.md"]);
    const run = await readJson(join(runDir, "run.json"));
    assert.equal(run.sequence, 1, "the sequence did not advance, so nothing in the ring ladder can re-send the message of record");
  } finally {
    await rm(runDir, { recursive: true, force: true });
  }
});

test("notificationFor keeps durable-pending's meaning and widens the rest", () => {
  assert.equal(notificationFor({ state: "held", capability: "unsupported" }), "durable-pending");
  assert.equal(notificationFor({ state: "submitted", capability: "supported", everSafe: true }), "submitted");
  assert.equal(notificationFor({ state: "held", capability: "supported", skipped: true }), "ring-skipped");
  assert.equal(notificationFor({ state: "held", capability: "supported", everSafe: false }), "no-safe-bell");
  assert.equal(notificationFor({ state: "typed-unsubmitted", capability: "supported", everSafe: true }), "stuck-in-composer");
  assert.equal(notificationFor({ state: "not-typed", capability: "supported", everSafe: true }), "ring-failed");
  assert.equal(notificationFor({ state: "stale-binding", capability: "supported", everSafe: true }), "stale-binding");
  assert.equal(notificationFor({ state: "submitted-inert", capability: "supported", everSafe: true }), "submitted-inert");
});
