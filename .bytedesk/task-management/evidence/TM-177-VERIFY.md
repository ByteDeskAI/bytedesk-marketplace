# TM-177 verification: the guard on unattended dispatch workers

**Result:** all five acceptance criteria are met. The guard also covers the lead's three review changes.

- **Commits:** `8aad117` (the guard) and `1b29278` (no status line, no Codex entry, a stash rule), on branch `worktree-agent-a53ed7612b6aa5a9e`, based on `cd1b1ac`.
- **Merge:** into `main`, after the lead tested the merged result on top of `fc25845`, which already held TM-174 and TM-175.

## What was measured

The lead ran every command below.

| Tree | Command | Exit | Result |
|---|---|---|---|
| worker worktree `8aad117`, clean | `node --test --test-concurrency=1 task-management/tests/unit/*.test.mjs` | 0 | 1389 / 1389 |
| same | `bash task-management/tests/test-hooks.sh` | 0 | 65 passed |
| same | `bash task-management/tests/test-hooks2.sh` | 0 | 40 passed |
| trial merge `4dc5f2e` = `fc25845` + `1b29278`, scratch worktree, clean | `node --test --test-concurrency=1 task-management/tests/unit/*.test.mjs` | 0 | 1414 / 1414 |
| same | `bash task-management/tests/test-hooks.sh` | 0 | 65 passed |
| same | `bash task-management/tests/test-hooks2.sh` | 0 | 40 passed |
| same | `bash task-management/tests/test-pool.sh` | 0 | 26 passed |

- The trial merge is the combined code on `main`, not the branch on its own. The merge into `main` was checked to have the same tree as the trial.

## Red before green (worker's run)

- **Before the implementation:** the new tests had 5 failing cases out of 52, including `ERR_MODULE_NOT_FOUND` for `lib/worker-guard.mjs` and failures in the tmux and topology backend suites.
- **Stash rule:** before its row existed, the table check failed, and the real `tm-hook.sh` exited 0 for `git stash drop`.

## Acceptance criteria

1. **Worker commands that are blocked:** the worker env exits 2 with a reason for every blocked form.
   - Blocked forms: force push, pushes beyond the worker's own branch, branch or tag or ref deletion, `reset --hard`, history rewrites, rebasing `main`, `stash drop` / `clear` / `pop`, `gh pr merge`, `gh release`, `gh secret` and `gh variable`, `gh api` writes, deploy and secret tools, package publishing, and chat webhooks or mail.
   - The rules are one table of 28 rows with 81 blocked samples. One sample per row also runs through the real `tm-hook.sh`.
2. **Worker commands that are allowed:** in a worker env, pushing the worker's own branch, `gh pr create`, `git commit` and ordinary commands exit 0. These are checked against real temporary repos:
   - `git push -u origin <own>` exits 0.
   - `git push origin HEAD` exits 0 on the own branch and 2 when HEAD is `main`.
3. **Outside a worker:** `hooks/tm-hook.sh pre-bash` exits before Node starts. A fake `node` shim recorded `[]`, and the control run inside a worker recorded one call.
4. **Spawn settings:** tmux spawns set `TM_DISPATCH_WORKER`, `TM_DISPATCH_TASK` and `TM_DISPATCH_BRANCH` through `tmux -e`, and add `--settings <guard json>` when the command is `claude`. Topology puts the marker in the spec agent's env, and adds `--settings` only when every candidate in the chain is claude. Tests check the argv and env built with a stubbed spawn.
5. **Suites:** the unit suite and both hook suites exit 0.

## Review changes applied (`1b29278`)

- **Status line:** there is no `statusMessage` on the `Bash` PreToolUse entry. It runs on every Bash call for every plugin user.
- **Codex:** there is no `Bash` entry in `codex-hooks.example.json`. No backend spawns Codex workers, and Codex would start Node on every call.
- **Stash:** `git-stash-destroy` blocks `drop`, `clear` and `pop`, because the stash stack is shared across worktrees.

## Known limits (accepted)

- **Deliberate bypasses:** a command-string classifier stops accidents, not an adversary. A script written to disk, git aliases, `find -exec` and `git rebase --exec` all get through. The server-side upgrade is branch protection plus a token that cannot merge, deploy or delete.
- **Not blocked yet:** `gh workflow run`, `aws`, `gcloud` and `az`.
- **Idle backend:** tasks go to an agent tm did not launch, so that agent carries no marker and no guard.
- **`--settings` check:** support for inline JSON was confirmed from `claude --help` only. No real `claude` session was started.
- **Live check:** the direct-shell check was refused by worktree isolation. The same cases run in the unit suite against real temporary repos.
