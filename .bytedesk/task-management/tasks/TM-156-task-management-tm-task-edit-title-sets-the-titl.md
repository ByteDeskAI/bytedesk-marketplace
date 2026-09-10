---
id: "TM-156"
kind: "task"
status: "open"
created: "2026-09-10T02:23:47.644Z"
board: "bytedeskai/bytedesk-marketplace"
title: "task-management: tm task edit --title sets the title to the literal string --title"
acceptance: [{"text":"tm task edit <id> --title \"X\" sets the title to X","done":false},{"text":"A malformed edit invocation fails loudly rather than writing a flag name into a field","done":false},{"text":"A test covers the retitle path, since both agents who hit this assumed the verb worked","done":false}]
evidence: []
commits: []
blockedBy: []
blocks: []
actor: "main"
session: "2ee26155-9e57-4cf8-8bc4-a8379f88e5a4"
branch: "main"
worktree: "/home/ryan/Documents/GitHub/ByteDeskAI/bytedesk-marketplace"
updated: "2026-09-10T02:23:48.062Z"
type: "bug"
labels: ["plugin:task-management"]
---

`tm task edit <id> --title "Some new title"` does not retitle. It records the title as the literal string `--title`, discarding the value.

Observed twice in one session. TM-155 was left with `title: "--title"` in its frontmatter and displayed that way on the board until an integrator repaired it by hand. The same call on TM-152 silently did nothing, so the task kept a title that its own evidence had disproved until the frontmatter was edited directly.

The damage is quiet: the board still lists the task, the id still resolves, and nothing errors. A reader scanning `tm board` sees a task called `--title` or a stale title, and neither looks like a bug in the tool.

Both agents worked around it by editing the task markdown by hand. That is the wrong repair — hand-editing store files bypasses whatever validation and event logging the verb would have done — and it will keep happening while the documented path is broken.