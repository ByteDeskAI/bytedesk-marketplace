# TM-485 evidence, round 2: commit 3df30083370dd21b24f6a862fa7d01031041fd80 (PR #232), clean worktree (0 uncommitted paths)

Adds the PR #227 review scope (lead comment 2026-10-08 23:24) on top of 45d2963c.

## Proof that the new tests can fail
With the committed bin/plugin-rsync reverted: 36 passed, 9 failed (trust scope, CODEX_HOME lock, cwd/env, reduced env, busy lock, stale lock, foreign marketplace, two MCP checks). With the change: 45 passed, 0 failed.
A read-only `hooks/list` on this machine's real Codex: all 21 real @bytedesk hooks still qualify under both `untrusted` and `modified` (the caches match source); all 12 user hooks are rejected.

## Required checks at 3df30083
| check | exit |
|---|---|
| agent-orchestration: npm ci | 0 |
| agent-orchestration: build:check | 0 |
| agent-orchestration: plugin validate | 0 (expected "no version" warning) |
| task-management: plugin validate | 0 |
| task-management: unit | 1. 1620 pass, 16 fail, the same 16 test names as at the parent 44b030d4 in a clean worktree (diff empty) |
| agent-orchestration: unit | not completed. mcp-contract.test.mjs never exits, also at 44b030d4 (TM-491) |
| agent-orchestration: changed-code files (setup-self-heal, install-host) | 0 (20/20) |
| plugin-rsync: tests / classify / validate | 0 / 0 / 0 (45/45, 41 checked) |

## Not covered
The stale-lock race itself (two processes reclaiming at once) is not reproduced by a test. Only the reclaim, and nothing left behind afterwards, is tested.
