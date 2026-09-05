---
id: "TM-095"
kind: "task"
status: "open"
created: "2026-09-05T04:01:43.560Z"
board: "bytedeskai/bytedesk-marketplace"
title: "Extract fleet's depth-based authorization taxonomy before the plugin is retired"
epic: "EP-014"
acceptance: [{"text":"The four authorization classes and the depth rules are recorded outside the fleet directory","done":false},{"text":"The record states how external inbound fits as an additional class","done":false},{"text":"The extracted document is referenced from the hierarchy work","done":false}]
evidence: []
commits: ["8f135ad"]
blockedBy: []
blocks: ["TM-094"]
actor: "main"
session: "a7da6c38-57d4-464b-b856-ebdb3dd72e1b"
branch: "main"
worktree: "/home/ryan/Documents/GitHub/ByteDeskAI/bytedesk-marketplace"
updated: "2026-09-05T04:08:51.474Z"
---

fleet's ADR-0001 is the only hierarchical authorization model in the ecosystem: CLAUDE_SESSION_DEPTH set by spawn-claude-feature, depth 0 requiring a human in the transcript, depth >= 1 inheriting from spawn, and repo-destructive actions ignoring depth entirely. The four classes are local-blast, PR-level, repo-destructive and external. fleet is being retired as a plugin, so the taxonomy needs extracting before it goes - it is the natural substrate for the team-lead hierarchy, with external inbound as a fourth class beside the existing three. This is documentation salvage, not implementation.