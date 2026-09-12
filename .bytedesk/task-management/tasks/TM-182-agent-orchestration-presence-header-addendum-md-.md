---
id: "TM-182"
kind: "task"
status: "open"
created: "2026-09-11T20:13:02.356Z"
board: "bytedeskai/bytedesk-marketplace"
title: "agent-orchestration: PRESENCE-HEADER-ADDENDUM.md no longer matches its recorded signed hash"
epic: "EP-019"
acceptance: [{"text":"Decide and record whether the D1 amendment needed a gateway re-countersignature, citing the evidence","done":false},{"text":"The hash record is updated with a dated amendment entry listing old and new hashes for every changed file","done":false},{"text":"A test compares every recorded contract hash with the file on disk and fails on drift","done":false}]
evidence: []
commits: []
blockedBy: []
blocks: []
actor: "main"
session: "8e87dbc7-3321-4e05-8648-b64d7c6319bb"
branch: "main"
worktree: "/home/ryan/Documents/GitHub/ByteDeskAI/bytedesk-marketplace"
updated: "2026-09-11T20:13:13.151Z"
labels: ["plugin:agent-orchestration"]
---

Found by W6 during TM-168 (2026-09-11). The header addendum was countersigned with sha256 6f15b383 recorded at 387e4ec (evidence/TM-136-HEADER-EXTENSION-HASHES.txt). The D1 amendment in 830c983 changed the addendum (now e92a54f2) and the header README, h01, h02 and n01 fixtures, but no hash record was updated, so the signed artifact and its recorded hash disagree. The TM-168 role-icon addendum records both states and changes none of these files.