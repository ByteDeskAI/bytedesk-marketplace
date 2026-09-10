# Provider quota failover

**What to do first:** if you have been told an agent looks cold or amnesiac after a failover, read
[What survives a failover](#what-survives-a-failover). It is not broken.

Two things happen, and they are deliberately separate acts:

1. **Detection** — the `ao-topology supervise` tick notices a provider quota signature on an
   agent's pane, confirms it, writes an incident and announces it. **It restarts nothing.**
2. **Takeover** — somebody runs `ao-topology failover --incident <id> --approved-by <who>`. This is
   where `failover.consent` is spent.

Splitting them is the whole design. A supervisor that could restart agents would be a scheduler
with a screen-scraper for a conscience.

## The gap this closes

`failureOnScreen` was consulted in exactly one place: startup readiness, for the ~30 seconds an
agent takes to come up. After that nobody looked at the screen again. The incident this feature
exists for happened **hours in**, when two agents hit

```
Error: [provider.auth_error] 403 You have reached your 5-hour usage limit
```

and were recovered only because a person noticed and authorised a Codex takeover by hand. We are
automating the *ask*, not the switch.

## Detection

`topology/lib/quota.mjs`, called from the supervise tick.

- The signature is already in `failure_patterns` — `"usage limit"` is the first entry of
  `GENERIC_ADAPTER.failure_patterns`, and the observed Kimi string survives `withoutPaths()`. **No
  provider JSON changed.** `attention_patterns` is the wrong home, and the ordering proves it:
  attention is checked *first* because it means "a human must press a key here", and quota
  exhaustion is not answerable at the keyboard.
- Only the **quota-shaped** entries of that list raise an incident (`QUOTA_SIGNATURE`). The full
  list is a *startup* list: `command not found` and `no such file or directory` are ordinary output
  from a working agent's shell, and `invalid api key` is not fixed by changing provider.
- `tmuxFailureTrigger(adapter)` compiles the patterns into a server-side ERE and
  `subscriptionFormat` subscribes through one tmux control-mode client per agent session. **The
  server pushes; we capture only when the trigger fires.** A quiet pane costs zero tmux calls.

### Not the same thing as the census

TM-131 gave `attention_patterns` an optional `state: "quota-blocked"` so `census.mjs` can *report*
an out-of-quota pane as a distinct work state. That is the **observation** path: per-adapter,
opt-in, and about scheduling — a quota-blocked agent is simply not `dispatchable`.

This is the **failover** path: it reads the generic `failure_patterns` every adapter inherits, and
its output is an incident somebody can act on. Neither reads the other's state, and an adapter with
no quota-blocked attention entry is still watched here.

### The three false-positive defences

An agent working on *this very feature* will put the signature on its own screen — reading
`providers.mjs`, grepping `usage limit`, printing a fixture. Startup matching got away with that
because it looked for 30 seconds, before the agent had done anything. A supervisor watching for
hours will absolutely match an agent quoting an error. All three defences are required:

1. **The match must still be present on a second capture at least 2 s later.** Quoted text scrolls;
   a dead provider's error is the last thing on the screen and stays there.
2. **The pane must be dead, or the agent must not be making progress.** This is not what the
   original brief asked for, and the difference matters — see below.
3. **`ask` is the default**, so a false positive costs one message, not one provider.

#### Why defence 2 is a progress test and not only a nonce probe

The brief asked for "the pane is dead **or** the agent fails a nonce probe". Taken literally that is
not a defence at all for most agents. `roles.mjs` reports `responsive: null` for every
non-singleton role, with the reason *"this role has no readiness handshake; alive is all that is
proven"* — only `lead` and `reviewer` carry the probe protocol in their prompts. A worker, designer
or image-gen agent therefore **cannot** answer a probe, so it fails one unconditionally, so the
clause would pass for every screen including the exact false positive it exists to reject.

What actually discriminates is whether the pane is making progress: a working pane animates, which
is the same evidence `census.mjs` classifies `working` from. `confirmQuota` takes an optional
`probe` seam for the real handshake where one exists — an **answered** probe vetoes the incident
outright, an unanswered one is positive evidence, and an unavailable one is neither.

## Consent

`failover.consent` in `config.defaults.json`, overridable through the global and repo config
layers, is one of:

| Value | Detection | Takeover |
|---|---|---|
| `ask` (default) | incident written, lead rung with the approval command | needs `--approved-by <who>` |
| `auto` | incident written, lead rung | applies **and announces**; no human turn |
| `never` | incident written, nothing announced | refused, whatever anyone types |

`auto` is not a loophole in the no-silent-substitution rule, and it should not be re-litigated. The
rule forbids **silent** substitution, not substitution. Somebody who sets `auto` consented in
advance, in writing, in config — and the announcement to the lead is what keeps it non-silent. It
is sent every time.

## What survives a failover

Three things, and they need three separate answers. The middle one is the one teams misread.

### The work survives

Same pane, same worktree, same branch. `startAgentInPane` respawns in place and re-sends the
bootstrap, which is what tells the new provider to **orient itself**: `git status`, `git log`, read
its `PROMPT_FILE`. It has no idea what the last provider had been doing.

### The conversation does not survive

A different CLI has a different memory. Nothing carries over.

**This is why `failoverAgent` re-delivers every unanswered message** rather than assuming they were
answered — and it is the fact most likely to be misread. A failed-over agent looks cold. It will
ask things it was already told. **It is not broken, and it does not need re-briefing as if it
were.** If your team does not know this, somebody will "fix" a perfectly healthy agent.

### The claim survives, with a named ceiling

The task claim is held by tm's dispatch heartbeat (`task-management/lib/dispatch/index.mjs`,
`startHeartbeat`), which keys off the worker registry rather than the pane, so a respawned pane
keeps the claim.

The ceiling: **`claimTtlMinutes` defaults to 240 — four hours, against a five-hour quota window.** A
repository that relies on quota failover must raise it above its provider's longest window, or a
claim expires mid-outage. The topology layer deliberately cannot import task-management, so this is
a documented config line rather than an invented cross-plugin heartbeat.

### And one thing that survives because TM-132 made it

`failoverAgent` re-stamps slot bindings after the respawn. A respawn keeps the pane but takes a new
`panePid`, so the agent's old six-tuple is provably absent, and a slot reconcile would otherwise
read that as "the holder is gone" and hand its cutover slot to the next in the queue.

## Commands

```bash
ao-topology quota status [--agent <id>] [--json]     # incidents in this repository
ao-topology failover --run <dir> --agent <id> \
    --incident <id> --approved-by <who>              # the takeover; spends failover.consent
ao-topology quota resolve --agent <id> --state declined --note "grep output, not an outage"
```

A failover with no `--incident` is unchanged from before: an operator at a keyboard is already the
human turn the consent gate exists to demand.

## Known limits

- **A standing agent cannot be failed over.** `failoverAgent` restarts an agent from the next
  candidate in the chain its **run record** declares, and a standing lead, reviewer or worker
  opened by `openRoleSession` is not in a run. Incidents are still raised for them — the
  announcement says so and points at `ao-topology role reassign` instead of printing an approval
  command that would refuse.
- One tmux control-mode client per agent session, capped by `AO_QUOTA_MAX_CLIENTS` (default 8).
  Past the cap the extra panes are reported as `unwatched`; they are never silently polled instead.
