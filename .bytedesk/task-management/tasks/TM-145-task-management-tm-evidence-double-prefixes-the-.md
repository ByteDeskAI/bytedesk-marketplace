---
id: "TM-145"
kind: "task"
status: "blocked"
created: "2026-09-10T01:13:56.738Z"
board: "bytedeskai/bytedesk-marketplace"
title: "task-management: tm evidence double-prefixes the task id when the source filename already carries it"
acceptance: [{"text":"A source named TM-nnn-REPORT.md is stored as TM-nnn-REPORT.md, not TM-nnn-TM-nnn-REPORT.md","done":true,"at":"2026-09-10T03:13:27.142Z"},{"text":"A source named REPORT.md is still stored as TM-nnn-REPORT.md","done":true,"at":"2026-09-10T03:13:27.301Z"},{"text":"The two existing doubled files in this store are removed, leaving one copy each","done":false}]
evidence: []
commits: ["114f4ad","a05c993","eac8ae7","f840403"]
blockedBy: []
blocks: []
actor: "main"
session: "e01dd923-50ea-45d8-9911-b9d5faed94bd"
branch: "main"
worktree: "/home/ryan/Documents/GitHub/ByteDeskAI/bytedesk-marketplace"
updated: "2026-09-10T03:13:27.453Z"
type: "bug"
labels: ["plugin:task-management"]
priority: "low"
blockedReason: "Code fix complete and gated; AC3 (removing the doubled files) deliberately NOT done here and handed to the integrator with data. Branch tm/TM-145-evidence-prefix off main, head is the evidence-prefix commit. The prefix is skipped when the basename already carries the id, case-insensitive, separator required so TM-1 cannot swallow TM-14-NOTES.md. Two new tests, both red against unmodified main; task-management unit 1366/1366. AC3 is bigger and more dangerous than the task assumed: the population is 18 doubled files, not two, and they are NOT interchangeable — 11 are byte-identical to a correct sibling and can be dropped, 4 have NO single copy so deleting them destroys the only artifact and they must be renamed, and TM-127's pair DIFFERS in content, meaning two artifacts rather than one duplicated. 19 task records reference doubled paths, and doctor's missing-evidence repair DELETES a ref whose file is gone — so the records must be repointed BEFORE any file is removed or the cleanup silently strips 19 evidence links. I started that surgery in the shared checkout and stopped when git reported index.lock held by another process mid-commit; nothing was renamed or deleted, verified. That tree is the integrator's."
---

`tm evidence <id> <path>` unconditionally prepends `<ID>-` to the stored basename. A source file already named `TM-144-REPORT.md` — the natural name to give it, and the name every existing evidence file in the store already uses — is stored as `TM-144-TM-144-REPORT.md`.

Observed twice in the store: `.bytedesk/task-management/evidence/TM-129-TM-129-COORDINATOR-CLOSEOUT.md` sits beside the correctly-named `TM-129-COORDINATOR-CLOSEOUT.md`, and TM-144 reproduced it live during close-out.

The doubled name is cosmetic on its own, but it splits one piece of evidence into two files that look like two artifacts, and the un-prefixed copy is the one a reader finds first while the prefixed one is the one the task record points at.

Fix: skip the prefix when the basename already starts with the id (case-insensitive), the way the id is matched elsewhere. Existing doubled files can be renamed by hand; the two in this store are the whole population.