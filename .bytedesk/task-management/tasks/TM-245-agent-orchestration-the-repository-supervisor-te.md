---
id: "TM-245"
kind: "task"
status: "blocked"
created: "2026-09-25T15:23:32.657Z"
board: "bytedeskai/bytedesk-marketplace"
title: "agent-orchestration: the repository supervisor tells the lead when a task stalls, instead of waiting to be asked"
epic: "EP-019"
acceptance: [{"text":"task-management exposes the task-health query as one read-only JSON verb used by both doctor and the supervisor, covering: in_progress past staleMinutes with no activity; review requested but not collected past a threshold; review_blocked; dispatched worker with a dead session or stale heartbeat; commits or PR with no review for the current revision.","done":false},{"text":"Each supervisor tick runs the query for its enrolled repository and sends the repository lead one standing-mailbox message per NEW or CHANGED finding, keyed by a fingerprint of task, condition and revision; an unchanged finding is never re-sent, and a cleared finding is recorded once.","done":false},{"text":"A test runs ten ticks over an unchanged stalled fixture and asserts exactly one message; changing the condition yields exactly one more.","done":false},{"text":"Thresholds are config with documented defaults; the lead prompt's common protocol adds 'check tm stale / tm board at safe boundaries' as a backstop; docs/repository-leads.md describes what the supervisor reports and how to silence one finding.","done":false},{"text":"Plugin independence (Ryan, 2026-09-25): task-management and agent-orchestration each work with the other absent. No import or require crosses the boundary and no manifest dependency is declared; a call into the other plugin first capability-checks it (the tm binary as at agent-orchestration management.mjs:50, or the ao-topology binary as at task-management hostcaps.mjs) and skips silently when it is missing, without failing or blocking the rest of the operation. A test runs each side with the other plugin absent.","done":false},{"text":"With task-management absent the supervisor tick skips the health check and completes the rest of the tick; with agent-orchestration absent the task-management health verb and doctor still report on demand.","done":false}]
evidence: []
commits: []
blockedBy: ["TM-244"]
blocks: []
actor: "main"
session: "40645e47-066b-4937-abc2-55d42e9ea247"
branch: "main"
worktree: "/home/ryan/Documents/GitHub/ByteDeskAI/bytedesk-marketplace"
labels: ["ready-for-agent","plugin:agent-orchestration"]
triagedBy: "auto"
updated: "2026-09-25T15:27:31.376Z"
priority: "medium"
knowledge: ["/architecture/task-management-and-agent-orchestration-stay-ind.md"]
---

Raised 2026-09-25 by design-system lead d04c2baa at Ryan's request: leads only react to messages and probes, so stalled work (design-system TM-136 unreviewed, a blocked reviewer) surfaced only because Ryan asked. Design settled with the reporter. Home is the agent-orchestration repository supervisor (topology/lib/supervision.mjs superviseRepository), not the tm pool: the pool exits after dispatch.idleExitMinutes (default 60) with no workers, which is exactly when stalls go unseen, can be disabled per repo, and has no dependency on agent-orchestration; the supervisor is the long-lived per-repo process that already resumes the lead's standing mail (resumeStandingMessages). Detection lives in task-management as a read-only query (the one TM-244 builds for doctor), so doctor and the supervisor share one predicate. Delivery is deduplicated by fingerprint, as observer findings already are (observer.mjs findingFingerprint), because TM-238 showed what a per-tick write does without it (109 duplicate comments).