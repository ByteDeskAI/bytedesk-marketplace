---
id: "TM-156"
kind: "task"
status: "done"
created: "2026-09-10T02:23:47.644Z"
board: "bytedeskai/bytedesk-marketplace"
title: "task-management: tm edit takes the title positionally, so --title is written into the field"
acceptance: [{"text":"tm task edit <id> --title \"X\" sets the title to X","done":true,"at":"2026-09-10T03:25:20.451Z"},{"text":"A malformed edit invocation fails loudly rather than writing a flag name into a field","done":true,"at":"2026-09-10T03:25:20.594Z"},{"text":"A test covers the retitle path, since both agents who hit this assumed the verb worked","done":true,"at":"2026-09-10T03:25:20.732Z"}]
evidence: [".bytedesk/task-management/evidence/TM-156-HANDOFF.md"]
commits: ["ed3fc5d","87bbb04","3c15cb7","d386660"]
blockedBy: []
blocks: []
actor: "main"
session: "e01dd923-50ea-45d8-9911-b9d5faed94bd"
branch: "main"
worktree: "/home/ryan/Documents/GitHub/ByteDeskAI/bytedesk-marketplace"
updated: "2026-09-10T03:25:32.471Z"
type: "bug"
labels: ["plugin:task-management"]
evidenceSources: {".bytedesk/task-management/evidence/TM-156-HANDOFF.md":{"source":"/home/ryan/Documents/GitHub/ByteDeskAI/bytedesk-marketplace/.bytedesk/worktrees/TM-156-title/.bytedesk/task-management/evidence/TM-156-HANDOFF.md","sha256":"750f618b54dad439211f9f91c7e206678165ddba5ceb53090bda932d585048a2","bytes":3259,"at":"2026-09-10T03:22:43.927Z"}}
comments: [{"author":"main","ts":"2026-09-10T03:25:20.300Z","text":"MERGED and VERIFIED LIVE on the merged binary, not only by tests.\n\n  tm edit TM-156 --bogus \"x\"   ->  \"unknown option --bogus\" + usage. Refused.\n  tm edit TM-156 --title \"...\" ->  title updated, and the file now carries the real title.\n\nThis tasks own title was the last casualty and is now correct. It had been repaired by hand once already; this is the first time the verb itself set it.\n\nROOT CAUSE, from the author: the title is POSITIONAL, so `--title` landed in rest[0] and became the title while the value was discarded. What made it survive so long is that it PRINTED SUCCESS — \"title updated (was <old title>)\" names the OLD title, so the output looks like confirmation whichever way you read it. Both agents on this epic read it that way.\n\nTHE GENERALISABLE PART, and it is the reason this is worth more than one verb: `epic new` already carried a stray-flag guard, added after an epic was created with `--body` baked into its name, with a comment recording why. The guard never propagated to `edit`. A guard that exists in one verb and not its sibling is worse than no guard at all, because the CLI is then inconsistent and the inconsistent half looks like it worked. Six new assertions cover it, all six red against unmodified main, including \"a refused edit changes nothing\".\n\nGates on the merged tree: unit 1366/1366; store 140 (up from 134), hooks 65, hooks2 37, link 13, mcp 77, read 59 — all exit 0.\n\nTHE AUTHOR ALSO RETRACTED ITS OWN EARLIER CLAIM, unprompted, and this session had already repeated it. It told me `tm block` corrupts titles too, which narrowed the search toward shared argument parsing. Reading the verb disproved it: block writes status and blockedReason and touches nothing else. What corrupted the title after a block was an `edit --title` call minutes earlier. It attributed the damage to the last command it ran rather than the last command that COULD have done it — a distinction worth keeping, because I accepted the inference and passed it on without checking either."}]
closed: "2026-09-10T03:25:20.872Z"
---

`tm task edit <id> --title "Some new title"` does not retitle. It records the title as the literal string `--title`, discarding the value.

Observed twice in one session. TM-155 was left with `title: "--title"` in its frontmatter and displayed that way on the board until an integrator repaired it by hand. The same call on TM-152 silently did nothing, so the task kept a title that its own evidence had disproved until the frontmatter was edited directly.

The damage is quiet: the board still lists the task, the id still resolves, and nothing errors. A reader scanning `tm board` sees a task called `--title` or a stale title, and neither looks like a bug in the tool.

Both agents worked around it by editing the task markdown by hand. That is the wrong repair — hand-editing store files bypasses whatever validation and event logging the verb would have done — and it will keep happening while the documented path is broken.