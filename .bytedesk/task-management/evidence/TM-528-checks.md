# TM-528 evidence — checks at 88fea25b51a47c9c3006304fa9afe186ffac3013

## Focused tests (the change)

`node --test --test-concurrency=1 --test-name-pattern="TM-528|TM-349" agent-orchestration/tests/unit/topology-management.test.mjs`
→ exit 0, 12 pass, 0 fail. This includes the two new TM-528 tests:

- AC1: `manage rebase` narrows a started record from the stale `main` merge-base to the server tip
  merge-base of `program`. It records `base-narrowed` (from, to, branch, tip, revision, by), sets
  `integration_branch`, and re-queues the pending review with the new base. The range then holds
  only `code.txt`. It refuses with no target_branch, for another session, with no server, and
  for a widening tip. It is idempotent.
- AC2: admission records `base_warning` (on the record and on the start event) when target_branch is unset
  and the PR targets `program` rather than the default `main`. There is no warning when the PR targets `main`.

## Required checks

| check | exit |
|---|---|
| agent-orchestration: npm ci | 0 |
| agent-orchestration: build:check | 0 |
| agent-orchestration: plugin validate | 0 |
| task-management: plugin validate | 0 |
| plugin-rsync: tests | 0 |
| agent-orchestration: unit | 1 — 1342 pass, 10 fail |
| task-management: unit | 1 — 1685 pass, 41 fail |

Both unit failures are host artifacts, not code. This session is a tm-dispatched worker.
`tm govern` and `goal resume` detect that by **process ancestry**, which `env -i` does not remove,
so they refuse with "a dispatched worker cannot grant or change governed task ownership" or
"refused for an agent session (dispatched worker via ancestry)".
Control: the same tests at base 8189a6bd in a clean detached worktree, run under the same env -i,
also fail 3 of 3 with the same message. This commit does not touch task-management.
The 17 roadmap failures from the first run were caused by this change (src/mcp.mjs hash in
ROADMAP-SOURCES.json). They are fixed in 88fea25b and `roadmap.mjs --check` reports OK.
