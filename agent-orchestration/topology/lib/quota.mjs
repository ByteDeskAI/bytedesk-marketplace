// Provider quota exhaustion, mid-run.
//
// THE GAP THIS CLOSES. `failureOnScreen` is consulted in exactly one place today: startup
// readiness (`launch.mjs`'s `evaluateScreen` / `waitReadySubscribed`), for the ~30 s an agent
// takes to come up. After that nobody looks at the screen for a failure line ever again — and the
// incident this module exists for happened HOURS in, when two agents hit
// `Error: [provider.auth_error] 403 You have reached your 5-hour usage limit` and were recovered
// only because a human noticed and authorised a Codex takeover by hand.
//
// WHAT IT DOES, AND WHAT IT DELIBERATELY DOES NOT. It writes an incident and it RESTARTS NOTHING.
// The supervisor this runs inside reconciles derived state only — it launches no agent, kills no
// session and sends no keys — and a quota incident is derived state: an observation with an audit
// trail. Applying a failover is `launch.mjs`'s `failoverAgent`, invoked deliberately, and that is
// where `failover.consent` is spent. Detection announces; taking over is a separate act.
//
// THE SIGNATURE IS NOT NEW. `"usage limit"` is already the first entry of
// `GENERIC_ADAPTER.failure_patterns` and the observed Kimi string survives `withoutPaths()`, so no
// provider JSON changes. `attention_patterns` is the wrong home and the ordering proves it:
// attention is checked FIRST because it means "a human must press a key here", and quota
// exhaustion is not answerable at the keyboard.
//
// NOT TO BE CONFUSED WITH THE CENSUS. TM-131 gave `attention_patterns` an optional
// `state: "quota-blocked"` so `census.mjs` can REPORT an out-of-quota pane as a distinct work
// state. That is the observation path: per-adapter, opt-in, and about scheduling — a quota-blocked
// agent is simply not `dispatchable`. This is the FAILOVER path: it reads the generic
// `failure_patterns` every adapter inherits, and its output is an incident an operator or a lead
// can act on. The two are complementary; neither reads the other's state, and an adapter with no
// quota-blocked attention entry is still watched here.
import { createHash, randomUUID } from "node:crypto";
import { readdir } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { adapterForPane, busyEvidence } from "./census.mjs";
import { loadConfig } from "./config.mjs";
import { subscriptionFormat, tmuxFailureTrigger } from "./launch.mjs";
import { readLeadRegistration } from "./lead.mjs";
import { withLock } from "./lockfile.mjs";
import { failureOnScreen } from "./providers.mjs";
import { canonicalRepoId, repoKey, stateRoot } from "./repoid.mjs";
import { sendStandingMessage } from "./standing-mailbox.mjs";
import * as defaultTmux from "./tmux.mjs";
import { invariant, nowIso, readJson, writeJson } from "./util.mjs";

/** What an operator has consented to in advance. `ask` is the default and it is the safe one. */
export const QUOTA_CONSENT = ["ask", "auto", "never"];
export const DEFAULT_CONSENT = "ask";

/** Defence 1: the second capture may not be taken sooner than this after the first match. */
export const QUOTA_RECHECK_MS = 2000;
/**
 * How long a suspicion that never confirms is carried before it is dropped and the subscription
 * re-armed. Bounded because a pane that keeps the words on screen while continuing to work — an
 * agent grepping this very file — pushes only ONCE, since tmux pushes on CHANGE. A suspicion
 * dropped without re-arming would therefore lose that pane's signal permanently.
 */
export const QUOTA_PENDING_MAX_MS = 5 * 60_000;
/** Tail lines per confirmation capture. Never the whole scrollback: this runs on a supervise tick. */
export const QUOTA_TAIL_LINES = 60;

/**
 * Which of the adapter's failure patterns mean QUOTA, as opposed to any other reason a candidate
 * cannot serve.
 *
 * This is a FILTER over `failure_patterns`, not a second list — "the signature stays in
 * failure_patterns" is satisfied by reading it from there. The filter exists because that list is
 * a STARTUP list, and startup gets away with things a supervisor cannot. It looks for 30 s at a
 * pane that has not run anything yet; this looks for hours at a pane running a developer's shell.
 * `command not found` and `no such file or directory` are ordinary output from a working agent
 * (and `no such file or directory` carries no "/", so `withoutPaths` does not blank it), while
 * `not logged in` and `invalid api key` are not fixed by changing provider anyway. Proposing a
 * takeover because an agent ran a failing `ls` would be the loudest false positive available, on
 * the one path where nobody is watching for 30 s but for a whole day.
 */
// NOTE the bare `429`. This regex is matched against the PATTERN STRING, not against a screen, and
// the adapter's entry is the seven literal characters `\b429\b`. Writing `\b429\b` here would
// need a word boundary before the "4", and the character before it in that string is "b" — so the
// quota-shaped entry an operator is most likely to hit on a rate-limited provider silently failed
// the filter and could never raise an incident. Caught by `topology-quota.test.mjs`, which asserts
// the filter against the real `GENERIC_ADAPTER.failure_patterns` rather than against a copy.
export const QUOTA_SIGNATURE = /usage limit|rate limit|quota|too many requests|429|capacity|overloaded/i;

/** Is this failure pattern one of the quota-shaped ones? Tested against the PATTERN, not a screen. */
export function isQuotaPattern(pattern) {
  return QUOTA_SIGNATURE.test(String(pattern ?? ""));
}

/**
 * `failover.consent`, resolved through the existing config layers (plugin defaults → global →
 * repo additions). An unrecognised value is REPORTED and treated as `ask`: refusing to supervise
 * because one config string is misspelled costs more than the strictness buys, and `ask` is the
 * branch that cannot do harm.
 */
export function consentFrom(config) {
  const raw = config?.failover?.consent;
  if (raw === undefined || raw === null) return { consent: DEFAULT_CONSENT, error: null };
  if (QUOTA_CONSENT.includes(raw)) return { consent: raw, error: null };
  return {
    consent: DEFAULT_CONSENT,
    error: `failover.consent must be one of ${QUOTA_CONSENT.join(", ")} (got ${JSON.stringify(raw)}); using ${DEFAULT_CONSENT}`,
  };
}

export function quotaRoot({ env = process.env, home = homedir() } = {}) {
  return join(stateRoot(env, home), "quota");
}
export function incidentPath({ env = process.env, home = homedir(), key, agentId }) {
  return join(quotaRoot({ env, home }), key, `${String(agentId).replace(/[^A-Za-z0-9._-]/g, "_")}.json`);
}

/** One subscription per pane, named after the pane so two agents never share a channel. */
export function subscriptionName(paneId) {
  return `ao-quota-${String(paneId).replace(/[^A-Za-z0-9]/g, "")}`;
}

/**
 * One pushed `subscriptionFormat` value → what the SERVER saw. Pure, so the whole event path is
 * testable with no tmux server at all.
 *
 * Field 0 (the ready pattern) is deliberately ignored: this path does not care whether the CLI
 * looks started, only whether a failure word appeared and whether the pane is still there.
 */
export function triggerVerdict(value) {
  const [, failLine, dead, deadStatus] = String(value ?? "").split("|");
  return {
    triggered: Number(failLine) > 0,
    dead: dead === "1",
    status: deadStatus === "" || deadStatus === undefined ? null : Number(deadStatus),
  };
}

/**
 * The cross-tick memory: attached control clients, armed subscriptions, undrained pushes, and
 * suspicions awaiting their second look. Owned by the supervisor's loop, handed in on every tick,
 * closed in its `finally`.
 */
export function createQuotaWatch() {
  return { clients: new Map(), subscribed: new Map(), hits: new Map(), pending: new Map(), close: closeQuotaWatch };
}
function closeQuotaWatch() {
  for (const entry of this.clients.values()) {
    try {
      entry.client.close();
    } catch {
      /* already gone */
    }
  }
  this.clients.clear();
  this.subscribed.clear();
}

/** A tail capture that says "I could not read it" as null, never as an empty screen. */
async function captureTail(pane, tmux = defaultTmux, lines = QUOTA_TAIL_LINES) {
  const result = await tmux.tmux(["capture-pane", "-p", "-t", pane.paneId, "-S", `-${lines}`], { tmuxServer: pane.serverKey, allowFailure: true });
  return result.code === 0 ? result.stdout : null;
}

const clientKey = (pane) => `${pane.serverKey ?? ""}\t${pane.sessionName ?? ""}`;

/**
 * Attach one control client per (server, session) and arm the failure trigger on each watched
 * pane. The server pushes when the subscribed value CHANGES, at most once a second, so a quiet
 * pane costs nothing at all — this is the productised form of the 82 ad-hoc `capture-pane` probes
 * that used to be the only way to ask this question.
 *
 * A refused control mode is not an error: that pane is simply not watched, and it is reported as
 * unwatched rather than silently downgraded. Polling every pane for hours is the cost this exists
 * to avoid, so there is deliberately no poll fallback here.
 */
async function armSubscriptions(watch, watchable, { ControlClientClass, maxClients, log }) {
  const armed = [];
  const unwatched = [];
  for (const item of watchable) {
    const key = clientKey(item.pane);
    let entry = watch.clients.get(key);
    if (!entry) {
      if (watch.clients.size >= maxClients) {
        unwatched.push({ agent: item.agentId, reason: `${watch.clients.size} tmux control clients already open (cap ${maxClients})` });
        continue;
      }
      const client = new ControlClientClass(item.pane.sessionName, { tmuxServer: item.pane.serverKey });
      const attached = await client.start().catch(() => false);
      if (!attached) {
        try {
          client.close();
        } catch {
          /* already gone */
        }
        unwatched.push({ agent: item.agentId, reason: "tmux control mode did not attach for this session" });
        continue;
      }
      // The listener only REMEMBERS. Confirming a hit needs a capture and the path-stripping
      // matcher, and doing that inside an event handler would run it off the tick that owns the
      // cadence, with no bound on how many run at once.
      client.on("subscription", (event) => {
        const paneId = watch.subscribed.get(event.name);
        if (!paneId || event.pane !== paneId) return;
        watch.hits.set(paneId, { value: event.value, at: Date.now() });
      });
      entry = { client, session: item.pane.sessionName, server: item.pane.serverKey };
      watch.clients.set(key, entry);
    }
    const name = subscriptionName(item.pane.paneId);
    if (watch.subscribed.get(name) === item.pane.paneId) {
      armed.push(name);
      continue;
    }
    watch.subscribed.set(name, item.pane.paneId);
    entry.client.subscribe(name, item.pane.paneId, subscriptionFormat(item.adapter));
    armed.push(name);
    log(`quota: armed ${name} on ${item.pane.sessionName} for ${item.agentId}`);
  }
  return { armed, unwatched };
}

/** Drop clients whose session left the roster, so a supervisor does not accumulate attachments. */
function reapClients(watch, watchable) {
  const liveClients = new Set(watchable.map((item) => clientKey(item.pane)));
  const livePanes = new Set(watchable.map((item) => item.pane.paneId));
  for (const [key, entry] of [...watch.clients]) {
    if (liveClients.has(key)) continue;
    try {
      entry.client.close();
    } catch {
      /* already gone */
    }
    watch.clients.delete(key);
  }
  for (const [name, paneId] of [...watch.subscribed]) {
    if (livePanes.has(paneId)) continue;
    watch.subscribed.delete(name);
    watch.pending.delete(paneId);
    watch.hits.delete(paneId);
  }
}

/**
 * DEFENCE 2, and it is NOT what the brief asked for. Read this before "fixing" it.
 *
 * The brief asks for "the pane must be dead OR the agent must fail a nonce probe". Taken
 * literally that is not a defence at all for most agents: `roles.mjs` reports `responsive: null`
 * for every non-singleton role, with the reason "this role has no readiness handshake; alive is
 * all that is proven". Only `lead` and `reviewer` carry the probe protocol in their prompts. A
 * worker, designer or image-gen agent therefore CANNOT answer a probe and so fails one
 * unconditionally — which would make the clause pass for every screen, including the exact false
 * positive it exists to reject.
 *
 * What actually discriminates is whether the pane is MAKING PROGRESS. An agent that greps this
 * file and prints `usage limit` is still working, and a working pane animates — the same evidence
 * `census.mjs` classifies `working` from, reused rather than re-derived. A provider that has cut
 * an agent off renders nothing.
 *
 * `probe` is the seam for the real handshake where one exists: an ANSWERED probe vetoes the
 * incident outright, and an unanswered one is positive evidence. An UNAVAILABLE one is neither,
 * and leaves the progress test to carry the decision.
 */
export async function confirmQuota({ adapter, pane, screen, probe = null, agentId = null }) {
  if (screen === null || screen === undefined) {
    return { confirmed: false, reason: "the pane could not be read, so nothing is confirmed" };
  }
  const pattern = failureOnScreen(adapter, screen);
  if (!pattern) return { confirmed: false, reason: "the failure word turned out to be a path, or has scrolled away" };
  if (!isQuotaPattern(pattern)) return { confirmed: false, reason: `pattern /${pattern}/ is not a quota signature`, pattern };

  if (!pane || pane.alive === false) return { confirmed: true, pattern, evidence: "pane-dead" };

  const answer = probe ? await probe({ agentId, pane }) : { available: false };
  if (answer?.available && answer.answered) {
    return { confirmed: false, reason: "the agent answered a nonce probe, so it is not out of quota", pattern, evidence: "probe-answered" };
  }
  if (answer?.available && !answer.answered) return { confirmed: true, pattern, evidence: "probe-unanswered" };

  const busy = busyEvidence(pane.title) ?? busyEvidence(screen);
  if (busy) {
    return { confirmed: false, reason: `the pane is still making progress (${busy}), so the words are something it printed`, pattern, evidence: "progressing" };
  }
  return { confirmed: true, pattern, evidence: "no-progress" };
}

const mintIncidentId = (identity, agentId, at) =>
  createHash("sha256").update(`quota:${identity.id}:${agentId}:${at}`).digest("hex").slice(0, 32);

/** The command that authorises the takeover. It is the whole operator value of an `ask`. */
export function approvalCommand({ incident, approver = "<you>" }) {
  if (!incident?.run_dir) return null;
  return `ao-topology failover --run ${incident.run_dir} --agent ${incident.agent_id} --incident ${incident.incident_id} --approved-by ${approver}`;
}

/**
 * What the lead is told.
 *
 * The three things that survive a failover get three SEPARATE sentences, because the middle one is
 * the one a team misreads: a re-bootstrapped agent has no memory of the conversation, and reads as
 * broken to anyone who does not know that. See `docs/quota-failover.md`.
 */
export function announcement(incident, consent) {
  const command = approvalCommand({ incident });
  const how = incident.evidence === "pane-dead"
    ? "the pane is dead"
    : incident.evidence === "probe-unanswered"
      ? "it did not answer a nonce probe"
      : "it is not rendering any progress";
  const lines = [
    `PROVIDER QUOTA SUSPECTED: ${incident.agent_id} on ${incident.provider}`,
    "",
    `Matched /${incident.pattern}/ on its pane, still present ${incident.recheck_ms}ms later, and ${how}.`,
    `Incident ${incident.incident_id} (${incident.detected_at}). NOTHING has been restarted.`,
    "",
  ];
  if (consent === "auto") {
    lines.push(
      `failover.consent is "auto": the operator authorised this in advance, in writing, in config, so no`,
      `human turn is needed — and THIS MESSAGE is the announcement that rule requires, because the rule`,
      `forbids SILENT substitution, not substitution.`,
    );
  } else {
    lines.push(`failover.consent is "ask", so nothing may take this pane over until a human authorises it.`);
  }
  lines.push(
    "",
    command
      ? `To apply:\n  ${command}`
      : `This agent is not in a run roster, so \`failover\` does not apply to it — a standing agent's provider is changed by reassigning its role (\`ao-topology role reassign\`).`,
    "",
    "What a failover would and would not keep:",
    "  the WORK survives — same pane, same worktree, same branch; the new provider is told to orient (git status, git log, read its PROMPT_FILE).",
    "  the CONVERSATION does NOT — a different CLI has a different memory. That is WHY unanswered messages are re-delivered. A cold agent is not a broken one.",
    "  the CLAIM survives via tm's dispatch heartbeat, with a ceiling: claimTtlMinutes defaults to 240 (four hours) against a five-hour quota window. A repo that relies on quota failover raises it above its provider's longest window.",
  );
  return lines.join("\n");
}

/** The current incident for one agent, or null. A resolved incident is history, not a hit. */
export async function readIncident({ agentId, identity = null, consumer = null, env = process.env, home = homedir() }) {
  const id = identity ?? (await canonicalRepoId(consumer));
  return readJson(incidentPath({ env, home, key: repoKey(id.id), agentId })).catch(() => null);
}

/** Every incident recorded for this repository, newest first. */
export async function listIncidents({ identity = null, consumer = null, env = process.env, home = homedir() }) {
  const id = identity ?? (await canonicalRepoId(consumer));
  const dir = join(quotaRoot({ env, home }), repoKey(id.id));
  const rows = [];
  for (const name of (await readdir(dir).catch(() => [])).filter((n) => n.endsWith(".json"))) {
    const record = await readJson(join(dir, name)).catch(() => null);
    if (record) rows.push(record);
  }
  return rows.sort((a, b) => String(b.detected_at).localeCompare(String(a.detected_at)));
}

/**
 * Close an incident out. Called by the apply path once a takeover has happened, and available to
 * an operator who has decided a suspicion was wrong.
 */
export async function resolveIncident({ agentId, identity = null, consumer = null, state, by = null, note = null, env = process.env, home = homedir() }) {
  invariant(["applied", "declined", "closed"].includes(state), "TOPOLOGY_QUOTA_STATE", "An incident resolves to applied, declined or closed.");
  const id = identity ?? (await canonicalRepoId(consumer));
  const path = incidentPath({ env, home, key: repoKey(id.id), agentId });
  return withLock(`${path}.lock`, async () => {
    const record = await readJson(path).catch(() => null);
    invariant(record, "TOPOLOGY_QUOTA_NO_INCIDENT", `No quota incident is recorded for ${agentId} in this repository.`);
    const next = { ...record, state, resolved_at: nowIso(), resolved_by: by, resolution_note: note };
    await writeJson(path, next);
    return next;
  });
}

/**
 * One supervise tick's worth of quota watching.
 *
 * Returns `{ watching, armed, unwatched, pending, incidents, dismissed, consent }`. It restarts
 * nothing, and every branch that could throw is the CALLER's to absorb — the supervisor treats
 * this the way it treats the census and the slot reconcile: an observer may not take the loop down.
 */
export async function quotaTick(options = {}, input = {}) {
  const { consumer, env = process.env, home = homedir(), pluginRoot = null } = options;
  const identity = input.identity ?? (await canonicalRepoId(consumer));
  const key = repoKey(identity.id);
  const now = input.now ?? Date.now();
  const log = input.log ?? (() => {});
  const tmux = input.tmux ?? defaultTmux;
  const capture = input.capture ?? ((pane) => captureTail(pane, tmux));
  const watch = input.watch ?? createQuotaWatch();
  const panes = input.panes ?? null;
  const adapters = input.adapters ?? null;
  const recheckMs = input.recheckMs ?? QUOTA_RECHECK_MS;
  const maxPendingMs = input.maxPendingMs ?? QUOTA_PENDING_MAX_MS;
  const maxClients = Number(input.maxClients ?? env.AO_QUOTA_MAX_CLIENTS ?? 8);
  const runDirOf = input.runDirOf ?? ((agentId) => (input.runDirs ?? {})[agentId] ?? null);

  const loaded = input.config !== undefined ? { config: input.config } : await loadConfig({ consumer, home, env, pluginRoot });
  const { consent, error: consentError } = consentFrom(loaded.config);
  const idle = (reason) => ({ watching: 0, armed: [], unwatched: [], pending: [], incidents: [], dismissed: [], consent, consentError, reason });

  // A listing we could not take is not an empty repository, and no adapters means no measured
  // patterns to compile: either way there is nothing this tick can honestly say.
  if (!Array.isArray(panes)) return idle("no tmux listing this tick");
  if (!adapters) return idle("no provider adapters loaded");

  const paneOf = new Map(panes.map((pane) => [pane.paneId, pane]));
  const watchable = [];
  for (const agent of input.agents ?? []) {
    const binding = agent.session ?? null;
    const pane = binding?.paneId ? paneOf.get(binding.paneId) ?? null : null;
    if (!pane || pane.alive === false) continue;
    // No adapter means no MEASURED patterns for whatever is running in there, and inventing some
    // is how a healthy agent loses its provider. Not watched, rather than guessed at.
    const adapter = adapterForPane(adapters, pane);
    if (!adapter || !tmuxFailureTrigger(adapter)) continue;
    watchable.push({ agentId: agent.agentId, pane, adapter });
  }
  reapClients(watch, watchable);
  const { armed, unwatched } = await armSubscriptions(watch, watchable, {
    ControlClientClass: input.ControlClientClass ?? tmux.ControlClient,
    maxClients,
    log,
  });

  const byPane = new Map(watchable.map((item) => [item.pane.paneId, item]));
  const dismissed = [];

  // ── Stage 1: drain the server's pushes into suspicions, one capture each. ────────────────────
  for (const [paneId, hit] of [...watch.hits]) {
    watch.hits.delete(paneId);
    const item = byPane.get(paneId);
    if (!item) continue;
    if (!triggerVerdict(hit.value).triggered) {
      watch.pending.delete(paneId);
      continue;
    }
    if (watch.pending.has(paneId)) continue;
    const screen = await capture(item.pane);
    const first = await confirmQuota({ adapter: item.adapter, pane: item.pane, screen, agentId: item.agentId, probe: input.probe ?? null });
    if (!first.pattern || !isQuotaPattern(first.pattern)) {
      dismissed.push({ agent: item.agentId, stage: "first-look", reason: first.reason });
      continue;
    }
    // A first match is a SUSPICION, never an incident. Defence 1 is that the words are still there
    // on a second capture at least `recheckMs` later: quoted text scrolls, while a dead provider's
    // error is the last thing on the screen and stays there.
    watch.pending.set(paneId, { agentId: item.agentId, provider: item.adapter.id, pattern: first.pattern, firstMatchAt: now });
    log(`quota: suspected ${item.agentId} (/${first.pattern}/); second look in ${recheckMs}ms`);
  }

  // ── Stage 2: the second look, and the other two defences. ───────────────────────────────────
  const incidents = [];
  for (const [paneId, suspicion] of [...watch.pending]) {
    const item = byPane.get(paneId);
    if (!item) {
      watch.pending.delete(paneId);
      continue;
    }
    if (now - suspicion.firstMatchAt < recheckMs) continue;
    const screen = await capture(item.pane);
    const verdict = await confirmQuota({ adapter: item.adapter, pane: item.pane, screen, agentId: item.agentId, probe: input.probe ?? null });
    if (!verdict.confirmed) {
      // A suspicion is only dropped once its window closes, and dropping it RE-ARMS the
      // subscription: tmux pushed once, on the change, so an armed-and-forgotten subscription
      // would never speak about this pane again.
      if (now - suspicion.firstMatchAt < maxPendingMs) continue;
      watch.pending.delete(paneId);
      watch.subscribed.delete(subscriptionName(paneId));
      dismissed.push({ agent: item.agentId, stage: "second-look", reason: verdict.reason, waited_ms: now - suspicion.firstMatchAt });
      continue;
    }
    watch.pending.delete(paneId);
    incidents.push(await openIncident({
      identity, key, env, home, consumer, consent,
      agentId: item.agentId, provider: item.adapter.id, pane: item.pane,
      pattern: verdict.pattern, evidence: verdict.evidence, runDir: runDirOf(item.agentId),
      at: now, deliver: input.deliver ?? sendStandingMessage, lead: input.lead ?? readLeadRegistration, log,
    }));
  }

  return {
    watching: watchable.length,
    armed,
    unwatched,
    consent,
    consentError,
    pending: [...watch.pending.values()].map((row) => ({ agent: row.agentId, pattern: row.pattern, since_ms: now - row.firstMatchAt })),
    incidents,
    dismissed,
  };
}

/**
 * Write the incident and announce it. Idempotent per agent: an OPEN incident is not replaced by a
 * second sighting of the same outage, because that record is what a takeover asserts against and
 * rewriting it would move the ground under an approval already in flight.
 */
async function openIncident({ identity, key, env, home, consumer, consent, agentId, provider, pane, pattern, evidence, runDir, at, deliver, lead, log }) {
  const path = incidentPath({ env, home, key, agentId });
  return withLock(`${path}.lock`, async () => {
    const prior = await readJson(path).catch(() => null);
    if (prior && prior.state === "open") return { ...prior, deduplicated: true };
    const record = {
      version: 1,
      incident_id: mintIncidentId(identity, agentId, at),
      repo_id: identity.id,
      agent_id: agentId,
      provider,
      state: "open",
      consent,
      pattern,
      evidence,
      session: pane.sessionName ?? null,
      pane: pane.paneId ?? null,
      run_dir: runDir ?? null,
      detected_at: new Date(at).toISOString(),
      recheck_ms: QUOTA_RECHECK_MS,
      announced: null,
      resolved_at: null,
      resolved_by: null,
    };
    // Written BEFORE the announcement: a message naming an incident that does not exist yet would
    // send the lead to a command that refuses.
    await writeJson(path, record);
    if (consent === "never") {
      log(`quota: incident ${record.incident_id} for ${agentId} recorded; failover.consent is "never", so nothing was announced.`);
      return record;
    }
    const registration = await lead({ consumer, env, home }).catch(() => null);
    const leadId = registration?.record?.agent_id ?? null;
    if (!leadId) {
      const next = { ...record, announced: { status: "skipped", reason: "no lead is registered for this repository" } };
      await writeJson(path, next);
      return next;
    }
    // Derived from the incident, so a retried tick delivers nothing twice — same discipline as
    // slot grants and the idle-dispatch assignment pointer.
    const messageId = createHash("sha256").update(`quota-incident:${record.incident_id}`).digest("hex").slice(0, 32);
    const mail = await deliver(
      {
        id: messageId,
        consumer,
        to: leadId,
        subject: `provider quota suspected: ${agentId}`,
        body: announcement(record, consent),
        provenance: { source: "ao-topology supervise (quota watch)" },
      },
      { env, home },
    ).catch((error) => ({ status: "failed", reason: error?.code ?? String(error) }));
    const next = { ...record, announced: { status: mail?.status ?? "failed", to: leadId, message_id: messageId, reason: mail?.reason ?? null } };
    await writeJson(path, next);
    return next;
  });
}

/**
 * The gate the APPLY path spends. `ask` needs a human named in `approvedBy` — the one unavoidable
 * human turn in the whole design, and it matches the observed recovery, where a person authorised
 * a Codex takeover. `auto` is the operator's advance consent, given in writing, in config, and it
 * still ANNOUNCES: the rule forbids SILENT substitution, not substitution, and someone who wrote
 * `auto` consented before the fact rather than not at all. `never` refuses whatever anyone types.
 */
export function assertConsent({ consent, approvedBy, agentId }) {
  invariant(
    consent !== "never",
    "TOPOLOGY_FAILOVER_FORBIDDEN",
    `failover.consent is "never" in this repository's config, so ${agentId} may not be handed to another provider. Change the config if that is no longer the policy.`,
  );
  invariant(
    consent === "auto" || (typeof approvedBy === "string" && approvedBy.trim()),
    "TOPOLOGY_FAILOVER_UNAPPROVED",
    `failover.consent is "${consent}", so taking ${agentId}'s pane needs --approved-by <who authorised it>.`,
  );
  return { consent, approved_by: consent === "auto" ? "config:failover.consent=auto" : approvedBy.trim() };
}

/**
 * Assert an incident is OPEN and describes THIS agent on THIS provider, then return it.
 *
 * Called by `failoverAgent` when it is given an incident id: an approval is only meaningful
 * against the observation it was granted for, and a stale id would authorise a takeover nobody
 * ever looked at.
 */
export async function assertIncident({ incidentId, agentId, provider = null, consumer, identity = null, env = process.env, home = homedir() }) {
  const record = await readIncident({ agentId, identity, consumer, env, home });
  invariant(record, "TOPOLOGY_QUOTA_NO_INCIDENT", `No quota incident is recorded for ${agentId} in this repository, so ${incidentId} cannot be the reason for a failover.`);
  invariant(
    record.incident_id === incidentId,
    "TOPOLOGY_QUOTA_INCIDENT_MISMATCH",
    `${agentId}'s current quota incident is ${record.incident_id}, not ${incidentId}. Read it with \`ao-topology quota status\` before approving one.`,
  );
  invariant(record.state === "open", "TOPOLOGY_QUOTA_INCIDENT_CLOSED", `Incident ${incidentId} is ${record.state}, not open.`);
  invariant(
    !provider || record.provider === provider,
    "TOPOLOGY_QUOTA_INCIDENT_PROVIDER",
    `Incident ${incidentId} was raised against ${record.provider}, but ${agentId} is running ${provider} now — the observation no longer describes this agent.`,
  );
  return record;
}

/**
 * The whole gate the apply path spends, in one call, so `launch.mjs` needs one dynamic import and
 * no knowledge of how consent is stored.
 *
 * Resolves `failover.consent` through the config layers, asserts the incident is open and
 * describes THIS agent on THIS provider, and asserts the approval. Returns
 * `{ incident, approval, consent }`.
 *
 * Called only when an incident id is supplied: a hand-run `ao-topology failover --agent X` with no
 * incident is an operator at a keyboard doing something deliberate, and gating that on a
 * quota observation nobody raised would break the manual path this feature is built on top of.
 */
export async function authorizeFailover({ consumer, agentId, provider = null, incidentId, approvedBy = null, env = process.env, home = homedir(), pluginRoot = null, config = undefined }) {
  const loaded = config !== undefined ? { config } : await loadConfig({ consumer, home, env, pluginRoot });
  const { consent, error } = consentFrom(loaded.config);
  const incident = await assertIncident({ incidentId, agentId, provider, consumer, env, home });
  const approval = assertConsent({ consent, approvedBy, agentId });
  return { incident, approval, consent, consentError: error };
}

/**
 * Say out loud that a provider was substituted. This is what makes `auto` legitimate: the rule
 * forbids SILENT substitution, so an automatic takeover that nobody is told about is the thing
 * that is actually forbidden, and this message is the difference.
 *
 * Best effort by contract — a failover that has already happened must not be reported as failed
 * because a mailbox could not be written.
 */
export async function announceFailoverApplied({ consumer, incident, approval, from, to, env = process.env, home = homedir(), deliver = sendStandingMessage, lead = readLeadRegistration }) {
  const registration = await lead({ consumer, env, home }).catch(() => null);
  const leadId = registration?.record?.agent_id ?? null;
  if (!leadId) return { status: "skipped", reason: "no lead is registered for this repository" };
  const id = createHash("sha256").update(`quota-failover:${incident.incident_id}:${to}`).digest("hex").slice(0, 32);
  const body = [
    `PROVIDER SUBSTITUTED: ${incident.agent_id} moved from ${from ?? incident.provider} to ${to}.`,
    "",
    `Incident ${incident.incident_id}, authorised by ${approval.approved_by}.`,
    "",
    "The WORK survived: same pane, same worktree, same branch, and the new provider was told to orient.",
    "The CONVERSATION did NOT: this is a different CLI with a different memory, which is why its unanswered",
    "messages are being re-delivered. It will look cold. It is not broken — do not re-brief it as if it were.",
    "The CLAIM survived on tm's dispatch heartbeat; claimTtlMinutes defaults to 240 minutes against a",
    "five-hour quota window, so raise it if this repository relies on quota failover.",
  ].join("\n");
  return deliver({ id, consumer, to: leadId, subject: `provider substituted: ${incident.agent_id}`, body,
    provenance: { source: "ao-topology failover" } }, { env, home }).catch((error) => ({ status: "failed", reason: error?.code ?? String(error) }));
}

/** A nonce for a probe implementation that wants one. Exported so callers do not invent their own. */
export function probeNonce() {
  return randomUUID();
}
