---
name: bytedesk-worktree-operator
description: >-
  ByteDesk worktree lifecycle operator. Use whenever the user asks for worktree
  status, worktree cleanup, test worktree, reset localdev, switch to
  develop-remote, sync develop runtime, verify a worktree, ship worktree code,
  or commit push PR merge in bytedesk-platform. Delegates fragile Git, Helm,
  GitHub, and localDev steps to scripts/dev/workflow.mjs instead of rebuilding
  command chains manually.
user-invokable: true
argument-hint: "status | diagnose | new | sync-develop-runtime | ensure-develop-remote | use-localdev | reset-localdev | localdev-lock | prepare-web | verify | ship | land | landed | apply-merged-manifests | apply-helm | verify-pod | health-check | doctor | drift-remediate | cleanup | reap-merged"
allowed-tools:
  - Bash
  - Read
  - Grep
---

## Mission

Make ByteDesk worktree development feel effortless and repeatable. Prefer the deterministic workflow runner over hand-built command chains.

## First Command

From anywhere inside `bytedesk-platform`, start with:

```bash
scripts/dev/workflow.mjs status
```

If the current directory is a worktree and the relative script path is missing, resolve the canonical root:

```bash
canonical="$(dirname "$(git rev-parse --path-format=absolute --git-common-dir)")"
"$canonical/scripts/dev/workflow.mjs" status
```

## Command Map

Use `scripts/dev/workflow.mjs` for these user intents:

| User intent | Command |
|---|---|
| "status", "where are we?", "what worktrees need action?" | `scripts/dev/workflow.mjs status` |
| "diagnose", "why is the gateway serving old code?", "which worktrees are stale/dirty?" | `scripts/dev/workflow.mjs diagnose` |
| "new worktree", "start a worktree for BDP-N" | `scripts/dev/workflow.mjs new BDP-N-short-slug [base-ref]` (refuses on a dirty canonical; `--allow-dirty` overrides, `--restore` for .NET) |
| "merge/land this branch", "land these branches" | `scripts/dev/workflow.mjs land feature/BDP-N-x [feature/...]` (fast-forwards canonical `develop`, advances `develop-remote`, rolls source-mounted pods, and auto-cleans clean merged worktrees; Omnigent rebuilds the `ap-web` static SPA before rolling; `--no-roll` skips roll, `--services a,b` overrides, `--no-cleanup` keeps worktrees) |
| "is this landed?", "did you land it?", "landed status" | `scripts/dev/workflow.mjs landed [<branch>]` — reports PR state + commits ahead of `origin/develop` + develop-remote mirror sync, then a one-line verdict + next command (BDP-2112). Read-only; `--json` for machine output |
| "ship and land", "ship and land it" | `scripts/dev/workflow.mjs ship --message "BDP-N: summary" --land` — push+PR then the FULL land pipeline for this branch (merge → sync canonical → apply manifests → advance mirror + roll pods → cleanup), the ritual in one verb (BDP-2112). If the branch touched arch partitions, confirm `architecture-sync --mode audit` passed before ship. |
| "switch/sync to develop-remote" | `scripts/dev/workflow.mjs sync-develop-runtime --roll web` (Omnigent also refreshes the static `ap-web` bundle for develop-remote and the active source mount) |
| "test worktree" | `scripts/dev/workflow.mjs use-localdev --services web` from the active worktree; this acquires the shared localDev lease, and Omnigent builds that checkout's static `ap-web` bundle before remapping |
| "reset localdev" | `scripts/dev/workflow.mjs reset-localdev --services web` from the owning worktree/terminal; this remaps to develop-remote, releases the lease, and Omnigent builds develop-remote's static `ap-web` bundle before remapping |
| "who owns localdev?", "localdev lock" | `scripts/dev/workflow.mjs localdev-lock status` |
| "prepare web", "install node_modules for this worktree" | `scripts/dev/workflow.mjs prepare-web` (Platform Web only; hardlink-clone from canonical when lockfile matches, else npm ci; verify auto-runs it for web work. Omnigent `ap-web/node_modules` is managed during localDev/sync/land.) |
| "verify this" | `scripts/dev/workflow.mjs verify` |
| "commit push pr merge", "ship this" | `scripts/dev/workflow.mjs ship --message "BDP-N: summary" --merge --reset-localdev` (also syncs canonical `develop` and auto-cleans the merged worktree) |
| "tear down / remove this worktree" | `scripts/dev/workflow.mjs cleanup BDP-N-short-slug [--force]` |
| "cleanup worktrees" (sweep report) | `scripts/dev/workflow.mjs cleanup --dry-run` |
| "clean up merged worktrees", "reap merged worktrees" | `scripts/dev/workflow.mjs reap-merged` — tears down ALL merged-equivalent + clean + not-localDev-mounted worktrees in one shot (`--dry-run` to preview). BDP-2113 |
| "which worktrees can go?", "landed-state audit" | `scripts/dev/workflow.mjs reap-merged --dry-run` (lists candidates + why each is skipped) |
| "develop-remote drift / dirty mirror / recover localDev" | `scripts/dev/workflow.mjs ensure-develop-remote` |
| "apply failed during land / re-apply manifests" | `scripts/dev/workflow.mjs apply-merged-manifests [<ref>]` |
| "apply helm / install bytedesk chart locally" | `scripts/dev/workflow.mjs apply-helm [--target path] [--dry-run]` |
| "verify pod / did my change build & start", "check service logs after a change" | `scripts/dev/workflow.mjs verify-pod <service> [--watch]` |
| "cluster looks weird / health check / find degraded pods" | `scripts/dev/workflow.mjs health-check [--since 15m]` |
| "drift report / remediate drift / resync manifests" | `scripts/dev/workflow.mjs drift-remediate [--apply]` |

## Decision tree

`status` prints `Suggested next: <cmd>` — usually just run it. When in doubt:

| Symptom | Run |
|---|---|
| `develop-remote: missing` | `workflow.mjs sync-develop-runtime` (or `ensure-develop-remote`) |
| `develop-remote: ... [dirty-restorable]` | `workflow.mjs ensure-develop-remote` (auto-restores tracked roots) |
| `develop-remote: ... [dirty-novel]` | `workflow.mjs ensure-develop-remote` (stashes novel work with a label) |
| `develop-remote: ... [behind]` | `workflow.mjs sync-develop-runtime --roll web` |
| canonical `develop: ... [behind]` after a merge | Usually no manual action: `land` / `ship --merge` auto-fast-forward it. If status still warns, run `git pull --ff-only` in canonical only after confirming no dirty conflict. |
| `localDev is locked by ...` | wait with the same verb plus `--wait 600`, or inspect with `workflow.mjs localdev-lock status`; do not force unless the owner is gone |
| `no open PR for <branch>` from `land` pre-flight | `workflow.mjs ship --message "BDP-N: ..."` first |
| Worktree dirty + no message | `workflow.mjs ship --message "BDP-N: summary"` |
| Currently on canonical `develop`/`main` | `workflow.mjs new BDP-N-slug` |
| `land: ERROR: apply failed` | fix the manifest, then `workflow.mjs apply-merged-manifests` |
| After a code change → does it build & start? | `workflow.mjs verify-pod <service>` (avoids host build OOMs) |
| Cluster looks degraded / breaker storms / OOM | `workflow.mjs health-check` |
| SessionStart drift hook flagged resources | `workflow.mjs drift-remediate` (dry-run first; `--apply` for safe actions) |
| First-time chart install in a worktree | `workflow.mjs apply-helm` |

Read [references/commands.md](references/commands.md) only when you need command details or fallback behavior.

## Merged Worktree + localDev Proof Bundle

Use this whenever the user asks "is it landed?", "cleanup merged worktrees",
"land this and reset localdev", or any status request after merge-heavy work.
Do not infer from local branch names.

Collect:

```bash
scripts/dev/workflow.mjs status
scripts/dev/workflow.mjs cleanup --dry-run
git fetch origin develop --prune
git worktree list
```

For each candidate feature branch:

```bash
branch=feature/<name>
gh pr list --state all --head "${branch#feature/}" --json number,state,mergedAt,mergeCommit,url,title
merge_sha=<mergeCommit.oid from gh json>
git merge-base --is-ancestor "$merge_sha" origin/develop
```

Report each worktree as:

| Bucket | Evidence |
|---|---|
| `cleanup-safe` | PR is merged, merge commit is an ancestor of `origin/develop`, worktree has no uncommitted user work, and `localDev.repoRoot` is not pointing at it |
| `keep` | no merged PR, merge commit not on `origin/develop`, dirty worktree, or branch has commits not represented by the PR |
| `needs-human` | ambiguous PR mapping, multiple matching PRs, or unrelated local commits |

After cleanup, verify:

```bash
scripts/dev/workflow.mjs status
```

The final status must show canonical `develop` and `develop-remote` synced to
`origin/develop`, and `localDev.repoRoot` reset away from removed worktrees
before you call the job finished.

## Rules

- **NEVER call `git`, `gh`, `helm`, or `kubectl` directly for managed-worktree lifecycle steps.** The operator is the single authority — every banned direct call has a corresponding verb (see `.claude/rules/worktree-lifecycle.md`).
- For Omnigent localDev, remember that `omnigent.bytedesk.localhost` serves the checked-out static bundle under `omnigent/server/static/web-ui`, not Vite live; use the operator verbs so `ap-web/node_modules` and `npm run build` stay in sync with the mounted checkout.
- Do not commit or ship from the canonical checkout, `develop`, `main`, or detached `develop-remote`.
- Run `status` before destructive or publishing actions and follow the `Suggested next` line.
- The operator runs pre-flight checks before mutating state (`ship`, `land`, `use-localdev`, `reset-localdev`). When pre-flight prints `ERROR`, fix the root cause and re-run — do not bypass.
- Prefer `--dry-run` before cleanup, localDev remaps, or ship flows when the user is asking for diagnosis instead of execution.
- `use-localdev --help` is safe and prints the global help; never probe subcommand help by passing unknown positionals to a mutating verb.
- Treat localDev as a shared leased resource: `use-localdev` locks it for the active feature worktree, competing terminals should use `--wait 600` or `localdev-lock status`, and only the owning worktree should run `reset-localdev` to unlock. Use `--force-lock` only after confirming the owner is dead/stale.
- If the runner fails, report the failing command and fix the root cause; do not silently continue with manual approximations.
- After a merge, rely on `land` / `ship --merge` to fast-forward canonical `develop`, advance `develop-remote`, and auto-clean the landed worktree when safe. Use `reset-localdev` when runtime should point back at the managed `develop-remote` mirror.
