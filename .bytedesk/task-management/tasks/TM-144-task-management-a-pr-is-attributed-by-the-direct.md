---
id: "TM-144"
kind: "task"
status: "done"
created: "2026-09-10T01:11:57.596Z"
board: "bytedeskai/bytedesk-marketplace"
title: "task-management: a PR is attributed by the directory tm resolved, not the repo it landed in"
acceptance: [{"text":"A PR opened against another repo is refused even when the cwd says this board","done":true,"at":"2026-09-10T01:13:26.067Z"},{"text":"A gh pr create that printed no URL attaches nothing, not the literal \"pr\"","done":true,"at":"2026-09-10T01:13:26.174Z"},{"text":"A PR in this board's own repo still links, and the git_link_skipped event records the ref it refused","done":true,"at":"2026-09-10T01:13:26.308Z"}]
evidence: [".bytedesk/task-management/evidence/TM-144-PR-ATTRIBUTION-VERIFICATION.md"]
commits: ["8beb169","114f4ad","a05c993","eac8ae7"]
blockedBy: []
blocks: []
actor: "main"
session: "2ee26155-9e57-4cf8-8bc4-a8379f88e5a4"
branch: "main"
worktree: "/home/ryan/Documents/GitHub/ByteDeskAI/bytedesk-marketplace"
updated: "2026-09-10T01:21:31.997Z"
labels: ["plugin:task-management"]
type: "bug"
evidenceSources: {".bytedesk/task-management/evidence/TM-144-PR-ATTRIBUTION-VERIFICATION.md":{"source":"/tmp/claude-1000/-home-ryan-Documents-GitHub-ByteDeskAI-bytedesk-marketplace/2ee26155-9e57-4cf8-8bc4-a8379f88e5a4/scratchpad/PR-ATTRIBUTION-VERIFICATION.md","sha256":"976315787f2137e17e61282d963794bcbed68d237b4bb7151ad8a21d97f726e0","bytes":1884,"at":"2026-09-10T01:13:44.525Z"}}
closed: "2026-09-10T01:13:47.060Z"
---

`linkGit` compared `boardId(CHECKOUT)` — the store's own project dir — against the board, so a `gh pr create` that retargeted another repo without moving the process (`--repo`, `git -C`, a leading `cd`) still read as "same board" and the link went through. This is the hole left by TM-036: the scope check asked the cwd, and the cwd is not where the PR landed.

Observed: bytedesk-remote-gateway's TM-063 collected bytedesk-passport's PR #17. The collision is invisible from the store, because both number tasks TM-nnn — the PR body named passport's TM-063 and the gateway had a TM-063 of its own, closed days earlier under a different epic.

Second defect on the same path: a `gh pr create` that printed no URL fell back to the literal string "pr" as the ref. It deduped against itself and pinned nothing. Stores that ran the old hook still hold these; they are safe to delete by hand.

Fix: ask the ref, not the cwd. A pull-request URL names its own repo and cannot lie about where the PR landed; commits fall back to the command's own `git -C` / `cd` target. A PR with no URL attributes nothing.