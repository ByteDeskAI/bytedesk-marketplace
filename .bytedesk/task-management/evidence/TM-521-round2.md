# TM-521 round 2 — revision 2c55198a46e48f8d11d0099e18d8e35c44737305 (clean tree)

## Outcome

The round-1 guard change (dropping quoted arguments after any expansion) is gone. Merging
origin/main (1c497151) brought TM-481, which refuses every expansion-named command outright
(`worker-guard.mjs` `check`: `if (cmd.unknown !== undefined) return block("unparsed", …)`) and
reads a spelled-out `tm` line as data (allowlist U1). That made the round-1 exemption dead code,
so it was reverted to main's text. The PR now adds only a regression test and a CHANGELOG entry.

## The faro bypass, reproduced and closed

`/tmp/tm521-compare.mjs` run against the round-1 revision (59a5d71f) and round 2:

| command | 59a5d71f allowed | round 2 allowed |
|---|---|---|
| `$SHELL -c "gh pr merge 5"` | true | false |
| `"$BASH" -c 'git push origin main'` | true | false |
| `$X -lc "gh pr create --base other"` | true | false |

## Acceptance criteria (test `TM-521: a tm block reason …`, run with the hook's `WORKER` ctx)

1. Allowed: `.bytedesk/task-management/bin/tm block TM-262 "<reason quoting gh pr create and git push>"`,
   the same with `comment`, and `tm block …`.
2. Refused: `gh pr create --base other`, `git push origin 6d510be:feature/x`, the tm block chained to
   `gh pr create`, `$TM block …`, `$GH pr merge 5`, and the three bypass commands above. Behind the
   allowlist, the table also refuses the three bypass commands as `unparsed`.

## Required checks at 2c55198a (run as configured, from `management.required_checks`)

| check | exit |
|---|---|
| agent-orchestration: npm ci | 0 |
| agent-orchestration: unit | 1 (1309 pass / 11 fail; no agent-orchestration file changed) |
| agent-orchestration: build:check | 0 |
| task-management: unit | 1 (1661 pass / 41 fail) |
| agent-orchestration: plugin validate | 0 |
| task-management: plugin validate | 0 |
| plugin-rsync: tests | 0 |

Control: `task-management: unit` at origin/main (1c497151) in a clean detached worktree, same
command: exit 1, 1660 pass / 41 fail, the **identical** `not ok` list. The branch adds exactly one
passing test. Both runs happened inside a dispatched worker session (TM-306/TM-511): the failing
hook-glue tests spawn `tm-hook.sh` and see the live worker's process tree. Isolation removed: the
`env -i` allowlist strips env, not the process ancestry.
