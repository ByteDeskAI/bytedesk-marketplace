---
id: "TM-145"
kind: "task"
status: "open"
created: "2026-09-10T01:13:56.738Z"
board: "bytedeskai/bytedesk-marketplace"
title: "task-management: tm evidence double-prefixes the task id when the source filename already carries it"
acceptance: [{"text":"A source named TM-nnn-REPORT.md is stored as TM-nnn-REPORT.md, not TM-nnn-TM-nnn-REPORT.md","done":true,"at":"2026-09-10T03:16:24.001Z"},{"text":"A source named REPORT.md is still stored as TM-nnn-REPORT.md","done":true,"at":"2026-09-10T03:16:24.132Z"},{"text":"The two existing doubled files in this store are removed, leaving one copy each","done":false},{"text":"The four orphaned doubled files are RENAMED (not deleted), every task record naming a doubled path is repointed, and only then are the byte-identical duplicates removed — in that order, because doctor --fix drops refs whose files are gone","done":false}]
evidence: []
commits: ["3f5acda","113e2d7"]
blockedBy: []
blocks: []
actor: "main"
session: "e01dd923-50ea-45d8-9911-b9d5faed94bd"
branch: "main"
worktree: "/home/ryan/Documents/GitHub/ByteDeskAI/bytedesk-marketplace"
updated: "2026-09-10T03:16:24.136Z"
type: "bug"
labels: ["plugin:task-management"]
priority: "low"
comments: [{"author":"main","ts":"2026-09-10T03:16:08.616Z","text":"MERGED at 113e2d7 — AC1 and AC2 met, AC3 OPEN AND ITS WORDING WAS WRONG.\n\nI wrote AC3 as \"The two existing doubled files in this store are removed, leaving one copy each\". That was wrong on the count and, more importantly, wrong on the ACTION. Counted in the evidence directory: EIGHTEEN doubled files, and the population was still growing while it was being counted — two more appeared from attaches made during the reading.\n\nThey are not one population:\n\n  12  byte-identical to a correctly-named sibling   safe to drop\n   4  NO OTHER COPY EXISTS                          must be RENAMED; deleting destroys the only artifact\n   2  content DIFFERS from the sibling              two different artifacts, not one duplicated\n\nThe four orphans are the ones my wording would have destroyed. \"Removed, leaving one copy each\" presumes a second copy exists. For TM-083, TM-111, TM-119 and TM-120 it does not — the doubled name IS the only file, and deleting it deletes the evidence.\n\nThe two that DIFFER are worse than duplicates, because they look like duplicates. TM-127-TM-127-INTEGRATION-VERIFICATION.md and TM-131-TM-130-131-INTEGRATION-VERIFICATION.md each hold content their similarly-named sibling does not. Someone deduplicating by name would silently discard an artifact. Those two need a human decision, not a cleanup rule.\n\nTHE ORDER IS LOAD-BEARING. 18 task records reference a doubled path, and doctor.mjs:279 repairs a missing-evidence finding by DROPPING the ref from the record:\n\n  update(t.id, { evidence: (t.evidence || []).filter((e) => e !== ref) }, p)\n\nSo \"delete the files now, tidy the references later\" is not a slower version of the same cleanup. It is a cleanup that silently strips 18 evidence links the next time anyone runs `tm doctor --fix`, and the links are the only thing that says which artifact belonged to which task. Correct order: rename the four orphans, repoint every record that names a doubled path, then remove the twelve duplicates, and decide the two differing pairs separately.\n\nThe author found this, stopped, and told me before doing any of it. It also began the surgery in the shared checkout, hit index.lock held by this session mid-commit, and backed off rather than race for the index — verified here afterwards, nothing was renamed or deleted and the tree is as it was.\n\nAC3 stays open deliberately. It needs rewriting to describe the three populations and the ordering before anyone executes it; executing the criterion as I wrote it would lose four artifacts and 18 links."}]
---

`tm evidence <id> <path>` unconditionally prepends `<ID>-` to the stored basename. A source file already named `TM-144-REPORT.md` — the natural name to give it, and the name every existing evidence file in the store already uses — is stored as `TM-144-TM-144-REPORT.md`.

Observed twice in the store: `.bytedesk/task-management/evidence/TM-129-TM-129-COORDINATOR-CLOSEOUT.md` sits beside the correctly-named `TM-129-COORDINATOR-CLOSEOUT.md`, and TM-144 reproduced it live during close-out.

The doubled name is cosmetic on its own, but it splits one piece of evidence into two files that look like two artifacts, and the un-prefixed copy is the one a reader finds first while the prefixed one is the one the task record points at.

Fix: skip the prefix when the basename already starts with the id (case-insensitive), the way the id is matched elsewhere. Existing doubled files can be renamed by hand; the two in this store are the whole population.