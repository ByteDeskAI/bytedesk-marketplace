// Pure tests for the liveness census. No tmux server, no clock, no disk except one tmpdir for the
// document — every heuristic that decides whether a scheduler dispatches into a busy pane is
// testable without any of that, and if it were not, nobody would test it.
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { busyEvidence, classify, takeCensus, withStaleness, adapterForPane } from "../../topology/lib/census.mjs";
import { loadAdapters, providerDirs, withoutPaths, attentionOnScreen } from "../../topology/lib/providers.mjs";
import { tmuxFailureTrigger } from "../../topology/lib/launch.mjs";

const PLUGIN_ROOT = fileURLToPath(new URL("../..", import.meta.url));
const adapters = async () => loadAdapters(providerDirs({ pluginRoot: PLUGIN_ROOT }));

// Real strings, captured from live panes on 2026-09-09. Fixtures that were typed rather than
// observed are how a spinner test passes against a spinner nothing renders.
const CODEX_BUSY_TITLE = "⠹ bytedesk-remote-gateway";
const CODEX_IDLE_TITLE = "bytedesk-remote-gateway";
const CLAUDE_BUSY_TAIL = "✻ Whirlpooling… (8m 45s · ↓ 37.1k tokens · thought for 1s)";
const CLAUDE_IDLE_TAIL = "✻ Worked for 12m 29s · done 3:36 AM\n❯ ";
const KIMI_QUOTA = "Error: [provider.auth_error] 403 You've reached your 5-hour usage limit.";

const binding = (paneId, panePid) => ({ serverKey: "/tmp/tmux-1000/default", serverPid: 4242, sessionId: "$1", sessionCreated: 1_700_000_000, paneId, panePid });
const pane = (id, pid, over = {}) => ({ ...binding(id, pid), sessionName: "ao-x", command: "claude", title: "", alive: true, ...over });

test("busy is the braille RANGE, not a table of glyphs", () => {
  // Every glyph in the block counts, including ones no CLI we have seen animates with.
  for (const code of [0x2800, 0x2839, 0x28ff]) {
    assert.equal(busyEvidence(`prefix ${String.fromCodePoint(code)} suffix`), "braille-spinner", `U+${code.toString(16)}`);
  }
  assert.equal(busyEvidence(CODEX_BUSY_TITLE), "braille-spinner");
  // The same string with the braille stripped is NOT busy. If this ever passes with the braille
  // gone, something other than the range is doing the deciding.
  assert.equal(busyEvidence(CODEX_BUSY_TITLE.replace(/[⠀-⣿]/g, "")), null);
  assert.equal(busyEvidence(CODEX_IDLE_TITLE), null);
});

// If you are here because you loosened the timer marker to "ellipsis then paren" and this test went
// red: the tail `\(\d+\s*[hms]\b` is load-bearing, not decoration. Both strings below are real idle
// panes captured on 2026-09-09, and the loose form matches both.
test("the claude timer marker stays off the two real IDLE screens it was tuned against", () => {
  assert.equal(/[⠀-⣿]/.test(CLAUDE_BUSY_TAIL), false, "claude 2.1 animates with ✻✽✳✶, not braille — the braille range cannot carry it");
  assert.notEqual(busyEvidence(CLAUDE_BUSY_TAIL), "braille-spinner");
  assert.notEqual(busyEvidence(CLAUDE_BUSY_TAIL), null, "so the measured timer marker has to");
  // Same glyph, past tense: only the running timer separates busy from done.
  assert.equal(busyEvidence(CLAUDE_IDLE_TAIL), null);
  assert.equal(busyEvidence("   … (17 more lines, ctrl+o to expand)"), null, "idle kimi");
  assert.equal(busyEvidence("    … +134 lines (ctrl + t to view transcript)"), null, "idle codex");
});

test("needs-input is edge-triggered exactly once across busy -> idle -> idle -> idle", () => {
  const now = Date.parse("2026-09-09T12:00:00.000Z");
  let prior = null;
  const states = [];
  const tails = [CLAUDE_BUSY_TAIL, CLAUDE_IDLE_TAIL, CLAUDE_IDLE_TAIL, CLAUDE_IDLE_TAIL, CLAUDE_IDLE_TAIL];
  tails.forEach((tail, index) => {
    prior = classify({ title: "✳ task", tail, prior, now: now + index * 2000 });
    states.push([prior.state, prior.edge]);
  });
  assert.deepEqual(states, [
    ["working", false],
    ["idle", false],
    ["needs-input", true],
    ["idle", false],
    ["idle", false],
  ]);
  // The timestamp is retained after the edge falls away — that is what makes it useful as
  // "this one just finished" without becoming a sticky label.
  assert.ok(prior.needsInputAt);
  // Working again re-arms it, so the NEXT hand-back fires too.
  const again = classify({ title: "", tail: CLAUDE_BUSY_TAIL, prior, now: now + 20_000 });
  assert.equal(again.needsInputAt, null);
  assert.equal(classify({ title: "", tail: CLAUDE_IDLE_TAIL, prior: classify({ title: "", tail: CLAUDE_IDLE_TAIL, prior: again, now }), now }).state, "needs-input");
});

test("a pane that has never been observed working never produces needs-input", () => {
  let prior = null;
  for (let index = 0; index < 10; index += 1) {
    prior = classify({ title: "zsh", tail: "$ ", prior, now: Date.now() + index * 2000 });
    assert.equal(prior.state, "idle", `poll ${index}`);
    assert.equal(prior.edge, false);
  }
  assert.equal(prior.needsInputAt, null);
});

test("quota-blocked beats attention beats working, through the real providers/kimi.json", async () => {
  const kimi = (await adapters()).get("kimi");
  assert.ok(kimi, "kimi adapter must load");
  assert.equal(kimi.attention_patterns.find((entry) => entry.state === "quota-blocked")?.state, "quota-blocked");

  // Working alone.
  assert.equal(classify({ title: CODEX_BUSY_TITLE, tail: "", adapter: kimi }).state, "working");
  // Quota on the same screen as a spinner: quota wins.
  assert.equal(classify({ title: CODEX_BUSY_TITLE, tail: KIMI_QUOTA, adapter: kimi }).state, "quota-blocked");
  // Quota on the same screen as another attention pattern: quota still wins, whatever the file
  // order is — the census asks for quota first rather than trusting where the entry was typed.
  const mixed = { ...kimi, attention_patterns: [{ pattern: "trust this folder", message: "answer the trust prompt", state: "attention" }, ...kimi.attention_patterns] };
  assert.equal(classify({ title: "", tail: `Do you trust this folder\n${KIMI_QUOTA}`, adapter: mixed }).state, "quota-blocked");
  // Attention alone is still attention, not quota.
  assert.equal(classify({ title: "", tail: "Do you trust this folder", adapter: mixed }).state, "attention");
  assert.match(classify({ title: "", tail: KIMI_QUOTA, adapter: kimi }).reason, /usage limit|window/i);
});

test("the kimi quota pattern survives withoutPaths AND tmuxFailureTrigger", async () => {
  const kimi = (await adapters()).get("kimi");
  const entry = kimi.attention_patterns.find((item) => item.state === "quota-blocked");

  // withoutPaths blanks whitespace-delimited tokens containing "/" before any matching happens.
  // "5-hour" has no slash, so the fragment survives; the full observed line does not need to.
  assert.ok(new RegExp(entry.pattern, "i").test(withoutPaths(KIMI_QUOTA)), "pattern must survive path blanking");
  assert.ok(attentionOnScreen(kimi, `${KIMI_QUOTA}\n/home/ryan/some/path`), "still matches beside a real path");

  // tmuxFailureTrigger drops any pattern tmux's format parser cannot read. A dropped pattern never
  // fires at all on the subscription path — silently — which is why this is its own test.
  const trigger = tmuxFailureTrigger(kimi);
  assert.ok(trigger.includes(entry.pattern), `trigger must carry the quota pattern; got ${trigger}`);
  assert.equal(/[{}:]/.test(entry.pattern), false, "no braces or colons, or tmux eats the format");
  assert.equal(entry.pattern.includes("/"), false, "no slash, or withoutPaths blanks it");
});

test("a dead pane is dead even while its last capture still holds a spinner", () => {
  const verdict = classify({ title: CODEX_BUSY_TITLE, tail: CLAUDE_BUSY_TAIL, dead: true });
  assert.equal(verdict.state, "dead");
  assert.equal(verdict.wasBusy, false, "death must not leave 'was busy' behind for a respawned pane");
});

test("a failed capture is unknown, never idle; so is a listing we could not take", () => {
  assert.equal(classify({ title: "✳ general-purpose", tail: null }).state, "unknown");
  assert.equal(classify({ title: "", tail: null }).state, "unknown");
  assert.equal(classify({ paneMissing: true }).state, "unknown");
  // The only thing a title alone may conclude is "working".
  assert.equal(classify({ title: CODEX_BUSY_TITLE, tail: null }).state, "working");
  assert.equal(classify({ title: CODEX_BUSY_TITLE, tail: null }).evidence.source, "title");
});

// The 2/5/15 ladder is NOT the census's. supervision.mjs owns the loop and therefore owns the
// cadence; `nextRung` is tested there. All the census does is record what it was told, so nobody
// reading a document has to guess how fresh it was meant to be.
test("the census records the cadence it was told, and owns none of its own", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "ao-census-cadence-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const env = { AGENT_ORCHESTRATION_STATE_HOME: join(root, "state") };
  const identity = { id: root, kind: "path", git_common_dir: null };
  const panes = [pane("%1", 11, { title: CODEX_BUSY_TITLE, command: "codex" })];
  const agents = [{ agentId: "a1", displayName: "A", session: { ...panes[0] } }];
  const take = (over) => takeCensus({ env, home: root, consumer: root }, { identity, panes, agents, memo: new Map(), now: 1_000_000, ...over });

  const told = await take({ intervalMs: 2000, staleAfterMs: 45_000 });
  assert.equal(told.intervalMs, 2000);
  assert.equal(told.staleAfterMs, 45_000);
  // A one-shot with no loop behind it assumes the SLOWEST cadence rather than the fastest: a
  // caller who says nothing must not get a document that reads stale six seconds later.
  const untold = await take({});
  assert.equal(untold.intervalMs, 15_000);
  assert.equal(untold.staleAfterMs, 45_000);
});

test("activity means the world moved, so it cannot pin the supervisor's sleep ladder", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "ao-census-activity-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const env = { AGENT_ORCHESTRATION_STATE_HOME: join(root, "state") };
  const identity = { id: root, kind: "path", git_common_dir: null };
  const memo = new Map();
  const take = (panes, agents, previous, over = {}) => takeCensus({ env, home: root, consumer: root }, { identity, panes, agents, memo, previous, memoMs: 0, ...over });

  const busy = [pane("%1", 11, { title: CODEX_BUSY_TITLE, command: "codex" })];
  const agents = [{ agentId: "a1", displayName: "A", session: { ...busy[0] } }];

  const first = await take(busy, agents, null);
  assert.equal(first.activity, true, "first sighting of an agent is news");
  // Still working two ticks later: the STEADY STATE is not activity, or one busy agent holds the
  // supervisor at its 2 s rung forever and undoes the reconcile fix TM-127 landed.
  const second = await take(busy, agents, first);
  assert.equal(second.agents[0].state, "working");
  assert.equal(second.activity, false);
  // A real transition still snaps the ladder back.
  const quiet = [pane("%1", 11, { title: "✳ task" })];
  const finished = await take(quiet, [{ agentId: "a1", displayName: "A", session: { ...quiet[0] } }], second, { capture: async () => CLAUDE_IDLE_TAIL });
  assert.equal(finished.agents[0].state, "idle");
  assert.equal(finished.activity, true, "working -> idle is news");

  // A never-busy pane, so no needs-input edge can fire: a failed capture flips it
  // idle -> unknown -> idle with nothing whatsoever having happened. Neither direction may count,
  // or our own rationing pins the ladder as hard as a busy loop would.
  const shell = [pane("%2", 22, { title: "zsh", command: "zsh" })];
  const shellAgents = [{ agentId: "a2", displayName: "B", session: { ...shell[0] } }];
  const read = { capture: async () => "$ " };
  const blind = { capture: async () => null };
  let document = await take(shell, shellAgents, null, read);
  document = await take(shell, shellAgents, document, read);
  assert.equal(document.agents[0].state, "idle");
  assert.equal(document.activity, false, "idle -> idle is not news");
  document = await take(shell, shellAgents, document, blind);
  assert.equal(document.agents[0].state, "unknown");
  assert.equal(document.activity, false, "we stopped looking; nothing moved");
  document = await take(shell, shellAgents, document, read);
  assert.equal(document.agents[0].state, "idle");
  assert.equal(document.activity, false, "and looking again is not news either");
});

test("stale forces every dispatchable false and every state unknown", () => {
  const document = {
    at: "2026-09-09T12:00:00.000Z",
    staleAfterMs: 45_000,
    captures: 1,
    tickMs: 3,
    agents: [{ agentId: "a", state: "idle", dispatchable: true, durationMs: 0, reason: "", undeliveredMessages: [] }],
  };
  const fresh = withStaleness(document, Date.parse("2026-09-09T12:00:10.000Z"));
  assert.equal(fresh.stale, false);
  assert.equal(fresh.agents[0].dispatchable, true);

  const stale = withStaleness(document, Date.parse("2026-09-09T12:02:00.000Z"));
  assert.equal(stale.stale, true);
  assert.equal(stale.agents[0].state, "unknown");
  assert.equal(stale.agents[0].dispatchable, false);
});

test("adapterForPane resolves a kimi pane from its running command, not from a record", async () => {
  const loaded = await adapters();
  assert.equal(adapterForPane(loaded, { command: "kimi-code" })?.id, "kimi");
  assert.equal(adapterForPane(loaded, { command: "claude" })?.id, "claude");
  assert.equal(adapterForPane(loaded, { command: "2.1.267" }), null, "an unrecognisable command gets no patterns rather than the wrong ones");
});

test("a census reuses one listing, captures only inconclusive panes, and honours its budget", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "ao-census-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const env = { AGENT_ORCHESTRATION_STATE_HOME: join(root, "state") };
  const identity = { id: root, kind: "path", git_common_dir: null };
  const memo = new Map();
  const captured = [];
  const capture = async (target) => { captured.push(target.paneId); return target.paneId === "%2" ? CLAUDE_BUSY_TAIL : CLAUDE_IDLE_TAIL; };

  const panes = [
    pane("%1", 11, { title: CODEX_BUSY_TITLE, command: "codex" }),   // title-conclusive: no capture
    pane("%2", 12, { title: "✳ general-purpose" }),             // inconclusive: capture
    pane("%3", 13, { title: "✳ other" }),                       // inconclusive: capture
  ];
  const agents = panes.map((row, index) => ({ agentId: `agent${index + 1}`, displayName: `Agent ${index + 1}`, session: { ...row } }));

  const first = await takeCensus({ env, home: root, consumer: root }, { identity, panes, agents, memo, capture, budget: 1, now: 1_000_000 });
  assert.equal(first.captures, 1, "budget of 1 means exactly one capture");
  assert.deepEqual(first.agents.map((a) => a.state), ["working", "working", "unknown"]);
  assert.equal(first.agents[0].evidence.source, "title");
  assert.equal(first.agents[2].reason, "pane title was inconclusive and no capture was taken");
  assert.equal(first.agents.every((a) => a.dispatchable === false), true);

  // Second tick, budget lifted, memo still warm for %2 -> only %3 is captured.
  captured.length = 0;
  const second = await takeCensus({ env, home: root, consumer: root }, { identity, panes, agents, memo, capture, budget: 8, now: 1_000_001 });
  assert.deepEqual(captured, ["%3"], "the memo keeps a fresh observation from being re-captured");
  assert.deepEqual(second.agents.map((a) => a.state), ["working", "working", "idle"]);
  assert.equal(second.agents[2].dispatchable, true);
  assert.ok(Number.isInteger(second.tickMs), "tickMs makes a performance regression visible");

  // A respawn changes panePid, which invalidates the memo entry for that pane.
  captured.length = 0;
  const respawned = panes.map((row) => (row.paneId === "%2" ? { ...row, panePid: 999 } : row));
  const agentsAfter = agents.map((a, i) => ({ ...a, session: { ...respawned[i] } }));
  await takeCensus({ env, home: root, consumer: root }, { identity, panes: respawned, agents: agentsAfter, memo, capture, budget: 8, now: 1_000_002 });
  assert.ok(captured.includes("%2"), "a respawned pane is observed again rather than trusted");

  // A pane that leaves a listing that SUCCEEDED is dead, and it is still reported — presence drops
  // it entirely, so without the carry-forward "gone" would simply never be said.
  const dropped = await takeCensus({ env, home: root, consumer: root }, { identity, panes: [respawned[0]], agents: [agentsAfter[0]], memo, capture, budget: 8, now: 1_000_003 });
  const gone = dropped.agents.find((a) => a.agentId === "agent2");
  assert.equal(gone?.state, "dead");
  // A tombstone must never be mistakable for a current reading, so the flag rides out to --json.
  assert.equal(gone.carriedForward, true);
  assert.equal(dropped.agents.find((a) => a.agentId === "agent1").carriedForward, false);
  // And it is dropped after that one tick rather than accumulating forever.
  const settled = await takeCensus({ env, home: root, consumer: root }, { identity, panes: [respawned[0]], agents: [agentsAfter[0]], memo, capture, budget: 8, now: 1_000_004, previous: dropped });
  assert.equal(settled.agents.some((a) => a.agentId === "agent2"), false);

  // A listing we could not take at all makes every agent unknown and nothing dispatchable.
  const blind = await takeCensus({ env, home: root, consumer: root }, { identity, panes: null, agents, memo, capture, budget: 8, now: 1_000_004 });
  assert.equal(blind.agents.every((a) => a.state === "unknown" && a.dispatchable === false), true);
});
