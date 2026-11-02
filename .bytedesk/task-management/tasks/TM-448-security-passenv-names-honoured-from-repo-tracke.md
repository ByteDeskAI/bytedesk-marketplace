---
id: "TM-448"
kind: "task"
status: "done"
created: "2026-10-05T15:37:00.990Z"
board: "bytedeskai/bytedesk-marketplace"
title: "SECURITY passEnv names honoured from repo-tracked config, incl. reserved names"
epic: "EP-028"
acceptance: [{"text":"Repo-tracked passEnv is ignored with a warning; only user/machine config counts","done":true,"at":"2026-10-09T00:13:39.387Z"},{"text":"Reserved names (TM_*, AO_*, CLAUDE_*, PATH, LD_*, HOME) are refused","done":true,"at":"2026-10-09T00:13:39.809Z"},{"text":"Guard variables are applied after the secrets file; tests cover all three","done":true,"at":"2026-10-09T00:13:40.236Z"}]
evidence: [".bytedesk/task-management/evidence/TM-448-1791504820707.log"]
commits: ["https://github.com/ByteDeskAI/bytedesk-marketplace/pull/224"]
blockedBy: []
blocks: []
actor: "main"
session: "d82e2db7-2daf-4130-8dff-71d57be2583d"
branch: "main"
worktree: "/home/ryan/Documents/GitHub/ByteDeskAI/bytedesk-marketplace"
labels: ["ready-for-agent"]
triagedBy: "auto"
updated: "2026-10-09T00:13:41.178Z"
priority: "highest"
comments: [{"author":"main","ts":"2026-10-05T16:19:33.656Z","text":"review verdict: approved — https://github.com/ByteDeskAI/bytedesk-marketplace/pull/224 @ f15b8fd4 (independent re-review rv-222); final round drops the TM-460 since-shortcut"},{"author":"main","ts":"2026-10-05T16:24:44.676Z","text":"review verdict: approved — https://github.com/ByteDeskAI/bytedesk-marketplace/pull/224 @ 7dd1f3f8 (independent delta review rv-222: both findings closed)"}]
evidenceSources: {".bytedesk/task-management/evidence/TM-448-1791504820707.log":{"source":null,"sha256":"e1ce15667ece98f982c63dbb363bc39289e3b59435a129a7f25ca685b607cd9a","bytes":162,"at":"2026-10-09T00:13:40.708Z"}}
closed: "2026-10-09T00:13:41.172Z"
---

rv-197 on #200: passEnv comes from git-tracked .bytedesk/{agent-orchestration,task-management}/config.json, so a self-merged PR adds AO_AGENT_ID/GITHUB_TOKEN for every later worker; on tmux the sourced file overrides the -e guard vars (TM_ROOT, TM_ACTOR, TM_SESSION_ID).