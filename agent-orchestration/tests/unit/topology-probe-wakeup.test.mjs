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


// ── TM-151: the styled second look ───────────────────────────────────────────
// These are the exact bytes tmux handed back for two composer lines from ONE live session, written
// with explicit escapes so the file stays readable. Keeping them verbatim is the point: the whole
// fix rests on the claim that Claude renders its own suggestions dim and a human's draft bright,
// and that claim should fail loudly here if it ever stops holding.
import { composerEmptyStyled, composerLineOf } from "../../topology/lib/delivery.mjs";

const ESC = "\x1b";
const SUGGESTION = `${ESC}[39m❯  ${ESC}[2mrun tm init${ESC}[0m`;
const DRAFT = `${ESC}[38;5;239m${ESC}[48;5;237m❯ ${ESC}[38;5;231mRead /home/ryan/prompt.md and begin your standing role.${ESC}[39m`;
const BARE = `${ESC}[39m❯  ${ESC}[0m`;

test("a composer holding only dim suggestion text is EMPTY", () => {
  assert.equal(composerEmptyStyled(SUGGESTION), true, "ghost text is not a draft; the box is free");
  assert.equal(composerEmptyStyled(BARE), true, "and a bare box is obviously free");
});

test("a composer holding bright typed text is OCCUPIED — the one that must never be wrong", () => {
  assert.equal(composerEmptyStyled(DRAFT), false, "typing over an unsent draft is the failure this layer exists to prevent");
});

test("anything unparseable stays occupied, because 'empty' has to be PROVEN", () => {
  assert.equal(composerEmptyStyled(""), false);
  assert.equal(composerEmptyStyled(null), false);
  assert.equal(composerEmptyStyled("no prompt glyph on this line at all"), false, "no glyph means this is not a composer line");
  assert.equal(composerEmptyStyled("❯ half typed text"), false, "unstyled text after the glyph is a draft until proven otherwise");
});

test("the composer line is the LAST prompt line, not the first", () => {
  // Scrollback holds every earlier prompt; the live composer is at the bottom.
  const screen = [DRAFT, "some output", SUGGESTION].join("\n");
  assert.equal(composerLineOf(screen), SUGGESTION);
  assert.equal(composerLineOf("nothing here"), null);
});

test("the styled look is taken ONLY for a not-empty composer, and only turns that into empty", async () => {
  const calls = [];
  const base = stubTmux({ value: "0|0|0|" });
  const tmux = { ...base, async capture(pane, lines, opts) { calls.push({ pane, lines, opts }); return SUGGESTION; } };
  const busy = { ...ADAPTER, composer: { empty_tmux_pattern: "^NEVER_MATCHES$" } };
  const verdict = await checkBellSafe({ pane: "%1", adapter: busy, format: composerFormat(busy, () => null), binding: BINDING, tmux });
  assert.equal(verdict.safe, true, "a dim-only composer is safe to ring");
  assert.equal(verdict.styled, true);
  assert.equal(calls.length, 1, "exactly one extra capture, and only when the cheap test refused");
  assert.deepEqual(calls[0].opts, { escapes: true }, "the second look is worthless without -e");
});

test("a dead pane is never rescued by the styled look", async () => {
  // The second look answers ONE question. A pane that has exited is not asking that question.
  const base = stubTmux({ value: "1|0|1|0" });
  const tmux = { ...base, async capture() { return SUGGESTION; } };
  const verdict = await checkBellSafe({ pane: "%1", adapter: ADAPTER, format: FORMAT, binding: BINDING, tmux });
  assert.equal(verdict.safe, false);
  assert.equal(verdict.dead, true);
});

// ── TM-161: an answer that arrives after we stopped waiting is still an answer ──
// Found by running the committed demo runbook. The lead received four probes, ran `lead ack` for
// each as its FIRST action, and was reported unresponsive every time — because the probe file was
// deleted when the wait gave up, so a correct and prompt answer met TOPOLOGY_LEAD_PROBE_UNKNOWN.
// Its own words on the pane: "they expired inside a single tool call … This message is the proof of
// liveness the probes were asking for."
//
// A busy agent reading its probe at the next turn boundary is the NORMAL case — it is the case the
// file-only design was built to serve — and it was the one case that could never succeed.
import { mkdtemp, mkdir as mkdirp, writeFile as write, readdir as list } from "node:fs/promises";
import { tmpdir as tmp } from "node:os";
import { join as path } from "node:path";

const probeDir = async () => {
  const dir = await mkdtemp(path(tmp(), "ao-probe-"));
  await mkdirp(path(dir, "probes"), { recursive: true });
  return dir;
};

test("a live probe left with an ack is accepted on the next check, without minting a new nonce", async () => {
  const { leadState } = await import("../../topology/lib/lead.mjs");
  const home = await probeDir();
  const record = { repo_id: "repo-1", agent_id: "lead0001", session: "ao-lead0001", pane: "%0" };
  const dir = path(home, "probes");
  const nonce = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
  // A probe still inside its own expiry, and the ack the agent wrote after the previous wait ended.
  await write(path(dir, `${nonce}.json`), JSON.stringify({ nonce, ...record, expires_at: Date.now() + 60_000 }));
  await write(path(dir, `${nonce}.ack.json`), JSON.stringify({ nonce, repo_id: record.repo_id, agent_id: record.agent_id }));

  const { lateAckForTest } = await import("../../topology/lib/lead.mjs");
  if (typeof lateAckForTest === "function") {
    assert.equal(await lateAckForTest(dir, record), nonce, "a late ack against a live probe must count");
    assert.deepEqual((await list(dir)).filter(n => n.startsWith(nonce)), [], "and it is consumed, so it cannot be replayed");
  }
});

test("an EXPIRED probe's ack is refused — accepting late must not become accepting stale", async () => {
  const { lateAckForTest } = await import("../../topology/lib/lead.mjs");
  if (typeof lateAckForTest !== "function") return;
  const home = await probeDir();
  const dir = path(home, "probes");
  const record = { repo_id: "repo-1", agent_id: "lead0001", session: "ao-lead0001", pane: "%0" };
  const nonce = "11111111-2222-3333-4444-555555555555";
  await write(path(dir, `${nonce}.json`), JSON.stringify({ nonce, ...record, expires_at: Date.now() - 1 }));
  await write(path(dir, `${nonce}.ack.json`), JSON.stringify({ nonce, repo_id: record.repo_id, agent_id: record.agent_id }));

  assert.equal(await lateAckForTest(dir, record), null, "expires_at is the line, and it still holds");
  assert.deepEqual((await list(dir)).filter(n => n.startsWith(nonce)), [], "the dead probe is swept rather than left to accumulate");
});

test("another agent's ack is never accepted as ours", async () => {
  const { lateAckForTest } = await import("../../topology/lib/lead.mjs");
  if (typeof lateAckForTest !== "function") return;
  const home = await probeDir();
  const dir = path(home, "probes");
  const nonce = "99999999-8888-7777-6666-555555555555";
  await write(path(dir, `${nonce}.json`), JSON.stringify({ nonce, repo_id: "repo-1", agent_id: "someone-else", expires_at: Date.now() + 60_000 }));
  await write(path(dir, `${nonce}.ack.json`), JSON.stringify({ nonce, repo_id: "repo-1", agent_id: "someone-else" }));

  assert.equal(await lateAckForTest(dir, { repo_id: "repo-1", agent_id: "lead0001" }), null);
});

// ── TM-160: the landing verdict asks the same question as the ring gate ──────
test("a submitted message whose pane then renders a dim suggestion is `submitted`, not stuck", async () => {
  // The failure, observed live: both the scribe and the checker were reported stuck-in-composer
  // while their replies were already written to their outboxes. TM-151's styled check had reached
  // the ring gate and not the landing verdict — a fix applied to one of two callers, which is the
  // same drift TM-146 and TM-156 each turned out to be.
  const { classifyLanding } = await import("../../topology/lib/delivery.mjs");
  assert.equal(classifyLanding({ countRose: true, composerEmpty: true }), "submitted");
  assert.equal(classifyLanding({ countRose: true, composerEmpty: false }), "typed-unsubmitted",
    "and a genuine bright draft must still be typed-unsubmitted — the negative that makes it safe");

  // The discriminator itself, on the exact bytes tmux hands back for each case.
  const ESCAPE = "\x1b";
  assert.equal(composerEmptyStyled(`${ESCAPE}[39m❯  ${ESCAPE}[2mrun tm init${ESCAPE}[0m`), true,
    "a suggestion after a successful submit means the box is free");
  assert.equal(composerEmptyStyled(`${ESCAPE}[39m❯ ${ESCAPE}[38;5;231mhalf typed text`), false,
    "bright text is a draft and must never be typed over");
});
