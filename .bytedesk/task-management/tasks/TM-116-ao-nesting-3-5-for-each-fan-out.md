---
id: "TM-116"
kind: "task"
status: "done"
created: "2026-09-06T22:55:06.834Z"
board: "bytedeskai/bytedesk-marketplace"
title: "AO nesting 3/5: for_each fan-out"
epic: "EP-016"
acceptance: [{"text":"for_each expands to N children, each with its own item interpolated","done":true,"at":"2026-09-06T23:22:28.996Z"},{"text":"A send to the collective id reaches all children and wait barriers over all of them","done":true,"at":"2026-09-06T23:22:29.108Z"},{"text":"The width cap refuses rather than spawning unbounded sessions","done":true,"at":"2026-09-06T23:22:29.225Z"}]
evidence: [".bytedesk/task-management/evidence/TM-116-topology-lineage.test.mjs"]
commits: ["4b9c20f"]
blockedBy: []
blocks: []
actor: "main"
session: "4e1d7087-d606-432e-9341-3ce779b4baf8"
branch: "main"
worktree: "/home/ryan/Documents/GitHub/ByteDeskAI/bytedesk-marketplace"
updated: "2026-09-06T23:22:29.459Z"
closed: "2026-09-06T23:22:29.454Z"
---

Step 3. One participant entry becomes N child runs.

- for_each accepts an array or a comma-separated string, matching how candidates already accepts both (spec.mjs:~123). {{item}} and {{item.<key>}} interpolate per child.
- Children addressed <id>.<slug> individually, <id> collectively: a send to the bare id fans out, wait --from <id> is a barrier over all.
- --max-fanout (default 8). Ten PANES was measured flat at 9.6s, but ten children is ten tmux SESSIONS — width is the cost that matters, not depth.