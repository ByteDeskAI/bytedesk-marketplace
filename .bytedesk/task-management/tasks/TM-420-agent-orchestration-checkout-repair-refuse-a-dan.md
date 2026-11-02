---
id: "TM-420"
kind: "task"
status: "open"
created: "2026-10-05T14:32:42.144Z"
board: "bytedeskai/bytedesk-marketplace"
title: "agent-orchestration checkout repair: refuse a dangling gitdir under an unmounted mount point, and correct the pathState comment"
epic: "EP-028"
acceptance: [{"text":"A gitdir whose nearest existing ancestor is a mount point (or under /mnt, /media, /run/media, /Volumes) is refused as unreadable, with a test","done":false},{"text":"The pathState comment states the real behaviour","done":false}]
evidence: []
commits: []
blockedBy: []
blocks: []
actor: "main"
session: "253de95a-5b3d-4702-b941-9b7ba0507f01"
branch: "main"
worktree: "/home/ryan/Documents/GitHub/ByteDeskAI/bytedesk-marketplace"
labels: ["ready-for-agent"]
triagedBy: "auto"
updated: "2026-10-05T14:32:42.151Z"
---

From the PR #198 (TM-394) round-2 review: pathState's doc comment claims an unmounted network path is never read as gone, but a gitdir under an empty mount point is ENOENT and still classifies dangling-gitdir (repro: $T/mnt/usb/repo.git/...). Impact is disconnection, not loss (the real repo stays on the drive, the old pointer is backed up, the tree is preserved). Fix the comment, and refuse when the nearest existing ancestor of the gitdir is a mount point or sits under /mnt, /media, /run/media or /Volumes.