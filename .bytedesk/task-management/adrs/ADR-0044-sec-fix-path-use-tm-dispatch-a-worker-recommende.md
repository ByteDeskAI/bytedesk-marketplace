---
id: "ADR-0044"
kind: "adr"
status: "proposed"
created: "2026-10-08T23:08:46.534Z"
board: "bytedeskai/bytedesk-marketplace"
title: "Sec fix path: use tm dispatch a worker (Recommended)"
epic: "EP-028"
decisionKey: "c75b28faf387"
date: "2026-10-08"
updated: "2026-10-08T23:08:46.541Z"
---

## Context

Captured from an AskUserQuestion during a Claude Code session on 2026-10-08.
The question asked was: The TM-427/TM-428 review-gate security fix is fully designed but no worker in this session can apply it: Edit/Write are unavailable here, and the repo's worktree guard refuses shell edits whose text contains git arguments (the fix is mostly git argument lists). How should it be applied?

## Decision

**The TM-427/TM-428 review-gate security fix is fully designed but no worker in this session can apply it: Edit/Write are unavailable here, and the repo's worktree guard refuses shell edits whose text contains git arguments (the fix is mostly git argument lists). How should it be applied?** → chose **tm dispatch a worker (Recommended)**.

Rejected:
- **EP-028 lead applies it** — Hand the design to the EP-028 lead's session, which can edit, and keep reviewing and merging on my side. It owns adjacent gate fixes already.
- **Enable Edit/Write here** — You change this session's tool/permission settings so my workers get Edit/Write; I re-dispatch. (I can't change settings myself.)

## Consequences

_TODO: what this makes easy, what it makes hard, and what would have to be true to revisit it._