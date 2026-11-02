---
id: "TM-369"
kind: "task"
status: "done"
created: "2026-10-05T10:57:15.836Z"
board: "bytedeskai/bytedesk-marketplace"
title: "agent-orchestration: ship lead and worker autonomy permissions with the plugin"
epic: "EP-028"
acceptance: [{"text":"Plugin ships the settings that let leads spawn workers, set auto_approve and read panes without prompts","done":true,"at":"2026-10-05T12:54:16.215Z"},{"text":"No global rule edits are needed","done":true,"at":"2026-10-05T12:54:16.617Z"},{"text":"Documented with the safety boundaries kept (repo-destructive and external still gated)","done":true,"at":"2026-10-05T12:54:17.211Z"}]
evidence: [".bytedesk/task-management/evidence/TM-369-1791204858021.log"]
commits: ["https://github.com/ByteDeskAI/bytedesk-marketplace/pull/190","https://github.com/ByteDeskAI/bytedesk-marketplace/pull/211","https://github.com/ByteDeskAI/bytedesk-marketplace/pull/212"]
blockedBy: []
blocks: []
actor: "main"
session: "d82e2db7-2daf-4130-8dff-71d57be2583d"
branch: "fix/ao-local-nats-autostart"
worktree: "/home/ryan/Documents/GitHub/ByteDeskAI/bytedesk-marketplace"
labels: ["ready-for-agent"]
triagedBy: "auto"
updated: "2026-10-05T15:33:06.304Z"
priority: "highest"
comments: [{"author":"main","ts":"2026-10-05T12:31:29.141Z","text":"Actively in progress (2026-10-05): EP-028 lead's worker w-hooks is implementing this in an isolated worktree; PR to follow. Not stale — do not park or re-dispatch."},{"author":"review-sweep","ts":"2026-10-05T15:18:30.434Z","text":"review-sweep: TM-369 is done with commits and no reviewer verdict — needs an independent review or a decision."},{"author":"main","ts":"2026-10-05T15:31:40.923Z","text":"Superseded: the earlier 'actively in progress' note no longer applies — this task is done (see evidence)."},{"author":"main","ts":"2026-10-05T15:33:06.299Z","text":"review verdict: changes requested — https://github.com/ByteDeskAI/bytedesk-marketplace/pull/190 (independent post-merge review rv-190: HIGH bypasses in autonomy-allow; fixes TM-432 TM-433 TM-434)"}]
evidenceSources: {".bytedesk/task-management/evidence/TM-369-1791204858021.log":{"source":null,"sha256":"dc3d0b179a61aeaf2ea9cac526098d2077feffecfc639d261531aa3043319d7c","bytes":224,"at":"2026-10-05T12:54:18.022Z"}}
closed: "2026-10-05T12:54:19.092Z"
---

Plan: .bytedesk/task-management/plans/2026-10-05-plan-reliable-agent-comms-cross-repo-tickets-aut.md (F0). Ryan 09-24: 'I dont want to have to approve anything... fix that at the orchestration level'; 'shipped with the agent orchestration plugin'.