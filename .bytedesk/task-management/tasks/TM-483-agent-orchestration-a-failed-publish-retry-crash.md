---
id: "TM-483"
kind: "task"
status: "done"
created: "2026-10-08T23:12:19.915Z"
board: "bytedeskai/bytedesk-marketplace"
title: "agent-orchestration: a failed publish retry crashes the repository supervisor"
epic: "EP-028"
acceptance: [{"text":"Per-record errors are caught and reported; foreign unreadable records are skipped; the supervisor tick survives a bad ledger (test)","done":true,"at":"2026-10-09T01:50:48.775Z"},{"text":"Mailbox receive/disposition require a bound caller identity (via the TM-427 identity helper); a supported tm goal resume clears human_required with a bound human receipt","done":false}]
evidence: [".bytedesk/task-management/evidence/TM-483-1791510649724.log"]
commits: ["https://github.com/ByteDeskAI/bytedesk-marketplace/pull/229"]
blockedBy: []
blocks: []
actor: "main"
session: "d82e2db7-2daf-4130-8dff-71d57be2583d"
branch: "main"
worktree: "/home/ryan/Documents/GitHub/ByteDeskAI/bytedesk-marketplace"
labels: ["ready-for-agent","plugin:agent-orchestration"]
triagedBy: "auto"
updated: "2026-10-09T01:50:51.490Z"
priority: "high"
comments: [{"author":"main","ts":"2026-10-08T23:13:16.879Z","text":"Owned by the EP-028 lead (agent-comms-reliability-plan session), per agreement 2026-10-08; PR against main after independent review, lands after 0.16.1 (target 0.16.2)."},{"author":"main","ts":"2026-10-08T23:28:59.830Z","text":"review verdict: changes requested — https://github.com/ByteDeskAI/bytedesk-marketplace/pull/229 (independent review rv-229: F1 mailbox resume hides failures, F2 reply-id squat, F3 page spam, F4 lost page, F5 EACCES aborts retries, F6 skipped records never escalated)"},{"author":"main","ts":"2026-10-08T23:52:38.916Z","text":"review verdict: approved — https://github.com/ByteDeskAI/bytedesk-marketplace/pull/229 @ 8ac757cd (independent delta review rv-229: F1-F6 and N1-N3 fixed; TM-483 AC2 split to TM-486)"},{"author":"main","ts":"2026-10-09T01:50:50.932Z","text":"AC1 merged in PR #229 (b925c15a). AC2 (MCP receive/dispose identity, human_required on goals) is split to TM-486, in progress."}]
evidenceSources: {".bytedesk/task-management/evidence/TM-483-1791510649724.log":{"source":null,"sha256":"2ff2b0be7b6a8d4894dd140bc28dec855c3a4a30ce3de83afa29627426d87cd7","bytes":184,"at":"2026-10-09T01:50:49.726Z"}}
closed: "2026-10-09T01:50:51.480Z"
---

Post-merge review of PR #141: supervision.mjs:222 calls resumeStandingMessages without a catch; it rethrows from resumeMailboxPublications (mailbox-receipts.mjs:206-209) and on any invalid publication record in any repo's ledger (:233-245), which the supervise loop treats as fatal. Also MEDIUM: MCP mailboxReceive / setMailboxDisposition do not check the caller (topology-api.mjs:18-35); MEDIUM: a goal set human_required can never be cleared (goal-feedback.mjs:236-245).