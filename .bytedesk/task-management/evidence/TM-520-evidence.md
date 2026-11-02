# TM-520 evidence (commit ea75d2bf)

## Fixture test
```
ok 1 - TM-520: doctor names the live reviewer that lacks review_submit and passes the healthy lead
ok 2 - TM-520: role status carries the same verdict, and "expected none" is explicit
ok 3 - TM-520: a relaunched reviewer whose ao-review child runs is healthy; one whose child died is not
# pass 3
# fail 0
```
Mutation: ROLE_REQUIRED_MCP = {} -> pass 1, fail 2.

## Live doctor, agent-fabric
```
Role MCP:
  ✓ lead c2c984bc pid 916967 — expected none, none running
  ✗ reviewer bf039c07 pid 311358 — expected ao-review; running none
Problems:
  ! Live reviewer bf039c07 (pid 311358) lacks MCP server(s) ao-review (launched with --safe-mode, which turns off every MCP server (argv from before TM-365)).
    fix: ao-topology agent restart bf039c07 --mode handoff --consumer /home/ryan/Documents/GitHub/ByteDeskAI/agent-fabric
    note: A forced relaunch is required: `reviewer ensure` / `lead ensure` reattach a live session with its old argv instead of relaunching it (TM-488).
```

## Required checks at ea75d2bf
```
npm-ci 0
ao-unit 1
build-check 0
tm-unit 1
ao-validate 0
tm-validate 0
```

ao-unit (9 failures) and tm-unit (15 failures) are pre-existing: the same test names fail at base
c9cd187e and at ea75d2bf, each in a clean detached worktree (0 dirty paths), via `diff` of the
`not ok` lines. Files: goal-loop-console, topology-management, topology-prompt-modes,
workflow-control (AO); actor, dispatch/claim, governed worker lifecycle (tm). This PR touches none
of them, and task-management not at all.
