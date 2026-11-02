---
id: "TM-531"
kind: "task"
status: "open"
created: "2026-10-10T07:56:35.469Z"
board: "bytedeskai/bytedesk-marketplace"
title: "AO/tm: the management record and task store diverge on a governed task's state; tm review-ready and tm rework reject finishes that manage report accepted"
epic: "EP-029"
acceptance: [{"text":"A finish accepted by manage report always lets tm review-ready record that revision, including after a rework and with duplicate finish events (test)","done":false},{"text":"manage rework on a task with a recorded review returns the tm store to in_progress without error (test)","done":false},{"text":"doctor reports a task whose store status and management state disagree, and a supported verb reconciles it","done":false}]
evidence: []
commits: []
blockedBy: []
blocks: []
actor: "main"
session: "253de95a-5b3d-4702-b941-9b7ba0507f01"
branch: "main"
worktree: "/home/ryan/Documents/GitHub/ByteDeskAI/bytedesk-marketplace"
labels: ["ready-for-agent"]
triagedBy: "auto"
updated: "2026-10-10T08:02:23.897Z"
priority: "high"
links: [{"type":"relates to","id":"TM-518"}]
comments: [{"author":"main","ts":"2026-10-10T08:02:23.889Z","text":"Update (Ines, 2026-10-10): with the task worktree clean, 'tm review-ready TM-010' accepted the new revision 21ee7b6, and store and record agree again. Check during the fix whether part of the earlier refusal was a dirty worktree reported as 'only reflects an accepted exact-revision finish'. If tm refuses review-ready for a dirty tree, it should say so. The rework-reflection failure ('submitted for review (none)') is still unexplained."}]
---

Reported by Ines (bytedesk-agent-browser TM-010), 2026-10-10; the same shape as marketplace TM-485 on 2026-10-09 (TM-518 comment 1, TM-509 comment 1). (1) TM-010's management record holds two accepted finish events at ef520af (2026-10-08 23:46:22 and 23:46:25), state ready-for-review, but the task store still says in_progress. 'tm review-ready TM-010 --revision ef520af…' refuses with 'review-ready only reflects an accepted exact-revision finish', the same failure the worker hit inside manage report. (2) After a changes_requested verdict, 'manage rework --task TM-010' recorded the rework event (07:55:44Z), but its tm reflection failed: 'tm rework: TM-010: only the revision submitted for review (none) can return to work'. start-worker still worked, so the store and the record are out of step. Hypothesis: tm's review-ready check does not recognise the finish events manage report writes (perhaps after a rework, or with duplicate finishes), so tm never records the submitted revision, and every later tm reflection (rework, done) fails. Fix: one shared definition of 'accepted exact-revision finish' used by both manage report and tm review-ready (verification rule 3); duplicate finish events stay idempotent; manage rework surfaces a tm reflection failure as a TOPOLOGY_* error, not an uncaught exception; add a doctor check for store vs record state divergence, with a repair verb.