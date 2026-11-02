# TM-485 rework (round 3) — evidence

Revision: 2cbe08a954d4d0d201709ca5d9eeb5497f16aa0b (rework 5bc04f93 + merge of origin/main 77c05462c8ee3dd156182a365ad02433cf916afd). Tree clean at measurement.

## Review findings (c164bf8b changes_requested, lead review) and what changed
| finding | fix | test (fails on 3df30083, passes now) |
|---|---|---|
| major: same-version different build only reported (host-copies.mjs:49) | keepBuild keeps only a strictly newer build; equal ordinal is refreshed behind the existing gates | setup-self-heal "TM-299: same-version builds are ordered..." — "equal" now refreshed and records BUILD_META |
| major: CHANGELOG/dist outside touches | kept (required by src change); lead mailed to widen touches + add plugin-rsync suite to required checks | — |
| major: no check evidence | all six required checks + plugin-rsync suite run at 2cbe08a954d4d0d201709ca5d9eeb5497f16aa0b (below) | — |
| minor: stale-lock race | random owner token in each lock; stale lock removed only if token unchanged after rename-aside, else put back and busy; release removes only own token's lock (inode rejected: reuse observed in test) | "a lock release never removes another run's lock" |
| minor: modified hook trusted on partial compare | whole cached plugin root (excl. node_modules/.git) must equal source, no extra files | "not trusted when another file differs", "...holds a file source lacks", control "trusted once tree matches" |
| lead MEDIUM: TypeError after sync from worktree (plugin-rsync:644) | `r.ok && r.trusted.length` | "a sync from a checkout Codex does not install from exits 0" (old: rc=1) |

Mutation check: new plugin-rsync tests run against `git archive 3df30083 plugin-rsync` fail 5 (foreign-trust sync rc=1, modified sibling tamper, planted file, lock ownership).

## Required checks at 2cbe08a954d4d0d201709ca5d9eeb5497f16aa0b
- npm-ci 0
- ao-build-check 0
- ao-validate 0
- tm-validate 0
- pr-validate 0
- pr-tests 0
- pr-classify 0
- tm-unit 1
- ao-unit 1

- task-management unit: pass 1662 fail 15; the same 15 top-level failures at origin/main 77c05462c8ee3dd156182a365ad02433cf916afd in a clean worktree. task-management is unchanged by this branch.
- agent-orchestration unit: pass 1284 fail 9 (completed, 587 s); the same 9 failing test names at origin/main 77c05462c8ee3dd156182a365ad02433cf916afd (pass 1283 fail 9).

Logs: ao-unit.log, ao-unit-base.log, tm-unit.log, tm-unit-base.log, pr-tests.log.

## Follow-up
TM-512: installedDests ignores CODEX_HOME while trust honours it (found, not in this scope).
