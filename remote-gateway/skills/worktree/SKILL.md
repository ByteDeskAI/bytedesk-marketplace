---
name: worktree
description: >
  Environment-capable git worktree isolation for ByteDesk gateway. Use when
  creating, claiming, or pruning worktrees; launching a parallel agent tab;
  or when terminals share one dirty tree. Delegates to native Grok/Claude
  --worktree; Codex/Kimi/shell get a unique git cwd.
---

# /worktree — isolate one terminal, use the environment’s native API

**Default product launch does not isolate.** Grok/Claude/Codex/Kimi start in
the project CWD unless Isolate is checked, “+ isolated tab” is used, or count
> 1. Creating a tree must not retarget the project desk or other tabs.

## Detect the environment first

| Environment | How you know | Isolation |
|-------------|--------------|-----------|
| **Grok** | `grok` CLI, Grok TUI, `isolation: worktree` | Native. `grok --worktree=<name>` or spawn `isolation: "worktree"`. Trees live under `~/.grok/worktrees/`. List: `grok worktree list --json`. GC: `grok worktree gc --max-age 7d`. |
| **Claude Code** | `claude` CLI | Native. `claude --worktree [name]` (`-w`). Unique name per tab. Community `using-git-worktrees` is **not** SoT here — it reuses `.worktrees/<BRANCH>` and shares trees. |
| **Codex** | `codex` CLI | No `--worktree`. Tightest API is `--cd`: create a unique git worktree, then `codex --cd <path>` (gateway does this automatically). |
| **Kimi** | `kimi` CLI | No `--worktree` / `--cd`. Unique git cwd is the workspace; optional `--add-dir` for extra trees. |
| **Pi / shell** | `pi` / Ghostty | Unique git cwd. |

Name every isolated tree `iso-<slug>-<id>` or `feat/<ticket>-<tab8>` — never a
bare branch name if that branch is already checked out.

## Agent (this repo) standing rules

1. Do **not** auto-isolate Grok/Claude product launches. Use native
   `--worktree` only when the operator asked to isolate.
2. Write-capable **Grok/Claude** isolation (when requested): unique
   `--worktree` name per tab. Community `using-git-worktrees` is not SoT.
3. **Codex / Kimi / terminal** (when isolating): run
   `scripts/lib/worktree-bootstrap.sh` after `git worktree add` to
   `<main>/.worktrees/<slug>-<id>`.
4. Do **not** call `setActiveWorktree` / switch the Projects desk as a side
   effect of creating a tree.
5. Cutover uses the **acting** git toplevel. If
   `BYTEDESK_EMOTE_GATEWAY_SOURCE_DIR` points at another checkout, deploy-safe
   prefers this tree. Do not export SOURCE_DIR to a sibling worktree.
6. Factory scripts (`mk-worktrees.sh`) are **one tree per goal**, not per
   terminal. If a goal tree is busy, mint `<id>-<n>` — do not reuse.

## Commands

```bash
# Status: trees × dirty × this cwd
git worktree list
git rev-parse --show-toplevel
git status -sb

# Grok native
grok --worktree=iso-feat-x
grok worktree list --json

# Claude native
claude --worktree iso-feat-x

# Fallback (codex/kimi/shell) from repo root
slug=iso-feat-x
dest="$(git rev-parse --show-toplevel)/.worktrees/${slug}-$(openssl rand -hex 3)"
git worktree add -b "$slug" "$dest" || git worktree add -b "${slug}-x" "$dest"
bash scripts/lib/worktree-bootstrap.sh "$dest"
cd "$dest"
```

## After /commit (merge + cleanup)

`/commit` detects a linked worktree (`setup/skills/commit/scripts/worktree-after-commit.sh detect`).
After a successful commit it **offers** to merge this branch into the main
checkout’s branch and remove the tree. Authorize in the same turn with
“commit and merge” / “land and cleanup”, or confirm after the offer.

```bash
# From the isolation tree, after commit is clean
setup/skills/commit/scripts/worktree-after-commit.sh detect
setup/skills/commit/scripts/worktree-after-commit.sh land   # merge + remove
```

Grok-native trees (`~/.grok/worktrees/…`) also run `grok worktree rm` on cleanup.

## Do not

- Reuse `.worktrees/<BRANCH>` from the community `using-git-worktrees` skill
  when another terminal is already there.
- `git checkout develop` on main when another worktree holds it — open that
  tree or create a new one from `origin/develop`.
- Auto-switch the Projects desk ActiveWorktree after create.

## Install

Canonical path: `setup/skills/worktree/`. Link with `./scripts/install-agent-skills.sh`.
