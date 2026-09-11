---
id: "TM-169"
kind: "task"
status: "done"
created: "2026-09-10T22:10:59.046Z"
board: "bytedeskai/bytedesk-marketplace"
title: "agent-orchestration: doctor reports a repo as trusted on an ancestor's trust, but Claude asks anyway"
epic: "EP-018"
acceptance: [{"text":"The check's answer matches Claude Code's actual behaviour on both cases above: repo-entry-accepted passes, distant-ancestor-only reports CLAUDE_FOLDER_UNTRUSTED.","done":true,"at":"2026-09-10T22:34:20.683Z"},{"text":"The boundary is established empirically — how far down trust is inherited, and from which ancestor — rather than reasoned from the config shape. The A/B in this task is the starting point, not the answer.","done":true,"at":"2026-09-10T22:34:20.853Z"},{"text":"A regression test covers the distant-ancestor case, since that is the one that reports a false negative and the one no existing test caught.","done":true,"at":"2026-09-10T22:34:21.003Z"}]
evidence: [".bytedesk/task-management/evidence/TM-169-TRUST.md"]
commits: []
blockedBy: []
blocks: []
actor: "main"
session: "e01dd923-50ea-45d8-9911-b9d5faed94bd"
branch: "main"
worktree: "/home/ryan/Documents/GitHub/ByteDeskAI/bytedesk-marketplace"
updated: "2026-09-10T22:34:21.394Z"
evidenceSources: {".bytedesk/task-management/evidence/TM-169-TRUST.md":{"source":"/tmp/claude-1000/TM-169-TRUST.md","sha256":"d8c120867d7b8590d900cc1f72e70b8cd8452e5caaebd7fbf40fafa3c4b40979","bytes":2895,"at":"2026-09-10T22:34:21.182Z"}}
closed: "2026-09-10T22:34:21.389Z"
---

Found by running the EP-018 demo. doctor reported NO problems for bytedesk-acp-runtime — specifically not CLAUDE_FOLDER_UNTRUSTED — and the first agent then stopped at the folder-trust modal, which is the exact failure that check exists to predict.

The trust state in ~/.claude.json, read directly:

  /home/ryan/Documents/GitHub/ByteDeskAI          hasTrustDialogAccepted: true
  .../bytedesk-acp-runtime                        no entry at all
  .../bytedesk-acp-runtime/.bytedesk/.../agents/<id>   no entry at all

doctor walks ancestors, found the accepted grandparent, and concluded trusted. Claude Code asked anyway.

A/B, both live, same demo, same machine:
  acp-runtime   (no repo entry, grandparent accepted)  -> trust modal appeared, doctor said fine
  tmux-manager  (repo entry accepted: true)            -> NO trust modal, agent started

So repo-level trust IS inherited by the agent subdirectory four levels down; a distant ancestor's is not. The ancestor walk is too permissive somewhere between those two cases, and the check silently returns the wrong answer in the direction that matters — it promises a demo will run and it does not.

Note the history: TM-155's original scope was corrected because trust IS inherited by subdirectories, and my own doctor check then reproduced the opposite error with an exact-path lookup, which I fixed by walking ancestors. This is the third position on the same question, and the first one with an A/B behind it rather than an argument.