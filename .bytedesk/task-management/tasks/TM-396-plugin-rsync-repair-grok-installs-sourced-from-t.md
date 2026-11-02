---
id: "TM-396"
kind: "task"
status: "done"
created: "2026-10-05T12:28:45.072Z"
board: "bytedeskai/bytedesk-marketplace"
title: "plugin-rsync: repair Grok installs sourced from the marketplace root on every machine"
epic: "EP-028"
acceptance: [{"text":"plugin-rsync fix-grok-installs reinstalls root-sourced Grok entries from <root>/<plugin> and is a no-op otherwise","done":true,"at":"2026-10-05T12:31:23.334Z"},{"text":"the plugin-rsync SessionStart hook runs it in the background in any repo, without delaying the session","done":true,"at":"2026-10-05T12:31:23.729Z"}]
evidence: [".bytedesk/task-management/evidence/TM-396-evidence.txt"]
commits: ["https://github.com/ByteDeskAI/bytedesk-marketplace/pull/188","d789bbd3","48e58846","https://github.com/ByteDeskAI/bytedesk-marketplace/pull/212"]
blockedBy: []
blocks: []
actor: "main"
session: "2e1a5469-e106-4fa6-a7ed-35e999950137"
branch: "main"
worktree: "/home/ryan/Documents/GitHub/ByteDeskAI/bytedesk-marketplace"
labels: ["ready-for-agent"]
triagedBy: "auto"
updated: "2026-10-08T23:11:54.624Z"
evidenceSources: {".bytedesk/task-management/evidence/TM-396-evidence.txt":{"source":"/tmp/claude-1000/-home-ryan-Documents-GitHub-ByteDeskAI-bytedesk-marketplace/2e1a5469-e106-4fa6-a7ed-35e999950137/scratchpad/TM-396-evidence.txt","sha256":"72743856cc09221d84aa8b49e7c88ad1388f331dbe2054884c2d50e3a0407ce3","bytes":478,"at":"2026-10-05T12:31:24.111Z"}}
closed: "2026-10-05T12:31:24.447Z"
comments: [{"author":"review-sweep","ts":"2026-10-05T15:18:33.953Z","text":"review-sweep: TM-396 is done with commits and no reviewer verdict — needs an independent review or a decision."},{"author":"main","ts":"2026-10-08T23:11:54.620Z","text":"Independent post-merge review verdict on PR #188: changes requested (lead-dispatched reviewer rv-older, 2026-10-05). MEDIUM: the Grok repair reinstalls plugins from ANY local marketplace with --trust on every session start; LOWs: failed uninstall ignored; 15-minute stale-lock window too short."}]
---

Grok installs whose Local source is the marketplace root (seen: task-management, knowledge-management) copy the whole repo incl. ~27 GB of .bytedesk/worktrees on each start and time out loading plugins, so no hooks run. Detect and reinstall them from their plugin folders automatically from the plugin-rsync session hook, on any machine.