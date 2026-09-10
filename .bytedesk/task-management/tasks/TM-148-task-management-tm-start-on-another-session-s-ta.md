---
id: "TM-148"
kind: "task"
status: "done"
created: "2026-09-10T01:22:32.629Z"
board: "bytedeskai/bytedesk-marketplace"
title: "task-management: tm start on another session's task silently reassigns ownership"
acceptance: [{"text":"tm start on a task owned by a different live session does not silently overwrite actor/session/branch/worktree","done":true,"at":"2026-09-10T06:18:52.430Z"},{"text":"An explicit override remains possible for a genuinely abandoned task","done":true,"at":"2026-09-10T06:25:53.440Z"},{"text":"A test covers the reclaim case","done":true,"at":"2026-09-10T06:25:53.585Z"},{"text":"tm start on a task whose record names a different branch or worktree does not silently re-home it; the prior location is preserved or the re-homing is explicit","done":true,"at":"2026-09-10T06:25:53.714Z"},{"text":"A test covers the parked-then-reclaimed case specifically, since that is the path with no claim to interlock on","done":true,"at":"2026-09-10T06:25:53.858Z"}]
evidence: [".bytedesk/task-management/evidence/TM-148-TM148.md"]
commits: ["f34b041","a92c1f5"]
blockedBy: []
blocks: []
actor: "main"
session: "2ee26155-9e57-4cf8-8bc4-a8379f88e5a4"
branch: "main"
worktree: "/home/ryan/Documents/GitHub/ByteDeskAI/bytedesk-marketplace"
updated: "2026-09-10T06:26:05.669Z"
type: "bug"
labels: ["plugin:task-management"]
priority: "high"
comments: [{"author":"main","ts":"2026-09-10T06:18:52.286Z","text":"THE FILED MECHANISM IS WRONG, AND THE DEFECT UNDER IT IS REAL. Both established empirically in an isolated store, not by reading.\n\nAC1 says \"tm start on a task owned by a different live session does not silently overwrite actor/session/branch/worktree\". THAT ALREADY HOLDS. Measured:\n\n  session A: tm start TM-001                -> in progress\n  session B: tm start TM-001                -> REFUSED, \"TM-001 is claimed by main in /tmp/tmtest on master.\n                                               Take it anyway with --steal\"\n  claim after the refusal                   -> still session A\n\nclaimTask has an interlock and a --steal escape and both work. The live-holder case needs no fix.\n\nWHAT ACTUALLY HAPPENED TO TM-135 is one step to the side. park() calls release(), so a PARKED task has no claim at all. There is then no holder to interlock against, tm start legitimately claims it — and update(id, {status, ...stamp()}) overwrites the record session, branch and worktree with the RECLAIMING session own. Measured on the same store:\n\n  record before B reclaims a PARKED task    session: \"sessionA\"\n  record after                              session: \"sessionB\"\n\nThe claim machinery is not involved. What is lost is the RECORD PROVENANCE: the fields that still described where the work actually lives. That is exactly how TM-135 and TM-143 both came to read branch \"main\" and the shared checkout while their real work sat on a tm/ branch in a worktree — and why the integrator corrected those four fields by hand on both tasks.\n\nSo the defect is narrower and more precise than the title: A RELEASED TASK RECORD HAS NO PROTECTION FOR ITS PROVENANCE, and reclaiming re-homes it silently to wherever the reclaimer happens to be standing.\n\nThat distinction matters for the fix. Hardening the claim interlock would change nothing, because the interlock is not what was bypassed — the claim was legitimately free. The fix belongs in what start WRITES, not in what it is allowed to claim.\n\nCriteria rewritten to describe the measured defect. The old AC1 is kept as met, because it is true and it was worth confirming rather than assuming."}]
evidenceSources: {".bytedesk/task-management/evidence/TM-148-TM148.md":{"source":"/tmp/claude-1000/-home-ryan-Documents-GitHub-ByteDeskAI-bytedesk-marketplace/2ee26155-9e57-4cf8-8bc4-a8379f88e5a4/scratchpad/TM148.md","sha256":"098186ae2844a553c1b0662a9f12e634e2b3bc4c7e839502a1dcf8bb998dc2f3","bytes":2870,"at":"2026-09-10T06:25:53.189Z"}}
closed: "2026-09-10T06:25:54.008Z"
---

`tm start <id>` stamps `actor`, `session`, `branch` and `worktree` with the calling session and its cwd, unconditionally. Run against a task another live session already owns — which is exactly what reclaiming a wrongly-parked task requires — it overwrites all four and the real owner disappears from the record with no warning and no event.

Observed while reclaiming TM-135 at the conductor's request. The task's real owner is session e01dd923 working in `.bytedesk/worktrees/TM-135-dispatch` on `tm/TM-135-idle-dispatch-quota-failover`. After `tm start TM-135` the record read session 2ee26155, branch main, worktree the main checkout — the integrator's session, which had written no code at all. All four were corrected by hand.

The claim is what stops two agents taking the same work, so a verb that reassigns it silently defeats the mechanism it exists to enforce.

Options worth weighing: refuse when the task has a live session that is not the caller and require `--steal` (the flag `dispatch` already has); or preserve ownership fields on a status change and only set them when the claim is genuinely new.