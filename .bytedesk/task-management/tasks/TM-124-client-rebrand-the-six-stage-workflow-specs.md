---
id: "TM-124"
kind: "task"
status: "done"
created: "2026-09-07T02:42:47.941Z"
board: "bytedeskai/bytedesk-marketplace"
title: "client-rebrand: the six stage workflow specs"
epic: "EP-017"
acceptance: [{"text":"All six validate, and dry-run with zero missing-skill warnings","done":true,"at":"2026-09-07T02:54:58.405Z"},{"text":"Stage 6 expands one entry into one child run per page","done":true,"at":"2026-09-07T02:54:58.557Z"}]
evidence: [".bytedesk/task-management/evidence/TM-124-CONTRACT.md"]
commits: ["d3f9721"]
blockedBy: []
blocks: []
actor: "main"
session: "4e1d7087-d606-432e-9341-3ce779b4baf8"
branch: "main"
worktree: "/home/ryan/Documents/GitHub/ByteDeskAI/bytedesk-marketplace"
updated: "2026-09-07T02:55:00.148Z"
closed: "2026-09-07T02:54:59.695Z"
---

Six abstract ao-topology specs, one per stage: discovery, identity, direction, theme, brand, mockups. Each takes client_dir plus its own inputs, reads prior stages from disk, writes only into its own stage folder.

Must use the bytedesk-designer-* skills, which resolve. Must NOT reference brand-brief, brand-concept, brand-judge, brand-explore or design-system-assets — all five are absent from every skill directory, so the two shipped brand specs currently launch with three of four skills missing.

Stage 5 is PNG-only by operator instruction. Stage 6 is PNG renderings only and fans out one child run per page with for_each.