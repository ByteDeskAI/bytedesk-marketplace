---
id: "TM-181"
kind: "task"
status: "open"
created: "2026-09-11T20:13:02.173Z"
board: "bytedeskai/bytedesk-marketplace"
title: "agent-orchestration: tests/stability.mjs reports an empty run as stable"
epic: "EP-019"
acceptance: [{"text":"stability.mjs exits non-zero and prints NO TESTS RAN when the pattern matches no files or any run executes zero tests","done":false},{"text":"Each run line reports its test count alongside its fail count","done":false},{"text":"A test proves the empty-pattern case fails and a real pattern still passes","done":false}]
evidence: []
commits: []
blockedBy: []
blocks: []
actor: "main"
session: "8e87dbc7-3321-4e05-8648-b64d7c6319bb"
branch: "main"
worktree: "/home/ryan/Documents/GitHub/ByteDeskAI/bytedesk-marketplace"
updated: "2026-09-11T20:13:12.998Z"
labels: ["plugin:agent-orchestration"]
---

Found by W6 during TM-168 (2026-09-11). node tests/stability.mjs --runs 5 --pattern 'tests/unit/does-not-exist-*.test.mjs' prints '0 fail ... stable' and exits 0: the harness cannot tell a run that executed no tests from a run where every test passed, so a mistyped --pattern reads as a green stability measurement. This is rule 1 of .claude/rules/verification-that-can-fail.md in the tool built to enforce it (TM-165). W6 worked around it by repeating direct node --test runs and reading the # tests count.