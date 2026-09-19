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
commits: ["c22a3b4"]
blockedBy: []
blocks: []
actor: "pool"
session: "pool-tm-181"
updated: "2026-09-13T21:29:46.636Z"
labels: ["plugin:agent-orchestration","ready-for-human"]
triagedBy: "human"
comments: [{"author":"main","ts":"2026-09-13T20:38:33.383Z","text":"Reproduced exactly, 2026-09-13, during TM-171's AC3. Command: node tests/stability.mjs --runs 1 --pattern 'tests/unit/zzz-no-such-file-*.test.mjs'. Output: '1 runs - fail counts 0 / stable: every run agreed, and every run passed.', exit 0, elapsed 0s, having executed nothing. That is byte-identical in form to a genuine 10-run green result, so the harness's verdict cannot distinguish a clean suite from a pattern that matches no files, and any caller checking only the exit code reads an empty run as health.\n\nThe separating value is elapsed time: empty pattern 0s, one real test file 3s, the real 10-run AC3 pass 652s (65.2s per run, against 67.7s for a directly measured full topology suite). A fix should print what the run actually covered - the file count the pattern resolved to, or the total test count - and exit non-zero when it resolves to zero files."}]
---

Found by W6 during TM-168 (2026-09-11). node tests/stability.mjs --runs 5 --pattern 'tests/unit/does-not-exist-*.test.mjs' prints '0 fail ... stable' and exits 0: the harness cannot tell a run that executed no tests from a run where every test passed, so a mistyped --pattern reads as a green stability measurement. This is rule 1 of .claude/rules/verification-that-can-fail.md in the tool built to enforce it (TM-165). W6 worked around it by repeating direct node --test runs and reading the # tests count.