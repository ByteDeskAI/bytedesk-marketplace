---
id: "TM-481"
kind: "task"
status: "done"
created: "2026-10-08T23:12:17.121Z"
board: "bytedeskai/bytedesk-marketplace"
title: "SECURITY task-management worker-guard: a governed worker can merge its own PR before the independent review verdict"
epic: "EP-028"
acceptance: [{"text":"A governed task's worker (TM_DISPATCH_GOVERNED or task governance) is refused every merge, including its own PR; tested","done":true,"at":"2026-10-09T06:10:28.514Z"},{"text":"Attached -R, --admin without all required checks passing, gh repo set-default and graphql mergePullRequest are refused; own branch requires TM_DISPATCH_BRANCH; tests per case","done":true,"at":"2026-10-09T06:10:28.967Z"}]
evidence: [".bytedesk/task-management/evidence/TM-481-1791526229408.log"]
commits: ["https://github.com/ByteDeskAI/bytedesk-marketplace/pull/230"]
blockedBy: []
blocks: []
actor: "main"
session: "d82e2db7-2daf-4130-8dff-71d57be2583d"
branch: "main"
worktree: "/home/ryan/Documents/GitHub/ByteDeskAI/bytedesk-marketplace"
labels: ["ready-for-agent","plugin:task-management"]
triagedBy: "auto"
updated: "2026-10-09T06:10:30.228Z"
priority: "highest"
comments: [{"author":"main","ts":"2026-10-08T23:13:16.177Z","text":"Owned by the EP-028 lead (agent-comms-reliability-plan session), per agreement 2026-10-08; PR against main after independent review, lands after 0.16.1 (target 0.16.2)."},{"author":"main","ts":"2026-10-08T23:48:20.129Z","text":"review verdict: changes requested — https://github.com/ByteDeskAI/bytedesk-marketplace/pull/230 (independent security review rv-230: C1 forged registry record releases guard; H1 hidden command names; H2 retargeting; M1 ancestry escapes; server-side fix TM-489)"},{"author":"main","ts":"2026-10-09T06:10:29.807Z","text":"review verdict: approved on design review — Ryan chose to merge PR #230 without the bypass probes (2026-10-09). https://github.com/ByteDeskAI/bytedesk-marketplace/pull/230"}]
evidenceSources: {".bytedesk/task-management/evidence/TM-481-1791526229408.log":{"source":null,"sha256":"3a148fe3002cff3d100fd1c9606709c0db5fbff384d3c8c9af05ea80e9f336f9","bytes":309,"at":"2026-10-09T06:10:29.409Z"}}
closed: "2026-10-09T06:10:30.217Z"
---

Post-merge review of PR #183 (TM-389): worker-guard.mjs:212-219 allows gh pr merge <own-branch> with no governance input, though render.mjs:310 tells a governed worker not to merge. Same class as TM-427. Also MEDIUM: attached -R<repo> (gh pr merge x -Revil/repo) bypasses the repo check (a.includes('-R') misses it); MEDIUM: --admin is always allowed and overrides failing/pending required checks; LOW: gh repo set-default and gh api graphql mergePullRequest are not caught; LOW: own-branch falls back to HEAD when TM_DISPATCH_BRANCH is unset.