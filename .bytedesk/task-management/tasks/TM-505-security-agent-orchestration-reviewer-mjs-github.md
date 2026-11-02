---
id: "TM-505"
kind: "task"
status: "open"
created: "2026-10-09T02:24:19.326Z"
board: "bytedeskai/bytedesk-marketplace"
title: "SECURITY agent-orchestration reviewer.mjs: GitHub calls run PATH gh and required_checks is read from worker-writable config"
epic: "EP-028"
acceptance: [{"text":"All gh calls in reviewer.mjs go through hostGh/safeGh (pinned binary, GH_HOST=github.com, scrubbed env)","done":false},{"text":"requiredCheckNames reads required_checks through loadGovernedConfig","done":false},{"text":"Tests: a PATH gh shim is never invoked; a worker-written required_checks is ignored","done":false}]
evidence: []
commits: []
blockedBy: ["TM-427"]
blocks: ["TM-516"]
actor: "main"
session: "d82e2db7-2daf-4130-8dff-71d57be2583d"
branch: "main"
worktree: "/home/ryan/Documents/GitHub/ByteDeskAI/bytedesk-marketplace"
labels: ["ready-for-agent"]
triagedBy: "auto"
updated: "2026-10-09T17:17:54.308Z"
priority: "highest"
links: [{"type":"relates to","id":"TM-427"},{"type":"relates to","id":"TM-475"}]
---

From PR #241 review (rv-241). H2: githubCompare (:892-893), githubBranchTip (:902-903), githubPullBase (:911-912) and the pinnedGithubRepo resolver they pass run raw gh from PATH with no trustedGh/safeGh. They set trustedReviewRange and the admission base (management.mjs:510, :520) for the lead. L2: requiredCheckNames (:1400) reads the protected key required_checks via raw loadConfig instead of loadGovernedConfig. reviewer.mjs is owned by the session working TM-427/TM-499, so this was kept out of PR #241.