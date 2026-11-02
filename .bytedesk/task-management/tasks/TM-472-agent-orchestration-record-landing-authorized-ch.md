---
id: "TM-472"
kind: "task"
status: "done"
created: "2026-10-05T17:36:28.870Z"
board: "bytedeskai/bytedesk-marketplace"
title: "agent-orchestration: record-landing --authorized checks origin/<target> locally; file:// origin still allowed"
epic: "EP-028"
acceptance: [{"text":"record-landing verifies the landed head through the server (gh api) like mergeInOf","done":true,"at":"2026-10-09T05:44:44.654Z"},{"text":"Host fetches use only the pinned remote URL, or file:// is refused for host git","done":true,"at":"2026-10-09T05:44:45.114Z"},{"text":"Tests for both","done":true,"at":"2026-10-09T05:44:45.601Z"}]
evidence: [".bytedesk/task-management/evidence/TM-472-1791524686026.log"]
commits: ["https://github.com/ByteDeskAI/bytedesk-marketplace/pull/241"]
blockedBy: []
blocks: []
actor: "main"
session: "d82e2db7-2daf-4130-8dff-71d57be2583d"
branch: "main"
worktree: "/home/ryan/Documents/GitHub/ByteDeskAI/bytedesk-marketplace"
labels: ["ready-for-agent"]
triagedBy: "auto"
updated: "2026-10-09T05:44:46.957Z"
comments: [{"author":"main","ts":"2026-10-05T18:04:42.607Z","text":"record-landing part fixed in PR #226 @ 7d8ab34e (server compare for every caller incl. --authorized); file:// origin left allowed (rated LOW by rv-222: all trust decisions now compare SHAs via the server)."},{"author":"main","ts":"2026-10-09T05:44:46.520Z","text":"review verdict: approved — independent reviewers rv-241 and rv-241b approved PR #241 https://github.com/ByteDeskAI/bytedesk-marketplace/pull/241 (verdicts delivered to the lead session)."}]
evidenceSources: {".bytedesk/task-management/evidence/TM-472-1791524686026.log":{"source":null,"sha256":"915dc758fde0db4a59e5557efff35eaabf6f98342f0c6278a1500873b3f0f8f5","bytes":243,"at":"2026-10-09T05:44:46.027Z"}}
closed: "2026-10-09T05:44:46.946Z"
---

Residual from PR #226 round 2: record-landing under the operator's --authorized still verifies against the local origin/<target> ref (worker-writable), and safe-git still allows a file:// origin, so the worker chooses which repository a host fetch reads (trust decisions now go through the server).