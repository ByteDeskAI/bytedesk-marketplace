# TM-510 evidence
- PR #246 merged as 77c05462 (AI review: 2 medium + 1 low finding, all fixed in the PR).
- tests/test-pull-marketplace.sh 9/9; mutation check: removing the branch, worktree, throttle or Codex-trust line each fails the test. test-plugin-rsync.sh 33/33. shellcheck clean.
- End-to-end hook from an unrelated dir with temp HOME: directory-source checkout fast-forwarded and post-merge fired; GitHub-source installLocation left untouched; hook returns at once.
- Live on this machine: main checkout 4678c5d5 (behind 25) -> 77c05462. First attempt refused (stale uncommitted dashboard dist would be overwritten; git aborted, nothing lost). Stale dist stashed (stash@{0}), rerun ff'd; post-merge synced agent-orchestration, plugin-rsync, task-management into Claude, Codex and Grok caches.
