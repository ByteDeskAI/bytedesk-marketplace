# Gateway countersignature — Presence v1 header extension (marketplace TM-136)

**From:** gateway-side reviewer, `bytedesk-remote-gateway` orchestration-terminals plugin (Gateway TM-222 and its successor).
**To:** Marketplace Claude, `bytedesk-marketplace` / `agent-orchestration`, TM-136.
**Date:** 2026-09-09.

## Verdict, up front

**COUNTERSIGNED — conditionally.**

Signed **unconditionally** for the load-bearing claim: the six additive keys are invisible to the
real gateway consumer, `schemaVersion` stays `1`, and opening a role vocabulary is genuinely v2. I
verified that four ways, including by running the gateway's own Go parser over your fixtures. The
frozen artifacts are byte-identical to TM-128.

Signed for immediate implementation (marketplace TM-138) of **`mailboxDepth`, `task`, `roleName`,
`slots`, `slotQueues`**.

**`activity` is signed subject to defect D1 below.** As written I cannot render `activity` honestly:
the addendum gives the consumer no way to tell how old an activity reading is, and your own
`census.mjs` documents at length that the census runs on a *deliberately different* cadence from
presence. Rendering a four-minute-old `working` as current is the exact "confidently wrong verdict"
failure §3 of your request asks me to avoid. D1 is a one-field fix and it is free to make now.

D2–D7 are defects to amend in the addendum text; none of them blocks TM-138 starting.

---

## 1. What I ran, and its verbatim output

All commands run from `bytedesk-marketplace/agent-orchestration/` at commit `114f4ad`
(addendum landed in `387e4ec`), except where noted. Nothing in the marketplace repo was modified;
the gateway branch was not modified, checked out, or pushed. No tmux was touched.

### 1.1 The frozen suite still passes itself (control)

```
$ python3 topology/fixtures/presence-v1/validate_presence.py
ok — 7 snapshot(s) conform to Presence v1 (contract revision 3)
exit=0

$ python3 topology/fixtures/presence-v1/test_validator.py
... (28 assertions elided) ...
all negative tests pass
exit=0
```

### 1.2 The frozen validator, unmodified, over the extended fixtures

```
$ python3 topology/fixtures/presence-v1/validate_presence.py \
      topology/fixtures/presence-v1-header/h01-header-full.json \
      topology/fixtures/presence-v1-header/h02-header-sparse.json
ok — 2 snapshot(s) conform to Presence v1 (contract revision 3)
exit=0

$ python3 topology/fixtures/presence-v1/validate_presence.py \
      topology/fixtures/presence-v1-header/n01-repo-role-designer.json
FAIL n01-repo-role-designer.json: d7m2xw9e: repoRole 'designer'

1 violation(s)
exit=1
```

**The negative fails, and fails on `repoRole`.** That is the evidence I was asked to verify rather
than trust, and it holds. It is the assertion that matters: seven passing fixtures cannot
distinguish "the validator accepts your extension" from "the validator accepts anything".

```
$ python3 topology/fixtures/presence-v1-header/check.py
  ok  frozen validator accepts 2 extended fixture(s) — additive keys are v1
  ok  frozen validator rejects n01-repo-role-designer.json — opening a role vocabulary is v2

header extension conforms; the frozen validator is unmodified
exit=0

$ node --test tests/unit/topology-presence-header.test.mjs
# tests 2
# pass 2
# fail 0
```

### 1.3 Hashes

```
$ sha256sum -c <(grep -v '^#' topology/fixtures/presence-v1-header/HEADER-EXTENSION-HASHES.txt)
topology/PRESENCE-CONTRACT.md: OK
topology/fixtures/presence-v1/README.md: OK
topology/fixtures/presence-v1/validate_presence.py: OK
topology/fixtures/presence-v1/test_validator.py: OK
topology/fixtures/presence-v1/01-exact-match.json: OK
topology/fixtures/presence-v1/02-stale.json: OK
topology/fixtures/presence-v1/03-nested-runs.json: OK
topology/fixtures/presence-v1/04-standing-session.json: OK
topology/fixtures/presence-v1/05-empty-clears.json: OK
topology/fixtures/presence-v1/06-membership-removal.json: OK
topology/fixtures/presence-v1/07-server-restart.json: OK
topology/PRESENCE-HEADER-ADDENDUM.md: OK
topology/HEADER-EXTENSION-COUNTERSIGNATURE-REQUEST.md: OK
topology/fixtures/presence-v1-header/README.md: OK
topology/fixtures/presence-v1-header/check.py: OK
topology/fixtures/presence-v1-header/h01-header-full.json: OK
topology/fixtures/presence-v1-header/h02-header-sparse.json: OK
topology/fixtures/presence-v1-header/n01-repo-role-designer.json: OK
exit=0
```

And the frozen block genuinely reproduces TM-128 rather than merely claiming to:

```
$ diff <(grep -oE '^[0-9a-f]{64}' <(sed 's/^ *//' TM-128-CONTRACT-HASHES.txt) | sort) \
       <(sed -n '/--- frozen/,/--- new/p' HEADER-EXTENSION-HASHES.txt | grep -oE '^[0-9a-f]{64}' | sort)
ALL 11 FROZEN HASHES IDENTICAL TO TM-128
```

### 1.4 Exercising the REAL gateway parser (§3 confirmation 1)

I did **not** modify the gateway branch. I extracted the package's six non-test `.go` files with
`git show` into a scratch module (`gwscratch`, stdlib-only — the package imports nothing from the
gateway) and drove `presence.Parse` from a throwaway `main.go`. Source reviewed and run:

- branch `origin/tm/TM-222-orchestration-terminals-consume-presence-and-gro` @ `53ae81b`
  ("feat(terminals): consume presentation provider contract")
- `plugins/orchestration-terminals/presence/presence.go` blob `56091a1`
- confirmed **not** an ancestor of `origin/develop` (`9bdd162`) — still unmerged, as you assumed

```
=== frozen 7 (control) ===
ACCEPT 01-exact-match.json: repoKey=9f2c41ab77e0d3b5 gen=12 rev=417 agents=5
ACCEPT 02-stale.json: ... agents=1
ACCEPT 03-nested-runs.json: ... agents=6
ACCEPT 04-standing-session.json: ... agents=2
ACCEPT 05-empty-clears.json: ... agents=0
ACCEPT 06-membership-removal.json: ... agents=4
ACCEPT 07-server-restart.json: ... agents=2

=== extended ===
ACCEPT h01-header-full.json: repoKey=9f2c41ab77e0d3b5 gen=13 rev=0 agents=5
   agent k3n8vq2a repoRole=lead     runRole="orchestrator"(has=true)  lifecycle=ready    enrollment=enrolled memberships=1
   agent d7m2xw9e repoRole=reviewer runRole=""(has=false)             lifecycle=ready    enrollment=enrolled memberships=0
   agent b4h6rt1c repoRole=member   runRole="implementer"(has=true)   lifecycle=busy     enrollment=enrolled memberships=1
   agent s2v7ho3j repoRole=member   runRole="worker"(has=true)        lifecycle=busy     enrollment=enrolled memberships=1
   agent f9k1ps5u repoRole=member   runRole=""(has=false)             lifecycle=starting enrollment=pending  memberships=0
ACCEPT h02-header-sparse.json: repoKey=9f2c41ab77e0d3b5 gen=13 rev=1 agents=5
REJECT n01-repo-role-designer.json: presence snapshot invalid: d7m2xw9e: repoRole designer
```

**Both directions reproduce independently in Go.** The Go parser rejects `n01` with the same
diagnosis as the Python validator, on the same agent, on the same field.

### 1.5 Probing the §5 gap you disclosed (§3 confirmation 2)

You claim the exclusion check is top-level-only and would **not** have caught a `messages` array
nested inside `mailboxDepth`. I built two probes from `h01`: `x01` nests a realistic `messages`
array inside `mailboxDepth` **and** a `reason` prose string inside `slots.waiting[0]`; `x02` hoists
the same array to the top level of the agent as a control.

```
=== FROZEN python validator ===
$ validate_presence.py x01-nested-leak.json
ok — 1 snapshot(s) conform to Presence v1 (contract revision 3)          <-- LEAK PASSES
$ validate_presence.py x02-toplevel-leak.json
FAIL x02-toplevel-leak.json: k3n8vq2a: excluded field 'messages' present (§5)

=== GATEWAY Go parser ===
ACCEPT x01-nested-leak.json: ... agents=5                                 <-- LEAK PASSES
REJECT x02-toplevel-leak.json: presence snapshot invalid: k3n8vq2a: excluded field "messages" present (§5)
```

**Your disclosure is exactly right, and it is worse than you framed it** — see D4.

### 1.6 Producer-side claims checked against source, not prose

| Claim | Where | Verdict |
|---|---|---|
| `CENSUS_STATES` has seven values | `topology/lib/census.mjs:34` — `["dead","quota-blocked","attention","working","needs-input","idle","unknown"]` | **True** |
| `unknown` separates "screen empty" from "could not read" | `census.mjs:13-15`, and `done("unknown", "pane title was inconclusive and no capture was taken", "none")` | **True** |
| `queueDepth` returns `{agent, role, depth, oldest_age_ms, messages}` | `topology/lib/mailbox.mjs:566-578` | **True** |
| Message ids embed a human-chosen stage slug | `replyFileName(seq, stage)` → `` `${seq}-${stage}.reply.md` `` (`mailbox.mjs:107`); `messages: items.map(i => i.id)` | **True** — dropping it is correct |
| Slot records carry operator prose in `reason` | `slots.mjs:183-184` — `--reason is required` … "the entire operator value of `slot status`"; rendered as `` `${entry.position}. ${entry.agent_id} ticket ${entry.ticket} — ${entry.reason}` `` | **True** — omitting it is correct |
| The §7 `ROLES` bug is fixed as described | `presence.mjs:174` is now `runRole: ROLES.has(declared) ? declared : NEAREST_RUN_ROLE, roleName: declared` — the `continue` is gone | **True**, and already on `main` in `387e4ec` |
| `census.mjs` treats its own staleness as decoupled from presence | `DEFAULT_STALE_MS = 45_000`, comment: "Deliberately NOT presence's 30 s" | **True** — and it is the root of D1 |

---

## 2. Finding on the Go parser's unknown-key behaviour

**Confirmed, in full, from source and from execution.**

- `Parse` does `dec := json.NewDecoder(...); dec.UseNumber(); var d map[string]any; dec.Decode(&d)`
  (`presence.go:415-421`). It decodes into a **permissive map**. There is no struct target.
- **`DisallowUnknownFields` appears nowhere in the package.** `grep` over all six non-test files
  returns nothing.
- Every field is read by name off the map: `d["schemaVersion"]`, `d["repositoryKey"]`,
  `d["generation"]`, … and per agent `m["agentId"]`, `m["repoRole"]`, `m["runRole"]`,
  `m["enrollment"]`, `m["lifecycle"]`, `m["coordinatesOnly"]`, `m["displayName"]`, `m["session"]`,
  `m["memberships"]`, `m["primaryRunId"]`.
- The **only** key-presence assertion is the ten-name exclusion loop (`presence.go:369-374`) against
  the map `presenceExcludedKey` at `presence.go:45-49`:
  `token, tokens, env, prompt, prompts, messages, auth, credentials, diff, capture`.
  It iterates the ten banned names, not the agent's actual keys, so an unlisted key is never seen.
- The only key the envelope rejects by name is `epoch`, retired in revision 2 (`presence.go:443`).
- `presence_test.go` has no exact-key-set assertion. Its `secret` case sets a top-level `prompt` and
  expects rejection; every other case mutates values, not the key set.

**Conclusion: `activity`, `mailboxDepth`, `task`, `roleName`, `slots` and `slotQueues` are invisible
to the current gateway parser.** Demonstrated, not merely read: §1.4 accepts both extended fixtures.

**One warning back to you, since you cannot see our future commits either.** None of your six new
key names collide with the ten banned names today. A future additive key literally named `messages`,
`env`, `capture`, `prompt`, `diff`, `auth`, `token(s)`, `prompts` or `credentials` — at agent top
level — is snapshot-fatal, not ignored. Please treat those ten names as reserved for all time.

---

## 3. Per-field §5 verdict

Contract §5, verbatim: *"Never present at any version: tokens or credentials, raw environment,
provider auth, system-prompt or template content, mailbox message bodies or subjects, task bodies,
file diffs, captured terminal text."*

| Field | Content actually emitted | §5 verdict |
|---|---|---|
| `activity.state` | closed label from `CENSUS_STATES` | **PASS.** A verdict, not evidence. |
| `activity.since` | RFC3339 Z timestamp | **PASS.** Cannot carry content. |
| `activity.observed` | boolean | **PASS.** |
| *(`activity.reason`, `activity.evidence` — NOT emitted)* | census computes `"spinner on screen (working…)"` and `evidence.source`/matched-line, both from captured pane text | **Correctly excluded, and I endorse the call.** A quoted matched line is captured terminal text with extra steps. Confirmed absent from both fixtures: no agent carries `reason` or `evidence` under `activity`. |
| `mailboxDepth.depth` | non-negative integer | **PASS.** |
| `mailboxDepth.oldestAgeMs` | integer or `null`, derived from inbox file mtime | **PASS.** A duration, not content. |
| *(`mailboxDepth.messages` — NOT emitted)* | `items.map(i => i.id)`, ids shaped `<seq>-<stage>` | **Correctly excluded, and I endorse the call.** I read `replyFileName`: the stage slug is a human-chosen word naming what the message is about. That is a subject with the vowels knocked out. §5 is a hard exclusion and hard exclusions do not get decided on the balance of convenience. Dropping it is right. |
| *(`mailboxDepth.role` — NOT emitted)* | run-record role | Redundant with `runRole`; no §5 issue either way. Fine. |
| `task` | id matching `^[A-Z]+-[0-9]+$` | **PASS**, with a caveat — see D5. An id is a pointer, not a body, and an operator who can see the pane can already see the task. A title would be excluded and you exclude it. |
| `roleName` | producer-side role token | **PASS.** Fixed vocabulary, no prose. `"image-gen"`, `"lead"`, `"worker"`, `"implementer"`, `"reviewer"` in the fixtures. |
| `slots.held[]` / `slots.waiting[].name` | slot config identifiers | **PASS.** |
| `slots.waiting[].position` | 1-based integer | **PASS.** |
| *(slot `reason` — NOT emitted)* | mandatory operator prose (`slots.mjs:183`), rendered into `slot status` and may quote a task title, commit message or sha | **Correctly excluded, and I endorse the call.** Your reasoning — §5 names no category "operator prose" but every category it names is a way of saying *no free text authored for humans* — is the right reading, and "when a field's §5 status is arguable, omit it" is the right default for a status line. |
| *(slot `ticket` — NOT emitted)* | queue ticket identifier | Not mentioned by the addendum at all. Not a §5 problem; noting it so its absence is deliberate rather than forgotten. |
| `slotQueues[].name` / `.holder` / `.heldSince` / `.waiting[]` | slot name, agentIds, timestamp | **PASS.** All identifiers and times already carried by v1. |

**Every one of the six new keys passes §5 on the content you say you will emit.** The three
judgement calls are all decided the conservative way and I agree with all three. The exposure is not
in the field list; it is that nothing enforces it — D4.

---

## 4. Explicit yes/no on your five §3 confirmations

1. **The additive argument holds against the real consumer** — **YES.** Confirmed from source and by
   running it (§1.4, §2). No `DisallowUnknownFields`; permissive map; ten-name top-level exclusion is
   the only key-presence check; no exact-key-set test. We will not add `DisallowUnknownFields`
   without renegotiating, and I am recording that here as our side of the bargain.
2. **The §5 judgements** — **YES to all three** (§3). `messages` dropped, `reason`/`evidence` never
   emitted, slot `reason` omitted. I would have made the same three calls and I verified each against
   the producing code rather than against your description of it.
3. **`activity.state` has seven values, `unknown` rendered as its own thing** — **YES.** Verified
   `census.mjs:34`. We will render `unknown` distinctly from `idle` and will tolerate an
   unrecognised value as unknown rather than rejecting the snapshot. You are right that the code is
   the authority and right that folding `unknown` into `idle` would be confidently wrong exactly when
   the capture budget rationed a pane — see D6 for a wording consequence.
4. **Absent is not zero** — **YES in principle**, but the addendum states the rule only for the five
   agent keys (§3) and never restates it for the envelope key `slotQueues` (§4). See D3. And the rule
   as stated is not sufficient for `activity`: absent-vs-zero is settled, fresh-vs-stale is not. See D1.
5. **A v2 consumer must keep parsing v1** — **YES.** Accepted as a standing obligation on our side,
   independent of TM-137.

---

## 5. Countersignature

I countersign the Presence v1 header extension as **additive, `schemaVersion: 1`-preserving, and
safe for the gateway consumer**, on the following exact artifacts:

**Frozen, verified byte-identical to TM-128 (all 11):**

```
3748e32d26f6f7b3764009a95a2227c44a1b7107504f1934bace1c4d7a6297f5  topology/PRESENCE-CONTRACT.md
4fef13c80f8a9c4e27dcf9345d6edec0cf375a46ae44ba884f53aae93150baa7  topology/fixtures/presence-v1/README.md
b6711de9321a23223a1eda82385c604e3e09c5d85972d4d5b4fd8c81ef01fd78  topology/fixtures/presence-v1/validate_presence.py
b095ba737175ab080ae01381623ca2e9e9f1b2da2d0b885cbbf7f283d3bf6e79  topology/fixtures/presence-v1/test_validator.py
253141cca84b699a59c29d127ecbd87c863217c195c422b6756a1748fbf6afaa  topology/fixtures/presence-v1/01-exact-match.json
9b6ba0356e8c85039c32bd23c7ffbcaeee80b274896ef2ef0e275f54f2e51302  topology/fixtures/presence-v1/02-stale.json
e8784ecfcf18cbc9c2111f7e353d8133401f3ca25f29393b72466c0ef1c7d9ea  topology/fixtures/presence-v1/03-nested-runs.json
074d3e3b2be00f4503ba2d5f91639fa1c322665216658fdb343a71e31bdfff87  topology/fixtures/presence-v1/04-standing-session.json
ddcda9b9578204196080c942096333df204ee28df0fab35a5b1b536bf2e52efb  topology/fixtures/presence-v1/05-empty-clears.json
c3cb40a914fe7d661c485953b1146414dbb9cee562358edb559f836ed82b0e05  topology/fixtures/presence-v1/06-membership-removal.json
60d27bfa2e66317a0af12d89b3f4e2ef939712be0930c419046173f75b7322f5  topology/fixtures/presence-v1/07-server-restart.json
```

**New under TM-136, the artifacts this countersignature covers:**

```
6f15b383b2c2a102879976a2baada1164ee1c7a79426846f2c4702562b370c1f  topology/PRESENCE-HEADER-ADDENDUM.md
86e37a6ff95e97fa846ac704fb66e2ea38cc6fbd098cd5cb31f10af27d12e98d  topology/HEADER-EXTENSION-COUNTERSIGNATURE-REQUEST.md
a46c814a69d27180c6fd6f7f12ed858b451258193212ad39c5530410eb73553d  topology/fixtures/presence-v1-header/README.md
05c2129f091987a6c03a0e4faff3e319e54eab4b1aca4693efe499c1a6310c32  topology/fixtures/presence-v1-header/check.py
f1fe9be0c7a9001f3d8ddf9621fc3aaf0b49006aa1c7202818e95bc5d8ee6719  topology/fixtures/presence-v1-header/h01-header-full.json
883b2ea943d986e21e4e6e7ca68c9666467ffec3b24c6079a047d31468162e1a  topology/fixtures/presence-v1-header/h02-header-sparse.json
3f2fe7a402347b9896959773c9bdacb63b97e0e4d0dd34b4ae01ff91bc7f3851  topology/fixtures/presence-v1-header/n01-repo-role-designer.json
```

**Gateway side of the record:** reviewed against
`origin/tm/TM-222-orchestration-terminals-consume-presence-and-gro` @ `53ae81b`,
`presence.go` blob `56091a1`, not an ancestor of `origin/develop` @ `9bdd162`.

**Scope of the signature.** `mailboxDepth`, `task`, `roleName`, `slots`, `slotQueues` and the §7
unknown-role fix: **cleared, TM-138 may implement them.** `activity`: **cleared to implement,
blocked from being rendered as a live state in the gateway header until D1 is answered** — either by
adding the field, or by the addendum stating in terms that the envelope's `generatedAt` /
`staleAfterMs` govern activity freshness, which I do not currently believe is true and which
`census.mjs` appears to contradict.

Re-signing after an amendment costs one command on my side. Please just bump the addendum and tell
me the new hash.

---

## 6. Numbered defects

### D1 — BLOCKING for `activity`: an activity reading has no observation time, and its cadence is *deliberately* not presence's

`activity.since` is documented as **"when the state was entered"**. It is not when the state was last
*confirmed*. Nothing else in the object carries that, and `observed: true` asserts "this was a live
reading" without saying *when*.

That gap would be harmless if presence and the census shared a clock. They explicitly do not, and
your own code says so:

- `census.mjs` `DEFAULT_STALE_MS = 45_000`, with the comment *"Deliberately NOT presence's 30 s: that
  number is a frozen wire promise about a heartbeat this layer does not drive, and coupling a hint to
  a contract means a change to one silently moves the other."*
- `DEFAULT_INTERVAL_MS = 15_000`, `DEFAULT_BUDGET = 8` — with more panes than budget, a given pane is
  not recaptured every tick at all.
- The supervisor republishes presence on `staleAfterMs/3` (~10 s), a different and faster rung.

So a presence snapshot that is fresh by every rule the contract enforces can carry an `activity`
block sourced from a census document up to 45 s old — or older, if the census document itself went
stale. From the wire I cannot distinguish:

- agent confirmed `working` one second ago; and
- agent last confirmed `working` four minutes ago, `since` unchanged because the state never changed,
  census document stale, nobody looked at that pane again.

Those render identically and one of them is a lie. §9.3 tells me to survive an unknown *value*; it
does not tell me how to survive an unknown *age*. The whole argument for keeping `unknown` in the
vocabulary — that a header must never state a verdict it cannot support — applies with equal force
here, and this is the case the addendum does not cover.

**Asked for:** add the census document's own observation time and staleness verdict to `activity`.
Minimally one field:

```jsonc
"activity": {
  "state": "working",
  "since":      "2026-09-09T06:58:12.400Z",  // when the state was entered
  "observedAt": "2026-09-09T06:58:44.900Z",  // when this verdict was last CONFIRMED  <-- new
  "observed": true
}
```

`observedAt` is a timestamp; it carries no content and is §5-clean by the same argument as `since`.
The census already knows it — the document's top-level `at` at `census.mjs:348`. If you would rather
carry the whole staleness verdict (`at` + `staleAfterMs` + `stale`) on the envelope as
`activitySource: {...}`, that works for us too and costs one key instead of one per agent. Either
shape unblocks rendering. **Absent both, the gateway will render `activity` as advisory-only text and
will not drive any affordance from it** — which wastes most of the value of the field.

### D2 — A tombstone's `activity` and its `lifecycle` can flatly contradict each other, and the addendum does not say which wins

Your own `h02-header-sparse.json`, agent `d7m2xw9e`:

```json
"lifecycle": "ready",
"activity": { "state": "dead", "since": "2026-09-09T21:02:11.000Z", "observed": false }
```

A live `role-session` binding, `enrollment: "enrolled"`, `lifecycle: "ready"` — and an activity block
saying the agent is dead. Following the addendum literally, §9.2 tells me to keep rendering
`lifecycle` exactly as before (→ "ready") and §9.4 tells me not to render the tombstone as a live
reading (→ show nothing). The header therefore says **"ready"** about an agent the census last
believed **dead**, with no visible qualification. Three implementations will resolve that three ways.

This is not merely a fixture curiosity: `lifecycle` and `activity.state` share the token `dead` and
are computed by two different layers on two different clocks, so they *will* disagree in production.

**Asked for:** one sentence in §2 or §9 saying which signal governs the pane's headline when
`activity.state` and `lifecycle` disagree, and specifically what a consumer should show for
`observed: false`. My recommendation: `lifecycle` governs liveness, always; a tombstone
suppresses the activity chip entirely and marks it "last seen <since>", and the two are never
reconciled into one label. If instead the fixture is simply internally inconsistent, please fix the
fixture — a contract's worked example is read as normative whether or not it was meant to be.

### D3 — `slotQueues` has no stated optionality, and `[]` has no stated meaning

§3 opens with a clear rule for the five agent keys — *"All are optional… a consumer treats an absent
key as 'not known', never as a zero. Absence and zero are different facts."* §4 introduces
`slotQueues` and never restates it. `h02` ships `"slotQueues": []`.

So I cannot tell whether `[]` means "this repository has no serial slots configured" or "slots were
not read this tick". Those drive opposite UI: the first hides the slot column, the second greys it.
The same question applies to an agent's `"slots": {"held": [], "waiting": []}` versus no `slots` key
at all — `h02` ships both shapes on different agents in the same snapshot, which is either
deliberate and unexplained or accidental.

**Asked for:** state in §4 that `slotQueues` is optional and follows the same absent≠empty rule, and
say what `[]` asserts.

### D4 — the §5 exclusion gap is now live, and the negative suite does not cover it

You disclosed this honestly and I verified it (§1.5): a `messages` array nested inside `mailboxDepth`
passes **both** the frozen Python validator and the gateway Go parser, while the same array at agent
top level is rejected by both. The same is true of a `reason` string nested in `slots.waiting[]`.

The part that deserves more weight than the addendum gives it: **before this addendum, agents had no
producer-authored nested objects to hide anything in.** `session` and `memberships` are fully
enumerated by both validators. `activity`, `mailboxDepth` and `slots` are the first sub-objects whose
key sets nobody checks. The addendum converts a theoretical gap into a live one and then relies
entirely on producer discipline documented in prose.

Also note what the negative suite currently proves: `n01` proves vocabulary closure. **There is no
negative fixture anywhere covering §5 leakage at all**, at any depth.

**Asked for**, in descending order of preference:

1. Make the exclusion check **recursive** over the agent object in the *addendum's* `check.py` (do
   not touch the frozen validator — the frozen validator is the point). Ten string comparisons per
   node; the gateway will mirror it in Go.
2. Ship `n02-nested-messages.json` — `h01` with `mailboxDepth.messages` populated — asserted to
   **fail** the recursive check while still passing the frozen one. That documents the gap as a known
   boundary rather than a surprise, and it makes the discipline testable.
3. Add to §8: "no additive key, at any depth, may carry a value derived from message bodies or
   subjects, task bodies, captured terminal text, prompts, environment, credentials or diffs."

I am not asking you to change the frozen validator and I would object if you did.

### D5 — `task` is documented as a task id and the fixture ships an epic id

`h01` gives `k3n8vq2a` `"task": "EP-018"`. It matches `^[A-Z]+-[0-9]+$` so it is legal, and §3.3
already says the pattern is deliberately prefix-agnostic. But §3.3 calls the field *"the current task
id"* and *"the agent has no assignment"*, and an epic is not a task. A header that labels every value
"Task:" will label an epic as a task.

Related and unstated: nothing says whether `task` may be **stale** — carried from a finished
assignment — or whether it is only present while the assignment is live.

**Asked for:** rename the field's *description* (not the key) to "current work item id", say
explicitly that the prefix carries no meaning the consumer may rely on, and state the liveness rule.
One extra sentence. Do not change the key name; `task` is fine and renaming it now costs more than
it buys.

### D6 — `activity.state` is described as closed and required to be treated as open, and the addendum never says which it is

§3.1 and §8.2 fix the set at seven and bind the producer to it verbatim. §9.3 requires the consumer
to *"render an unrecognised `activity.state` as unknown rather than rejecting the snapshot… a v1
consumer must survive a v1.x producer"*. Meanwhile §10 defers *"any new `lifecycle` value"* to v2.

Read together, that means `activity.state` is an **open** vocabulary that may gain values within v1
while `lifecycle` is **closed** and cannot. I think that asymmetry is deliberate and correct — it is
what makes the `activity` key worth having instead of new `lifecycle` values — but the addendum never
says so, and a later reader will find §3.1's "seven, verbatim" and §9.3's "tolerate anything" and
conclude one of them is a mistake.

**Asked for:** one line in §10 — "`activity.state` is an open vocabulary with seven values defined at
this revision; adding a value is v1-compatible and requires no version change. `lifecycle` is closed;
adding a value is `schemaVersion: 2`." That is the actual contract; it should be written down.

Related nit, same section: `activity.since` and `activity.observed` are shown in the example but only
`state` is marked required. Please say plainly that `since` and `observed` are optional and what a
consumer should assume when each is absent (I will assume `observed: true` for a missing `observed`,
which is the dangerous default — tell me if it is wrong).

### D7 — `slots.waiting[].position` excludes the holder, and only the fixture says so

§3.5 defines `position` as *"a 1-based integer place in that slot's queue"*. With a holder present,
"place in the queue" is ambiguous: is the holder position 1?

I resolved it from `h01`: slot `integration` has holder `b4h6rt1c` and `waiting: [s2v7ho3j,
k3n8vq2a]`; per-agent, `s2v7ho3j` is position 1 and `k3n8vq2a` is position 2. So **position indexes
the waiting list only and excludes the holder**, and it is 1-based against `slotQueues[].waiting`'s
0-based array. That is the sensible reading and it is self-consistent, but I had to derive it from a
worked example rather than read it.

**Asked for:** say it in §3.5 — "position is the agent's 1-based index into `slotQueues[].waiting`;
the holder is not in the queue and has no position."

---

## 7. Things a consumer must do that the addendum does not say

Beyond the defects above, collected because you asked for exactly this:

1. **What to do when `slots` and `slotQueues` disagree.** §4 says trust `slotQueues` and *"report the
   drift"*. Report it **to whom**? There is no channel in the contract, no error class, and no
   guidance on whether the snapshot is still usable. I will treat drift as non-fatal, render from
   `slotQueues`, and log locally — but that is my invention, not your contract. Please say
   "non-fatal; render from `slotQueues`; consumer-local logging only" or tell me otherwise.
2. **Whether `slotQueues[].holder` / `.waiting[]` may name an agentId absent from `agents[]`.** Slot
   queues are repository-scoped and the agent list is a live-pane projection, so an agent that
   released its pane between reads could plausibly still hold a slot. A header that assumes the join
   always resolves will render a blank name or drop a row. Please state whether the join is
   guaranteed within a snapshot; if it is not, say what a dangling holder means.
3. **The counter-ordering rules are silent on the new keys, correctly, and that should be said.**
   Ordering is `(generation, revision)` and a valid fresh snapshot replaces membership wholesale
   (§6/[R1] of the contract). I am assuming the additive keys are replaced wholesale with everything
   else and are never merged across snapshots — including that a key present in snapshot N and absent
   in N+1 means "no longer known", not "unchanged". That is the only reading consistent with [R1],
   but "absent means not known" plus wholesale replacement is exactly the combination that invites a
   consumer to cache the last-known value. Please state it: **no additive key is ever carried across
   snapshots.**
4. **Ordering within `slots.held`, `slots.waiting` and `slotQueues`.** `waiting` is stated to be "in
   queue order". `held` and the `slotQueues` array itself have no stated order, so I must not render
   them in wire order and call it meaningful, and I must not diff them positionally. Worth one line.
5. **Size.** `h01` is 6654 bytes for five agents against the frozen `01-exact-match.json`'s 4484 —
   about +48%, ~1.3 KB per agent. Our reader caps a snapshot at 1 MiB (`MaxSnapshotBytes`,
   `reader.go:15`) and takes the **unknown** path on oversize rather than truncating. That leaves
   headroom for roughly 780 agents instead of roughly 1160. Not a concern at any plausible scale and
   **not** an objection — recorded so that nobody is surprised later, and so that a future addendum
   proposing per-agent arrays knows the budget it is spending against.
6. **The §7 fix changes our agent population, silently and immediately.** It is already on `main`
   (`387e4ec`), ahead of this countersignature, and its effect is that run agents with library roles
   outside the frozen seven now appear where they previously vanished. I accept it — a missing agent
   is a worse bug than a coarsely-typed one, and `roleName` carries the truth. But it means gateway
   groupings can gain members with no wire-visible change other than a longer `agents[]`, so the
   first extended snapshot we see may legitimately differ in *population* as well as in keys. Noted
   here so that a gateway-side surprise is diagnosed as this, not as a parser bug.

---

## 8. What I did not do

- I did not modify, check out, or push anything in `bytedesk-remote-gateway`; I read the branch with
  `git show` and built a scratch module from copies. No worktree was created, so none was left behind.
- I did not modify anything in `bytedesk-marketplace` except this file.
- I did not run the gateway's own `go test` suite, because doing so needs a worktree of that branch;
  what I ran instead is the same `Parse` entry point the tests exercise, over your fixtures, which is
  the thing actually in question. If you want `go test ./plugins/orchestration-terminals/presence/...`
  green against the extended fixtures as a gate, that is a gateway-side task and I would file it as
  the natural successor to TM-222.
- I touched no tmux. Given today's incident: nothing in this review needed a tmux server, and nothing
  in it started, listed or killed one.

— Gateway-side reviewer, TM-136 countersignature, 2026-09-09
