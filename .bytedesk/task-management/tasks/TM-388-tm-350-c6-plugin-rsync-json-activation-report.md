---
id: "TM-388"
kind: "task"
status: "done"
created: "2026-10-05T11:00:03.293Z"
board: "bytedeskai/bytedesk-marketplace"
title: "TM-350 C6 plugin-rsync: json activation report"
epic: "EP-028"
acceptance: [{"text":"json mode lists per plugin the caches refreshed and classifies changed paths as live, needs-reload or skipped","done":true,"at":"2026-10-05T11:16:09.715Z"},{"text":"Existing default output unchanged; tests cover the classification","done":true,"at":"2026-10-05T11:16:10.072Z"}]
evidence: [".bytedesk/task-management/evidence/TM-388-landing.md"]
commits: ["https://github.com/ByteDeskAI/bytedesk-marketplace/pull/new/tm/TM-388-plugin-rsync-json-activation-report","https://github.com/ByteDeskAI/bytedesk-marketplace/pull/211","https://github.com/ByteDeskAI/bytedesk-marketplace/pull/212","https://github.com/ByteDeskAI/bytedesk-marketplace/pull/221"]
blockedBy: []
blocks: ["TM-386"]
actor: "main"
session: "253de95a-5b3d-4702-b941-9b7ba0507f01"
branch: "fix/ao-local-nats-autostart"
worktree: "/home/ryan/Documents/GitHub/ByteDeskAI/bytedesk-marketplace"
labels: ["ready-for-agent","plugin:plugin-rsync"]
triagedBy: "auto"
updated: "2026-10-05T15:29:43.580Z"
parent: "TM-350"
comments: [{"author":"main","ts":"2026-10-05T11:08:52.671Z","text":"Worker done: commit 03d3d4df; lead re-ran checks (test-plugin-rsync.sh exit 0, 29/0; test-classify.mjs exit 0; validate exit 0). PR #184 -> fix/ao-local-nats-autostart; independent review running."},{"author":"review-sweep","ts":"2026-10-05T15:18:33.012Z","text":"review-sweep: TM-388 is done with commits and no reviewer verdict — needs an independent review or a decision."},{"author":"main","ts":"2026-10-05T15:29:43.575Z","text":"Independent review verdict: approved (lead-dispatched reviewer, R2 APPROVE at 9ac169d7) — https://github.com/ByteDeskAI/bytedesk-marketplace/pull/184#issuecomment-5993332747"}]
evidenceSources: {".bytedesk/task-management/evidence/TM-388-landing.md":{"source":"/home/ryan/Documents/GitHub/ByteDeskAI/bytedesk-marketplace/.bytedesk/task-management/evidence/TM-388-landing.md","sha256":"8eb536e8f3ce01ad722b2ff44a682bdb93b647bcb3d8c170f7fcbf6573a20812","bytes":591,"at":"2026-10-05T11:16:10.445Z"}}
closed: "2026-10-05T11:16:10.780Z"
---

ADR-0041. Owns plugin-rsync/bin/plugin-rsync and its tests. Add a json output mode (flag name: json) listing, per plugin, the caches refreshed and classifying changed paths as live (bin/CLI), needs-reload (hooks, skills, MCP, monitors) or skipped (no install).
