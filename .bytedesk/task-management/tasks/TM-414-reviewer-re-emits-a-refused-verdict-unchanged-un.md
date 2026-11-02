---
id: "TM-414"
kind: "task"
status: "blocked"
created: "2026-10-05T14:01:05.047Z"
board: "bytedeskai/bytedesk-marketplace"
title: "Reviewer re-emits a refused verdict unchanged under each new nonce"
epic: "EP-028"
acceptance: [{"text":"A refused verdict's reason reaches the reviewer in the next request for the same task and revision","done":false},{"text":"A test shows a reviewer cannot pass the same refused payload under a new nonce without correction","done":false}]
evidence: []
commits: ["https://github.com/ByteDeskAI/bytedesk-marketplace/pull/220"]
blockedBy: ["TM-427"]
blocks: ["TM-549"]
actor: "main"
session: "253de95a-5b3d-4702-b941-9b7ba0507f01"
branch: "main"
worktree: "/home/ryan/Documents/GitHub/ByteDeskAI/bytedesk-marketplace"
labels: ["ready-for-agent"]
triagedBy: "auto"
updated: "2026-11-01T21:24:16.098Z"
comments: [{"author":"main","ts":"2026-10-05T14:25:47.840Z","text":"Lead triage (fd2b831f): accepted, independent of the TM-400 sync. Preferred fix: (a) carry the previous refusal reason for the same task+revision in the next AO_REVIEW_REQUEST, and (b) validate the six-field evidence rule at print time so the refusal is immediate. Queued for dispatch."},{"author":"main","ts":"2026-10-05T14:57:26.178Z","text":"Worker done at fc5bffcc; PR #220 -> fix/ao-local-nats-autostart; independent review running."},{"author":"review-sweep","ts":"2026-10-06T15:45:32.556Z","text":"review-sweep: PR #220 \"TM-414: refused review verdict reason reaches the reviewer; identical repeats refused\" has had no activity for 24h — needs an independent review or a decision."},{"author":"main","ts":"2026-10-09T01:22:25.710Z","text":"PR #220 closed as superseded (2026-10-08): its pane-collection mechanism no longer exists on main (review_submit replaced it). Re-scope: on main, verify that a review_submit validation refusal returns its reason to the reviewer synchronously (likely, which would satisfy AC1); add previous_refusal carry-forward on re-request and a canonical-payload repeat guard on the submit path only if a gap remains. Sequence after TM-427 (same file)."}]
priority: "high"
blockedReason: "In progress in background worker tm414-review-feedback. Lead unblocks on its report."
---

Seen in Bastion 2026-10-05, reviewer e9753d68, task TM-030 revision 541aa8c009756298ada1c0310fed52c584631386.
Round 1 (nonce ff34e60a) was refused: 'Finding 3 must state its evidence.' Findings 3-6 were severity minor without evidence; the reviewer prompt (reviewer-default, line 73) allows only notes to omit evidence.
Rounds 2 (3069f09b) and 3 (0cd5f8ab) re-printed the identical payload within seconds and were refused the same way. The reviewer never learns why: the refusal reason is not in the next AO_REVIEW_REQUEST, and the reviewer does not read mailbox mail (a lead message explaining the fix was delivered but never seen).
Workaround: agent restart --mode handoff (fresh read-only launch), then reviewer request again.
Expected: either (a) the collector rejects at print time and the request carries the refusal reason so the reviewer corrects it, or (b) the reviewer validates its JSON against the six-field rule before emitting.