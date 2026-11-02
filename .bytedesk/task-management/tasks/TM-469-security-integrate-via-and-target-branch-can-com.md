---
id: "TM-469"
kind: "task"
status: "done"
created: "2026-10-05T16:42:11.538Z"
board: "bytedeskai/bytedesk-marketplace"
title: "SECURITY integrate_via and target_branch can come from config layers a worker can write"
epic: "EP-028"
acceptance: [{"text":"integrate_via and target_branch are read only from the operator-controlled source TM-442 uses","done":true,"at":"2026-10-09T05:44:41.348Z"},{"text":"A worker-written global/working-copy value is ignored with a warning (test)","done":true,"at":"2026-10-09T05:44:41.807Z"}]
evidence: [".bytedesk/task-management/evidence/TM-469-1791524682255.log"]
commits: ["https://github.com/ByteDeskAI/bytedesk-marketplace/pull/241"]
blockedBy: []
blocks: []
actor: "main"
session: "d82e2db7-2daf-4130-8dff-71d57be2583d"
branch: "main"
worktree: "/home/ryan/Documents/GitHub/ByteDeskAI/bytedesk-marketplace"
labels: ["ready-for-agent"]
triagedBy: "auto"
updated: "2026-10-09T05:44:43.179Z"
priority: "high"
evidenceSources: {".bytedesk/task-management/evidence/TM-469-1791524682255.log":{"source":null,"sha256":"915dc758fde0db4a59e5557efff35eaabf6f98342f0c6278a1500873b3f0f8f5","bytes":243,"at":"2026-10-09T05:44:42.257Z"}}
comments: [{"author":"main","ts":"2026-10-09T05:44:42.694Z","text":"review verdict: approved — independent reviewers rv-241 and rv-241b approved PR #241 https://github.com/ByteDeskAI/bytedesk-marketplace/pull/241 (verdicts delivered to the lead session)."}]
closed: "2026-10-09T05:44:43.169Z"
---

Residual from PR #226 (TM-442): the four policy keys now come only from the server-side default branch, but management.integrate_via and management.target_branch still resolve from writable layers, so a worker can change where and how its task lands.