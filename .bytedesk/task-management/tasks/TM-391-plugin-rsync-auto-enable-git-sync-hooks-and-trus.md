---
id: "TM-391"
kind: "task"
status: "done"
created: "2026-10-05T11:25:26.427Z"
board: "bytedeskai/bytedesk-marketplace"
title: "plugin-rsync: auto-enable git sync hooks and trust bytedesk hooks in Codex and Grok sessions"
epic: "EP-028"
acceptance: [{"text":"SessionStart hook in plugin-rsync sets core.hooksPath in a fresh checkout under Claude, Codex and Grok","done":true,"at":"2026-10-05T11:46:42.571Z"},{"text":"plugin-rsync trusts untrusted bytedesk Codex hooks after a Codex sync, proven against a stale hash","done":true,"at":"2026-10-05T11:46:42.914Z"}]
evidence: [".bytedesk/task-management/evidence/TM-391-evidence.txt"]
commits: ["3ff1773d","https://github.com/ByteDeskAI/bytedesk-marketplace/pull/187","9eccb0d6"]
blockedBy: []
blocks: []
actor: "main"
session: "2e1a5469-e106-4fa6-a7ed-35e999950137"
branch: "main"
worktree: "/home/ryan/Documents/GitHub/ByteDeskAI/bytedesk-marketplace"
labels: ["ready-for-agent"]
triagedBy: "auto"
updated: "2026-10-08T23:11:54.279Z"
parkedReason: "PR #187 open; AI review running. Resume: apply findings, merge #187, sync main, accept AC, done."
evidenceSources: {".bytedesk/task-management/evidence/TM-391-evidence.txt":{"source":"/tmp/claude-1000/-home-ryan-Documents-GitHub-ByteDeskAI-bytedesk-marketplace/2e1a5469-e106-4fa6-a7ed-35e999950137/scratchpad/TM-391-evidence.txt","sha256":"0e396e6c1758862162d7d679328909d7a5ed6a3af6ee34734e1a914ce8bf9e29","bytes":505,"at":"2026-10-05T11:46:43.238Z"}}
closed: "2026-10-05T11:46:43.577Z"
comments: [{"author":"review-sweep","ts":"2026-10-05T15:18:33.475Z","text":"review-sweep: TM-391 is done with commits and no reviewer verdict — needs an independent review or a decision."},{"author":"main","ts":"2026-10-08T23:11:54.274Z","text":"Independent post-merge review verdict on PR #187: approved (lead-dispatched reviewer rv-older, 2026-10-05). LOWs: tests do not unset CODEX_HOME; auto-trust accepts any @bytedesk marketplace; ignores CODEX_HOME."}]
---

Make the TM-389 plugin auto-rsync work for Codex and Grok, not only Claude: a plugin SessionStart hook sets core.hooksPath in marketplace checkouts; Codex hook trust is written through its app-server so new hooks run without TUI approval.