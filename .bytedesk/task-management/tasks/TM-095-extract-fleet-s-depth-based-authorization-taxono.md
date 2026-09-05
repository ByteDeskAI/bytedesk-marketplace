---
id: "TM-095"
kind: "task"
status: "done"
created: "2026-09-05T04:01:43.560Z"
board: "bytedeskai/bytedesk-marketplace"
title: "Extract fleet's depth-based authorization taxonomy before the plugin is retired"
epic: "EP-014"
acceptance: [{"text":"The four authorization classes and the depth rules are recorded outside the fleet directory","done":true,"at":"2026-09-05T07:29:31.458Z"},{"text":"The record states how external inbound fits as an additional class","done":true,"at":"2026-09-05T07:29:31.602Z"},{"text":"The extracted document is referenced from the hierarchy work","done":true,"at":"2026-09-05T07:29:31.729Z"}]
evidence: [".bytedesk/task-management/evidence/TM-095-authorization-classes.md"]
commits: ["8f135ad","85b7619"]
blockedBy: []
blocks: ["TM-094"]
actor: "main"
session: "b0124774-6c67-41ff-9359-e1a31565e734"
branch: "main"
worktree: "/home/ryan/Documents/GitHub/ByteDeskAI/bytedesk-marketplace"
updated: "2026-09-05T07:32:49.016Z"
closed: "2026-09-05T07:29:32.073Z"
---

fleet's ADR-0001 is the only hierarchical authorization model in the ecosystem: CLAUDE_SESSION_DEPTH set by spawn-claude-feature, depth 0 requiring a human in the transcript, depth >= 1 inheriting from spawn, and repo-destructive actions ignoring depth entirely. The four classes are local-blast, PR-level, repo-destructive and external. fleet is being retired as a plugin, so the taxonomy needs extracting before it goes - it is the natural substrate for the team-lead hierarchy, with external inbound as a fourth class beside the existing three. This is documentation salvage, not implementation.