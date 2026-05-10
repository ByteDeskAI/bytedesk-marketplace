---
name: cleanup
description: Find sessions in the multi-session command center whose PRs have already merged on GitHub, and kill+cleanup each (with confirmation). Closes the loop on "spawn → ship → tidy up" without manual bookkeeping. Use when the user says "fleet cleanup", "/fleet:cleanup", "kill the merged sessions", "tidy up", "sweep done agents", or any phrasing about reclaiming finished sessions.
user-invokable: true
argument-hint: "[--dry-run]    # show what would be killed without doing it"
allowed-tools:
  - Bash
---

## What this skill does

Walks every active session in the dashboard, checks each session's branch on GitHub via `gh pr list`, and identifies sessions whose PR has merged. Offers to `claude-sessions kill` each merged one (confirms once for the whole batch, not per session).

Implements roadmap item #2.2 (auto-cleanup on PR merge) but invoked manually rather than via webhook. Safe to run any time — read-only until the final confirm.

## Steps

1. Parse `--dry-run` if present.
2. List active sessions: parse `claude-sessions` output for ticket names + branch names.
3. For each session, look up the PR by branch name:
   ```
   gh pr list --head <branch> --state all --json number,state,mergedAt,url --limit 1
   ```
4. Bucket each session into one of:
   - **MERGED** — PR exists and `state == "MERGED"`. Eligible for cleanup.
   - **CLOSED** (not merged) — PR exists, state is `CLOSED`. Eligible (work was abandoned).
   - **OPEN** — PR exists, state `OPEN`. Skip.
   - **NO_PR** — branch never had a PR. Skip.
5. Print the table — every session with its PR status, with eligible ones flagged.
6. If `--dry-run`, stop here.
7. If at least one is eligible, ask the user once: "Kill and cleanup the N eligible sessions? [y/N]"
8. On confirm, run `claude-sessions kill <ticket>` for each eligible session, **answering `y` to its confirmation prompt automatically** (since the user already confirmed the batch).
9. Report final state.

## Output format

Discovery table:
```
PR-status sweep across 5 sessions:

  STATUS    TICKET    BRANCH                                     PR    URL
  MERGED    BDP-360   feature/BDP-360-project-dns-host-ui        #340  https://github.com/ByteDeskAI/bytedesk-platform/pull/340
  MERGED    BDP-361   feature/BDP-361-deploy-tab-redesign        #342  https://github.com/ByteDeskAI/bytedesk-platform/pull/342
  OPEN      BDP-364   feature/BDP-364-react-arborist-postmerge   #346  https://github.com/ByteDeskAI/bytedesk-platform/pull/346
  CLOSED    BDP-380   feature/BDP-380-experimental-thing         #348  https://github.com/ByteDeskAI/bytedesk-platform/pull/348
  NO_PR     BDP-401   feature/BDP-401-deploy-tab-grid            -     -

Eligible for cleanup: 3 (BDP-360, BDP-361, BDP-380)
```

Confirmation:
```
Kill and cleanup these 3 sessions? [y/N] _
```

After cleanup:
```
✓ Cleanup complete:
  BDP-360 ✓ killed, workspace removed, branch deleted
  BDP-361 ✓ killed, workspace removed, branch deleted
  BDP-380 ✓ killed, workspace removed, branch deleted

Remaining sessions: BDP-364 (open PR), BDP-401 (no PR yet).
```

## Constraints

- One confirmation for the whole batch, not per session.
- Never proceed silently — even with `--dry-run` removed, always show the table first.
- If `gh pr list` fails (auth, network), report the error and skip cleanup; do NOT assume "no PR" means "safe to kill".
- If `claude-sessions kill` fails for one session (e.g. uncommitted changes in the workspace), continue with the others and report the failure.

## Examples

```
/fleet:cleanup
/fleet:cleanup --dry-run
```
