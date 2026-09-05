---
id: "TM-104"
kind: "task"
status: "done"
created: "2026-09-05T11:02:55.815Z"
board: "bytedeskai/bytedesk-marketplace"
title: "Design-system ci-validate fails on every branch, including main"
epic: "EP-013"
acceptance: [{"text":"The three staticDirs roots exist after staging on a clean checkout","done":true,"at":"2026-09-05T11:03:01.523Z"},{"text":"npm --prefix ui run build-storybook succeeds on a clean worktree of origin/main","done":true,"at":"2026-09-05T11:03:01.654Z"},{"text":"The fix is submitted upstream where the code lives","done":true,"at":"2026-09-05T11:03:01.819Z"}]
evidence: [".bytedesk/task-management/evidence/TM-104-1788606194698.log"]
commits: ["https://github.com/ByteDeskAI/design-system/pull/59","5276b81"]
blockedBy: []
blocks: []
actor: "main"
session: "4e1d7087-d606-432e-9341-3ce779b4baf8"
branch: "main"
worktree: "/home/ryan/Documents/GitHub/ByteDeskAI/bytedesk-marketplace"
updated: "2026-09-05T11:03:22.158Z"
type: "bug"
comments: [{"author":"main","ts":"2026-09-05T11:03:02.087Z","text":"Submitted as design-system#59. Not self-merged: that repo requires review. Verified by reproducing on a clean worktree of origin/main - before the fix, staging produced only packages and foundation and build-storybook failed with the exact CI error; after, all three roots exist and Storybook builds in 4.12s."}]
closed: "2026-09-05T11:03:14.830Z"
---

Discovered while landing the EP-013 profile amendment. ByteDeskAI/design-system ci-validate is red on every branch AND on main (builds 205-212), failing with 'Failed to load static files, no such directory: ui/.static/apps'. ui/.storybook/main.ts lists three staticDirs (apps, packages, foundation); Storybook resolves that list at startup and fails the build outright on a missing directory. ui/scripts/stage-static.mjs created each root only as a side effect of copying into it, via copyDir's mkdir, which it skips when the source is absent. What hid it: apps/*/brand and apps/*/mockups are NOT tracked in git (0 files each), so a developer checkout always has them and a clean CI checkout never does - .static/apps was created on every local run and no CI run, and the failure looked like it belonged to whichever branch was building. Fixed by creating all three roots unconditionally before copying: staticDirs is a contract with a consumer that reads it whether or not anything was staged. Blocks TM-084 AC1, since the profile amendment PR cannot go green until CI does.