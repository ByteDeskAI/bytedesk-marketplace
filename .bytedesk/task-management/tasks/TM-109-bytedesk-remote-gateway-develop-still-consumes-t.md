---
id: "TM-109"
kind: "task"
status: "open"
created: "2026-09-05T14:52:29.327Z"
board: "bytedeskai/bytedesk-marketplace"
title: "bytedesk-remote-gateway: develop still consumes the design system as a git submodule, so every PR into it is red"
epic: "EP-015"
acceptance: [{"text":"The spa check passes on a pull request into develop","done":false},{"text":"develop carries .context/design-system as committed files, with no .gitmodules and no submodule gitlink","done":false}]
evidence: []
commits: ["f2545cb"]
blockedBy: []
blocks: []
actor: "main"
session: "4e1d7087-d606-432e-9341-3ce779b4baf8"
branch: "main"
worktree: "/home/ryan/Documents/GitHub/ByteDeskAI/bytedesk-marketplace"
updated: "2026-09-05T14:52:52.783Z"
labels: ["blocked"]
priority: "medium"
---

The 'spa' check fails on every pull request into bytedesk-remote-gateway's develop branch, and it is the base branch's fault rather than any PR's.

develop carries a .gitmodules declaring .context/design-system as a submodule of the PRIVATE repo ByteDeskAI/design-system. The Actions runner's token cannot clone it, so checkout aborts:

  remote: Repository not found.
  fatal: clone of 'https://github.com/ByteDeskAI/design-system' into submodule path '.context/design-system' failed
  Failed to clone '.context/design-system' a second time, aborting

main is already correct: .context/design-system there is VENDORED as ordinary committed files (catalog.json, lock.json, apps/, foundation/, client/) with no .gitmodules at all. develop has simply not caught up. The submodule was introduced by cb336626 on 2026-08-13, 'feat(design-system): consume tokens from submodule; UI as a swappable plugin'.

This is the arrangement the shared rules exist to prevent: the design system is delivered as packages and a CDN catalog and vendored into .context/design-system by 'npx @bytedesk/design-client sync', with the result committed so a build reads plain files with no plugin, no network and no credentials. A submodule of a private repo is exactly the build-time credential dependency that design avoids.

Evidence: PR #124 (EP-014 / TM-097) touches only Go sources, the changelog and the openapi spec, yet its spa job fails this way. Bringing the branch up to date with its base did not help, because the base is where the submodule lives. Its other three checks -- test, playwright, validate-capabilities -- all pass.

Fix direction: take main's vendored .context/design-system onto develop and delete .gitmodules plus the gitlink. NOT done from here: that repo has other live sessions with a dirty working tree, and rewriting a shared branch's build architecture underneath them is not a change to make blind.