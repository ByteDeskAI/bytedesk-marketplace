---
id: "TM-117"
kind: "task"
status: "done"
created: "2026-09-06T22:55:22.366Z"
board: "bytedeskai/bytedesk-marketplace"
title: "AO nesting 4/5: guard every consumer of run.agents against a pane-less participant"
epic: "EP-016"
acceptance: [{"text":"Every listed call site either tolerates a participant or refuses it with a message naming what to do instead","done":true,"at":"2026-09-06T23:29:23.448Z"},{"text":"status shows the child's state nested under the participant","done":true,"at":"2026-09-06T23:29:23.574Z"}]
evidence: [".bytedesk/task-management/evidence/TM-117-nested-workflow.sh"]
commits: ["aa7448f"]
blockedBy: []
blocks: []
actor: "main"
session: "4e1d7087-d606-432e-9341-3ce779b4baf8"
branch: "main"
worktree: "/home/ryan/Documents/GitHub/ByteDeskAI/bytedesk-marketplace"
updated: "2026-09-06T23:29:23.968Z"
closed: "2026-09-06T23:29:23.812Z"
---

Step 4. A participant has pane: null, no provider, no candidates. Judged against the grep rather than assumed.

Already tolerant, leave alone: cli.mjs:479-486 (skips pane-less), mailbox.mjs:112/132/221/302/339/360/381 (id lookups only). mailbox.mjs:245 — wait's default targets exclude orchestrators, so participants are already included, which is correct.

Need a branch:
- launch.mjs:587 — assign no pane to a participant.
- launch.mjs:769 failoverAgent — refuse; failover is a provider concept and a team has no provider.
- cli.mjs:537 capture, and nudge — refuse with 'that is a workflow, not a pane; use status --run <child run dir>'.
- status — render a participant as a nested block with the child's state and queue depth.