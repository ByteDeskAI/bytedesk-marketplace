// Delivery is a state machine, not a fire-and-forget bell.
//
// The message of record is always the inbox file, written and journalled before anything here runs.
// This module is only about the DOORBELL — and about being able to say, afterwards, which of the
// six things that can happen to a doorbell actually happened.
//
// TM-127 disabled the bell outright, on the correct observation that "pane liveness proves neither
// an empty composer nor a safe tool-input state". Every send then reported
// `{ rang: false, notification: 'durable-pending' }`, so an idle agent was never woken. The fix is
// not to re-enable the guess; it is to OBSERVE each transition:
//
//   held              nothing was typed: composer not empty, an attention/failure line, a stale
//                     binding, or the pane is gone. Also the honest answer when the composer could
//                     not be read at all after typing — never optimistically "submitted".
//   not-typed         `deliverPointer`'s occurrence count did not rise. TM-126: the TUI had no key
//                     handler yet and the keystrokes vanished with no error anywhere.
//   typed-unsubmitted count rose AND the composer is still non-empty. The TM-121 family: text sits
//                     in the composer, the agent looks idle, nothing retries.
//   submitted         count rose AND the composer is empty again — whatever was in it left.
//   engaged           `pane.log` grew past the offset recorded at submit, within AO_ENGAGE_MS.
//   submitted-inert   submitted, and `pane.log` did NOT grow in that window. This is TM-122 — an
//                     agent that acknowledged its bootstrap and then stopped — caught for a stat().
//   processed         a reply file with content exists. Owned by the mailbox, not by this module.
//   escalated         terminal. Journalled as message.undelivered and surfaced; never silent.
//
// The discrimination needs exactly ONE new piece of per-provider knowledge, because `deliverPointer`
// already proves RECEIVED (it counts occurrences of the pointer in `captureAll`) and what is missing
// is whether the composer is empty NOW — if it is, whatever was in it left. That is
// `adapter.composer`, measured per provider. Absent means absent: an adapter without one is
// `ring_capability: "unsupported"`, holds its mail and reports. It never rings blind.
//
// Two signals, each used only for what it can prove. Conflating them gives a confident wrong answer:
//   * `pane.log` growth proves the agent REACTED. It cannot prove the composer is empty — the
//     composer is a redrawn screen region and the log holds escape sequences, not a rendered frame.
//   * The tmux subscription proves the composer is EMPTY. It cannot prove engagement.
import { stat } from "node:fs/promises";
import { join } from "node:path";
import { withLock } from "./lockfile.mjs";
import { agentDir, appendJournal, loadRun, saveRun } from "./mailbox.mjs";
import { attentionOnScreen, failureOnScreen } from "./providers.mjs";
import * as defaultTmux from "./tmux.mjs";
import { sleep } from "./util.mjs";

/** Send the submit key alone at most this many times before falling back to waiting. */
export const MAX_RESUBMITS = 2;
/** Re-type the whole pointer at most this many times before escalating. */
export const MAX_RETYPES = 2;
export const RING_WINDOW_MS = Number(process.env.AO_RING_WINDOW_MS ?? 60_000);
export const ENGAGE_MS = Number(process.env.AO_ENGAGE_MS ?? 60_000);
export const MAX_CLIENTS = Number(process.env.AO_BELL_MAX_CLIENTS ?? 8);
export const BELL_POLL_MS = Number(process.env.AO_BELL_POLL_MS ?? 1000);

/**
 * The six-tuple that says a pane is still the SAME pane. `failoverAgent` already refuses to act
 * without it, and for the same reason: tmux reuses `%N` after a pane dies, so a ring that trusts a
 * recorded pane id alone can type a task assignment into a stranger's live session.
 */
export const BINDING_KEYS = ["serverKey", "serverPid", "sessionId", "sessionCreated", "paneId", "panePid"];

export function bindingMatches(observed, binding) {
  if (!binding || !observed) return false;
  return BINDING_KEYS.every((key) => observed[key] === binding[key]);
}

// ── Pure classification ───────────────────────────────────────────────────────────────────────
// Everything in this section is a function of observations already taken. No tmux, no clock, no
// filesystem — so the whole state machine is testable with a stub client and no tmux server.

/** Does this adapter know, by measurement, what its own empty composer looks like? */
export function ringCapability(adapter) {
  return adapter?.composer?.empty_tmux_pattern ? "supported" : "unsupported";
}

/**
 * The subscription format for the bell: composer-empty line, failure/attention line, deadness, exit
 * status. Deliberately the same four-field shape as `subscriptionFormat`, so `decideBell` and
 * `decideFromSubscription` read alike — but slot 0 is a DIFFERENT question, which is the whole point
 * of `composer` being a separate declaration from `ready`.
 */
export function composerFormat(adapter, failureTrigger) {
  return [
    adapter?.composer?.empty_tmux_pattern ? `#{C/r:${adapter.composer.empty_tmux_pattern}}` : "0",
    failureTrigger ? `#{C/r:${failureTrigger}}` : "0",
    "#{pane_dead}",
    "#{pane_dead_status}",
  ].join("|");
}

/**
 * Is it safe to ring? All of: pane alive, the binding still matches, the composer is empty, and no
 * attention or failure line is on screen (TM-111: the folder-trust modal draws "❯ No, exit", and
 * Enter there means exit).
 *
 * ONE DELIBERATE DIFFERENCE FROM `decideFromSubscription`, and it must not be "unified" away.
 * That function discounts `promptLines` because at launch the shell's own prompt is still on screen
 * after `clearAndWaitForShell`, so a match at or below it is the prompt rather than the CLI. Mid-run
 * the shell has been `exec`'d away — the pane's process IS the agent — so there is no prompt to
 * discount and the threshold is `> 0`. Using `> promptLines` here rejects every safe pane, because a
 * composer that renders on line 1 of a short pane is a perfectly good composer.
 *
 * WHAT "SAFE" DOES NOT MEAN: it does not mean the agent is idle. Measured 2026-09-09 on live codex
 * pane %448, which was mid-turn (`◦ Working (50s • esc to interrupt)`) and STILL rendered its empty
 * composer placeholder. An empty composer proves the INPUT BOX is free, not that the model stopped
 * — so a ring can land mid-turn, where codex takes it as a steer. `submitted` therefore means "the
 * pointer went in", never "the agent put down what it was doing". Idleness is a different question
 * with different evidence; do not read one as the other.
 */
export function decideBell(value, { bindingOk = true } = {}) {
  const [composerLine, failLine, dead, deadStatus] = String(value).split("|");
  if (dead === "1") {
    const status = deadStatus === "" || deadStatus === undefined ? null : Number(deadStatus);
    return { safe: false, dead: true, reason: status === null ? "pane exited" : `pane exited with status ${status}`, exit_status: status };
  }
  if (!bindingOk) return { safe: false, stale: true, reason: "the pane's six-tuple binding no longer matches; tmux may have reused this %N for someone else's session" };
  if (Number(failLine) > 0) return { safe: false, check: "failure", reason: "the pane shows an attention or failure line" };
  if (Number(composerLine) > 0) return { safe: true, reason: "composer empty (server-side)" };
  return { safe: false, reason: "the composer is not empty" };
}

/**
 * Is it safe to press the SUBMIT KEY at a pane whose composer already holds our pointer?
 *
 * Everything `decideBell` requires except the composer being empty — and dropping that one is the
 * whole point, not a relaxation. `typed-unsubmitted` IS the non-empty-composer state, so gating the
 * resubmit rung on an empty composer makes that rung unreachable: the pane can never satisfy the
 * condition that would let us fix it. (This was the first version of this module, and the unit test
 * for the ladder is what caught it — in production every stuck draft would have skipped straight
 * from `retype` to `stuck-in-composer` without one Enter ever being sent.)
 *
 * What is NOT dropped: pane alive, binding intact, and no attention or failure line. TM-111 is
 * exactly a keystroke sent at the wrong screen — the folder-trust modal draws "❯ No, exit" — and
 * pressing Enter there is if anything worse than typing there.
 */
export function decideResubmit(value, { bindingOk = true } = {}) {
  const [, failLine, dead, deadStatus] = String(value).split("|");
  if (dead === "1") {
    const status = deadStatus === "" || deadStatus === undefined ? null : Number(deadStatus);
    return { safe: false, dead: true, reason: status === null ? "pane exited" : `pane exited with status ${status}`, exit_status: status };
  }
  if (!bindingOk) return { safe: false, stale: true, reason: "the pane's six-tuple binding no longer matches; tmux may have reused this %N for someone else's session" };
  if (Number(failLine) > 0) return { safe: false, check: "failure", reason: "the pane shows an attention or failure line" };
  return { safe: true, reason: "pane alive, binding intact, no attention or failure line" };
}

/**
 * Composer emptiness from a captured screen, for the poll path and for post-typing verification.
 *
 * The tmux-side twin of this (`composer.empty_tmux_pattern`, evaluated as `#{C/r:…}`) is
 * load-bearing in a way that is not obvious and that nobody would think to re-derive: **`#{C/r:}`
 * searches the pane's VISIBLE content only, never its scrollback.** Measured on tmux 3.4 against a
 * pane with `history_size` 26 — a marker that had scrolled off-screen answered 0, a string on the
 * visible screen answered 14. That is what stops an old prompt line, scrolled away minutes ago,
 * from answering "composer empty" forever and turning every ring into a false `submitted`.
 *
 * This JS side has no such protection — `captureAll` reads the whole scrollback — which is why it
 * is used only to classify a landing we have just caused, never to decide a pane is safe to type
 * into. That decision belongs to `decideBell` and the server-side pattern.
 */
export function composerEmptyOnScreen(adapter, screen) {
  if (!adapter?.composer?.empty_pattern) return null;
  if (screen === null || screen === undefined) return null;
  return new RegExp(adapter.composer.empty_pattern, "m").test(String(screen));
}

/**
 * What happened to the pointer we just typed.
 *
 * `countRose` is `deliverPointer`'s evidence that this send landed on the pane at all — it counts
 * occurrences rather than looking for one, so a previous attempt's echo in the scrollback cannot
 * confirm a delivery that never happened.
 *
 * The `unknown` row is the one that matters. If the composer could not be read, the honest state is
 * `held` — retried through the cheapest rung that is safe to repeat, and never reported as
 * `submitted`, because a wrong "submitted" is a message nobody will ever retry.
 */
export function classifyLanding({ countRose, composerEmpty }) {
  if (!countRose) return "not-typed";
  if (composerEmpty === true) return "submitted";
  if (composerEmpty === false) return "typed-unsubmitted";
  return "held";
}

/**
 * The next rung of the ladder: cheapest first, every rung idempotent.
 *
 *   resubmit   send the submit key ALONE, after the settle. NEVER re-type — re-typing appends a
 *              second copy of the pointer to the draft already sitting in the composer, and the
 *              agent then reads a doubled message. Max MAX_RESUBMITS, then wait for a safe moment.
 *   retype     the full `deliverPointer` again. Safe because its occurrence count makes a stale
 *              echo unusable as proof: a false negative costs a duplicate pointer, silent loss
 *              costs the run.
 *   wait-safe  the pane went busy mid-ring. The file is already written; waiting is free.
 *   escalate   the window is spent. Stop typing, journal, tell a human which message is stuck.
 *
 * Nothing here re-sends the message of record — `nextSequence(runDir, idempotencyKey, fingerprint)`
 * is already idempotent, and this ladder never calls it.
 *
 * Named `nextDeliveryRung`, not `nextRung`, because `supervision.mjs` already exports a `nextRung`
 * and it is a DIFFERENT ladder — an index into `SLEEP_LADDER_MS` for the reconcile loop's backoff.
 * Nothing can import both (there is no `export *` anywhere in this directory), so the two could
 * have coexisted; a reader grepping one verb and finding two ladders could not. This one is the
 * retry ladder for a single message's doorbell.
 */
export function nextDeliveryRung({ state, safe = true, resubmits = 0, retypes = 0, exhausted = false }) {
  if (state === "submitted" || state === "engaged" || state === "processed") return null;
  if (exhausted) return "escalate";
  if (!safe) return "wait-safe";
  if (state === "typed-unsubmitted") return resubmits < MAX_RESUBMITS ? "resubmit" : "wait-safe";
  if (state === "not-typed" || state === "held") return retypes < MAX_RETYPES ? "retype" : "escalate";
  return "escalate";
}

/**
 * The `notification` string for a terminal ring outcome. `durable-pending` keeps its current
 * meaning EXACTLY — the file is in the mailbox and no bell was rung — which is why an adapter with
 * no measured composer reports it rather than a new string.
 */
export function notificationFor({ state, capability, everSafe, skipped }) {
  if (capability === "unsupported") return "durable-pending";
  if (skipped) return "ring-skipped";
  if (state === "submitted" || state === "engaged") return "submitted";
  if (state === "submitted-inert") return "submitted-inert";
  if (state === "stale-binding") return "stale-binding";
  if (state === "typed-unsubmitted") return "stuck-in-composer";
  if (!everSafe) return "no-safe-bell";
  return "ring-failed";
}

/** exit 3 is for "the pane was judged safe and the pointer still did not land" — nothing else. */
export function isUndelivered(delivery) {
  return delivery?.escalated === true && ["stuck-in-composer", "ring-failed"].includes(delivery.notification);
}

// ── Control-client registry ───────────────────────────────────────────────────────────────────
// `ControlClient` is per SESSION, so a fan-out `send --to a,b,c` into one run costs ONE tmux client,
// not three. Refcounted, capped, and it falls back to a bounded poll rather than failing when
// control mode is refused — the launcher already handles that case the same way.

const clients = new Map();

export async function acquireClient(session, { ControlClientClass = defaultTmux.ControlClient, max = MAX_CLIENTS, log = () => {} } = {}) {
  const existing = clients.get(session);
  if (existing) {
    existing.refs += 1;
    return existing.client;
  }
  if (clients.size >= max) {
    log(`bell: ${clients.size} tmux control clients already open (cap ${max}); the bell fell back to polling this pane.`);
    return null;
  }
  const client = new ControlClientClass(session);
  const attached = await client.start().catch(() => false);
  if (!attached) {
    client.close();
    log("tmux control mode did not attach; the bell fell back to polling this pane.");
    return null;
  }
  clients.set(session, { client, refs: 1 });
  return client;
}

export function releaseClient(session) {
  const entry = clients.get(session);
  if (!entry) return;
  entry.refs -= 1;
  if (entry.refs <= 0) {
    entry.client.close();
    clients.delete(session);
  }
}

export function closeAllClients() {
  for (const entry of clients.values()) entry.client.close();
  clients.clear();
}

// ── Observation ───────────────────────────────────────────────────────────────────────────────

/** One direct look at the pane, in the same four-field shape the subscription pushes. */
async function lookAtPane(pane, format, tmux) {
  const result = await tmux.tmux(["display-message", "-p", "-t", pane, format], { allowFailure: true });
  return result.code === 0 ? result.stdout.split("\n")[0] : null;
}

/** Is this still the same pane incarnation? A `%N` tmux has reused is a stranger's live session. */
async function stillBound(pane, binding, tmux) {
  if (!binding) return true;
  const observed = (await tmux.listServerPanes().catch(() => [])).find((item) => item.paneId === pane);
  return bindingMatches(observed, binding);
}

/**
 * Confirm a server-side failure hit in THIS process: only here do we have the path-stripping
 * matcher, and without it a run directory called `.../quota-work/` reads as a provider outage.
 */
async function confirmFailure(adapter, pane, tmux, verdict) {
  if (verdict.check !== "failure") return verdict;
  const screen = await tmux.capture(pane, 60).catch(() => "");
  const attention = attentionOnScreen(adapter, screen);
  if (attention) return { safe: false, terminal: true, attention: true, reason: attention.message };
  const failure = failureOnScreen(adapter, screen);
  if (failure) return { safe: false, terminal: true, reason: `the pane matched failure pattern /${failure}/` };
  return { safe: false, reason: "a failure word on the pane turned out to be a path; still waiting" };
}

/**
 * One look, for the resubmit rung: everything `whenSafe` proves except the empty composer. It does
 * not wait, because what it is checking cannot improve by waiting — see `decideResubmit`.
 */
export async function checkResubmitSafe({ pane, adapter, format, binding, tmux = defaultTmux }) {
  const value = await lookAtPane(pane, format, tmux);
  // A look we could not take is not permission. Refuse rather than press a key blind.
  if (value === null) return { safe: false, reason: "the pane could not be read, so pressing the submit key is unproven" };
  return confirmFailure(adapter, pane, tmux, decideResubmit(value, { bindingOk: await stillBound(pane, binding, tmux) }));
}

/**
 * Wait until the pane is safe to ring, or the window closes. Push when we have a control client,
 * bounded poll when we do not.
 *
 * A confirmed attention or failure line ends the wait rather than continuing it: those screens are
 * answered by a person, not by waiting, and burning the whole window on one would only delay the
 * report that says so.
 */
export async function whenSafe({ pane, adapter, client, subName, format, binding, timeoutMs = RING_WINDOW_MS, tmux = defaultTmux, pollMs = BELL_POLL_MS }) {
  const started = Date.now();
  const bindingOk = () => stillBound(pane, binding, tmux);
  const confirm = (verdict) => confirmFailure(adapter, pane, tmux, verdict);

  const settleWith = (verdict) => ({ ...verdict, waited_ms: Date.now() - started });

  if (!client) {
    for (;;) {
      const value = await lookAtPane(pane, format, tmux);
      // A look we could not take says nothing either way — keep waiting rather than deciding.
      if (value !== null) {
        const verdict = await confirm(decideBell(value, { bindingOk: await bindingOk() }));
        if (verdict.safe || verdict.terminal || verdict.dead || verdict.stale) return settleWith(verdict);
      }
      if (Date.now() - started >= timeoutMs) return settleWith({ safe: false, reason: `no safe moment to ring within ${timeoutMs}ms` });
      await sleep(pollMs);
    }
  }

  return new Promise((settle) => {
    let done = false;
    const finish = (verdict) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      client.off("subscription", onPush);
      client.unsubscribe(subName);
      settle(settleWith(verdict));
    };
    const timer = setTimeout(async () => {
      // Before giving up, LOOK. The subscription is a push channel: when the server delivers
      // nothing, "never safe" is a statement about the pane this process has never actually read.
      const value = await lookAtPane(pane, format, tmux).catch(() => null);
      if (value !== null) {
        const verdict = await confirm(decideBell(value, { bindingOk: await bindingOk() }));
        if (verdict.safe) return finish({ ...verdict, reason: `${verdict.reason} (seen only on the final look; the subscription delivered nothing)` });
      }
      finish({ safe: false, reason: `no safe moment to ring within ${timeoutMs}ms` });
    }, timeoutMs);
    const onPush = async (event) => {
      if (done || event.name !== subName || event.pane !== pane) return;
      const verdict = await confirm(decideBell(event.value, { bindingOk: await bindingOk() }));
      if (verdict.safe || verdict.terminal || verdict.dead || verdict.stale) finish(verdict);
    };
    client.on("subscription", onPush);
    client.subscribe(subName, pane, format);
  });
}

/** Byte size of the agent's pane.log, or null when there is no log to measure. */
export async function paneLogOffset(dir) {
  return stat(join(dir, "pane.log")).then((info) => info.size, () => null);
}

/**
 * Did the agent react? `pipe-pane -o` is attached at pane creation, so every byte the pane renders
 * is already appended to `agents/<id>/pane.log`: growth past the offset recorded at submit costs one
 * stat() and zero model turns.
 *
 * `unknown` is load-bearing. If the log is missing or was attached late there is no baseline, and
 * reporting `submitted-inert` from a missing file would fire the detector on healthy agents — the
 * fastest possible way to get it ignored.
 */
export async function observeEngagement({ dir, offset, at = Date.now(), engageMs = ENGAGE_MS, now = Date.now() }) {
  if (offset === null || offset === undefined) return { engaged: null, reason: "no pane.log baseline; engagement is unknown, not inert" };
  const size = await paneLogOffset(dir);
  if (size === null) return { engaged: null, reason: "pane.log disappeared; engagement is unknown, not inert" };
  if (size > offset) return { engaged: true, reason: `pane.log grew ${size - offset} bytes after submit` };
  if (now - at < engageMs) return { engaged: null, reason: `pane.log has not grown yet, and the ${engageMs}ms window is still open` };
  return { engaged: false, reason: `pane.log did not grow within ${engageMs}ms of submit` };
}

// ── Ring bookkeeping ──────────────────────────────────────────────────────────────────────────
// Kept in run.json under ring_state[messageId][agentId], written through the SAME
// `.mailbox-sequence.lock` every other run.json mutation uses, so a fan-out cannot lose a write.

export async function readRingState(runDir, messageId, agentId) {
  const run = await loadRun(runDir).catch(() => null);
  return run?.ring_state?.[messageId]?.[agentId] ?? null;
}

export async function writeRingState(runDir, messageId, agentId, record) {
  return withLock(join(runDir, ".mailbox-sequence.lock"), async () => {
    const run = await loadRun(runDir);
    run.ring_state ??= {};
    run.ring_state[messageId] ??= {};
    run.ring_state[messageId][agentId] = record;
    await saveRun(runDir, run);
    return record;
  });
}

/**
 * Every message whose bell reached a terminal failure, or which submitted and then produced nothing.
 * This is what `status` renders as `! UNDELIVERED` and what the census reports, so a scheduler does
 * not hand new work to an agent that is holding a message nobody drove.
 */
export async function undeliveredReport(runDir, { engageMs = ENGAGE_MS, now = Date.now() } = {}) {
  const run = await loadRun(runDir).catch(() => null);
  const out = [];
  for (const [messageId, byAgent] of Object.entries(run?.ring_state ?? {})) {
    for (const [agentId, record] of Object.entries(byAgent ?? {})) {
      if (isUndelivered(record)) {
        out.push({ message: messageId, agent: agentId, state: record.state, notification: record.notification, reason: record.reason });
        continue;
      }
      if (record?.state !== "submitted" || record.engaged !== null || record.engage_offset === undefined) continue;
      const seen = await observeEngagement({ dir: agentDir(runDir, agentId), offset: record.engage_offset, at: Date.parse(record.submitted_at ?? 0) || 0, engageMs, now });
      if (seen.engaged === false) {
        out.push({ message: messageId, agent: agentId, state: "submitted-inert", notification: "submitted-inert", reason: seen.reason });
      }
    }
  }
  return out;
}

// ── The driver ────────────────────────────────────────────────────────────────────────────────

function heldDelivery(fields) {
  return {
    state: "held",
    ring_capability: "supported",
    pane: null,
    waited_ms: 0,
    typed: false,
    composer_empty_after: null,
    rungs: [],
    attempts: 0,
    reason: "",
    engaged: null,
    escalated: false,
    ...fields,
  };
}

/**
 * Ring one agent for one message, and report what was actually observed.
 *
 * Returns `{ agent, rang, notification, delivery }`. `delivered[]` stays ADDITIVE: `rang` remains
 * the boolean discriminator it has always been, `notification` widens, and everything new lives
 * under `delivery`.
 *
 * `deps` exists so the whole thing is testable with no tmux server: the unsupported-adapter path in
 * particular must not touch tmux at all, which is asserted with a stub that throws on any use.
 */
export async function ringMessage({
  runDir,
  agentId,
  agent,
  adapter,
  pointer,
  messageId,
  session,
  noRing = false,
  windowMs = RING_WINDOW_MS,
  engageMs = ENGAGE_MS,
  log = () => {},
  tmux = defaultTmux,
  deliverPointer,
  tmuxFailureTrigger,
  now = () => Date.now(),
}) {
  const capability = ringCapability(adapter);
  const finish = async (delivery) => {
    const record = { ...delivery, message: messageId, agent: agentId, at: new Date(now()).toISOString() };
    if (runDir && messageId) await writeRingState(runDir, messageId, agentId, record).catch(() => {});
    if (delivery.escalated) {
      await appendJournal(runDir, {
        type: "message.undelivered", id: messageId, agent: agentId,
        state: delivery.state, notification: delivery.notification, reason: delivery.reason,
      }).catch(() => {});
    }
    return { agent: agentId, rang: delivery.state === "submitted" || delivery.state === "engaged", notification: delivery.notification, delivery };
  };

  // Absent means absent. An adapter with no measured composer holds and reports; it never rings
  // blind, and it never touches tmux to find that out.
  if (capability === "unsupported") {
    return finish(heldDelivery({
      ring_capability: "unsupported",
      pane: agent?.pane ?? null,
      notification: notificationFor({ state: "held", capability }),
      reason: `adapter ${adapter?.id ?? "unknown"} declares no measured composer, so no ring can be proven safe; the message is in the durable mailbox.`,
    }));
  }

  if (noRing) {
    return finish(heldDelivery({
      pane: agent?.pane ?? null,
      state: "held",
      notification: notificationFor({ state: "held", capability, skipped: true }),
      reason: "--no-ring: the caller asked for the durable mailbox only.",
    }));
  }

  // Idempotent by (message, agent): a second send of the same message never types a second pointer.
  const prior = await readRingState(runDir, messageId, agentId);
  if (prior && (prior.state === "submitted" || prior.state === "engaged")) {
    return { agent: agentId, rang: true, notification: "ring-skipped", delivery: { ...prior, notification: "ring-skipped" } };
  }

  const pane = agent?.pane ?? null;
  if (!pane) {
    return finish(heldDelivery({
      notification: notificationFor({ state: "held", capability, everSafe: false }),
      reason: "the run records no pane for this agent.",
    }));
  }

  const format = composerFormat(adapter, tmuxFailureTrigger(adapter));
  const client = session ? await acquireClient(session, { log }) : null;
  const started = now();
  let waited = 0;
  let typed = false;
  let composerEmptyAfter = null;
  let state = "held";
  let attempts = 0;
  let resubmits = 0;
  let retypes = 0;
  let everSafe = false;
  let reason = "";
  let submittedAt = null;
  let engageOffset = null;
  const rungs = [];
  const dir = agentDir(runDir, agentId);

  try {
    for (;;) {
      // Decide the rung FIRST, then gate for that rung. The other order is what made `resubmit`
      // unreachable: it gated every rung on an empty composer, and `typed-unsubmitted` — the only
      // state that asks for a resubmit — is by definition a composer that is not empty.
      const rung = attempts === 0 ? "retype" : nextDeliveryRung({ state, safe: true, resubmits, retypes });
      if (rung === null) break;

      const terminal = (fields) => finish(heldDelivery({
        pane, waited_ms: waited, rungs, attempts, typed, composer_empty_after: composerEmptyAfter, ...fields,
      }));
      const refused = (gate, finalState) => gate.stale
        ? terminal({ state: "held", notification: "stale-binding", reason: gate.reason })
        // Never typed at all: the message is durable and a human is told which pane would not open.
        // Typed already and now unsafe: report the last landing we actually observed.
        : terminal({
            state: finalState,
            notification: notificationFor({ state: finalState, capability, everSafe }),
            reason: gate.reason,
            escalated: typed && finalState !== "submitted",
          });

      if (rung === "escalate") {
        return terminal({
          state,
          notification: notificationFor({ state, capability, everSafe }),
          reason: reason || `the ladder was exhausted in state ${state}`,
          escalated: true,
        });
      }

      if (rung === "wait-safe") {
        // The resubmits are spent and the draft is still sitting there. The file is already written,
        // so waiting costs nothing — and what we are waiting for is the composer to EMPTY, which is
        // the same condition `whenSafe` tests. If it empties, the draft left: that is `submitted`,
        // observed rather than assumed, and there is no further rung to run.
        const gate = await whenSafe({ pane, adapter, client, subName: `ao-bell-${agentId}`, format, binding: agent?.binding ?? null, timeoutMs: Math.max(0, windowMs - (now() - started)), tmux });
        waited += gate.waited_ms ?? 0;
        if (!gate.safe) return refused(gate, typed ? state : "held");
        composerEmptyAfter = true;
        state = "submitted";
        submittedAt = new Date(now()).toISOString();
        engageOffset = await paneLogOffset(dir);
        break;
      }

      if (rung === "retype") {
        // Never type into a full composer, a modal, or a pane that is no longer ours.
        const gate = await whenSafe({ pane, adapter, client, subName: `ao-bell-${agentId}`, format, binding: agent?.binding ?? null, timeoutMs: Math.max(0, windowMs - (now() - started)), tmux });
        waited += gate.waited_ms ?? 0;
        if (!gate.safe) return refused(gate, typed ? state : "held");
        everSafe = true;
        rungs.push(rung);
        attempts += 1;
        // The first delivery is not a retry; only the ones after it count against the cap.
        if (attempts > 1) retypes += 1;
        const landed = await deliverPointer(pane, adapter, pointer, { attempts: 1 });
        typed = typed || landed.delivered;
        if (!landed.delivered) {
          state = "not-typed";
          reason = "the pointer was typed and the pane's occurrence count did not rise; the TUI had no key handler";
          if (retypes >= MAX_RETYPES) {
            return terminal({ state, notification: notificationFor({ state, capability, everSafe }), reason, escalated: true });
          }
          continue;
        }
      } else {
        // resubmit: the submit key ALONE, after the settle. Re-typing here would append a second
        // copy of the pointer to the draft already in the composer. Gated on everything except the
        // composer being empty — see `decideResubmit`.
        const gate = await checkResubmitSafe({ pane, adapter, format, binding: agent?.binding ?? null, tmux });
        if (!gate.safe) return refused(gate, typed ? state : "held");
        everSafe = true;
        rungs.push(rung);
        attempts += 1;
        resubmits += 1;
        if (defaultTmux.SUBMIT_SETTLE_MS > 0) await sleep(defaultTmux.SUBMIT_SETTLE_MS);
        for (const key of adapter.submit_keys ?? ["Enter"]) await tmux.sendKeys(pane, [key]);
      }

      // Observe, do not assume. The composer is read AFTER the send settles, and a capture we could
      // not take is `null` — which classifies as `held`, never as `submitted`.
      await sleep(defaultTmux.SUBMIT_SETTLE_MS);
      const screen = await tmux.captureAll(pane).catch(() => null);
      composerEmptyAfter = composerEmptyOnScreen(adapter, screen);
      state = classifyLanding({ countRose: true, composerEmpty: composerEmptyAfter });
      if (state === "submitted") {
        // Offset recorded HERE rather than before typing: our own keystrokes echo into pane.log, so
        // a baseline taken earlier would count them as the agent reacting.
        submittedAt = new Date(now()).toISOString();
        engageOffset = await paneLogOffset(dir);
        break;
      }
      if (state === "typed-unsubmitted") reason = "the pointer landed in the composer and was not submitted";
      if (state === "held") reason = "the pointer landed but the composer could not be read, so submission is unproven";
      if (now() - started >= windowMs) {
        return terminal({
          state,
          notification: notificationFor({ state, capability, everSafe }),
          reason: `${reason}; the ring window of ${windowMs}ms closed`,
          escalated: true,
        });
      }
    }
  } finally {
    if (session && client) releaseClient(session);
  }

  // Engagement is not waited on here — `send` returning is not the place to block for a minute.
  // The offset and the submit time are recorded, and `undeliveredReport` turns them into
  // `submitted-inert` for whoever looks next (status, census, supervisor).
  const engagement = await observeEngagement({ dir, offset: engageOffset, at: Date.parse(submittedAt ?? 0) || now(), engageMs, now: now() });
  return finish({
    state: "submitted",
    ring_capability: capability,
    pane,
    waited_ms: waited,
    typed: true,
    composer_empty_after: composerEmptyAfter,
    rungs,
    attempts,
    reason: "the pointer was typed and the composer is empty again",
    engaged: engagement.engaged,
    engage_offset: engageOffset,
    submitted_at: submittedAt,
    escalated: false,
    notification: notificationFor({ state: "submitted", capability, everSafe }),
  });
}
