// TM-135 — provider quota detection and the consent gate.
//
// EVERY TEST HERE RUNS WITH NO TMUX SERVER, and that is not merely convenient. The control client,
// the pane listing, the screen captures, the mailbox and the lead registry are all injected seams,
// so nothing in this file can attach to, start, or kill a tmux server — `TMUX`, `TMUX_TMPDIR` and
// `kill-server` do not appear because no tmux process is ever created.
// `AGENT_ORCHESTRATION_STATE_HOME` puts the incident records in a scratch directory.
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  QUOTA_RECHECK_MS, announcement, approvalCommand, assertConsent, assertIncident, confirmQuota,
  consentFrom, createQuotaWatch, isQuotaPattern, quotaTick, readIncident, resolveIncident,
  subscriptionName, triggerVerdict,
} from "../../topology/lib/quota.mjs";
import { GENERIC_ADAPTER } from "../../topology/lib/providers.mjs";
import { TopologyError } from "../../topology/lib/util.mjs";

const IDENTITY = { id: "git-common-dir:/fixture/repo", kind: "git-common-dir" };
const scratch = () => mkdtemp(join(tmpdir(), "ao-quota-"));

/** A minimal adapter with the real generic failure list — the patterns are the thing under test. */
function adapter(over = {}) {
  return {
    id: "kimi",
    command: "kimi-code",
    failure_patterns: GENERIC_ADAPTER.failure_patterns,
    attention_patterns: [],
    ready: { delay_ms: 3000, tmux_pattern: null },
    ...over,
  };
}
const adapters = (list = [adapter()]) => new Map(list.map((a) => [a.id, a]));

function pane(over = {}) {
  return {
    serverKey: "/tmp/ao-quota-test/socket", serverPid: 99, sessionId: "$1", sessionCreated: 1_700_000_000,
    paneId: "%1", panePid: 1001, sessionName: "kimi-abc", command: "kimi-code", cwd: "/fixture/repo",
    alive: true, title: "kimi-code", ...over,
  };
}
const rosterFor = (p, agentId = "agent-7") => [{ agentId, session: { paneId: p.paneId } }];

/** A control client that never touches tmux: `push` is the server telling us a value changed. */
class FakeControlClient extends EventEmitter {
  static made = [];
  constructor(session, options) {
    super();
    this.session = session;
    this.options = options;
    this.subscriptions = [];
    this.closed = false;
    FakeControlClient.made.push(this);
  }
  async start() { return true; }
  subscribe(name, paneId, format) { this.subscriptions.push({ name, paneId, format }); return true; }
  unsubscribe(name) { this.subscriptions = this.subscriptions.filter((s) => s.name !== name); return true; }
  close() { this.closed = true; }
  push(name, paneId, value) { this.emit("subscription", { name, pane: paneId, value }); }
}

/** One repository's worth of seams. `screens` is what the next capture of each pane returns. */
function fixture(root) {
  const screens = new Map();
  const delivered = [];
  FakeControlClient.made = [];
  return {
    root,
    screens,
    delivered,
    env: { AGENT_ORCHESTRATION_STATE_HOME: root },
    show(p, text) { screens.set(p.paneId, text); },
    input(over = {}) {
      return {
        identity: IDENTITY,
        adapters: adapters(),
        ControlClientClass: FakeControlClient,
        capture: async (p) => (screens.has(p.paneId) ? screens.get(p.paneId) : null),
        deliver: async (envelope) => { delivered.push(envelope); return { status: "delivered" }; },
        lead: async () => ({ record: { agent_id: "lead-1" } }),
        ...over,
      };
    },
    options: { consumer: "/fixture/repo", env: { AGENT_ORCHESTRATION_STATE_HOME: root }, home: root },
    client: () => FakeControlClient.made.at(-1),
  };
}

async function setup(t) {
  const root = await scratch();
  t.after(() => rm(root, { recursive: true, force: true }));
  return fixture(root);
}

// ── The signature filter ──────────────────────────────────────────────────────────────────────

test("the quota signature is the quota-shaped SUBSET of failure_patterns, not the whole list", () => {
  // Where it already lives, per the AC: the first entry of the generic list.
  assert.equal(GENERIC_ADAPTER.failure_patterns[0], "usage limit");
  for (const pattern of ["usage limit", "rate limit", "quota[ _-](exceeded|exhausted|reached)", "out of quota", "too many requests", "\\b429\\b", "overloaded", "(at|over|no) capacity"]) {
    assert.ok(isQuotaPattern(pattern), `${pattern} is a quota signature`);
    assert.ok(GENERIC_ADAPTER.failure_patterns.includes(pattern), `${pattern} really is in failure_patterns`);
  }
  // These are STARTUP failures. A supervisor watching a developer's shell for hours will see all
  // three, and proposing a provider takeover for a failed `ls` is the loudest false positive going.
  for (const pattern of ["command not found", "no such file or directory", "not logged in", "invalid api key", "billing[ _-](issue|problem|error|required)"]) {
    assert.ok(!isQuotaPattern(pattern), `${pattern} must NOT propose a failover`);
    assert.ok(GENERIC_ADAPTER.failure_patterns.includes(pattern), `${pattern} stays in failure_patterns for startup`);
  }
});

test("triggerVerdict reads the server's four fields and ignores the ready column", () => {
  assert.deepEqual(triggerVerdict("0|1|0|"), { triggered: true, dead: false, status: null });
  assert.deepEqual(triggerVerdict("1|0|0|"), { triggered: false, dead: false, status: null }, "a ready line is not a failure");
  assert.deepEqual(triggerVerdict("0|2|1|137"), { triggered: true, dead: true, status: 137 });
  assert.deepEqual(triggerVerdict(""), { triggered: false, dead: false, status: null });
});

// ── Consent ───────────────────────────────────────────────────────────────────────────────────

test("failover.consent defaults to ask, and an unrecognised value is reported rather than obeyed", () => {
  assert.deepEqual(consentFrom({}), { consent: "ask", error: null });
  assert.deepEqual(consentFrom({ failover: { consent: "auto" } }), { consent: "auto", error: null });
  assert.deepEqual(consentFrom({ failover: { consent: "never" } }), { consent: "never", error: null });
  const bad = consentFrom({ failover: { consent: "yes please" } });
  assert.equal(bad.consent, "ask", "an unreadable policy falls back to the branch that cannot do harm");
  assert.match(bad.error, /ask, auto, never/);
});

test("assertConsent is the one unavoidable human turn, and never means never", () => {
  assert.throws(() => assertConsent({ consent: "never", approvedBy: "ryan", agentId: "a1" }),
    (e) => e instanceof TopologyError && e.code === "TOPOLOGY_FAILOVER_FORBIDDEN");
  assert.throws(() => assertConsent({ consent: "ask", approvedBy: null, agentId: "a1" }),
    (e) => e instanceof TopologyError && e.code === "TOPOLOGY_FAILOVER_UNAPPROVED");
  assert.throws(() => assertConsent({ consent: "ask", approvedBy: "   ", agentId: "a1" }),
    (e) => e.code === "TOPOLOGY_FAILOVER_UNAPPROVED", "whitespace is not a person");
  assert.deepEqual(assertConsent({ consent: "ask", approvedBy: " ryan ", agentId: "a1" }), { consent: "ask", approved_by: "ryan" });
  assert.deepEqual(assertConsent({ consent: "auto", approvedBy: null, agentId: "a1" }),
    { consent: "auto", approved_by: "config:failover.consent=auto" });
});

// ── The three false-positive defences ─────────────────────────────────────────────────────────

test("confirmQuota: a capture that failed is not an empty screen and confirms nothing", async () => {
  const verdict = await confirmQuota({ adapter: adapter(), pane: pane(), screen: null });
  assert.equal(verdict.confirmed, false);
  assert.match(verdict.reason, /could not be read/);
});

test("confirmQuota: a path that contains the word is blanked before matching", async () => {
  const verdict = await confirmQuota({ adapter: adapter(), pane: pane(), screen: "cd /home/dev/quota-work/rate-limit-notes && ls" });
  assert.equal(verdict.confirmed, false, "a repo called quota-work is not an outage");
});

test("confirmQuota: a non-quota failure word never proposes a takeover", async () => {
  const verdict = await confirmQuota({ adapter: adapter(), pane: pane(), screen: "bash: frobnicate: command not found" });
  assert.equal(verdict.confirmed, false);
  assert.equal(verdict.pattern, "command not found");
  assert.match(verdict.reason, /not a quota signature/);
});

test("confirmQuota: DEFENCE 2 — a pane still rendering progress is an agent quoting the error, not one hit by it", async () => {
  const screen = "403 You have reached your 5-hour usage limit";
  const working = await confirmQuota({ adapter: adapter(), pane: pane({ title: "⠹ bytedesk-marketplace" }), screen });
  assert.equal(working.confirmed, false, "this is the agent working on THIS FEATURE, grepping the signature");
  assert.equal(working.evidence, "progressing");

  const stopped = await confirmQuota({ adapter: adapter(), pane: pane(), screen });
  assert.equal(stopped.confirmed, true, "the same words on a pane making no progress ARE the outage");
  assert.equal(stopped.evidence, "no-progress");
  assert.equal(stopped.pattern, "usage limit");
});

test("confirmQuota: a dead pane confirms outright, and an ANSWERED nonce probe vetoes outright", async () => {
  const screen = "You have reached your 5-hour usage limit";
  assert.equal((await confirmQuota({ adapter: adapter(), pane: pane({ alive: false }), screen })).evidence, "pane-dead");

  const answered = await confirmQuota({ adapter: adapter(), pane: pane(), screen, probe: async () => ({ available: true, answered: true }) });
  assert.equal(answered.confirmed, false, "an agent that answers is not out of quota, whatever is on its screen");

  const silent = await confirmQuota({ adapter: adapter(), pane: pane(), screen, probe: async () => ({ available: true, answered: false }) });
  assert.deepEqual([silent.confirmed, silent.evidence], [true, "probe-unanswered"]);

  // The case the brief did not account for: `roles.mjs` reports `responsive: null` for every
  // non-singleton role, so most agents CANNOT answer a probe. An unavailable probe must therefore
  // decide nothing on its own — the progress test carries it.
  const unavailable = await confirmQuota({ adapter: adapter(), pane: pane({ title: "⠹ working" }), screen, probe: async () => ({ available: false }) });
  assert.equal(unavailable.confirmed, false, "an unanswerable probe is not evidence of an outage");
});

// ── The tick ──────────────────────────────────────────────────────────────────────────────────

test("a quiet repository costs nothing: subscriptions are armed and no pane is captured", async (t) => {
  const fx = await setup(t);
  const watch = createQuotaWatch();
  const p = pane();
  let captures = 0;
  const result = await quotaTick(fx.options, fx.input({ watch, panes: [p], agents: rosterFor(p), capture: async () => { captures += 1; return ""; } }));
  assert.equal(result.watching, 1);
  assert.deepEqual(result.armed, [subscriptionName("%1")]);
  assert.equal(captures, 0, "nothing is captured until the server pushes");
  assert.deepEqual(result.incidents, []);
  assert.equal(fx.client().subscriptions[0].paneId, "%1");
  watch.close();
});

test("DEFENCE 1: a single trigger is a suspicion; the incident needs a second look at least 2s later", async (t) => {
  const fx = await setup(t);
  const watch = createQuotaWatch();
  const p = pane();
  fx.show(p, "Error: [provider.auth_error] 403 You have reached your 5-hour usage limit");
  const at = 1_000_000;

  await quotaTick(fx.options, fx.input({ watch, panes: [p], agents: rosterFor(p), now: at }));
  fx.client().push(subscriptionName("%1"), "%1", "0|1|0|");

  const second = await quotaTick(fx.options, fx.input({ watch, panes: [p], agents: rosterFor(p), now: at + 500 }));
  assert.deepEqual(second.incidents, [], "one look is never enough");
  assert.equal(second.pending.length, 1);
  assert.equal(second.pending[0].pattern, "usage limit");
  assert.equal(await readIncident({ agentId: "agent-7", identity: IDENTITY, env: fx.env, home: fx.root }), null);

  const third = await quotaTick(fx.options, fx.input({ watch, panes: [p], agents: rosterFor(p), now: at + 500 + QUOTA_RECHECK_MS }));
  assert.equal(third.incidents.length, 1, "still there on the second capture — now it is an incident");
  assert.equal(third.pending.length, 0);
  watch.close();
});

test("the incident is written, the lead is rung with the approval command, and NOTHING is restarted", async (t) => {
  const fx = await setup(t);
  const watch = createQuotaWatch();
  const p = pane();
  fx.show(p, "You have reached your 5-hour usage limit");
  const at = 2_000_000;
  const input = (now, over = {}) => fx.input({ watch, panes: [p], agents: rosterFor(p), now, runDirOf: () => "/fixture/repo/.bytedesk/agent-orchestration/runs/r1", ...over });

  await quotaTick(fx.options, input(at));
  fx.client().push(subscriptionName("%1"), "%1", "0|1|0|");
  await quotaTick(fx.options, input(at + 1));
  const result = await quotaTick(fx.options, input(at + 1 + QUOTA_RECHECK_MS));

  const incident = result.incidents[0];
  assert.equal(incident.state, "open");
  assert.equal(incident.agent_id, "agent-7");
  assert.equal(incident.provider, "kimi");
  assert.equal(incident.pattern, "usage limit");
  assert.equal(incident.consent, "ask");
  assert.equal(incident.announced.status, "delivered");
  assert.deepEqual(await readIncident({ agentId: "agent-7", identity: IDENTITY, env: fx.env, home: fx.root }), incident);

  assert.equal(fx.delivered.length, 1);
  assert.equal(fx.delivered[0].to, "lead-1");
  assert.match(fx.delivered[0].body, /NOTHING has been restarted/);
  assert.match(fx.delivered[0].body, new RegExp(`--incident ${incident.incident_id} --approved-by`));
  // The three survivals, said separately, because the middle one is what a team misreads.
  assert.match(fx.delivered[0].body, /the WORK survives/);
  assert.match(fx.delivered[0].body, /the CONVERSATION does NOT/);
  assert.match(fx.delivered[0].body, /claimTtlMinutes defaults to 240/);
  watch.close();
});

test("a second sighting of the same outage does not raise a second incident or a second message", async (t) => {
  const fx = await setup(t);
  const watch = createQuotaWatch();
  const p = pane();
  fx.show(p, "You have reached your 5-hour usage limit");
  const at = 3_000_000;
  const input = (now) => fx.input({ watch, panes: [p], agents: rosterFor(p), now });

  await quotaTick(fx.options, input(at));
  const name = subscriptionName("%1");
  fx.client().push(name, "%1", "0|1|0|");
  await quotaTick(fx.options, input(at + 1));
  const first = await quotaTick(fx.options, input(at + 1 + QUOTA_RECHECK_MS));
  fx.client().push(name, "%1", "0|2|0|");
  await quotaTick(fx.options, input(at + 10_000));
  const again = await quotaTick(fx.options, input(at + 20_000));

  assert.equal(again.incidents[0].deduplicated, true);
  assert.equal(again.incidents[0].incident_id, first.incidents[0].incident_id);
  assert.equal(fx.delivered.length, 1, "one outage, one message");
  watch.close();
});

test("consent never records the incident and announces nothing; auto announces that it is pre-authorised", async (t) => {
  for (const [consent, expectDelivered, matcher] of [["never", 0, null], ["auto", 1, /authorised this in advance/]]) {
    const fx = await setup({ after: () => {} });
    const watch = createQuotaWatch();
    const p = pane();
    fx.show(p, "You have reached your 5-hour usage limit");
    const at = 4_000_000;
    const input = (now) => fx.input({ watch, panes: [p], agents: rosterFor(p), now, config: { failover: { consent } } });
    await quotaTick(fx.options, input(at));
    fx.client().push(subscriptionName("%1"), "%1", "0|1|0|");
    await quotaTick(fx.options, input(at + 1));
    const result = await quotaTick(fx.options, input(at + 1 + QUOTA_RECHECK_MS));
    assert.equal(result.consent, consent);
    assert.equal(result.incidents.length, 1, `${consent} still RECORDS the observation`);
    assert.equal(fx.delivered.length, expectDelivered, `${consent} announcement count`);
    if (matcher) assert.match(fx.delivered[0].body, matcher);
    watch.close();
    await rm(fx.root, { recursive: true, force: true });
  }
});

test("an agent that greps the signature while working never produces an incident, however long it holds it", async (t) => {
  const fx = await setup(t);
  const watch = createQuotaWatch();
  const p = pane({ title: "⠸ bytedesk-marketplace" });
  fx.show(p, "  47:  \"usage limit\",   <- the pattern this feature matches on");
  const at = 5_000_000;
  const input = (now) => fx.input({ watch, panes: [p], agents: rosterFor(p), now });

  await quotaTick(fx.options, input(at));
  fx.client().push(subscriptionName("%1"), "%1", "0|1|0|");
  for (const offset of [1, QUOTA_RECHECK_MS + 1, 60_000, 120_000]) {
    const result = await quotaTick(fx.options, input(at + offset));
    assert.deepEqual(result.incidents, [], `no incident at +${offset}ms`);
  }
  assert.equal(fx.delivered.length, 0, "the lead is never rung about a healthy agent");
  // Past its window the suspicion is dropped AND the subscription re-armed, or tmux — which pushes
  // only on change — would never speak about this pane again.
  assert.equal(fx.client().subscriptions.length, 1, "armed exactly once so far");
  const expired = await quotaTick(fx.options, input(at + 6 * 60_000));
  assert.equal(expired.dismissed.length, 1);
  assert.match(expired.dismissed[0].reason, /still making progress/);
  // The NEXT tick re-subscribes. Asserting on `armed` alone would prove nothing: that array names
  // every watched subscription, including ones already in place.
  await quotaTick(fx.options, input(at + 6 * 60_000 + 1));
  assert.equal(fx.client().subscriptions.length, 2, "re-armed rather than left deaf to a server that only pushes on change");
  watch.close();
});

test("no lead registered: the incident still lands, and says why nobody was told", async (t) => {
  const fx = await setup(t);
  const watch = createQuotaWatch();
  const p = pane();
  fx.show(p, "You have reached your 5-hour usage limit");
  const at = 6_000_000;
  const input = (now) => fx.input({ watch, panes: [p], agents: rosterFor(p), now, lead: async () => null });
  await quotaTick(fx.options, input(at));
  fx.client().push(subscriptionName("%1"), "%1", "0|1|0|");
  await quotaTick(fx.options, input(at + 1));
  const result = await quotaTick(fx.options, input(at + 1 + QUOTA_RECHECK_MS));
  assert.equal(result.incidents[0].announced.status, "skipped");
  assert.match(result.incidents[0].announced.reason, /no lead/);
  watch.close();
});

test("a listing that could not be taken watches nothing rather than reporting every agent healthy", async (t) => {
  const fx = await setup(t);
  const watch = createQuotaWatch();
  const result = await quotaTick(fx.options, fx.input({ watch, panes: null, agents: rosterFor(pane()) }));
  assert.equal(result.watching, 0);
  assert.match(result.reason, /no tmux listing/);
  watch.close();
});

test("a pane running something with no measured adapter is not watched, never guessed at", async (t) => {
  const fx = await setup(t);
  const watch = createQuotaWatch();
  const p = pane({ command: "bash" });
  const result = await quotaTick(fx.options, fx.input({ watch, panes: [p], agents: rosterFor(p) }));
  assert.equal(result.watching, 0);
  assert.deepEqual(result.armed, []);
  watch.close();
});

// ── The apply gate ────────────────────────────────────────────────────────────────────────────

test("assertIncident refuses a stale id, a resolved incident, and a provider that has moved on", async (t) => {
  const fx = await setup(t);
  const watch = createQuotaWatch();
  const p = pane();
  fx.show(p, "You have reached your 5-hour usage limit");
  const at = 7_000_000;
  const input = (now) => fx.input({ watch, panes: [p], agents: rosterFor(p), now });
  await quotaTick(fx.options, input(at));
  fx.client().push(subscriptionName("%1"), "%1", "0|1|0|");
  await quotaTick(fx.options, input(at + 1));
  const incident = (await quotaTick(fx.options, input(at + 1 + QUOTA_RECHECK_MS))).incidents[0];
  watch.close();
  const args = { agentId: "agent-7", identity: IDENTITY, consumer: "/fixture/repo", env: fx.env, home: fx.root };

  assert.equal((await assertIncident({ ...args, incidentId: incident.incident_id, provider: "kimi" })).incident_id, incident.incident_id);
  await assert.rejects(assertIncident({ ...args, incidentId: "deadbeef" }), (e) => e.code === "TOPOLOGY_QUOTA_INCIDENT_MISMATCH");
  await assert.rejects(assertIncident({ ...args, incidentId: incident.incident_id, provider: "codex" }), (e) => e.code === "TOPOLOGY_QUOTA_INCIDENT_PROVIDER");
  await assert.rejects(assertIncident({ ...args, agentId: "nobody", incidentId: incident.incident_id }), (e) => e.code === "TOPOLOGY_QUOTA_NO_INCIDENT");

  await resolveIncident({ ...args, state: "applied", by: "ryan" });
  await assert.rejects(assertIncident({ ...args, incidentId: incident.incident_id }), (e) => e.code === "TOPOLOGY_QUOTA_INCIDENT_CLOSED");
});

test("an agent with no run dir gets an announcement that names role reassign, not a command that would refuse", () => {
  const standing = { agent_id: "reviewer-1", provider: "claude", incident_id: "abc", pattern: "usage limit", evidence: "no-progress", detected_at: "now", recheck_ms: QUOTA_RECHECK_MS, run_dir: null };
  assert.equal(approvalCommand({ incident: standing }), null);
  const body = announcement(standing, "ask");
  assert.match(body, /role reassign/);
  assert.ok(!/ao-topology failover/.test(body), "never print a command that cannot work");
});
