---
id: "TM-421"
kind: "task"
status: "open"
created: "2026-10-05T14:32:42.823Z"
board: "bytedeskai/bytedesk-marketplace"
title: "agent-orchestration: a supported verb clears an interrupted checkout-repair record"
epic: "EP-028"
acceptance: [{"text":"One verb clears an interrupted record after showing the snapshot branch and stash; lead ensure then proceeds","done":false},{"text":"It refuses for a non-lead caller and records who cleared it in the journal","done":false}]
evidence: []
commits: []
blockedBy: []
blocks: []
actor: "main"
session: "253de95a-5b3d-4702-b941-9b7ba0507f01"
branch: "main"
worktree: "/home/ryan/Documents/GitHub/ByteDeskAI/bytedesk-marketplace"
labels: ["ready-for-agent"]
triagedBy: "auto"
updated: "2026-10-09T01:24:07.449Z"
comments: [{"author":"main","ts":"2026-10-09T01:24:07.439Z","text":"From the #198 delta review: cheap hardening — write the in-progress record before checkout-repair.mjs:246 (staging) rather than :266, and check the exit code of :246/:247/:249 (read-tree); a crash between :247 and :249 today leaves every local edit shown as staged (no loss)."}]
---

From the PR #198 (TM-394) round-2 review: an 'interrupted' checkout_repair record (written before stash push, kept by recoverLead's save) is cleared only by hand-editing leads/<key>.recovery.json; until then lead ensure refuses for that repo. Add 'ao-topology checkout clear --consumer <repo>' (or similar) that shows the snapshot branch and stash, requires the operator or repo lead to confirm they recovered the edits, and clears the record.