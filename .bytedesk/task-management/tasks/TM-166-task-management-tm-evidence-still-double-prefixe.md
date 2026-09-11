---
id: "TM-166"
kind: "task"
status: "done"
created: "2026-09-10T21:06:37.866Z"
board: "bytedeskai/bytedesk-marketplace"
title: "task-management: tm evidence still double-prefixes when the filename carries a DIFFERENT task's id"
epic: "EP-018"
acceptance: [{"text":"An artifact whose name carries several task ids attaches to any of them without gaining another prefix, and TM-1 still cannot claim TM-14-NOTES.md.","done":true,"at":"2026-09-10T21:43:48.237Z"},{"text":"A source already inside the evidence directory is referenced rather than re-copied, or the decision to keep copying is argued.","done":true,"at":"2026-09-10T21:43:48.574Z"},{"text":"There is a supported way to detach evidence, so a wrong attach does not require hand-editing the record.","done":true,"at":"2026-09-10T21:43:48.950Z"},{"text":"A test covers the cross-id case with a real shared-artifact name, since that is the shape that actually occurs in this store.","done":true,"at":"2026-09-10T21:43:49.242Z"}]
evidence: [".bytedesk/task-management/evidence/TM-166-CLOSEOUT.md"]
commits: ["e0e398d"]
blockedBy: []
blocks: []
actor: "main"
session: "e01dd923-50ea-45d8-9911-b9d5faed94bd"
branch: "main"
worktree: "/home/ryan/Documents/GitHub/ByteDeskAI/bytedesk-marketplace"
updated: "2026-09-10T21:44:00.225Z"
parkedReason: "Implemented and pushed on tm/TM-166-evidence-refs (eb76594); verified NOT yet an ancestor of origin/main, so it is waiting on the integrator's merge, not on me.\n\nState: evidenceDest in task-management/lib/evidence.mjs no longer double-prefixes when a filename carries a DIFFERENT task's id, an already-in-store path is returned as-is rather than recopied, and the ref set is deduped. Gates green on the branch: unit 1374/1374, store 146, hooks2 40, with 3 of 4 new tests confirmed red against main first.\n\nUnparks the moment the branch is merged; nothing further to build."
evidenceSources: {".bytedesk/task-management/evidence/TM-166-CLOSEOUT.md":{"source":"/tmp/claude-1000/TM-166-CLOSEOUT.md","sha256":"f61ae2b1671ea369035ca29cb8b08bc3b0d12576738e184a6a1543ba0f133fed","bytes":2112,"at":"2026-09-10T21:43:56.331Z"}}
closed: "2026-09-10T21:44:00.218Z"
---

TM-145 fixed the same-id case: a source named TM-144-REPORT.md attached to TM-144 is no longer stored as TM-144-TM-144-REPORT.md. Its guard is deliberately strict — it requires the id to be followed by a separator — so that a short id cannot swallow a longer one's prefix (TM-1 must not claim TM-14-NOTES.md). That strictness is right and must stay.

It leaves the CROSS-ID case uncovered, and that case is real because shared artifacts exist. Reproduced by accident just now:

    tm evidence TM-131 .../evidence/TM-130-131-INTEGRATION-VERIFICATION.md
    -> stored as TM-131-TM-130-131-INTEGRATION-VERIFICATION.md

The basename starts with TM-130, not TM-131, so the guard does not fire and the id is prepended. That re-created exactly the file the TM-145 evidence surgery had just removed, and it is how the store accumulated TM-141-TM-140-141-... and TM-131-TM-130-131-... in the first place: an artifact covering two tasks, attached to the second one.

WHY IT IS NOT A ONE-LINE WIDENING. Skipping the prefix whenever the basename starts with ANY TM-nnn would let an artifact named after task A attach to task B under A's name, which is worse — a reader would file it under the wrong task. The distinction that matters is whether the id being attached appears anywhere in the basename's leading id-run: TM-130-131-... covers 130 and 131, and attaching it to either should store it once, unprefixed.

There is a second, sharper option: stop copying at all for a file already inside the evidence directory, and record the ref as-is. `tm evidence <id> <path already under evidence/>` is a re-attach or a shared-artifact attach, and neither needs a new copy — which also removes the drift-versus-duplicate problem for exactly the cases that produced it.

DISCOVERED BY MAKING THE MISTAKE: I re-attached TM-131 to clear an evidence-drift warning and silently recreated the doubled file. I reverted it by hand — the ref, the provenance entry and the file — because there is no detach verb, which is worth noting on its own: the CLI can create this state and cannot undo it.