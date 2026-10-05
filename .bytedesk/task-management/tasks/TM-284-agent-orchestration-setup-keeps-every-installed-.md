---
id: "TM-284"
kind: "task"
status: "done"
created: "2026-10-02T03:45:43.849Z"
board: "bytedeskai/bytedesk-marketplace"
title: "agent-orchestration: setup keeps every installed agent host (Codex, Grok, Kimi) on the same ao build as Claude"
epic: "EP-023"
acceptance: [{"text":"after an ensure, every detected host copy (codex, grok, kimi) reports the same ao version/fingerprint as the pointer; an older copy is refreshed, a newer or equal one is left alone (tests with temp homes)","done":true,"at":"2026-10-02T13:10:41.910Z"},{"text":"a copy whose node_modules lacks a dependency of the new package.json is reported and not left half-updated","done":true,"at":"2026-10-02T13:10:42.309Z"},{"text":"the refresh never copies from a source tree with uncommitted changes under agent-orchestration (test)","done":true,"at":"2026-10-02T13:10:42.688Z"}]
evidence: [".bytedesk/task-management/evidence/TM-006-closure-audit-2026-10-02.md"]
commits: ["https://github.com/ByteDeskAI/bytedesk-marketplace/pull/new/tm/TM-324-agent-orchestration-ao-nats-url-fails-hard"]
blockedBy: []
blocks: ["TM-288"]
actor: "main"
session: "62549d39-62d5-458d-808e-8375ef53518d"
branch: "fix/ao-local-nats-autostart"
worktree: "/home/ryan/Documents/GitHub/ByteDeskAI/bytedesk-marketplace"
labels: ["ready-for-agent"]
triagedBy: "auto"
updated: "2026-10-03T05:37:11.908Z"
knowledge: ["/runbooks/ao-rollout-lessons-managed-services-naming-multi.md"]
comments: [{"author":"main","ts":"2026-10-02T04:24:29.725Z","text":"Shipped locally at e2e7fb8d (0.15.0) with TM-284/285/286; live-verified on Linux (see PR). PR opened."},{"author":"@dc778cb2","ts":"2026-10-02T13:10:43.481Z","text":"Closed by Bastion TM-006 (lead dc778cb2): PR merged into fix/ao-local-nats-autostart (head 35488ce2, not yet main). Each criterion verified against merged code and recorded evidence; see .bytedesk/task-management/evidence/TM-006-closure-audit-2026-10-02.md."},{"author":"@dc778cb2","ts":"2026-10-02T19:00:42.523Z","text":"FOLLOW-UP (2026-10-02): host-copy sync is version-only (see Bastion TM-005); copies of the same version but a different build are not refreshed."}]
evidenceSources: {".bytedesk/task-management/evidence/TM-006-closure-audit-2026-10-02.md":{"source":"/home/ryan/Documents/GitHub/ByteDeskAI/bytedesk-marketplace/.bytedesk/task-management/evidence/TM-006-closure-audit-2026-10-02.md","sha256":"1ff3962db490e740ae7b2844b8938497b7ea480dc6fdab98c647a1adde72ef5b","bytes":5647,"at":"2026-10-02T13:10:43.090Z"}}
closed: "2026-10-02T13:10:43.859Z"
links: [{"type":"relates to","id":"TM-299"}]
---

Observed 2026-10-02: Claude ran ao 0.13.1 while the Codex cache (~/.codex/plugins/cache/bytedesk/agent-orchestration/local) and the Grok install (~/.grok/installed-plugins/agent-orchestration-*) were still 0.11.0 — no services manager, old session names, the NATS crash. Nothing refreshed them; plugin-rsync had to be run by hand. Every host's MCP server talks to the same managed services and state, so mixed builds disagree on naming and identity. Make the automatic setup (SessionStart services ensure and the setup/install-host paths) detect other installed hosts' ao copies, compare build fingerprint/version, and refresh older ones from the current installed plugin root (never from a working tree with uncommitted changes), checking their node_modules satisfy package.json; report what it refreshed.