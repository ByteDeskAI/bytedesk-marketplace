---
id: "TM-479"
kind: "task"
status: "open"
created: "2026-10-06T12:54:46.798Z"
board: "bytedeskai/bytedesk-marketplace"
title: "agent-orchestration: governed review unreachable when dispatch froze a stale integration base; reviewer can't read the repo"
epic: "EP-028"
acceptance: [{"text":"A lead can correct a stale frozen base on an admitted task (audited) and then request a governed review","done":false},{"text":"Dispatch refuses or warns when the resolved integration branch is already merged into the default branch","done":false},{"text":"The standing reviewer can review a lead-submitted exact revision (repo read access, or request promotion)","done":false}]
evidence: []
commits: []
blockedBy: []
blocks: []
actor: "main"
session: "04f25c3d-c746-48cb-a504-8c1257e21c81"
branch: "main"
worktree: "/home/ryan/Documents/GitHub/ByteDeskAI/bytedesk-marketplace"
labels: ["ready-for-agent"]
triagedBy: "auto"
updated: "2026-10-06T12:54:46.807Z"
---

Reported 2026-10-06 by design-system lead d04c2baa.

1) STALE BASE FROZEN AT ADMISSION. With dispatch.integrationBranch unset, tm dispatch took the main checkout's current branch (chore/ao-global-install-only, already squash-merged to main as #127/d1f6511) as each task's integrationBranch. 'ao-topology manage admit' then froze base_revision=199cd82 (TM-325 freezes it on purpose). The workers did their real work on PR branches built on origin/main (TM-144 → PR #126 head 178d86b; TM-145 → PR #129 head ab0464a). Neither head descends from 199cd82, so:
   - 'reviewer request --task TM-144 --revision 178d86b --author worker' → TOPOLOGY_REVIEWER_RANGE
   - without --author → TOPOLOGY_REVIEWER_CONFLICT
   - the finish report requires revision == task-worktree HEAD, but the worktree sits at 199cd82
   Nothing lets the lead re-base an admitted record, so the task can never be governed-reviewed. Setting dispatch.integrationBranch=main fixes future dispatches only.
2) REVIEWER CAN'T REVIEW OUTSIDE THE GOVERNED REQUESTS DIR. Reviewer e16d04f0 (session mass-laptop01--design-system--reviewer--ilya), sent a mailbox review request bound to an exact SHA, replied that its file tools can't reach the repo and it has no requests/ entry (…/inboxes/eaeacea01040ab88/requests/). Its prompt-state also sits at 'queued, restart-required' (revision 92aa326e02bed00e).
3) TM-145's worker could not open its PR: the guard required --base chore/ao-global-install-only (stale).

Conflict with standing rule: ~/.agents/AGENTS.md (Ryan, 2026-10-05) authorizes 'review via a review subagent, merge with gh --admin once the AI review is clean and checks are green'. The ao-topology gate demands the dedicated reviewer and can't be satisfied here. Per AGENTS.md the rule wins, and the design-system lead is proceeding under it and reporting the conflict here.

Asks: (a) a lead command to re-base or re-admit a task's frozen base when its integration branch was stale, with an audit event; (b) dispatch should refuse an integration branch already merged into the default branch; (c) give the reviewer read access to the repo, or let a mailbox review request be promoted into a governed request.