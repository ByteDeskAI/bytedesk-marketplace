---
id: "TM-094"
kind: "task"
status: "blocked"
created: "2026-09-05T04:01:43.439Z"
board: "bytedeskai/bytedesk-marketplace"
title: "Agent hierarchy: team lead, reports_to, and delegation tokens"
epic: "EP-014"
acceptance: [{"text":"An agent definition can declare role: lead, coordinates_only and reports_to","done":false},{"text":"Exactly one lead per repo is enforced, with a clear error when a second is declared","done":false},{"text":"coordinates_only removes write capability rather than only instructing against it","done":false},{"text":"A delegation token references a tm claim and is validated against the receiving repo's own store","done":false},{"text":"The via chain prevents re-forwarding and lead-to-lead loops, with a hop limit","done":false},{"text":"Lead inbox queue depth is observable","done":false}]
evidence: []
commits: []
blockedBy: ["TM-092","TM-095"]
blocks: ["TM-093"]
actor: "main"
session: "a7da6c38-57d4-464b-b856-ebdb3dd72e1b"
branch: "main"
worktree: "/home/ryan/Documents/GitHub/ByteDeskAI/bytedesk-marketplace"
updated: "2026-09-05T04:02:32.759Z"
touches: ["agent-orchestration/topology/lib/mailbox.mjs","agent-orchestration/topology/lib/spec.mjs"]
---

Each repo gets a team lead that coordinates rather than works. Schema: role: lead, coordinates_only: true (enforceable as a capability fact - no write permission, no worktree, no implementation skills - rather than an instruction), and reports_to building a tree per repo with leads as peers across repos. The delegation exception uses a token rather than cross-repo reads: when a lead delegates outward it issues a token naming (task, external_agent, local_agent, expiry); the outsider presents it on direct contact and the receiving repo validates against its own store, mirroring tm collect's rule that the store gets the last word. Do not build a second delegation store - task-management already has tasks, claims, assignees and an event bus per repo, so a delegation is a task with an assignee and the token references that claim. Guards needed at design time: the via chain prevents ping-pong (if it already contains this repo's lead, do not re-forward) and lead-to-lead loops, plus a hop limit. The lead is a bottleneck and a single point of failure; queue depth on the lead's inbox is worth instrumenting from the start, because congestion will look like slowness rather than an error.