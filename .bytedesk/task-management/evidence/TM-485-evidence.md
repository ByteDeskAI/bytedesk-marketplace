# TM-485 evidence: commit 45d2963cf194dc8ff4ca8363273d8c4b8f35cbfa, PR #232

The tree also held hook-rewritten graft files that are not part of the commit (.claude/*, .grok/*, .mcp.json, opencode.json). None is read by these checks.

## Proof that each new test can fail
- plugin-rsync, old bin/plugin-rsync with the new tests: 33 passed, 3 failed (other marketplace, untrusted entry, failed uninstall). With the new code: 36 passed, 0 failed.
- agent-orchestration, old host-copies.mjs: `TM-485: a directory that is not this plugin…` fails. New code: setup-self-heal 16/16.

## Required checks at 45d2963c
| check | exit | note |
|---|---|---|
| agent-orchestration: npm ci | 0 | |
| agent-orchestration: build:check | 0 | dist was rebuilt; the diff is the looksLikeCopy check plus the fingerprint only |
| agent-orchestration: plugin validate | 0 | 1 expected "no version" warning |
| task-management: plugin validate | 0 | warnings only |
| task-management: unit | 1 | 1620 pass, 16 fail; the same 16 fail at the parent commit 44b030d4 in a clean worktree. Not caused by this change; task-management is untouched |
| agent-orchestration: unit | did not complete | mcp-contract.test.mjs never exits after its last test, also at 44b030d4 in a clean worktree (filed as TM-491). Without that file, the run was stopped at 1 h after 240 tests, with 3 failures in files that do not import the changed code (TM-355 run mail; two idle live roles diagnostics). |
| agent-orchestration: changed-code files (setup-self-heal, install-host) | 0 | 20/20 |
| plugin-rsync tests + classify + validate | 0 | 36/36; classify checked 41 |
