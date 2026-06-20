---
name: bytedesk-integration-branch-operator
description: >-
  ByteDesk integration-branch operator for multi-agent fan-out/fan-in work where
  many feature branches are merged into one integration branch and conflict
  resolutions must be preserved. Use when parallel goal batches, agent waves,
  integration branches, resolved merge commits, or "do not rebase this batch"
  are involved. Uses a diagnosed break-glass merge-commit PR path instead of
  workflow.mjs ship/land when rebasing would replay conflicts.
user-invokable: true
argument-hint: "plan | integrate <branch> <feature...> | proof <pr-or-branch>"
allowed-tools:
  - Bash
  - Read
  - Grep
---

## Mission

Preserve integration-branch conflict resolutions. This is the narrow exception
to the normal managed `ship`/`land` path: when an integration branch already
contains merge commits that resolved conflicts, rebasing it onto `origin/develop`
can replay every original feature conflict and discard the work you already did.

Use this skill only for fan-out/fan-in batches. Single feature branches still use
`scripts/dev/workflow.mjs ship --merge --reset-localdev`.

## First Checks

```bash
integration-branch-plan --status
scripts/dev/workflow.mjs status
git status --short --branch
git log --oneline --graph --decorate --max-count=30
```

Confirm:

- current branch is an integration branch, not canonical `develop`
- feature branches have already been merged into it with merge commits
- the tree is clean after conflict resolution
- no background agent is still writing to child worktrees
- the integration gate has run on the combined tree

## Correct Landing Path

When the branch is a real integration branch with merge-commit resolutions:

1. Push the integration branch exactly as-is:
   ```bash
   git push -u origin <integration-branch>
   ```
2. Open a PR to `develop`.
3. Merge that PR with a merge commit, not rebase/squash.
4. Run post-merge hygiene that `workflow.mjs land` would normally do:
   ```bash
   scripts/dev/workflow.mjs sync-develop-runtime
   scripts/dev/workflow.mjs reset-localdev --services web
   scripts/dev/workflow.mjs cleanup <child-worktree>
   scripts/dev/workflow.mjs cleanup <integration-worktree>
   ```

This is a documented break-glass path. State why the operator `ship/land` path
is unsafe before using it.

## Do Not

- Do not run `workflow.mjs ship`, `workflow.mjs land`, or `git rebase` on an
  integration branch that contains conflict-resolution merge commits.
- Do not squash the integration PR when the merge commits are the evidence of
  conflict resolution.
- Do not clean child worktrees until the integration PR is merged and
  `origin/develop` contains the integration merge commit.
- Do not let subagents edit the canonical checkout. Every child branch needs a
  named worktree and a final clean/dirty report.

## Report Format

```markdown
Integration branch status: PASS/FAIL
Branch: <name>
Base: <origin/develop sha>
Included branches: <feature branches>
Gate: <command + result>
PR/merge: <PR url, merge sha, ancestry proof>
Post-merge hygiene: <develop-remote/localDev/cleanup status>
```
