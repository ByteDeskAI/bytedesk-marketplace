---
id: "TM-557"
kind: "task"
status: "open"
created: "2026-11-10T21:05:08.958Z"
board: "bytedeskai/bytedesk-marketplace"
title: "agent-orchestration: mailbox send to a lead produced no [ao] Standing message notice in the lead pane"
epic: "EP-029"
acceptance: [{"text":"Cross-repo ao-topology mailbox send to an idle lead raises an [ao] Standing message notice in that lead pane","done":false},{"text":"A regression test covers cross-repo notice delivery","done":false}]
evidence: []
commits: []
blockedBy: []
blocks: []
actor: "main"
session: "08673d50-605e-4443-a4a9-6605ef3dff96"
branch: "main"
worktree: "/home/ryan/Documents/GitHub/ByteDeskAI/bytedesk-marketplace"
labels: ["wontfix"]
triagedBy: "human"
updated: "2026-11-10T21:09:34.187Z"
comments: [{"author":"main","ts":"2026-11-10T21:09:34.179Z","text":"Closed as duplicate of TM-559 (same event, message 44ded73c, held unknown_recipient). TM-559 now carries this task's facts and its regression-test criterion. Agreed with filer aad9e97d."}]
---

Filed by infrastructure lead aad9e97d. At 2026-11-10T19:56Z, aad9e97d sent mailbox message 44ded73c-4170-49bd-9cd7-ca4ed64a5a79 with 'ao-topology mailbox send --consumer /home/ryan/Documents/GitHub/ByteDeskAI/infrastructure --to fd2b831f'. The send returned ok. The marketplace lead pane (mass-laptop01--bytedesk-marketplace--lead--marketplace, %17) sat idle at an empty prompt for over an hour and never showed an '[ao] Standing message' notice, so the urgent TM-556 escalation went unread. Workaround used at 21:05Z: typed the notice into the empty composer by hand; the lead then read the message. Expected: cross-repo mail to a lead raises the same pane notice that same-repo and supervisor mail do. Repro: send cross-repo mail from one lead to another idle lead and watch the target pane.