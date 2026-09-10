---
id: "TM-161"
kind: "task"
status: "blocked"
created: "2026-09-10T04:06:36.056Z"
board: "bytedeskai/bytedesk-marketplace"
title: "agent-orchestration: a late ack is thrown away, so a busy lead can never prove it is listening"
epic: "EP-018"
acceptance: [{"text":"An ack that arrives after the prober returned still counts: the next readiness check reports responsive without minting a new nonce.","done":true,"at":"2026-09-10T04:10:14.221Z"},{"text":"A busy lead reaches responsive without needing to be idle at the instant of the ring — driven on a live pane, since that is the only place this failure appears.","done":false},{"text":"An expired probe is still refused. Accepting a late ack must not become accepting a stale one, and expires_at is the line.","done":true,"at":"2026-09-10T04:10:14.378Z"},{"text":"The demo runbook's readiness step is corrected to match whatever the fix makes true, because the runbook is now the thing that teaches this.","done":false}]
evidence: []
commits: []
blockedBy: []
blocks: []
actor: "main"
session: "e01dd923-50ea-45d8-9911-b9d5faed94bd"
branch: "main"
worktree: "/home/ryan/Documents/GitHub/ByteDeskAI/bytedesk-marketplace"
updated: "2026-09-10T04:10:14.595Z"
blockedReason: "Code complete on the unit gates; blocked on the integrator's merge, and AC2/AC4 need the live re-run after it. Branch tm/TM-161-late-ack off main@6546f79, commit faae463 — it carries TM-160 as well, because both are the same shape and both were found on the same run. TM-161: the probe now outlives the wait up to its own expires_at, and the next readiness check accepts an ack it finds there rather than minting a new nonce; expires_at is still the line, so a LATE ack never becomes a STALE one, and expired probes are swept. The reviewer's half carries the same rule. This is the half of TM-157 I described on that task and did not build. TM-160: the landing verdict now takes the styled look the ring gate already took, so a message submitted onto a pane rendering a dim suggestion is 'submitted' rather than 'typed-unsubmitted' — one extra capture, only when the cheap answer was 'not empty'. Gates: topology 361/361, including three new negatives (an expired probe's ack refused, another agent's ack never accepted as ours, a bright draft still typed-unsubmitted). AC2 says 'driven on a live pane' and AC4 says the runbook is corrected to match — both need the merged code, so they stay unticked rather than being claimed from unit tests."
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