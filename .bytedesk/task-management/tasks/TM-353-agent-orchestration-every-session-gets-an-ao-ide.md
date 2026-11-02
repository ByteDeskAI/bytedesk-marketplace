---
id: "TM-353"
kind: "task"
status: "done"
created: "2026-10-05T10:57:01.649Z"
board: "bytedeskai/bytedesk-marketplace"
title: "agent-orchestration: every session gets an AO identity; unregistered recipients resolve via presence"
epic: "EP-028"
acceptance: [{"text":"SessionStart mints an identity for a non-agent session so mailbox send succeeds without borrowing a lead's","done":true,"at":"2026-10-05T13:16:51.601Z"},{"text":"A recipient present in presence but not in the library resolves instead of holding as unknown_recipient","done":true,"at":"2026-10-05T13:16:51.932Z"},{"text":"Tests cover both paths","done":true,"at":"2026-10-05T13:16:52.269Z"}]
evidence: [".bytedesk/task-management/evidence/TM-353-1791206212628.log"]
commits: ["https://github.com/ByteDeskAI/bytedesk-marketplace/pull/193","fdd82990","https://github.com/ByteDeskAI/bytedesk-marketplace/pull/211","https://github.com/ByteDeskAI/bytedesk-marketplace/pull/212"]
blockedBy: []
blocks: ["TM-372"]
actor: "main"
session: "d82e2db7-2daf-4130-8dff-71d57be2583d"
branch: "fix/ao-local-nats-autostart"
worktree: "/home/ryan/Documents/GitHub/ByteDeskAI/bytedesk-marketplace"
labels: ["ready-for-agent"]
triagedBy: "auto"
updated: "2026-10-05T15:54:49.037Z"
priority: "high"
evidenceSources: {".bytedesk/task-management/evidence/TM-353-1791206212628.log":{"source":null,"sha256":"132496feba4aab4462a78ad785871d20c5cc93b00263a6b7174923e5acefd234","bytes":266,"at":"2026-10-05T13:16:52.629Z"}}
closed: "2026-10-05T13:16:52.991Z"
comments: [{"author":"review-sweep","ts":"2026-10-05T15:18:26.860Z","text":"review-sweep: TM-353 is done with commits and no reviewer verdict — needs an independent review or a decision."},{"author":"main","ts":"2026-10-05T15:54:49.032Z","text":"review verdict: changes requested — https://github.com/ByteDeskAI/bytedesk-marketplace/pull/193 (independent post-merge review rv-193: all ACs met; test isolation TM-464, MCP identity TM-466, forgeability noted on TM-427)"}]
---

Plan: .bytedesk/task-management/plans/2026-10-05-plan-reliable-agent-comms-cross-repo-tickets-aut.md (A3). Fixes source_identity_required for ad-hoc sessions and unknown_recipient for Codex panes (13 holds in one agent-browser lead).