// TM-157. The readiness probe was file-only with a one-second window, and nothing woke an idle
// standing agent to see it — so a healthy reviewer read `unresponsive` forever and every governed
// launch refused on it. This is the wake, and the rules it must not break.
//
// The rules are the bell's, unchanged: type only into a pane that is alive, still bound, showing an
// empty composer, and free of any attention or failure screen. A pane that fails any of those gets
// NOTHING typed into it and the probe degrades to exactly the old file-only behaviour — which is
// still correct for an agent mid-turn, and was always the right answer for that case.
import assert from "node:assert/strict";
import test from "node:test";

import { checkBellSafe, composerFormat, wakeForProbe } from "../../topology/lib/delivery.mjs";

const ADAPTER = {
  id: "claude",
  submit_keys: ["Enter"],
  composer: { empty_tmux_pattern: '^\\s*[│|]?\\s*[>❯]([^a-zA-Z0-9]*$|[^a-zA-Z0-9]*Try ")' },
  ready: { tmux_pattern: '^\\s*[│|]?\\s*[>❯]([^a-zA-Z0-9]*$|[^a-zA-Z0-9]*Try ")' },
  attention_patterns: [{ pattern: "Do you trust", message: "a human must answer the trust question" }],
  failure_patterns: ["usage limit"],
};

const FORMAT = composerFormat(ADAPTER, () => null);
const BINDING = { serverKey: "s", serverPid: 1, sessionId: "$0", sessionCreated: "9", paneId: "%1", panePid: 42 };

/** A tmux stub that answers one `display-message` value and records every send. */
function stubTmux({ value, panes = [{ ...BINDING, alive: true, id: "%1" }] }) {
  const sent = [];
  return {
    sent,
    async tmux(args) {
      // `lookAtPane` reads `code === 0` before it trusts stdout — a look that failed is not a look.
      if (args[0] === "display-message") return value === null ? { code: 1, stdout: "" } : { code: 0, stdout: value };
      return { code: 0, stdout: "" };
    },
    async listServerPanes() { return panes; },
    async capture() { return value ?? ""; },
    async sendText(pane, text, keys) { sent.push({ pane, text, keys }); },
  };
}

test("an idle pane with an empty composer is woken, and the line carries the nonce", async () => {
  // The value tmux hands back for the bell format, `composer|failure|dead|dead_status`:
  // composer matched on line 1, no failure line, pane alive.
  const tmux = stubTmux({ value: "1|0|0|" });
  const result = await wakeForProbe({
    pane: "%1", adapter: ADAPTER, format: FORMAT, binding: BINDING, tmux,
    text: "AO_PROBE abc — reply with exactly: AO_REVIEWER_READY abc",
  });
  assert.equal(result.rang, true, "an idle, empty, bound pane is exactly the case the wake exists for");
  assert.equal(tmux.sent.length, 1);
  assert.match(tmux.sent[0].text, /AO_REVIEWER_READY abc/, "the ring must tell the agent what to reply, not just that it was pinged");
  assert.deepEqual(tmux.sent[0].keys, ["Enter"], "the submit key comes from the adapter, never a guess");
});

test("a pane with a non-empty composer is NOT typed into", async () => {
  // This is the draft-clobbering case the whole delivery layer exists to prevent, and a probe is
  // not important enough to be the one thing that breaks it.
  const tmux = stubTmux({ value: "0|0|0|" });
  const busy = { ...ADAPTER, composer: { empty_tmux_pattern: "^NEVER_MATCHES$" } };
  const result = await wakeForProbe({
    pane: "%1", adapter: busy, format: composerFormat(busy, () => null), binding: BINDING, tmux, text: "AO_PROBE abc",
  });
  assert.equal(result.rang, false);
  assert.equal(tmux.sent.length, 0, "nothing may be typed into a composer that is not provably empty");
  assert.ok(result.reason, "and it must say why, so the file-only fallback is a decision rather than silence");
});

test("a pane whose binding has moved is NOT typed into", async () => {
  // %N reuse: the pane id is the same and the process behind it is a stranger. Typing a probe into
  // it is the same class of mistake as typing a task assignment into it.
  const tmux = stubTmux({ value: "1|0|0|", panes: [{ ...BINDING, panePid: 999, alive: true, id: "%1" }] });
  const result = await wakeForProbe({ pane: "%1", adapter: ADAPTER, format: FORMAT, binding: BINDING, tmux, text: "AO_PROBE abc" });
  assert.equal(result.rang, false);
  assert.equal(tmux.sent.length, 0);
});

test("a pane that cannot be read is refused, not pressed blind", async () => {
  const tmux = stubTmux({ value: null });
  const verdict = await checkBellSafe({ pane: "%1", adapter: ADAPTER, format: FORMAT, binding: BINDING, tmux });
  assert.equal(verdict.safe, false);
  assert.match(verdict.reason, /could not be read/);
});

test("no pane recorded means no ring, and no tmux call at all", async () => {
  const explode = new Proxy({}, { get() { throw new Error("the wake must not touch tmux when there is no pane"); } });
  const result = await wakeForProbe({ pane: null, adapter: ADAPTER, format: FORMAT, binding: BINDING, tmux: explode, text: "x" });
  assert.equal(result.rang, false);
});

test("the probe window is answerable: seconds, not one second", async () => {
  const { PROBE_TIMEOUT_MS, PROBE_POLL_MS } = await import("../../topology/lib/reviewer.mjs");
  assert.ok(PROBE_TIMEOUT_MS >= 10_000, `a probe window of ${PROBE_TIMEOUT_MS}ms is not answerable by a woken agent`);
  assert.ok(PROBE_POLL_MS >= 100, "polling the pane every few ms is a spin, not a poll");
  assert.ok(PROBE_TIMEOUT_MS / PROBE_POLL_MS <= 100, "the window must not cost hundreds of captures of the same pane");
});

test("an attention screen is never typed into — TM-111, where Enter means exit", async () => {
  // composer looks empty AND a failure/attention line is on screen. The trust modal renders
  // `❯ No, exit`, so a composer-shaped match is exactly what makes this dangerous rather than safe.
  const tmux = stubTmux({ value: "1|3|0|" });
  const result = await wakeForProbe({ pane: "%1", adapter: ADAPTER, format: FORMAT, binding: BINDING, tmux, text: "AO_PROBE abc" });
  assert.equal(result.rang, false, "a matching composer does not license a keystroke when an attention line is up");
  assert.equal(tmux.sent.length, 0);
});
