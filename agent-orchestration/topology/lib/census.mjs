// Liveness census: what every agent in this repository is DOING right now.
//
// Presence v1 answers a different question — "is this session alive"
// (starting|ready|busy|unresponsive|dead) — and it is a frozen, countersigned contract. Work state
// has a different lifetime and a different consumer, so the census writes its own document at
// <stateRoot>/census/<repoKey>.json and never touches presence.mjs or its wire output.
//
// Precedence, highest first, and the order IS the design:
//
//   dead > quota-blocked > attention > working > needs-input > idle > unknown
//
// Death beats a screen still showing a spinner: a pane that exited keeps its last frame, and that
// frame lies. A failed capture is `unknown`, never `idle` — "I could not read the screen" and "the
// screen was empty" are the same string and opposite facts, and conflating them is how a scheduler
// dispatches work into a busy agent.
//
// ponytail: `working` is a screen heuristic — a spinner in the pane title or the last 20 rendered
// lines — so its ceiling is one poll of lag (2 s at the fast end) plus whatever the CLI chooses to
// render, and it is blind to an agent thinking without animating. The real fix is a provider-side
// end-of-turn signal: Claude Code fires `Stop` at the end of every turn, which would report
// `evidence.source: "hook"` with no polling and no guessing. Every row carries `evidence.source`
// from day one so that takeover is VISIBLE — and so is its regression, which is the half a
// mechanism always forgets to give you.
import { homedir } from "node:os";
import { join } from "node:path";
import { readDeaths } from "./launch.mjs";
import { PRESENCE_BINDING_FIELDS } from "./presence.mjs";
import { attentionOnScreen } from "./providers.mjs";
import { canonicalRepoId, repoKey, stateRoot } from "./repoid.mjs";
import { tmux } from "./tmux.mjs";
import { readJson, writeJson } from "./util.mjs";

export const CENSUS_SCHEMA_VERSION = 1;
export const CENSUS_STATES = ["dead", "quota-blocked", "attention", "working", "needs-input", "idle", "unknown"];
/** Adaptive observation cadence. Decoupled from the reconcile tick, or the backoff buys nothing. */
export const CENSUS_INTERVALS = [2000, 5000, 15000];
const DEFAULT_STALE_MS = 45_000;
const DEFAULT_BUDGET = 8;
const DEFAULT_MEMO_MS = 2000;
const TAIL_LINES = 20;

/**
 * A spinner, without a per-CLI spinner table.
 *
 * The Unicode Braille Patterns block (U+2800–U+28FF) is the CLI-agnostic part: it is what codex,
 * kimi and grok animate with, and it is a RANGE, so no list of individual glyphs has to be
 * maintained — and nobody is invited to maintain one.
 *
 * Measured live on 2026-09-09 against ~40 real panes on this machine, because the range alone is
 * not the whole truth:
 *
 *   codex 0.5x   pane_title "<braille> bytedesk-remote-gateway" while working, plain title when
 *                idle; tail "Working (1m 22s • esc to interrupt)".   -> braille, in the TITLE
 *   kimi         braille in the composer box while working.          -> braille
 *   claude 2.1   pane_title is "✳ <task>" ALWAYS — busy and idle alike, so the title is useless
 *                for it — and the busy line in the tail is a random gerund with a running timer:
 *                "✻ Whirlpooling… (8m 45s · ↓ 37.1k tokens)". Idle reads "✻ Worked for 12m 29s ·
 *                done 3:36 AM" — same glyph, past tense.            -> NOT braille; timer marker
 *
 * Hence one measured marker beyond the range: an ellipsis followed by a RUNNING elapsed timer.
 * `\(\d+\s*[hms]\b` is what keeps it off "… (17 more lines, ctrl+o to expand)" and "… +134 lines
 * (ctrl + t to view transcript)", both of which sit in real IDLE panes right now.
 */
const BRAILLE = /[⠀-⣿]/;
const MARKERS = [
  /esc to interrupt/i,      // codex; claude <= 2.0
  /…\s*\(\d+\s*[hms]\b/, // claude 2.1 running spinner line
  /working…|thinking…/i,
  /[✶◐◓◑◒]/,
];

/** The matched busy evidence, or null. Exported so a test can prove it is the RANGE, not a table. */
export function busyEvidence(text) {
  const value = String(text ?? "");
  if (BRAILLE.test(value)) return "braille-spinner";
  for (const marker of MARKERS) if (marker.test(value)) return String(marker);
  return null;
}

export function censusPath({ env = process.env, home = homedir(), key }) {
  return join(stateRoot(env, home), "census", `${key}.json`);
}

const bindingKey = (binding) => JSON.stringify(PRESENCE_BINDING_FIELDS.map((field) => binding?.[field]));
const quotaOnly = (adapter) => ({ ...adapter, attention_patterns: (adapter.attention_patterns ?? []).filter((entry) => entry.state === "quota-blocked") });

/**
 * One agent's state from one look. Pure: no tmux, no clock, no disk — the whole precedence table is
 * testable without a tmux server, which is the only way the edge trigger below stays honest.
 *
 * `tail === null` means "not read" (no capture taken, budget spent, or the capture FAILED). It is
 * never treated as an empty screen.
 */
export function classify({ title = "", tail = null, adapter = null, dead = false, paneMissing = false, prior = null, now = Date.now() } = {}) {
  const carry = { idleStreak: prior?.idleStreak ?? 0, wasBusy: prior?.wasBusy === true, needsInputAt: prior?.needsInputAt ?? null };
  const done = (state, reason, source, over = {}) => ({
    state,
    reason,
    evidence: { source },
    since: prior?.state === state ? (prior.since ?? new Date(now).toISOString()) : new Date(now).toISOString(),
    edge: false,
    ...carry,
    ...over,
  });
  // Death first, and it clears the streak: the last frame of an exited pane can hold a spinner
  // forever, and a pane respawned into the same id must not inherit "was busy" from its predecessor.
  if (dead) return done("dead", "pane exited or is recorded in deaths.tsv", "listing", { idleStreak: 0, wasBusy: false, needsInputAt: null });
  if (paneMissing) return done("unknown", "tmux could not be listed, so liveness is unknown", "none");

  const titleText = String(title ?? "");
  const text = [titleText, tail].filter((part) => typeof part === "string" && part).join("\n");
  // The provider's own attention patterns, with quota split out by the optional `state` field.
  // Quota is asked FIRST rather than trusting file order: a pane can render an out-of-quota error
  // and a login prompt at once, and "wait for the window" is the one an operator can act on.
  // Re-using attentionOnScreen for both passes keeps the path-blanking in exactly one place.
  const attention = adapter && text ? (attentionOnScreen(quotaOnly(adapter), text) ?? attentionOnScreen(adapter, text)) : null;
  if (attention) {
    const state = attention.state === "quota-blocked" ? "quota-blocked" : "attention";
    return done(state, attention.message, tail === null ? "title" : "tail", { idleStreak: 0, wasBusy: false, needsInputAt: null });
  }

  const titleBusy = busyEvidence(titleText);
  const busy = titleBusy ?? (tail === null ? null : busyEvidence(tail));
  if (busy) return done("working", `spinner on screen (${busy})`, titleBusy ? "title" : "tail", { idleStreak: 0, wasBusy: true, needsInputAt: null });

  // Nothing positive on screen AND we never read the screen. A title without a spinner is not an
  // idle agent — claude's title is a constant.
  if (tail === null) return done("unknown", "pane title was inconclusive and no capture was taken", "none");

  const idleStreak = carry.idleStreak + 1;
  // Edge-triggered exactly once. Level-triggering re-notifies forever while an agent sits at a
  // prompt, because the condition never clears; the edge is what makes it mean "this one just
  // finished". A pane never observed working can never produce it, or every long-idle shell in the
  // repo reads as an agent that just handed work back.
  if (carry.wasBusy && idleStreak >= 2 && carry.needsInputAt === null) {
    return done("needs-input", "idle for two polls after working", "tail", { edge: true, idleStreak, needsInputAt: new Date(now).toISOString() });
  }
  return done("idle", "no spinner and nothing waiting on a human", "tail", { idleStreak });
}

/**
 * The adapter whose patterns describe this pane, resolved from what the pane is RUNNING rather than
 * from what a record claims it launched. `pane_current_command` is "kimi-code" for kimi and
 * "claude"/"codex"/"grok" for the rest, so an id-or-command prefix match covers every adapter we
 * ship. No match means no attention patterns — reported honestly as such, never guessed.
 */
export function adapterForPane(adapters, pane) {
  const command = String(pane?.command ?? "");
  if (!command || !adapters) return null;
  for (const adapter of adapters.values()) {
    if (adapter.id === "generic") continue;
    for (const candidate of [adapter.id, adapter.command].filter(Boolean)) {
      if (command === candidate || command.startsWith(String(candidate))) return adapter;
    }
  }
  return null;
}

async function captureTail(pane, lines = TAIL_LINES) {
  // -S -20, never full history: this runs once per agent per tick and a long-lived pane's
  // scrollback is megabytes. Null on failure — see the header.
  const result = await tmux(["capture-pane", "-p", "-t", pane.paneId, "-S", `-${lines}`], { tmuxServer: pane.serverKey, allowFailure: true });
  return result.code === 0 ? result.stdout : null;
}

const memoStore = new Map();

/**
 * Take one census and write it. Cheap by construction:
 *
 *  - `panes` is the supervisor's SINGLE `list-panes -a` result, handed in rather than re-queried;
 *  - the pane title (one extra column on that listing, zero extra calls) decides most panes;
 *  - only inconclusive panes are captured, tail-only, at most `AO_CENSUS_CAPTURE_BUDGET` per tick,
 *    oldest observation first so the budget rotates instead of starving the same panes;
 *  - captures memoize on (paneId, panePid) for `AO_CENSUS_MEMO_MS`, so a respawn invalidates.
 *
 * `panes: null` means the listing itself failed — every agent is `unknown`, nothing is dispatchable.
 */
export async function takeCensus(options = {}, input = {}) {
  const started = input.startedAt ?? Date.now();
  const { env = process.env, home = homedir(), consumer } = options;
  const identity = input.identity ?? (await canonicalRepoId(consumer));
  const key = repoKey(identity.id);
  const path = censusPath({ env, home, key });
  const now = input.now ?? Date.now();
  const memo = input.memo ?? memoStore;
  const budget = Number(input.budget ?? env.AO_CENSUS_CAPTURE_BUDGET ?? DEFAULT_BUDGET);
  const memoMs = Number(input.memoMs ?? env.AO_CENSUS_MEMO_MS ?? DEFAULT_MEMO_MS);
  const staleAfterMs = Number(input.staleAfterMs ?? env.AO_CENSUS_STALE_MS ?? DEFAULT_STALE_MS);
  const capture = input.capture ?? captureTail;
  const adapters = input.adapters ?? null;

  const previous = input.previous !== undefined ? input.previous : await readJson(path).catch(() => null);
  const priors = new Map((previous?.agents ?? []).map((entry) => [entry.agentId, entry]));

  const panes = input.panes ?? null;
  const paneIndex = panes === null ? null : new Map(panes.map((pane) => [bindingKey(pane), pane]));
  const deadPanes = new Set();
  for (const runDir of input.runDirs ?? []) {
    for (const death of await readDeaths(runDir).catch(() => [])) if (death.pane) deadPanes.add(death.pane);
  }

  // Roster = what presence observed, plus anything the last census knew about that has since left
  // the listing. Without the carry-forward a dead agent simply VANISHES — presence only reports
  // agents whose pane row still exists — and "gone" is the one state an operator most needs said.
  const observed = input.agents ?? [];
  const seen = new Set(observed.map((agent) => agent.agentId));
  const roster = [...observed];
  for (const prior of priors.values()) {
    if (seen.has(prior.agentId) || prior.state === "dead") continue;
    roster.push({ agentId: prior.agentId, displayName: prior.displayName, title: prior.title, repoRole: prior.repoRole, runRole: prior.runRole, session: prior.binding, primaryRunId: prior.runId ?? null });
  }

  // Decide who needs a capture: title-conclusive panes cost nothing at all.
  const work = roster.map((agent) => {
    const binding = agent.session ?? null;
    const pane = paneIndex && binding ? paneIndex.get(bindingKey(binding)) ?? null : null;
    const dead = panes !== null && (pane === null || pane.alive === false || deadPanes.has(binding?.paneId) || agent.lifecycle === "dead");
    return { agent, binding, pane, dead, paneMissing: panes === null, title: pane?.title ?? "", memoKey: `${binding?.paneId} ${binding?.panePid}`, prior: priors.get(agent.agentId) ?? null };
  });
  const candidates = work
    .filter((item) => !item.dead && !item.paneMissing && item.pane && busyEvidence(item.title) === null)
    .sort((a, b) => (memo.get(a.memoKey)?.at ?? 0) - (memo.get(b.memoKey)?.at ?? 0));
  let captures = 0;
  for (const item of candidates) {
    const cached = memo.get(item.memoKey);
    if (cached && now - cached.at < memoMs) { item.tail = cached.tail; continue; }
    if (captures >= budget) continue;      // tail stays undefined -> null -> unknown, never idle
    captures += 1;
    item.tail = await capture(item.pane);
    memo.set(item.memoKey, { at: now, tail: item.tail });
  }
  for (const stale of [...memo.keys()]) if (now - (memo.get(stale)?.at ?? 0) > 10 * memoMs) memo.delete(stale);

  let activity = false;
  const agents = work.map((item) => {
    const verdict = classify({
      title: item.title,
      tail: item.tail ?? null,
      adapter: item.pane && adapters ? adapterForPane(adapters, item.pane) : null,
      dead: item.dead,
      paneMissing: item.paneMissing,
      prior: item.prior,
      now,
    });
    if (verdict.state !== item.prior?.state || verdict.edge) activity = true;
    // TM-130 owns delivery state and the standing mailbox owns held cross-repo mail. The census
    // does not compute either — a second source of truth for "did this land" is exactly the drift
    // this document exists to prevent. Fed in by the caller once TM-130 lands.
    const undeliveredMessages = item.agent.undeliveredMessages ?? [];
    const mailStuck = item.agent.mailStuck ?? false;
    return {
      agentId: item.agent.agentId,
      displayName: item.agent.displayName ?? null,
      title: item.agent.title ?? null,
      repoRole: item.agent.repoRole ?? null,
      runRole: item.agent.runRole ?? null,
      runId: item.agent.primaryRunId ?? null,
      state: verdict.state,
      reason: verdict.reason,
      edge: verdict.edge,
      since: verdict.since,
      durationMs: Math.max(0, now - Date.parse(verdict.since)),
      needsInputAt: verdict.needsInputAt,
      idleStreak: verdict.idleStreak,
      wasBusy: verdict.wasBusy,
      evidence: verdict.evidence,
      binding: item.binding,
      bindingLive: Boolean(item.pane && item.pane.alive !== false),
      sessionName: item.pane?.sessionName ?? item.prior?.sessionName ?? null,
      undeliveredMessages,
      mailStuck,
      // ONE derived boolean for the scheduler. Never re-derive dispatch from the precedence table
      // on the other side, or scheduler and supervisor drift on what "idle" means.
      dispatchable: verdict.state === "idle" && undeliveredMessages.length === 0 && Boolean(item.pane && item.pane.alive !== false),
    };
  });

  const document = {
    schemaVersion: CENSUS_SCHEMA_VERSION,
    repositoryKey: key,
    repoId: identity.id,
    at: new Date(now).toISOString(),
    staleAfterMs,
    stale: false,
    tickMs: Date.now() - started,
    captures,
    activity,
    agents,
  };
  if (input.write !== false) await writeJson(path, document);
  return document;
}

/**
 * Re-derive staleness at READ time and let it veto everything.
 *
 * A stale census is not old news, it is no news: the agent it calls idle has had a minute to start
 * working. So staleness rewrites every row to `unknown` and forces every `dispatchable` false,
 * rather than being a flag each consumer is trusted to remember to check.
 */
export function withStaleness(document, now = Date.now()) {
  if (!document) return null;
  const ageMs = now - Date.parse(document.at);
  const stale = !Number.isFinite(ageMs) || ageMs < 0 || ageMs > (document.staleAfterMs ?? DEFAULT_STALE_MS);
  return {
    ...document,
    ageMs: Number.isFinite(ageMs) ? ageMs : null,
    stale,
    agents: (document.agents ?? []).map((agent) => (stale
      ? { ...agent, state: "unknown", reason: "census is stale; nothing here has been observed recently", dispatchable: false }
      : agent)),
  };
}

/** The last census for this repository, with staleness applied. Null when none has been written. */
export async function readCensus(options = {}) {
  const { env = process.env, home = homedir(), consumer } = options;
  const identity = options.identity ?? (await canonicalRepoId(consumer));
  const document = await readJson(censusPath({ env, home, key: repoKey(identity.id) })).catch(() => null);
  return withStaleness(document, options.now ?? Date.now());
}

/** 2 s while something is moving, backing off to 15 s while nothing is. Snaps back on activity. */
export function nextIntervalMs(current, activity) {
  if (activity) return CENSUS_INTERVALS[0];
  const index = CENSUS_INTERVALS.indexOf(Number(current));
  return index === -1 ? CENSUS_INTERVALS[0] : CENSUS_INTERVALS[Math.min(index + 1, CENSUS_INTERVALS.length - 1)];
}

const GLYPH = { dead: "x", "quota-blocked": "⏳", attention: "!", working: "•", "needs-input": "◆", idle: "○", unknown: "?" };

function duration(ms) {
  const seconds = Math.round(Math.max(0, ms) / 1000);
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m${String(seconds % 60).padStart(2, "0")}s`;
  return `${Math.floor(seconds / 3600)}h${String(Math.floor((seconds % 3600) / 60)).padStart(2, "0")}m`;
}

/** One line per agent, for a person. The same document `--json` gives a scheduler. */
export function formatCensus(document) {
  if (!document) return "No census yet. Start the repository supervisor, or run `ao-topology census` again.";
  const lines = [];
  if (document.stale) lines.push(`! STALE - last observed ${duration(document.ageMs ?? 0)} ago; every agent reads as unknown and nothing is dispatchable.`);
  for (const agent of document.agents ?? []) {
    const name = agent.displayName && agent.displayName !== "Unenrolled agent" ? agent.displayName : agent.agentId;
    const flags = [agent.edge ? "edge" : null, agent.undeliveredMessages?.length ? `${agent.undeliveredMessages.length} undelivered` : null].filter(Boolean);
    lines.push(`${GLYPH[agent.state] ?? "?"} ${String(name).padEnd(24)} ${agent.state.padEnd(14)} ${duration(agent.durationMs).padStart(7)}  ${agent.reason}${flags.length ? ` [${flags.join(", ")}]` : ""}`);
  }
  if ((document.agents ?? []).length === 0) lines.push("(no agents observed in this repository)");
  lines.push(`- ${document.captures} capture(s), tick ${document.tickMs}ms, ${(document.agents ?? []).filter((a) => a.dispatchable).length} dispatchable`);
  return lines.join("\n");
}
