# Changelog

## [Unreleased]

### Added

- **Provider quota failover, mid-run (TM-135, EP-018).** `topology/lib/quota.mjs`, called from the
  supervise tick, closes a gap that cost two agents a working day: `failureOnScreen` was consulted
  only during the ~30 s of startup readiness, so once an agent was working nobody looked at its
  screen again — and the incident this closes happened hours in, with
  `403 You have reached your 5-hour usage limit` on a pane, recovered only because a human
  authorised a Codex takeover by hand.
  - **No provider JSON changed.** The signature is already in `failure_patterns` (`"usage limit"`
    is the first entry of `GENERIC_ADAPTER.failure_patterns`, and it survives `withoutPaths`).
    `attention_patterns` is the wrong home and the ordering proves it: attention is checked first
    because it means "a human must press a key here", and quota exhaustion is not answerable at the
    keyboard. Distinct from TM-131's `state: "quota-blocked"` census entry, which is the
    *observation* path (scheduling); this is the *failover* path.
  - **Only the quota-shaped subset acts.** `QUOTA_SIGNATURE` filters `failure_patterns` down to the
    quota entries. The full list is a STARTUP list — `command not found` and
    `no such file or directory` are ordinary output from a working agent's shell, and a supervisor
    watching for hours would propose a provider takeover for a failed `ls`.
  - **The server pushes.** One tmux control-mode client per agent session, `tmuxFailureTrigger`
    compiled into the subscribed format, so a quiet pane costs zero tmux calls and a capture is
    taken only when the trigger fires. Capped by `AO_QUOTA_MAX_CLIENTS` (default 8); panes past the
    cap are reported `unwatched`, never silently polled instead.
  - **Detection writes an incident and RESTARTS NOTHING.** The supervisor's "reconciles derived
    state only" rule is intact; applying a failover is a separate `ao-topology failover` call.
  - **`failover.consent` ∈ `ask` (default) | `auto` | `never`**, through the existing config
    layers. `ask` rings the lead with the approval command and is the one unavoidable human turn.
    `auto` applies AND ANNOUNCES — the rule forbids *silent* substitution, not substitution, and
    someone who sets `auto` consented in advance, in writing, in config; the reasoning is written
    into `config.defaults.json` itself so nobody re-litigates it. `never` refuses every takeover.
  - **Three false-positive defences, all required**, because an agent working on this feature will
    put the signature on its own screen: the match must still be present on a second capture ≥2 s
    later; the pane must be dead or the agent must not be making progress; and `ask` is the default
    so a false positive costs one message, not one provider.
  - **`failoverAgent` gains `{incidentId, approvedBy}`** and asserts the incident is open and names
    this agent and this provider before anything is respawned. TM-132's slot re-stamp is unchanged
    and still runs. New `ao-topology quota status|resolve`, and `docs/quota-failover.md` documents
    the three things that survive a failover separately — the work does, the conversation does NOT
    (which is why unanswered messages are re-delivered), and the claim does via tm's dispatch
    heartbeat with the named ceiling that `claimTtlMinutes` defaults to 240 against a five-hour
    quota window.

- **Idle-dispatch arbitration (TM-135, EP-018).** `management.mjs` gains `assignTaskToAgent`,
  `assignmentResult` and `releaseAssignment`, and the management record grows an `assignee`;
  `ao-topology manage assign|assignment|release` exposes them. The idle read and the assignment
  write happen inside ONE critical section under a repo-wide `assignment.lock` — the census is a
  hint, the record is the authority, and checking idle in the scheduler while writing the binding
  here is precisely how one pane ends up interleaving two tasks.

- **Broadcast addressing (TM-133, EP-018).** `topology/lib/addressing.mjs` adds four complete
  audiences to `--to`, unioned by the comma it already means: `@run` (this run's roster minus the
  sender minus the orchestrator), `@repo` (the enrolled standing agents of the destination
  repository), `@role:<role>` (both scopes), and `@idle` (whatever the census calls dispatchable).
  An `@`-prefixed token is the only new syntax — every existing form (agent id, collective fan-out
  id, `"Full Name"`) still goes through the unchanged `expandFanout` and produces byte-identical
  output. There is deliberately no intersection grammar.
  - **One expansion point.** `sendMessage` calls `expandAddresses` before the per-recipient loop,
    and `forwardMessageToWorkflow` routes back through `sendMessage`, so a forwarding agent cannot
    bypass admission by control flow rather than by convention. The CLI never expands.
  - **Admission is repeated, not widened.** Expansion yields concrete ids before the
    external/standing branch, so a broadcast is N ordinary sends each individually admitted.
    One new invariant closes the interesting attack: any `@` token with `external === true` is
    refused (`TOPOLOGY_BROADCAST_EXTERNAL`). An outsider still reaches the lead exactly as before.
    Cross-repo broadcast is therefore never held on a remote lead's readiness.
  - **The trap.** A standing lead or reviewer is normally *not* in `run.agents`, so `expandAddresses`
    returns `{id, delivery}` and the per-recipient branch is `external || delivery === 'standing'` —
    the envelope path is chosen per recipient. Without it `@repo` throws `TOPOLOGY_UNKNOWN_AGENT`
    for exactly the agents the feature exists to reach.
  - **Bounded by refusal.** `MAX_BROADCAST = 24` is separate from `MAX_FANOUT = 8` because it prices
    one inbox file plus one pointer, not a tmux session. Past it the send is refused naming the
    resolved count and the limit — never truncated; `--max-recipients` raises it.
  - `@repo` reads `collectPresenceAgents` **in-process** as a directory, not authority (every
    candidate is still validated by `routeMessage` and `known.has`), so the frozen Presence v1
    fixtures are untouched. `@idle` **refuses** when the census is missing or stale rather than
    degrading to "everyone". The reply barrier needs no new state: `pendingReplies`/`waitForReplies`
    resolve through the same function, so `wait --from @run` works (expanding live) and
    `wait --message <id>` barriers over exactly `run.message_deliveries[id]`.
- **Presence v1 header extension: contract, fixtures, countersignature (TM-136, EP-018).** The
  gateway terminal header needs slot queue, unread mailbox depth, agent state and current task per
  pane, and frozen Presence v1 carries none of them. `topology/PRESENCE-HEADER-ADDENDUM.md` specifies
  five optional agent keys — `activity`, `mailboxDepth`, `task`, `roleName`, `slots` — and one
  optional envelope key, `slotQueues`, **all additive: `schemaVersion` stays `1` and
  `PRESENCE-CONTRACT.md` is not edited.**
  - `lifecycle` keeps its frozen five values and its frozen meaning as a *session* lifecycle. The
    richer work state rides on the new `activity` key, whose vocabulary is the **seven** census
    states, `unknown` included.
  - Three §5 narrowings, each a documented judgement rather than a mechanical consequence:
    `mailboxDepth` drops `queueDepth`'s `messages` (the ids embed a stage slug close enough to a
    subject); `activity` is a state label and never the census `reason`/`evidence` derived from
    captured terminal text; `slots`/`slotQueues` omit the operator-prose `reason`. `task` is an id
    gated by `^[A-Z]+-[0-9]+$`, **omitted rather than coerced**.
  - New fixtures at `topology/fixtures/presence-v1-header/`. The frozen directory is untouched, and
    the acceptance test is that the **frozen `validate_presence.py`, unmodified, passes every
    extended fixture** — with `n01-repo-role-designer.json` proving it still goes red for a
    `repoRole` outside the frozen set, which is the evidence that opening a closed vocabulary is
    `schemaVersion: 2` and not additive. Wired into the suite as
    `tests/unit/topology-presence-header.test.mjs`, not asserted in prose.
  - `topology/HEADER-EXTENSION-COUNTERSIGNATURE-REQUEST.md` is the request to the gateway
    coordinator. No producer code emitting the new keys merges before it is countersigned.

- **Liveness census (TM-131, EP-018).** `topology/lib/census.mjs` and the repo-scoped
  `ao-topology census [--json] [--watch]` answer what every agent in a repository is *doing*:
  `dead > quota-blocked > attention > working > needs-input > idle > unknown`, in that precedence.
  Presence v1 is untouched — its `LIFE` set is a session lifecycle, not a work state, and the
  census writes its own document at `<stateRoot>/census/<repoKey>.json`.
  - Busy detection is the Unicode Braille Patterns **range** U+2800–U+28FF in the pane title or the
    captured tail, plus a short measured marker list — not a per-CLI spinner table.
  - `needs-input` is **edge-triggered exactly once**, when a post-busy idle streak first reaches two
    polls; it then falls back to `idle` with `needsInputAt` retained. A pane never observed working
    never produces it.
  - `unknown` is never silently `idle`: a failed capture, an exhausted capture budget and a failed
    `list-panes` are all reported as unknown.
  - `--json` serves a human and a scheduler from one document; the scheduler reads `binding` and the
    derived `dispatchable`, and a **stale census makes nothing dispatchable**.
  - Cost: reuses the supervisor's single `list-panes -a`, decides most panes from the pane title
    alone, captures only inconclusive panes with `-S -20`, caps captures at
    `AO_CENSUS_CAPTURE_BUDGET` (default 8) per tick oldest-observation-first, and memoizes by
    `(paneId, panePid)` so a respawn invalidates.
- **The census rides the supervisor's L3 tick (TM-131).** `superviseRepository` takes one census
  per tick — **including the cheap ticks**, since putting it inside the `AO_RECONCILE_MIN_MS`-gated
  body would peg it to the 10 s floor and the 2 s rung would buy nothing. On a reconciling tick it
  reuses the `list-panes -a` that `collectPresenceAgents` just took (by wrapping its injectable
  `listPanesFn`); on a cheap tick it takes one of its own against exactly the servers the roster's
  bindings name. Each tick's report gains a `census` block (`at`, `tick_ms`, `captures`, per-state
  counts, `dispatchable`) so `supervisionStatus` and `doctor` see it for free.
  - **The census cannot pin the sleep ladder.** `census.activity` means the world *moved*, never
    that we looked: a pane still `working` is the steady state and contributes nothing, and neither
    does a transition into or out of `unknown`, which past the capture budget is the budget
    rotating rather than news. A quiet repository still walks 2 s → 5 s → 15 s and stays there.
  - The loop **tells** the census its cadence rather than the census owning one: `intervalMs` is
    recorded in the document as a hint, and `staleAfterMs` is bound to the **slowest** rung (45 s)
    so a document never reads stale merely because the loop backed off. A one-shot with no loop
    behind it falls back to the slowest rung, not the fastest.
- `listServerPanes` carries `pane_title` — one extra tab-separated column on a call the supervisor
  already makes, which decides "is this agent working" for every pane on the server at zero extra
  tmux calls.
- **Delivery is a state machine, not a fire-and-forget bell** (TM-130). New `topology/lib/delivery.mjs`
  observes each transition instead of assuming it: `held` / `not-typed` / `typed-unsubmitted` /
  `submitted` / `engaged` / `submitted-inert` / `escalated`. Classification (`classifyLanding`,
  `nextDeliveryRung`, `decideBell`, `decideResubmit`) is pure and the I/O is separate, so the whole
  ladder is testable with a stub client and no tmux server. The retry ladder is cheapest-rung-first and idempotent: a stuck
  draft is recovered by sending the submit key **alone** (never re-typed — re-typing appends a second
  copy to the draft), a never-typed pointer goes back through `deliverPointer`, and nothing re-sends
  the message of record. Each rung is gated for what that rung actually does: typing requires an
  empty composer, pressing the submit key requires everything except that — `typed-unsubmitted` IS a
  non-empty composer, so a shared gate would have made the only rung that can fix a stuck draft
  unreachable. Ring bookkeeping lives in `run.json` under `ring_state[messageId][agentId]`,
  written through the existing `.mailbox-sequence.lock`.
- **`providers/*.json` gain a measured `composer` block** (`empty_tmux_pattern`, `empty_pattern`,
  required `note`), validated by the newly extracted `assertTmuxPattern` in
  `topology/lib/providers.mjs`. Absent means absent: an adapter with no measured composer is
  `ring_capability: "unsupported"`, holds its mail and reports — it never rings blind, and it never
  defaults to `ready.tmux_pattern`. Shipped for claude, codex and kimi; grok, gemini, copilot and
  generic are deliberately left without one.
- Engagement without a model turn: `pipe-pane -o` is already attached at pane creation, so
  `observeEngagement` reads `agents/<id>/pane.log` growth past the offset recorded at submit. No
  growth in `AO_ENGAGE_MS` is `submitted-inert` — TM-122 caught for the price of a `stat()`. A
  missing or late-attached log reports **unknown**, never inert.
- **The doorbell is wired into `send`** (TM-130). `ringMessage` now drives every local recipient,
  the child-workflow branch rings the child conductor in the CHILD session, and `delivered[]` stays
  additive — `rang` is still the boolean discriminator and everything new lives under `delivery`.
  `notification` widens to `submitted`, `no-safe-bell`, `ring-skipped`, `stuck-in-composer`,
  `ring-failed`, `stale-binding` and `submitted-inert`; **`durable-pending` keeps its meaning
  exactly** — the file is in the mailbox and no bell was rung, which is what an adapter with no
  measured composer still reports.
- **`--no-ring` is implemented.** It had sat in `USAGE`, in `tests/live/two-projects.sh` and in
  `tests/contract/topology-tmux.test.mjs` since `send` was written, and the body never read it.
- **`ack --run --agent --message [--note]`** — an optional receipt in the journal. Nothing in the
  protocol requires it and no state depends on it: engagement is a `pane.log` byte offset.
- **Escalation is never silent.** `send` journals `message.undelivered` and exits **3** — only when
  the pane was judged safe and the pointer still did not land, never for `held`, an unsupported
  adapter, `--no-ring`, or a degraded supervisor. `status` gains an `undelivered` field and an
  `! UNDELIVERED` banner modelled on `! STALLED`.
- **Named serial slots with a mechanical queue (TM-132, EP-018).** `topology/lib/slots.mjs` and
  `ao-topology slot request|release|status|grant` replace the conductor's hand-rolled
  SERIAL SLOT REQUEST / GRANTED / RELEASED heredocs. Records live at
  `<stateRoot>/slots/<repoKey>/<name>.json`, keyed by the git common directory, so every linked
  worktree shares one `cutover` slot. `integration`, `cutover` and `deploy-safe` are names, not code.
  - `withLock` is the wrong holder and the right mutex: it serialises every mutation, and **the
    record is the holder**. Slot lifetime and lock lifetime are unrelated.
  - Fairness is a monotonic decimal-string **ticket** allocated under the lock — FIFO by ticket,
    never by timestamp, because clocks tie and skew. A repeated request by the same agent is
    idempotent (same ticket, same position, and no write at all).
  - **The grant is mechanical.** `reconcile()` is pure and idempotent, runs from `slot request`,
    `slot status` and the supervise tick, and grants the head of the queue unconditionally when the
    holder is null. `slot release` only clears the holder. A handover costs **zero model turns on
    both sides**. `slot grant --to` is a lead-only override that records the tickets it jumped, and
    its help says so.
  - Liveness is the **tmux six-tuple**, not a pid, so reclamation works identically on macOS, and
    the same test applies to queue entries as to the holder — otherwise a dead ticket starves the
    queue forever while `status` reports success. A grant records the binding it was checked
    against. `failoverAgent` re-stamps that binding after a respawn, or every quota failover would
    silently forfeit the agent's slot.
  - **Age never reclaims.** `status` reports `held_for_ms` and flags a hold past its declared
    `--expect`; the remedy for a long hold is a human. **Reclamation requires proof of absence** —
    an unreadable `list-panes` reconciles nothing, because a tmux hiccup must never hand one
    cutover slot to two agents.
  - Release requires proof the holder is asking, with two accepted proofs because `AO_AGENT_TOKEN`
    is minted per agent *per run* and a standing lead has none: a run agent proves its token digest
    with `timingSafeEqual` as `recordReply` does; a standing agent proves `AO_AGENT_ID` +
    `AO_CONSUMER` + the exact pane as `acknowledgeEnrollment` does. Neither →
    `TOPOLOGY_SLOT_NOT_HOLDER` with the record byte-identical.
  - The supervise tick reuses the pane listing the census already took, so a mechanical grant costs
    zero extra tmux calls, and rings the new holder through the existing standing mailbox with a
    grant-derived id so a retried tick delivers nothing twice.

### Changed

- **An out-of-quota Kimi is now an actionable *attention*, not a bare failure — this changes launch
  behaviour, not only the census.** `attention_patterns` entries gain an optional `state`
  (`attention` by default, or `quota-blocked`), and `providers/kimi.json` declares one anchored on
  the fragment `reached your \d+-hour usage limit` — observed live as
  `Error: [provider.auth_error] 403 You've reached your 5-hour usage limit.` and deliberately
  anchored on the fragment, because `[provider.auth_error]`'s brackets and colon would be dropped
  by `tmuxFailureTrigger` and the pattern would then never fire on the subscription path at all.
  `attentionOnScreen` is checked **before** `failureOnScreen` in both `evaluateScreen` and the
  subscription path, and the generic `failure_patterns` list already contains `usage limit`, so
  until now an out-of-quota Kimi was a plain failure that triggered failover. It is now an
  attention with an operator message. That is the right ordering — "wait for the window" is not
  "this provider is down" — but a run that relied on failover to move off an exhausted Kimi will
  hold instead.

### Fixed
- **The late-ack fix was unreachable from its two real callers** (TM-161, EP-018). TM-161 made the
  probe outlive its wait — and on a live pane the lead still read `unresponsive` three asks in a row,
  because neither caller ever used the default it raised.
  - `cli.mjs` passed `Number(flags['ack-timeout'] || 5000)` on **every** `lead` call, so
    `DEFAULT_ACK_TIMEOUT_MS` — raised to 30s and made env-configurable precisely because a probe has
    to fit a model turn — was never consulted, and the documented `AO_LEAD_ACK_TIMEOUT_MS` did
    nothing. The probe's `expires_at` was five seconds away, so a busy lead's next-boundary ack was
    refused as STALE rather than accepted as LATE. Measured: the probe file appeared and vanished
    within ~5s against a nominal 150s window. The flag is now passed only when given.
  - `startup.mjs` passed a hardcoded `1000`. That path is a fast readiness SCREEN on a SessionStart
    hook for every Claude session on the machine, so it cannot wait for a model turn — but a
    one-second probe is worse than none: nobody can answer inside it, it burns a ring, and its expiry
    then defeats the late-ack path from a caller that never intended to wait. `ackTimeoutMs: 0` now
    means **cached proof only, mint nothing**; a screen asks, it does not interrogate, and "not
    proven" is an honest answer for it to give.
  - **Verified live, which is the only place this was ever visible:** three consecutive
    `unresponsive` before, `responsive` on the first ask after, and a delivered message reporting
    `submitted` with the reply in the outbox. The unit suite passed throughout both states, because
    it exercises the library directly and never goes through either caller's argument construction.
- **A late acknowledgement is no longer thrown away** (TM-161, EP-018). `defaultResponsive` deleted
  the probe when its wait gave up, so an agent that was mid-turn when the ring landed — the NORMAL
  case for a working agent, and the one the file-only design existed to serve — read the probe at its
  next boundary, ran `ao-topology lead ack` correctly and promptly, and met
  `TOPOLOGY_LEAD_PROBE_UNKNOWN`. Responsiveness was provable only by an agent that happened to be
  idle at the instant of the ring.
  - The probe now outlives the wait, up to its own `expires_at`, and the next readiness check
    accepts an ack it finds there rather than minting a new nonce. **`expires_at` is still the line**
    — accepting a LATE ack never becomes accepting a STALE one — and an expired probe is swept.
  - Found by executing the committed EP-018 demo runbook, which is what that runbook is for. The
    lead diagnosed it on its own pane: *"they expired inside a single tool call … This message is
    the proof of liveness the probes were asking for."* It was right.
  - The reviewer's half carries the same rule and the same line.
- **A delivered message no longer reports `stuck-in-composer`** (TM-160, EP-018). TM-151's styled
  composer check reached the safe-to-ring path (`checkBellSafe`, `whenSafe`) and not the landing
  verdict, which still used the plain-text pattern. So a message that was genuinely submitted, onto a
  pane that then rendered a dim suggestion, classified as `typed-unsubmitted`, exhausted the resubmit
  rung and escalated. Observed live: the scribe and the checker were both reported stuck while their
  replies sat in their outboxes. Wrong in the safe direction — it never claimed a delivery it did not
  have — but it fires `undeliveredMessages` and the `! UNDELIVERED` banner for messages that landed,
  and a signal that cries wolf stops being one. Both paths now ask the same question.
- **Three first-run conditions an operator used to meet as a stalled pane** (TM-155, EP-018). All
  found by running the demo four times, and all knowable before anything is launched.
  - **`doctor` reports `CLAUDE_FOLDER_UNTRUSTED`.** Claude Code asks "Is this a project you created
    or one you trust?" the first time it opens a directory, and the highlighted answer is
    `❯ No, exit`. The layer handles that correctly — TM-111's guard means nothing types at an
    attention screen — so the failure is silent by design: `lead ensure` reports "Provider is not
    accepting startup instructions; session preserved" and the pane waits for a human. Reported with
    the one-line remedy, and stating that the question is asked **per repository, not per agent
    directory**: a trusted repo's agent subdirectories inherit it, which is the correction to this
    task's original framing.
  - **A `TMUX_TMPDIR` too long for a unix socket is named before tmux answers.** `sun_path` is 104-108
    bytes and tmux builds `$TMUX_TMPDIR/tmux-<uid>/<name>`, so a per-session scratch directory
    exceeds it. tmux says "File name too long", which reads like a filename problem and is not.
  - **A prompt refusal names the key that is wrong.** `composePrompt` always returned `errors` with
    the layer, path and note; several refusals discarded them and said only "Invalid lead prompt;
    refusing restart." Both shapes that actually occur now say so — a template override that copied
    the default `./prompts/lead.md` (relative to the layer that declares it, so in a repo config it
    points at `<repo>/prompts/lead.md`), and a partial override, since a template is replaced rather
    than merged.
- **A readiness probe nothing woke anybody up for** (TM-157, EP-018). `reviewerProbeReady` wrote a
  nonce file and waited **one second** for the agent to notice it "at a safe boundary". That is the
  right answer for an agent mid-turn and no answer at all for an IDLE one: it sits at an empty
  composer with nothing to do, never polls again, never sees the probe, and reads `unresponsive`
  forever — so `reviewer.available` (registered AND alive AND responsive) is false and every
  governed launch refuses with `TOPOLOGY_STARTUP_NOT_READY`. Both `lead.mjs` and `reviewer.mjs`
  carried comments claiming the probe "rings the pane". Neither did.
  - The probe now **wakes** the pane through `wakeForProbe`, under the bell's own rules — alive,
    six-tuple unchanged, composer provably empty, no attention or failure screen — and the ring text
    carries the exact line to reply with, so it does not depend on any prompt file having mentioned
    the protocol.
  - **The file-only path is unchanged and still the fallback.** A pane that is busy, moved, dead or
    showing a modal gets nothing typed into it, and the probe degrades to precisely the old
    behaviour. TM-111 is the reason: a composer-shaped match on the folder-trust modal is what makes
    a keystroke dangerous rather than safe.
  - `AO_PROBE_TIMEOUT_MS` (default 20s) replaces the 1s window, and `AO_PROBE_POLL_MS` (default
    500ms) replaces a 25ms spin that would have cost ~800 captures of one pane per probe.
  - **The independence guarantee is untouched.** The reviewer still runs `--restricted --safe-mode`
    with no shell; its READY signal was always a printed line, which is why this needed no new
    permission. Anyone tempted to "fix" this by handing the reviewer a shell should read TM-157: it
    would satisfy neither cause and would remove the only thing making the reviewer read-only.

- **A re-assignment could collect the previous round's reply (TM-135).** The assignment envelope id
  was a pure function of (repo, task, agent), so releasing a task and handing it back to the same
  agent recomputed the same id, the standing mailbox deduped to the already-delivered envelope, and
  the old reply was read as the new round's completion signal. The id now carries the round.
- **The census could name an agent that had already gone (TM-135).** A census is up to 45 s old at
  its staleness bound, so the six-tuple is now re-proved under the assignment lock before the write.
- **A refusal mid-way through a multi-recipient send could partially deliver** (TM-143, EP-018).
  TM-142 fixed the *broadcast* refusals by resolving addresses before allocating a sequence number.
  The refusals raised inside the per-recipient loop — `TOPOLOGY_ROUTE_BLOCKED`,
  `TOPOLOGY_ROUTE_NO_LEAD`, `TOPOLOGY_ROUTE_LOOP`, `TOPOLOGY_UNKNOWN_AGENT`,
  `TOPOLOGY_COORDINATOR_NOT_A_WORKER` — still threw with the envelope already persisted, and once
  several recipients were addressed at once they threw *after* the recipients ahead of the refused
  one already had an inbox file. The sender saw an error, some agents had the message, and
  `run.json` said a message existed.
  - **Every local recipient is now admitted before anything is written.** `sendMessage` runs one
    resolution pass above `nextSequence`: the router is consulted once per recipient and the five
    refusals are raised there, where a refusal consumes no sequence number, writes no envelope and
    writes no inbox file. The write pass reuses the admitted decision rather than re-calling the
    router, so a policy that changes in between cannot admit one pass and refuse the other.
  - **Prevention, not rollback, and for the reason TM-142 already gave.** A sequence number cannot
    be handed back. Unwinding inbox files has the same shape of problem one level down: the unlink
    races the pointer delivery that may already have woken the recipient, and a message an agent has
    begun reading cannot be made not to have been read.
  - **The five refusals live in one `assertRoutable` helper**, called by the admission pass and
    re-asserted against the roster `nextSequence` returned, so the two passes cannot drift about
    what a refusal is.
  - **One residual is named rather than hidden.** The standing/external branch is not pre-flighted,
    because its delivery *is* its admission — `sendStandingMessage` runs canonical routing itself
    and reports a refusal as a hold, not a throw. The single reachable case where a refusal can
    still follow a delivery is an assignment that the standing router redirected onto a local
    `coordinates_only` agent; a standing delivery cannot be unwound, so it throws with the delivery
    recorded rather than pretending it did not happen. Documented at the branch.

- **A run agent with an unrecognised role vanished from presence entirely** (TM-136). Inside the
  run-agent loop only, `collectPresenceAgents` did `if (!ROLES.has(agent.role)) continue`, so
  `add()` never ran and an `image-gen` run agent — or a `lead`, which a run spec never carries
  because a repo lead appears in its own run as `orchestrator` — had **no entry in the snapshot at
  all**, not merely a wrong label. A *standing* `image-gen` role-session was unaffected. An unknown
  library role now maps to the nearest legal token (`runRole: "worker"`; `repoRole` already
  defaulted to `member`) with the truth carried in the additive `roleName`, so nothing is dropped
  and nothing is misdeclared in a field a consumer validates. `topology/lib/spec.mjs`'s identical
  list is left alone: there it only feeds an advisory message, `ID_PATTERN` is the real gate, and
  `image-gen` passes it.

- **Sandbox teardown no longer fails on a provider's Go module cache.** An agent that ran
  `go build` or `go test` left `go/pkg/mod` inside its sandbox HOME with directories at mode
  `0555`. Unlink needs write on the *parent* directory, so cleanup died with
  `EACCES: permission denied, unlink '/dev/shm/.../provider-home/<provider>/go/pkg/mod/.../LICENSE'`
  — `fs.rm({ force: true })` does not help, because `force` only swallows `ENOENT`. Every broker
  and turn-scratch removal now goes through `removeTree`, which restores write on its own
  directories and retries once. Symlinked directories are not followed, so it cannot chmod outside
  the tree it owns.
- **`providers/codex.json`'s ready pattern never matched.** Re-measured 2026-09-09 against tmux 3.4
  on a live idle codex pane: the shipped `^\s*[›>❯][^a-zA-Z0-9]*$` answered **0**, while
  `^\s*›\s*Ask Codex to do anything` answered 16. An empty codex composer renders that placeholder
  and the old pattern forbade letters after the glyph, so every codex agent burned its full 30s
  `timeout_ms` and was then reported as a slow agent. Both the JS and the tmux form are corrected.
- **`ControlClient` and `waitForChannel` ignored the tmux server prefix** (TM-130). Both spawned a
  bare `tmux`, with none of the `-L`/`-S` every call through `tmux()` gets. On a run started with
  `--server <socket>` the control client attached to the DEFAULT server, found no such session, and
  every agent fell back to polling — correctly, quietly, and for entirely the wrong reason. Both now
  take an optional `tmuxServer` and apply the shared `serverArgs()` prefix, and
  `clearAndWaitForShell` passes it to the waiter and to the command it types into the pane so the
  two name the same server. **No caller passes one yet**, so behaviour today is unchanged — this is
  the seam, and it is untested on a non-default socket.
- **Mail wording, applied from the `BEGIN_CLAUSE` lesson** (TM-122). `bootstrapText` and
  `prompts.mjs` now say: do the work in the same turn you read the message, do not stop to confirm
  receipt and wait to be told to continue, and if you are blocked still write a reply saying what is
  missing.
## [0.7.1] — 2026-09-09

TM-139. A supervisor died on startup whenever its working directory had been removed, and said
`state: "starting"` while doing it. Found by the logging added in 0.7.0, which is the first time
this failure left any trace at all.

### Fixed

- **`absolutize()` consulted the cwd for paths that were already absolute.** `base` was a default
  parameter (`base = process.cwd()`), and a default parameter is evaluated on every call where the
  argument is undefined — including the absolute-path branch that never reads it. `process.cwd()`
  throws `ENOENT … uv_cwd` inside a process whose working directory has been unlinked, so
  `ao-topology supervise --consumer /abs/path` died resolving a path it had already been given in
  absolute form. `tm` removes a task-owned worktree after a verified merge, so this is a routine
  case, not a test artifact. `base` is now resolved lazily, on the relative branch only. All 19
  call sites were checked: none depended on the eager evaluation, and a `null` base — previously a
  `TypeError` — now falls back to the cwd like an omitted one.
- **A supervisor that lost its repository ran forever.** Fixing the crash above turned a
  self-clearing failure into an immortal daemon spinning against a deleted path. The tick now
  checks that its consumer still exists, retires with `state: "consumer-gone"` and `stopped_at`,
  and exits.
- **Two unit tests wrote into the developer's real `~/.local/state`.** `send` self-starts a
  supervisor as of 0.7.0, so `tests/unit/topology-mailbox.test.mjs` — which shells `cli.mjs send`
  without pinning `AGENT_ORCHESTRATION_STATE_HOME` — spawned a real background daemon per run and
  orphaned its record when the temp dir went away. That is where all ten stale records came from.
  The state home is now pinned, and tests that start a real daemon reap it before removing the
  directory it writes to.

### Changed

- **The process record advances past `starting`.** The first completed tick promotes it to
  `state: "running"` with `first_tick_at`, so a startup crash is now mechanically distinguishable
  from a supervisor that has only just been spawned.
- **`supervisionStatus` names the failure instead of calling everything `down`**: `never-started`,
  `running-or-ownership-unknown`, `died-before-first-tick`, `retired-consumer-gone`, `orphaned`,
  `down` — plus `consumer_exists`, `record_state`, `record_path` and `stopped_at`.
- **`doctor` gains `SUPERVISOR_NEVER_TICKED`** (died during startup; read the log) and
  **`SUPERVISOR_ORPHANED`** (a record naming a directory that no longer exists, which no restart can
  reclaim — debris, with the exact file to delete). A clean `retired-consumer-gone` is not a fault
  and raises nothing.

## [0.7.0] — 2026-09-09

TM-127 / EP-018. The supervisor is now started and kept honest, and its tick stops behaving like a
busy loop.

### Added

- **`monitors/monitors.json` — the supervisor runs as a plugin monitor (`"when": "always"`).**
  `startRepositorySupervision` was reachable only from `enrollment ack`, `lead ensure` and
  `lead assign`: three one-time setup paths. Reboot the machine or let the detached process die and
  nothing brought it back, so the Presence v1 heartbeat stopped and every consumer read the
  repository as permanently stale. One entry, not two, because `ao-topology supervise` already runs
  `superviseRepository` and the host-scoped `watchServer` concurrently.
- **Self-start from `launch`, `session open` and `send`.** Codex, Grok and Kimi hosts have no
  monitor concept; monitor primary on Claude hosts, first-command-wins elsewhere, both converging
  on the same per-repo lock. Never fatal — a repo with no supervisor is degraded, not a failed
  command.
- **`doctor` reports the supervisor**: state, pid, restart count and the age of the last reconcile
  tick, with `SUPERVISOR_DOWN` / `SUPERVISOR_STALLED` problems. This is the check that would have
  caught the defect above; a repository that never started one is reported, not faulted.
- **`topology/PRESENCE-CONTRACT.md`** — contract revision 3, sha256 `3748e32d26f6f7b3…`, committed at
  the path `topology/fixtures/presence-v1/README.md` had always cited but that never existed —
  the fixtures were an acceptance artifact for a document that had not landed with them.
- `supervisionStatus()` and the exported `nextRung` / `SLEEP_LADDER_MS` seams, with adversarial
  tests in `tests/unit/topology-supervision.test.mjs`.

### Changed

- **The reconcile loop is no longer a 1-second filesystem-and-git busy loop.** Its body is
  `collectPresenceAgents` + `git worktree list` + a `readdir` of every run dir in every linked
  worktree + `refreshPrompt` per agent + `resumeStandingMessages`, and it ran every second. The
  tick sleep is now adaptive (2s / 5s / 15s, driven by an `activity` boolean; any activity snaps
  back to 2s) and the expensive body is rate-limited behind `AO_RECONCILE_MIN_MS` (default 10s).
- **The presence heartbeat is explicitly NOT that cadence.** `createPresenceProducer` now asserts at
  construction that its publish interval never exceeds the frozen contract's `staleAfterMs / 3`, so
  the two numbers cannot be conflated by a later edit. A quiet repository publishes presence more
  often than it reconciles: presence staleness is a contract, reconcile staleness is a hint.
- **Losing the supervision lock is no longer an error.** Linked worktrees share one canonical
  repository id, so a machine with eight worktrees open starts eight supervisors and seven must
  lose. They now exit **0** with `another-supervisor-owns-this-repository` inside the 100ms lock
  timeout, rather than throwing `TOPOLOGY_LOCK_TIMEOUT` — which a monitor host would read as a
  crash and restart in a loop. Measured 8-way: 1 supervisor alive, 7 clean exits.

### Fixed

- **A supervisor that died left no trace.** It was spawned with `stdio: 'ignore'`. Both streams now
  append to `<stateRoot>/supervision/<repoKey>.log` with a start banner, and the process record
  carries `started_at` and a `restarts` counter — a supervisor on its fortieth restart is a crash
  loop, and nothing could tell you that before.

## [0.6.0] — 2026-09-09

### Added

- Repository lead and reviewer registries, configurable templates and one prompt resolver.
- Startup hook/watcher detection, exact session bindings, durable standing messages and holds.
- Presence v1 producer and frozen contract fixtures, task-store-backed review/integration gates.

### Fixed

- Lock ownership races, unsafe prompt fallback, hook sibling deletion and watcher lease fencing.
- Linked worktree identity and cross-repository routing admission.

## [0.5.0] — 2026-09-06

### Added — the run tree (EP-016)

- **Nesting is recorded.** An agent has a shell and `ao-topology` on its PATH, so a conductor that
  wanted a sub-team could already start one — and nothing knew it had. A run now carries `parent`
  (`{run_dir, run_id, agent_id, depth, chain}`, null at the root) and `depth` in its `run.json`, the
  parent journals `run.spawned`, and `children.json` beside the parent is the index `stop` walks.
  The lineage travels two ways because each covers the other's blind spot: the file is the durable
  record that survives the process, and `AO_PARENT_RUN_DIR` / `AO_PARENT_RUN_ID` /
  `AO_PARENT_AGENT_ID` / `AO_RUN_DEPTH` / `AO_RUN_CHAIN` in **every** agent's environment is what
  lets a child nobody planned still record where it came from.
- **A workflow can be a participant in another workflow.** An `agents[]` entry with
  `{ id, workflow, inputs }` joins the run as a team rather than a pane: the conductor addresses it
  by id, sends to it and waits on it exactly as it would an agent, and never learns it is four
  agents in another tmux session. `ao-topology validate` refuses a participant that also names a
  `cli` — it is a team, not a process — and refuses a workflow that names itself, which is decidable
  without launching anything.

  Almost all of it is plumbing over what was already there. `sendMessage` and `recordReply` already
  took a run directory, so a message crossing between runs needed no bridge; the delivery loop
  already skipped an agent with no pane, so that `continue` became "forward into the child instead
  of ringing"; and `agents[].agent` was already the precedent for an entry whose meaning is resolved
  at launch rather than at validation.
- **`reply --token`** is wired. It was named in `recordReply`'s own refusal text and never
  implemented, so an agent following that advice got the same refusal again. It is load-bearing now:
  a child conductor already holds `AO_AGENT_TOKEN` for its own run, so answering upward as a
  participant in its parent needs the other token passed explicitly. The child is handed it as
  `AO_REPLY_TOKEN`, with `AO_REPLY_TO_RUN_DIR` and `AO_REPLY_AS_AGENT` — deliberately not the
  `AO_PARENT_*` names, which point the other way, at the run this agent would itself be the parent
  of. Sharing them would have made one of the two directions silently wrong.
- **`for_each` fans one participant out into a team per item.** An array, or one comma-separated
  string so an input can supply it — `{{item}}` and `{{item.<key>}}` reach each child. Children are
  named after their item (`per-file.src-a-js`), not their position, because the id is what a
  conductor types and nobody can hold `per-file.1` in their head across a run; a slug collision is
  resolved rather than allowed to silently drop a child. The group is addressed collectively by the
  id that produced it — `send --to per-file` reaches every member and `wait --from per-file` barriers
  over all of them — so the conductor never has to track how wide the fan actually was. Capped at
  eight (`--max-fanout`): ten *panes* was measured flat at 9.6s, but ten *children* is ten tmux
  sessions and ten mailboxes, so width costs far more here than depth.
- **`stop` cascades**, depth-first, journalling `run.child_exited` on the parent as it goes.
  Depth-first because stopping top-down orphans every level below the one that fails. `--no-cascade`
  opts out.
- **A workflow cannot enter its own ancestry** (`TOPOLOGY_WORKFLOW_CYCLE`) and nesting stops at
  three levels (`TOPOLOGY_DEPTH_EXCEEDED`, `--max-depth` to raise it). Both refusals name the chain,
  because "this loops" without saying where is not something an operator can act on.
- **A participant answers every pane question as a team.** `capture`, `nudge` and `failover` all ask
  something about a process — what is on its screen, type this at it, restart it on the next
  provider — and a participant has none of those. Each used to fail differently and none of them said
  why: `capture` returned silence, `nudge` leaked tmux's `can't find pane: null`, and `failover`
  reported "no provider left after none. Chain: .". One refusal (`TOPOLOGY_AGENT_IS_A_WORKFLOW`) now
  covers all three and names the child run where the question does have an answer. `status` renders a
  participant as a nested block — the child's state, session liveness, agent count and what is
  awaiting reply there — instead of `on NO PROVIDER [chain: ] pane null`, which read as a broken
  agent when the team was perfectly healthy.
- **A ready pattern tmux can never match is refused at load** (TM-112). tmux searches rendered lines
  one at a time, so a `ready.tmux_pattern` spanning a newline matches nothing, and tmux trims
  trailing whitespace off a line, so one ending in a space class cannot match a prompt sitting at the
  end of its line. Both used to cost the adapter's whole timeout and then report themselves as "ready
  pattern not seen" — a slow agent, not a broken pattern. Measured on tmux 3.4 against a pane showing
  `ready` then `> `: `#{C/r:ready\n>}` answers 0 where `#{C/r:ready}` answers 1, and
  `#{C/r:>[[:space:]]}` answers 0 where `#{C/r:>$}` answers 2. The shipped `claude` and `codex`
  patterns were already written to survive both and stay legal, which the test asserts.
- **The tmux contract test now exercises the path real adapters take.** The fake adapter declared
  only `ready.pattern`, so it took the polling fallback and left `waitReadySubscribed` — the
  subscription path every shipped adapter uses — uncovered. It now declares a single-line
  `tmux_pattern` as well, verified by making the polling pattern unmatchable and watching the run
  still come up ready. Its ready timeout went from 10s to 30s: `node --test` runs the contract files
  concurrently, and under the clean-install contract's load a local node process needed longer than
  10s to draw a prompt.
- **The design-system packaging contract skips instead of failing when the private client is
  absent.** It shells out to `design-client sync --check`, a devDependency from `npm.bytedesk.ai`; on
  a machine that installed without the registry token it failed with `Cannot find module`, which
  reads as a broken packed plugin rather than a missing credential.
- **A benign startup banner no longer kills an agent** (TM-110). Every failure pattern now needs
  failure context rather than a bare noun. `authentication` matched Claude Code's ordinary
  `⚠ 2 MCP servers need authentication · run /mcp` — printed on any machine with an unauthenticated
  MCP server, which is most of them — so a healthy agent was declared a failed candidate in five
  seconds, and on a single-candidate spec never came up at all. `quota`, `capacity` and `billing`
  were the same mistake waiting to happen. `no such file or directory` is deliberately left broad:
  narrowing it to the `: no such file` shell shape would buy precision on the polling path by
  disabling it on the subscription path, because `tmuxFailureTrigger` drops any pattern tmux's format
  parser cannot read. Verified live rather than in a fixture — a real `claude:haiku` agent came up
  ready with that banner on its screen and no repo-local override in play.
- **A CLI waiting on a person says so, in five seconds, in a sentence** (TM-111). Adapters gained
  `attention_patterns` — `{ pattern, message }` entries checked before the generic failure list,
  because these screens are specific where that list is generic, and because the operator's action is
  completely different from a provider outage. Claude's folder-trust modal and its login screen are
  the first two. The launch still walks to the next candidate, since a different CLI may have no such
  prompt, but the outcome now reads "Answer it once in a normal terminal (cd into the agent's cwd and
  run `claude`, choose 'Yes, I trust this folder'), then launch again" instead of
  `ready pattern not seen within 30000ms`. Measured live: 5s and a correct message, against 30s and
  an unexplained timeout.
- **A menu row is no longer mistaken for an empty prompt** (TM-111). The claude and codex ready
  patterns now require the prompt glyph to be the last thing on its line. The trust modal draws
  `❯ No, exit`, which the old pattern matched — so the launcher reported the agent *ready*, then
  typed the bootstrap pointer into a modal whose Enter means "No, exit". Measured on tmux 3.4 against
  two live panes: the real input box is `❯` followed by U+00A0 and nothing else, which the new
  pattern matches at its line while the menu row does not match at all. The report had this the other
  way round — it read as a timeout, not a false ready — which is why it was worth reproducing before
  fixing.
- **An approval says what it actually is** (TM-113). `orchestration_decision_approve` is a state
  gate, not an identity gate: `approvedBy` is an unauthenticated string that nothing compares to the
  run's initiator, so an agent can call the tool and pass any name. Rather than leave that implied,
  the approval record now carries `via` and `by_attested` — `"mcp"`/`false` for a tool call,
  `"session"`/`true` for the loopback session UI, which is bound to 127.0.0.1, needs a capability
  token this process minted, expires in ten minutes and can be exchanged once. `via` is a second
  argument to the service method, not a field of the tool input, so a caller cannot promote its own
  act by claiming the channel; a test asserts exactly that. `AGENT_ORCHESTRATION_REQUIRE_ATTESTED_APPROVAL=1`
  refuses tool-call approvals for architecture decisions outright
  (`AO_APPROVAL_REQUIRES_ATTESTED_CHANNEL`). The tool description, the README and the
  `agent-orchestrate` skill now say plainly that this is a stop-and-attest, not a separation of
  duties — and the skill tells an agent never to pass a person's name for a decision they did not
  make.
- **A dead pane reports what it died of** (TM-119). Liveness and exit status were two separate
  `display-message` calls — one to decide the verdict, one to fetch the number — so a pane reaped
  between them produced `{"reason":"pane exited","exit_status":null}`: a death with no way to tell a
  CLI that rejected its flags from one that was killed. `paneState` answers both in one query, and
  `paneAlive` now delegates to it. Found because the live harness's exit-status assertion failed once
  under load and passed on two clean reruns.

  Probing that turned up a second defect in the same place: **tmux answers an unknown pane id with
  exit 0 and an empty line**, not an error, so `pane_dead != "1"` read a pane that no longer exists
  as *alive*. Measured on tmux 3.4 — `display-message -p -t %99999 '#{pane_dead}'` prints nothing and
  exits 0. An empty answer is now "gone", and the test that pins it fails against the old behaviour.
- **A screen the launcher could not read is no longer reported as a screen with nothing on it**
  (TM-120). `captureAll` returned `""` whenever its tmux call failed — a timeout on a loaded machine
  included — and `""` is exactly what a pane that has drawn nothing yet returns. Readiness therefore
  polled a screen it had never actually read, matched neither the ready pattern nor any failure
  pattern, and blamed the agent. It returns `null` now; the polling loop counts unreadable looks and
  says so in the timeout instead of asserting something about the agent it never observed.

  The subscription path had the same blindness from the other direction: it decides from pushes, so
  if the server delivers nothing, nothing in this process has ever looked at the pane. It now takes
  one direct capture at the deadline before giving up.

  Both are measured, from a captured failing run whose pane logs are the whole argument: all three
  agents were reported as "ready pattern not seen", while the conductor's pane held its ready line
  AND its own `READY` answer, and `worker-a`'s held the usage-limit line whose only purpose is to be
  caught by a failure pattern. Nothing was slow and no pattern was wrong — the launcher was blind.
  The contract test now keeps its scratch tree on failure, which is what made those logs readable.
  Re-run afterwards: fourteen loop iterations, half alongside a full `two-projects.sh`, no failure —
  against failures at iteration 4 and 12 of the same loop before the fix. Evidence, not proof; the
  kept-on-failure tree stays so the next occurrence is readable rather than silent.
- **A conductor starts on its own** (TM-122). Twice, on a first-choice `claude:opus` in a clean
  repository, an orchestrator read its brief, replied READY and stopped — three healthy agents, an
  empty mailbox, no error anywhere. It was complying: the pane's bootstrap message asks it to read
  the brief and reply READY, and the licence to start the mission is the last line of a 118-line
  document it has been told to follow exactly. For a WORKER, replying READY *is* the whole job, so
  the fix cannot be a blanket change to `bootstrap_message` — an agent that invented work for itself
  rather than waiting for mail would be a worse bug than this one. The orchestrator's pointer now
  carries a `BEGIN_CLAUSE` telling it to begin in the same turn, on the same message rather than a
  second one, because a follow-up send would race the agent's own first turn and land in a composer
  busy reading the brief.
- **And a stalled run stops looking healthy.** `status` reports `STALLED` when the orchestrator has
  been up two minutes and has never sent a message, with the nudge that starts it. The check reads
  the whole journal rather than the twelve entries `status` displays: `message.sent` scrolls out of
  that tail within minutes, so a claim built on it would have grown *louder* the longer a run worked
  correctly. Verified both ways against live runs — it fires at 135s on a conductor that never sent
  anything, and stays quiet on one that has.
- **A bootstrap that never arrived is a failure, not a warning** (TM-126). When readiness timed out
  the launcher typed the pointer anyway and said "bootstrap pointer was sent anyway" — a guess. On a
  real client run it was wrong: two Claude agents timed out on their startup banner, the pointer went
  into panes whose TUI had not yet attached a key handler, and the keystrokes vanished. The composers
  were EMPTY, which is what separates this from the paste-and-settle bug where the text is sitting
  right there unsent. Nothing errored; the run held three healthy agents and an empty mailbox until a
  human noticed. The pointer is now confirmed on the pane, retried up to three times, and a delivery
  that never lands fails the candidate instead of reporting it as started.
- Two things the test for it caught in the fix itself. **Occurrences are counted, not looked for** —
  `captureAll` reads the whole scrollback, so on a failover the previous attempt's echo would confirm
  a delivery that never happened. And the "not listening" pane in the test is a **raw-mode** fixture
  rather than `sleep`: a process that merely ignores stdin still has the tty echoing what is typed at
  it, so the text appears and the check passes — the first version of the test passed against the
  bug for exactly that reason.

### Changed — the noun is "workflow" (EP-016)

- **Templates are workflows.** `ao-topology workflows` lists them, `--workflow <name>` launches one,
  `compose --save` writes to `workflows/`, and the plugin's own specs moved to
  `agent-orchestration/workflows/`. Nothing breaks on the way: `templates` and `--template` still
  work undocumented, and every search location is looked up under both names — new first, so a repo
  holding both runs the new one. A repo that never renamed anything needs no migration step, which
  the live harness asserts end to end rather than trusting.
- **The stage list is `stages:`.** One word was doing two jobs the moment a spec could name another
  spec: `workflow` for the steps of this run, and `agents[].workflow` for a whole other run. Specs
  are committed data in repos this rename does not get to break, so a top-level `workflow:` is still
  read — normalized to `stages` so nothing downstream sees two spellings — and `validate` reports it
  as deprecated rather than accepting it silently. `run.json` writes both keys for one release, so a
  consumer pinned to 0.4.0 can still read a run this version wrote. `ao-topology schema` now names
  `stages`, marks `workflow` deprecated with the collision that caused it, and documents
  `agents[].workflow` and `agents[].for_each` — the schema summary is what a composing agent reads,
  so a feature missing from it may as well not exist.

## [0.4.0] — 2026-09-05

### Added — the topology layer becomes a durable team (EP-014)

- **A per-repo agent library.** Agents are now a resource type like templates, skills, roles and
  providers, stored at `<repo>/.bytedesk/agent-orchestration/agents/<id>/` and resolved through the
  same four-tier search path. `ao-topology agent new|list|show`. A spec entry may reference a stored
  agent instead of restating it, with any inline field overriding the stored definition.
- **Durable identity.** An agent gets a short id minted once and never changed — the address every
  machine surface uses — plus a generated first name, last name and role-derived title, which is
  what people see. The two are generated independently, so a name collision can never disturb an
  address. The never-show-the-id rule is scoped to human surfaces; journals, session names,
  envelopes and spec agent ids carry it deliberately.
- **One lead per repository**, enforced at creation. A lead may be `coordinates_only`, which is a
  capability rather than an instruction: it is launched with no directory granted beyond its own and
  with its write tools removed by its adapter's `coordinator_args`. The lead is the only address an
  outsider may reach directly, so it is the most exposed agent and should be the least capable.
- **Cross-repo routing, enforced at the mailbox.** An unvouched contact from another repository is
  redirected to that repository's lead, with the original addressee preserved as `intended_for`, a
  `route.redirect` journal event, an explanation in the delivered message and an acknowledgement to
  the sender. A `via` chain (`send --via`) plus a hop limit stops re-forwarding and lead-to-lead
  loops.
- **Delegation tokens that cannot be forged by the sender.** A token is a pointer; the permission is
  the `tm` claim it names, held in the *receiving* repo's own task-management store and re-read on
  every use. Closing the task revokes the delegation with no revocation step.
- **Outbox authentication.** Each agent's launcher exports a token minted for it alone, and the run
  record stores only its digest — enough to check with, never enough to forge with. `reply --agent`
  is no longer a claim taken on trust, and an empty reply file no longer satisfies a barrier.
- **Per-agent memory.** Library agents run from their own directory, so on a CLI that keys session
  state by working directory two agents in one repo no longer share memory. The repo is granted
  through the adapter's own `add_dir_args`. Every shipped adapter now declares its memory scope and
  its grant mechanism, recorded from measurement.
- **Durable role-sessions** (TM-096). `ao-topology session open|list|close` gives an agent a named
  workspace keyed to its stable id rather than to a run — one you call, not one you launch. `open`
  on a live session reattaches to the same pane instead of creating a rival, so the identity
  survives the process that created it. The session record lives beside the agent, never inside a
  run directory that will be torn down, and names one idempotent restore command: gateway tab
  restore rebuilds from a tab record's stored `Command` when the tmux session is gone, so a
  role-session started any other way would be silently recreated wrong.
- **Sessions addressed by who is running** (TM-101). A run of one library agent is a spawn of that
  agent, and its tmux session is now named `<agent id>-<discriminator>` rather than
  `<spec name>-<run id>`, so `tmux ls` answers who rather than only what. Two concurrent spawns of
  one agent stay separately addressable; the discriminator's uniqueness scope is live sessions on
  this host, probed rather than assumed. `parseSessionName` resolves a name back to agent and spawn,
  and `session list` files live spawns under the agent that owns them. Teams and inline agents stay
  run-addressed — a team has no single answer, and an id written in a spec file is a label local to
  that file rather than an address.
- **Event-driven readiness and death** (TM-099). Readiness is now a `refresh-client -B` subscription
  on one control-mode client per session — the server pushes when a pane's content actually changes,
  so a quiet pane costs nothing and ten agents cost what three do. Deaths arrive through a
  `pane-died` hook carrying `#{pane_dead_status}`, the process's real exit code, instead of being
  discovered by a later poll. `pipe-pane` attaches before the shell is touched, so the output that
  explains why an agent never came up is no longer the part that gets lost. Agents start
  concurrently: measured flat at 6.4s for three and 9.6s for ten against a 6.2s single-agent
  baseline, where a serial launch costs agents x ready-time.

### Fixed

- **`bin/ao-topology` was not executable.** It was the only file in `bin/` without the bit, so every
  consumer invoking it got `Permission denied`.
- **`codex.json` shipped `--full-auto`**, which the installed Codex rejects outright. Replaced with
  the approval and sandbox flags that version actually has.
- **Readiness could never fail, and could pass on a shell prompt.** Nothing waited for the shell, so
  a slow rc file swallowed the launcher keystrokes while polling matched what the shell had drawn; a
  `tmux wait-for` nonce is now a real barrier, and the snapshot taken at that moment separates shell
  output from agent output. The fixed-delay path can now report not-ready, and failure patterns no
  longer fire on a word that appears only inside a path.
- **Three guards that were wired but could never fire**: `--allow-outside` was checked and never
  set; `issueDelegation`'s `coordinates_only` refusal never received the agent record; and the hop
  limit could not be reached because `send` accepted no `via` chain.
- **Routing failed open twice** — an unresolvable recipient was delivered as addressed before the
  external-sender check ran, and project identity was a raw string compare that a trailing slash or
  a symlink defeated.
- **`leadQueueDepth` measured a queue nobody fills**, selecting on a role no run agent has.
- **Readiness intermittently threw away the output it was waiting for.** The anchor separating an
  agent's output from the shell's was a SNAPSHOT of the freshly-cleared pane — which is pure
  whitespace whenever the prompt has not finished redrawing. A whitespace anchor matches inside the
  blank tail of a later capture just as readily as at the point it was taken, so the slice landed
  past the ready line and returned nothing: the agent never looked ready and paid its whole timeout,
  with the outcome depending on nothing but how fast the shell redrew. The pane now carries a
  printed unique marker, which can only match where it was printed. The same change makes
  `promptLines` count the prompt rather than the pane's whole scrollback.
- **Every agent past the sixth failed to get a pane.** `split-window -t <window>` splits the ACTIVE
  pane, so consecutive splits halved the same pane — 60 rows to 30 to 15 to 7 to 3 — and the seventh
  agent died on `no space for new pane`. The splits now re-equalize as they go, in one tmux
  invocation so the correctness is free.
- **A shared tmux server silently broke readiness for every agent but the first.** The window took
  its size from whatever unrelated session's client the server last had, so `-x 220 -y 60` came out
  93x20 and the stacked panes 12 columns wide. Readiness is decided by a per-rendered-line content
  search, so `fake-agent ready` wrapped into `fake-agent r` / `eady` and could never match: three
  agents reported one ready and paid the full 30s timeout twice, with nothing in the log saying why.
  The session now pins `window-size manual` on itself and sizes the window for the team, so neither
  our own control client nor a human attaching later reflows the agents.

### Changed

- **Resource paths moved** to `<repo>/.bytedesk/agent-orchestration/<kind>/`, with the legacy
  `<repo>/.orchestration/<kind>/` read as a fallback. The runs directory now ignores itself, so no
  consumer has to edit its own `.gitignore`.
- **A spec may not launch outside the repository that invoked it**, and `auto_approve` requires
  explicit consent (`--allow-outside`, `--allow-auto-approve`).
- `status` reports per-agent inbox depth and the age of the oldest waiting message.

### Documentation

- `docs/adr/0002-provider-credential-lifetime.md` (TM-103) — why a provider credential now stays
  readable inside the sandbox for the length of a run, what that changed in the threat model, and
  the five things that still bound it. The decision was taken in code and never written down; the
  contract test guarding the old behaviour had been failing ever since, so a real regression could
  not be told from the known one. The test now asserts the property that actually replaces
  shred-on-bootstrap: nothing readable survives the run.
- `docs/adr/0001-authoritative-orchestration-layer.md` — the tmux topology layer is authoritative
  for dispatched work; the MCP broker is kept as an opt-in sandboxed backend; `tm` owns the
  worktree. Written against the code, which uncovered two live defects in the existing dispatch
  backend.
- `docs/authorization-classes.md` — fleet's depth-based taxonomy salvaged before that plugin
  retires, plus external inbound as a fifth class. Read it as a specification: fleet implemented
  enforcement for one of its four classes.
- `tests/live/two-projects.sh` — the acceptance harness. Two real repositories, exercised through
  the CLI as a consumer would.

- Add the `design-studio` orchestration template: three panes bound to the design-system repo’s
  own `design-system-studio` director/hands/judge role files, each on its own provider chain, with
  the studio’s director driving the run and the template supplying only the terminals, fallback,
  and mailbox transport.
- Add `claude.fable-5-1` (model `claude-fable-5-1`) to the trusted model catalog and put it first on
  the `architecture.proposal`, `design.default`, `implementation.default`, and
  `provider.claude.default` aliases, ahead of `claude.opus-5` and the `claude.opus-4-8` fallback.
- Accept an optional exact `endpointId` on routing input, validated against the trusted catalog so
  arbitrary model IDs are rejected; it narrows the model allowlist to that one endpoint.
- Add an `image_generation` capability ID, advertised as supported for the Claude provider and
  unknown elsewhere until a probe says otherwise.
- Route Claude work to `claude.opus-5` (model `claude-opus-5`) on every default alias, with
  `claude.opus-4-8` as the deterministic fallback. The Claude Agent SDK ships a static model table
  that lags the CLI, so a build-time esbuild plugin clones the newest Opus entry under the new ID
  and fails loudly if the table shape changes or upstream adds the model itself. Synced from the
  released upstream source; the MCP server now advertises `0.2.3` instead of `0.1.0`.
- Stop every idle server from re-reading every run forever. Each host — claude, codex, grok, kimi —
  runs its own server against one shared state root, and each swept the full store every 5 seconds,
  reconciling every snapshot on disk (68 runs, 154 ms a pass, ~3% of a core per server) only to
  rediscover that almost all of them are terminal; 56 idle servers had accumulated 52 CPU-hours.
  A zero-byte `.active` marker, written on create and cleared on any terminal transition, turns the
  sweep into one stat per run — 154 ms becomes 3 ms — and only unfinished runs are read. The marker
  is a hint, never the truth: a stale one costs one snapshot read and the sweep clears it, and runs
  predating the scheme are swept once and then marked. The fixed interval becomes a
  self-rescheduling timer that backs off toward a minute while consecutive sweeps find nothing.
  Not addressed: nothing yet elects a single recovery owner among the servers on one machine.
- Discover providers in the caller's directory instead of the server process's own. Discovery ran in
  the MCP server's working directory — the plugin's directory — so a version-manager shim such as
  volta, which answers per project by walking up from the working directory, returned the plugin's
  own `node_modules` copy (correctly rejected by `externalProviderPaths`) while the PATH shim's
  realpath sat outside the trusted roots: no path could resolve, and codex failed
  `executable_not_found` on a machine that runs it daily. The same call fails with "Could not
  determine current directory" when a long-lived server's cwd has been deleted. Discovery now takes
  the consumer directory explicitly and falls back only to a directory that still exists (caller's
  path, `$PWD`, a still-valid `process.cwd()`, home), the availability cache is keyed on that
  directory because one entry cannot answer for two consumers pinning different provider versions,
  and `orchestration_doctor` accepts `consumerCwd` like every other grounded tool.
- Supervise the loopback session host with `systemd-run --user --scope` on Linux/WSL so the operator
  page outlives the MCP process. Native Windows stays in-process.
  `AGENT_ORCHESTRATION_SESSION_SUPERVISOR=0` forces in-process. The session-host CLI is a store-backed
  control plane (`autoRecover: false`) so cancel / follow-up / decision still work after MCP exit.
- Topology specs support ordered provider fallback chains (`candidates: ["cli:model", ...]`)
  for every agent, launch-time fallback past missing CLIs and usage/auth failures, mid-run
  `ao-topology failover` with mailbox re-delivery, launch-time input menus (`inputs.<name>.options`,
  `ao-topology inputs`), and the `logo-design` template.
- Add the tmux topology layer: declarative orchestration specs and templates, provider adapters for
  any installed CLI (claude, codex, grok, kimi, copilot, gemini, generic), domain-free role packs,
  a file-first mailbox with a JSONL journal, the `ao-topology` CLI (launch/send/wait/reply/capture/
  nudge/status/journal/stop/doctor/compose), and the `orchestration-compose`, `orchestration-launch`,
  `orchestration-conduct`, `orchestration-status`, and `setup-agent-orchestration` skills. Ships the
  `brand-identity-tournament` and `parallel-review` templates and a real-tmux contract test.
- Add a reusable cross-platform runtime built with Abstract Factory, Strategy, Facade, and Adapter
  roles. Linux keeps Bubblewrap/systemd isolation; Windows can use native AppContainer/Job Object
  isolation or a WSL2 adapter that reuses the Linux backend.
- Select the Windows backend with `AGENT_ORCHESTRATION_WINDOWS_BACKEND=auto|native|wsl`. Automatic
  selection prefers a healthy native backend and falls back to a fully provisioned WSL2 backend.
  Both explicit modes fail closed when required security dependencies are unavailable.
- Add a committed .NET 8 Windows helper for AppContainer launch, exact filesystem access rules,
  bounded Job Objects, owned-process verification, and cooperative-then-forceful termination.
- Fall back to an OS-assigned loopback port when Hyper-V or WSL reserves the fixed session-host range.
- Advertise Agent Orchestration in the Codex marketplace manifest and use Node-based MCP entries
  that load consistently on Windows and Linux.
- Store Windows state under `LOCALAPPDATA`, retain the XDG state location on Linux, and resolve
  missing nested state directories without duplicating Windows path segments.
- Project the session transcript, activity, and handoffs from the journal, and POST cancel /
  follow-up / decision through the broker. Follow-ups persist as `operator_message` events. Loopback
  Origin is required for browser mutations.
- Stream the hash-chained run journal to the session UI over cookie-auth SSE
  (`GET /api/runs/:id/events`). `after` / `Last-Event-ID` resume, a corrupt chain returns 409,
  and the status bar shows `live` / `reconnecting` / `detached`. The stage rail is `plan.stages`.
- Start a per-state-root Agent Orchestration Session host on `127.0.0.1`. Spawn returns a one-use
  `session.url`; the host exchanges it for an HttpOnly cookie and serves the committed session UI.
  Capability secrets stay out of `snapshot.json`. `agent-orchestration session-host` is the CLI bind.
- Add the Agent Orchestration Session plan and a Cobalt workbench mockup: a per-run loopback window
  for conversation, handoffs, activity, approvals, and controls. `node session-ui/serve.mjs` prints
  `Orchestration session: <url>` and opens a browser. Not wired into spawn yet.
- Wire Claude Code, Codex, Grok Build, and Kimi Code as orchestration hosts of the same MCP control
  plane. Spawn targets stay the trusted catalog (`claude`, `codex`, `grok-build`, `kimi`).
- Point sandbox `HOME` at the provider config dir so Claude Max subscription auth works without the
  unmounted host home.
- Keep the Claude credential copy mounted until sandbox teardown. Mid-run shredding made the
  bootstrap turn succeed and the task turn fail with AUTH_REQUIRED.
- Run every spawned catalog CLI in yolo / skip-permissions mode: ACP auto-approves tools after
  auth bootstrap, Codex starts in `agent-full-access`, Grok gets `--always-approve`. Bubblewrap
  still enforces the orchestration read/write mount.
- Admit the Kimi Code CLI from `~/.kimi-code/bin` in addition to the uv/pipx install roots.
- Add `install-orchestration-host` to install/trust the Grok plugin and write Kimi `mcp.json` plus
  skill/agent links without replacing unrelated MCP servers.
- Ship the governed `ROADMAP.md` and the cross-host `roadmap-orchestrator` skill with Codex UI
  metadata.
- Add validated task refinement, unlock materialization, trajectory extension, distance-aware gap
  filling, and evidence-ranked goal advancement while preserving IDs and reciprocal lineage.
- Preserve immutable roadmap identities in the packaged `ROADMAP-INVENTORY.json` ledger and require
  the precheck, edit, inventory append, canonical-view refresh, conditional source refresh, and final
  check sequence for enhancements.
- Require acyclic supersession chains to terminate at a live replacement while retaining retired
  evidence and lineage outside the active projection.
- Validate dependency-closed trajectories, human strategic approval provenance, lifecycle state
  combinations, semantic Mermaid relationships, and portable source seams in both source and clean
  installed-cache copies.
- Keep strategic proposals human-approved and non-executing, and preserve explicit
  consumer-relative `consumerCwd` for every external provider run.

## [0.3.0] — 2026-09-03

Backfilled. This release shipped without a changelog entry; the summary below is derived from the
17 commits in `ea85b8d..272a01f`, which is the authority for the detail.

- The tmux topology layer — visible agent teams in real panes, and the launch-time menus and
  `logo-design` template that drive them.
- Provider fallback chains and mid-run failover, so a dead provider moves work rather than ending it.
- A loopback session host bound on spawn, with live session SSE and operator controls, supervised
  under systemd.
- Native Windows and WSL runtimes, and the cross-platform launch repairs that made them load.
- Provider discovery in the caller's directory rather than the server process's, exact Fable 5.1
  routing, and a fix for idle servers re-reading every run forever.

**A version the package never carried.** `9e30405` moved `src/mcp.mjs` from 0.1.0 straight to
**0.2.3** — skipping 0.2.1 and 0.2.2, which never existed anywhere — while `package.json` sat at
0.2.0 and had already been there since `ea85b8d`. The two only came back together at `272a01f`,
which set both to 0.3.0. So an MCP client that asked this server its version during that fortnight
was told 0.2.3, a number no manifest ever carried and no release here is named after.

## [0.2.0] — 2026-08-21

Backfilled, on the same terms: no entry was written at the time, and `64e099a..ea85b8d` is the
authority.

- A governed living roadmap.
- The MCP tool prefix rename to `orchestration_*` (`31d586f`), which also removed this plugin's
  Codex-side `version` — it has been deliberately versionless there ever since.
- Codex read-sandbox mode alignment, canonical user-bus recovery, and refreshed source and sandbox
  bundles.

## [0.1.0] — 2026-08-21

- Add dual Claude Code and Codex plugin manifests.
- Add bundled MCP and CLI launcher contracts.
- Add cross-provider orchestration and diagnostic skills.
- Add Claude-native orchestration agent and optional Codex custom-agent template.
- Standardize the public MCP lifecycle, routing, event, cleanup, and approval surface on
  `orchestration_*`; no compatibility aliases are exposed.
- Require explicit absolute `consumerCwd` for consumer-grounded and mutating operations.
- Add deterministic capability-aware routing, the max-effort adversarial architecture protocol,
  repository-derived worktrees, durable hash-chained state, readiness probes, and atomic scheduling.
- Add Bubblewrap-enforced write containment, cooperative/verified cancellation, journal recovery,
  architecture decision lifecycle gates, installed-cache lifecycle coverage, and declarative provider
  command descriptors.
- Isolate provider roots, environments, devices, runtime sockets, and networks; outbound provider
  traffic uses `slirp4netns` with host loopback disabled.
- Add explicit one-shot/persistent session contracts, fail-closed follow-up eligibility, validated
  protocol DAGs, concrete MCP output schemas, terminal evidence immutability, periodic recovery,
  and nonce-owned exact-path worktree cleanup.
- Add bounded authenticated ACP readiness for every provider (including Kimi), fresh unmounted broker
  control directories, dependency-scoped protocol evidence, executor/contract registration gates, and
  retryable cleanup for process groups whose ownership cannot be proven.
- Run workers and sandboxed readiness probes inside transient systemd user scopes so timeouts, close
  failures, and leader exits cannot orphan provider descendants.
- Deny ACP client-side filesystem/terminal callbacks, omit credential-bearing proxy variables from
  sandbox argv, and require an active-scope worker acknowledgement before spawn returns.
- Replace persistent host credential mounts with per-turn bootstrap copies that are visible only to
  one constant, permission-denied broker authentication turn, then truncated and unlinked before the
  first task-controlled prompt.
- Restrict bootstrap inputs to auth-only files in broker-owned tmpfs; expose them as exact read-only
  mounts beneath otherwise writable provider homes whose ancestors are nested mountpoints; mount
  scratch directly at a sandbox top-level; and disable Claude user, project, and local setting sources.
- Admit only canonical provider executables beneath provider-specific installation roots, including
  fixed-command resolver support for version-manager shims; gate
  pipelined ACP prompts behind exact session responses; bound frames, transports, request buffers,
  and stderr; and add cgroup, runtime, core-dump, task-count, memory, and per-file ceilings.
- Scope run authority to the exact consumer checkout so linked worktrees cannot inspect or control
  one another, and revalidate provider-specific executable roots again at sandbox execution time.
