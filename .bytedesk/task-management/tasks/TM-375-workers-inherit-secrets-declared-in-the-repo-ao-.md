---
id: "TM-375"
kind: "task"
status: "done"
created: "2026-10-05T10:57:21.057Z"
board: "bytedeskai/bytedesk-marketplace"
title: "workers inherit secrets declared in the repo AO config"
epic: "EP-028"
acceptance: [{"text":"Keys named in config are passed to spawned workers' environments","done":true,"at":"2026-10-05T14:14:54.909Z"},{"text":"Values never appear in logs, prompts or events","done":true,"at":"2026-10-05T14:14:55.341Z"}]
evidence: [".bytedesk/task-management/evidence/TM-375-1791209695695.log"]
commits: ["https://github.com/ByteDeskAI/bytedesk-marketplace/pull/200","https://github.com/ByteDeskAI/bytedesk-marketplace/pull/new/ep-028/integration-2"]
blockedBy: []
blocks: []
actor: "main"
session: "d82e2db7-2daf-4130-8dff-71d57be2583d"
branch: "fix/ao-local-nats-autostart"
worktree: "/home/ryan/Documents/GitHub/ByteDeskAI/bytedesk-marketplace"
labels: ["ready-for-agent"]
triagedBy: "auto"
updated: "2026-10-05T15:37:05.967Z"
priority: "medium"
evidenceSources: {".bytedesk/task-management/evidence/TM-375-1791209695695.log":{"source":null,"sha256":"cbaaa2e5b2831b56de4e8b9ddccdc633165cd19cf95981edeccdde2527b237d9","bytes":324,"at":"2026-10-05T14:14:55.696Z"}}
closed: "2026-10-05T14:14:56.081Z"
comments: [{"author":"review-sweep","ts":"2026-10-05T15:18:31.792Z","text":"review-sweep: TM-375 is done with commits and no reviewer verdict — needs an independent review or a decision."},{"author":"main","ts":"2026-10-05T15:37:05.963Z","text":"review verdict: changes requested — https://github.com/ByteDeskAI/bytedesk-marketplace/pull/200 (independent post-merge review rv-197; fixes TM-448 TM-449 TM-450)"}]
---

Plan: .bytedesk/task-management/plans/2026-10-05-plan-reliable-agent-comms-cross-repo-tickets-aut.md (F3). agent-browser: user had to tmux set-environment TYPESAFE_API_KEY by hand.