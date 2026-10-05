---
id: "TM-259"
kind: "task"
status: "open"
created: "2026-09-27T02:46:24.523Z"
board: "bytedeskai/bytedesk-marketplace"
title: "agent-orchestration reviewer: pin the GitHub repo for the effective base and stop network blips flipping approved reviews"
epic: "EP-024"
acceptance: [{"text":"The GitHub repo used for compare is pinned in the admission record, and a repointed remote or GH_REPO does not change it (test)","done":true,"at":"2026-10-02T05:14:56.572Z"},{"text":"A server-unavailable lookup for a revision with a recorded verified effective base keeps the review valid (test); first derivation still fails closed to the admitted base","done":false},{"text":"Supervision/eligibility sweeps make no GitHub call for a revision whose base is already recorded (test with a counting stub)","done":false}]
evidence: []
commits: []
blockedBy: []
blocks: []
actor: "main"
session: "b41d685d-7094-4957-80a5-950b76fb0467"
branch: "main"
worktree: "/home/ryan/Documents/GitHub/ByteDeskAI/bytedesk-marketplace"
labels: ["ready-for-agent"]
triagedBy: "auto"
updated: "2026-10-02T05:15:43.573Z"
touches: ["agent-orchestration/tests/unit","agent-orchestration/topology/lib/management.mjs","agent-orchestration/topology/lib/reviewer.mjs"]
comments: [{"author":"main","ts":"2026-10-02T05:14:56.267Z","text":"TM-288 board review (approved by Ryan 2026-10-02): AC1 is met: TM-263 pins the repo (repoid.mjs:82-104). Ticking AC1; AC2 and AC3 remain."}]
---

Faro minors on TM-258 at cb1fba3 (approved). (1) reviewer.mjs:652: gh repo view resolves the repo from shared .git config/GH_REPO, which a worker can repoint at a fork it controls; pin nameWithOwner at admission in the host-written management record and use it. (2) reviewer.mjs:687: every derivation does two gh API calls, including supervision ticks; a rate limit or blip falls back to the admitted base, the patch hash stops matching and an approved task flips to 'review does not cover the complete admitted task range'. Cache the verified effective base per (task, revision) in the host record once derived, and treat a server-unavailable fallback on a revision that already has a recorded verified base as 'use recorded' rather than a mismatch.