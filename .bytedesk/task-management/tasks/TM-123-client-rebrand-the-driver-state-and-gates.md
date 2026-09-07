---
id: "TM-123"
kind: "task"
status: "done"
created: "2026-09-07T02:42:47.774Z"
board: "bytedeskai/bytedesk-marketplace"
title: "client-rebrand: the driver, state and gates"
epic: "EP-017"
acceptance: [{"text":"next refuses an unapproved stage, and refuses an approved stage whose artifacts changed after approval","done":true,"at":"2026-09-07T02:54:57.949Z"},{"text":"A stage marked complete whose files are missing on disk is reported incomplete","done":true,"at":"2026-09-07T02:54:58.079Z"},{"text":"Stopping between stages needs no command and next resumes from state.json alone","done":true,"at":"2026-09-07T02:54:58.237Z"}]
evidence: [".bytedesk/task-management/evidence/TM-123-test-rebrand.sh"]
commits: ["d3f9721","a5f6717"]
blockedBy: []
blocks: []
actor: "main"
session: "4e1d7087-d606-432e-9341-3ce779b4baf8"
branch: "main"
worktree: "/home/ryan/Documents/GitHub/ByteDeskAI/bytedesk-marketplace"
updated: "2026-09-07T02:55:08.348Z"
closed: "2026-09-07T02:54:59.520Z"
---

bin/rebrand — the CLI that owns the case file and enforces the gate between stages. Extends bytedesk-designer's run-folder contract (references/run-folder-contract.md) with a per-stage approval block, rather than inventing a second state machine.

Commands: new, status, next, approve, reject, collect. The gate lives here because gates in the orchestration layer are prose only — describeGates renders Markdown into the conductor's BOOTSTRAP.md and nothing reads run.gates back (launch.mjs:60-63).

Approval is digest-bound: approve records a sha256 over the stage's sorted artifact set, and next recomputes it and refuses when it no longer matches. Same discipline the run-folder contract already applies to viewed entries, and the same rule task-management's planner applies to board mutations.