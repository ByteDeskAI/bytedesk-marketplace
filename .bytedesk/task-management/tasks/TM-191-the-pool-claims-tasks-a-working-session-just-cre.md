---
id: "TM-191"
kind: "task"
status: "open"
created: "2026-09-12T03:10:04.437Z"
board: "bytedeskai/bytedesk-marketplace"
title: "The pool claims tasks a working session just created, and duplicates its work"
epic: "EP-021"
acceptance: [{"text":"A task created and then started by the same session is never claimed by the pool first; covered by a test","done":false},{"text":"Creating a task with an author claim (or a pool-skip marker) is supported and documented","done":false},{"text":"tm pool status and the dispatch monitor report the same answer about whether new tasks will be claimed","done":false},{"text":"The duplicate-work case from 2026-09-12 is described in the changelog or docs so operators recognise it","done":false}]
evidence: []
commits: []
blockedBy: []
blocks: []
actor: "main"
session: "9c583517-b11d-4a6e-bc61-2a8116384702"
branch: "main"
worktree: "/home/ryan/Documents/GitHub/ByteDeskAI/bytedesk-marketplace"
labels: ["ready-for-agent"]
triagedBy: "auto"
updated: "2026-09-12T03:10:04.445Z"
---

Reported from the gateway repo on 2026-09-12 after the pool rebuilt a task that a session was already implementing.

WHAT HAPPENED
1. A session working in bytedesk-remote-gateway filed TM-309 and TM-310 as follow-ups to work it had just landed, intending to do both itself a few minutes later.
2. The pool claimed both within minutes (claims showed as pool-tm-309 and pool-tm-310). `tm start TM-310` refused with 'Take it anyway with --steal', and the session had to steal its own tasks back.
3. A pool worker had already implemented TM-310 in full: branch tm/TM-310-remove-the-cohort-orchestration-endpoints-the-de, commit a51fa498 'refactor(projects)!: the orchestration room's endpoints go with the room (TM-310)', in worktree .bytedesk/worktrees/TM-310-remove-the-cohort-orchestration-endpoints-the-de of the gateway repo.
4. The session's own implementation landed instead as f30b4bc9 on develop and was cut over at 02:32:54Z. The pool's version is unmerged and duplicates it. One full worker run was wasted, and only luck kept two implementations of the same breaking change off develop.
5. The same pattern is live now: the pool holds TM-315 in that repo, a task the same session filed and had already partly fixed in efef6b64.

THE OPT-IN STORY DOES NOT MATCH WHAT RUNS
At that session's start, the dispatch monitor reported: 'config dispatch.enabled is not true — the pool daemon is opt-in (tm config dispatch {"enabled":true})' and exited 0. The store's config still shows dispatch with only poolWip: 20 and no enabled flag. Yet `tm pool status` reports 'pool running (pid 2981983, started 2026-09-12T01:48:57Z) — 1/20 workers', and that pool is claiming newly created tasks. An explicitly started pool overrides the opt-in gate by design, but nothing tells an operator that new tasks will be picked up, so a session that files a task and starts it two minutes later loses the race.

WHAT WOULD FIX IT
- Let a task be created and claimed in one step (for example tm task new --claim, or an author-claim default), so filing a follow-up does not hand it away.
- Or honour an explicit marker the pool skips, and/or a short grace period before a newly created task becomes dispatchable.
- Make the readiness signals agree: if a pool is running, the dispatch monitor and tm pool status should say the same thing about whether new tasks will be claimed.
- Consider refusing to dispatch a task whose creating session is still live, which the store already knows from the session field.