---
id: "TM-370"
kind: "task"
status: "done"
created: "2026-10-05T10:57:16.662Z"
board: "bytedeskai/bytedesk-marketplace"
title: "agent-orchestration: guard-project-install allows the AGENTS.md-mandated enabledPlugins declaration"
epic: "EP-028"
acceptance: [{"text":"A commit with the mandated enabledPlugins + extraKnownMarketplaces block is allowed","done":true,"at":"2026-10-05T12:54:15.002Z"},{"text":"A genuine per-project install is still blocked","done":true,"at":"2026-10-05T12:54:15.373Z"},{"text":"Tests cover both","done":true,"at":"2026-10-05T12:54:15.712Z"}]
evidence: [".bytedesk/task-management/evidence/TM-370-1791204857591.log"]
commits: ["https://github.com/ByteDeskAI/bytedesk-marketplace/pull/190","https://github.com/ByteDeskAI/bytedesk-marketplace/pull/212"]
blockedBy: []
blocks: []
actor: "main"
session: "d82e2db7-2daf-4130-8dff-71d57be2583d"
branch: "fix/ao-local-nats-autostart"
worktree: "/home/ryan/Documents/GitHub/ByteDeskAI/bytedesk-marketplace"
labels: ["ready-for-agent"]
triagedBy: "auto"
updated: "2026-10-05T15:33:06.730Z"
priority: "highest"
comments: [{"author":"main","ts":"2026-10-05T12:31:28.732Z","text":"Actively in progress (2026-10-05): EP-028 lead's worker w-hooks is implementing this in an isolated worktree; PR to follow. Not stale — do not park or re-dispatch."},{"author":"review-sweep","ts":"2026-10-05T15:18:30.642Z","text":"review-sweep: TM-370 is done with commits and no reviewer verdict — needs an independent review or a decision."},{"author":"main","ts":"2026-10-05T15:31:40.458Z","text":"Superseded: the earlier 'actively in progress' note no longer applies — this task is done (see evidence)."},{"author":"main","ts":"2026-10-05T15:33:06.725Z","text":"review verdict: changes requested — https://github.com/ByteDeskAI/bytedesk-marketplace/pull/190 (independent post-merge review rv-190: HIGH bypasses in autonomy-allow; fixes TM-432 TM-433 TM-434)"}]
evidenceSources: {".bytedesk/task-management/evidence/TM-370-1791204857591.log":{"source":null,"sha256":"e738b0d2be7d81cbac3019a3a19d1eecb3705aeeba3d0edb470b86058dca4acd","bytes":301,"at":"2026-10-05T12:54:17.592Z"}}
closed: "2026-10-05T12:54:18.453Z"
---

Plan: .bytedesk/task-management/plans/2026-10-05-plan-reliable-agent-comms-cross-repo-tickets-aut.md (F1). Blocks every worker commit in agent-browser because .claude/settings.json enables task-management@bytedesk.