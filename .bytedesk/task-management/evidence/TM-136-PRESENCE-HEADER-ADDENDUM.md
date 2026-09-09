# Presence v1 — header extension addendum (additive keys only)

**Status: proposed, awaiting gateway countersignature.** Marketplace **TM-136**.
Producer: `bytedesk-marketplace` / `agent-orchestration`.
Consumer: `bytedesk-remote-gateway` orchestration-terminals plugin (Gateway **TM-222** and its successor).

This document is an **addendum beside** `PRESENCE-CONTRACT.md`, never an edit to it. The contract is
frozen at sha256 `3748e32d26f6f7b3764009a95a2227c44a1b7107504f1934bace1c4d7a6297f5`, countersigned,
and this file does not change one byte of it. Nothing here alters `schemaVersion`, which stays `1`.

---

## 1. What this adds, and why it is still v1

The gateway terminal header must show four things per pane: **slot queue**, **unread mailbox depth**,
**agent state**, **current task**. Frozen Presence v1 carries none of them.

The frozen artifacts settle what carrying them costs, and the answer is mechanical rather than a
matter of taste. Read `fixtures/presence-v1/validate_presence.py` before disputing any of it:

- **There is no key whitelist.** Per agent the validator rejects exactly ten *named* keys —
  `token`, `tokens`, `env`, `prompt`, `prompts`, `messages`, `auth`, `credentials`, `diff`,
  `capture` — and is indifferent to every other key. The envelope check is likewise by named field.
  So **an additive key passes the frozen validator unchanged**, which is exactly the
  forward-compatibility §2 promises when it says unknown keys are *ignored, not rejected*.
- **Closed vocabularies are enforced by exact membership.** `repoRole ∈ {lead, reviewer, member}`,
  `runRole ∈ {orchestrator, worker, designer, judge, reviewer, researcher, implementer}`,
  `lifecycle ∈ {starting, ready, busy, unresponsive, dead}`, `enrollment`, `session.kind`. A new
  **value** in any of them fails.

The same is true of the real consumer, not only of the Python check. Gateway TM-222's
`plugins/orchestration-terminals/presence/presence.go` decodes into `map[string]any`, reads named
keys, and never calls `DisallowUnknownFields`; its only key-presence test is the same ten-name
exclusion list. An additive key is invisible to it.

> **Adding a key is not a change to the wire format. Opening a closed vocabulary is.**

| Want | Verdict |
|---|---|
| slot queue, mailbox depth, agent state, current task | **additive, stays `schemaVersion: 1`** |
| a richer state set on `lifecycle` | **forbidden in v1** — must ride as a new *key* |
| standing `designer` / `image-gen` as `repoRole` | **`schemaVersion: 2`** |
| `image-gen` as `runRole` (`designer` is already legal) | **`schemaVersion: 2`** |

The second half of that claim is not asserted, it is **demonstrated**:
`fixtures/presence-v1-header/n01-repo-role-designer.json` is a snapshot identical to a passing one
except for `repoRole: "designer"`, and the frozen validator rejects it. See §6.

## 2. `lifecycle` is unchanged, in values and in meaning

**`lifecycle` keeps its frozen five values — `starting`, `ready`, `busy`, `unresponsive`, `dead` —
and its frozen meaning: the lifecycle of a tmux *session*.** No value is added, removed or
reinterpreted. A v1 consumer that renders `lifecycle` today renders exactly the same thing after
this addendum.

Work state rides on the **new** `activity` key. Two fields because they answer two questions:

| Question | Field |
|---|---|
| Is this session alive and usable? | `lifecycle` |
| Is the agent in it doing anything right now? | `activity.state` |

A `ready` session whose agent is `idle` and a `ready` session whose agent is `working` are the same
`lifecycle` and different `activity`. Collapsing them into one field would either destroy the
session-liveness signal or require new `lifecycle` values, which is `schemaVersion: 2`.
`topology/lib/census.mjs:1-6` already states this separation as its own design premise.

## 3. The five additive agent keys

All are **optional**. A producer omits a key it cannot compute; a consumer treats an absent key as
"not known", never as a zero. Absence and zero are different facts — `mailboxDepth: {depth: 0}` says
the mailbox was read and was empty, and no `mailboxDepth` key says it was not read.

### 3.1 `activity` — the work state (object, optional)

```jsonc
"activity": {
  "state": "working",                    // required within the object
  "since": "2026-09-09T06:58:12.400Z",   // RFC3339 Z, when the state was entered
  "observed": true                       // false = carried-forward tombstone, not a live reading
}
```

`state` is one of the **seven** census states, verbatim from `CENSUS_STATES` in
`topology/lib/census.mjs:34`:

```
dead | quota-blocked | attention | working | needs-input | idle | unknown
```

> **This is seven values, not five.** The Phase 7 plan text and the TM-136 brief both write the set
> as `working|idle|needs-input|quota-blocked|dead`, omitting `attention` and `unknown`. The code is
> the authority and the code has seven. `unknown` in particular is **load-bearing and must not be
> dropped**: the census draws a deliberate line between "the screen was empty" and "I could not read
> the screen" (`census.mjs:13-15`), and a header that coerced `unknown` to `idle` would show a
> confidently wrong verdict every time the capture budget rationed a pane. `attention` is the
> non-quota half of the attention split at `census.mjs:152`. Narrowing the vocabulary here would
> force the producer to coerce, and coercion is the failure this whole contract exists to prevent.

`observed: false` marks a **tombstone** — the census's `carriedForward` row, kept for one tick so an
agent's disappearance is reported rather than silent (`census.mjs:243-252`). A consumer must not
render a tombstone as a current reading.

**§5 justification.** `activity.state` is a **verdict**: a label from a closed seven-value set. The
census also computes `reason` ("spinner on screen (working…)") and `evidence`, both of which are
*derived from captured terminal text*. §5 excludes captured terminal text without qualification, and
a quoted matched line is captured terminal text with extra steps. **Neither `reason` nor `evidence`
is ever emitted.** `since` is a timestamp and `observed` is a boolean; neither can carry content.

### 3.2 `mailboxDepth` — unread depth (object, optional)

```jsonc
"mailboxDepth": { "depth": 3, "oldestAgeMs": 91200 }
```

- `depth` — non-negative integer, the number of items waiting on this agent.
- `oldestAgeMs` — non-negative integer or `null` (`null` when no item has a usable timestamp).

Both come from `queueDepth()` in `topology/lib/mailbox.mjs:526-555`, whose reading is
`{agent, role, depth, oldest_age_ms, messages}`. Only two of those five cross the wire, renamed to
the contract's camelCase.

**§5 justification, and the judgement call in this task.** `queueDepth` also returns a `messages`
array. **It is deliberately dropped.** Those entries are message *ids*, and the ids are shaped
`<seq>-<stage>` — the stage slug is a human-chosen word describing what the message is about, which
is close enough to a **subject** to sit on the wrong side of §5's "mailbox message bodies or
subjects". §5 is a hard exclusion, so the tie is not resolved in favour of the header. `role` is
dropped as merely redundant with `runRole`, not for a §5 reason.

Note that **the frozen validator would not have caught this**: its exclusion check is `if banned in a`
against the top-level agent object, so a `messages` array nested inside `mailboxDepth` would pass.
§5 compliance here is a producer obligation that no automated gate enforces, which is precisely why
the judgement is written down rather than left to the diff.

### 3.3 `task` — the current task id (string, optional)

```jsonc
"task": "TM-136"
```

A single id matching `^[A-Z]+-[0-9]+$`. **Omitted, never coerced**, when the agent has no assignment
or the value does not match the pattern. Never a title, a branch name, a body, or a free-text
summary.

The producer's own store is narrower still — `topology/lib/management.mjs:13` gates on
`^TM-[0-9]+$`. The wire pattern is deliberately prefix-agnostic so that a second task store with a
different prefix needs no consumer change.

**§5 justification.** §5 excludes **task bodies**. An id is not a body: it is an opaque handle whose
information content is a pointer, and a gateway operator who can see the terminal can already see
the task. A title would be free text authored by a human and is excluded.

### 3.4 `roleName` — the true library role (string, optional)

```jsonc
"roleName": "image-gen"
```

The producer's own role token for this session, verbatim from the agent library entry or the run
spec, **unconstrained by v1's closed vocabularies**. It exists so that `runRole` never has to lie
(§4) and so that the `schemaVersion: 2` negotiation is a pure vocabulary-opening rather than a
data-shape change.

**A v1 consumer ignores it, and that is correct.** It is display metadata, never a grouping key and
never a substitute for `repoRole` when labelling "Team lead" — §3 of the contract still stands:
*"Team lead" is rendered from `repoRole === "lead"` and from nothing else.*

**§5 justification.** A role token from a fixed producer-side vocabulary. No prose, no user content.

### 3.5 `slots` — this agent's serial-slot standing (object, optional)

```jsonc
"slots": {
  "held":    ["integration"],
  "waiting": [ { "name": "release-train", "position": 1 } ]
}
```

- `held` — array of slot names this agent currently holds.
- `waiting` — array of `{name, position}`; `position` is a 1-based integer place in that slot's queue.

**§5 justification.** Slot names are configuration identifiers; positions are integers. The slot
record also carries a **`reason`** — operator prose that may quote a task title, a commit message or
a sha. **`reason` is omitted.** §5 names no category called "operator prose", but every category it
does name is a way of saying *no free text authored for humans*, and a reason string is exactly that.
When a field's §5 status is arguable, this addendum omits it; the header is a status line, not a log
viewer.

## 4. The one envelope-level additive key: `slotQueues`

```jsonc
"slotQueues": [
  {
    "name": "integration",
    "holder": "b4h6rt1c",                      // agentId, or null when free
    "heldSince": "2026-09-09T06:41:02.000Z",   // RFC3339 Z, or null when free
    "waiting": ["s2v7ho3j", "d7m2xw9e"]        // agentIds, in queue order
  }
]
```

Slot queues are repository-scoped, so the authoritative copy is one list on the envelope; per-agent
`slots` (§3.5) is the projection a header needs without cross-referencing. A consumer that finds the
two disagreeing should trust `slotQueues` and report the drift — they are written in the same
snapshot from the same read, so disagreement is a producer bug.

Contract §2 already states that unknown **envelope** keys are ignored, not rejected, so this is
additive by the same argument as §1.

## 5. Full worked example

`fixtures/presence-v1-header/` holds the fixtures. `h01-header-full.json` carries every key on a
five-agent snapshot; `h02-header-sparse.json` carries the omission cases — no `task` where the id
does not match, no `mailboxDepth` where the mailbox was not read, an `activity` tombstone, and the
unknown-role agent of §7.

## 6. Acceptance: the frozen validator, unmodified

The sharpest test available is that **the frozen `validate_presence.py` passes every extended
fixture without being edited**, and **fails the negative fixture**:

```bash
python3 topology/fixtures/presence-v1/validate_presence.py \
        topology/fixtures/presence-v1-header/h01-header-full.json \
        topology/fixtures/presence-v1-header/h02-header-sparse.json      # exit 0

python3 topology/fixtures/presence-v1/validate_presence.py \
        topology/fixtures/presence-v1-header/n01-repo-role-designer.json # exit 1
```

`topology/fixtures/presence-v1-header/check.py` runs both directions and is the single command
either repository can use. It is also wired into the marketplace's own suite at
`tests/unit/topology-presence-header.test.mjs`, so it runs on every `npm run test:topology` rather
than being a claim in a document.

The frozen directory is untouched: `validate_presence.py`, `test_validator.py`, the seven fixtures
and `PRESENCE-CONTRACT.md` all keep their pre-existing hashes. `HEADER-EXTENSION-HASHES.txt` in the
new directory records the hashes of the new artifacts alongside the frozen contract hash.

## 7. A verified v1 producer bug fixed under this addendum

`topology/lib/presence.mjs` declares a private `ROLES` set and, **inside the run-agent loop only**,
skips any agent whose role is not in it:

```js
for (const agent of record.agents ?? []) {
  if (!ROLES.has(agent.role)) continue;   // <- the bug
```

The consequence is worse than a mislabel: `add()` is never called, so the agent has **no entry in the
snapshot at all**. A run agent whose library role is `image-gen` — or `lead`, which is likewise
absent from that set — simply vanishes from presence. The standing loop above it has no such filter,
so a *standing* `image-gen` role-session is unaffected; the symptom is specific to an agent inside a
workflow run.

The v1-compatible fix, applied here:

- an unknown library role maps to the nearest legal token — `runRole: "worker"`, and `repoRole`
  already defaults to `"member"` for anything that is not `lead`/`reviewer`;
- the truth rides in `roleName` (§3.4).

Nothing is dropped, nothing is misdeclared in a field a consumer validates, and the eventual
`schemaVersion: 2` negotiation becomes a pure vocabulary-opening.

`topology/lib/spec.mjs` exports the same seven-name list and also lacks `image-gen`, but there it
only feeds an advisory message — `ID_PATTERN` is the real gate and `image-gen` passes it. It is
harmless today and is **left alone**: unifying the two lists is a refactor with its own blast radius
and no bug behind it.

## 8. Producer obligations added

Additions to contract §9. Nothing there is removed or weakened.

1. Every additive key is optional; emit a key only when its value was actually computed. Never emit
   a zero or a placeholder to stand in for "not read".
2. `activity.state` is one of the seven census states, verbatim. Never `reason`, never `evidence`,
   never a captured line.
3. `mailboxDepth` carries `depth` and `oldestAgeMs` only. Never `messages`.
4. `task` matches `^[A-Z]+-[0-9]+$` or is omitted. Never coerced, never a title.
5. `slots` / `slotQueues` carry names, agent ids, positions and timestamps only. Never `reason`.
6. An unknown library role maps to a legal `runRole` token with the truth in `roleName`. Never
   emitted verbatim into `runRole`, and never a reason to drop the agent.

## 9. Consumer obligations added

Additions to contract §10.

1. Treat every key in §§3-4 as optional. Absent ≠ zero.
2. Keep rendering `lifecycle` exactly as before; it has not changed.
3. Render an unrecognised `activity.state` as unknown rather than rejecting the snapshot — this
   addendum fixes the set at seven, but a v1 consumer must survive a v1.x producer, which is the
   whole basis of §1.
4. Never render `activity` when `observed` is `false` as a live reading; it is a tombstone.
5. `roleName` is display metadata. Never group on it, never label "Team lead" from it.
6. A v2 consumer **must keep parsing v1**. `schemaVersion: 1` snapshots do not disappear when the
   role vocabularies open.

## 10. What is explicitly deferred to `schemaVersion: 2`

- Opening `repoRole` to `designer`, `image-gen` or anything else.
- Opening `runRole` to `image-gen`.
- Any new `lifecycle` value.
- Any change to the six-tuple binding, the grouping rules, or the counters.

Each of those fails the frozen validator by construction, and `n01-repo-role-designer.json` is the
standing proof for the first.

## 11. Countersignature

This addendum takes effect when the gateway coordinator countersigns. The request, with the hashes
and the specific confirmations being asked for, is at
`topology/HEADER-EXTENSION-COUNTERSIGNATURE-REQUEST.md`.

**No producer code emitting these keys merges before that countersignature.** The one producer change
that lands with this document is the §7 unknown-role fix, which emits only `roleName` and is provably
v1-safe by the same argument as every other additive key.

— Marketplace Claude, TM-136, 2026-09-09
