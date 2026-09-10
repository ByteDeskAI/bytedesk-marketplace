---
id: "TM-149"
kind: "task"
status: "open"
created: "2026-09-10T01:26:57.410Z"
board: "bytedeskai/bytedesk-marketplace"
title: "task-management: gates run from a git archive tree always fail the MCP handshake test"
acceptance: [{"text":"Running the task-management unit suite from a git archive tree does not report a failure that a checkout does not","done":false},{"text":"The handshake assertion still fails in a real checkout whose handshake genuinely answers 'dev'","done":false},{"text":"Whichever route is taken, the reason is stated where the next reader running gates in isolation will see it","done":false}]
evidence: []
commits: ["df1af22"]
blockedBy: []
blocks: []
actor: "main"
session: "2ee26155-9e57-4cf8-8bc4-a8379f88e5a4"
branch: "main"
worktree: "/home/ryan/Documents/GitHub/ByteDeskAI/bytedesk-marketplace"
updated: "2026-09-10T01:27:05.675Z"
type: "bug"
labels: ["plugin:task-management"]
---

`tests/unit/mcp.test.mjs` asserts the MCP handshake does not answer `dev`, and its own comment states how it is meant to pass: "a source checkout asks git". A `git archive` extract has no `.git` directory, so the handshake answers `dev` and the assertion fails by construction — in every archive tree, at every revision, forever.

This is a harness gap, not a code defect, but it costs real time and has already produced one wrong conclusion. The TM-135 worktree dispatcher ran its gates from two independent `git archive` trees — good isolation discipline, deliberately chosen after an earlier worker had symlinked one `node_modules` into both its tree and its control — and reported `not ok 206` as a pre-existing defect needing an owner. Both of its trees lacked `.git` identically, so the control shared the confounder and could not detect it. That is the second occurrence of the exact failure its own evidence document warns about.

Verified: current main passes this test in a real checkout (task-management unit suite 1350 pass, 0 fail), and the same test fails when main is extracted with `git archive` into /tmp and run there.

Options: skip the assertion when no `.git` and no installed-path SHA is resolvable, and say so in the skip message; or document that gates must run from a checkout or clone, never an archive. The first is better — the next person to reach for archive isolation will not read the doc first.