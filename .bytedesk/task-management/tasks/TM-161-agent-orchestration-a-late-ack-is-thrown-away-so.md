---
id: "TM-161"
kind: "task"
status: "open"
created: "2026-09-10T04:06:36.056Z"
board: "bytedeskai/bytedesk-marketplace"
title: "agent-orchestration: a late ack is thrown away, so a busy lead can never prove it is listening"
epic: "EP-018"
acceptance: [{"text":"An ack that arrives after the prober returned still counts: the next readiness check reports responsive without minting a new nonce.","done":true,"at":"2026-09-10T04:10:14.221Z"},{"text":"A busy lead reaches responsive without needing to be idle at the instant of the ring — driven on a live pane, since that is the only place this failure appears.","done":false},{"text":"An expired probe is still refused. Accepting a late ack must not become accepting a stale one, and expires_at is the line.","done":true,"at":"2026-09-10T04:10:14.378Z"},{"text":"The demo runbook's readiness step is corrected to match whatever the fix makes true, because the runbook is now the thing that teaches this.","done":true,"at":"2026-09-10T04:14:19.417Z"}]
evidence: []
commits: []
blockedBy: []
blocks: []
actor: "main"
session: "e01dd923-50ea-45d8-9911-b9d5faed94bd"
branch: "main"
worktree: "/home/ryan/Documents/GitHub/ByteDeskAI/bytedesk-marketplace"
updated: "2026-09-10T04:14:19.544Z"
comments: [{"author":"main","ts":"2026-09-10T04:14:19.541Z","text":"MERGED at 8be9365, and DELIBERATELY NOT CLOSED. AC2 stays unticked: it says \"driven on a live pane, since that is the only place this failure appears\", and no live run has happened since the merge. The author declined to claim it from unit tests and the integrator is not claiming it either. That distinction has been the most carefully held thing in this epic; the last handover is a poor place to give it up.\n\nAC4 IS DONE AND WAS THE INTEGRATOR TO DO. The runbook landed from a different branch minutes after this fix, and it described behaviour the fix had just changed — it told the reader to expect the first readiness call to take a while, with no mention that a timed-out call is no longer wasted. Corrected in agent-orchestration/docs/EP-018-DEMO.md: if a role reads unresponsive because it was mid-turn when the probe rang, ask again rather than starting over, because the probe now outlives the wait to its own expires_at and the ack that agent runs at its next boundary is accepted on the following check without minting a new nonce. An EXPIRED probe is still refused — a late ack counts, a stale one does not.\n\nThat correction mattered more than its size. The runbook is now the thing that teaches this failure to whoever runs the demo next, and it was about to teach the pre-fix behaviour.\n\nGates on the merged tree, exit codes captured: topology 361/361, unit 538 tests / 534 pass / 4 skipped, build:check 0. Content verified present at HEAD after merging — five files, five present — because a merge earlier today recorded as complete with none of its code in it.\n\nTHE FIX ITSELF is the half of the earlier probe work that was described and not built. defaultResponsive deleted the probe when its wait gave up, so an agent that was mid-turn when the ring landed — THE NORMAL CASE, and the one the file-only design existed to serve — read it at its next boundary, ran lead ack correctly and promptly, and met TOPOLOGY_LEAD_PROBE_UNKNOWN. Responsiveness was provable only by an agent that happened to be idle at the instant of the ring.\n\nThe lead diagnosed it on its own pane and was right: the probes expired inside a single tool call, and the message saying so was itself the liveness the probes were asking for. An agent explaining why it could not answer, and that explanation being the answer, is worth keeping as a description of what these probes actually measure."}]
---

Found by executing the committed EP-018 demo runbook end to end — the first time that runbook has been run by anyone, which is exactly what it was written for.

WHAT HAPPENS. The lead received four probes, ran 'ao-topology lead ack <nonce>' for each one as its first action, and was reported unresponsive every time. Its own words on the pane:

    acks were rejected with TOPOLOGY_LEAD_PROBE_UNKNOWN: it may already have timed out. I did not
    skip them; they expired inside a single tool call. This message is the proof of liveness the
    probes were asking for.

It is right. It is not slow, and this is not the latency TM-157 fixed.

THE CAUSE. defaultResponsive writes the nonce file, rings the pane, polls until ackTimeoutMs, and then DELETES THE PROBE in its finally block. An agent that is mid-turn when the ring lands reads it at its next turn boundary — which is the normal case for a working agent, and the one the file-only design was built to serve — and by then the file is gone. The ack it runs is correct, prompt and refused.

So responsiveness is provable only by an agent that happens to be idle at the instant of the ring. A busy lead can never prove it is listening, however obediently it answers. That is the same shape as the two defects TM-157 fixed, one layer further out: the wake now reaches the pane, and the ANSWER still has nowhere to land.

WHY MY OWN FIX DID NOT COVER IT. TM-157 cached a SUCCESSFUL ack for AO_RESPONSIVE_TTL_MS so a launch needing both roles no longer needs two turns to align. That helps only after one ack lands. If none ever lands, there is nothing to cache — and this is the path where none can.

THE FIX IS THE ONE I DESCRIBED ON TM-157 AND DID NOT BUILD: stop deleting the probe when the prober gives up. Let it live until its own expires_at, let a late ack write its file, and let the next readiness check find that ack rather than minting a new nonce. The record already carries expiry and the memo already carries 'when did this agent last answer'; what is missing is the willingness to accept an answer that arrives after the asker stopped waiting.

Evidence: /tmp probes directory empty while four probes were outstanding; leads/probes/ held nothing at the moment the lead ran its ack; lead.mjs defaultResponsive rm() in the finally block.