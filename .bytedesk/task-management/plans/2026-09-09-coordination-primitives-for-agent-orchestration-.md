# Coordination primitives for `agent-orchestration`, mined from the gateway tmux swarm

## Context

Over the last two days a 40-pane tmux swarm delivered real cross-repository work between
`bytedesk-marketplace` and `bytedesk-remote-gateway`. It worked — because the agents **invented a
coordination protocol by hand, in every terminal, from scratch**. Counted across the live scrollback:

| Hand-rolled mechanism | Occurrences |
|---|---|
| `python3 - <<'PY'` coordination scripts (pane loops, draft save/restore, probes) | 138 |
| `tmux capture-pane` used as a delivery or liveness probe | 82 |
| `printf … >> .bytedesk/task-management/handoffs/status.md` — the actual message bus | 32 |
| `tmux send-keys -l …` followed by a separate `Enter` | 25 |

The protocol they invented is coherent and worth keeping: a **conductor**; a **named single-holder
serial slot** with request → queue → grant → release (siblings: `cutover lock`, `deploy-safe lock`,
`no-restart hold`); an append-only **status ledger**; **composer etiquette** ("Do not type into
another pane with a nonempty composer" — one agent saved a peer's unsent draft to
`KIMI-116-PRESERVED-DRAFT.md`, steered it, then restored the draft); and file-drop **cross-repo
handoff** through `/tmp/ao-lead-rollout-20260909/`.

None of it is in the plugin. Every session re-derives it, and the failures are expensive: both
implementers died mid-task on `Error: [provider.auth_error] 403 You've reached your 5-hour usage
limit.`, recovered only by a human authorising a manual Codex takeover.

Meanwhile the plugin's own answer to the composer problem was to **switch the doorbell off**.
`topology/cli.mjs` reports every delivery as `{ rang: false, notification: 'durable-pending' }`,
reasoning that *"pane liveness proves neither an empty composer nor a safe tool-input state."* Honest
— and it means an idle agent never wakes up. TM-127's `parkedReason` admits it: *"automatic idle
wakeup remains untested."*

**Outcome:** land the in-flight TM-127 work, then replace the hand-rolled mechanisms with real
primitives — an end-to-end delivery guarantee, a liveness census, named serial slots, broadcast
addressing, a role CLI, and idle dispatch with quota failover — so the next swarm coordinates
through the plugin. Everything is built to run **without a model turn**: the operator's constraint is
"as deterministic as possible with the least amount of AI turns as possible."

### Two defects found during planning, both verified

1. **`providers/codex.json`'s `ready.tmux_pattern` never matches.** It is
   `^\s*[›>❯][^a-zA-Z0-9]*$`, but a live idle codex composer renders the placeholder
   `› Ask Codex to do anything` — letters after the glyph. Measured against a live pane just now:

   | Pattern | tmux `#{C/r:…}` result |
   |---|---|
   | codex shipped `ready.tmux_pattern` | **0** (never matches) |
   | `^\s*›\s*Ask Codex to do anything` | 16 |
   | claude shipped `ready.tmux_pattern` | 17 |
   | `^\s*[│|]\s*>[^a-zA-Z0-9]*$` (kimi box) | 14 |

   So every codex agent burns the full 30 s `timeout_ms` before falling through, and any safe bell
   keyed naively on `ready.tmux_pattern` would be silently wrong for codex.

2. **The supervisor starts once and is never restarted.** `agent-orchestration/` has no `monitors/`
   and no `hooks/` directory, while the sibling `task-management/` registers two `"when": "always"`
   daemons. `startRepositorySupervision` *is* called — but only from three one-time setup paths
   (`enrollment ack`, `lead ensure`, `lead assign`), never from `launch`, `session open` or `send`.
   Reboot the machine, or let that detached process die, and it is gone — and it is spawned with
   `stdio: 'ignore'`, so there is no record of why. Frozen Presence v1 §2.2 requires the producer to
   rewrite its snapshot every `staleAfterMs / 3` (~10 s) — *"that heartbeat is what makes the absence
   of a rewrite meaningful."* Without a live supervisor a gateway reads this repo as permanently
   stale, and the header the operator asked for never updates.

3. **A third, smaller one:** `topology/fixtures/presence-v1/README.md` points at
   `topology/PRESENCE-CONTRACT.md`, which does not exist in the worktree. The fixtures are an
   acceptance artifact for a document that never landed with them. The contract text does exist, at
   `/tmp/ao-lead-rollout-20260909/PRESENCE-CONTRACT.md` — commit it, or fix the pointer.

## What already exists — read before touching anything

Paths relative to `agent-orchestration/`.

- **`topology/` is authoritative** (`docs/adr/0001-authoritative-orchestration-layer.md`). It is
  dependency-free ESM and **must not import from `src/`**. The MCP broker in `src/` is a separate,
  retained, opt-in backend. Do not unify them.
- **`topology/lib/tmux.mjs`** — `sendText` (literal text and submit key in *separate* `send-keys`
  calls with a 500 ms `AO_SUBMIT_SETTLE_MS` settle; its comment block is the most load-bearing prose
  in the repo), `ControlClient` (control-mode subscriptions), `paneState`, `capture`/`captureAll`,
  `waitForChannel`/`signalChannel`, `listServerPanes`.
- **`topology/lib/providers.mjs` + `providers/*.json`** — the terminal-type abstraction already
  exists: `submit_keys`, `ready.pattern`/`ready.tmux_pattern`, `attention_patterns`,
  `failure_patterns`, `bootstrap_message`, `coordinator_args`. `normalizeAdapter` already rejects
  tmux patterns containing `{`, `}`, `:`, newlines or a trailing whitespace class — each a
  documented "compiles fine, matches nothing, costs the full timeout" trap.
- **`topology/lib/launch.mjs`** — `deliverPointer` (sends *and verifies* by counting occurrences in
  `captureAll`), `subscriptionFormat`, `decideFromSubscription`, `evaluateScreen`, `failoverAgent`
  (already refuses on a six-tuple binding mismatch), `readDeaths`, `mintAgentToken`/`tokenDigest`,
  `BEGIN_CLAUSE`, `bootstrapText`.
- **`topology/lib/mailbox.mjs`** — file mailbox, `expandFanout`, `MAX_HOPS`, idempotent
  `nextSequence(runDir, idempotencyKey, fingerprint)`, and the shared cross-repo admission
  (`const external = !sourceProject || !(await sameProject(...))` routes external traffic through
  `standing-mailbox.mjs`, so an omitted source cannot bypass admission).
- **`topology/lib/lockfile.mjs`** (new in TM-127) — atomic `mkdir` admission, ownership token,
  `.remove` gate, proven-dead reclamation via pid + `/proc/<pid>/stat` starttime + `boot_id`.
  *"Elapsed time is never proof a provider has died."* Linux-only.
- **`task-management/lib/dispatch/{index,collect,pool,topology}.mjs` + `lib/claims.mjs`** — claim
  before disk; never release a pre-existing claim; `collect` downgrades a self-reported done the
  store does not confirm. The store gets the last word.

---

## Phase 0 — land TM-127 (blocking, single-threaded)

TM-127 is `parked` with a 69-file / 6,723-line implementation committed at **`f3f21e7`** on
`tm/TM-127-agent-orchestration-persistent-repository-leads-`, worktree
`.bytedesk/worktrees/TM-127-agent-orchestration-persistent-repository-leads-`. It adds `lead.mjs`,
`presence.mjs`, `standing-mailbox.mjs`, `enrollment.mjs`, `reviewer.mjs`, `management.mjs`,
`supervision.mjs`, `lockfile.mjs`, `repoid.mjs`, `config.mjs`, `prompts.mjs`,
`prompt-lifecycle.mjs`, `startup.mjs`, ~1,960 lines of tests, and the frozen Presence v1 fixtures.
None of its 21 ACs are ticked. Everything below depends on it, so it lands alone, first.

**Do not re-litigate the four coordinator reviews.** They were written against the *uncommitted*
tree and two of their headline findings are already fixed at `f3f21e7`:

- Review 01 (lockfile): the committed file uses an ownership token, a `.remove` gate,
  `process.kill(pid,0)` plus `/proc` start-time + `boot_id` identity, states outright that elapsed
  time is never proof of death, and releases only its own lock.
- Review 04 (routing fails open when `--from-project` is omitted): fixed at the shared admission
  path rather than at the CLI — an omitted source now evaluates `external === true` and goes through
  `standing-mailbox` admission whether or not the `route` callback was installed.

Still to verify, because they were not obviously fixed:

- Review 02 — `prompts.mjs`: `composePrompt` iterates a hardcoded `['global','repo']` while
  `findTemplate` iterates the full precedence including `defaults`, so the two resolvers disagree
  about how many layers exist; a missing template file degrades silently with no `missing[]` entry.
- Review 03 — `startup.mjs`: `isCandidateSession` matches only AO-minted session names, so the
  watcher is blind to the direct hookless launches that are its whole purpose; the watcher lease has
  no fencing; `isOurs` is a bare substring test that also deletes the whole settings entry, making
  uninstall destructive.

Steps:

1. `tm start TM-127` — resume, do not create a new task.
2. Re-review against `f3f21e7` only. Fix reviews 02 and 03 if they still stand. **Do not churn
   `lead.mjs`** — the reviewer called it the strongest file in the branch.
3. Gates: `npm run test:unit`, `npm run test:topology`, `npm run test:contract`,
   `npm run build:check`, `npm run roadmap:check`, and
   `python3 topology/fixtures/presence-v1/validate_presence.py` + `test_validator.py`. Baseline on
   `main@82eaf62` was 275 tests / 271 pass / 4 skipped; the branch reported 382 pass / 4 skip.
4. Tick the 21 ACs with evidence, `tm evidence`, `tm done TM-127`, then TM-129 (coordinator review,
   integrate, cache refresh). **The lead session owns the merge; workers run no git in its tree.**
5. Version: the plugin is Claude-side **versionless** — no `version` in `.claude-plugin/plugin.json`
   or the `marketplace.json` entry, and that stays. Its only ecosystem semver marker is
   `package.json` (`0.6.0`); bump minor and add a `CHANGELOG.md` section naming TM-127 / EP-018.

### Phase 0.5 — make the tick actually run (still single-threaded; nothing else works without it)

1. **`agent-orchestration/monitors/monitors.json`** — one entry, not two, because `supervise`
   already runs `superviseRepository` and the host-scoped `watchServer` concurrently:
   `${CLAUDE_PLUGIN_ROOT}/bin/ao-topology supervise`, `"when": "always"`. Three existing properties
   make that safe: the per-repo `supervision/<repoKey>.lock` (a second supervisor exits rather than
   double-publishing), `createPresenceProducer`'s generation/owner fence
   (`TOPOLOGY_PRESENCE_FENCED` — a stale publisher cannot overwrite its successor), and
   `watchServer`'s lease, which reclaims a crashed watcher but never steals a live one.
2. **Codex / Grok / Kimi hosts have no monitor concept**, so widen the existing self-start instead
   of inventing a second daemon manager: call `startRepositorySupervision(ctx)` from `launch`,
   `session open`, `send`, `census` and `manage admit` too. It is already idempotent — a
   `process.kill(pid, 0)` check plus a spawn when dead, microseconds when already running. Monitor
   primary on Claude hosts, first-command-wins elsewhere, both converging on the same lock.
3. **Stop losing the reason it died:** `stdio: 'ignore'` → append to
   `<stateRoot>/supervision/<key>.log`; record `started_at` and a `restarts` counter. A supervisor
   that has restarted 40 times is a crash loop and today nothing could tell you.
4. **`doctor` gains the check that would have caught this**: is a supervisor alive for this repo,
   and how old is its last tick (`supervision/<key>.json`'s `at`)?
5. **Fix the 1-second busy loop.** There are three cadences and they must stay three:

   | Loop | Scope | Cadence | Action |
   |---|---|---|---|
   | L1 presence heartbeat | repo | `staleAfterMs/3` = 10 s | **Do not touch.** The frozen contract owns this number. |
   | L2 reconcile | repo | currently **1 s** | Its body is `collectPresenceAgents` + `git worktree list` + a `readdir` of every run dir in every worktree + `refreshPrompt` per agent + `resumeStandingMessages`. At 1 s that is a filesystem-and-git busy loop. **A bug in its own right.** |
   | L3 observation | repo | adaptive 2/5/15 s | New: census + bell retry. tmux-only, one cached `list-panes -a`, ≤8 captures. |

   Fold L3 into L2's loop and rate-limit the expensive body behind `AO_RECONCILE_MIN_MS` (default
   10 s). Net diff: `intervalMs: 1000` becomes an adaptive sleep, the existing body gains one
   elapsed guard, and the cheap work runs ahead of it. **No new timer, and the reconcile loop gets
   ~10× cheaper as a side effect.** `watchServer` stays separate — its lease scope is per tmux
   *server*, not per repo. Leave a comment saying that a quiet repo publishes presence more often
   than it takes a census: that is correct (presence staleness is a contract, census staleness is a
   hint) and it looks like a bug.
6. Commit `topology/PRESENCE-CONTRACT.md`, or fix the fixtures README pointer.
7. Tests in `tests/unit/topology-supervision.test.mjs`: a second supervisor in the same repo exits
   on the lock rather than double-publishing; the reconcile body runs at most once per
   `AO_RECONCILE_MIN_MS` across N cheap ticks; the sleep walks 2/5/15 and snaps back on activity.

**Measure before shipping `"when": "always"`.** A linked worktree resolves to the *same*
`canonicalRepoId`, so a developer with eight worktrees of this repo open gets eight supervisor
spawns racing one lock every time. Seven lose and exit — correct, but it is the single most likely
source of "why are there 40 node processes". Consider exiting fast on lock contention rather than
after the 100 ms wait.

Presence v1 is **frozen and countersigned** (contract sha256 `3748e32d26f6f7b3…`, 11 hashes verified
against the gateway's Go parser). Any wire change is `schemaVersion: 2`, never an edit.

---

## Phase 1 — delivery as a state machine (the 100 % guarantee)

The requirement: **a message that is sent is received and processed, every time, whatever transport
carried it.** Two named symptoms to eliminate — text stuck in the composer, and a message submitted
but never converted into work (TM-122: the conductor acknowledged its bootstrap and stopped).

New module **`topology/lib/delivery.mjs`**. States and how each is *observed*, never assumed:

| State | Observation |
|---|---|
| `held` | Pre-state: composer non-empty, attention screen, or pane busy. Nothing typed. |
| `not-typed` | `deliverPointer`'s occurrence count did not rise. TM-126 — TUI had no key handler; keystrokes vanished. |
| `typed-unsubmitted` | Count rose **and** the composer is still non-empty. TM-121 family. |
| `submitted` | Count rose **and** the composer is empty again. |
| `engaged` | `pane.log` grew past the byte offset recorded at submit, within `AO_ENGAGE_MS` (60 s). Zero model turns. |
| `submitted-inert` | Submitted, and `pane.log` did **not** grow within the window. **This is TM-122, caught mechanically.** |
| `processed` | A reply with content — `hasAnswer()`. |
| `escalated` | Terminal failure. Journalled, surfaced, non-zero exit. |

The discrimination needs exactly one new piece of per-provider knowledge — *is the composer empty
now* — because if it is, whatever was in it left:

```
count rose?   composer empty?   →  state
     no             –              not-typed
    yes            no              typed-unsubmitted
    yes           yes              submitted
    yes         unknown            submitted-unverified → retried as not-typed, reported as held
```

**New `providers/*.json` field**, sibling to `ready` and `submit_keys`, validated by extracting
`normalizeAdapter`'s existing tmux-pattern guard into `assertTmuxPattern(adapter, field, value)` and
calling it twice:

```json
"composer": {
  "empty_tmux_pattern": "…",
  "empty_pattern": "…",
  "note": "Measured <date> on <version>: <what the pane actually rendered>."
}
```

**Absent means absent** — never default to `ready.tmux_pattern`; codex proves the two differ. An
adapter with no `composer` is `ring_capability: "unsupported"`, holds, and reports. Ship measured
values for claude, codex (plus the `ready.tmux_pattern` fix) and kimi; leave grok/gemini/copilot/
generic absent. Honest beats guessed.

**Safe to ring** means all of: pane alive; **the six-tuple binding still matches** (`failoverAgent`
already does this — without it a `%N` reuse types a task assignment into a stranger's pane); the
composer pattern matches; no attention or failure line (TM-111: the folder-trust modal draws
`❯ No, exit` and Enter there means *exit*); not dead. Note one deliberate difference from launch:
`decideFromSubscription` discounts `promptLines` because the shell prompt is still on screen after
`clearAndWaitForShell`; mid-run the shell has been `exec`'d away, so the bell's threshold is `> 0`.
Conflating them would reject every safe pane.

**Push, not poll.** The condition is an edge and holding can last minutes. `ControlClient` is
per-*session*, so a fan-out `send --to a,b,c` costs **one** tmux client. Refcounted registry, cap
`AO_BELL_MAX_CLIENTS` (default 8), bounded-poll fallback when control mode is refused.

**Retry ladder — idempotent, cheapest rung first:**

| Rung | Trigger | Action | Why safe |
|---|---|---|---|
| R0 `resubmit` | `typed-unsubmitted` | submit keys **alone**, after the settle | Never re-types. Re-typing appends a second copy. Max 2, then R2. |
| R1 `retype` | `not-typed` | full `deliverPointer` | Its occurrence count makes a stale echo unusable as proof. A false negative costs a duplicate; silent loss costs the run. |
| R2 `wait-safe` | pane went busy mid-ring | back to `whenSafe` | The file is already written; waiting is free. |
| R3 `escalate` | window exhausted | stop typing, journal, surface | Never silent. |

Nothing in the ladder re-sends the message of record: `nextSequence` is already idempotent on
`(idempotencyKey, fingerprint)`. Ring bookkeeping lives in `run.json` under
`ring_state[messageId][agentId]`, written through the existing `.mailbox-sequence.lock`.

**The receipt costs zero model turns, because it is a byte offset.** The first design here had the
agent run an `ack` command per message — one tool call per message per agent, and one that depends
on a model *remembering to*, when TM-122 is the standing proof that models skip instructions buried
in long documents. That is the least deterministic possible way to prove determinism. Replaced.

`pipe-pane -o` is **already** attached at pane creation, for run agents and for role-sessions, before
anything else happens — deliberately, because "attaching it later loses precisely the part that says
why an agent never came up". Every byte a pane renders is already appended to
`agents/<id>/pane.log`. Reading it costs no tmux call and no model turn, and `fs.watch` makes it a
push signal with no polling.

Use each signal only for what it can prove:

- `pane.log` growth proves **the agent reacted** — bytes appeared after the offset recorded at
  submit. It cannot prove the composer is empty: the composer is a redrawn screen region, and the
  log holds escape sequences, not a rendered frame.
- The tmux subscription proves **the composer is empty**. It cannot prove engagement.

Conflating them is how you get a confident wrong answer. `submitted-inert` is the valuable state: a
conductor that submitted its pointer and then produced nothing is now a *named, detected* condition
costing one `stat()`, not an hour of silence a human eventually notices.

`ao-topology ack` still ships, as an **optional** verb — useful to a human, to a hook, or to an agent
being explicit about a long task — but nothing in the protocol requires it and no state depends on
it. Fix in passing: `waitForChannel` spawns bare `TMUX` with no `-L`/`-S` prefix, so on a non-default
socket it waits forever.

**The wording still matters, and it shrinks to wording.** In `bootstrapText`, the `BEGIN_CLAUSE`
lesson applied to mail, with no new command: *"Do the work in the same turn you read the message. Do
not stop to confirm receipt and wait to be told to continue — nobody is going to tell you. If you are
blocked or the request is ambiguous, still write a reply saying what is missing."* Same text into
`prompts.mjs` for standing role-sessions.

**Declared, not built first:** `adapter.hooks` already exists and `claude.json` already declares a
`SessionStart` hook. Claude Code also fires `Stop` at end of turn, which would give an exact,
zero-turn "this agent finished a turn" signal — strictly better than a ~4 s braille heuristic. Do not
ship it first: the spinner path has to exist anyway for codex/grok/kimi, and two mechanisms at once
means neither is trusted. Widen `adapter.hooks` from `event: string` to `events: string[]` (keeping
the singular), have the census report `evidence.source: "hook" | "title" | "tail"` from day one so
you can watch the better mechanism take over — and note the caveat: hooks live in
`~/.claude/settings.json`, so a `Stop` hook fires for *every* Claude session on the machine including
the operator's own, and must exit fast when `AO_RUN_DIR` / `AO_AGENT_ID` are absent, the way
`startup-check` already does.

**Escalation is never silent:** journal `message.undelivered`; `send` exits 3 *only* when the pane
was judged safe and the pointer still did not land (never for `held`, never for `unsupported`);
`status` gains an `! UNDELIVERED` banner modelled on the existing `! STALLED` block; the census
carries `undeliveredMessages` so the scheduler will not hand new work to an agent holding an
undriven message; the supervisor retries and gives up after `AO_RING_GIVE_UP` (default 5).

**`delivered[]` is additive** — every existing key keeps its meaning and type, `rang` stays the
boolean discriminator, and a `delivery` object carries `state`, `ring_capability`, `pane`,
`waited_ms`, `typed`, `composer_empty_after`, `rungs`, `attempts`, `reason`, `ack`, `escalated`.
`notification` widens: `submitted`, `acknowledged`, `durable-pending` (unchanged semantics),
`no-safe-bell`, `ring-skipped`, `stuck-in-composer`, `ring-failed`, `stale-binding`.

**The guarantee holds on every transport.** Run mailbox: the ladder above. Standing/cross-repo:
once a record reaches `delivered` to a local agent with a pane it takes the same bell — no new path;
while `held`, the record already carries `attempts` and `reason`, so escalate past
`AO_STANDING_ESCALATE_ATTEMPTS` (30) or an hour **without adding a field to the frozen record**.
Child-workflow forwarding: ring the child conductor in the child session. Stated once: *a message
reaches a terminal state on every transport, or a human is told which one it is stuck on and why.*

---

## Phase 2 — liveness census

`ao-topology census [--json] [--watch]`, a new repo-scoped noun. (`agents --live` collides with the
existing `agent list`; `session list` already means role-sessions; a `--live` flag on `status` is
run-scoped.)

**The loop extends `superviseRepository`** — it already holds the per-repo lock, ticks, calls
`collectPresenceAgents` (exactly one `list-panes -a` per server) and writes a durable report. A
second daemon would mean a second lock, a second listing, and two answers to "is this agent alive",
which is how a scheduler ends up dispatching into a busy pane.

**Presence is not touched.** Its `LIFE` set is `starting|ready|busy|unresponsive|dead` — a
lifecycle, not a work state — and the frozen fixtures enforce it. The census writes its own file at
`<stateRoot>/census/<repoKey>.json`.

**Precedence, highest first:** `dead` (pane row or `deaths.tsv` — death beats a screen still showing
a spinner) → `quota-blocked` → `attention` → `working` → `needs-input` → `idle` → `unknown`.

- **Busy** is the Unicode Braille Patterns range **U+2800–U+28FF** appearing in the pane title or
  capture tail, plus a short marker list. The range test is the CLI-agnostic part that actually
  works across claude/codex/grok/kimi; drop the individual braille glyphs a per-CLI list would
  carry, since the range already covers them.
- **`needs-input` is edge-triggered exactly once**, when a post-busy idle streak first reaches 2
  polls (~4 s). Level-triggering re-notifies forever while the agent sits at a prompt and the
  condition never clears. It appears with `edge: true` for one tick, then falls to `idle` with
  `needsInputAt` retained — useful to the scheduler as "this one just finished" without becoming a
  sticky label.
- **`unknown` is never silently `idle`.** A failed capture is not an empty screen.

**Quota** is one optional field, not a third pattern list: `attention_patterns[].state`, defaulting
to `"attention"`, constrained to `attention|quota-blocked`. `providers/kimi.json` gains an entry
anchored on `reached your \d+-hour usage limit` — no slash (survives `withoutPaths`), no braces or
colons (survives the tmux format parser), unlike the full `[provider.auth_error]` string. Note the
behaviour change: `attentionOnScreen` is checked *before* `failureOnScreen`, and the generic failure
list already contains `"usage limit"`, so today an out-of-quota Kimi is a bare failure that triggers
failover. With this entry it becomes an actionable attention. That is correct — "wait for the
window" is not "this provider is down" — but it changes launch behaviour and belongs in the
CHANGELOG.

**Cheap by construction:** reuse the supervisor's single `list-panes -a`; add `#{pane_title}` to
`listServerPanes`' field list (one extra column, zero extra calls, gives the braille check for every
pane free); capture only when the title was inconclusive; `-S -20`, not full history; at most
`AO_CENSUS_CAPTURE_BUDGET` (default 8) captures per tick; memoize by `(paneId, panePid)` so a
respawn invalidates; adaptive 2 s → 5 s → 15 s backoff driven by an `activity` boolean, **decoupled
from the reconcile tick's 1 s interval** or the backoff buys nothing.

**`--json` serves two consumers from one document.** Humans get a line per agent. The scheduler
reads exactly two fields: `binding` and a derived `dispatchable = state === 'idle' && !stale &&
undeliveredMessages.length === 0 && binding matches the live incarnation`. One derived boolean, not
the precedence table — otherwise scheduler and supervisor drift on what "idle" means. **`stale:
true` makes nothing dispatchable**; a stale census is `unknown`, and dispatching into it dispatches
into a busy agent.

---


## Phase 3 — named serial slots

New `topology/lib/slots.mjs` (Node stdlib only; imports `util`, `repoid`, `lockfile`, `tmux`, `lead`).
Records at `stateRoot()/slots/<repoKey>/<name>.json`, keyed by the git common directory so every
linked worktree shares one `cutover` slot — the same identity rule that makes there be one lead.
Name charset `^[a-z0-9][a-z0-9-]{0,63}$`, validated **before** it is joined to a path.

`withLock` is the wrong holder and the right mutex: it releases the moment its function returns,
while a slot is held across many turns by an agent that is not a running function. So **`withLock`
serialises every mutation; the record is the holder.**

Fairness is a monotonic decimal-string ticket allocated under the lock — FIFO by ticket, never by
timestamp, because clocks tie and skew. A repeated `slot request` by the same agent is **idempotent**:
same ticket, same position. A polling agent must never be sent to the back of its own queue.

`reconcile(record)` is idempotent and runs under the lock: vacate a holder that is not provably
alive → drop a dead head-of-queue → **if the holder is null and the queue is non-empty, grant to the
head, unconditionally**. It is called from `slot request`, `slot status`, and the supervise tick.
That last one is the answer to "grant must not be a verb someone runs": `slot release` only clears
the holder; the grant happens on the next tick (≤2 s) whether or not anybody looks, and the same tick
delivers a standing-mailbox pointer to the new holder. **Zero model turns on either side of a
handover.** `slot grant --to <agent>` exists only as a lead-only override, records the jumped
tickets, and its help says so, so nobody wires it into a loop.

Liveness uses the **tmux six-tuple**, not a pid — the incarnation identity the rest of the plugin
already uses. That is portable, so slot reclamation works identically on macOS. The Linux-only part
is `withLock`'s own reclamation; on macOS `processIdentity` returns null, `dead()` is true only on
`ESRCH`, and it correctly **fails closed** with `TOPOLOGY_LOCK_TIMEOUT`. Document that residual gap;
do not paper over it with a second rule. **Age never reclaims** — `status` reports `held_for_ms` and
flags a hold past its declared `--expect`, and that is all. The remedy for a long hold is a human.

Release requires proof the holder is asking, and there are two accepted proofs because
`AO_AGENT_TOKEN` is minted per agent *per run* and a standing lead/reviewer has none: a run agent
proves the token digest with `timingSafeEqual`, exactly as `recordReply` does; a standing agent
proves `AO_AGENT_ID` + `AO_CONSUMER` + the exact `TMUX_PANE`/server, exactly as
`acknowledgeEnrollment` does. Neither → `TOPOLOGY_SLOT_NOT_HOLDER`, record unchanged.

`--reason` is **required** at request — every observed transcript carried one, and it is the entire
operator value of `status`. Default output reproduces the observed lines verbatim so the heredocs get
deleted rather than reworded: `SERIAL SLOT GRANTED: cutover to e5f6a7b8 for TM-221`.

**Most likely failure: the queue outlives the agents in it.** An agent requests, its pane dies — or
quota failover respawns it with a new `panePid` — and its ticket sits at the head forever while
everyone behind starves and `status` reports success. Two defences, both load-bearing: `reconcile`
applies the same liveness test to queue entries as to the holder, and a grant records the binding it
was checked against, so **a grant nobody can prove is reclaimed on the next tick, not honoured**.
Correspondingly, `failoverAgent` must re-stamp the slot binding after a respawn, or every failover
silently forfeits that agent's slot.

## Phase 4 — broadcast addressing

New `topology/lib/addressing.mjs`. Four complete audiences, unioned by the comma that `--to` already
means, so no new list semantics: `@run` (roster minus sender minus orchestrator), `@repo` (enrolled
standing agents of the **destination** repo), `@role:<role>`, `@idle` (from the census). No
intersection grammar — a grammar with scope state is the thing nobody can hold in their head.

`sendMessage` replaces its inline fan-out loop with one `expandAddresses(...)` call. That is the only
choke point that matters, because `forwardMessageToWorkflow` routes back through `sendMessage` and
the external/standing branch sits *below* the expansion. A forwarding agent cannot bypass it — not by
convention, by control flow. `expandFanout` stays exported and becomes the literal-token branch, and
`pendingReplies`/`waitForReplies` use the same function, which is what makes the barrier cover the
same set the send covered.

**Admission is not widened, it is repeated.** Expansion yields concrete ids *before* `external` is
computed, so a broadcast is N ordinary sends, each individually admitted through the identical path.
There is no new admission path, so there is nothing new to hole. One new invariant closes the
interesting attack (enumerate-and-reach every standing agent, bypassing the lead that `routing.mjs`
exists to be): **any `@` token with `external === true` is refused** — `TOPOLOGY_BROADCAST_EXTERNAL`.
An outsider still reaches the lead exactly as today; if it wants the room told, it asks the front
door.

**Cross-repo broadcast is not allowed**, so the both-leads-ready precondition never arises. Holding N
envelopes because one remote lead is down turns a chatty broadcast into a state-root landfill and a
thundering herd on the next `resumeStandingMessages`. To reach another team you send its lead one
message and it broadcasts locally.

`MAX_FANOUT = 8` prices tmux sessions; addressing prices one inbox file plus one pointer, so
`MAX_BROADCAST = 24` lives in the new module. Past it, **refuse** naming count and limit — never
truncate; a silently unreached recipient is exactly what this layer exists to prevent.
`--max-recipients` overrides, mirroring `--max-fanout`.

The barrier needs no new state: `run.message_deliveries[id]` already records the exact delivered set,
so `wait --message <id>` barriers over precisely who was reached, and `wait --from @run` expands live
and is documented as "everyone in the run *now*". Redirected recipients still satisfy it through the
existing redirect map.

`@repo` reads `collectPresenceAgents` **in-process** — the function, not the published snapshot — so
the frozen fixtures are untouched, and it is used as a *directory*, not authority: every candidate is
still validated downstream by `routeMessage`. If the census is unavailable, `@idle` **refuses**
rather than degrading to "everyone"; broadcasting to a busy room is worse than an error.

**Most likely failure: `@repo` reaching an agent that is enrolled but not in this run's roster.** A
standing lead or reviewer is normally not in `run.agents`, so a naive `@repo` throws
`TOPOLOGY_UNKNOWN_AGENT` for exactly the agents the feature exists to reach — and a "helpful" fix
would silently drop them. `expandAddresses` therefore returns `{id, delivery}` and the per-recipient
branch becomes `if (external || entry.delivery === 'standing')`. Two tokens, load-bearing. The
durable path is already correct for intra-repo standing delivery.

## Phase 5 — idle dispatch and quota failover

### Idle dispatch — a backend plus a pool preference, not a second scheduler

New `task-management/lib/dispatch/idle.mjs` with the standard backend shape. Its `spawn` does not
spawn: it shells `ao-topology manage assign --task … --worktree … --prompt-file …` the way the
topology backend already shells its sibling (probed path, `shell:false`, argv-only) and returns
`{ok:true, run:"idle:<agentId>"}`. **Zero edits to `dispatch/index.mjs`** — a backend is called at
step 6, after the claim at step 3 and provisioning at step 5, so every ordering invariant holds for
free, and a refusal rolls back through the existing `fail()` path that never releases a pre-existing
claim. The worktree is still provisioned: `management.mjs`'s `ownedTask` requires one, and a standing
agent's cwd is its own agent directory by design.

Pool integration is one predicate: `resolveBackend` order gains `idle` ahead of `topology` when
`dispatch.preferIdle` is true. Same tick, same WIP accounting, same collision-free `touches` set.

Arbitration reuses the record that already owns "who owns this task": `management.mjs` gains
`assignTaskToAgent` / `releaseAssignment`, and the management record grows an `assignee`. Under
`withLock`, assignment refuses if that agent already holds an unfinished record, and proves its
six-tuple alive before writing. **The census is a hint; the assignment record under the lock is the
authority, and the idle check happens inside the same critical section as the write.** Check idle in
the pool and assign in the backend and you ship the double-assignment bug — two ticks both see the
agent idle, both provision a tree, and it silently interleaves two tasks.

`collectIdle` joins the routing table. The completion signal is **not** session death — the standing
session outlives the task, which is the whole point — it is the standing-mailbox reply, run through
the unmodified `recordResult` so the downgrade rule and park-never-strand rule apply byte-identically.
A terminal result also releases the assignment.

Two monitors, one placer: `ao-supervise` publishes who is idle and dispatches nothing. For a human
`tm dispatch` racing the pool, the *task* is arbitrated by `claimTask` before any disk write and the
*agent* by the assignment lock — two resources, two locks, both taken before anything is written.

**CAP-0002 gets better by one deliberate line.** Idle dispatch would worsen it if the assigned agent
ran `tm` bare and re-created the null-session claim shape, so the handoff carries
`TM_SESSION_ID = idle-<agentId>-<taskId>` and `spawn()` asserts `req.session` is non-null: one more
path that always writes an owned claim, zero new null-session claims. Write CAP-0002's body up as
part of this phase — it is currently an empty stub whose root cause exists only in TM-127's comments.

### Quota failover

The signature already lives in `failure_patterns` — `"usage limit"` is the first entry of
`GENERIC_ADAPTER.failure_patterns`, and the observed Kimi string survives `withoutPaths()`. **No
provider JSON change.** `attention_patterns` is the wrong home and the ordering proves it: attention
is checked *first* because it means "a human must press a key here", and quota exhaustion is not
answerable at the keyboard.

The real gap is that `failureOnScreen` is consulted **only during startup readiness** — once an agent
is working nobody looks again, which is exactly the observed incident, hours in. New
`topology/lib/quota.mjs`, called from the supervise tick, uses the mechanism this codebase already
built: `tmuxFailureTrigger(adapter)` compiles the patterns into a server-side ERE and
`subscriptionFormat` subscribes, so **the server pushes and we capture only when the trigger fires**.
That is the productised form of the 82 ad-hoc `capture-pane` probes and it costs nothing on quiet
panes. Detection writes an incident and journals `provider.quota_suspected`. **It restarts nothing.**

Consent is `failover.consent` ∈ `ask` (default) | `auto` | `never`. In `ask`, the tick writes the
incident and rings the lead with the approval command — **this is the one unavoidable human turn in
the entire design**, and it matches the observed recovery: a human authorised a Codex takeover; we
are automating the *ask*, not the switch. In `auto` it applies **and announces** — the operator's
rule forbids *silent* substitution, and an operator who sets `auto` has consented in advance, in
writing, in config; say that in the config comment so nobody re-litigates it. `failoverAgent` gains
`{incidentId, approvedBy}` and asserts the incident is open and names this agent and this provider;
everything else in that function is already correct.

Three things survive a failover, and they need three separate answers. **The work** survives: same
pane, same worktree, same branch — but the re-bootstrap must tell the new provider to orient
(`git status`, `git log`, read `PROMPT_FILE`). **The conversation does not**, because a different CLI
has a different memory; that is *why* `failoverAgent` re-delivers unanswered messages, and it must be
said loudly in the docs or a team will misread a cold agent as a broken one. **The claim** survives
via `startHeartbeat`, which keys off the registry rather than the pane — with a named ceiling:
`claimTtlMinutes` defaults to 240, four hours against a five-hour quota window, so repos using quota
failover set it above their provider's longest window. The topology side deliberately cannot import
task-management, so this is a documented config line, not an invented cross-plugin heartbeat.

**Most likely failure: the trigger fires on a screen that is not the agent's own failure.** An agent
working on *this very feature* — reading `providers.mjs`, grepping `usage limit`, printing a fixture
— puts the signature on its own screen. Startup matching gets away with it because it looks only for
30 seconds, before the agent has done anything; a supervisor watching for hours will absolutely match
an agent quoting an error, and in `auto` that kills a healthy agent mid-task. Three cheap defences,
all required: the match must still be present on a second capture ≥2 s later (quoted text scrolls, a
dead provider's error is the last thing on screen); the pane must be dead or the agent must fail a
nonce probe before an incident is proposed; and `ask` is the default, so a false positive costs one
message rather than one provider.

## Phase 6 — the `role` CLI, designer and image-gen

`ao-topology role list|show|assign|reassign|detach|history` — one surface over `lead.mjs` and
`reviewer.mjs`, **not a replacement**. `lead.mjs` is not touched. New `topology/lib/roles.mjs` (~150
lines) holds a `ROLE_KINDS` table and dispatches: `assign lead` → `assignLead`, `assign reviewer` →
a new `assignReviewer`, `assign worker|designer|image-gen` → `createAgent` / set `role`. The
genuinely new code is `assignReviewer` / `detachReviewer` (mirroring the lead's, which `reviewer.mjs`
lacks), `roles.mjs`, and the CLI verb. Everything else is delegation.

Invariants preserved by delegating rather than reimplementing: at most one lead and one reviewer,
keyed on the git common directory; the reviewer is never the author and never the lead
(`assertIndependent`); no verb kills a live session except `detach --kill`, which delegates to
`detachLead`'s managed-only rule. And **`role status` prints `registered`, `alive` and `responsive`
as three separate fields** — this is the one place a convenience surface is tempted to print a single
"✓" and destroy the distinction the whole lead design rests on. It must not.

Reassignment is the new behaviour, and it is a handoff, not an eviction: probe the incumbent (an
unresponsive one is *reported*, never assumed dead); **detach the record, not the session** — the
outgoing holder's conversation, cwd, task claim and privileges are untouched, it stops being *the*
lead without stopping being an agent; assign the successor by nonce handshake; report
`privileges: "unchanged"`, because promotion cannot grant OS isolation a provider does not have.
In-flight standing mail stays addressed to the outgoing holder (rewriting delivered envelopes would
break `recordStandingReply`'s ownership check); new unvouched contact routes to the successor from
the moment the record flips, because `routeMessage` re-reads `findLead` per message. Each transition
appends to `stateRoot/roles/<repoKey>/<role>.history.jsonl`; the *current* holder always remains the
existing per-role registry record, so there is exactly one source of truth.

`designer` already exists — `roles/designer.md` is a real brief and `identity.mjs` titles it "Design
Engineer"; it needs one `ROLE_KINDS` entry, not authoring. `image-gen` is new: `roles/image-gen.md`
plus a `TITLES` entry. Brief it against the tooling actually installed here (`gpt-image-2`, `imagen`,
`ai-studio-image`, `fal-generate`, `stability-ai`; `fal-image-edit`/`fal-upscale`; `image-studio`;
the `magic` MCP `generate`) and, more importantly, against the **handoff contract**, because
`roles/judge.md` already imposes one: deliver the exact sizes the brief names with a manifest mapping
size → file → provenance (prompt, seed, model) so a regeneration is reproducible; raster is a
deliverable, never a substitute for source; `designer` keeps SVG-with-`viewBox` and `image-gen` never
ships an SVG traced from its own raster.

**At-most-one does not apply to worker, designer or image-gen.** The singleton rule exists for
specific reasons — the lead is the cross-repo front door, the reviewer is the independence guarantee
— and neither generalises. So `role show designer` returns a list, and the header groups these as a
set rather than rendering a single name.

## Phase 7 — Presence extension and the gateway terminal header

The operator approved the generic `terminal-presentation` SDK contribution from
`GATEWAY-SDK-PROPOSAL.md`. The header must show four things per pane: slot queue, unread mailbox
depth, agent state, current task.

**The frozen validator is decisive about what that costs.** `validate_presence.py` has **no key
whitelist** — per agent it rejects only ten named keys (`token`, `env`, `prompt`, `messages`, `auth`,
`diff`, `capture`, …). So additive keys pass the frozen validator and the frozen fixtures unchanged,
which is exactly the forward-compatibility §2 promises. But **closed vocabularies are enforced by
exact membership**: `repoRole ∈ {lead, reviewer, member}`, `runRole ∈ {orchestrator, worker, designer,
judge, reviewer, researcher, implementer}`, `lifecycle ∈ {starting, ready, busy, unresponsive, dead}`.
A new *value* in any of them fails. Therefore:

| Want | Verdict |
|---|---|
| slot queue, mailbox depth, agent state, current task | **additive v1 extension** — new keys |
| a richer state set on `lifecycle` | forbidden in v1; must ride as a **new key**, not a new value |
| standing `designer` / `image-gen` as `repoRole` | **`schemaVersion: 2`** |
| `image-gen` as `runRole` | **`schemaVersion: 2`** (`designer` is already legal) |

Additive keys are not a change to the wire *format*; opening a closed vocabulary is. Fields, each
checked against §5's hard exclusions: `activity` (a state label — the verdict, never the matched
screen line); `mailboxDepth: {depth, oldestAgeMs}` — **deliberately dropping `queueDepth`'s
`messages`, because those ids embed a stage slug that is close enough to a subject to be on the wrong
side of §5**; `task` — an id gated by `^[A-Z]+-[0-9]+$`, omitted rather than coerced, never a title;
`roleName` — the true library role, which v1 consumers ignore; `slots` / top-level `slotQueues` —
names, ids and integers, **with the operator-prose `reason` omitted**. `lifecycle` keeps its frozen
five and its frozen meaning (session lifecycle); `activity` is the work state. Two fields because
they answer two questions.

**A verified v1 bug this exposes, worth its own fix:** `collectPresenceAgents` skips any run agent
whose role is outside its local `ROLES` set — so an `image-gen` agent is **silently absent from
presence entirely**, not merely mislabelled. The v1-compatible framing is to map an unknown library
role to the nearest legal token (`runRole: "worker"`, `repoRole: "member"`) and carry the truth in
`roleName`. Nothing is dropped, nothing is misdeclared in a field a consumer validates, and the v2
negotiation becomes a pure vocabulary-opening rather than a data-shape change.

Run it as TM-128 was run, because that worked, and **make the producer depend on it rather than race
it**:

- **TM-A (blocking)** — commit `topology/PRESENCE-CONTRACT.md` (you cannot cite a freeze clause you
  do not hold), write the extension addendum with its §5 justification, add a **new**
  `topology/fixtures/presence-v1-header/` directory (never touch the frozen one) whose acceptance
  test is the sharpest available: **the frozen `validate_presence.py`, unmodified, passes every
  extended fixture**. Add a negative fixture proving `repoRole: "designer"` *fails* it — the evidence
  that the role vocabulary is genuinely v2. Gateway coordinator countersigns before any producer code
  merges.
- **TM-B (blocks on TM-A)** — the `schemaVersion: 2` negotiation opening the role vocabularies, with
  its own fixtures and countersignature.
- **TM-C (depends on TM-A)** — producer implementation: the additive keys, the unknown-role mapping
  fix, `slotQueues` from `slots.mjs`, `mailboxDepth` from `queueDepth`, `activity` from the census,
  `task` from the management record's `assignee`.

The gateway's v1 consumer already exists at
`origin/tm/TM-222-orchestration-terminals-consume-presence-and-gro`
(`plugins/orchestration-terminals/presence/`), unmerged into `develop`. That branch is the starting
point, and a v2 consumer must keep parsing v1.

**Before the header can label a standing designer, TM-B must land.** Do not promise it earlier.

---

## Execution: subagent fan-out

Phase 0 and 0.5 are single-threaded — they touch every file the rest need. After that, each worker
gets **its own git worktree on its own branch** and owns disjoint files. I am the integrator: I own
commits and merges of shared state, workers run no git in my tree, and I shut each one down once its
output is reviewed and folded in.

| Wave | Worker | Owns | Blocked by |
|---|---|---|---|
| 0 | `tm127-lander` | the TM-127 branch; `monitors/monitors.json`; the supervise-loop fixes; `PRESENCE-CONTRACT.md` | — |
| 1 | `delivery` | `topology/lib/delivery.mjs`, `providers/*.json` `composer` blocks + the codex fix, `send`/`ack`/`status`, `bootstrapText`, `waitForChannel` prefix | 0.5 |
| 1 | `census` | `topology/lib/census.mjs`, the census half of the tick, `cli.mjs census`, `listServerPanes` field list | 0.5 |
| 1 | `roles` | `topology/lib/roles.mjs`, `reviewer.mjs` assign/detach, `roles/image-gen.md`, `TITLES` | 0.5 |
| 2 | `slots` | `topology/lib/slots.mjs`, `reconcileSlots` in the tick, `cli.mjs slot` | 1 |
| 2 | `addressing` | `topology/lib/addressing.mjs`, the two-token change in `mailbox.mjs` | `census` |
| 2 | `quota` | `topology/lib/quota.mjs`, `failoverAgent` consent params | `slots` (binding re-stamp) |
| 3 | `dispatch` | `task-management/lib/dispatch/idle.mjs`, `collectIdle`, pool preference, `management` assign/release, CAP-0002 write-up | `census` |
| 3 | `presence-ext` | TM-A contract + fixtures, then TM-C producer keys | countersignature |

`topology/cli.mjs`, `topology/lib/supervision.mjs` and `topology/lib/tmux.mjs` are touched by several
workers, so **they are mine**: workers hand me patches for those three rather than editing them, or
take them in an order I sequence. Everything is tracked in `.bytedesk/task-management/` via
`.bytedesk/task-management/bin/tm` — resume TM-127, and open new tasks under EP-018 for the rest.

## Verification

Per phase, and again before the final merge:

```bash
cd agent-orchestration
npm run test:unit && npm run test:topology && npm run test:contract
npm run build:check && npm run roadmap:check
python3 topology/fixtures/presence-v1/validate_presence.py
python3 topology/fixtures/presence-v1/test_validator.py     # must pass UNCHANGED
```

If either presence script needs editing, the design has leaked into the frozen contract and is wrong.

End-to-end on real tmux, because unit tests cannot see the bugs this plan exists to fix:

1. Send to a **busy** agent → `held`, then `submitted` with `composer_empty_after: true` once it
   finishes. No draft clobbered.
2. Type into an agent's composer by hand and leave it. Send → `typed-unsubmitted` → rung `resubmit`
   → `submitted`, and the pointer on the pane **exactly once**.
3. Point an agent at `tests/fixtures/deaf-pane.mjs` → `ring-failed`, exit 3, and an `! UNDELIVERED`
   line in `status`. Not a silent success.
4. Submit to an agent that then does nothing → `submitted-inert` inside `AO_ENGAGE_MS`. That is
   TM-122 caught mechanically.
5. `census --json` while one agent runs a long tool → `working`, then **exactly one** `needs-input`
   edge, then `idle`.
6. Two agents `slot request integration` → one holder, one queued at position 1. Release the holder
   and the waiter is granted and rung **with no human or model in between**.
7. `send --to @idle` with one busy and one idle agent → exactly one delivery. `send --to @repo` from
   an external project → `TOPOLOGY_BROADCAST_EXTERNAL`.
8. Kill the supervise monitor, wait 40 s, confirm a consumer sees presence go stale — proving the
   heartbeat is real and that the monitor is what drives it.
9. `agent-browser` acceptance on the gateway header once Phase 7 lands: role badges, group borders,
   the slot queue, live updates, and terminals still alive through a plugin disable.
