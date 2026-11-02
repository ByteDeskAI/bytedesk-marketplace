---
id: "TM-462"
kind: "task"
status: "open"
created: "2026-10-05T15:53:07.993Z"
board: "bytedeskai/bytedesk-marketplace"
title: "SECURITY run send and env-only identity let any process send standing mail as ao-supervisor"
epic: "EP-028"
acceptance: [{"text":"send --from/--from-project go through the same sessionIdentity check as mailbox send; a mismatch is refused (test)","done":true,"at":"2026-10-09T00:25:59.842Z"},{"text":"sessionIdentity refuses reserved system senders (ao-supervisor, ao-management, tm-dispatch) unless called in-process by supervisor code","done":false},{"text":"A grep audit test shows every standing-mail entry point uses one identity check","done":true,"at":"2026-10-09T00:26:00.605Z"}]
evidence: [".bytedesk/task-management/evidence/TM-462-1791505561009.log"]
commits: ["https://github.com/ByteDeskAI/bytedesk-marketplace/pull/225","https://github.com/ByteDeskAI/bytedesk-marketplace/pull/229"]
blockedBy: ["TM-427"]
blocks: []
actor: "main"
session: "d82e2db7-2daf-4130-8dff-71d57be2583d"
branch: "main"
worktree: "/home/ryan/Documents/GitHub/ByteDeskAI/bytedesk-marketplace"
labels: ["ready-for-agent"]
triagedBy: "auto"
updated: "2026-10-09T17:17:54.053Z"
priority: "highest"
comments: [{"author":"main","ts":"2026-10-05T17:05:48.330Z","text":"review verdict: changes requested — https://github.com/ByteDeskAI/bytedesk-marketplace/pull/225 @ ec55c509 (independent review rv-225: merge after F1 console-show receipt leak; F2 handoff self-branch pane proof; F4 wait id oracle)"},{"author":"main","ts":"2026-10-05T17:56:51.034Z","text":"review verdict: approved — https://github.com/ByteDeskAI/bytedesk-marketplace/pull/225 @ 3350c3f4 (independent final delta review rv-225; follow-ups TM-473 TM-474)"},{"author":"review-sweep","ts":"2026-10-06T17:56:51.789Z","text":"review-sweep: PR #225 \"TM-462 TM-463 TM-464 TM-465 TM-466: bind standing mail and handoff to the session identity (EP-028)\" has had no activity for 24h — needs an independent review or a decision."}]
evidenceSources: {".bytedesk/task-management/evidence/TM-462-1791505561009.log":{"source":null,"sha256":"e77b4fef20061117e02f86616dee3a0550aac2cc1c24188ab91be19624b030d3","bytes":184,"at":"2026-10-09T00:26:01.010Z"}}
reopenedReason: "Closed too early by the lead's merge script: AC2 (sessionIdentity refuses reserved system senders) is TM-427 part B, not in PR #225. Part A (send --from bound to session) and the audit landed in #225 (0bc2a2f3)."
---

rv-195 on #195. (A) 'ao-topology send --run <r> --from ao-supervisor --from-project /other --to <lead>' takes --from verbatim (cli.mjs:1656 -> mailbox.mjs:240/342 sendStandingMessage) with no sessionIdentity check (rule 3). (B) AO_AGENT_ID=ao-supervisor passes sessionIdentity, which reserves no system names. The lead's ring then reads 'from ao-supervisor'. B overlaps TM-427's shared identity helper.