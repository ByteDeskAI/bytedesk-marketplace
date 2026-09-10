---
id: "TM-145"
kind: "task"
status: "open"
created: "2026-09-10T01:13:56.738Z"
board: "bytedeskai/bytedesk-marketplace"
title: "task-management: tm evidence double-prefixes the task id when the source filename already carries it"
acceptance: [{"text":"A source named TM-nnn-REPORT.md is stored as TM-nnn-REPORT.md, not TM-nnn-TM-nnn-REPORT.md","done":false},{"text":"A source named REPORT.md is still stored as TM-nnn-REPORT.md","done":false},{"text":"The two existing doubled files in this store are removed, leaving one copy each","done":false}]
evidence: []
commits: []
blockedBy: []
blocks: []
actor: "main"
session: "2ee26155-9e57-4cf8-8bc4-a8379f88e5a4"
branch: "main"
worktree: "/home/ryan/Documents/GitHub/ByteDeskAI/bytedesk-marketplace"
updated: "2026-09-10T01:14:00.206Z"
type: "bug"
labels: ["plugin:task-management"]
priority: "low"
---

`tm evidence <id> <path>` unconditionally prepends `<ID>-` to the stored basename. A source file already named `TM-144-REPORT.md` — the natural name to give it, and the name every existing evidence file in the store already uses — is stored as `TM-144-TM-144-REPORT.md`.

Observed twice in the store: `.bytedesk/task-management/evidence/TM-129-TM-129-COORDINATOR-CLOSEOUT.md` sits beside the correctly-named `TM-129-COORDINATOR-CLOSEOUT.md`, and TM-144 reproduced it live during close-out.

The doubled name is cosmetic on its own, but it splits one piece of evidence into two files that look like two artifacts, and the un-prefixed copy is the one a reader finds first while the prefixed one is the one the task record points at.

Fix: skip the prefix when the basename already starts with the id (case-insensitive), the way the id is matched elsewhere. Existing doubled files can be renamed by hand; the two in this store are the whole population.