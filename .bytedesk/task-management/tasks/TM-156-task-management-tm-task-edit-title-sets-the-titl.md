---
id: "TM-156"
kind: "task"
status: "blocked"
created: "2026-09-10T02:23:47.644Z"
board: "bytedeskai/bytedesk-marketplace"
title: "task-management: tm task edit --title sets the title to the literal string --title"
acceptance: [{"text":"tm task edit <id> --title \"X\" sets the title to X","done":true,"at":"2026-09-10T03:22:43.544Z"},{"text":"A malformed edit invocation fails loudly rather than writing a flag name into a field","done":true,"at":"2026-09-10T03:22:43.686Z"},{"text":"A test covers the retitle path, since both agents who hit this assumed the verb worked","done":true,"at":"2026-09-10T03:22:43.812Z"}]
evidence: [".bytedesk/task-management/evidence/TM-156-HANDOFF.md"]
commits: ["caba55b"]
blockedBy: []
blocks: []
actor: "main"
session: "e01dd923-50ea-45d8-9911-b9d5faed94bd"
branch: "main"
worktree: "/home/ryan/Documents/GitHub/ByteDeskAI/bytedesk-marketplace"
updated: "2026-09-10T03:22:44.090Z"
type: "bug"
labels: ["plugin:task-management"]
evidenceSources: {".bytedesk/task-management/evidence/TM-156-HANDOFF.md":{"source":"/home/ryan/Documents/GitHub/ByteDeskAI/bytedesk-marketplace/.bytedesk/worktrees/TM-156-title/.bytedesk/task-management/evidence/TM-156-HANDOFF.md","sha256":"750f618b54dad439211f9f91c7e206678165ddba5ceb53090bda932d585048a2","bytes":3259,"at":"2026-09-10T03:22:43.927Z"}}
blockedReason: "Code complete and gated; blocked on the integrator's merge only. Branch tm/TM-156-title-flag, STACKED on tm/TM-154-git-link-message because both touch bin/tm — take TM-154 first. Code commit ed3fc5d. Cause: edit(id, ...rest) takes the title positionally, so --title landed in rest[0] and the value was discarded, while the command printed 'title updated (was <old title>)' which reads like success. Fix: --title <value> accepted alongside the positional form, --title with no value refused, and an unrecognised --flag now dies rather than being written into a field — the guard epic new already had after EP-017 was created with --body baked into its name. Six new assertions, all six red against unmodified main. Gates: 1364/1364 unit, store 140/140, every bash suite clean except test-pool.sh which is TM-153. NOTE: tm block does NOT corrupt titles; I inferred that and passed it on, and it is wrong — block writes status and blockedReason only."
---

`tm task edit <id> --title "Some new title"` does not retitle. It records the title as the literal string `--title`, discarding the value.

Observed twice in one session. TM-155 was left with `title: "--title"` in its frontmatter and displayed that way on the board until an integrator repaired it by hand. The same call on TM-152 silently did nothing, so the task kept a title that its own evidence had disproved until the frontmatter was edited directly.

The damage is quiet: the board still lists the task, the id still resolves, and nothing errors. A reader scanning `tm board` sees a task called `--title` or a stale title, and neither looks like a bug in the tool.

Both agents worked around it by editing the task markdown by hand. That is the wrong repair — hand-editing store files bypasses whatever validation and event logging the verb would have done — and it will keep happening while the documented path is broken.