---
id: "TM-206"
kind: "task"
status: "open"
created: "2026-09-17T08:03:56.024Z"
board: "bytedeskai/bytedesk-marketplace"
title: "agent-orchestration: the ack cache compares volatile fields it does not claim to, and a miss names nothing"
epic: "EP-019"
acceptance: [{"text":"recentAck compares exactly the fields that establish incarnation identity — the BINDING_KEYS six-tuple — rather than whole-object JSON, so pane title, liveness and key order cannot invalidate a valid proof","done":false},{"text":"A cache miss records which field differed, so a false miss is distinguishable from a genuine respawn after the fact","done":false},{"text":"A test pins the contract: a proof whose binding differs ONLY in title or alive is still accepted, and one differing in any of the six is rejected","done":false}]
evidence: []
commits: []
blockedBy: []
blocks: []
actor: "main"
session: "83631657-6f99-4269-9c51-643b8f81a54b"
branch: "feat/dispatch-duplicate-guard"
worktree: "/home/ryan/Documents/GitHub/ByteDeskAI/bytedesk-marketplace"
labels: ["ready-for-agent"]
triagedBy: "auto"
updated: "2026-09-17T12:57:44.464Z"
type: "bug"
priority: "medium"
comments: [{"author":"main","ts":"2026-09-17T12:57:44.458Z","text":"Same defect class, one function away, observed 2026-09-17: leadNonceAck's TOPOLOGY_LEAD_PROBE_OWNER covers THREE conditions in one invariant — wrong repo, wrong agent, or past expiry — and its message names none of them. After a usage-limit gap, four queued probes refused: three TOPOLOGY_LEAD_PROBE_UNKNOWN (swept) and one OWNER. Identifying the OWNER case as simply expired (by 2758s; agent_id and repo_id both matched) required opening the probe JSON by hand. Worth folding into AC2 — 'a refusal names which condition failed' — rather than filing a near-duplicate task. Note the refusals themselves were CORRECT: the probe was minted 08:02:54, waited to 08:03:24, expired 08:05:24 (30s wait + the 120s TM-187 grace), and the ack attempt came at 08:51."}]
---

`recentAck` in `topology/lib/lead.mjs` decides whether a cached acknowledgement still proves THIS
incarnation answers. Its comment states the proof "is bound to the six-tuple, so a respawned pane
invalidates it". The code compares something wider:

```js
const same = JSON.stringify(memo.binding ?? null) === JSON.stringify(record.binding ?? null);
```

- `BINDING_KEYS` (delivery.mjs) is six stable fields: serverKey, serverPid, sessionId,
  sessionCreated, paneId, panePid.
- The stored binding carries ELEVEN: those six plus `alive`, `title`, `cwd`, `command`,
  `sessionName`.
- Two are volatile. `alive` is state, not identity. `title` is the pane title, which changes as an
  agent works — observed on this lead as "✳ Agent orchestration prompt review".
- `JSON.stringify` is order-sensitive, so a binding rebuilt with a different key order compares
  unequal even when every value is identical.

A false miss is not a correctness failure — it re-probes rather than trusting a stale proof — but it
costs a MODEL TURN each time, which is the exact expense TM-157 added the cache to avoid, and it
puts a governed launch back in the position of needing two roles to answer inside one window.

## What is confirmed, and what is not

CONFIRMED by reading both files: the comparison is wider than the contract the comment states.

NOT CONFIRMED: that this explains the repeated probes observed on 2026-09-17, where this lead was
asked to acknowledge nine nonces in quick succession. The prediction was that the live pane title
would differ from the title stored in the proof; measured at the time, both read
"✳ Agent orchestration prompt review" — identical. The proposed mechanism did not fire in that
measurement. It may have differed at probe time and settled before the check; that was not observed,
and is not claimed.

## Why it cannot be answered from disk today

`recentAck` returns a bare `null` on a miss. Nothing records WHICH field differed, so a false miss
and a genuine respawn are indistinguishable after the fact — rule 5 of
`.claude/rules/verification-that-can-fail.md`: the refusal is the informative output, and this one
says nothing. Naming the differing field is what turns this from a theory into a measurement.

Related: [[TM-187]], the same prose-versus-code gap in the probe expiry two functions away.
