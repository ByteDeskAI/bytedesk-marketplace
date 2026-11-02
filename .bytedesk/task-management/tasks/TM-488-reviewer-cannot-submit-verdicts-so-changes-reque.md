---
id: "TM-488"
kind: "task"
status: "open"
created: "2026-10-08T23:36:15.998Z"
board: "bytedeskai/bytedesk-marketplace"
title: "Reviewer cannot submit verdicts, so changes_requested can never be collected and rework is impossible"
epic: "EP-028"
acceptance: [{"text":"a registered reviewer session can submit an AO_REVIEW verdict that reviewer collect accepts","done":false},{"text":"a collected changes_requested review lets start-worker begin the rework round","done":false},{"text":"collect does not fail TOPOLOGY_REVIEWER_RANGE for an unchanged revision because the gate code changed after the request","done":false}]
evidence: []
commits: ["https://github.com/ByteDeskAI/bytedesk-marketplace/pull/251"]
blockedBy: []
blocks: []
actor: "main"
session: "fb6f28ce-e4ba-4ee4-b547-98bfa4487145"
branch: "main"
worktree: "/home/ryan/Documents/GitHub/ByteDeskAI/bytedesk-marketplace"
labels: ["ready-for-agent"]
triagedBy: "auto"
updated: "2026-10-09T05:34:39.538Z"
priority: "high"
comments: [{"author":"main","ts":"2026-10-08T23:37:32.497Z","text":"Lead triage (fd2b831f, 2026-10-08): two causes. (1) RANGE regression: collect recomputes the review patch (and patch_sha256) with the CURRENT gate code; PR #221 (44b030d4) changed patch/range computation (TM-349 base widen, #216 --text/attr handling) while passport's review was in flight, so an unchanged revision now hashes differently and collect refuses permanently. Fix: store the patch-algorithm version (or the exact patch bytes) in the request and compare like with like; on a version mismatch, re-issue the review request for the same revision automatically (reason: gate-code-changed) instead of refusing forever; never let an algorithm change fail a review closed with no recovery path. (2) No review_submit tool: the passport reviewer session predates the review_submit MCP launcher; 'ao-topology reviewer ensure' restarts it with the current launcher (done for marketplace faro today). Supported workaround now: restart the reviewer, then 'reviewer request' the same revision again. Fix also needs TM-364 MEDIUM-5 (test that REVIEW_MCP_SCRIPT resolves from dist) and a reviewer-ensure check that warns when a live reviewer lacks the review_submit tool. Interacts with TM-427 (submit identity) — same file, sequence after #226."},{"author":"main","ts":"2026-10-09T01:00:21.278Z","text":"Implemented inside the TM-427 governed cluster worker (tmux:tm-TM-427) per TM-427 comment 7; one PR against main."},{"author":"main","ts":"2026-10-09T01:20:01.947Z","text":"Process gap seen 2026-10-08 on TM-485: a lead-commissioned independent review (outside the designated-reviewer pipeline) cannot drive 'manage rework', which requires a collected changes_requested from the designated reviewer — so the worker's next round may be refused. Either let a recorded lead-commissioned verdict count (with identity proof via TM-427) or route lead-commissioned reviews through the designated reviewer."},{"author":"main","ts":"2026-10-09T01:40:06.234Z","text":"Workaround confirmed at Passport 2026-10-09: reviewer ensure + reviewer request (--author = admitted owner/lead id) re-queued TM-262, TM-258, TM-265. Note: ensure REATTACHED the old reviewer instead of restarting it, so it still lacks review_submit and submits via CLI fallback — constraint sent to the TM-427 worker (restart old-launcher reviewers; any surviving CLI submit must be pane-proven)."}]
---

Repro (bytedesk-passport TM-265, 2026-10-06..08): lead a01e40af queued review of 461e2390f2e8e1473a6bb05b27f635d2e711f042 to reviewer Cleo (ebf01b80, session mass-laptop01--bytedesk-passport--reviewer--cleo). Cleo reviewed it and printed an AO_REVIEW base64 line with verdict CHANGES REQUESTED, saying: "I had no review_submit tool" and "reviewer cannot run ao-topology". The request JSON still shows state "published".

`ao-topology reviewer collect --task TM-265 --revision 461e239...` -> TOPOLOGY_REVIEWER_RANGE "Review request no longer covers the admitted task range" (reviewer.mjs:1654 patch_sha256 mismatch). The revision did not change; marketplace main moved to 44b030d4 in between.

Consequence: management.mjs rework (line ~609) needs a collected changes_requested review of the finish revision. Without it, start-worker fails TM_GOVERNED_ADMISSION_REQUIRED even after re-admission ("admitted (resumed)"), so the author can never get a rework round. The lead must not publish the verdict on the reviewer's behalf.

Related: TM-413, TM-426.
