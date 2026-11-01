---
id: "TM-543"
kind: "task"
status: "blocked"
created: "2026-11-01T21:01:44.274Z"
board: "bytedeskai/bytedesk-marketplace"
title: "agent-orchestration: reviewer collect refuses every base after manage admit widens an admission (TOPOLOGY_REVIEWER_RANGE)"
epic: "EP-029"
acceptance: [{"text":"manage admit on a reviewed task never widens the base silently; it refuses and names manage rework","done":false},{"text":"reviewer collect accepts a verdict whose revision matches, after a base-widened event (test)","done":false}]
evidence: []
commits: []
blockedBy: ["TM-528"]
blocks: []
actor: "main"
session: "ae9ea392-cf16-45d0-ac95-824214db0d70"
branch: "main"
worktree: "/home/ryan/Documents/GitHub/ByteDeskAI/bytedesk-marketplace"
labels: ["ready-for-agent"]
triagedBy: "auto"
updated: "2026-11-01T21:02:38.491Z"
comments: [{"author":"main","ts":"2026-11-01T21:02:36.598Z","text":"Triage (lead fd2b831f): high; sequenced after TM-528, which changes the same admission-base code in management.mjs."}]
priority: "high"
touches: ["agent-orchestration/dist","agent-orchestration/tests/unit","agent-orchestration/topology/lib/management.mjs","agent-orchestration/topology/lib/reviewer.mjs"]
---

Repo: ByteDeskAI/agent-fabric, branch tm/TM-016-vault-credential-tickets-redeemed-by-the-node, 2026-11-01. TM-016 sat in management state ready-for-review with a collected-on-disk verdict (reviewers/inboxes/80bce36c925ef996/verdicts/TM-016-15d0dad...json, verdict changes_requested). Running 'ao-topology manage admit --task TM-016 --file start.json' did not admit rework; instead it appended a base-widened event (555caa3 -> eef50b3, base_source server-tip). After that, 'ao-topology reviewer collect --task TM-016 --revision 15d0dad... [--base 555caa3|--base eef50b3]' fails every time with: 'error TOPOLOGY_REVIEWER_RANGE: Review base must equal the original task admission commit.' Expected: admit on a task with a changes_requested verdict either refuses with a pointer to 'manage rework', or records rework; and collect accepts the verdict regardless of a later widening. Workaround used: 'ao-topology manage rework --task TM-016' then 'tm rework'. Related: TM-528 (admission base anchoring).