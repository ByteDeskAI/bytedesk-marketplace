---
id: "TM-467"
kind: "task"
status: "done"
created: "2026-10-05T16:07:46.164Z"
board: "bytedeskai/bytedesk-marketplace"
title: "SECURITY repo-tracked dispatch.tmuxCommand and AO templates choose the worker command; known-repo set is same-UID writable"
epic: "EP-028"
acceptance: [{"text":"Worker launch commands come only from user/machine config or plugin-shipped defaults, never repo-tracked config (test)","done":true,"at":"2026-10-09T04:36:03.971Z"},{"text":"Known-repo membership is not extendable by a worker without operator action, or the risk is documented in an ADR with the chosen mitigation","done":true,"at":"2026-10-09T04:36:04.399Z"}]
evidence: [".bytedesk/task-management/evidence/TM-467-1791520564754.log"]
commits: ["https://github.com/ByteDeskAI/bytedesk-marketplace/pull/240","https://github.com/ByteDeskAI/bytedesk-marketplace/pull/257","https://github.com/ByteDeskAI/bytedesk-marketplace/pull/259"]
blockedBy: []
blocks: []
actor: "main"
session: "d82e2db7-2daf-4130-8dff-71d57be2583d"
branch: "main"
worktree: "/home/ryan/Documents/GitHub/ByteDeskAI/bytedesk-marketplace"
labels: ["ready-for-agent"]
triagedBy: "auto"
updated: "2026-10-10T00:21:03.723Z"
links: [{"type":"relates to","id":"TM-501"},{"type":"relates to","id":"TM-502"},{"type":"relates to","id":"TM-503"},{"type":"relates to","id":"TM-504"}]
evidenceSources: {".bytedesk/task-management/evidence/TM-467-1791520564754.log":{"source":null,"sha256":"a098cd7249c54c74946e7b3e140fc520add7dee84084ddda542c4bc86db9ffe2","bytes":264,"at":"2026-10-09T04:36:04.755Z"}}
comments: [{"author":"main","ts":"2026-10-09T04:36:05.204Z","text":"review verdict: approved — independent reviewer rv-240 approved PR #240 https://github.com/ByteDeskAI/bytedesk-marketplace/pull/240 (verdict delivered to the lead session)."}]
closed: "2026-10-09T04:36:05.621Z"
---

Residual risk reported by the TM-446..449 worker (PR #224): (1) repo-tracked dispatch.tmuxCommand and AO templates still decide which command a worker runs, so a self-merged PR changes it; (2) a same-UID worker can add a sibling dir or edit AO repos.json to become a 'known' repo, and pool ensure would start a pool reading that repo's config.