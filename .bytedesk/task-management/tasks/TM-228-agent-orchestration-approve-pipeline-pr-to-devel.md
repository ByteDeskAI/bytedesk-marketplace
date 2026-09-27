---
id: "TM-228"
kind: "task"
status: "blocked"
created: "2026-09-24T21:08:03.031Z"
board: "bytedeskai/bytedesk-marketplace"
title: "agent-orchestration: approve pipeline (PR to develop, wait for CI, merge, then clean up)"
epic: "EP-021"
acceptance: [{"text":"approve opens/updates the PR with the bundle body; CI wait and merge are journaled; tests with a fake forge","done":false},{"text":"Cleanup runs only after a verified merge and removes worktrees, branches and owned agent sessions; failures leave state intact with recovery","done":false},{"text":"Pipeline resumes after a crash without duplicating the PR or merge","done":false}]
evidence: []
commits: []
blockedBy: ["TM-227"]
blocks: []
actor: "main"
session: "1b07de2e-6b73-47c6-ad14-aa29eeea67fd"
branch: "main"
worktree: "/home/ryan/Documents/GitHub/ByteDeskAI/bytedesk-marketplace"
labels: ["ready-for-agent"]
triagedBy: "auto"
updated: "2026-09-24T22:26:40.604Z"
comments: [{"author":"main","ts":"2026-09-24T22:26:40.598Z","text":"Gateway link (from gateway lead d60f0608, 2026-09-24): serves gateway TM-448 (EP-027 P4, parked by Ryan)."}]
---

For gateway EP-027 P4 (TM-448). After approve: open or update a PR to the repo's target branch (develop for the gateway) with the evidence bundle as its body, wait for CI, merge once CI passes, and only then clean up the run's worktrees, branches and agent sessions. Each step is journaled and resumable; any failure leaves everything in place with a recovery path. Reuse manage integrate/cleanup gates where they fit (see TM-218, TM-224).